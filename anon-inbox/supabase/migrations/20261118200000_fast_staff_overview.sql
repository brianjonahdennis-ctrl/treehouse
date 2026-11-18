-- The admin console's Overview page (admin.treehouse.ng) always timed out (18 Nov 2026).
-- staff_dashboard took about 23 seconds on live; staff calls are cut off after 8 seconds.
-- The biggest cost was "chat messages today": it counted ~850,000 of today's rows in
-- dating_messages one by one (20-50 seconds alone), because there's no index on created_at.
-- The rest came from the old owner-stats functions, which also work out many figures the
-- Overview never shows (mutual reveals, locations, people chatting, totals...).
--
-- Now:
--   * chat messages today come from the running message counters (stat_messages_by_day),
--     the same numbers the Overview's daily chart already uses;
--   * all member counts come from one pass over dating_profiles instead of nine;
--   * the dating / apps / photos / ratings parts work out only what the Overview shows,
--     with the same queries as before (people per app counted with a hash, not a sort);
--   * two small indexes make "photos sent today" and "room messages today" instant.
-- Same numbers on the page, same permission check (staff_need('view')), same response shape
-- for everything the page reads.
--
-- On live, create the two indexes FIRST with CREATE INDEX CONCURRENTLY (no locking; the
-- photo one reads the 2.3 GB messages table, about a minute), then apply this file; here
-- they're then a no-op:
--   create index concurrently if not exists dating_messages_photo_time on public.dating_messages (created_at) where photo is not null;
--   create index concurrently if not exists room_messages_created on public.room_messages (created_at);
create index if not exists dating_messages_photo_time on public.dating_messages (created_at) where photo is not null;
create index if not exists room_messages_created on public.room_messages (created_at);

create or replace function public.staff_dashboard(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  d int := least(greatest(coalesce(p_days, 7), 1), 90);
  today date := lagos_today();
  since date := today - (d - 1);
  day_start timestamptz := (today::timestamp at time zone 'Africa/Lagos');
  p record;
  out jsonb;
  part jsonb;
begin
  perform staff_need('view');

  select count(*) as profiles,
         count(*) filter (where last_seen_at > now() - interval '5 minutes') as online_now,
         count(*) filter (where last_seen_at > now() - interval '1 day') as active_1d,
         count(*) filter (where last_seen_at > now() - interval '7 days') as active_7d,
         count(*) filter (where last_seen_at > now() - interval '30 days') as active_30d,
         count(*) filter (where (created_at at time zone 'Africa/Lagos')::date = today) as new_today,
         count(*) filter (where suspended) as suspended,
         count(*) filter (where dob_underage_at is not null) as underage_marked
    into p from dating_profiles;

  select jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'profiles', p.profiles,
    'online_now', p.online_now,
    'active_1d', p.active_1d,
    'active_7d', p.active_7d,
    'active_30d', p.active_30d,
    'new_today', p.new_today,
    'suspended', p.suspended,
    'underage_marked', p.underage_marked,
    'room_bans', (select count(*) from room_bans where until > now()),
    'chat_messages_today', (select coalesce(sum(messages), 0) from stat_messages_by_day where day = today),
    'room_messages_today', (select count(*) from room_messages where created_at >= day_start),
    'in_rooms_now', (select count(*) from room_members where last_seen_at > now() - interval '2 minutes'),
    'open_reports', jsonb_build_object(
      'chat', (select count(*) from dating_reports where status = 'open'),
      'room', (select count(distinct message_id) from room_reports where status = 'open'),
      'link', (select count(*) from link_reports where status = 'open')),
    'signups', coalesce((select jsonb_agg(jsonb_build_object('day', g.day, 'profiles', coalesce(c.n, 0)) order by g.day)
      from generate_series(since, today, interval '1 day') as g(day)
      left join (select (created_at at time zone 'Africa/Lagos')::date as day, count(*) as n from dating_profiles
                 where created_at > now() - make_interval(days => d + 1) group by 1) c on c.day = g.day::date), '[]'::jsonb),
    'gender', (select coalesce(jsonb_object_agg(g, n), '{}'::jsonb) from (select gender::text as g, count(*) as n from dating_profiles group by 1) x),
    'top_states', (select coalesce(jsonb_agg(jsonb_build_object('state', state, 'people', n) order by n desc), '[]'::jsonb)
      from (select coalesce(nullif(state, ''), 'Unknown') as state, count(*) as n from dating_profiles group by 1 order by 2 desc limit 10) x),
    'ads', jsonb_build_object(
      'active', (select count(*) from ads where status = 'active' and (ends_at is null or ends_at > now())),
      'views_today', (select coalesce(sum(views), 0) from ad_daily where day = today),
      'taps_today', (select coalesce(sum(taps), 0) from ad_daily where day = today)),
    'referrals', jsonb_build_object(
      'joined_today', (select count(*) from referrals where (claimed_at at time zone 'Africa/Lagos')::date = today),
      'joined_period', (select count(*) from referrals where claimed_at > now() - make_interval(days => d))),
    -- New accounts, profiles, chats and messages per day: from the running counters (as admin_dating_stats).
    'dating', jsonb_build_object(
      'inRange', jsonb_build_object(
        'accounts',      (select coalesce(sum(accounts), 0) from stat_days where day >= since),
        'profiles',      (select coalesce(sum(profiles), 0) from stat_days where day >= since),
        'conversations', (select coalesce(sum(conversations), 0) from stat_days where day >= since),
        'messages',      (select coalesce(sum(messages), 0) from stat_messages_by_day where day >= since)),
      'daily', (select jsonb_agg(jsonb_build_object(
          'date', g.day::date,
          'accounts', coalesce(s.accounts, 0), 'profiles', coalesce(s.profiles, 0),
          'conversations', coalesce(s.conversations, 0), 'messages', coalesce(m.messages, 0)) order by g.day)
        from generate_series(since, today, interval '1 day') as g(day)
        left join stat_days s on s.day = g.day::date
        left join stat_messages_by_day m on m.day = g.day::date)),
    -- People who opened each app in the period (as admin_platform_stats).
    'platforms', jsonb_build_object('people', coalesce((select jsonb_object_agg(platform, n) from (
        select platform, count(*) as n from (select distinct platform, user_id from app_seen_days where day >= since) u
        group by platform) x), '{}'::jsonb)),
    -- Chat photos (as admin_photo_stats).
    'photos', jsonb_build_object(
      'stored', (select count(*) from storage.objects where bucket_id = 'chat-photos'),
      'storedMB', (select round(coalesce(sum((metadata ->> 'size')::bigint), 0) / 1048576.0, 1) from storage.objects where bucket_id = 'chat-photos'),
      'sentToday', (select count(*) from dating_messages where photo is not null and created_at >= day_start)),
    -- Star ratings (as admin_reputation_stats).
    'reputation', jsonb_build_object(
      'needs_review', (select count(*) from reputation where band = 'review'),
      'ratings_24h', (select count(*) from star_ratings where created_at > now() - interval '24 hours'))
  ) into out;

  -- These two are small and quick; reuse them as before.
  perform staff_admin_on();
  begin part := admin_deletion_stats(null, d); out := out || jsonb_build_object('deletions', part); exception when others then null; end;
  begin part := admin_speed_stats(null, d); out := out || jsonb_build_object('speed', part); exception when others then null; end;
  perform staff_admin_off();
  return out || jsonb_build_object('days', d, 'at', now());
end $$;

revoke all on function public.staff_dashboard(int) from public, anon;
grant execute on function public.staff_dashboard(int) to authenticated;
