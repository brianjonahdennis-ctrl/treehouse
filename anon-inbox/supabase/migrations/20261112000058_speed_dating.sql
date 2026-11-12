-- Speed Dating: five-minute anonymous one-on-one video dates.
--
-- Flow: join the queue → the database pairs two compatible people (atomically) → both connect a
-- video call (WebRTC; offers/answers relayed through speed_signal) → when BOTH are connected the
-- five minutes start, timed by the database clock → at the end each picks Like or Pass privately →
-- two Likes make an ordinary dating match (likes + a chat in Matches), nothing else does.
--
-- Rules enforced here, whatever the app does:
--   * Signed in, active, not suspended dating profile (18+ is already guaranteed by profiles).
--   * Both people fit each other's preferences (gender, age range, state filter) both ways.
--   * Never paired with: yourself, anyone either of you blocked, someone you already have a chat
--     with, or someone you speed-dated in the last 24 hours.
--   * One queue entry and one live date per person (primary keys), two people per date.
--   * The clock starts once both are connected and can't be extended; a date whose other person
--     disappears for 25 s ends ("dropped"); a date nobody starts within 60 s ends ("no_show").
--   * One Like/Pass per person, kept private; exactly one match on two Likes; no friendship.
--   * 5 dates per 24 hours (dates that actually started). After that, Speed Dating cools down until
--     the oldest of those dates is 24 hours old. speed_daily_limit() is the one place a future
--     premium plan raises it.
-- Calls are never recorded. Only the two participants can read a date or its live channel.

set lock_timeout = '5s';

-- ---- Tables (no direct access: everything goes through the functions below) ------------------------
create table if not exists public.speed_queue (
  user_id uuid primary key references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);
create index if not exists speed_queue_seen on public.speed_queue (seen_at);

create table if not exists public.speed_sessions (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users (id) on delete cascade,   -- starts the call (makes the offer)
  user_b uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  a_ready timestamptz, b_ready timestamptz,          -- video connected on each side
  a_seen timestamptz, b_seen timestamptz,            -- last heartbeat from each side
  started_at timestamptz, ends_at timestamptz,       -- the five minutes, set once both are connected
  ended_at timestamptz, end_reason text check (end_reason in ('time', 'left', 'dropped', 'no_show', 'blocked')),
  a_like boolean, b_like boolean,                    -- private decisions
  conversation_id uuid references public.dating_conversations (id) on delete set null,
  check (user_a <> user_b)
);
create index if not exists speed_sessions_a on public.speed_sessions (user_a, created_at desc);
create index if not exists speed_sessions_b on public.speed_sessions (user_b, created_at desc);

-- One live date per person.
create table if not exists public.speed_active (
  user_id uuid primary key references auth.users (id) on delete cascade,
  session_id uuid not null references public.speed_sessions (id) on delete cascade
);

alter table public.speed_queue enable row level security;
alter table public.speed_sessions enable row level security;
alter table public.speed_active enable row level security;
revoke all on public.speed_queue, public.speed_sessions, public.speed_active from public, anon, authenticated;

-- ---- Helpers --------------------------------------------------------------------------------------------
create or replace function dating_private.speed_can_date(p_me uuid, p_other uuid) returns boolean
language sql stable security definer set search_path = public, dating_private as $$
  select exists (
    select 1 from dating_profiles me, dating_profiles o
    where me.user_id = p_me and o.user_id = p_other and p_me <> p_other
      and me.is_active and not me.suspended and o.is_active and not o.suspended
      and o.gender = any (me.interested_in) and me.gender = any (o.interested_in)
      and o.age between me.min_age and me.max_age and me.age between o.min_age and o.max_age
      and (me.pref_state is null or o.state = me.pref_state)
      and (o.pref_state is null or me.state = o.pref_state))
    and not dating_is_blocked(p_me, p_other)
    and not exists (select 1 from dating_conversations c where c.user_a = least(p_me, p_other) and c.user_b = greatest(p_me, p_other))
    and not exists (select 1 from speed_sessions s
                    where s.created_at > now() - interval '24 hours'
                      and ((s.user_a = p_me and s.user_b = p_other) or (s.user_a = p_other and s.user_b = p_me)));
