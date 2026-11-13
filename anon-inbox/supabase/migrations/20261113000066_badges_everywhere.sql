-- Badges everywhere a profile appears (Hydra, 13 Nov 2026): the number of ratings is always shown in
-- brackets, also for new members ("★ New member (2)"). The score itself still only appears once
-- established. Adds a lookup by dating nickname for Discover and Nearby cards.

set lock_timeout = '5s';

create or replace function dating_private.badge_for(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select jsonb_build_object(
    'level', coalesce((select level from bird_kingdom where user_id = p_user), 1),
    'rating', (select case when established then round(score, 1) end from reputation where user_id = p_user),
    'ratings', coalesce((select valid_count from reputation where user_id = p_user), 0)) $$;

-- Discover / Nearby: people visible there (active, not suspended, not blocked either way).
create or replace function public.badges_for_handles(p_handles text[]) returns table (handle text, badge jsonb)
language sql stable security definer set search_path = public, dating_private as $$
  select p.handle, badge_for(p.user_id)
  from dating_profiles p
  where p.handle = any (p_handles[1:200]) and p.is_active and not p.suspended
    and auth.uid() is not null and not dating_is_blocked(auth.uid(), p.user_id) $$;
revoke execute on function public.badges_for_handles(text[]) from public, anon;
grant execute on function public.badges_for_handles(text[]) to authenticated;
