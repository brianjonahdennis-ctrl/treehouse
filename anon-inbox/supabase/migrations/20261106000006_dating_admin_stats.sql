-- Totals for the owner's Stats tab. Counts only: never names, emails, handles or ids.
-- Days follow Lagos time to match the rest of the dashboard.
create function public.admin_dating_stats(p_key text, p_days int default 7)
returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  days int := least(greatest(coalesce(p_days, 7), 1), 400);
  tz text := 'Africa/Lagos';
  since date := (now() at time zone tz)::date - (days - 1);
  result jsonb;
begin
  if not dating_private.admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;

  with
  d as (select generate_series(since, (now() at time zone tz)::date, interval '1 day')::date as day),
  acc as (select (created_at at time zone tz)::date as day, count(*) n from auth.users group by 1),
  prof as (select (created_at at time zone tz)::date as day, count(*) n from dating_profiles group by 1),
  conv as (select (created_at at time zone tz)::date as day, count(*) n from dating_conversations group by 1),
  msg as (select (created_at at time zone tz)::date as day, count(*) n from dating_messages group by 1),
  mutual as (
    select c.id, max(r.created_at) as at
    from dating_conversations c join dating_reveals r on r.conversation_id = c.id
    group by c.id having count(distinct r.user_id) = 2
  )
  select jsonb_build_object(
    'range', days,
    'totals', jsonb_build_object(
      'accounts',       (select count(*) from auth.users),
      'verified',       (select count(*) from auth.users where email_confirmed_at is not null),
      'profiles',       (select count(*) from dating_profiles),
      'active',         (select count(*) from dating_profiles where is_active and not suspended),
      'paused',         (select count(*) from dating_profiles where not is_active and not suspended),
      'suspended',      (select count(*) from dating_profiles where suspended),
      'conversations',  (select count(*) from dating_conversations),
      'messages',       (select count(*) from dating_messages),
      'mutualReveals',  (select count(*) from mutual),
      'blocks',         (select count(*) from dating_blocks),
      'reportsOpen',    (select count(*) from dating_reports where status = 'open'),
      'reports',        (select count(*) from dating_reports),
      'chattingPeople', (select count(distinct sender_id) from dating_messages)
    ),
    'inRange', jsonb_build_object(
      'accounts',      (select count(*) from auth.users where (created_at at time zone tz)::date >= since),
      'profiles',      (select count(*) from dating_profiles where (created_at at time zone tz)::date >= since),
      'conversations', (select count(*) from dating_conversations where (created_at at time zone tz)::date >= since),
      'messages',      (select count(*) from dating_messages where (created_at at time zone tz)::date >= since),
      'mutualReveals', (select count(*) from mutual where (at at time zone tz)::date >= since),
      'chattingPeople',(select count(distinct sender_id) from dating_messages where (created_at at time zone tz)::date >= since)
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'date', d.day,
        'accounts', coalesce(acc.n, 0), 'profiles', coalesce(prof.n, 0),
        'conversations', coalesce(conv.n, 0), 'messages', coalesce(msg.n, 0)
      ) order by d.day)
      from d
      left join acc on acc.day = d.day left join prof on prof.day = d.day
      left join conv on conv.day = d.day left join msg on msg.day = d.day
    ),
    'gender', (select coalesce(jsonb_agg(jsonb_build_object('name', g, 'count', n) order by n desc), '[]')
               from (select gender::text g, count(*) n from dating_profiles where not suspended group by 1) x),
    'intent', (select coalesce(jsonb_agg(jsonb_build_object('name', i, 'count', n) order by n desc), '[]')
               from (select intent::text i, count(*) n from dating_profiles where not suspended group by 1) x),
    'ages', (select coalesce(jsonb_agg(jsonb_build_object('name', band, 'count', n) order by band), '[]')
             from (select case when age < 25 then '18–24' when age < 30 then '25–29' when age < 35 then '30–34'
                               when age < 45 then '35–44' else '45+' end as band, count(*) n
                   from dating_profiles where not suspended group by 1) x),
    -- Locations are free text: group ignoring case and spaces, show the most common spelling.
    'locations', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', n) order by n desc), '[]')
                  from (select mode() within group (order by btrim(location)) as name, count(*) n
                        from dating_profiles where not suspended and btrim(location) <> ''
                        group by lower(regexp_replace(btrim(location), '\s+', ' ', 'g'))
                        order by n desc limit 8) x)
  ) into result;
  return result;
end $$;

revoke execute on function public.admin_dating_stats(text, int) from public;
grant execute on function public.admin_dating_stats(text, int) to anon, authenticated;