$$;

-- End a date (once), freeing both people.
create or replace function dating_private.speed_close(p_session uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  update speed_sessions set ended_at = now(), end_reason = p_reason where id = p_session and ended_at is null;
  delete from speed_active where session_id = p_session;
end $$;

-- Apply the clock and the drop/no-show rules to one date.
create or replace function dating_private.speed_tick(p_session uuid) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare s speed_sessions%rowtype;
begin
  select * into s from speed_sessions where id = p_session;
  if not found or s.ended_at is not null then return; end if;
  if s.ends_at is not null and now() >= s.ends_at then perform speed_close(s.id, 'time');
  elsif s.started_at is null and now() > s.created_at + interval '60 seconds' then perform speed_close(s.id, 'no_show');
  elsif s.started_at is not null and (coalesce(s.a_seen, s.started_at) < now() - interval '25 seconds'
                                   or coalesce(s.b_seen, s.started_at) < now() - interval '25 seconds') then
    perform speed_close(s.id, 'dropped');
  end if;
end $$;

-- What a participant may see about their date (never ids, names or emails).
create or replace function dating_private.speed_view(p_session uuid, p_me uuid) returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select jsonb_build_object(
    'id', s.id,
    'role', case when s.user_a = p_me then 'a' else 'b' end,
    'other', jsonb_build_object('handle', o.handle, 'age', o.age, 'gender', o.gender, 'state', o.state),
    'status', case when s.ended_at is not null then 'ended' when s.started_at is not null then 'live' else 'connecting' end,
    'started_at', s.started_at, 'ends_at', s.ends_at, 'ended_at', s.ended_at, 'end_reason', s.end_reason,
    'now', now(),
    'my_decision', case when s.user_a = p_me then s.a_like else s.b_like end,
    'result', case
      when s.a_like is true and s.b_like is true then 'match'
      when s.a_like is false or s.b_like is false then 'no_match'
      when s.ended_at is not null and s.ended_at < now() - interval '3 minutes' then 'no_match'   -- the other never decided
      else null end,
    'conversation_id', case when s.a_like is true and s.b_like is true then s.conversation_id end)
  from speed_sessions s
  join dating_profiles o on o.user_id = case when s.user_a = p_me then s.user_b else s.user_a end
  where s.id = p_session and p_me in (s.user_a, s.user_b);
$$;

-- ---- Daily limit -----------------------------------------------------------------------------------------
-- How many dates a person may have in 24 hours. (A premium plan will raise this for its members.)
create or replace function dating_private.speed_daily_limit(p_user uuid) returns int
language sql stable as $$ select 5 $$;

-- Dates used in the last 24 hours, the limit, and when the next date becomes available.
create or replace function dating_private.speed_quota_for(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  with recent as (
    select started_at from speed_sessions
    where (user_a = p_user or user_b = p_user) and started_at > now() - interval '24 hours'
    order by started_at desc
  ), lim as (select speed_daily_limit(p_user) as n)
  select jsonb_build_object(
    'limit', (select n from lim),
    'used', (select count(*) from recent),
    'left', greatest((select n from lim) - (select count(*) from recent), 0),
    -- Cooling down: the next date opens when the oldest date that still counts turns 24 hours old.
    'available_at', case when (select count(*) from recent) >= (select n from lim)
      then (select started_at from recent offset (select n from lim) - 1 limit 1) + interval '24 hours' end,
    'now', now());
$$;

create or replace function public.speed_quota() returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  return speed_quota_for(auth.uid());
end $$;

-- ---- Queue ----------------------------------------------------------------------------------------------
-- Join (or stay in) the queue, and try to pair right away. Returns {status:'waiting'} or the date.
create or replace function public.speed_join() returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  live uuid;
  other uuid;
  sid uuid;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from dating_profiles where user_id = me and is_active and not suspended) then
    raise exception 'You need an active dating profile for Speed Dating.' using errcode = '42501';
  end if;
  -- Already on a date? Carry on with it.
  select session_id into live from speed_active where user_id = me;
  if live is not null then
    perform speed_tick(live);
    if exists (select 1 from speed_active where user_id = me) then return speed_view(live, me); end if;
  end if;

  -- Used up today's dates? Cool down (and leave the queue).
  if (speed_quota_for(me) ->> 'left')::int <= 0 then
    delete from speed_queue where user_id = me;
    return jsonb_build_object('status', 'limit', 'quota', speed_quota_for(me), 'now', now());
  end if;

  insert into speed_queue (user_id) values (me)
  on conflict (user_id) do update set seen_at = now();

  -- Someone compatible who is waiting right now (not locked by another pairing in progress).
  select q.user_id into other
  from speed_queue q
  where q.user_id <> me and q.seen_at > now() - interval '20 seconds'
    and not exists (select 1 from speed_active a where a.user_id = q.user_id)
    and (speed_quota_for(q.user_id) ->> 'left')::int > 0
    and speed_can_date(me, q.user_id)
  order by q.joined_at
  limit 1
  for update of q skip locked;

  if other is null then
    return jsonb_build_object('status', 'waiting', 'now', now());
  end if;

  insert into speed_sessions (user_a, user_b) values (other, me) returning id into sid;   -- the one who waited makes the offer
  insert into speed_active (user_id, session_id) values (me, sid), (other, sid);
  delete from speed_queue where user_id in (me, other);
  -- Tell the person who was waiting (their app also checks every few seconds).
  begin perform realtime.send(jsonb_build_object('session', sid), 'paired', 'speedq:' || other, true);
  exception when others then null; end;
  return speed_view(sid, me);
end $$;

-- While waiting: stay in the queue and find out if you were paired.
create or replace function public.speed_poll() returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); live uuid;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select session_id into live from speed_active where user_id = me;
  if live is not null then
    perform speed_tick(live);
    if exists (select 1 from speed_active where user_id = me) then return speed_view(live, me); end if;
  end if;
  if exists (select 1 from speed_queue where user_id = me) then
    return speed_join();   -- refresh my place and try to pair again
  end if;
  return jsonb_build_object('status', 'idle', 'now', now());
