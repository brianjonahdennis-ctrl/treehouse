-- Birthdays (Hydra, 14 Nov 2026): opt-in, day only.
-- * Off by default. A member switches on "Show my birthday" in Profile (needs a date of birth).
-- * Others never see the date: only "Today is their birthday 🎂", and only on the day itself
--   (Lagos time). People born on 29 Feb celebrate on 28 Feb in other years.
-- * Not shown for suspended or under-18-marked profiles.

set lock_timeout = '5s';

alter table public.dating_profiles add column if not exists birthday_public boolean not null default false;
grant update (birthday_public) on public.dating_profiles to authenticated;

create or replace function dating_private.birthday_today(p_user uuid) returns boolean
language sql stable security definer set search_path = public, dating_private as $$
  with t as (select (now() at time zone 'Africa/Lagos')::date d)
  select coalesce((
    select p.birthday_public and not p.suspended and p.dob_underage_at is null and p.birth_date is not null
       and (to_char(p.birth_date, 'MM-DD') = to_char(t.d, 'MM-DD')
            or (to_char(p.birth_date, 'MM-DD') = '02-29' and to_char(t.d, 'MM-DD') = '02-28'
                and extract(day from (date_trunc('year', t.d) + interval '1 month 28 days')) <> 29))
    from dating_profiles p, t where p.user_id = p_user), false) $$;
revoke all on function dating_private.birthday_today(uuid) from public, anon, authenticated;

-- Badges (profiles, lists, chat headers) now also say whether today is their birthday.
create or replace function dating_private.badge_for(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select jsonb_build_object(
    'level', coalesce((select level from bird_kingdom where user_id = p_user), 1),
    'rating', (select case when established then round(score, 1) end from reputation where user_id = p_user),
    'ratings', coalesce((select valid_count from reputation where user_id = p_user), 0),
    'birthday', birthday_today(p_user)) $$;

-- Chatroom announcement: who in my room (still active there) has a birthday today.
create or replace function public.room_birthdays() returns table (handle text)
language sql stable security definer set search_path = public, dating_private as $$
  select o.handle
  from room_members m
  join room_members o on o.state = m.state and room_active(o.last_seen_at)
  where m.user_id = auth.uid() and room_active(m.last_seen_at) and birthday_today(o.user_id)
  limit 20 $$;
revoke execute on function public.room_birthdays() from public, anon;
grant execute on function public.room_birthdays() to authenticated;
