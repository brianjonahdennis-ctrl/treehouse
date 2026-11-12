-- Unread counts for the chat list: each person's "read up to" time per conversation.
create table public.dating_reads (
  conversation_id  uuid not null references public.dating_conversations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  last_read_at     timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.dating_reads enable row level security;
revoke all on public.dating_reads from anon, authenticated;

create policy "Users see their own read markers" on public.dating_reads for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.dating_reads to authenticated;

-- Mark a conversation read up to now (only your own marker, only in your own chats).
create function public.mark_conversation_read(p_conversation uuid) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if not dating_is_participant(p_conversation, auth.uid()) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
  insert into dating_reads (conversation_id, user_id, last_read_at) values (p_conversation, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
end $$;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- The chat list, now with an unread count (messages from the other person since you last read).
drop function public.my_conversations();
create function public.my_conversations()
returns table (
  conversation_id uuid, other_handle text, other_gender public.dating_gender, other_age int,
  other_location text, other_intent public.dating_intent, last_message text, last_from_me boolean,
  last_at timestamptz, unread int, i_revealed boolean, they_revealed boolean, blocked boolean
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
         dating_is_blocked(auth.uid(), o.uid)
  from dating_conversations c
  cross join lateral (select case when c.user_a = auth.uid() then c.user_b else c.user_a end as uid) o
  left join dating_profiles p on p.user_id = o.uid
  left join dating_reads r on r.conversation_id = c.id and r.user_id = auth.uid()
  left join lateral (
    select body, sender_id, created_at from dating_messages where conversation_id = c.id order by created_at desc, id desc limit 1
  ) m on true
  where auth.uid() in (c.user_a, c.user_b)
  order by coalesce(m.created_at, c.created_at) desc;
$$;
revoke execute on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;
