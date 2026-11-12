-- Age rooms and date of birth.
--
-- Age rooms: "Ages 18-25", "Ages 26-35" and "Ages 36+". General rooms everyone sees in the chatroom
-- list; you can only join the one for your age, and only once you've given your date of birth
-- (the app shows them blurred until then). Trying another says "You are too old for this group."
-- or "You are too young for this group."
--
-- Date of birth: asked at sign-up, and before joining an age room. Nobody is forced to add it otherwise.
-- Age is worked out from it (Nigeria time), so people move up an age room as they get older; the
-- treehouse server refreshes ages every day. Date of birth is private: only its owner can read it.
--   * Under 18 → the profile is suspended and marked, and can't try another date.
--   * The first date of birth is always accepted (18+). After that it can change once every 365 days.
--   * Without a date of birth yet, typing a new age directly is also limited to once every 365 days
--     (counted from sign-up), so nobody can hop age rooms in the meantime.
--   * Changing age takes you out of an age room you no longer fit.
-- Also closes a gap: people could edit their own `suspended` flag. Only the database/admins can now.

set lock_timeout = '5s';

-- ---- Age helpers ------------------------------------------------------------------------------------
create or replace function dating_private.years_old(p_dob date) returns int
language sql stable as $$
  select extract(year from age((now() at time zone 'Africa/Lagos')::date, p_dob))::int
$$;

create or replace function dating_private.age_rooms() returns text[]
language sql immutable as $$ select array['Ages 18-25', 'Ages 26-35', 'Ages 36+'] $$;

create or replace function dating_private.age_room_for(p_age int) returns text
language sql immutable as $$
  select case when p_age between 18 and 25 then 'Ages 18-25'
              when p_age between 26 and 35 then 'Ages 26-35'
              when p_age >= 36 then 'Ages 36+' end
$$;

-- ---- Profile columns -------------------------------------------------------------------------------
alter table public.dating_profiles add column if not exists birth_date date;
alter table public.dating_profiles add column if not exists age_changed_at timestamptz;
alter table public.dating_profiles add column if not exists dob_underage_at timestamptz;
update public.dating_profiles set age_changed_at = created_at where age_changed_at is null;

-- ---- The rules, enforced whoever edits the row ------------------------------------------------------
create or replace function dating_private.guard_age_change() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare
  by_user boolean := auth.uid() is not null;   -- the person themselves (not the server or an admin)
  yrs int;
begin
  if tg_op = 'INSERT' then
    new.age_changed_at := now();
    if by_user then new.suspended := false; new.dob_underage_at := null; end if;
    if new.birth_date is not null then
      yrs := years_old(new.birth_date);
      if yrs < 18 then raise exception 'treehouse is only for people 18 and over.' using errcode = '22023'; end if;
      new.age := yrs;
    end if;
    return new;
  end if;

  -- People can't lift their own suspension or under-18 mark.
  if by_user then
    new.suspended := old.suspended;
    new.dob_underage_at := old.dob_underage_at;
  end if;

  if new.birth_date is distinct from old.birth_date then
    if by_user then
      if old.dob_underage_at is not null then
        raise exception 'treehouse is only for people 18 and over.' using errcode = '42501';
      end if;
      if new.birth_date is null then raise exception 'Your date of birth is required.' using errcode = '22023'; end if;
      if new.birth_date < date '1900-01-01' or new.birth_date > (now() at time zone 'Africa/Lagos')::date then
        raise exception 'Enter your real date of birth.' using errcode = '22023';
      end if;
      if old.birth_date is not null and old.age_changed_at > now() - interval '365 days' then
        raise exception 'You can change your date of birth once every 365 days. You can change it again on %.',
          to_char(old.age_changed_at + interval '365 days', 'FMDD Mon YYYY') using errcode = 'P0001';
      end if;
    end if;
    yrs := years_old(new.birth_date);
    if yrs < 18 then
      -- Under 18: keep the date they gave, suspend the profile, and don't let them try again.
      new.dob_underage_at := now();
      new.suspended := true;
      new.age := old.age;
      delete from room_members where user_id = new.user_id;
      return new;
    end if;
    new.age := yrs;
    new.age_changed_at := now();
  elsif new.age is distinct from old.age then
    if by_user then
      if old.birth_date is not null then
        raise exception 'Your age comes from your date of birth.' using errcode = 'P0001';
      end if;
      if old.age_changed_at is not null and old.age_changed_at > now() - interval '365 days' then
        raise exception 'You can change your age once every 365 days. You can change it again on %.',
          to_char(old.age_changed_at + interval '365 days', 'FMDD Mon YYYY') using errcode = 'P0001';
      end if;
      new.age_changed_at := now();
    else
      new.age_changed_at := old.age_changed_at;   -- a birthday, not a change of mind
    end if;
  else
    new.age_changed_at := old.age_changed_at;
  end if;

  if new.age is distinct from old.age then
    delete from room_members where user_id = new.user_id and state = any (age_rooms()) and state is distinct from age_room_for(new.age);
  end if;
  return new;
