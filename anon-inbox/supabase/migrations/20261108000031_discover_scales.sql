-- Discover that stays fast as treehouse grows.
--  * Only people active in the last 30 days are considered (people who already like you: 60 days).
--  * Indexes let the database read the most recently active matching people first and stop as soon
--    as it has enough, instead of sorting every profile on every call.
--  * p_exclude: handles the phone already has (shown or decided this session), so the next batch
--    continues where the last one ended. No timestamps are sent to phones.
-- Ranking is unchanged: online first, then people who like you, then most recently active.

create index if not exists dating_profiles_discover on public.dating_profiles (gender, last_seen_at desc nulls last)
  where is_active and not suspended;
create index if not exists dating_profiles_discover_state on public.dating_profiles (state, gender, last_seen_at desc nulls last)
  where is_active and not suspended;

drop function public.discover_cards(int);
create function public.discover_cards(p_limit int default 20, p_exclude text[] default null)
returns table (handle text, gender public.dating_gender, age int, location text, intent public.dating_intent,
               bio text, interests text[], online boolean, active_hours int)
language sql stable security definer set search_path = public, dating_private as $$
  with me as (select * from dating_profiles where user_id = auth.uid()),
  lim as (select least(greatest(coalesce(p_limit, 20), 1), 50) as n),
  -- People who already like you (a small list, found through the incoming-likes index).
  likers as (
    select p.*, true as likes_me
    from me
    join dating_likes l on l.to_user = me.user_id and l.liked
    join dating_profiles p on p.user_id = l.from_user
    where p.is_active and not p.suspended
      and p.last_seen_at > now() - interval '60 days'
      and p.gender = any (me.interested_in) and me.gender = any (p.interested_in)
      and p.age between me.min_age and me.max_age
      and (me.pref_state is null or p.state = me.pref_state)
      and not (p.handle = any (coalesce(p_exclude[1:300], '{}'::text[])))
      and not exists (select 1 from dating_likes m where m.from_user = me.user_id and m.to_user = p.user_id)
      and not exists (select 1 from dating_conversations c where c.user_a = least(me.user_id, p.user_id) and c.user_b = greatest(me.user_id, p.user_id))
      and not exists (select 1 from dating_blocks b where b.blocker_id = me.user_id and b.blocked_id = p.user_id)
      and not exists (select 1 from dating_blocks b where b.blocker_id = p.user_id and b.blocked_id = me.user_id)
    order by p.last_seen_at desc nulls last
    limit (select n from lim)
  ),
  -- Everyone else, most recently active first; the index lets this stop after enough matches.
  recent as (
    select p.*, false as likes_me
    from me
    join dating_profiles p on p.user_id <> me.user_id
    where p.is_active and not p.suspended
      and p.gender = any (me.interested_in)
      and (me.pref_state is null or p.state = me.pref_state)
      and p.last_seen_at > now() - interval '30 days'
      and me.gender = any (p.interested_in)
      and p.age between me.min_age and me.max_age
      and not (p.handle = any (coalesce(p_exclude[1:300], '{}'::text[])))
      and not exists (select 1 from dating_likes m where m.from_user = me.user_id and m.to_user = p.user_id)
      and not exists (select 1 from dating_conversations c where c.user_a = least(me.user_id, p.user_id) and c.user_b = greatest(me.user_id, p.user_id))
      and not exists (select 1 from dating_blocks b where b.blocker_id = me.user_id and b.blocked_id = p.user_id)
      and not exists (select 1 from dating_blocks b where b.blocker_id = p.user_id and b.blocked_id = me.user_id)
    order by p.last_seen_at desc nulls last
    limit (select n from lim)
  ),
  pool as (
    select * from likers
    union all
    select r.* from recent r where not exists (select 1 from likers k where k.user_id = r.user_id)
  )
  select p.handle, p.gender, p.age, coalesce(nullif(p.location, ''), p.state, ''), p.intent, p.bio, p.interests,
         is_online(p.last_seen_at), hours_since(p.last_seen_at)
  from pool p
  order by is_online(p.last_seen_at) desc, p.likes_me desc, p.last_seen_at desc nulls last, p.created_at desc, p.handle
  limit (select n from lim);
$$;
revoke execute on function public.discover_cards(int, text[]) from public, anon;
grant execute on function public.discover_cards(int, text[]) to authenticated;
