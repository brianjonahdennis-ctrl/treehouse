-- Message requests. Anyone with a dating card can message anyone. The first message arrives as a
-- request: the recipient sees it under "Message requests" and it moves to their chats when they
-- reply. A match (both liked each other), or messaging someone who already liked you, opens an
-- accepted chat straight away.
--
--   * Until the recipient replies, the sender can send up to 3 messages (stops spamming).
--   * The recipient can decline: the request disappears for them and the sender can't send more.
--     Messages are kept, so a report can still be reviewed.
--   * Up to 30 new message requests per person per day.

alter table public.dating_conversations
  add column started_by  uuid references auth.users (id) on delete set null,
  add column accepted_at timestamptz,
  add column declined_at timestamptz;
-- Chats that already exist stay exactly as they are.
update public.dating_conversations set accepted_at = created_at where accepted_at is null;

-- ---- Starting a chat ------------------------------------------------------------------------
create or replace function public.start_conversation(p_handle text) returns uuid
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  other uuid;
  conv uuid;
  liked_me boolean;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from dating_profiles where user_id = uid) then
    raise exception 'Create your dating profile first.' using errcode = '28000';
  end if;
  if dating_is_suspended(uid) then raise exception 'Your dating profile is suspended.' using errcode = '42501'; end if;
  select user_id into other from dating_profiles where handle = p_handle and is_active and not suspended;
  if other is null or other = uid or dating_is_blocked(uid, other) then
    raise exception 'That profile is not available.' using errcode = 'P0002';
  end if;
  conv := dating_conversation_between(uid, other);
  if conv is not null then return conv; end if;

  liked_me := exists (select 1 from dating_likes where from_user = other and to_user = uid and liked);
  if not liked_me and (select count(*) from dating_conversations
                       where started_by = uid and accepted_at is null and created_at > now() - interval '1 day') >= 30 then
    raise exception 'You''ve sent a lot of message requests today. Try again tomorrow.' using errcode = 'P0001';
  end if;
  insert into dating_conversations (user_a, user_b, started_by, accepted_at)
  values (least(uid, other), greatest(uid, other), uid, case when liked_me then now() end)
  returning id into conv;
  if liked_me then
    insert into dating_likes (from_user, to_user, liked) values (uid, other, true)
    on conflict (from_user, to_user) do update set liked = true, created_at = now();
  end if;
  return conv;
end $$;

-- A match opens an accepted chat, or accepts a message request that's already there.
create or replace function public.like_profile(p_handle text, p_like boolean)
returns table (matched boolean, conversation_id uuid)
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  other uuid;
  conv uuid;
  theirs boolean := false;
  accepted boolean := false;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from dating_profiles where user_id = uid and not suspended) then
    raise exception 'Create your dating profile first.' using errcode = '28000';
  end if;
  select user_id into other from dating_profiles where handle = p_handle and is_active and not suspended;
  if other is null or other = uid or dating_is_blocked(uid, other) then
    raise exception 'That profile is not available.' using errcode = 'P0002';
  end if;
  if p_like and (select count(*) from dating_likes
                 where from_user = uid and liked and created_at > now() - interval '1 day') >= 200 then
    raise exception 'You''ve sent a lot of likes today. Try again tomorrow.' using errcode = 'P0001';
  end if;

  insert into dating_likes (from_user, to_user, liked) values (uid, other, coalesce(p_like, false))
  on conflict (from_user, to_user) do update set liked = excluded.liked, created_at = now();

  conv := dating_conversation_between(uid, other);
  if p_like then
    select coalesce(l.liked, false) into theirs from dating_likes l where l.from_user = other and l.to_user = uid;
    if theirs then
      if conv is null then
        insert into dating_conversations (user_a, user_b, started_by, accepted_at)
        values (least(uid, other), greatest(uid, other), uid, now())
        returning id into conv;
      else
        update dating_conversations set accepted_at = coalesce(accepted_at, now()), declined_at = null where id = conv;
      end if;
    end if;
    if conv is not null then select c.accepted_at is not null into accepted from dating_conversations c where c.id = conv; end if;
  end if;
  return query select (p_like and accepted), case when p_like and accepted then conv end;
