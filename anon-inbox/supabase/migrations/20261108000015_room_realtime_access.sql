-- Fix: live chatroom messages weren't reaching phones. The rule for who may listen to a room's
-- channel looked up room_members directly, but app users can't read that table, so the check
-- itself failed and every listener was refused. The check now runs through a function that's
-- allowed to look, and still only says yes for the room you're in.
create function public.room_can_listen(p_topic text) returns boolean
language sql stable security definer set search_path = public, dating_private as $$
  select exists (
    select 1 from room_members m
    where m.user_id = auth.uid() and room_active(m.last_seen_at) and 'room:' || m.state = p_topic
  );
$$;
revoke execute on function public.room_can_listen(text) from public, anon;
grant execute on function public.room_can_listen(text) to authenticated;

drop policy "Room members receive their room's messages" on realtime.messages;
create policy "Room members receive their room's messages" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'room:%'
    and (select public.room_can_listen((select realtime.topic())))
  );
