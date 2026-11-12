-- Speed Dating: after a successful match, both people take a 12-hour break from Speed Dating
-- ("go build a bond with your recent match"). It slows down people using it as a match machine.
-- Works alongside the 5-dates-per-24-hours limit: when both apply, the later time wins.
-- The quota now says why ('match' or 'limit'), and for a match break, which chat to go to.

set lock_timeout = '5s';

alter table public.speed_sessions add column if not exists matched_at timestamptz;
-- Matches made before this change: count them from when the date ended.
update public.speed_sessions set matched_at = coalesce(ended_at, now())
where matched_at is null and a_like is true and b_like is true and conversation_id is not null;
create index if not exists speed_sessions_matched_a on public.speed_sessions (user_a, matched_at desc) where matched_at is not null;
create index if not exists speed_sessions_matched_b on public.speed_sessions (user_b, matched_at desc) where matched_at is not null;

-- How long the break after a match lasts. (A future premium plan could change it here.)
create or replace function dating_private.speed_match_break(p_user uuid) returns interval
language sql stable as $$ select interval '12 hours' $$;

create or replace function dating_private.speed_quota_for(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  with recent as (
    select started_at from speed_sessions
    where (user_a = p_user or user_b = p_user) and started_at > now() - interval '24 hours'
    order by started_at desc
  ), lim as (select speed_daily_limit(p_user) as n),
  -- When the daily limit lifts (only if it's used up).
  lim_until as (
    select case when (select count(*) from recent) >= (select n from lim)
      then (select started_at from recent offset (select n from lim) - 1 limit 1) + interval '24 hours' end as at),
  -- The latest match still inside its break.
  last_match as (
    select s.matched_at, s.conversation_id from speed_sessions s
    where (s.user_a = p_user or s.user_b = p_user) and s.matched_at > now() - speed_match_break(p_user)
    order by s.matched_at desc limit 1),
  match_until as (select (select matched_at from last_match) + speed_match_break(p_user) as at)
  select jsonb_build_object(
    'limit', (select n from lim),
    'used', (select count(*) from recent),
    'left', greatest((select n from lim) - (select count(*) from recent), 0),
    -- null = you can speed date now; otherwise the moment you can again.
    'available_at', nullif(greatest(coalesce((select at from lim_until), '-infinity'), coalesce((select at from match_until), '-infinity')), '-infinity'),
    'reason', case
      when (select at from match_until) is not null and (select at from match_until) >= coalesce((select at from lim_until), '-infinity') then 'match'
      when (select at from lim_until) is not null then 'limit' end,
    -- Your own recent match's chat (only during the break), so the app can take you there.
    'match_conversation', (select conversation_id from last_match),
    'now', now());
$$;

-- Joining and being offered as a partner both respect any break (limit or match).
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
  select session_id into live from speed_active where user_id = me;
  if live is not null then
    perform speed_tick(live);
    if exists (select 1 from speed_active where user_id = me) then return speed_view(live, me); end if;
  end if;

  -- On a break (daily limit or a recent match)? Leave the queue and say until when.
  if speed_quota_for(me) ->> 'available_at' is not null then
    delete from speed_queue where user_id = me;
    return jsonb_build_object('status', 'limit', 'quota', speed_quota_for(me), 'now', now());
  end if;

  insert into speed_queue (user_id) values (me)
  on conflict (user_id) do update set seen_at = now();

  select q.user_id into other
  from speed_queue q
  where q.user_id <> me and q.seen_at > now() - interval '20 seconds'
    and not exists (select 1 from speed_active a where a.user_id = q.user_id)
    and speed_quota_for(q.user_id) ->> 'available_at' is null
    and speed_can_date(me, q.user_id)
  order by q.joined_at
  limit 1
  for update of q skip locked;

  if other is null then
    return jsonb_build_object('status', 'waiting', 'now', now());
  end if;

  insert into speed_sessions (user_a, user_b) values (other, me) returning id into sid;
  insert into speed_active (user_id, session_id) values (me, sid), (other, sid);
  delete from speed_queue where user_id in (me, other);
  begin perform realtime.send(jsonb_build_object('session', sid), 'paired', 'speedq:' || other, true);
  exception when others then null; end;
  return speed_view(sid, me);
end $$;

-- Two Likes: record when the match happened (starts both people's 12-hour break).
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
    return speed_view(p_session, me);
  end if;
  if s.user_a = me then update speed_sessions set a_like = coalesce(p_like, false) where id = s.id returning * into s;
  else update speed_sessions set b_like = coalesce(p_like, false) where id = s.id returning * into s; end if;

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
    update speed_sessions set conversation_id = conv, matched_at = now() where id = s.id;
  end if;
  return speed_view(p_session, me);
end $$;

revoke all on function dating_private.speed_match_break(uuid) from public, anon, authenticated;
