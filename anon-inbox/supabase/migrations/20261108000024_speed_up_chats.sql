-- Speed: the chat list (my_conversations) was the database's heaviest query by far. This adds the
-- indexes it needs, makes each part cheaper, and adds chat_status() so an open chat can check
-- Sent / Delivered / Seen without reloading the whole chat list.

-- Newest-first messages per chat, with the sender in the index (counts and "delivered" use only the index).
create index if not exists dating_messages_conv_recent on public.dating_messages (conversation_id, created_at desc, id desc) include (sender_id);
-- Finding your chats when you're the second person in the pair.
create index if not exists dating_conversations_user_b on public.dating_conversations (user_b);
drop index if exists public.dating_messages_conversation;   -- replaced by dating_messages_conv_recent

create or replace function public.my_conversations()
returns table (
  conversation_id uuid, other_handle text, other_gender public.dating_gender, other_age int,
  other_location text, other_intent public.dating_intent, last_message text, last_from_me boolean,
  last_at timestamptz, unread int, i_revealed boolean, they_revealed boolean, blocked boolean, i_blocked boolean,
  status text, other_online boolean, other_active_hours int,
  matched boolean, accepted_at timestamptz, started_by_me boolean, other_read_at timestamptz,
  other_delivered_at timestamptz
)
language sql stable security definer set search_path = public, dating_private as $$
  with me as (select auth.uid() as uid),
  convs as (
    select c.* from dating_conversations c, me where c.user_a = me.uid
    union all
    select c.* from dating_conversations c, me where c.user_b = me.uid
  )
  select c.id,
         p.handle, p.gender, p.age, p.location, p.intent,
         m.body, m.sender_id = me.uid, coalesce(m.created_at, c.created_at),
         -- Unread (counted up to 99; the app shows 99+ anyway).
         (select count(*)::int from (
            select 1 from dating_messages x
            where x.conversation_id = c.id and x.sender_id = o.uid
              and x.created_at > greatest(coalesce(r.last_read_at, '-infinity'::timestamptz), cl.at)
            limit 99) u),
         exists (select 1 from dating_reveals v where v.conversation_id = c.id and v.user_id = me.uid),
         exists (select 1 from dating_reveals v where v.conversation_id = c.id and v.user_id = o.uid),
         bl.blocked,
         exists (select 1 from dating_blocks b where b.blocker_id = me.uid and b.blocked_id = o.uid),
         case when c.accepted_at is not null then 'chat'
              when c.started_by = me.uid then 'sent'
              else 'request' end,
         case when bl.blocked then false else is_online(p.last_seen_at) end,
         case when bl.blocked then null else hours_since(p.last_seen_at) end,
         exists (select 1 from dating_likes l1 join dating_likes l2 on l2.from_user = l1.to_user and l2.to_user = l1.from_user
                 where l1.from_user = me.uid and l1.to_user = o.uid and l1.liked and l2.liked),
         c.accepted_at,
         c.started_by = me.uid,
         case when bl.blocked then null else rt.last_read_at end,
         -- Delivered: your newest message sent before they last opened treehouse (or read the chat).
         case when bl.blocked or not coalesce(m.sender_id = me.uid, false) then null else (
           select x.created_at from dating_messages x
           where x.conversation_id = c.id and x.created_at <= greatest(p.last_seen_at, rt.last_read_at) and x.sender_id = me.uid
           order by x.created_at desc limit 1) end
  from convs c
  cross join me
  cross join lateral (select case when c.user_a = me.uid then c.user_b else c.user_a end as uid) o
  cross join lateral (select dating_cleared_at(c.id, me.uid) as at) cl
  left join dating_profiles p on p.user_id = o.uid
  cross join lateral (select dating_is_blocked(me.uid, o.uid) or coalesce(p.suspended, false) as blocked) bl
  left join dating_reads r on r.conversation_id = c.id and r.user_id = me.uid
  left join dating_reads rt on rt.conversation_id = c.id and rt.user_id = o.uid
  left join lateral (
    select body, sender_id, created_at from dating_messages
    where conversation_id = c.id and created_at > cl.at
    order by created_at desc, id desc limit 1
  ) m on true
  where not (c.accepted_at is null and c.declined_at is not null and c.started_by is distinct from me.uid)
    and (cl.at = '-infinity'::timestamptz or m.created_at is not null)
  order by coalesce(m.created_at, c.created_at) desc;
$$;

-- One chat's status, for an open chat to poll cheaply (instead of the whole chat list).
create function public.chat_status(p_conversation uuid)
returns table (status text, blocked boolean, other_read_at timestamptz, other_delivered_at timestamptz,
               other_online boolean, other_active_hours int, i_revealed boolean, they_revealed boolean)
language sql stable security definer set search_path = public, dating_private as $$
  with me as (select auth.uid() as uid)
  select case when c.accepted_at is not null then 'chat' when c.started_by = me.uid then 'sent' else 'request' end,
         bl.blocked,
         case when bl.blocked then null else rt.last_read_at end,
         case when bl.blocked then null else (
           select x.created_at from dating_messages x
           where x.conversation_id = c.id and x.created_at <= greatest(p.last_seen_at, rt.last_read_at) and x.sender_id = me.uid
           order by x.created_at desc limit 1) end,
         case when bl.blocked then false else is_online(p.last_seen_at) end,
         case when bl.blocked then null else hours_since(p.last_seen_at) end,
         exists (select 1 from dating_reveals v where v.conversation_id = c.id and v.user_id = me.uid),
         exists (select 1 from dating_reveals v where v.conversation_id = c.id and v.user_id = o.uid)
  from dating_conversations c
  cross join me
  cross join lateral (select case when c.user_a = me.uid then c.user_b else c.user_a end as uid) o
  left join dating_profiles p on p.user_id = o.uid
  cross join lateral (select dating_is_blocked(me.uid, o.uid) or coalesce(p.suspended, false) as blocked) bl
  left join dating_reads rt on rt.conversation_id = c.id and rt.user_id = o.uid
  where c.id = p_conversation and me.uid in (c.user_a, c.user_b);
$$;
revoke execute on function public.chat_status(uuid) from public, anon;
grant execute on function public.chat_status(uuid) to authenticated;
