-- Smaller Realtime log. Supabase keeps a copy of every server-sent Realtime signal for a few days,
-- and at ~300,000 messages a day that log had grown to ~800 MB.
--  1. Each new message is now sent once, on the recipient's own inbox channel, carrying the whole
--     message. Their chat list and their open chat both read it. (Before: a second copy also went to
--     the chat's channel.) The app shows a message once even if both copies arrive.
--  2. "Something new" signals for likes only go to people who were in the app in the last
--     15 minutes; everyone else's app refreshes when they open it anyway.
-- Edits and unsends still go on the chat's channel. Typing and "seen" pings never touch the database.

set lock_timeout = '5s';

create or replace function dating_private.nudge_message(p_user uuid, p_message public.dating_messages) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  begin
    perform realtime.send(
      -- b: short preview, still read by app versions that are open from before this change.
      jsonb_build_object('k', 'message', 'c', p_message.conversation_id, 'at', p_message.created_at, 'b', left(p_message.body, 200),
        'm', jsonb_strip_nulls(jsonb_build_object('id', p_message.id, 'sender_id', p_message.sender_id,
                                                  'body', p_message.body, 'reply_to', p_message.reply_to))),
      'inbox', 'user:' || p_user, true);
  exception when others then null;   -- a signal must never block a message
  end;
end $$;
revoke execute on function dating_private.nudge_message(uuid, public.dating_messages) from public, anon, authenticated;

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
      perform nudge_message(other, new);
    end if;
  end if;
  -- Running totals for the owner's stats (spread over 16 counters so nobody waits).
  insert into stat_message_counts (day, shard, messages) values (d, floor(random() * 16)::smallint, 1)
    on conflict (day, shard) do update set messages = stat_message_counts.messages + 1;
  if not exists (select 1 from stat_day_senders where day = d and sender_id = new.sender_id) then
    insert into stat_day_senders (day, sender_id) values (d, new.sender_id) on conflict do nothing;
    insert into stat_senders (sender_id) values (new.sender_id) on conflict do nothing;
  end if;
  return null;
end $$;

-- The old preview-only signal is no longer used.
drop function if exists dating_private.nudge_message(uuid, uuid, text, timestamptz);

-- Likes: only signal people who are in the app right now (seen in the last 15 minutes; the app
-- reports activity every 4 to 10 minutes while it's open).
create or replace function dating_private.nudge_on_like() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if new.liked and exists (select 1 from dating_profiles p where p.user_id = new.to_user and p.last_seen_at > now() - interval '15 minutes') then
    perform nudge(new.to_user);
  end if;
  return null;
end $$;
