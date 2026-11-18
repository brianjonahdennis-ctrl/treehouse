-- Treasure Hunt part 3 (Hydra, 18 Nov 2026): winners, live ranking, quitting and a hunt chatroom.
--
-- * Staff set how many winners a hunt has (1-100, default 10). When that many players have finished,
--   everyone still playing gets a notification (Inbox + push) that the winners are in, and can keep
--   going or quit. Later finishers still finish, but are not winners.
-- * During the hunt every registrant can see the live ranking: nickname, place and checkpoints done
--   (e.g. 3/5). Other players' coins stay private. This replaces the earlier rule that kept the
--   leaderboard hidden until the hunt ended (Hydra's request, 18 Nov).
-- * Each hunt has a temporary chatroom named after the hunt, with the hunt rules pinned on top.
--   Registrants are in it automatically; they never see a member list. Staff can post, answer, send a
--   private message to one player, and remove messages. When the hunt ends the chat closes at once
--   and its messages are deleted (every 10 minutes).
set lock_timeout = '5s';

alter table public.treasure_hunts
  add column if not exists winners_count integer not null default 10 check (winners_count between 1 and 100),
  add column if not exists rules text not null default '' check (char_length(rules) <= 2000);
-- One row per hunt once its "winners are in" notice has gone out (a separate table, so finishing
-- players never wait on a lock on the hunt row).
create table if not exists public.treasure_hunt_winner_notices (
  hunt_id uuid primary key references public.treasure_hunts (id) on delete cascade,
  sent_at timestamptz not null default now(),
  announcement_id uuid
);
alter table public.treasure_hunt_winner_notices enable row level security;
revoke all on public.treasure_hunt_winner_notices from public, anon, authenticated;
-- Winners are in = that many players have finished.
create or replace function dating_private.treasure_hunt_winners_done(p_hunt uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select (select count(*) from treasure_hunt_participants where hunt_id = p_hunt and completed_at is not null)
    >= (select winners_count from treasure_hunts where id = p_hunt)
$$;
revoke all on function dating_private.treasure_hunt_winners_done(uuid) from public, anon, authenticated;
alter table public.treasure_hunt_participants add column if not exists quit_at timestamptz;

-- A player who quit can't collect anything more (update only, and only when they had quit).
create or replace function dating_private.treasure_hunt_quit_guard() returns trigger
language plpgsql as $$
begin
  raise exception 'You left this hunt, so it can''t be continued.' using errcode = '42501';
end $$;
revoke all on function dating_private.treasure_hunt_quit_guard() from public, anon, authenticated;
drop trigger if exists treasure_hunt_quit_guard on public.treasure_hunt_participants;
create trigger treasure_hunt_quit_guard before update on public.treasure_hunt_participants
  for each row when (old.quit_at is not null and new.quit_at is not null and
    (new.last_checkpoint_sequence, new.total_coins, new.completed_at, new.start_claimed_at)
      is distinct from (old.last_checkpoint_sequence, old.total_coins, old.completed_at, old.start_claimed_at))
  execute function dating_private.treasure_hunt_quit_guard();

create or replace function public.treasure_hunt_quit(p_hunt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p treasure_hunt_participants%rowtype;
begin
  perform dating_private.treasure_hunt_check(me);
  select * into p from treasure_hunt_participants where hunt_id = p_hunt and user_id = me for update;
  if not found then raise exception 'You haven''t started this hunt.' using errcode = '42501'; end if;
  if p.completed_at is not null then raise exception 'You already finished this hunt.' using errcode = '42501'; end if;
  update treasure_hunt_participants set quit_at = coalesce(quit_at, now()) where id = p.id;
end $$;
revoke all on function public.treasure_hunt_quit(uuid) from public, anon;
grant execute on function public.treasure_hunt_quit(uuid) to authenticated;

create or replace function dating_private.ann_targets(p_aud jsonb)
returns table (user_id uuid)
language sql stable as $$
  select p.user_id
  from public.dating_profiles p
  where not p.suspended
    and p.dob_underage_at is null
    and case coalesce(p_aud ->> 'base', 'active')
          when 'all' then true
          when 'active' then p.last_seen_at > now() - interval '30 days'
          when 'new' then p.created_at > now() - make_interval(days => least(greatest(coalesce((p_aud ->> 'days')::int, 7), 1), 365))
          when 'recent' then p.last_seen_at > now() - make_interval(days => least(greatest(coalesce((p_aud ->> 'days')::int, 30), 1), 365))
          when 'inactive' then p.last_seen_at is null or p.last_seen_at <= now() - make_interval(days => least(greatest(coalesce((p_aud ->> 'days')::int, 30), 1), 365))
          else false end
    and (jsonb_array_length(coalesce(p_aud -> 'states', '[]'::jsonb)) = 0
         or p.state in (select jsonb_array_elements_text(p_aud -> 'states')))
    and (jsonb_array_length(coalesce(p_aud -> 'platforms', '[]'::jsonb)) = 0
         or p.user_id in (select d.user_id from public.app_seen_days d
                          where d.day >= ((now() at time zone 'Africa/Lagos')::date - 30)
                            and d.platform in (select jsonb_array_elements_text(p_aud -> 'platforms'))))
    and (p_aud ->> 'hunt' is null
         or (coalesce(p_aud ->> 'hunt_group', 'registered') <> 'playing'
             and p.user_id in (select tp.user_id from public.treasure_hunt_participants tp where tp.hunt_id = (p_aud ->> 'hunt')::uuid))
         or (p_aud ->> 'hunt_group' = 'playing'
             and p.user_id in (select tp.user_id from public.treasure_hunt_participants tp where tp.hunt_id = (p_aud ->> 'hunt')::uuid
                               and tp.completed_at is null and tp.quit_at is null))
         or (coalesce(p_aud ->> 'hunt_group', 'registered') = 'registered'
             and p.user_id in (select r.user_id from public.treasure_hunt_registrations r where r.hunt_id = (p_aud ->> 'hunt')::uuid)));
$$;
revoke all on function dating_private.ann_targets(jsonb) from public, anon, authenticated;

create or replace function dating_private.ann_clean_audience(p_aud jsonb) returns jsonb
language plpgsql immutable set search_path = dating_private as $$
declare
  base text := coalesce(p_aud ->> 'base', 'active');
  days int;
  states jsonb := coalesce(p_aud -> 'states', '[]'::jsonb);
  plats jsonb := coalesce(p_aud -> 'platforms', '[]'::jsonb);
  hunt text := p_aud ->> 'hunt';
  hunt_group text := p_aud ->> 'hunt_group';
begin
  if base not in ('all', 'active', 'new', 'recent', 'inactive') then raise exception 'Choose a valid audience.' using errcode = '22023'; end if;
  if jsonb_typeof(states) <> 'array' or jsonb_typeof(plats) <> 'array' then raise exception 'Choose a valid audience.' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements_text(states) s where s <> all (nigerian_states())) then
    raise exception 'Unknown state in the audience.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements_text(plats) s where s not in ('android-play', 'android-apk', 'android-app', 'ios-app', 'web')) then
    raise exception 'Unknown platform in the audience.' using errcode = '22023';
  end if;
  if hunt is not null and hunt !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Choose a valid audience.' using errcode = '22023';
  end if;
  if hunt_group is not null and (hunt is null or hunt_group not in ('registered', 'started', 'playing')) then
    raise exception 'Choose a valid audience.' using errcode = '22023';
  end if;
  if base in ('new', 'recent', 'inactive') then
    begin days := coalesce((p_aud ->> 'days')::int, case base when 'new' then 7 else 30 end);
    exception when others then raise exception 'Days must be a number.' using errcode = '22023'; end;
    if days not between 1 and 365 then raise exception 'Days must be between 1 and 365.' using errcode = '22023'; end if;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('base', base, 'days', days,
    'states', case when jsonb_array_length(states) > 0 then (select jsonb_agg(distinct s) from jsonb_array_elements_text(states) s) end,
    'platforms', case when jsonb_array_length(plats) > 0 then (select jsonb_agg(distinct s) from jsonb_array_elements_text(plats) s) end,
    'hunt', hunt, 'hunt_group', hunt_group));
end $$;
revoke all on function dating_private.ann_clean_audience(jsonb) from public, anon, authenticated;

-- When the last winner finishes, tell everyone still playing (once per hunt).
create or replace function dating_private.treasure_hunt_winners_check() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare h treasure_hunts%rowtype; done integer; aud jsonb; aid uuid; n integer; claimed integer;
begin
  select * into h from treasure_hunts where id = new.hunt_id;
  if exists (select 1 from treasure_hunt_winner_notices where hunt_id = h.id) then return null; end if;
  select count(*)::integer into done from treasure_hunt_participants where hunt_id = h.id and completed_at is not null;
  if done < h.winners_count then return null; end if;
  insert into treasure_hunt_winner_notices (hunt_id) values (h.id) on conflict do nothing;
  get diagnostics claimed = row_count;
  if claimed = 0 then return null; end if;   -- another finisher is sending it
  aud := ann_clean_audience(jsonb_build_object('base', 'all', 'hunt', h.id::text, 'hunt_group', 'playing'));
  n := (select count(*) from ann_targets(aud));
  if n = 0 then return null; end if;
  insert into announcements (title, preview, body, category, cta_label, cta_url, audience, send_push, status, published_at, was_published, eligible_count)
  values (left(h.title || ': the winners are in', 100),
    left('The first ' || h.winners_count || ' players have finished. You can still finish or quit.', 160),
    'The first ' || h.winners_count || ' players have completed ' || h.title || '. You can keep going and finish the hunt, or quit. Open the hunt to choose.',
    'event', 'Open the hunt', '/home/games/treasure-hunt', aud, true, 'publishing', now(), true, n)
  returning id into aid;
  insert into announcement_audit (actor, action, announcement_id, meta) values (null, 'published', aid, jsonb_build_object('by', 'treasure_hunt_winners', 'treasure_hunt', h.id, 'eligible', n));
  update treasure_hunt_winner_notices set announcement_id = aid where hunt_id = h.id;
  perform ann_deliver_batch(aid);
  return null;
end $$;
revoke all on function dating_private.treasure_hunt_winners_check() from public, anon, authenticated;
drop trigger if exists treasure_hunt_winners_check on public.treasure_hunt_participants;
create trigger treasure_hunt_winners_check after update of completed_at on public.treasure_hunt_participants
  for each row when (old.completed_at is null and new.completed_at is not null)
  execute function dating_private.treasure_hunt_winners_check();

-- ---- Live ranking for players ------------------------------------------------------------------------
-- Everyone registered for the hunt (and staff) sees nickname, place and checkpoints done. Finished
-- players rank by finish time, then by checkpoints done, then by who reached their last one first.
create or replace function public.treasure_hunt_live_board(p_hunt uuid) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); h treasure_hunts%rowtype; total integer; result jsonb;
begin
  perform dating_private.treasure_hunt_check(me);
  select * into h from treasure_hunts where id = p_hunt;
  if not found then raise exception 'This hunt could not be found.' using errcode = 'P0002'; end if;
  if not exists (select 1 from treasure_hunt_registrations where hunt_id = p_hunt and user_id = me)
     and not exists (select 1 from treasure_hunt_participants where hunt_id = p_hunt and user_id = me)
     and not dating_private.treasure_hunt_personal_admin_ok() and not dating_private.staff_can('manage') then
    raise exception 'Register for this hunt to see the ranking.' using errcode = '42501';
  end if;
  select count(*)::integer into total from treasure_hunt_checkpoints where hunt_id = p_hunt;
  with people as (
    select coalesce(r.user_id, p.user_id) as user_id, p.id as pid, p.joined_at, p.last_checkpoint_sequence, p.completed_at, p.quit_at, r.registered_at
    from (select * from treasure_hunt_registrations where hunt_id = p_hunt) r
    full join (select * from treasure_hunt_participants where hunt_id = p_hunt) p on p.user_id = r.user_id
  ), ranked as (
    select x.*, d.handle,
      row_number() over (order by (x.completed_at is null), x.completed_at, (x.quit_at is not null), (x.pid is null),
        coalesce(x.last_checkpoint_sequence, 0) desc,
        (select max(c.claimed_at) from treasure_hunt_claims c where c.participant_id = x.pid) nulls last,
        x.joined_at nulls last, x.registered_at, x.user_id)::integer as place
    from people x join dating_profiles d on d.user_id = x.user_id
    where not d.suspended and d.dob_underage_at is null
  )
  select jsonb_build_object(
    'hunt', jsonb_build_object('id', h.id, 'title', h.title, 'checkpoint_count', total, 'winners_count', h.winners_count,
      'winners_done', dating_private.treasure_hunt_winners_done(h.id), 'ended', h.status = 'completed' or h.ends_at <= now()),
    'me', (select jsonb_build_object('place', place, 'checkpoints', coalesce(last_checkpoint_sequence, 0), 'started', pid is not null,
      'finished', completed_at is not null, 'quit', quit_at is not null, 'winner', completed_at is not null and place <= h.winners_count)
      from ranked where user_id = me),
    'items', coalesce((select jsonb_agg(jsonb_build_object('place', place, 'handle', handle, 'checkpoints', coalesce(last_checkpoint_sequence, 0),
      'started', pid is not null, 'finished', completed_at is not null, 'quit', quit_at is not null,
      'winner', completed_at is not null and place <= h.winners_count, 'me', user_id = me) order by place)
      from (select * from ranked order by place limit 1000) t), '[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke all on function public.treasure_hunt_live_board(uuid) from public, anon;
grant execute on function public.treasure_hunt_live_board(uuid) to authenticated;

-- ---- Hunt chatroom -----------------------------------------------------------------------------------
create table if not exists public.treasure_hunt_chat (
  id         bigserial primary key,
  hunt_id    uuid not null references public.treasure_hunts (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete set null,
  to_user    uuid references auth.users (id) on delete cascade,   -- set = a private message from staff to one player
  from_staff boolean not null default false,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists treasure_hunt_chat_hunt on public.treasure_hunt_chat (hunt_id, id);
create index if not exists treasure_hunt_chat_sender on public.treasure_hunt_chat (user_id, created_at desc);
alter table public.treasure_hunt_chat enable row level security;
revoke all on public.treasure_hunt_chat from public, anon, authenticated;
revoke all on sequence public.treasure_hunt_chat_id_seq from public, anon, authenticated;

-- 'staff', 'member' or null for the signed-in person in one hunt's chat. The chat only exists while the hunt hasn't ended.
create or replace function dating_private.treasure_hunt_chat_role(p_hunt uuid) returns text
language sql stable security definer set search_path = public, dating_private as $$
  select case
    when not exists (select 1 from treasure_hunts h where h.id = p_hunt and h.status in ('draft', 'scheduled', 'active') and h.ends_at > now()) then null
    when dating_private.staff_can('manage') or dating_private.treasure_hunt_personal_admin_ok() then 'staff'
    when exists (select 1 from treasure_hunt_registrations where hunt_id = p_hunt and user_id = auth.uid())
      or exists (select 1 from treasure_hunt_participants where hunt_id = p_hunt and user_id = auth.uid() and quit_at is null) then 'member'
    end
$$;
revoke all on function dating_private.treasure_hunt_chat_role(uuid) from public, anon, authenticated;

-- Messages after p_after (newest 150). Members see the room's messages plus private ones to them; never a member list.
create or replace function public.treasure_hunt_chat(p_hunt uuid, p_after bigint default 0) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); role text := dating_private.treasure_hunt_chat_role(p_hunt); h treasure_hunts%rowtype;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if role is null then
    if exists (select 1 from treasure_hunts where id = p_hunt and (ends_at <= now() or status in ('completed', 'cancelled'))) then
      raise exception 'This hunt has ended, so its chat is closed.' using errcode = '42501';
    end if;
    raise exception 'Register for this hunt to join its chat.' using errcode = '42501';
  end if;
  select * into h from treasure_hunts where id = p_hunt;
  return jsonb_build_object('title', h.title, 'rules', h.rules, 'staff', role = 'staff', 'ends_at', h.ends_at,
    'messages', coalesce((select jsonb_agg(m order by (m->>'id')::bigint) from (
      select jsonb_build_object('id', c.id, 'mine', c.user_id = me, 'from_staff', c.from_staff,
        'sender', case when c.from_staff then 'treehouse team' else coalesce(d.handle, 'Former member') end,
        'private', c.to_user is not null,
        'to', case when role = 'staff' and c.to_user is not null then (select handle from dating_profiles where user_id = c.to_user) end,
        'body', c.body, 'at', c.created_at) as m
      from treasure_hunt_chat c left join dating_profiles d on d.user_id = c.user_id
      where c.hunt_id = p_hunt and c.id > coalesce(p_after, 0)
        and (role = 'staff' or c.to_user is null or c.to_user = me)
      order by c.id desc limit 150) x), '[]'::jsonb));
end $$;
revoke all on function public.treasure_hunt_chat(uuid, bigint) from public, anon;
grant execute on function public.treasure_hunt_chat(uuid, bigint) to authenticated;

-- Post a message. Staff may send one privately to a player (by nickname). Members: 1 message per
-- 3 seconds, 20 per 10 minutes; the usual word filter applies.
create or replace function public.treasure_hunt_chat_send(p_hunt uuid, p_body text, p_to_handle text default null) returns bigint
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); role text := dating_private.treasure_hunt_chat_role(p_hunt); v_body text := btrim(coalesce(p_body, '')); target uuid; nid bigint;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if role is null then raise exception 'You can''t post in this chat.' using errcode = '42501'; end if;
  if char_length(v_body) not between 1 and (case when role = 'staff' then 1000 else 500 end) then
    raise exception 'Write a message (up to % characters).', (case when role = 'staff' then 1000 else 500 end) using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_to_handle, '')), '') is not null then
    if role <> 'staff' then raise exception 'Only the treehouse team can send private messages here.' using errcode = '42501'; end if;
    select d.user_id into target from dating_profiles d where d.handle = btrim(p_to_handle)
      and (exists (select 1 from treasure_hunt_registrations r where r.hunt_id = p_hunt and r.user_id = d.user_id)
        or exists (select 1 from treasure_hunt_participants t where t.hunt_id = p_hunt and t.user_id = d.user_id));
    if target is null then raise exception 'That player isn''t in this hunt.' using errcode = 'P0002'; end if;
  end if;
  if role = 'member' then
    if exists (select 1 from treasure_hunt_chat where user_id = me and created_at > now() - interval '3 seconds')
       or (select count(*) from treasure_hunt_chat where user_id = me and hunt_id = p_hunt and created_at > now() - interval '10 minutes') >= 20 then
      raise exception 'You''re sending messages too fast. Wait a moment.' using errcode = '42501';
    end if;
    v_body := dating_private.clean_text(v_body);
  end if;
  insert into treasure_hunt_chat (hunt_id, user_id, to_user, from_staff, body) values (p_hunt, me, target, role = 'staff', v_body) returning id into nid;
  if role = 'staff' then
    perform dating_private.staff_log(me, case when target is null then 'treasure_hunt_chat_posted' else 'treasure_hunt_chat_private' end,
      'treasure_hunt', p_hunt::text, jsonb_build_object('message', nid, 'to', btrim(p_to_handle)));
  end if;
  return nid;
