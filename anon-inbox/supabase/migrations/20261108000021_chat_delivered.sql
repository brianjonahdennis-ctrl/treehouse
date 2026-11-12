-- Messenger-style message status in private chats: Sent → Delivered → Seen.
-- my_conversations() gains other_delivered_at: the time of your newest message that has reached the
-- other person (they opened treehouse, or read the chat, after it was sent). Seen still comes from
-- other_read_at. No exact "last online" time is exposed.

drop function public.my_conversations();
create function public.my_conversations()
returns table (
  conversation_id uuid, other_handle text, other_gender public.dating_gender, other_age int,
  other_location text, other_intent public.dating_intent, last_message text, last_from_me boolean,
  last_at timestamptz, unread int, i_revealed boolean, they_revealed boolean, blocked boolean, i_blocked boolean,
  status text, other_online boolean, other_active_hours int,
  matched boolean, accepted_at timestamptz, started_by_me boolean, other_read_at timestamptz,
  other_delivered_at timestamptz
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
         case when bl.blocked then null else hours_since(p.last_seen_at) end,
         exists (select 1 from dating_likes l1 join dating_likes l2 on l2.from_user = l1.to_user and l2.to_user = l1.from_user
                 where l1.from_user = auth.uid() and l1.to_user = o.uid and l1.liked and l2.liked),
         c.accepted_at,
         c.started_by = auth.uid(),
         case when bl.blocked then null else (select r2.last_read_at from dating_reads r2 where r2.conversation_id = c.id and r2.user_id = o.uid) end,
         -- Delivered: the newest of your messages sent before they last opened treehouse (or read the chat).
         -- Only that message's own time is shared, never when they were actually online.
         case when bl.blocked then null else (
           select max(x.created_at) from dating_messages x
           where x.conversation_id = c.id and x.sender_id = auth.uid()
             and x.created_at <= greatest(p.last_seen_at,
                   (select r3.last_read_at from dating_reads r3 where r3.conversation_id = c.id and r3.user_id = o.uid))) end
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
revoke execute on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;
