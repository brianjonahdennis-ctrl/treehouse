-- Chatrooms work like WhatsApp groups now:
--  * You stay in your room until you leave it (or join another one). Being idle, minimising the app
--    or closing it no longer takes you out, so messages keep arriving for you.
--    Housekeeping: someone who hasn't opened treehouse at all for 14 days is taken out, so rooms
--    (100 places) don't fill up with people who've stopped using the app.
--  * Each member has a "read up to" marker. The Chatrooms list shows how many messages arrived in
--    your room since you last had it open; opening the room clears it.
--  * "Online" now means active in the last 5 minutes, separate from being a member.

alter table public.room_members add column if not exists last_read_id bigint not null default 0;

-- People who had already dropped out under the old 30-minute rule were never removed from the
-- table; clear them out first so they don't come back as members.
delete from public.room_members where last_seen_at <= now() - interval '30 minutes';

-- Still a member: anyone who has used the app in the last 14 days.
create or replace function dating_private.room_active(seen timestamptz) returns boolean
language sql stable as $$ select seen > now() - interval '14 days' $$;

-- Online: active in the app in the last 5 minutes.
create or replace function dating_private.room_online(seen timestamptz) returns boolean
language sql stable as $$ select seen > now() - interval '5 minutes' $$;

-- People who were members when this ships start with everything read.
update public.room_members m
set last_read_id = coalesce((select max(x.id) from public.room_messages x where x.state = m.state), 0);

-- Every room: members, how many are online, whether it's yours, and (for yours) unread messages.
drop function public.room_list();
create function public.room_list()
returns table (state text, people int, mine boolean, online int, unread int)
language sql stable security definer set search_path = public, dating_private as $$
  select s.state,
         (select count(*)::int from room_members m where m.state = s.state and room_active(m.last_seen_at)),
         me.user_id is not null,
         (select count(*)::int from room_members m where m.state = s.state and room_online(m.last_seen_at)),
         case when me.user_id is null then 0 else
           (select count(*)::int from (
              select 1 from room_messages x
              where x.state = s.state and x.id > me.last_read_id and x.created_at >= me.joined_at and x.user_id <> me.user_id
              limit 1000) c)
         end
  from unnest(nigerian_states()) as s(state)
  left join room_members me on me.state = s.state and me.user_id = auth.uid() and room_active(me.last_seen_at)
  order by s.state;
$$;

-- You've seen everything in your room up to now.
create function public.room_mark_read() returns void
language sql security definer set search_path = public, dating_private as $$
  update room_members m
  set last_read_id = greatest(m.last_read_id, coalesce((select max(x.id) from room_messages x where x.state = m.state), 0)),
      last_seen_at = now()
  where m.user_id = auth.uid();
$$;

-- Joining a new room starts with nothing unread; coming back to your own room keeps your place.
create or replace function public.join_room(p_state text)
returns table (state text, handle text, people int)
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  name text;
  count_now int;
  already boolean;
  top bigint;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if p_state is null or not (p_state = any (nigerian_states())) then
    raise exception 'That room doesn''t exist.' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtext('treehouse-room:' || p_state));
  delete from room_members m where m.state = p_state and not room_active(m.last_seen_at);
  already := exists (select 1 from room_members m where m.user_id = uid and m.state = p_state);
  if not already then
    select count(*) into count_now from room_members m where m.state = p_state;
    if count_now >= 100 then
      raise exception 'This room is full (100 people). Try again later.' using errcode = 'P0001';
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
  return query select p_state, name, count_now;
end $$;

-- Members list with who is online right now.
drop function public.room_people();
create function public.room_people()
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
  limit 100;
$$;

create or replace function public.room_profile(p_handle text)
returns table (handle text, room text, online boolean, age int, gender public.dating_gender, bio text,
               interests text[], dating boolean, me boolean, place text)
language sql stable security definer set search_path = public, dating_private as $$
  select o.handle, o.state, room_online(o.last_seen_at) or o.user_id = auth.uid(),
         p.age, p.gender, p.bio, p.interests,
         coalesce(p.is_active and not p.suspended, false),
         o.user_id = auth.uid(),
         coalesce(nullif(btrim(p.location), ''), o.state)
  from room_members m
  join room_members o on o.state = m.state and o.handle = p_handle
  left join dating_profiles p on p.user_id = o.user_id
  where m.user_id = auth.uid() and room_active(m.last_seen_at)
  limit 1;
$$;

revoke execute on function public.room_list(), public.room_mark_read(), public.room_people() from public, anon;
grant execute on function public.room_list(), public.room_mark_read(), public.room_people() to authenticated;
