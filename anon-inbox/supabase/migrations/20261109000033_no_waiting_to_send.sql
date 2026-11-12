-- Messages stop queueing behind each other.
-- Every message used to add 1 to the SAME stats row (today's message count) and touch the SAME
-- push wake-up row, so when many people sent at once each message waited for the one before it.
--  * Today's message count is now split over 16 small counters (each message picks one at random),
--    and the owner's stats add them up. Same numbers, no queue.
--  * "Has this person ever chatted / chatted today" is only written the first time, not per message.
--  * The push wake-up skips the check instead of waiting if another message is doing it right now.
-- Same rules, same delivery, same stats.

set lock_timeout = '5s';

create table dating_private.stat_message_counts (
  day      date not null,
  shard    smallint not null,
  messages int not null default 0,
  primary key (day, shard)
);
revoke all on dating_private.stat_message_counts from public, anon, authenticated;

create or replace function dating_private.dating_messages_after() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare
  c record;
  other uuid;
  d date := (new.created_at at time zone 'Africa/Lagos')::date;
begin
  select user_a, user_b, accepted_at into c from dating_conversations where id = new.conversation_id;
  if found then
    other := case when c.user_a = new.sender_id then c.user_b else c.user_a end;
    if not dating_is_blocked(new.sender_id, other) then
      perform queue_push(other, case when c.accepted_at is null then 'request' else 'chat' end, '/home/matches/' || new.conversation_id);
      perform nudge_message(other, new.conversation_id, new.body, new.created_at);
    end if;
  end if;
  -- Running totals for the owner's stats (spread over 16 counters so nobody waits).
  insert into stat_message_counts (day, shard, messages) values (d, floor(random() * 16)::smallint, 1)
    on conflict (day, shard) do update set messages = stat_message_counts.messages + 1;
  if not exists (select 1 from stat_day_senders where day = d and sender_id = new.sender_id) then
    insert into stat_day_senders (day, sender_id) values (d, new.sender_id) on conflict do nothing;
    insert into stat_senders (sender_id) values (new.sender_id) on conflict do nothing;
  end if;
  perform realtime.send(
    jsonb_build_object('id', new.id, 'conversation_id', new.conversation_id, 'sender_id', new.sender_id, 'body', new.body,
                       'created_at', new.created_at, 'reply_to', new.reply_to, 'edited_at', new.edited_at, 'deleted_at', new.deleted_at),
    'message', 'chat:' || new.conversation_id, true);
  return null;
end $$;

-- A new-message nudge carries the chat and a preview, so the phone can update its chat list by
-- itself instead of asking the server for the whole list. Only the recipient can hear their channel.
create function dating_private.nudge_message(p_user uuid, p_conv uuid, p_body text, p_at timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  begin
    perform realtime.send(jsonb_build_object('k', 'message', 'c', p_conv, 'b', left(p_body, 200), 'at', p_at),
                          'inbox', 'user:' || p_user, true);
  exception when others then null;   -- a nudge must never block a message
  end;
end $$;
revoke execute on function dating_private.nudge_message(uuid, uuid, text, timestamptz) from public, anon, authenticated;

-- Push wake-up: if another message is checking right now, skip instead of waiting.
create or replace function dating_private.push_wake() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  begin
    perform 1 from push_wake_state where id = 1 and last_at < now() - interval '3 seconds' for update skip locked;
    if found then
      update push_wake_state set last_at = now() where id = 1;
      perform net.http_post(url := 'https://treehouse.ng/api/push/wake', body := '{}'::jsonb, timeout_milliseconds := 3000);
    end if;
  exception when others then null;   -- never block a message because of a notification
  end;
  return null;
end $$;

-- Owner stats: message counts = the old daily totals + the new counters.
create or replace view dating_private.stat_messages_by_day as
  select day, sum(messages)::bigint as messages from (
    select day, messages from dating_private.stat_days
    union all
    select day, messages from dating_private.stat_message_counts
  ) x group by day;
revoke all on dating_private.stat_messages_by_day from public, anon, authenticated;

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
      'messages',       (select coalesce(sum(messages), 0) from stat_messages_by_day),
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
      'messages',      (select coalesce(sum(messages), 0) from stat_messages_by_day where day >= since),
      'mutualReveals', (select count(*) from mutual where (at at time zone tz)::date >= since),
      'chattingPeople',(select count(distinct sender_id) from stat_day_senders where day >= since)
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'date', d.day,
        'accounts', coalesce(s.accounts, 0), 'profiles', coalesce(s.profiles, 0),
        'conversations', coalesce(s.conversations, 0), 'messages', coalesce(m.messages, 0)
      ) order by d.day)
      from d left join stat_days s on s.day = d.day left join stat_messages_by_day m on m.day = d.day
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