end $$;

create or replace function public.speed_leave_queue() returns void
language sql security definer set search_path = public as $$
  delete from speed_queue where user_id = auth.uid();
$$;

-- How many people are waiting right now (a number only; shown only when there are a few).
create or replace function public.speed_waiting() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from speed_queue where seen_at > now() - interval '20 seconds';
$$;

-- ---- The date ---------------------------------------------------------------------------------------------
-- Your date (live or just ended), or null.
create or replace function public.speed_session(p_session uuid default null) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); sid uuid := p_session;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if sid is null then select session_id into sid from speed_active where user_id = me; end if;
  if sid is null then return null; end if;
  perform speed_tick(sid);
  return speed_view(sid, me);
end $$;

-- "My video is connected." When both are, the five minutes start (once, on the database clock).
create or replace function public.speed_ready(p_session uuid) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); s speed_sessions%rowtype;
begin
  select * into s from speed_sessions where id = p_session and me in (user_a, user_b) for update;
  if not found then raise exception 'Date not found.' using errcode = 'P0002'; end if;
  if s.ended_at is null then
    if s.user_a = me then update speed_sessions set a_ready = coalesce(a_ready, now()), a_seen = now() where id = s.id;
    else update speed_sessions set b_ready = coalesce(b_ready, now()), b_seen = now() where id = s.id; end if;
    update speed_sessions set started_at = now(), ends_at = now() + interval '5 minutes'
    where id = s.id and started_at is null and a_ready is not null and b_ready is not null;
  end if;
  perform speed_tick(p_session);
  return speed_view(p_session, me);
