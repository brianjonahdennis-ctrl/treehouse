-- Push notifications for the home-screen web app.
-- Devices that allowed notifications are saved per account. New anonymous messages, chat messages,
-- message requests, likes and matches queue a notification in a private outbox; the treehouse server
-- picks them up (woken straight away through pg_net, with a slow poll as backup) and sends them.
-- Notifications are deliberately private: only the kind is stored and sent, never message text or names.

create extension if not exists pg_net;

-- ---- Devices ------------------------------------------------------------------------------------
create table public.push_subscriptions (
  endpoint    text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  user_id     uuid not null references auth.users (id) on delete cascade,
  p256dh      text not null check (char_length(p256dh) between 40 and 200),
  auth        text not null check (char_length(auth) between 10 and 100),
  created_at  timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
create policy "Users see their own devices" on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
grant select on public.push_subscriptions to authenticated;

-- Save this device for the signed-in account (a device moves to whoever signed in last).
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
  -- Keep the 10 most recent devices per account.
  delete from push_subscriptions where user_id = auth.uid() and endpoint in (
    select endpoint from push_subscriptions where user_id = auth.uid() order by created_at desc offset 10);
end $$;

create function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;
revoke execute on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text) to authenticated;

-- ---- Outbox ---------------------------------------------------------------------------------------
create table dating_private.push_outbox (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('message', 'chat', 'request', 'like', 'match')),
  url         text not null,
  created_at  timestamptz not null default now()
);
revoke all on dating_private.push_outbox from public, anon, authenticated;

-- Queue a notification, only for people with a device saved.
create function dating_private.queue_push(p_user uuid, p_kind text, p_url text) returns void
language sql security definer set search_path = public, dating_private as $$
  insert into push_outbox (user_id, kind, url)
  select p_user, p_kind, p_url
  where p_user is not null and exists (select 1 from push_subscriptions s where s.user_id = p_user);
$$;

-- Wake the treehouse server so it sends straight away. Never lets a failure here block the message.
create function dating_private.push_wake() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  begin
    perform net.http_post(url := 'https://tell.brianjonahdennis.com/api/push/wake', body := '{}'::jsonb, timeout_milliseconds := 3000);
  exception when others then null;
  end;
  return null;
end $$;
create trigger push_outbox_wake after insert on dating_private.push_outbox
  for each statement execute function dating_private.push_wake();

-- ---- What queues a notification -----------------------------------------------------------------
-- New anonymous message → the link owner.
create function dating_private.push_on_link_message() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  perform queue_push(new.owner_id, 'message', '/home/messages');
  return null;
end $$;
create trigger link_message_push after insert on public.link_messages
  for each row execute function dating_private.push_on_link_message();

-- New chat message → the other person (a message request if they haven't replied yet).
create function dating_private.push_on_dating_message() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare
  c record;
  other uuid;
begin
  select * into c from dating_conversations where id = new.conversation_id;
  if c is null then return null; end if;
  other := case when c.user_a = new.sender_id then c.user_b else c.user_a end;
  if dating_is_blocked(new.sender_id, other) then return null; end if;
  perform queue_push(other, case when c.accepted_at is null then 'request' else 'chat' end,
                     '/home/matches/' || new.conversation_id);
  return null;
end $$;
create trigger dating_message_push after insert on public.dating_messages
  for each row execute function dating_private.push_on_dating_message();

-- A like → the person liked, unless it makes a match (the match notification covers that).
create function dating_private.push_on_like() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if not new.liked or (tg_op = 'UPDATE' and old.liked) then return null; end if;
  if exists (select 1 from dating_likes l where l.from_user = new.to_user and l.to_user = new.from_user and l.liked) then return null; end if;
  if dating_is_blocked(new.from_user, new.to_user) then return null; end if;
  perform queue_push(new.to_user, 'like', '/home/matches/likes');
  return null;
end $$;
create trigger dating_like_push after insert or update of liked on public.dating_likes
  for each row execute function dating_private.push_on_like();

-- A match (a chat opened already accepted, or a request accepted by a like) → the other person.
create function dating_private.push_on_match() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare
  actor uuid := coalesce(auth.uid(), new.started_by);
begin
  if new.accepted_at is null then return null; end if;
  if tg_op = 'UPDATE' and old.accepted_at is not null then return null; end if;
  -- A reply accepting a request isn't a match; that person gets the chat-message notification instead.
  if tg_op = 'UPDATE' and not (
       exists (select 1 from dating_likes l where l.from_user = new.user_a and l.to_user = new.user_b and l.liked)
       and exists (select 1 from dating_likes l where l.from_user = new.user_b and l.to_user = new.user_a and l.liked))
     then return null; end if;
  perform queue_push(case when actor = new.user_a then new.user_b else new.user_a end, 'match', '/home/matches/' || new.id);
  return null;
end $$;
create trigger dating_match_push after insert or update of accepted_at on public.dating_conversations
  for each row execute function dating_private.push_on_match();

-- ---- For the treehouse server (admin key) ----------------------------------------------------
-- Take queued notifications with the devices to send them to. Old ones (over a day) are dropped.
create function public.admin_take_push(p_key text, p_limit int default 200)
returns table (endpoint text, p256dh text, auth text, kind text, url text)
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if not admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  delete from push_outbox where created_at < now() - interval '1 day';
  return query
    with taken as (
      delete from push_outbox o where o.id in (
        select id from push_outbox order by id limit least(greatest(coalesce(p_limit, 200), 1), 500) for update skip locked)
      returning o.user_id, o.kind, o.url, o.id
    )
    select distinct on (s.endpoint, t.kind) s.endpoint, s.p256dh, s.auth, t.kind, t.url
    from taken t join push_subscriptions s on s.user_id = t.user_id
    order by s.endpoint, t.kind, t.id desc;
end $$;

-- Forget a device the push service says is gone.
create function public.admin_drop_push_subscription(p_key text, p_endpoint text) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if not admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  delete from push_subscriptions where endpoint = p_endpoint;
end $$;
revoke execute on function public.admin_take_push(text, int), public.admin_drop_push_subscription(text, text) from public;
grant execute on function public.admin_take_push(text, int), public.admin_drop_push_subscription(text, text) to anon, authenticated;
