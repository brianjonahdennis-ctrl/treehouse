-- People save their own date of birth from the app (sign-up, age rooms, Edit profile). Profiles
-- only allow edits to listed columns, so add birth_date. The rules (18+, once every 365 days,
-- under-18 suspends) are enforced by the dating_profiles_age_guard trigger from 20261112000054.
grant update (birth_date) on public.dating_profiles to authenticated;
