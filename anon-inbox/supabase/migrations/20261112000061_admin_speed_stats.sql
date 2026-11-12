-- Owner's Stats → Dating: Speed Dating numbers (counts only, nobody identified).

set lock_timeout = '5s';

create or replace function public.admin_speed_stats(p_key text, p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  days int := least(greatest(coalesce(p_days, 7), 1), 400);
  tz text := 'Africa/Lagos';
  since date := (now() at time zone tz)::date - (days - 1);
  since_ts timestamptz := (since::timestamp at time zone tz);
begin
  if not admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return (
    with s as (select * from speed_sessions where created_at >= since_ts),
    allt as (select * from speed_sessions)
    select jsonb_build_object(
      'inRange', jsonb_build_object(
        'pairings', (select count(*) from s),
        'connected', (select count(*) from s where started_at is not null),
        'fullFive', (select count(*) from s where end_reason = 'time'),
        'matches', (select count(*) from s where matched_at is not null),
        'avgMinutes', (select round(avg(extract(epoch from (least(coalesce(ended_at, now()), ends_at) - started_at)) / 60)::numeric, 1) from s where started_at is not null),
        'daters', (select count(distinct u) from (select user_a u from s where started_at is not null union select user_b from s where started_at is not null) x),
        'reports', (select count(*) from dating_reports where created_at >= since_ts and details like '[Speed Dating%'),
        'blocked', (select count(*) from s where end_reason = 'blocked')),
      'totals', jsonb_build_object(
        'connected', (select count(*) from allt where started_at is not null),
        'matches', (select count(*) from allt where matched_at is not null),
        'daters', (select count(distinct u) from (select user_a u from allt where started_at is not null union select user_b from allt where started_at is not null) x)),
      'now', jsonb_build_object(
        'waiting', (select count(*) from speed_queue where seen_at > now() - interval '20 seconds'),
        'onDates', (select count(*) from speed_active)),
      'daily', (
        select jsonb_agg(jsonb_build_object('date', d.day::date,
          'dates', coalesce(x.dates, 0), 'matches', coalesce(x.matches, 0)) order by d.day)
        from generate_series(since, (now() at time zone tz)::date, interval '1 day') as d(day)
        left join (
          select (started_at at time zone tz)::date as day, count(*) as dates, count(matched_at) as matches
          from speed_sessions where started_at >= since_ts group by 1) x on x.day = d.day::date)
    ));
end $$;
revoke all on function public.admin_speed_stats(text, integer) from public, authenticated;
grant execute on function public.admin_speed_stats(text, integer) to anon;

-- Also: the deleted-accounts chart sent dates with a time attached, which the Stats page can't read.
create or replace function public.admin_deletion_stats(p_key text, p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  days int := least(greatest(coalesce(p_days, 7), 1), 400);
  tz text := 'Africa/Lagos';
  since date := (now() at time zone tz)::date - (days - 1);
begin
  if not admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'total', (select count(*) from account_deletions),
    'inRange', (select count(*) from account_deletions where (at at time zone tz)::date >= since),
    'withProfile', (select count(*) from account_deletions where had_profile and (at at time zone tz)::date >= since),
    'since', (select min(at) from account_deletions),
    'daily', (
      select jsonb_agg(jsonb_build_object('date', d.day::date, 'deleted', coalesce(x.n, 0)) order by d.day)
      from generate_series(since, (now() at time zone tz)::date, interval '1 day') as d(day)
      left join (select (at at time zone tz)::date as day, count(*) n from account_deletions group by 1) x on x.day = d.day::date));
end $$;
