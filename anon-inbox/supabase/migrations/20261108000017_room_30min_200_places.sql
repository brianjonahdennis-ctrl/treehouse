-- Chatrooms, take two:
--  * You're taken out of your room after 30 minutes of not being online in treehouse. Using any part
--    of the app (replying to a private chat, browsing Discover…) keeps your place, not just having
--    the room open.
--  * Rooms hold 200 people (was 100).
--  * join_room tells the app whether you were already in the room and where you'd read up to, so
--    coming back drops you at the last message you saw, with an unread count, and no "you joined" line.

create or replace function dating_private.room_active(seen timestamptz) returns boolean
language sql stable as $$ select seen > now() - interval '30 minutes' $$;

-- The app's "I'm here" ping (every couple of minutes while it's open) now also keeps your room seat.
create or replace function public.touch_last_seen() returns void
language sql security definer set search_path = public, dating_private as $$
  update dating_profiles set last_seen_at = now()
  where user_id = auth.uid()
    and (last_seen_at is null or last_seen_at < now() - interval '1 minute');
  update room_members set last_seen_at = now()
  where user_id = auth.uid() and room_active(last_seen_at) and last_seen_at < now() - interval '1 minute';
$$;

drop function public.join_room(text);
create function public.join_room(p_state text)
returns table (state text, handle text, people int, rejoined boolean, last_read_id bigint)
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  name text;
  count_now int;
  already boolean;
  read_to bigint;
  top bigint;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if p_state is null or not (p_state = any (nigerian_states())) then
    raise exception 'That room doesn''t exist.' using errcode = 'P0002';
  end if;
  -- One join at a time per room, so two people can't take the last place together.
  perform pg_advisory_xact_lock(hashtext('treehouse-room:' || p_state));
  delete from room_members m where m.state = p_state and not room_active(m.last_seen_at);
  select m.last_read_id into read_to from room_members m where m.user_id = uid and m.state = p_state;
  already := found;
  if not already then
    select count(*) into count_now from room_members m where m.state = p_state;
    if count_now >= 200 then
      raise exception 'This room is full (200 people). Try again in a few minutes.' using errcode = 'P0001';
    end if;
  end if;
  name := room_name(uid);
  top := coalesce((select max(x.id) from room_messages x where x.state = p_state), 0);
  insert into room_members (user_id, state, handle, last_read_id) values (uid, p_state, name, top)
  on conflict (user_id) do update
    set state = excluded.state, handle = excluded.handle, last_seen_at = now(),
        joined_at = case when room_members.state = excluded.state then room_members.joined_at else now() end,
        last_read_id = case when room_members.state = excluded.state then room_members.last_read_id else excluded.last_read_id end;
  select count(*)::int into count_now from room_members m where m.state = p_state;
  if not already then
    perform realtime.send(jsonb_build_object('handle', name, 'people', count_now), 'join', 'room:' || p_state, true);
  end if;
  return query select p_state, name, count_now, already, coalesce(read_to, top);
end $$;

-- Members list: up to 200 now.
create or replace function public.room_people()
returns table (handle text, me boolean, dating boolean, place text, online boolean)
language sql stable security definer set search_path = public, dating_private as $$
  select o.handle, o.user_id = auth.uid(),
         coalesce(p.is_active and not p.suspended, false),
         coalesce(nullif(btrim(p.location), ''), o.state),
         room_online(o.last_seen_at) or o.user_id = auth.uid()
  from room_members m
  join room_members o on o.state = m.state and room_active(o.last_seen_at)
  left join dating_profiles p on p.user_id = o.user_id
  where m.user_id = auth.uid() and room_active(m.last_seen_at)
  order by o.user_id = auth.uid() desc, room_online(o.last_seen_at) desc, o.joined_at
  limit 200;
$$;

-- Avatars for up to 200 names at once (a full room).
create or replace function public.get_avatars(p_handles text[])
returns table (handle text, config jsonb)
language sql stable security definer set search_path = public, dating_private as $$
  select n.handle, a.config
  from (select distinct unnest(p_handles[1:200]) as handle) n
  cross join lateral (
    select coalesce(
      (select p.user_id from dating_profiles p where p.handle = n.handle),
      (select r.user_id from room_aliases r where r.handle = n.handle)) as uid
  ) u
  join user_avatars a on a.user_id = u.uid;
$$;

revoke execute on function public.join_room(text) from public, anon;
grant execute on function public.join_room(text) to authenticated;
