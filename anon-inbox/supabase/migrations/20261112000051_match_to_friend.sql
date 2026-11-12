-- Matches can become friends. In a match chat, either person taps "Add friend"; when the other taps
-- it too (or accepts), the chat becomes a friend chat: it moves to Friends, and they see each other's
-- statuses. Same chat, same messages, same reveal. Either side can take back a request that hasn't
-- been accepted yet. Only the two people in the chat can do this, and not when one blocked the other.

set lock_timeout = '5s';

alter table public.dating_conversations add column if not exists friend_ask_by uuid references auth.users (id) on delete set null;

-- Ask (p_on true) or take back your request (p_on false).
-- Returns 'friends' (you're friends now), 'asked' (waiting for them) or 'none'.
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
  if c.accepted_at is null then raise exception 'You can add friends once you''re chatting.' using errcode = 'P0001'; end if;
  if dating_is_suspended(uid) then raise exception 'Your profile is suspended.' using errcode = '42501'; end if;
  if dating_is_blocked(uid, other) then raise exception 'That person is not available.' using errcode = 'P0002'; end if;
  if not coalesce(p_on, true) then
    if c.friend_ask_by = uid then update dating_conversations set friend_ask_by = null where id = c.id; end if;
    return case when c.friend_ask_by = other then 'theirs' else 'none' end;
  end if;
  if c.friend_ask_by = other then
    update dating_conversations set kind = 'friend', friend_ask_by = null where id = c.id;
    return 'friends';
  end if;
  update dating_conversations set friend_ask_by = uid where id = c.id;
  return 'asked';
end $$;
revoke all on function public.ask_friend(uuid, boolean) from public, anon;
grant execute on function public.ask_friend(uuid, boolean) to authenticated;

-- Where the friend request stands in one of your chats: 'friends', 'mine' (you asked),
-- 'theirs' (they asked you) or 'none'. Nothing for chats you're not in.
create or replace function public.friend_ask_state(p_conversation uuid) returns text
language sql stable security definer set search_path = public, dating_private as $$
  select case when c.kind = 'friend' then 'friends'
              when c.friend_ask_by = auth.uid() then 'mine'
              when c.friend_ask_by is not null then 'theirs'
              else 'none' end
  from dating_conversations c
  where c.id = p_conversation and auth.uid() in (c.user_a, c.user_b);
$$;
revoke all on function public.friend_ask_state(uuid) from public, anon;
grant execute on function public.friend_ask_state(uuid) to authenticated;
