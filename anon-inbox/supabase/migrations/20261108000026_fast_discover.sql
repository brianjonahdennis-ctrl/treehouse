-- Speed: discover_cards was the top CPU user. Same rules and order as before, but likes, chats and
-- blocks are checked in bulk (anti-joins) instead of one helper call per profile.
create or replace function public.discover_cards(p_limit int default 20)
returns table (handle text, gender public.dating_gender, age int, location text, intent public.dating_intent,
               bio text, interests text[], online boolean, active_hours int)
language sql stable security definer set search_path = public, dating_private as $$
  with me as (select * from dating_profiles where user_id = auth.uid())
  select p.handle, p.gender, p.age, coalesce(nullif(p.location, ''), p.state, ''), p.intent, p.bio, p.interests,
         is_online(p.last_seen_at), hours_since(p.last_seen_at)
  from me
  join dating_profiles p on p.user_id <> me.user_id
  where p.is_active and not p.suspended
    and p.gender = any (me.interested_in) and me.gender = any (p.interested_in)
    and p.age between me.min_age and me.max_age
    and (me.pref_state is null or p.state = me.pref_state)
    and not exists (select 1 from dating_likes l where l.from_user = me.user_id and l.to_user = p.user_id)
    and not exists (select 1 from dating_conversations c where c.user_a = least(me.user_id, p.user_id) and c.user_b = greatest(me.user_id, p.user_id))
    and not exists (select 1 from dating_blocks b where b.blocker_id = me.user_id and b.blocked_id = p.user_id)
    and not exists (select 1 from dating_blocks b where b.blocker_id = p.user_id and b.blocked_id = me.user_id)
  order by (p.last_seen_at > now() - interval '5 minutes') desc nulls last,
           exists (select 1 from dating_likes l where l.from_user = p.user_id and l.to_user = me.user_id and l.liked) desc,
           p.last_seen_at desc nulls last,
           p.created_at desc, p.handle
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
