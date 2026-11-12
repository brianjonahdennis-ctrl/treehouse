-- State chat rooms: one public room per Nigerian state (36 states + FCT).
-- * You're in at most one room at a time: joining another room moves you there.
-- * A room holds up to 100 people. People who stop using the room for a few minutes drop out,
--   which frees their place.
-- * Everyone chats under the anonymous name treehouse gave them (their dating nickname, or a
--   generated one like "Quiet Falcon 214"). No real names, usernames or emails are ever shown.
-- * New messages reach the people in the room live through a private Realtime channel per room
--   ("room:<State>"), which only that room's members can listen to.

-- ---- Names --------------------------------------------------------------------------------------
create table dating_private.room_aliases (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  handle   text not null unique
);
revoke all on dating_private.room_aliases from public, anon, authenticated;

-- The name someone uses in rooms: their dating nickname if they have one, otherwise a generated one.
create function dating_private.room_name(uid uuid) returns text
language plpgsql volatile security definer set search_path = public, dating_private as $$
declare
  name text;
begin
  select handle into name from dating_profiles where user_id = uid;
  if name is not null then return name; end if;
  select handle into name from room_aliases where user_id = uid;
  if name is not null then return name; end if;
  loop
    name := dating_new_handle();
    exit when not exists (select 1 from room_aliases where handle = name);
  end loop;
  insert into room_aliases (user_id, handle) values (uid, name);
  return name;
end $$;

