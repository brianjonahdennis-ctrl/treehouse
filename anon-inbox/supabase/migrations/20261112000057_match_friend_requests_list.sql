-- Friend requests sent inside match chats now show up in Inbox → Requests → Friends: incoming ones
-- with Accept / Decline, and your own under "You sent" as pending with Cancel. Before, they only
-- showed as a small icon in the chat header, so senders couldn't see them as pending and
-- receivers could miss them.

set lock_timeout = '5s';

-- Your pending match friend requests: which chat, and whether you sent it ('mine') or they did ('theirs').
create or replace function public.my_friend_asks()
returns table(conversation_id uuid, who text)
language sql stable security definer set search_path = public, dating_private as $$
  select c.id, case when c.friend_ask_by = auth.uid() then 'mine' else 'theirs' end
  from dating_conversations c
  where (c.user_a = auth.uid() or c.user_b = auth.uid())
    and c.friend_ask_by is not null and c.kind = 'dating'
    and not dating_is_blocked(c.user_a, c.user_b);
$$;
revoke all on function public.my_friend_asks() from public, anon;
grant execute on function public.my_friend_asks() to authenticated;

-- p_on false now also lets the person who RECEIVED the request decline it (before: only the sender
-- could take it back). Either way it clears the request and returns 'none'.
create or replace function public.ask_friend(p_conversation uuid, p_on boolean default true) returns text
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  c dating_conversations%rowtype;
  other uuid;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into c from dating_conversations where id = p_conversation and uid in (user_a, user_b) for update;
  if not found then raise exception 'Chat not found.' using errcode = 'P0002'; end if;
  other := case when c.user_a = uid then c.user_b else c.user_a end;
  if c.kind = 'friend' then return 'friends'; end if;
  if not coalesce(p_on, true) then
    if c.friend_ask_by is not null then update dating_conversations set friend_ask_by = null where id = c.id; end if;
    return 'none';
  end if;
  if c.accepted_at is null then raise exception 'You can add friends once you''re chatting.' using errcode = 'P0001'; end if;
  if dating_is_suspended(uid) then raise exception 'Your profile is suspended.' using errcode = '42501'; end if;
  if dating_is_blocked(uid, other) then raise exception 'That person is not available.' using errcode = 'P0002'; end if;
  if c.friend_ask_by = other then
    update dating_conversations set kind = 'friend', friend_ask_by = null where id = c.id;
    return 'friends';
  end if;
  update dating_conversations set friend_ask_by = uid where id = c.id;
  return 'asked';
end $$;
revoke all on function public.ask_friend(uuid, boolean) from public, anon;
grant execute on function public.ask_friend(uuid, boolean) to authenticated;
