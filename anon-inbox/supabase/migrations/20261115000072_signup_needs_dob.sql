-- 18+ gate (security report F2, 15 Nov 2026): a dating profile could be created with just a typed age and
-- no date of birth; the date-of-birth rules only ran when the profile was edited afterwards.
-- Step 1 of 2: a sign-up function that requires the date of birth and saves it in the same step
-- (the age is worked out from it, and the age guard trigger refuses anyone under 18).
-- Step 2 (…073) switches off the old age-only version once the app uses this one.

create function public.create_my_profile(p_name text, p_gender public.dating_gender, p_birth_date date,
                                         p_location text, p_intent public.dating_intent)
returns table (handle text)
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  new_handle text;
  yrs int;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from auth.users u where u.id = uid and u.email_confirmed_at is not null) then
    raise exception 'Verify your email first.' using errcode = '28000';
  end if;
  if p_birth_date is null then raise exception 'Enter your date of birth.' using errcode = '22023'; end if;
  if p_birth_date > current_date or p_birth_date < current_date - interval '120 years' then
    raise exception 'That date of birth isn’t valid.' using errcode = '22023';
  end if;
  yrs := years_old(p_birth_date);
  if yrs < 18 then raise exception 'treehouse is only for people 18 and over.' using errcode = '22023'; end if;
  if exists (select 1 from dating_profiles where user_id = uid) then
    raise exception 'You already have a dating profile.' using errcode = '23505';
  end if;
  new_handle := dating_new_handle();
  insert into dating_profiles (user_id, name, gender, age, birth_date, location, intent, handle)
  values (uid, btrim(p_name), p_gender, yrs, p_birth_date, btrim(coalesce(p_location, '')), p_intent, new_handle);
  return query select new_handle;
end $$;
revoke all on function public.create_my_profile(text, public.dating_gender, date, text, public.dating_intent) from public, anon;
grant execute on function public.create_my_profile(text, public.dating_gender, date, text, public.dating_intent) to authenticated;