-- ---- Rooms, members and messages ----------------------------------------------------------------
create table public.room_members (
  user_id       uuid primary key references auth.users (id) on delete cascade,   -- one room per person
  state         text not null check (state = any (dating_private.nigerian_states())),
  handle        text not null,
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index room_members_state on public.room_members (state, last_seen_at);

create table public.room_messages (
  id          bigint generated always as identity primary key,
  state       text not null check (state = any (dating_private.nigerian_states())),
  user_id     uuid not null references auth.users (id) on delete cascade,
  handle      text not null,
  body        text not null check (char_length(body) between 1 and 500),
  created_at  timestamptz not null default now()
);
create index room_messages_state on public.room_messages (state, id desc);
create index room_messages_sender on public.room_messages (user_id, created_at desc);

create table public.room_reports (
  id          bigint generated always as identity primary key,
  message_id  bigint not null references public.room_messages (id) on delete cascade,
  reporter    uuid not null references auth.users (id) on delete cascade,
  reason      text not null check (reason in ('harassment', 'inappropriate', 'spam', 'underage', 'other')),
  created_at  timestamptz not null default now(),
  unique (message_id, reporter)
);

-- Nobody reads or writes these tables directly; everything goes through the functions below.
alter table public.room_members enable row level security;
alter table public.room_messages enable row level security;
alter table public.room_reports enable row level security;
revoke all on public.room_members, public.room_messages, public.room_reports from anon, authenticated;

-- Members who haven't been active for 3 minutes have left.
create function dating_private.room_active(seen timestamptz) returns boolean
language sql stable as $$ select seen > now() - interval '3 minutes' $$;

-- ---- Functions for the app ----------------------------------------------------------------------
-- Every room with how many people are in it now, and which one you're in.
create function public.room_list()
returns table (state text, people int, mine boolean)
language sql stable security definer set search_path = public, dating_private as $$
  select s.state,
         (select count(*)::int from room_members m where m.state = s.state and room_active(m.last_seen_at)),
         exists (select 1 from room_members m where m.state = s.state and m.user_id = auth.uid() and room_active(m.last_seen_at))
  from unnest(nigerian_states()) as s(state)
  order by s.state;
$$;

-- Join a room (leaving any other room). Fails if the room already has 100 people.
create function public.join_room(p_state text)
returns table (state text, handle text, people int)
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  name text;
  count_now int;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if p_state is null or not (p_state = any (nigerian_states())) then
    raise exception 'That room doesn''t exist.' using errcode = 'P0002';
  end if;
  -- One join at a time per room, so two people can't take the 100th place together.
  perform pg_advisory_xact_lock(hashtext('treehouse-room:' || p_state));
  delete from room_members m where m.state = p_state and not room_active(m.last_seen_at);
  if not exists (select 1 from room_members m where m.user_id = uid and m.state = p_state) then
    select count(*) into count_now from room_members m where m.state = p_state;
    if count_now >= 100 then
      raise exception 'This room is full (100 people). Try again in a few minutes.' using errcode = 'P0001';
    end if;
  end if;
  name := room_name(uid);
  insert into room_members (user_id, state, handle) values (uid, p_state, name)
  on conflict (user_id) do update
    set state = excluded.state, handle = excluded.handle, last_seen_at = now(),
        joined_at = case when room_members.state = excluded.state then room_members.joined_at else now() end;
  return query select p_state, name, (select count(*)::int from room_members m where m.state = p_state);
end $$;

-- Still here: called every minute while the room is open. Returns your room, or nothing if you'd dropped out.
create function public.room_heartbeat() returns text
language sql security definer set search_path = public, dating_private as $$
  update room_members set last_seen_at = now()
  where user_id = auth.uid() and room_active(last_seen_at)
  returning state;
$$;

create function public.leave_room() returns void
language sql security definer set search_path = public as $$
  delete from room_members where user_id = auth.uid();
$$;

-- The latest messages in your room (only while you're in it).
create function public.room_history(p_limit int default 60)
returns table (id bigint, handle text, body text, created_at timestamptz, mine boolean)
language sql stable security definer set search_path = public, dating_private as $$
  select * from (
    select x.id, x.handle, x.body, x.created_at, x.user_id = auth.uid()
    from room_members m
    join room_messages x on x.state = m.state
    where m.user_id = auth.uid() and room_active(m.last_seen_at)
    order by x.id desc
    limit least(greatest(coalesce(p_limit, 60), 1), 200)
  ) recent order by id;
$$;

-- People in your room right now (names only).
create function public.room_people()
returns table (handle text, me boolean)
language sql stable security definer set search_path = public, dating_private as $$
  select o.handle, o.user_id = auth.uid()
  from room_members m
  join room_members o on o.state = m.state and room_active(o.last_seen_at)
  where m.user_id = auth.uid() and room_active(m.last_seen_at)
  order by o.user_id = auth.uid() desc, o.joined_at
  limit 100;
$$;

-- Send a message to your room.
create function public.send_room_message(p_body text)
returns table (id bigint, handle text, body text, created_at timestamptz)
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  m record;
  text_in text := btrim(coalesce(p_body, ''));
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into m from room_members r where r.user_id = uid and room_active(r.last_seen_at);
  if not found then raise exception 'Join a room first.' using errcode = 'P0002'; end if;
  if char_length(text_in) not between 1 and 500 then
    raise exception 'Messages can be 1 to 500 characters.' using errcode = '22023';
  end if;
  if (select count(*) from room_messages x where x.user_id = uid and x.created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'Slow down a little: you can send 5 messages every 10 seconds.' using errcode = 'P0001';
  end if;
  update room_members set last_seen_at = now() where user_id = uid;
  -- Keep rooms light: messages older than a week are cleared now and then.
  if random() < 0.02 then delete from room_messages x where x.state = m.state and x.created_at < now() - interval '7 days'; end if;
  return query insert into room_messages (state, user_id, handle, body) values (m.state, uid, m.handle, text_in)
    returning room_messages.id, room_messages.handle, room_messages.body, room_messages.created_at;
end $$;

create function public.report_room_message(p_message bigint, p_reason text) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from room_messages x join room_members m on m.state = x.state and m.user_id = auth.uid() where x.id = p_message) then
    raise exception 'Message not found.' using errcode = 'P0002';
  end if;
  insert into room_reports (message_id, reporter, reason) values (p_message, auth.uid(), p_reason)
  on conflict (message_id, reporter) do nothing;
end $$;

revoke execute on function public.room_list(), public.join_room(text), public.room_heartbeat(), public.leave_room(),
  public.room_history(int), public.room_people(), public.send_room_message(text), public.report_room_message(bigint, text)
  from public, anon;
grant execute on function public.room_list(), public.join_room(text), public.room_heartbeat(), public.leave_room(),
  public.room_history(int), public.room_people(), public.send_room_message(text), public.report_room_message(bigint, text)
  to authenticated;

-- ---- Live delivery --------------------------------------------------------------------------------
-- Each new message is broadcast on the room's private channel. Only names and text are sent.
create function dating_private.room_broadcast() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(
    jsonb_build_object('id', new.id, 'handle', new.handle, 'body', new.body, 'created_at', new.created_at),
    'message', 'room:' || new.state, true);
  return null;
end $$;
create trigger room_message_broadcast after insert on public.room_messages
  for each row execute function dating_private.room_broadcast();

-- Only people in a room can listen to its channel.
create policy "Room members receive their room's messages" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) like 'room:%'
    and exists (select 1 from public.room_members m
                where m.user_id = (select auth.uid()) and 'room:' || m.state = (select realtime.topic()))
  );
