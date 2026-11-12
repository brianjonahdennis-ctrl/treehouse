-- Slimmer message sending. Same rules, same errors, same delivery; fewer steps per message.
--  * Before saving: one step instead of three (rate limit + message-request rules + reply check),
--    reading the chat once. The rate-limit count stops at 20 and uses the sender index.
--  * After saving: one step instead of three (push queue + stats + live broadcast).
--  * The push sender is woken at most once every 3 seconds (not once per message), straight at
--    treehouse.ng. The server's 60-second backup check still sends anything left in the queue.
-- Permission checks (row-level security on insert) are unchanged.

-- ---- Before saving -------------------------------------------------------------------------------
create function dating_private.dating_messages_before() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare
  c dating_conversations%rowtype;
begin
  -- Rate limit: at most 20 messages a minute.
  if (select count(*) from (select 1 from dating_messages
        where sender_id = new.sender_id and created_at > now() - interval '1 minute' limit 20) recent) >= 20 then
    raise exception 'Slow down - too many messages. Try again in a minute.' using errcode = 'P0001';
  end if;
  select * into c from dating_conversations where id = new.conversation_id;
  -- Message requests: the recipient accepts first; the sender gets 3 messages until then.
  if found and c.accepted_at is null then
    if new.sender_id is distinct from c.started_by then
      raise exception 'Accept the message request first, then you can reply.' using errcode = '42501';
    elsif c.declined_at is not null then
      raise exception 'This person isn''t accepting messages from you.' using errcode = '42501';
    elsif (select count(*) from (select 1 from dating_messages
             where conversation_id = c.id and sender_id = new.sender_id limit 3) sent) >= 3 then
      raise exception 'Wait for them to accept: you can send up to 3 messages until then.' using errcode = 'P0001';
    end if;
  end if;
  -- Replies must quote a message in the same chat.
  if new.reply_to is not null and not exists (
    select 1 from dating_messages q where q.id = new.reply_to and q.conversation_id = new.conversation_id) then
    raise exception 'You can only reply to a message in this chat.' using errcode = '22023';
  end if;
  new.edited_at := null;
  new.deleted_at := null;
  return new;
end $$;
revoke execute on function dating_private.dating_messages_before() from public, anon, authenticated;

drop trigger if exists dating_messages_rate_limit on public.dating_messages;
drop trigger if exists dating_messages_request_rules on public.dating_messages;
drop trigger if exists dating_messages_reply_check on public.dating_messages;
create trigger dating_messages_before before insert on public.dating_messages
  for each row execute function dating_private.dating_messages_before();

-- ---- After saving --------------------------------------------------------------------------------
create function dating_private.dating_messages_after() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare
  c record;
  other uuid;
  d date := (new.created_at at time zone 'Africa/Lagos')::date;
begin
  -- Push notification for the other person (not if either has blocked the other).
  select user_a, user_b, accepted_at into c from dating_conversations where id = new.conversation_id;
  if found then
    other := case when c.user_a = new.sender_id then c.user_b else c.user_a end;
    if not dating_is_blocked(new.sender_id, other) then
      perform queue_push(other, case when c.accepted_at is null then 'request' else 'chat' end, '/home/matches/' || new.conversation_id);
    end if;
  end if;
  -- Running totals for the owner's stats.
  insert into stat_days (day, messages) values (d, 1) on conflict (day) do update set messages = stat_days.messages + 1;
  insert into stat_day_senders (day, sender_id) values (d, new.sender_id) on conflict do nothing;
  insert into stat_senders (sender_id) values (new.sender_id) on conflict do nothing;
  -- Live delivery on the chat's private channel.
  perform realtime.send(
    jsonb_build_object('id', new.id, 'conversation_id', new.conversation_id, 'sender_id', new.sender_id, 'body', new.body,
                       'created_at', new.created_at, 'reply_to', new.reply_to, 'edited_at', new.edited_at, 'deleted_at', new.deleted_at),
    'message', 'chat:' || new.conversation_id, true);
  return null;
end $$;
revoke execute on function dating_private.dating_messages_after() from public, anon, authenticated;

drop trigger if exists dating_message_push on public.dating_messages;
drop trigger if exists stat_bump on public.dating_messages;
drop trigger if exists chat_broadcast on public.dating_messages;
create trigger dating_messages_after after insert on public.dating_messages
  for each row execute function dating_private.dating_messages_after();
-- Edits and unsends are still broadcast live.
create trigger chat_broadcast_update after update of body, edited_at, deleted_at on public.dating_messages
  for each row execute function dating_private.chat_broadcast();

-- ---- Push wake-up: at most once every 3 seconds ----------------------------------------------------
create table dating_private.push_wake_state (id int primary key default 1 check (id = 1), last_at timestamptz not null default '-infinity');
insert into dating_private.push_wake_state (id) values (1) on conflict do nothing;
revoke all on dating_private.push_wake_state from public, anon, authenticated;

create or replace function dating_private.push_wake() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  begin
    update push_wake_state set last_at = now() where id = 1 and last_at < now() - interval '3 seconds';
    if found then
      perform net.http_post(url := 'https://treehouse.ng/api/push/wake', body := '{}'::jsonb, timeout_milliseconds := 3000);
    end if;
  exception when others then null;   -- never block a message because of a notification
  end;
  return null;
end $$;