end $$;

-- Every few seconds during the date: "I'm still here". Returns the date (so the app learns if it ended).
create or replace function public.speed_heartbeat(p_session uuid) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid();
begin
  update speed_sessions set a_seen = case when user_a = me then now() else a_seen end,
                            b_seen = case when user_b = me then now() else b_seen end
  where id = p_session and me in (user_a, user_b) and ended_at is null;
  perform speed_tick(p_session);
  return speed_view(p_session, me);
end $$;

-- Pass a call-setup message (offer, answer, network candidate) to the other person on this date.
create or replace function public.speed_signal(p_session uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); s speed_sessions%rowtype;
begin
  select * into s from speed_sessions where id = p_session and me in (user_a, user_b) and ended_at is null;
  if not found then raise exception 'Date not found.' using errcode = 'P0002'; end if;
  if octet_length(p_data::text) > 20000 then raise exception 'Too big.' using errcode = '22023'; end if;
  perform realtime.send(jsonb_build_object('from', case when s.user_a = me then 'a' else 'b' end, 'data', p_data),
                        'signal', 'speed:' || s.id, true);
end $$;

-- End the date now (End call / leave). The other person is told through the live channel.
create or replace function public.speed_end(p_session uuid) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid();
begin
  if not exists (select 1 from speed_sessions where id = p_session and me in (user_a, user_b)) then
    raise exception 'Date not found.' using errcode = 'P0002';
  end if;
  perform speed_close(p_session, 'left');
  begin perform realtime.send('{}'::jsonb, 'ended', 'speed:' || p_session, true); exception when others then null; end;
  return speed_view(p_session, me);
end $$;

-- Like (true) or Pass (false), once, after a date that actually started.
create or replace function public.speed_decide(p_session uuid, p_like boolean) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  s speed_sessions%rowtype;
  conv uuid;
begin
  perform speed_tick(p_session);
  select * into s from speed_sessions where id = p_session and me in (user_a, user_b) for update;
  if not found then raise exception 'Date not found.' using errcode = 'P0002'; end if;
  if s.started_at is null then raise exception 'This date never started.' using errcode = 'P0001'; end if;
  if s.ended_at is null then raise exception 'The date is still going.' using errcode = 'P0001'; end if;
  if s.ended_at < now() - interval '3 minutes' then raise exception 'It''s too late to decide on this date.' using errcode = 'P0001'; end if;
  if (s.user_a = me and s.a_like is not null) or (s.user_b = me and s.b_like is not null) then
    return speed_view(p_session, me);   -- one decision each; repeats change nothing
  end if;
  if s.user_a = me then update speed_sessions set a_like = coalesce(p_like, false) where id = s.id returning * into s;
  else update speed_sessions set b_like = coalesce(p_like, false) where id = s.id returning * into s; end if;

  -- Two Likes: an ordinary dating match (both likes + an accepted chat), exactly once.
  if s.a_like is true and s.b_like is true and s.conversation_id is null
     and not dating_is_blocked(s.user_a, s.user_b) then
    insert into dating_likes (from_user, to_user, liked) values (s.user_a, s.user_b, true), (s.user_b, s.user_a, true)
    on conflict (from_user, to_user) do update set liked = true, created_at = now();
    conv := dating_conversation_between(s.user_a, s.user_b);
    if conv is null then
      insert into dating_conversations (user_a, user_b, started_by, accepted_at)
      values (least(s.user_a, s.user_b), greatest(s.user_a, s.user_b), s.user_a, now())
      returning id into conv;
    else
      update dating_conversations set accepted_at = coalesce(accepted_at, now()), declined_at = null where id = conv;
    end if;
    update speed_sessions set conversation_id = conv where id = s.id;
  end if;
  return speed_view(p_session, me);
