-- Lighter on the database:
--  1. dating_summary(): chats, incoming likes and the pending-likes count in ONE call (the app used
--     to make three separate calls every few minutes).
--  2. Private chats get live updates by broadcast on a private channel per chat ("chat:<id>"), like
--     chatrooms, instead of Realtime checking every new message against every open chat.
--     Only the two people in a chat can listen to its channel.

create function public.dating_summary() returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select jsonb_build_object(
    'convos',   coalesce((select jsonb_agg(to_jsonb(c)) from my_conversations() c), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(to_jsonb(r)) from incoming_requests() r), '[]'::jsonb),
    'pending',  my_pending_likes()
  );
$$;
revoke execute on function public.dating_summary() from public, anon;
grant execute on function public.dating_summary() to authenticated;

-- Who may listen to a private chat's channel: only its two participants.
create function public.chat_can_listen(p_topic text) returns boolean
language sql stable security definer set search_path = public, dating_private as $$
  select case when p_topic ~ '^chat:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then dating_is_participant(substr(p_topic, 6)::uuid, auth.uid())
              else false end;
$$;
revoke execute on function public.chat_can_listen(text) from public, anon;
grant execute on function public.chat_can_listen(text) to authenticated;

create policy "Chat participants receive their chat" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'chat:%'
    and (select public.chat_can_listen((select realtime.topic())))
  );

-- New messages, edits and unsends are pushed to the chat's private channel.
create function dating_private.chat_broadcast() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(
    jsonb_build_object('id', new.id, 'conversation_id', new.conversation_id, 'sender_id', new.sender_id, 'body', new.body,
                       'created_at', new.created_at, 'reply_to', new.reply_to, 'edited_at', new.edited_at, 'deleted_at', new.deleted_at),
    case when tg_op = 'INSERT' then 'message' else 'update' end,
    'chat:' || new.conversation_id, true);
  return null;
end $$;
revoke execute on function dating_private.chat_broadcast() from public, anon, authenticated;
create trigger chat_broadcast after insert or update of body, edited_at, deleted_at on public.dating_messages
  for each row execute function dating_private.chat_broadcast();