end $$;
revoke all on function public.treasure_hunt_chat_send(uuid, text, text) from public, anon;
grant execute on function public.treasure_hunt_chat_send(uuid, text, text) to authenticated;

create or replace function public.treasure_hunt_chat_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare h uuid;
begin
  select hunt_id into h from treasure_hunt_chat where id = p_id;
  if h is null then return; end if;
  if dating_private.treasure_hunt_chat_role(h) is distinct from 'staff' then raise exception 'Not allowed.' using errcode = '42501'; end if;
  delete from treasure_hunt_chat where id = p_id;
  perform dating_private.staff_log(auth.uid(), 'treasure_hunt_chat_removed', 'treasure_hunt', h::text, jsonb_build_object('message', p_id));
end $$;
revoke all on function public.treasure_hunt_chat_delete(bigint) from public, anon;
grant execute on function public.treasure_hunt_chat_delete(bigint) to authenticated;

-- Delete the chat of every hunt that has ended.
create or replace function dating_private.treasure_hunt_chat_cleanup() returns void
language sql security definer set search_path = public as $$
  delete from treasure_hunt_chat c using treasure_hunts h
  where h.id = c.hunt_id and (h.ends_at <= now() or h.status in ('completed', 'cancelled'));
$$;
revoke all on function dating_private.treasure_hunt_chat_cleanup() from public, anon, authenticated;
select cron.schedule('treasure-hunt-chat-cleanup', '*/10 * * * *', 'select dating_private.treasure_hunt_chat_cleanup()');

