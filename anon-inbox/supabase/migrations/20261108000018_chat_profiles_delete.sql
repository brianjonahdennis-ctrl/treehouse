-- 1. See the dating card of anyone you have a chat or message request with (tap their nickname).
-- 2. Delete a chat, like WhatsApp: the chat and its messages disappear for you only. The other person
--    keeps their copy. If they message you again, the chat comes back with just the new messages.

-- ---- Profile of the person you're chatting with ------------------------------------------------
create function public.chat_partner_profile(p_conversation uuid)
returns table (handle text, age int, gender public.dating_gender, location text, intent public.dating_intent,
               bio text, interests text[], online boolean, active_hours int, available boolean)
language sql stable security definer set search_path = public, dating_private as $$
  select p.handle, p.age, p.gender, coalesce(nullif(p.location, ''), p.state, ''), p.intent, p.bio, p.interests,
         case when bl.blocked then false else is_online(p.last_seen_at) end,
         case when bl.blocked then null else hours_since(p.last_seen_at) end,
         not bl.blocked
  from dating_conversations c
  cross join lateral (select case when c.user_a = auth.uid() then c.user_b else c.user_a end as uid) o
  join dating_profiles p on p.user_id = o.uid
  cross join lateral (select dating_is_blocked(auth.uid(), o.uid) or p.suspended as blocked) bl
  where c.id = p_conversation and auth.uid() in (c.user_a, c.user_b);
$$;
revoke execute on function public.chat_partner_profile(uuid) from public, anon;
grant execute on function public.chat_partner_profile(uuid) to authenticated;

-- ---- Deleting a chat (for you only) --------------------------------------------------------------
create table public.dating_cleared (
  conversation_id  uuid not null references public.dating_conversations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  cleared_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.dating_cleared enable row level security;
revoke all on public.dating_cleared from anon, authenticated;

-- When you deleted this chat (or -infinity if you never did).
create function dating_private.dating_cleared_at(p_conversation uuid, p_user uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select coalesce((select cleared_at from dating_cleared where conversation_id = p_conversation and user_id = p_user),
                  '-infinity'::timestamptz);
$$;

create function public.delete_conversation(p_conversation uuid) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if not exists (select 1 from dating_conversations c where c.id = p_conversation and auth.uid() in (c.user_a, c.user_b)) then
    raise exception 'Chat not found.' using errcode = 'P0002';
  end if;
  insert into dating_cleared (conversation_id, user_id) values (p_conversation, auth.uid())
  on conflict (conversation_id, user_id) do update set cleared_at = now();
  -- Nothing left to read.
  insert into dating_reads (conversation_id, user_id, last_read_at) values (p_conversation, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = now();
end $$;
revoke execute on function public.delete_conversation(uuid) from public, anon;
grant execute on function public.delete_conversation(uuid) to authenticated;

-- You no longer see messages from before you deleted the chat.
drop policy "Participants read messages" on public.dating_messages;
create policy "Participants read messages" on public.dating_messages for select to authenticated
  using (dating_private.dating_is_participant(conversation_id, (select auth.uid()))
         and created_at > dating_private.dating_cleared_at(conversation_id, (select auth.uid())));

-- Chat list: deleted chats are hidden until a new message arrives; previews skip deleted messages.
create or replace function public.my_conversations()
returns table (
  conversation_id uuid, other_handle text, other_gender public.dating_gender, other_age int,
  other_location text, other_intent public.dating_intent, last_message text, last_from_me boolean,
  last_at timestamptz, unread int, i_revealed boolean, they_revealed boolean, blocked boolean, i_blocked boolean,
  status text, other_online boolean, other_active_hours int
)
language sql stable security definer set search_path = public, dating_private as $$
  select c.id,
         p.handle, p.gender, p.age, p.location, p.intent,
         m.body, m.sender_id = auth.uid(), coalesce(m.created_at, c.created_at),
         (select count(*)::int from dating_messages x
           where x.conversation_id = c.id and x.sender_id = o.uid
             and x.created_at > greatest(coalesce(r.last_read_at, '-infinity'::timestamptz), cl.at)),
         exists (select 1 from dating_reveals v where v.conversation_id = c.id and v.user_id = auth.uid()),
         exists (select 1 from dating_reveals v where v.conversation_id = c.id and v.user_id = o.uid),
         bl.blocked,
         exists (select 1 from dating_blocks b where b.blocker_id = auth.uid() and b.blocked_id = o.uid),
         case when c.accepted_at is not null then 'chat'
              when c.started_by = auth.uid() then 'sent'
              else 'request' end,
         case when bl.blocked then false else is_online(p.last_seen_at) end,
         case when bl.blocked then null else hours_since(p.last_seen_at) end
  from dating_conversations c
  cross join lateral (select case when c.user_a = auth.uid() then c.user_b else c.user_a end as uid) o
  cross join lateral (select dating_cleared_at(c.id, auth.uid()) as at) cl
  left join dating_profiles p on p.user_id = o.uid
  cross join lateral (select dating_is_blocked(auth.uid(), o.uid) or coalesce(p.suspended, false) as blocked) bl
  left join dating_reads r on r.conversation_id = c.id and r.user_id = auth.uid()
  left join lateral (
    select body, sender_id, created_at from dating_messages
    where conversation_id = c.id and created_at > cl.at
    order by created_at desc, id desc limit 1
  ) m on true
  where auth.uid() in (c.user_a, c.user_b)
    and not (c.accepted_at is null and c.declined_at is not null and c.started_by is distinct from auth.uid())
    and (cl.at = '-infinity'::timestamptz or m.created_at is not null)
  order by coalesce(m.created_at, c.created_at) desc;
$$;
