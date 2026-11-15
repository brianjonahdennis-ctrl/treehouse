-- Owner's Stats (counts only, nobody identified): Games (Kickrs) and Chatroom bans.

set lock_timeout = '5s';

-- Game challenges are chat messages with a /home/games/<game>?join=CODE link. To keep counting them
-- cheap, a partial index is built separately WITHOUT locking the messages table:
--   create index concurrently if not exists dating_messages_game_challenges on public.dating_messages (created_at)
--     where body like '%/home/games/%?join=%';

create or replace function public.admin_game_stats(p_key text, p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  days int := least(greatest(coalesce(p_days, 7), 1), 400);
  tz text := 'Africa/Lagos';
  since date := (now() at time zone tz)::date - (days - 1);
  since_ts timestamptz := (since::timestamp at time zone tz);
begin
  if not admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return (
    with ch as (
      select created_at, sender_id, substring(body from '/home/games/([a-z0-9-]+)\?join=') game
      from dating_messages
      where body like '%/home/games/%?join=%' and created_at >= since_ts and deleted_at is null)
    select jsonb_build_object(
      'connected', (select count(*) from kickrs_links where revoked_at is null),
      'connectedInRange', (select count(*) from kickrs_links where connected_at >= since_ts),
      'disconnected', (select count(*) from kickrs_links where revoked_at is not null),
      'challenges', (select count(*) from ch),
      'challengers', (select count(distinct sender_id) from ch),
      'challengesAllTime', (select count(*) from dating_messages where body like '%/home/games/%?join=%' and deleted_at is null),
      'byGame', coalesce((select jsonb_object_agg(game, n) from (select game, count(*) n from ch where game is not null group by game) g), '{}'::jsonb),
      'daily', (
        select jsonb_agg(jsonb_build_object('date', d.day::date, 'challenges', coalesce(x.n, 0), 'connected', coalesce(k.n, 0)) order by d.day)
        from generate_series(since, (now() at time zone tz)::date, interval '1 day') as d(day)
        left join (select (created_at at time zone tz)::date as day, count(*) n from ch group by 1) x on x.day = d.day::date
        left join (select (connected_at at time zone tz)::date as day, count(*) n from kickrs_links where connected_at >= since_ts group by 1) k on k.day = d.day::date)));
end $$;

create or replace function public.admin_room_ban_stats(p_key text, p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  days int := least(greatest(coalesce(p_days, 7), 1), 400);
  tz text := 'Africa/Lagos';
  since date := (now() at time zone tz)::date - (days - 1);
  since_ts timestamptz := (since::timestamp at time zone tz);
begin
  if not admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'activeNow', (select count(*) from room_bans where until > now()),
    'activeLink', (select count(*) from room_bans where until > now() and reason like '%links%'),
    'activeRepeat', (select count(*) from room_bans where until > now() and reason like '%repeatedly%'),
    'inRange', (select count(*) from room_ban_log where at >= since_ts),
    'linkInRange', (select count(*) from room_ban_log where at >= since_ts and kind = 'link'),
    'repeatInRange', (select count(*) from room_ban_log where at >= since_ts and kind = 'repeat'),
    'peopleInRange', (select count(distinct user_id) from room_ban_log where at >= since_ts),
    'allTime', (select count(*) from room_ban_log),
    'suspendedKeptOut', (select count(*) from dating_profiles where suspended and dob_underage_at is null),
    'daily', (
      select jsonb_agg(jsonb_build_object('date', d.day::date, 'link', coalesce(x.link, 0), 'repeat', coalesce(x.rep, 0)) order by d.day)
      from generate_series(since, (now() at time zone tz)::date, interval '1 day') as d(day)
      left join (select (at at time zone tz)::date as day, count(*) filter (where kind = 'link') link, count(*) filter (where kind = 'repeat') rep
                 from room_ban_log where at >= since_ts group by 1) x on x.day = d.day::date));
end $$;

revoke all on function public.admin_game_stats(text, integer), public.admin_room_ban_stats(text, integer) from public, authenticated;
grant execute on function public.admin_game_stats(text, integer), public.admin_room_ban_stats(text, integer) to anon;
