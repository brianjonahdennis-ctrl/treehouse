-- Chatrooms are live-only: when you join, you only see messages sent while you're in the room.
-- Leaving (or dropping out after a few quiet minutes) starts you fresh next time. Everyone in the
-- room also sees a "… joined" line when someone new comes in.

-- History: only messages from the moment you joined this room.
create or replace function public.room_history(p_limit int default 60)
returns table (id bigint, handle text, body text, created_at timestamptz, mine boolean, reactions jsonb, my_reactions text[])
language sql stable security definer set search_path = public, dating_private as $$
  select r.id, r.handle, r.body, r.created_at, r.mine,
         room_reaction_counts(r.id),
         coalesce((select array_agg(x.emoji) from room_reactions x where x.message_id = r.id and x.user_id = auth.uid()), '{}')
  from (
    select x.id, x.handle, x.body, x.created_at, x.user_id = auth.uid() as mine
    from room_members m
    join room_messages x on x.state = m.state and x.created_at >= m.joined_at
    where m.user_id = auth.uid() and room_active(m.last_seen_at)
    order by x.id desc
    limit least(greatest(coalesce(p_limit, 60), 1), 200)
  ) r order by r.id;
$$;

-- Joining announces you to the room (live only, nothing is stored).
create or replace function public.join_room(p_state text)
returns table (state text, handle text, people int)
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  name text;
  count_now int;
  already boolean;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if p_state is null or not (p_state = any (nigerian_states())) then
    raise exception 'That room doesn''t exist.' using errcode = 'P0002';
  end if;
  -- One join at a time per room, so two people can't take the 100th place together.
  perform pg_advisory_xact_lock(hashtext('treehouse-room:' || p_state));
  delete from room_members m where m.state = p_state and not room_active(m.last_seen_at);
  already := exists (select 1 from room_members m where m.user_id = uid and m.state = p_state);
  if not already then
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
  select count(*)::int into count_now from room_members m where m.state = p_state;
  if not already then
    perform realtime.send(jsonb_build_object('handle', name, 'people', count_now), 'join', 'room:' || p_state, true);
  end if;
  return query select p_state, name, count_now;
end $$;
