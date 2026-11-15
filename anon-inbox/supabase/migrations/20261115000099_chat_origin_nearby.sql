-- Inbox redesign (Hydra, 15 Nov 2026): Chats / Matches / Friends / Nearby are separate views of the SAME
-- conversations. Friends and Matches already come from their own systems (kind = 'friend' after an
-- accepted friend request; matched = mutual likes, worked out live). What was missing: where a chat
-- STARTED. This adds dating_conversations.origin, set once when a message request is sent from Nearby.
-- * Never changes after that: a Nearby chat stays Nearby even if the two later become friends or match
--   (it then also shows under Friends / Matches; still one conversation).
-- * Existing chats have no origin (the app never recorded it): Nearby starts fresh from today.
-- * Accepting a message request still only allows chatting: no friendship, no match.

set lock_timeout = '5s';

alter table public.dating_conversations add column if not exists origin text;
alter table public.dating_conversations drop constraint if exists dating_conversations_origin_ok;
alter table public.dating_conversations add constraint dating_conversations_origin_ok
  check (origin is null or origin in ('nearby')) not valid;   -- not valid: no full-table check on 425k rows

-- Send a message request and say where it came from. Only a brand-new request I started gets tagged;
-- an existing chat (a friend, a match, an older request) is returned untouched.
create or replace function public.start_conversation_from(p_handle text, p_origin text)
returns uuid
language plpgsql security definer set search_path = public, dating_private as $$
declare conv uuid; me uuid := auth.uid();
begin
  conv := public.start_conversation(p_handle);
  if p_origin = 'nearby' then
    update dating_conversations set origin = 'nearby'
    where id = conv and origin is null and started_by = me and kind = 'dating'
      and created_at > now() - interval '1 minute';
  end if;
  return conv;
end $$;
revoke execute on function public.start_conversation_from(text, text) from public, anon;
grant execute on function public.start_conversation_from(text, text) to authenticated;

-- The chat list also says which of my chats started in Nearby (a small id → origin map).
create or replace function public.dating_summary()
returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select jsonb_build_object(
    'convos',   coalesce((select jsonb_agg(to_jsonb(c)) from my_conversations() c), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(to_jsonb(r)) from incoming_requests() r), '[]'::jsonb),
    'pending',  my_pending_likes(),
    'my_status', (select jsonb_build_object('body', s.body, 'updated_at', s.updated_at) from dating_statuses s where s.user_id = auth.uid()),
    'friend_statuses', coalesce((select jsonb_agg(to_jsonb(f)) from friend_statuses() f), '[]'::jsonb),
    'origins', coalesce((select jsonb_object_agg(o.id, o.origin) from (
        select c.id, c.origin from dating_conversations c where c.user_a = auth.uid() and c.origin is not null
        union all
        select c.id, c.origin from dating_conversations c where c.user_b = auth.uid() and c.origin is not null) o), '{}'::jsonb)
  );
$$;

-- Friends › Remove friend. The friendship ends (no more friend status updates); the chat itself stays,
-- like any other chat (delete or block it separately). Matches and Nearby tags are untouched.
create or replace function public.remove_friend(p_conversation uuid)
returns text
language plpgsql security definer set search_path = public, dating_private as $$
declare uid uuid := auth.uid(); c dating_conversations%rowtype;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into c from dating_conversations where id = p_conversation and uid in (user_a, user_b) for update;
  if not found then raise exception 'Chat not found.' using errcode = 'P0002'; end if;
  if c.kind <> 'friend' then return 'none'; end if;
  update dating_conversations set kind = 'dating', friend_ask_by = null where id = c.id;
  return 'removed';
end $$;
revoke execute on function public.remove_friend(uuid) from public, anon;
grant execute on function public.remove_friend(uuid) to authenticated;
