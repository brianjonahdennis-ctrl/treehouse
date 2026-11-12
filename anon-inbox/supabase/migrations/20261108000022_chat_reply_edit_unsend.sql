-- Private chats, like WhatsApp:
--  * Reply: a message can quote an earlier message in the same chat.
--  * Edit: the sender can change a message within 15 minutes; it's marked as edited.
--  * Unsend: the sender can remove a message for both people ("This message was deleted").
--    The original text is kept privately for 30 days so harassment can still be reported and reviewed.
--  * Delete for me: hide any message just for yourself.

alter table public.dating_messages
  add column if not exists reply_to   bigint references public.dating_messages (id) on delete set null,
  add column if not exists edited_at  timestamptz,
  add column if not exists deleted_at timestamptz;

-- People can set reply_to when sending (nothing else new).
grant insert (reply_to) on public.dating_messages to authenticated;

-- A reply must quote a message in the same chat.
create function dating_private.dating_reply_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reply_to is not null and not exists (
    select 1 from dating_messages q where q.id = new.reply_to and q.conversation_id = new.conversation_id) then
    raise exception 'You can only reply to a message in this chat.' using errcode = '22023';
  end if;
  new.edited_at := null;
  new.deleted_at := null;
  return new;
end $$;
revoke execute on function dating_private.dating_reply_check() from public, anon, authenticated;
create trigger dating_messages_reply_check before insert on public.dating_messages
  for each row execute function dating_private.dating_reply_check();

-- Private copy of unsent messages, for safety reviews only (nobody can read it through the app).
create table dating_private.unsent_messages (
  message_id      bigint primary key,
  conversation_id uuid not null,
  sender_id       uuid not null,
  body            text not null,
  sent_at         timestamptz not null,
  unsent_at       timestamptz not null default now()
);

create function public.edit_dating_message(p_message bigint, p_body text) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  m dating_messages%rowtype;
  text_in text := btrim(coalesce(p_body, ''));
begin
  select * into m from dating_messages where id = p_message;
  if not found or m.sender_id is distinct from auth.uid() then raise exception 'Message not found.' using errcode = 'P0002'; end if;
  if m.deleted_at is not null then raise exception 'This message was deleted.' using errcode = 'P0001'; end if;
  if m.created_at < now() - interval '15 minutes' then raise exception 'Messages can only be edited for 15 minutes.' using errcode = 'P0001'; end if;
  if char_length(text_in) not between 1 and 1000 then raise exception 'Messages can be 1 to 1000 characters.' using errcode = '22023'; end if;
  if text_in = m.body then return; end if;
  update dating_messages set body = text_in, edited_at = now() where id = p_message;
end $$;

create function public.unsend_dating_message(p_message bigint) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  m dating_messages%rowtype;
begin
  select * into m from dating_messages where id = p_message;
  if not found or m.sender_id is distinct from auth.uid() then raise exception 'Message not found.' using errcode = 'P0002'; end if;
  if m.deleted_at is not null then return; end if;
  insert into dating_private.unsent_messages (message_id, conversation_id, sender_id, body, sent_at)
  values (m.id, m.conversation_id, m.sender_id, m.body, m.created_at) on conflict do nothing;
  delete from dating_private.unsent_messages where unsent_at < now() - interval '30 days';
  update dating_messages set body = 'This message was deleted', deleted_at = now(), reply_to = null where id = p_message;
end $$;

-- Delete for me: hidden messages disappear only for you.
create table public.dating_hidden_messages (
  user_id    uuid not null references auth.users (id) on delete cascade,
  message_id bigint not null references public.dating_messages (id) on delete cascade,
  primary key (user_id, message_id)
);
alter table public.dating_hidden_messages enable row level security;
revoke all on public.dating_hidden_messages from anon, authenticated;

create function public.hide_dating_message(p_message bigint) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if not exists (select 1 from dating_messages m where m.id = p_message and dating_is_participant(m.conversation_id, auth.uid())) then
    raise exception 'Message not found.' using errcode = 'P0002';
  end if;
  insert into dating_hidden_messages (user_id, message_id) values (auth.uid(), p_message) on conflict do nothing;
end $$;

create function dating_private.dating_is_hidden(p_message bigint, p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from dating_hidden_messages where message_id = p_message and user_id = p_user);
$$;

drop policy "Participants read messages" on public.dating_messages;
create policy "Participants read messages" on public.dating_messages for select to authenticated
  using (dating_private.dating_is_participant(conversation_id, (select auth.uid()))
         and created_at > dating_private.dating_cleared_at(conversation_id, (select auth.uid()))
         and not dating_private.dating_is_hidden(id, (select auth.uid())));

revoke execute on function public.edit_dating_message(bigint, text), public.unsend_dating_message(bigint), public.hide_dating_message(bigint) from public, anon;
grant execute on function public.edit_dating_message(bigint, text), public.unsend_dating_message(bigint), public.hide_dating_message(bigint) to authenticated;
revoke all on function dating_private.dating_is_hidden(bigint, uuid) from public, anon;
grant execute on function dating_private.dating_is_hidden(bigint, uuid) to authenticated;