end $$;

-- Report or block the person on your date (reports go to the usual dating reports, marked Speed Dating).
create or replace function public.speed_report(p_session uuid, p_reason text, p_details text default '', p_block boolean default false) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  s speed_sessions%rowtype;
  other uuid;
  reason text;
begin
  select * into s from speed_sessions where id = p_session and me in (user_a, user_b);
  if not found then raise exception 'Date not found.' using errcode = 'P0002'; end if;
  other := case when s.user_a = me then s.user_b else s.user_a end;
  if p_reason is not null then
    if (select count(*) from dating_reports where reporter_id = me and created_at > now() - interval '1 hour') >= 10 then
      raise exception 'Too many reports. Try again later.' using errcode = 'P0001';
    end if;
    reason := case p_reason when 'harassment' then 'harassment' when 'sexual' then 'inappropriate' when 'inappropriate' then 'inappropriate'
                            when 'impersonation' then 'fake' when 'underage' then 'underage' else 'other' end;
    insert into dating_reports (reporter_id, reported_id, reason, details)
    values (me, other, reason, left('[Speed Dating' || case p_reason when 'sexual' then ': sexual misconduct' when 'impersonation' then ': impersonation' else '' end
                                    || '] ' || coalesce(p_details, ''), 1000));
  end if;
  if p_block then
    insert into dating_blocks (blocker_id, blocked_id) values (me, other) on conflict do nothing;
    perform speed_close(s.id, 'blocked');
    begin perform realtime.send('{}'::jsonb, 'ended', 'speed:' || s.id, true); exception when others then null; end;
  end if;
end $$;

-- ---- Live channels: a date's channel only for its two people; your queue channel only for you ----
create or replace function public.speed_can_listen(p_topic text) returns boolean
language sql stable security definer set search_path = public, dating_private as $$
  select case
    when p_topic ~ '^speed:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      exists (select 1 from speed_sessions s where s.id = substr(p_topic, 7)::uuid and auth.uid() in (s.user_a, s.user_b))
    when p_topic ~ '^speedq:[0-9a-f-]{36}$' then substr(p_topic, 8) = auth.uid()::text
    else false end;
$$;
drop policy if exists "Speed daters receive their date's signals" on realtime.messages;
create policy "Speed daters receive their date's signals" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast'
         and (select realtime.topic()) like 'speed%'
         and (select public.speed_can_listen((select realtime.topic()))));

-- ---- Permissions ------------------------------------------------------------------------------------------
revoke all on function public.speed_quota() from public, anon;
grant execute on function public.speed_quota() to authenticated;
revoke all on function dating_private.speed_daily_limit(uuid), dating_private.speed_quota_for(uuid) from public, anon, authenticated;
revoke all on function public.speed_join(), public.speed_poll(), public.speed_leave_queue(), public.speed_waiting(),
  public.speed_session(uuid), public.speed_ready(uuid), public.speed_heartbeat(uuid), public.speed_signal(uuid, jsonb),
  public.speed_end(uuid), public.speed_decide(uuid, boolean), public.speed_report(uuid, text, text, boolean),
  public.speed_can_listen(text) from public, anon;
grant execute on function public.speed_join(), public.speed_poll(), public.speed_leave_queue(), public.speed_waiting(),
  public.speed_session(uuid), public.speed_ready(uuid), public.speed_heartbeat(uuid), public.speed_signal(uuid, jsonb),
  public.speed_end(uuid), public.speed_decide(uuid, boolean), public.speed_report(uuid, text, text, boolean),
  public.speed_can_listen(text) to authenticated;
revoke all on function dating_private.speed_can_date(uuid, uuid), dating_private.speed_close(uuid, text),
  dating_private.speed_tick(uuid), dating_private.speed_view(uuid, uuid) from public, anon, authenticated;