end $$;

-- ---- Replying accepts; senders wait after 3 messages ------------------------------------------
create function dating_private.dating_message_request_rules() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c dating_conversations%rowtype;
begin
  select * into c from dating_conversations where id = new.conversation_id;
  if c.accepted_at is null then
    if new.sender_id is distinct from c.started_by then
      update dating_conversations set accepted_at = now(), declined_at = null where id = c.id;   -- they replied: accepted
    elsif c.declined_at is not null then
      raise exception 'This person isn''t accepting messages from you.' using errcode = '42501';
    elsif (select count(*) from dating_messages where conversation_id = c.id and sender_id = new.sender_id) >= 3 then
      raise exception 'Wait for a reply: you can send up to 3 messages until they answer.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke execute on function dating_private.dating_message_request_rules() from public, anon, authenticated;
create trigger dating_messages_request_rules before insert on public.dating_messages
  for each row execute function dating_private.dating_message_request_rules();

-- ---- Declining ----------------------------------------------------------------------------------
create function public.decline_message_request(p_conversation uuid) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  update dating_conversations set declined_at = now()
  where id = p_conversation and accepted_at is null and declined_at is null
    and auth.uid() in (user_a, user_b) and started_by is distinct from auth.uid();
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
end $$;
revoke execute on function public.decline_message_request(uuid) from public, anon;
grant execute on function public.decline_message_request(uuid) to authenticated;

-- ---- Chat list with request state -----------------------------------------------------------------
-- status: 'chat' (accepted), 'request' (someone messaged me, I haven't replied), 'sent' (I messaged,
-- waiting for their reply). Requests I declined are hidden from me.
drop function public.my_conversations();
create function public.my_conversations()
returns table (
  conversation_id uuid, other_handle text, other_gender public.dating_gender, other_age int,
  other_location text, other_intent public.dating_intent, last_message text, last_from_me boolean,
  last_at timestamptz, unread int, i_revealed boolean, they_revealed boolean, blocked boolean, i_blocked boolean,
  status text
)
language sql stable security definer set search_path = public, dating_private as $$
  select c.id,
         p.handle, p.gender, p.age, p.location, p.intent,
         m.body, m.sender_id = auth.uid(), coalesce(m.created_at, c.created_at),
         (select count(*)::int from dating_messages x
           where x.conversation_id = c.id and x.sender_id = o.uid
             and x.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)),
         exists (select 1 from dating_reveals v where v.conversation_id = c.id and v.user_id = auth.uid()),
         exists (select 1 from dating_reveals v where v.conversation_id = c.id and v.user_id = o.uid),
         dating_is_blocked(auth.uid(), o.uid) or coalesce(p.suspended, false),
         exists (select 1 from dating_blocks b where b.blocker_id = auth.uid() and b.blocked_id = o.uid),
         case when c.accepted_at is not null then 'chat'
              when c.started_by = auth.uid() then 'sent'
              else 'request' end
  from dating_conversations c
  cross join lateral (select case when c.user_a = auth.uid() then c.user_b else c.user_a end as uid) o
  left join dating_profiles p on p.user_id = o.uid
  left join dating_reads r on r.conversation_id = c.id and r.user_id = auth.uid()
  left join lateral (
    select body, sender_id, created_at from dating_messages where conversation_id = c.id order by created_at desc, id desc limit 1
  ) m on true
  where auth.uid() in (c.user_a, c.user_b)
    and not (c.accepted_at is null and c.declined_at is not null and c.started_by is distinct from auth.uid())
  order by coalesce(m.created_at, c.created_at) desc;
$$;
revoke execute on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;