end $$;

drop trigger if exists dating_profiles_age_guard on public.dating_profiles;
create trigger dating_profiles_age_guard
  before insert or update of age, birth_date, age_changed_at, suspended, dob_underage_at on public.dating_profiles
  for each row execute function dating_private.guard_age_change();

-- Birthdays: the treehouse server calls this daily so ages (and age rooms) stay right.
create or replace function public.admin_refresh_ages(p_key text) returns int
language plpgsql security definer set search_path = public, dating_private as $$
declare n int;
begin
  if not admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  update dating_profiles set age = years_old(birth_date)
  where birth_date is not null and dob_underage_at is null and age is distinct from years_old(birth_date) and years_old(birth_date) >= 18;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.admin_refresh_ages(text) from public, authenticated;
grant execute on function public.admin_refresh_ages(text) to anon;

-- ---- Rooms -------------------------------------------------------------------------------------------
-- Your current age from your date of birth (null until you've given one: no age rooms yet).
create or replace function dating_private.age_now(p_user uuid) returns int
language sql stable security definer set search_path = public, dating_private as $$
  select years_old(p.birth_date) from dating_profiles p where p.user_id = p_user and p.dob_underage_at is null
$$;

create or replace function dating_private.general_rooms() returns text[]
language sql immutable as $$
  select array['Nigeria', 'Ages 18-25', 'Ages 26-35', 'Ages 36+', 'Lovers Lounge', 'Ladies Room', 'Mens Room',
               'Football Banter', 'Christian Room', 'Muslim Room']
$$;

-- Rooms you can JOIN.
create or replace function dating_private.my_rooms(p_user uuid) returns text[]
language sql stable security definer set search_path = public, dating_private as $$
  select coalesce((select array[p.state] || uni_rooms_for(p.state) from dating_profiles p where p.user_id = p_user and p.state is not null), '{}')
      || array(
           select r from unnest(general_rooms()) with ordinality as g(r, ord)
           where (r <> 'Ladies Room' or exists (select 1 from dating_profiles p where p.user_id = p_user and p.gender = 'female'))
             and (r <> 'Mens Room'   or exists (select 1 from dating_profiles p where p.user_id = p_user and p.gender = 'male'))
             and (not (r = any (age_rooms())) or age_room_for(age_now(p_user)) = r)
           order by ord);
$$;

-- Rooms you SEE in the list: the ones you can join, plus every age room.
create or replace function dating_private.visible_rooms(p_user uuid) returns text[]
language sql stable security definer set search_path = public, dating_private as $$
  select coalesce((select array[p.state] || uni_rooms_for(p.state) from dating_profiles p where p.user_id = p_user and p.state is not null), '{}')
      || array(
           select g from unnest(general_rooms()) with ordinality as t(g, ord)
           where g = any (my_rooms(p_user)) or g = any (age_rooms())
           order by ord);
$$;
revoke execute on function dating_private.visible_rooms(uuid) from public, anon, authenticated;

-- Why you can't join a room. Age rooms answer for the person asking.
create or replace function dating_private.room_denied(p_room text) returns text
language sql stable security definer set search_path = public, dating_private as $$
  select case
    when p_room = any (age_rooms()) then
      case when age_now(auth.uid()) is null then 'Add your date of birth to join the age rooms.'
           when age_now(auth.uid()) > case p_room when 'Ages 18-25' then 25 when 'Ages 26-35' then 35 else 1000 end
           then 'You are too old for this group.'
           else 'You are too young for this group.' end
    when p_room = 'Ladies Room' then 'The Ladies'' Room is for women only.'
    when p_room = 'Mens Room' then 'The Men''s Room is for men only.'
    when p_room = any (uni_room_codes()) then
      'The ' || p_room || ' room is only for people in '
      || case when uni_room_state(p_room) = 'FCT' then 'Abuja (FCT)' else uni_room_state(p_room) || ' State' end || '.'
    when p_room = 'FCT' then 'This chatroom is only for people in Abuja (FCT). You can join your own state''s room or any room open to everyone.'
    else 'This chatroom is only for people in ' || p_room || ' State. You can join your own state''s room or any room open to everyone.'
  end
$$;

-- The chatroom list shows every age room; joining still checks my_rooms().
create or replace function public.room_list()
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
  from unnest(visible_rooms(auth.uid())) with ordinality as s(state, ord)
  left join room_members me on me.state = s.state and me.user_id = auth.uid() and room_active(me.last_seen_at)
  order by s.ord;
$$;
