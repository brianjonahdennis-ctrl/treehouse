-- Chatroom rules (Hydra, 14 Nov 2026):
-- 1. Posting a link in a chatroom = instant 24-hour ban from ALL chatrooms. No warning. The message is
--    not posted; the reason and a countdown are shown straight away (my_room_ban()).
-- 2. Suspended or blocked accounts can't join or post in chatrooms at all (they could before).

set lock_timeout = '5s';

create table if not exists dating_private.room_bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  until timestamptz not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists room_bans_until on dating_private.room_bans (until);
revoke all on dating_private.room_bans from public, anon, authenticated;

-- What counts as a link: web addresses, "www.", short links and anything ending in a common domain.
create or replace function dating_private.has_link(p_text text) returns boolean
language sql immutable as $$
  select coalesce(p_text, '') ~* '(https?://|www\.|(^|[^a-z0-9@._-])(wa\.me|t\.me|bit\.ly|tinyurl\.com|linktr\.ee)/?|\m[a-z0-9-]{2,}\.(com|ng|net|org|io|co|me|ly|app|link|xyz|info|biz|site|online|live|tv|gg|to|cc|us|uk|africa|store|shop|club|top|vip|win|bet|pro|ai|dev|page|space|website|tech|click|fun|icu)\M)' $$;

-- Why this person can't use chatrooms right now, or null. Account blocks and report suspensions are
-- indefinite; link bans end on their own.
create or replace function dating_private.room_block(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select coalesce(
    (select jsonb_build_object('until', null, 'reason', 'Your account is suspended.')
       where exists (select 1 from auth.users u where u.id = p_user and u.banned_until > now())
          or exists (select 1 from dating_profiles p where p.user_id = p_user and p.suspended and p.dob_underage_at is null)),
    (select jsonb_build_object('until', b.until, 'reason', b.reason) from room_bans b where b.user_id = p_user and b.until > now())) $$;
revoke all on function dating_private.room_block(uuid), dating_private.has_link(text) from public, anon, authenticated;

create or replace function public.my_room_ban() returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select case when room_block(auth.uid()) is null then null else room_block(auth.uid()) || jsonb_build_object('now', now()) end $$;
revoke execute on function public.my_room_ban() from public, anon;
grant execute on function public.my_room_ban() to authenticated;

CREATE OR REPLACE FUNCTION public.join_room(p_state text)
 RETURNS TABLE(state text, handle text, people integer, rejoined boolean, last_read_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'dating_private'
AS $function$
declare
  uid uuid := auth.uid();
  name text;
  count_now int;
  already boolean;
  read_to bigint;
  top bigint;
  cap int;
  prev_state text;   -- the room you were in before, when moving rooms
  prev_handle text;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if dating_private.room_block(uid) is not null then
    raise exception 'Chatroom ban: %', dating_private.room_block(uid) ->> 'reason' using errcode = '42501';
  end if;
  if p_state is null or not (p_state = any (room_names())) then
    raise exception 'That room doesn''t exist.' using errcode = 'P0002';
  end if;
  if not (p_state = any (my_rooms(uid))) then
    raise exception '%', room_denied(p_state) using errcode = '42501';
  end if;
  cap := room_capacity(p_state);
  perform pg_advisory_xact_lock(hashtext('treehouse-room:' || p_state));
  perform kick_inactive(p_state, null);
  select m.last_read_id into read_to from room_members m where m.user_id = uid and m.state = p_state;
  already := found;
  if not already then
    select count(*) into count_now from room_members m where m.state = p_state;
    if count_now >= cap then
      raise exception 'This room is full (% people). Try again in a few minutes.', cap using errcode = 'P0001';
    end if;
    select m.state, m.handle into prev_state, prev_handle from room_members m where m.user_id = uid and room_active(m.last_seen_at);
  end if;
  name := room_name(uid);
  top := coalesce((select max(x.id) from room_messages x where x.state = p_state), 0);
  insert into room_members (user_id, state, handle, last_read_id) values (uid, p_state, name, top)
  on conflict (user_id) do update
    set state = excluded.state, handle = excluded.handle, last_seen_at = now(),
        joined_at = case when room_members.state = excluded.state then room_members.joined_at else now() end,
        last_read_id = case when room_members.state = excluded.state then room_members.last_read_id else excluded.last_read_id end;
  delete from room_kicks k where k.user_id = uid;
  if prev_state is not null and prev_state <> p_state then perform room_left_notice(prev_state, prev_handle, 'left'); end if;
  select count(*)::int into count_now from room_members m where m.state = p_state;
  if not already then
    perform realtime.send(jsonb_build_object('handle', name, 'people', count_now), 'join', 'room:' || p_state, true);
  end if;
  return query select p_state, name, count_now, already, coalesce(read_to, top);
end $function$;

CREATE OR REPLACE FUNCTION public.send_room_message(p_body text, p_reply_to bigint DEFAULT NULL::bigint)
 RETURNS TABLE(id bigint, handle text, body text, created_at timestamp with time zone, reply_to bigint, reply_handle text, reply_body text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'dating_private'
AS $function$
declare
  uid uuid := auth.uid();
  m record;
  text_in text := btrim(coalesce(p_body, ''));
  q_handle text;
  q_body text;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if dating_private.room_block(uid) is not null then
    delete from room_members where user_id = uid;
    raise exception 'Chatroom ban: %', dating_private.room_block(uid) ->> 'reason' using errcode = '42501';
  end if;
  -- Links aren't allowed in chatrooms: no warning, the message isn't posted, and the sender is banned
  -- from every chatroom for 24 hours. (No error is raised, so the ban is kept; the app then shows it.)
  if dating_private.has_link(p_body) then
    insert into dating_private.room_bans (user_id, until, reason)
    values (uid, now() + interval '24 hours', 'You posted a link in a chatroom. Links aren''t allowed in treehouse chatrooms.')
    on conflict (user_id) do update set until = excluded.until, reason = excluded.reason, created_at = now();
    delete from room_members where user_id = uid;
    return;
  end if;
  select * into m from room_members r where r.user_id = uid and room_active(r.last_seen_at);
  if not found then raise exception 'Join a room first.' using errcode = 'P0002'; end if;
  if char_length(text_in) not between 1 and 500 then
    raise exception 'Messages can be 1 to 500 characters.' using errcode = '22023';
  end if;
  if (select count(*) from room_messages x where x.user_id = uid and x.created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'Slow down a little: you can send 5 messages every 10 seconds.' using errcode = 'P0001';
  end if;
  if p_reply_to is not null then
    select x.handle, x.body into q_handle, q_body from room_messages x where x.id = p_reply_to and x.state = m.state;
    if not found then raise exception 'That message isn''t in this room anymore.' using errcode = 'P0002'; end if;
  end if;
  update room_members set last_seen_at = now() where user_id = uid;
  -- Keep rooms light: messages older than a week are cleared now and then.
  if random() < 0.02 then delete from room_messages x where x.state = m.state and x.created_at < now() - interval '7 days'; end if;
  return query
    with ins as (
      insert into room_messages (state, user_id, handle, body, reply_to)
      values (m.state, uid, m.handle, text_in, p_reply_to)
      returning room_messages.id, room_messages.handle, room_messages.body, room_messages.created_at, room_messages.reply_to
    )
    select ins.id, ins.handle, ins.body, ins.created_at, ins.reply_to,
           q_handle, left(q_body, 140)
    from ins;
end $function$;