-- ---- Updated reads and setup ---------------------------------------------------------------------------
create or replace function public.treasure_hunts_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); result jsonb;
begin
  perform dating_private.treasure_hunt_check(me);
  select coalesce(jsonb_agg(x.j order by x.mine desc, x.starts_at, x.id), '[]'::jsonb) into result from (
    select h.id, h.starts_at, (r.user_id is not null) as mine, jsonb_build_object(
      'id', h.id, 'title', h.title, 'region', h.region, 'state', h.state, 'description', h.description,
      'starts_at', h.starts_at, 'ends_at', h.ends_at, 'coin_avatar', h.coin_avatar, 'treasure_avatar', h.treasure_avatar,
      'checkpoint_count', (select count(*) from treasure_hunt_checkpoints c where c.hunt_id = h.id),
      'max_registrations', h.max_registrations,
      'winners_count', h.winners_count, 'winners_done', dating_private.treasure_hunt_winners_done(h.id),
      'chat', (r.user_id is not null or dating_private.treasure_hunt_personal_admin_ok() or dating_private.staff_can('manage')),
      'full', (select count(*) from treasure_hunt_registrations a where a.hunt_id = h.id) >= h.max_registrations,
      'live', h.starts_at <= now(),
      'needs_registration', h.state is not null,
      'registered', r.user_id is not null,
      'joined', exists (select 1 from treasure_hunt_participants p where p.hunt_id = h.id and p.user_id = me),
      'register_block', case when r.user_id is null then dating_private.treasure_hunt_register_block(me, h.id) end,
      'registered_count', case when r.user_id is not null then (select count(*) from treasure_hunt_registrations a where a.hunt_id = h.id) end,
      'prizes', dating_private.treasure_hunt_prizes_json(h.id)) as j
    from treasure_hunts h
    left join treasure_hunt_registrations r on r.hunt_id = h.id and r.user_id = me
    where h.status in ('scheduled', 'active') and h.ends_at > now()
      and exists (select 1 from treasure_hunt_checkpoints c where c.hunt_id = h.id)
  ) x;
  return result;
