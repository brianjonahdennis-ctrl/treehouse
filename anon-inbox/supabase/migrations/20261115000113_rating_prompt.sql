-- "Rate this user" prompt inside chats (Hydra, 15 Nov 2026).
-- * Once two people have exchanged more than 10 messages, each of them sees a "Rate this user" card in
--   the chat (Rate / Not now).
-- * "Not now" hides it until 20 more messages have been exchanged, then it comes back (and again every
--   20 messages after each "Not now").
-- * After rating, the same applies: the card can come back 20 messages later, but only once the existing
--   once-a-week rule allows rating that person again (rating_config.cooldown_days = 7).
-- * Rating from the person's profile still works at any time (same once-a-week rule).
-- Only adds a table and two functions; rate_convo also moves the prompt on after a rating.

set lock_timeout = '5s';

create table dating_private.rating_prompts (
  user_id         uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.dating_conversations (id) on delete cascade,
  next_at_count   int not null,           -- show again once the chat has at least this many messages
  dismissals      int not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (user_id, conversation_id)
);
alter table dating_private.rating_prompts enable row level security;
revoke all on dating_private.rating_prompts from public, anon, authenticated;

insert into dating_private.rating_config (key, value, note) values
  ('prompt_first_after', 10, 'chat prompt: show once the chat has MORE than this many messages'),
  ('prompt_repeat_every', 20, 'chat prompt: after Not now (or a rating), show again this many messages later')
on conflict (key) do nothing;

create function dating_private.chat_message_count(p_conversation uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from dating_messages where conversation_id = p_conversation
$$;

-- Should this chat show the "Rate this user" card to me right now?
create function public.rating_prompt(p_conversation uuid) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  e record;
  n int;
  nxt int;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into e from rating_convo(me, p_conversation);
  if e.ratee is null or e.reason is not null or rating_block_reason(me, e.ratee) is not null then
    return jsonb_build_object('show', false);
  end if;
  n := chat_message_count(p_conversation);
  select next_at_count into nxt from rating_prompts where user_id = me and conversation_id = p_conversation;
  nxt := coalesce(nxt, rating_cfg('prompt_first_after')::int + 1);
  return jsonb_build_object('show', n >= nxt, 'messages', n, 'next_at', nxt);
end $$;

-- "Not now": hide until N more messages.
create function public.rating_prompt_later(p_conversation uuid) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); n int;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from dating_conversations where id = p_conversation and me in (user_a, user_b)) then
    raise exception 'Chat not found.' using errcode = 'P0002';
  end if;
  n := chat_message_count(p_conversation);
  insert into rating_prompts (user_id, conversation_id, next_at_count, dismissals)
  values (me, p_conversation, n + rating_cfg('prompt_repeat_every')::int, 1)
  on conflict (user_id, conversation_id) do update
    set next_at_count = excluded.next_at_count, dismissals = rating_prompts.dismissals + 1, updated_at = now();
end $$;

-- Rating from a chat (the card or the profile) also moves the prompt on by N messages.
create or replace function public.rate_convo(p_conversation uuid, p_stars integer) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare e record; res jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into e from rating_convo(auth.uid(), p_conversation);
  if e.ratee is null or e.reason is not null then raise exception '%', coalesce(e.reason, 'You can’t rate this person.') using errcode = 'P0001'; end if;
  res := rating_submit(auth.uid(), e.ratee, p_stars, e.basis, p_conversation, null);
  insert into rating_prompts (user_id, conversation_id, next_at_count)
  values (auth.uid(), p_conversation, chat_message_count(p_conversation) + rating_cfg('prompt_repeat_every')::int)
  on conflict (user_id, conversation_id) do update set next_at_count = excluded.next_at_count, updated_at = now();
  return res;
end $$;

revoke all on function dating_private.chat_message_count(uuid) from public, anon, authenticated;
revoke all on function public.rating_prompt(uuid), public.rating_prompt_later(uuid), public.rate_convo(uuid, integer) from public, anon;
grant execute on function public.rating_prompt(uuid), public.rating_prompt_later(uuid), public.rate_convo(uuid, integer) to authenticated;
