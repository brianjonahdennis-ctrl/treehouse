-- Bird Kingdom: star levels earned only by accumulated active hours (see web-next/REPUTATION.md).
-- Separate from ratings, likes, friends, blocks and reports. Levels never go down.
-- Undo: drop table dating_private.bird_kingdom, dating_private.bird_import_log and the functions below.

set lock_timeout = '5s';

create table dating_private.bird_kingdom (
  user_id uuid primary key references auth.users(id) on delete cascade,
  historical_seconds bigint not null default 0 check (historical_seconds >= 0),
  post_launch_seconds bigint not null default 0 check (post_launch_seconds >= 0),
  level smallint not null default 1 check (level between 1 and 8),
  migration_status text not null default 'post_launch'
    check (migration_status in ('pending', 'migrated', 'no_activity_data', 'suspicious', 'post_launch')),
  migration_source text,
  migrated_at timestamptz,
  launch_level smallint,                 -- level awarded from history (for the one-time "recognised" card)
  launch_seen_at timestamptz,
  last_ping_at timestamptz,
  day date,                              -- Lagos day of day_seconds
  day_seconds integer not null default 0,
  leveled_at timestamptz,                -- last time the level went up (in-app notification)
  created_at timestamptz not null default now()
);
alter table dating_private.bird_kingdom enable row level security;
revoke all on dating_private.bird_kingdom from public, anon, authenticated;

create table dating_private.bird_import_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  note text not null
);
revoke all on dating_private.bird_import_log from public, anon, authenticated;

-- The moment Bird Kingdom launched: history is what happened before it, live tracking after it.
create table dating_private.bird_launch (id int primary key default 1 check (id = 1), at timestamptz not null default now());
insert into dating_private.bird_launch default values;
revoke all on dating_private.bird_launch from public, anon, authenticated;

-- People who joined before launch wait for the history import ('pending'); later sign-ups start fresh.
create or replace function dating_private.bird_start_status(p_user uuid) returns text
language sql stable security definer set search_path = public, dating_private as $$
  select case when (select created_at from auth.users where id = p_user) < (select at from bird_launch)
              then 'pending' else 'post_launch' end $$;

create or replace function dating_private.bird_level_for(p_seconds bigint) returns smallint
language sql immutable as $$
  select (case
    when p_seconds >= 1000 * 3600 then 8 when p_seconds >= 500 * 3600 then 7
    when p_seconds >= 250 * 3600 then 6 when p_seconds >= 100 * 3600 then 5
    when p_seconds >= 50 * 3600 then 4 when p_seconds >= 20 * 3600 then 3
    when p_seconds >= 5 * 3600 then 2 else 1 end)::smallint $$;

create or replace function dating_private.bird_view(b dating_private.bird_kingdom) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'level', b.level,
    'seconds', b.historical_seconds + b.post_launch_seconds,
    'historical_seconds', b.historical_seconds,
    'launch_level', case when b.launch_seen_at is null and coalesce(b.launch_level, 1) >= 2 then b.launch_level end,
    'leveled_at', b.leveled_at,
    'now', now()) $$;

-- The app calls this once a minute while the person is actually using treehouse.
-- Time comes from the server clock: at most 60 s per ping, nothing after a gap over 90 s.
create or replace function public.activity_ping() returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  b bird_kingdom%rowtype;
  today date := (now() at time zone 'Africa/Lagos')::date;
  add_s integer := 0;
  new_level smallint;
  up boolean := false;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  insert into bird_kingdom (user_id, migration_status) values (me, bird_start_status(me)) on conflict (user_id) do nothing;
  select * into b from bird_kingdom where user_id = me for update;
  if b.last_ping_at is not null and b.last_ping_at > now() - interval '90 seconds' then
    add_s := least(greatest(floor(extract(epoch from now() - b.last_ping_at))::integer, 0), 60);
  end if;
  if b.day is distinct from today then b.day := today; b.day_seconds := 0; end if;
  add_s := least(add_s, greatest(16 * 3600 - b.day_seconds, 0));
  new_level := greatest(b.level, bird_level_for(b.historical_seconds + b.post_launch_seconds + add_s));
  up := new_level > b.level;
  update bird_kingdom set
    post_launch_seconds = post_launch_seconds + add_s,
    day = b.day, day_seconds = b.day_seconds + add_s,
    last_ping_at = now(),
    level = new_level,
    leveled_at = case when up then now() else leveled_at end
  where user_id = me
  returning * into b;
  return bird_view(b) || jsonb_build_object('leveled_up', up, 'added', add_s);
end $$;

create or replace function public.my_bird() returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); b bird_kingdom%rowtype;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  insert into bird_kingdom (user_id, migration_status) values (me, bird_start_status(me)) on conflict (user_id) do nothing;
  select * into b from bird_kingdom where user_id = me;
  return bird_view(b);
end $$;

create or replace function public.bird_launch_seen() returns void
language sql security definer set search_path = public, dating_private as $$
  update bird_kingdom set launch_seen_at = now() where user_id = auth.uid() and launch_seen_at is null $$;

