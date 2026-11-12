-- Support: let an admin reset someone's 365-day date-of-birth clock (e.g. "I typed my birthday
-- wrong"). People still can't touch it themselves; birthdays still don't restart it.

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
      -- A birthday (the server's refresh), not a change of mind: the 365-day clock doesn't restart.
      if new.age_changed_at is not distinct from old.age_changed_at then new.age_changed_at := old.age_changed_at; end if;
    end if;
  elsif by_user then
    new.age_changed_at := old.age_changed_at;   -- people can't move their own clock; admins can (support)
  end if;

  if new.age is distinct from old.age then
    delete from room_members where user_id = new.user_id and state = any (age_rooms()) and state is distinct from age_room_for(new.age);
  end if;
  return new;
end $$;

