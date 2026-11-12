-- Owner stats were recounting every message (316k+) on each view and timed out. Keep running daily
-- totals instead, updated as rows are created, and read those. Counts only, as before.

create table dating_private.stat_days (
  day           date primary key,
  accounts      int not null default 0,
  profiles      int not null default 0,
  conversations int not null default 0,
  messages      int not null default 0
);
create table dating_private.stat_day_senders (day date not null, sender_id uuid not null, primary key (day, sender_id));
create table dating_private.stat_senders (sender_id uuid primary key);
revoke all on dating_private.stat_days, dating_private.stat_day_senders, dating_private.stat_senders from public, anon, authenticated;

-- Backfill from what's already there (once).
insert into dating_private.stat_days (day, messages)
  select (created_at at time zone 'Africa/Lagos')::date, count(*) from public.dating_messages group by 1;
insert into dating_private.stat_days (day, conversations)
  select (created_at at time zone 'Africa/Lagos')::date, count(*) from public.dating_conversations group by 1
  on conflict (day) do update set conversations = excluded.conversations;
insert into dating_private.stat_days (day, profiles)
  select (created_at at time zone 'Africa/Lagos')::date, count(*) from public.dating_profiles group by 1
  on conflict (day) do update set profiles = excluded.profiles;
insert into dating_private.stat_days (day, accounts)
  select (created_at at time zone 'Africa/Lagos')::date, count(*) from auth.users group by 1
  on conflict (day) do update set accounts = excluded.accounts;
insert into dating_private.stat_day_senders (day, sender_id)
  select distinct (created_at at time zone 'Africa/Lagos')::date, sender_id from public.dating_messages;
insert into dating_private.stat_senders (sender_id)
  select distinct sender_id from dating_private.stat_day_senders;

-- Keep them up to date.
create function dating_private.stat_bump() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare
  d date := (coalesce(new.created_at, now()) at time zone 'Africa/Lagos')::date;
begin
  if tg_table_name = 'dating_messages' then
    insert into stat_days (day, messages) values (d, 1) on conflict (day) do update set messages = stat_days.messages + 1;
    insert into stat_day_senders (day, sender_id) values (d, new.sender_id) on conflict do nothing;
    insert into stat_senders (sender_id) values (new.sender_id) on conflict do nothing;
  elsif tg_table_name = 'dating_conversations' then
    insert into stat_days (day, conversations) values (d, 1) on conflict (day) do update set conversations = stat_days.conversations + 1;
  elsif tg_table_name = 'dating_profiles' then
    insert into stat_days (day, profiles) values (d, 1) on conflict (day) do update set profiles = stat_days.profiles + 1;
  elsif tg_table_name = 'users' then
    insert into stat_days (day, accounts) values (d, 1) on conflict (day) do update set accounts = stat_days.accounts + 1;
  end if;
  return null;
end $$;
revoke execute on function dating_private.stat_bump() from public, anon, authenticated;
create trigger stat_bump after insert on public.dating_messages for each row execute function dating_private.stat_bump();
create trigger stat_bump after insert on public.dating_conversations for each row execute function dating_private.stat_bump();
create trigger stat_bump after insert on public.dating_profiles for each row execute function dating_private.stat_bump();
create trigger treehouse_stat_bump after insert on auth.users for each row execute function dating_private.stat_bump();

-- Same answer shape as before, from the running totals (plus exact counts of the small tables).
create or replace function public.admin_dating_stats(p_key text, p_days int default 7)
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
  mutual as (
    select c.id, max(r.created_at) as at
    from dating_reveals r join dating_conversations c on c.id = r.conversation_id
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
      'messages',       (select coalesce(sum(messages), 0) from stat_days),
      'mutualReveals',  (select count(*) from mutual),
      'blocks',         (select count(*) from dating_blocks),
      'reportsOpen',    (select count(*) from dating_reports where status = 'open'),
      'reports',        (select count(*) from dating_reports),
      'chattingPeople', (select count(*) from stat_senders)
    ),
    'inRange', jsonb_build_object(
      'accounts',      (select coalesce(sum(accounts), 0) from stat_days where day >= since),
      'profiles',      (select coalesce(sum(profiles), 0) from stat_days where day >= since),
      'conversations', (select coalesce(sum(conversations), 0) from stat_days where day >= since),
      'messages',      (select coalesce(sum(messages), 0) from stat_days where day >= since),
      'mutualReveals', (select count(*) from mutual where (at at time zone tz)::date >= since),
      'chattingPeople',(select count(distinct sender_id) from stat_day_senders where day >= since)
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'date', d.day,
        'accounts', coalesce(s.accounts, 0), 'profiles', coalesce(s.profiles, 0),
        'conversations', coalesce(s.conversations, 0), 'messages', coalesce(s.messages, 0)
      ) order by d.day)
      from d left join stat_days s on s.day = d.day
    ),
    'gender', (select coalesce(jsonb_agg(jsonb_build_object('name', g, 'count', n) order by n desc), '[]')
               from (select gender::text g, count(*) n from dating_profiles where not suspended group by 1) x),
    'intent', (select coalesce(jsonb_agg(jsonb_build_object('name', i, 'count', n) order by n desc), '[]')
               from (select intent::text i, count(*) n from dating_profiles where not suspended group by 1) x),
    'ages', (select coalesce(jsonb_agg(jsonb_build_object('name', band, 'count', n) order by band), '[]')
             from (select case when age < 25 then '18–24' when age < 30 then '25–29' when age < 35 then '30–34'
                               when age < 45 then '35–44' else '45+' end as band, count(*) n
                   from dating_profiles where not suspended group by 1) x),
    'locations', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', n) order by n desc), '[]')
                  from (select mode() within group (order by btrim(location)) as name, count(*) n
                        from dating_profiles where not suspended and btrim(location) <> ''
                        group by lower(regexp_replace(btrim(location), '\s+', ' ', 'g'))
                        order by n desc limit 8) x)
  ) into result;
  return result;
end $$;
