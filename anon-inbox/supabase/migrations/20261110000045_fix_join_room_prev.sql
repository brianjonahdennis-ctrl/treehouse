-- Fix: opening a room you're already in failed with 'record "prev" is not assigned yet'.
-- The previous-room check now uses plain variables that start empty.

set lock_timeout = '5s';

-- Moving to another room also tells the old room you left.
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
  prev_state text;   -- the room you were in before, when moving rooms
  prev_handle text;
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
end $$;

-- Same fix for leaving when you're not in a room.
create or replace function public.leave_room() returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare g_state text; g_handle text;
begin
  delete from room_members where user_id = auth.uid() returning state, handle into g_state, g_handle;
  delete from room_kicks where user_id = auth.uid();
  if g_state is not null then perform room_left_notice(g_state, g_handle, 'left'); end if;
end $$;
