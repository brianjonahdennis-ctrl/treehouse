-- Chatrooms by location:
--   * everyone can use the "Nigeria" room (holds 500)
--   * each state room (holds 200) is only for people whose dating card is in that state
--   * the state on a dating card can be changed once every 30 days (so people can't hop rooms)
-- Still one chatroom at a time.

-- 1. Room names: the 36 states + FCT, plus Nigeria ----------------------------------------------
create or replace function dating_private.room_names() returns text[]
language sql immutable as $$ select dating_private.nigerian_states() || array['Nigeria'] $$;

create or replace function dating_private.room_capacity(p_room text) returns int
language sql immutable as $$ select case when p_room = 'Nigeria' then 500 else 200 end $$;

alter table public.room_members drop constraint if exists room_members_state_check;
alter table public.room_members add constraint room_members_state_check check (state = any (dating_private.room_names()));
alter table public.room_messages drop constraint if exists room_messages_state_check;
alter table public.room_messages add constraint room_messages_state_check check (state = any (dating_private.room_names()));

-- The rooms one person may use: their own state first (if set), then Nigeria.
create or replace function dating_private.my_rooms(p_user uuid) returns text[]
language sql stable security definer set search_path = public, dating_private as $$
  select coalesce((select array[p.state] from dating_profiles p where p.user_id = p_user and p.state is not null), '{}')
         || array['Nigeria'];
$$;

-- 2. Room list: only your rooms ------------------------------------------------------------------
drop function if exists public.room_list();
create function public.room_list()
returns table(state text, people integer, mine boolean, online integer, unread integer, capacity integer)
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
         end,
         room_capacity(s.state)
  from unnest(my_rooms(auth.uid())) with ordinality as s(state, ord)
  left join room_members me on me.state = s.state and me.user_id = auth.uid() and room_active(me.last_seen_at)
  order by s.ord;
$$;
grant execute on function public.room_list() to authenticated;

-- 3. Joining: only your rooms, with each room's own size -----------------------------------------
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
    raise exception 'This chatroom is only for people in %. You can join your own state''s room or Nigeria.',
      case when p_state = 'FCT' then 'Abuja (FCT)' else p_state || ' State' end using errcode = '42501';
  end if;
  cap := room_capacity(p_state);
  -- One join at a time per room, so two people can't take the last place together.
  perform pg_advisory_xact_lock(hashtext('treehouse-room:' || p_state));
  delete from room_members m where m.state = p_state and not room_active(m.last_seen_at);
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
  select count(*)::int into count_now from room_members m where m.state = p_state;
  if not already then
    perform realtime.send(jsonb_build_object('handle', name, 'people', count_now), 'join', 'room:' || p_state, true);
  end if;
  return query select p_state, name, count_now, already, coalesce(read_to, top);
end $$;

-- 4. State on the dating card: once every 30 days ------------------------------------------------
alter table public.dating_profiles add column if not exists state_changed_at timestamptz;
update public.dating_profiles set state_changed_at = created_at where state_changed_at is null and state is not null;

create or replace function dating_private.guard_state_change() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if tg_op = 'INSERT' then
    if new.state is not null then new.state_changed_at := now(); end if;
    return new;
  end if;
  if new.state is distinct from old.state then
    if old.state is not null and old.state_changed_at is not null and old.state_changed_at > now() - interval '30 days' then
      raise exception 'You can change your state once every 30 days. You can change it again on %.',
        to_char(old.state_changed_at + interval '30 days', 'FMDD Mon YYYY') using errcode = 'P0001';
    end if;
    new.state_changed_at := now();
    -- Leaving your old state's chatroom.
    delete from room_members where user_id = new.user_id and state = old.state;
  else
    new.state_changed_at := old.state_changed_at;   -- can't be reset by hand
  end if;
  return new;
end $$;

drop trigger if exists dating_profiles_state_guard on public.dating_profiles;
create trigger dating_profiles_state_guard before insert or update of state, state_changed_at on public.dating_profiles
  for each row execute function dating_private.guard_state_change();

-- 5. Anyone currently in another state's room is moved out ---------------------------------------
delete from public.room_members m where not (m.state = any (dating_private.my_rooms(m.user_id)));
