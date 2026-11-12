-- 1. The old live chat feed is switched off: private messages no longer go through Realtime's
--    table-change feed (every current app version uses the private chat channels instead).
-- 2. "Something new" nudges: when you get a message, a like, an accepted request or a reveal, the
--    server sends a tiny nudge on your own private channel ("user:<your id>") so your phone
--    refreshes its chat list once, instead of every phone checking every few minutes.
--    Nudges carry no names or text, and only you can listen to your channel.

-- Give up quickly rather than make people's messages wait behind this change.
set lock_timeout = '5s';
alter publication supabase_realtime drop table public.dating_messages;

create function public.user_can_listen(p_topic text) returns boolean
language sql stable as $$ select p_topic = 'user:' || auth.uid()::text $$;
revoke execute on function public.user_can_listen(text) from public, anon;
grant execute on function public.user_can_listen(text) to authenticated;

create policy "People receive their own nudges" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'user:%'
    and (select public.user_can_listen((select realtime.topic())))
  );

create function dating_private.nudge(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  begin
    perform realtime.send('{}'::jsonb, 'inbox', 'user:' || p_user, true);
  exception when others then null;   -- a nudge must never block anything
  end;
end $$;
revoke execute on function dating_private.nudge(uuid) from public, anon, authenticated;

-- New message → nudge the other person (added to the slim after-save step).
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
      perform nudge(other);
    end if;
  end if;
  insert into stat_days (day, messages) values (d, 1) on conflict (day) do update set messages = stat_days.messages + 1;
  insert into stat_day_senders (day, sender_id) values (d, new.sender_id) on conflict do nothing;
  insert into stat_senders (sender_id) values (new.sender_id) on conflict do nothing;
  perform realtime.send(
    jsonb_build_object('id', new.id, 'conversation_id', new.conversation_id, 'sender_id', new.sender_id, 'body', new.body,
                       'created_at', new.created_at, 'reply_to', new.reply_to, 'edited_at', new.edited_at, 'deleted_at', new.deleted_at),
    'message', 'chat:' || new.conversation_id, true);
  return null;
end $$;

-- A like → nudge the person liked. A request accepted / match → nudge both. A reveal → nudge the other.
create function dating_private.nudge_on_like() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if new.liked then perform nudge(new.to_user); end if;
  return null;
end $$;
create trigger nudge_on_like after insert or update of liked on public.dating_likes
  for each row execute function dating_private.nudge_on_like();

create function dating_private.nudge_on_conversation() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if tg_op = 'INSERT' or new.accepted_at is distinct from old.accepted_at then
    perform nudge(new.user_a); perform nudge(new.user_b);
  end if;
  return null;
end $$;
create trigger nudge_on_conversation after insert or update of accepted_at on public.dating_conversations
  for each row execute function dating_private.nudge_on_conversation();

create function dating_private.nudge_on_reveal() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare
  c record;
begin
  select user_a, user_b into c from dating_conversations where id = coalesce(new.conversation_id, old.conversation_id);
  if found then perform nudge(c.user_a); perform nudge(c.user_b); end if;
  return null;
end $$;
create trigger nudge_on_reveal after insert or delete on public.dating_reveals
  for each row execute function dating_private.nudge_on_reveal();

revoke execute on function dating_private.nudge_on_like(), dating_private.nudge_on_conversation(), dating_private.nudge_on_reveal() from public, anon, authenticated;
