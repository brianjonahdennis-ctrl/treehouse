-- Speed Dating: camera off = banned (Hydra, 15 Nov 2026). Warned once, up front, before starting.
-- * While connected to a date, if your camera goes off (switched off/blocked, or covered for ~6 s), the
--   date ends and you're banned from Speed Dating for 24 hours, straight away. No in-date warning.
-- * Backup: the other person's app reports when your video goes dark. Reports from 2 different people
--   within 7 days = the same 24-hour ban (a tampered app can't skip it).
-- * Leaving the app mid-date (a call, switching apps) ends the date without a ban.
-- The ban shows through speed_quota (reason 'camera'), with the existing countdown.

set lock_timeout = '5s';

create table if not exists dating_private.speed_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  until timestamptz not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create table if not exists dating_private.speed_camera_reports (
  session_id uuid not null references public.speed_sessions(id) on delete cascade,
  reporter uuid not null references auth.users(id) on delete cascade,
  reported uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (session_id, reporter)
);
create index if not exists speed_camera_reports_reported on dating_private.speed_camera_reports (reported, at);
revoke all on dating_private.speed_bans, dating_private.speed_camera_reports from public, anon, authenticated;

create or replace function dating_private.speed_ban(p_user uuid, p_reason text) returns void
language sql security definer set search_path = public, dating_private as $$
  insert into speed_bans (user_id, until, reason) values (p_user, now() + interval '24 hours', p_reason)
  on conflict (user_id) do update set until = greatest(speed_bans.until, excluded.until), reason = excluded.reason, created_at = now() $$;
revoke all on function dating_private.speed_ban(uuid, text) from public, anon, authenticated;

-- Same as before, plus the camera ban (which wins when it lasts longest).
create or replace function dating_private.speed_quota_for(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  with recent as (
    select started_at from speed_sessions
    where (user_a = p_user or user_b = p_user) and started_at > now() - interval '24 hours'
    order by started_at desc
  ), lim as (select speed_daily_limit(p_user) as n),
  lim_until as (
    select case when (select count(*) from recent) >= (select n from lim)
      then (select started_at from recent offset (select n from lim) - 1 limit 1) + interval '24 hours' end as at),
  last_match as (
    select s.matched_at, s.conversation_id from speed_sessions s
    where (s.user_a = p_user or s.user_b = p_user) and s.matched_at > now() - speed_match_break(p_user)
    order by s.matched_at desc limit 1),
  match_until as (select (select matched_at from last_match) + speed_match_break(p_user) as at),
  ban as (select until as at, reason from speed_bans where user_id = p_user and until > now()),
  latest as (select greatest(coalesce((select at from lim_until), '-infinity'), coalesce((select at from match_until), '-infinity'),
                             coalesce((select at from ban), '-infinity')) as at)
  select jsonb_build_object(
    'limit', (select n from lim),
    'used', (select count(*) from recent),
    'left', greatest((select n from lim) - (select count(*) from recent), 0),
    'available_at', nullif((select at from latest), '-infinity'),
    'reason', case
      when (select at from ban) is not null and (select at from ban) >= (select at from latest) then 'camera'
      when (select at from match_until) is not null and (select at from match_until) >= coalesce((select at from lim_until), '-infinity') then 'match'
      when (select at from lim_until) is not null then 'limit' end,
    'ban_reason', (select reason from ban),
    'match_conversation', (select conversation_id from last_match),
    'now', now());
$$;

-- My own app saw my camera go off while connected: end the date and ban me for 24 hours.
create or replace function public.speed_camera_off(p_session uuid) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); s speed_sessions%rowtype;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into s from speed_sessions where id = p_session and me in (user_a, user_b);
  if not found then raise exception 'Date not found.' using errcode = 'P0002'; end if;
  if s.started_at is not null then
    perform speed_ban(me, 'Your camera went off while you were connected to a speed date. Speed Dating is video only, so it''s closed for you for 24 hours.');
  end if;
  begin perform speed_end(p_session); exception when others then null; end;
  return speed_quota_for(me);
end $$;

-- The other person's app saw this person's video go dark while connected. 2 different reporters in
-- 7 days = 24-hour ban.
create or replace function public.speed_report_camera(p_session uuid) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); s speed_sessions%rowtype; other uuid;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into s from speed_sessions where id = p_session and me in (user_a, user_b);
  if not found or s.started_at is null then return; end if;
  other := case when s.user_a = me then s.user_b else s.user_a end;
  insert into speed_camera_reports (session_id, reporter, reported) values (p_session, me, other) on conflict do nothing;
  if (select count(distinct reporter) from speed_camera_reports where reported = other and at > now() - interval '7 days') >= 2 then
    perform speed_ban(other, 'Your camera was off during speed dates. Speed Dating is video only, so it''s closed for you for 24 hours.');
  end if;
end $$;

revoke execute on function public.speed_camera_off(uuid), public.speed_report_camera(uuid) from public, anon;
grant execute on function public.speed_camera_off(uuid), public.speed_report_camera(uuid) to authenticated;
