-- Friends: add people from chatrooms as friends. A friend request is a chat like a message
-- request (they accept to reply), but it lives in Friends, not Matches. Friends can reveal
-- first names the same way.

alter table public.dating_conversations add column if not exists kind text not null default 'dating';
alter table public.dating_conversations drop constraint if exists dating_conversations_kind_check;
alter table public.dating_conversations add constraint dating_conversations_kind_check check (kind in ('dating', 'friend'));

create or replace function public.start_friend_request(p_handle text) returns uuid
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  other uuid;
  conv uuid;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from dating_profiles where user_id = uid) then
    raise exception 'Create your profile first.' using errcode = '28000';
  end if;
  if dating_is_suspended(uid) then raise exception 'Your profile is suspended.' using errcode = '42501'; end if;
  select user_id into other from dating_profiles where handle = p_handle and not suspended;
  if other is null or other = uid or dating_is_blocked(uid, other) then
    raise exception 'That person is not available.' using errcode = 'P0002';
  end if;
  -- Already chatting (as friends or from dating): keep the one chat.
  conv := dating_conversation_between(uid, other);
  if conv is not null then return conv; end if;
  if (select count(*) from dating_conversations
      where started_by = uid and kind = 'friend' and accepted_at is null and created_at > now() - interval '1 day') >= 30 then
    raise exception 'You''ve sent a lot of friend requests today. Try again tomorrow.' using errcode = 'P0001';
  end if;
  insert into dating_conversations (user_a, user_b, started_by, kind)
  values (least(uid, other), greatest(uid, other), uid, 'friend')
  returning id into conv;
  return conv;
end $$;
revoke all on function public.start_friend_request(text) from public, anon;
grant execute on function public.start_friend_request(text) to authenticated;

-- The chat list now says whether each chat is a friend or a dating chat.
drop function if exists public.my_conversations();
create function public.my_conversations()
 RETURNS TABLE(conversation_id uuid, other_handle text, other_gender dating_gender, other_age integer, other_location text, other_intent dating_intent, last_message text, last_from_me boolean, last_at timestamp with time zone, unread integer, i_revealed boolean, they_revealed boolean, blocked boolean, i_blocked boolean, status text, other_online boolean, other_active_hours integer, matched boolean, accepted_at timestamp with time zone, started_by_me boolean, other_read_at timestamp with time zone, other_delivered_at timestamp with time zone, kind text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'dating_private'
AS $function$
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
           order by x.created_at desc limit 1) end,
         c.kind
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
$function$
;
revoke all on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

-- Tidy-up: the room list was recreated earlier with default (public) access.
revoke all on function public.room_list() from public, anon;
grant execute on function public.room_list() to authenticated;
