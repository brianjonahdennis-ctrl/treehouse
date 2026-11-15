-- 18+ gate, step 2 of 2 (apply only after the app sends the date of birth at sign-up, see …072):
-- the old age-only sign-up stops creating profiles. An app page left open from before gets a clear message.
create or replace function public.create_my_profile(p_name text, p_gender public.dating_gender, p_age integer,
                                                    p_location text, p_intent public.dating_intent)
returns table (handle text)
language plpgsql security definer set search_path = public, dating_private as $$
begin
  raise exception 'Please refresh treehouse to finish signing up: we need your date of birth.' using errcode = '22023';
end $$;