end $$;
revoke all on function public.treasure_hunts_list() from public, anon;
grant execute on function public.treasure_hunts_list() to authenticated;

create or replace function public.staff_treasure_hunts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  perform dating_private.staff_need('manage');
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'title',h.title,'region',h.region,'state',h.state,'join_radius_km',h.join_radius_km,'max_registrations',h.max_registrations,'winners_count',h.winners_count,'rules',h.rules,
    'description',h.description,'status',h.status,
    'starts_at',h.starts_at,'ends_at',h.ends_at,'completion_bonus_coins',h.completion_bonus_coins,'coin_avatar',h.coin_avatar,'treasure_avatar',h.treasure_avatar,
    'participant_count',(select count(*) from treasure_hunt_participants p where p.hunt_id=h.id),
    'registration_count',(select count(*) from treasure_hunt_registrations r where r.hunt_id=h.id),
    'finished_count',(select count(*) from treasure_hunt_participants p where p.hunt_id=h.id and p.completed_at is not null),
    'checkpoints',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'sequence',c.sequence,'name',c.name,'hint',c.hint,'latitude',c.latitude,'longitude',c.longitude,'radius_m',c.radius_m,'reward_coins',c.reward_coins) order by c.sequence) from treasure_hunt_checkpoints c where c.hunt_id=h.id),'[]'::jsonb),
    'start_points',coalesce((select jsonb_agg(to_jsonb(r)-'hunt_id' order by r.sequence) from treasure_hunt_route_points r where r.hunt_id=h.id and r.point_kind='start'),'[]'::jsonb),
    'finish_points',coalesce((select jsonb_agg(to_jsonb(r)-'hunt_id' order by r.sequence) from treasure_hunt_route_points r where r.hunt_id=h.id and r.point_kind='finish'),'[]'::jsonb),
    'prizes',coalesce((select jsonb_agg(jsonb_build_object('sequence',z.sequence,'place',z.place,'title',z.title,'media_type',z.media_type,'media_url',z.media_url) order by z.sequence) from treasure_hunt_prizes z where z.hunt_id=h.id),'[]'::jsonb))
    order by h.created_at desc),'[]'::jsonb)
    into result from treasure_hunts h;
  return result;
