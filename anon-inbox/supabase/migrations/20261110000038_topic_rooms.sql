-- More rooms open across Nigeria (each holds 500):
--   Nigeria, Lover's Lounge, Football Banter, Christian Room, Muslim Room: everyone
--   Ladies' Room: women only        Men's Room: men only
-- The gender on a dating card can now change once every 90 days, so people can't
-- switch to get into the other room. Still one chatroom at a time.

create or replace function dating_private.general_rooms() returns text[]
language sql immutable as $$
  select array['Nigeria', 'Lovers Lounge', 'Ladies Room', 'Mens Room', 'Football Banter', 'Christian Room', 'Muslim Room']
$$;

create or replace function dating_private.room_names() returns text[]
language sql immutable as $$ select dating_private.nigerian_states() || dating_private.general_rooms() $$;

create or replace function dating_private.room_capacity(p_room text) returns int
language sql immutable as $$
  select case when p_room = any (dating_private.general_rooms()) then 500 else 200 end
$$;

-- Your rooms: your state first, then the rooms open to you.
create or replace function dating_private.my_rooms(p_user uuid) returns text[]
language sql stable security definer set search_path = public, dating_private as $$
  select coalesce((select array[p.state] from dating_profiles p where p.user_id = p_user and p.state is not null), '{}')
      || array(
           select r from unnest(general_rooms()) with ordinality as g(r, ord)
           where (r <> 'Ladies Room' or exists (select 1 from dating_profiles p where p.user_id = p_user and p.gender = 'female'))
             and (r <> 'Mens Room'   or exists (select 1 from dating_profiles p where p.user_id = p_user and p.gender = 'male'))
           order by ord);
$$;

-- Clearer "not for you" messages.
create or replace function dating_private.room_denied(p_room text) returns text
language sql immutable as $$
  select case
    when p_room = 'Ladies Room' then 'The Ladies'' Room is for women only.'
    when p_room = 'Mens Room' then 'The Men''s Room is for men only.'
    when p_room = 'FCT' then 'This chatroom is only for people in Abuja (FCT). You can join your own state''s room or any room open to everyone.'
    else 'This chatroom is only for people in ' || p_room || ' State. You can join your own state''s room or any room open to everyone.'
  end
$$;

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

-- Gender: once every 90 days. Changing it leaves the Ladies'/Men's Room.
alter table public.dating_profiles add column if not exists gender_changed_at timestamptz;
update public.dating_profiles set gender_changed_at = created_at where gender_changed_at is null;

create or replace function dating_private.guard_gender_change() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if tg_op = 'INSERT' then new.gender_changed_at := now(); return new; end if;
  if new.gender is distinct from old.gender then
    if old.gender_changed_at is not null and old.gender_changed_at > now() - interval '90 days' then
      raise exception 'You can change your gender once every 90 days. You can change it again on %.',
        to_char(old.gender_changed_at + interval '90 days', 'FMDD Mon YYYY') using errcode = 'P0001';
    end if;
    new.gender_changed_at := now();
    delete from room_members where user_id = new.user_id and state in ('Ladies Room', 'Mens Room');
  else
    new.gender_changed_at := old.gender_changed_at;
  end if;
  return new;
end $$;

drop trigger if exists dating_profiles_gender_guard on public.dating_profiles;
create trigger dating_profiles_gender_guard before insert or update of gender, gender_changed_at on public.dating_profiles
  for each row execute function dating_private.guard_gender_change();