revoke execute on function public.activity_ping(), public.my_bird(), public.bird_launch_seen() from public, anon;
grant execute on function public.activity_ping(), public.my_bird(), public.bird_launch_seen() to authenticated;

-- One-time history import (idempotent: only rows still 'pending' are filled; see REPUTATION.md).
create or replace function dating_private.bird_import_history() returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare done integer; begin
  -- Everyone who existed before launch gets a pending row (new sign-ups later start as 'post_launch').
  insert into bird_kingdom (user_id, migration_status)
  select u.id, 'pending' from auth.users u where u.created_at < (select at from bird_launch) on conflict (user_id) do nothing;

  drop table if exists bird_hist;
  create temp table bird_hist on commit drop as
  with sent as (
    select user_id u, created_at t from room_messages where created_at < (select at from bird_launch)
    union all
    select sender_id, created_at from dating_messages where created_at < (select at from bird_launch)
  ),
  gaps as (
    select u, t, case when t - lag(t) over (partition by u order by t) > interval '10 minutes'
                        or lag(t) over (partition by u order by t) is null then 1 else 0 end as starts
    from sent
  ),
  sess as (
    select u, t, sum(starts) over (partition by u order by t rows unbounded preceding) as sid from gaps
  ),
  per_session as (
    select u, sid, min(t) s, max(t) e, count(*) n from sess group by u, sid
  ),
  per_day as (
    select u, (s at time zone 'Africa/Lagos')::date d,
           sum(extract(epoch from e - s) + 120) secs, sum(n) msgs,
           max(n / greatest(extract(epoch from e - s) / 60, 1)) peak_per_min
    from per_session group by 1, 2
  ),
  speed as (
    select x.u, (x.started_at at time zone 'Africa/Lagos')::date d,
           sum(extract(epoch from least(coalesce(x.ended_at, x.ends_at), x.ends_at) - x.started_at)) secs
    from (select user_a u, started_at, ended_at, ends_at from speed_sessions where started_at < (select at from bird_launch)
          union all select user_b, started_at, ended_at, ends_at from speed_sessions where started_at < (select at from bird_launch)) x
    group by 1, 2
  ),
  days as (
    select coalesce(a.u, sp.u) u, coalesce(a.d, sp.d) d,
           least(coalesce(a.secs, 0) + coalesce(sp.secs, 0), 16 * 3600) secs,
           coalesce(a.msgs, 0) msgs, coalesce(a.peak_per_min, 0) peak
    from per_day a full join speed sp on sp.u = a.u and sp.d = a.d
  )
  select u, floor(sum(secs))::bigint secs, sum(msgs) msgs, max(peak) peak, max(msgs) max_day_msgs
  from days group by u;

  update bird_kingdom b set
    historical_seconds = h.secs,
    level = greatest(b.level, bird_level_for(h.secs + b.post_launch_seconds)),
    launch_level = bird_level_for(h.secs),
    migration_status = case when h.peak > 40 or h.max_day_msgs > 3000 then 'suspicious' else 'migrated' end,
    migration_source = 'messages+speed_dates sessionised (10 min gap, +2 min per session, 16 h/day cap)',
    migrated_at = now()
  from bird_hist h
  where b.user_id = h.u and b.migration_status = 'pending';

  update bird_kingdom set migration_status = 'no_activity_data', migration_source = 'no recorded activity',
    migrated_at = now(), launch_level = 1
  where migration_status = 'pending';
  get diagnostics done = row_count;

  insert into bird_import_log (note) values ('history import run; ' || done || ' without activity data');
  return dating_private.bird_import_report();
exception when others then
  insert into bird_import_log (note) values ('history import FAILED: ' || sqlerrm);
  raise;
end $$;

-- Internal report (counts only).
create or replace function dating_private.bird_import_report() returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select jsonb_build_object(
    'processed', (select count(*) from bird_kingdom where migration_status <> 'post_launch'),
    'by_level', (select jsonb_object_agg(level, n) from (select level, count(*) n from bird_kingdom
                  where migration_status <> 'post_launch' group by level) x),
    'no_activity_data', (select count(*) from bird_kingdom where migration_status = 'no_activity_data'),
    'suspicious', (select count(*) from bird_kingdom where migration_status = 'suspicious'),
    'still_pending', (select count(*) from bird_kingdom where migration_status = 'pending'),
    'historical_hours', (select round(sum(historical_seconds) / 3600.0) from bird_kingdom),
    'failures', (select count(*) from bird_import_log where note like '%FAILED%')) $$;

create or replace function public.admin_bird_report(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  if not admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return bird_import_report() || jsonb_build_object('total_users', (select count(*) from bird_kingdom),
    'all_by_level', (select jsonb_object_agg(level, n) from (select level, count(*) n from bird_kingdom group by level) x));
end $$;
revoke all on function public.admin_bird_report(text) from public, authenticated;
grant execute on function public.admin_bird_report(text) to anon;
revoke all on function dating_private.bird_import_history(), dating_private.bird_import_report() from public, anon, authenticated;
