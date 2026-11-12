-- Which kind of treehouse people use, per day, so the owner can see Google Play test activity:
--   android-play  the Android app installed from Google Play (closed test / later production)
--   android-apk   the Android app installed from the APK on treehouse.ng
--   android-app   an older Android app (1.4 or earlier) that can't say where it was installed from
--   ios-app       the iPhone app
--   web           a browser
-- One row per person per kind per day (Lagos time), written by the "I'm here" ping the app already
-- sends every few minutes. Only counts leave the database (through the owner's admin key).

set lock_timeout = '5s';

create table if not exists public.app_seen_days (
  day      date not null,
  platform text not null check (platform in ('android-play', 'android-apk', 'android-app', 'ios-app', 'web')),
  user_id  uuid not null references auth.users(id) on delete cascade,
  primary key (day, platform, user_id)
);
alter table public.app_seen_days enable row level security;
revoke all on public.app_seen_days from anon, authenticated;

-- The ping now says which kind of app it comes from (older apps send nothing; that's fine).
drop function if exists public.touch_last_seen();
create function public.touch_last_seen(p_platform text default null) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  update dating_profiles set last_seen_at = now()
  where user_id = auth.uid()
    and (last_seen_at is null or last_seen_at < now() - interval '1 minute');
  update room_members set last_seen_at = now()
  where user_id = auth.uid() and room_active(last_seen_at) and last_seen_at < now() - interval '1 minute';
  if auth.uid() is not null and p_platform in ('android-play', 'android-apk', 'android-app', 'ios-app', 'web') then
    insert into app_seen_days (day, platform, user_id)
    values ((now() at time zone 'Africa/Lagos')::date, p_platform, auth.uid())
    on conflict do nothing;
  end if;
end $$;
revoke all on function public.touch_last_seen(text) from public, anon;
grant execute on function public.touch_last_seen(text) to authenticated;

-- Owner stats: people per app kind in the period, and Play testers per day.
create or replace function public.admin_platform_stats(p_key text, p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  days int := least(greatest(coalesce(p_days, 7), 1), 400);
  since date := (now() at time zone 'Africa/Lagos')::date - (days - 1);
begin
  if not dating_private.admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'range', days,
    'people', coalesce((select jsonb_object_agg(platform, n) from (
        select platform, count(distinct user_id) as n from app_seen_days where day >= since group by platform) x), '{}'::jsonb),
    'playAllTime', (select count(distinct user_id) from app_seen_days where platform = 'android-play'),
    'playFirstDay', (select min(day) from app_seen_days where platform = 'android-play'),
    'playDaily', (select coalesce(jsonb_agg(jsonb_build_object('date', d.day, 'people', coalesce(c.n, 0)) order by d.day), '[]'::jsonb)
        from generate_series(since, (now() at time zone 'Africa/Lagos')::date, interval '1 day') as d(day)
        left join (select day, count(*) as n from app_seen_days where platform = 'android-play' and day >= since group by day) c on c.day = d.day::date)
  );
end $$;
-- Called by the server with the public key, like admin_dating_stats; the admin key check above protects it.
revoke all on function public.admin_platform_stats(text, integer) from public;
grant execute on function public.admin_platform_stats(text, integer) to anon, service_role;
