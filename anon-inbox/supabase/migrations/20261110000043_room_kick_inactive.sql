-- Chatrooms work like 2go rooms now, not WhatsApp groups:
--  * Inactive for 10 minutes (treehouse closed or in the background) = kicked out of your room.
--  * You don't get back in automatically: you see "You were kicked out of this room for inactivity"
--    and tap Join again.
-- The app pings every few minutes while it's open on screen, so active people keep their seat.
-- Kicks are kept for up to a week, only so the app can tell you once; joining or leaving clears it.

set lock_timeout = '5s';

create table if not exists public.room_kicks (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  state     text not null,
  kicked_at timestamptz not null default now()
);
alter table public.room_kicks enable row level security;
revoke all on public.room_kicks from anon, authenticated;

-- A seat is kept while you've been active in the last 10 minutes (was 30).
create or replace function dating_private.room_active(seen timestamptz) returns boolean
language sql stable as $$ select seen > now() - interval '10 minutes' $$;

-- Move inactive seats out of the room (one room, or one person) and remember the kick.
create or replace function dating_private.kick_inactive(p_state text, p_user uuid) returns void
language sql security definer set search_path = public, dating_private as $$
  with gone as (
    delete from room_members m
    where (p_state is null or m.state = p_state) and (p_user is null or m.user_id = p_user)
      and not room_active(m.last_seen_at)
    returning m.user_id, m.state, m.last_seen_at
  )
  insert into room_kicks (user_id, state, kicked_at)
  select user_id, state, least(now(), last_seen_at + interval '10 minutes') from gone
  on conflict (user_id) do update set state = excluded.state, kicked_at = excluded.kicked_at;
$$;
revoke execute on function dating_private.kick_inactive(text, uuid) from public, anon, authenticated;

-- Joining: inactive people in the room are kicked first; joining clears your own kick.
create or replace function public.join_room(p_state text)
returns table(state text, handle text, people integer, rejoined boolean, last_read_id bigint)
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  name text;
  count_now int;
  already boolean;
  read_to bigint;
  top bigint;
  cap int;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
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
  end if;
  name := room_name(uid);
  top := coalesce((select max(x.id) from room_messages x where x.state = p_state), 0);
  insert into room_members (user_id, state, handle, last_read_id) values (uid, p_state, name, top)
  on conflict (user_id) do update
    set state = excluded.state, handle = excluded.handle, last_seen_at = now(),
        joined_at = case when room_members.state = excluded.state then room_members.joined_at else now() end,
        last_read_id = case when room_members.state = excluded.state then room_members.last_read_id else excluded.last_read_id end;
  delete from room_kicks k where k.user_id = uid;
  select count(*)::int into count_now from room_members m where m.state = p_state;
  if not already then
    perform realtime.send(jsonb_build_object('handle', name, 'people', count_now), 'join', 'room:' || p_state, true);
  end if;
  return query select p_state, name, count_now, already, coalesce(read_to, top);
end $$;

create or replace function public.leave_room() returns void
language sql security definer set search_path = public as $$
  delete from room_members where user_id = auth.uid();
  delete from room_kicks where user_id = auth.uid();
$$;

-- "I'm here" ping from an open app. Returns your room, or null if you've been kicked out.
create or replace function public.room_heartbeat() returns text
language plpgsql security definer set search_path = public, dating_private as $$
declare st text;
begin
  update room_members set last_seen_at = now()
  where user_id = auth.uid() and room_active(last_seen_at)
  returning room_members.state into st;
  if st is null then perform kick_inactive(null, auth.uid()); end if;
  return st;
end $$;

-- Were you kicked out of a room? (Shown once; dismissing or joining clears it.)
create or replace function public.my_room_kick() returns table(state text, kicked_at timestamptz)
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if auth.uid() is null then return; end if;
  perform kick_inactive(null, auth.uid());
  return query select k.state, k.kicked_at from room_kicks k
    where k.user_id = auth.uid() and k.kicked_at > now() - interval '7 days';
end $$;

create or replace function public.dismiss_room_kick() returns void
language sql security definer set search_path = public as $$
  delete from room_kicks where user_id = auth.uid();
$$;

revoke all on function public.my_room_kick() from public, anon;
revoke all on function public.dismiss_room_kick() from public, anon;
grant execute on function public.my_room_kick() to authenticated;
grant execute on function public.dismiss_room_kick() to authenticated;