end $$;
revoke all on function public.staff_treasure_hunts() from public, anon;
grant execute on function public.staff_treasure_hunts() to authenticated;

create or replace function public.staff_treasure_hunt_save_routes(
  p_hunt jsonb, p_checkpoints jsonb, p_start_points jsonb, p_finish_points jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); hid uuid; joined integer; old_state text; registered integer;
  v_coin text := coalesce(p_hunt->>'coin_avatar','🪙'); v_treasure text := coalesce(p_hunt->>'treasure_avatar','🧰');
  v_state text := nullif(btrim(coalesce(p_hunt->>'state','')), '');
  v_radius integer; v_max integer; v_winners integer; v_rules text := coalesce(p_hunt->>'rules', '');
begin
  perform dating_private.staff_need('manage');
  begin v_radius := coalesce((p_hunt->>'join_radius_km')::integer, 60);
  exception when others then raise exception 'The hunt area size must be a number of kilometres.' using errcode='22023'; end;
  if v_radius not between 1 and 1000 then raise exception 'The hunt area must be between 1 and 1,000 km.' using errcode='22023'; end if;
  begin v_max := coalesce((p_hunt->>'max_registrations')::integer,
    (select max_registrations from treasure_hunts where id = nullif(p_hunt->>'id','')::uuid), 1000);
  exception when others then raise exception 'The participant limit must be a number.' using errcode='22023'; end;
  if v_max not between 10 and 1000 then raise exception 'The participant limit must be between 10 and 1,000.' using errcode='22023'; end if;
  begin v_winners := coalesce((p_hunt->>'winners_count')::integer,
    (select winners_count from treasure_hunts where id = nullif(p_hunt->>'id','')::uuid), 10);
  exception when others then raise exception 'The number of winners must be a number.' using errcode='22023'; end;
  if v_winners not between 1 and 100 or v_winners > v_max then
    raise exception 'Choose between 1 and 100 winners (no more than the participant limit).' using errcode='22023';
  end if;
  if not (p_hunt ? 'rules') then v_rules := coalesce((select rules from treasure_hunts where id = nullif(p_hunt->>'id','')::uuid), ''); end if;
  if char_length(v_rules) > 2000 then raise exception 'Keep the hunt rules under 2,000 characters.' using errcode='22023'; end if;
  if v_state is not null and v_state <> all (dating_private.nigerian_states()) then
    raise exception 'Choose one of the 36 states or the FCT.' using errcode='22023';
  end if;
  if nullif(p_hunt->>'id','') is not null then
    select state into old_state from treasure_hunts where id = (p_hunt->>'id')::uuid;
    select count(*)::integer into registered from treasure_hunt_registrations where hunt_id = (p_hunt->>'id')::uuid;
    select count(*)::integer into joined from treasure_hunt_participants where hunt_id = (p_hunt->>'id')::uuid;
    if v_max < registered then
      raise exception '% people have already registered, so the limit can''t be lower than %.', registered, registered using errcode='42501';
    end if;
    if registered > 0 and v_state is distinct from old_state then
      raise exception 'People have registered for this hunt, so its state can''t change.' using errcode='42501';
    end if;
    if v_state is null and old_state is null and joined > 0 then v_state := null;   -- older hunt in progress: leave as is
    elsif v_state is null then raise exception 'Choose the state this hunt is in.' using errcode='22023'; end if;
  elsif v_state is null then
    raise exception 'Choose the state this hunt is in.' using errcode='22023';
  end if;
  if jsonb_typeof(p_start_points) is distinct from 'array' or jsonb_array_length(p_start_points)>10
    or jsonb_typeof(p_finish_points) is distinct from 'array' or jsonb_array_length(p_finish_points) not between 1 and 10 then
    raise exception 'Starting locations are automatic. Add one to ten final treasure locations.' using errcode='22023';
  end if;
  if v_coin not in ('🪙','💰','⭐','💎','🟡','🟠') or v_treasure not in ('🧰','🎁','🏆','💎','👑','🪙') then
    raise exception 'Choose an available coin and treasure design.' using errcode='22023';
  end if;
  hid := public.staff_treasure_hunt_save(p_hunt,p_checkpoints);
  update treasure_hunts set max_registrations = v_max, rules = v_rules,
    winners_count = case when not exists (select 1 from treasure_hunt_winner_notices n where n.hunt_id = treasure_hunts.id) then v_winners else winners_count end
  where id = hid and (max_registrations, rules, winners_count) is distinct from (v_max, v_rules, v_winners);
  select count(*)::integer into joined from treasure_hunt_participants where hunt_id=hid;
  if joined=0 then
    update treasure_hunts set state=v_state,join_radius_km=v_radius,coin_avatar=v_coin,treasure_avatar=v_treasure,updated_at=now() where id=hid;
    delete from treasure_hunt_route_points where hunt_id=hid;
    insert into treasure_hunt_route_points(hunt_id,point_kind,sequence,name,latitude,longitude,radius_m,reward_coins)
      select hid,'finish',x.sequence,btrim(x.name),x.latitude,x.longitude,coalesce(x.radius_m,60),coalesce(x.reward_coins,0)
      from jsonb_to_recordset(p_finish_points) as x(sequence integer,name text,latitude double precision,longitude double precision,radius_m integer,reward_coins integer);
    if (select count(*) from treasure_hunt_route_points where hunt_id=hid and point_kind='finish')<>jsonb_array_length(p_finish_points) then
      raise exception 'Check all treasure names and coordinates.' using errcode='22023';
    end if;
    perform dating_private.staff_log(me,'treasure_hunt_routes_saved','treasure_hunt',hid::text,
      jsonb_build_object('start_points','nearest_checkpoint','finish_points',jsonb_array_length(p_finish_points),'coin_avatar',v_coin,'treasure_avatar',v_treasure,
        'state',v_state,'join_radius_km',v_radius,'max_registrations',v_max,'winners_count',v_winners));
  end if;
  return hid;
end $$;
revoke all on function public.staff_treasure_hunt_save_routes(jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.staff_treasure_hunt_save_routes(jsonb,jsonb,jsonb,jsonb) to authenticated;

create or replace function public.staff_treasure_hunt_board(p_hunt uuid, p_limit integer default 500) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); h treasure_hunts%rowtype; total integer; take_n integer := least(2000, greatest(1, coalesce(p_limit, 500))); result jsonb;
begin
  perform dating_private.staff_need('manage');
  select * into h from treasure_hunts where id = p_hunt;
  if not found then raise exception 'That hunt no longer exists.' using errcode = 'P0002'; end if;
  select count(*)::integer into total from treasure_hunt_checkpoints where hunt_id = p_hunt;
  with people as (
    select coalesce(r.user_id, p.user_id) as user_id, r.registered_at, p.id as participant_id, p.joined_at, p.start_claimed_at,
      p.last_checkpoint_sequence, p.total_coins, p.completed_at, p.quit_at
    from (select * from treasure_hunt_registrations where hunt_id = p_hunt) r
    full join (select * from treasure_hunt_participants where hunt_id = p_hunt) p on p.user_id = r.user_id
  ), ranked as (
    select x.*, d.handle, d.gender, d.age, d.state, d.suspended, u.username,
      (select max(c.claimed_at) from treasure_hunt_claims c where c.participant_id = x.participant_id) as last_claim_at,
      row_number() over (order by (x.completed_at is null), x.completed_at, (x.quit_at is not null), coalesce(x.last_checkpoint_sequence, -1) desc,
        coalesce(x.total_coins, -1) desc, x.joined_at nulls last, x.registered_at, x.user_id) as place
    from people x
    left join dating_profiles d on d.user_id = x.user_id
    left join dating_private.usernames u on u.user_id = x.user_id
  )
  select jsonb_build_object(
    'hunt', jsonb_build_object('id', h.id, 'title', h.title, 'region', h.region, 'state', h.state, 'status', h.status,
      'starts_at', h.starts_at, 'ends_at', h.ends_at, 'checkpoint_count', total, 'winners_count', h.winners_count, 'winners_done', dating_private.treasure_hunt_winners_done(h.id),
      'running', h.status in ('scheduled', 'active') and h.starts_at <= now() and h.ends_at > now(),
      'ended', h.status = 'completed' or h.ends_at <= now()),
    'registered', (select count(*) from ranked),
    'started', (select count(*) from ranked where participant_id is not null),
    'finished', (select count(*) from ranked where completed_at is not null),
    'people', coalesce((select jsonb_agg(jsonb_build_object(
      'place', place, 'handle', handle, 'username', username, 'gender', gender, 'age', age, 'state', state, 'suspended', coalesce(suspended, false),
      'registered_at', registered_at, 'started_at', joined_at, 'checkpoints', coalesce(last_checkpoint_sequence, 0),
      'coins', coalesce(total_coins, 0), 'last_claim_at', last_claim_at, 'finished_at', completed_at, 'quit_at', quit_at,
      'winner', completed_at is not null and place <= h.winners_count,
      'took_seconds', case when completed_at is not null then floor(extract(epoch from completed_at - greatest(joined_at, h.starts_at)))::integer end
    ) order by place) from (select * from ranked order by place limit take_n) t), '[]'::jsonb)
  ) into result;
  perform dating_private.staff_log(me, 'treasure_hunt_board_viewed', 'treasure_hunt', p_hunt::text,
    jsonb_build_object('registered', result->'registered'));
  return result;
end $$;
revoke all on function public.staff_treasure_hunt_board(uuid, integer) from public, anon;
grant execute on function public.staff_treasure_hunt_board(uuid, integer) to authenticated;
