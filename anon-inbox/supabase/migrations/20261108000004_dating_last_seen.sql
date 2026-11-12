-- Last active: "Online" (green dot) or "Active 3h ago" on Discover cards and in chats.
-- Only a coarse value ever leaves the database: online yes/no (seen in the last 5 minutes) and
-- whole hours since last seen. The exact timestamp stays private.

alter table public.dating_profiles add column last_seen_at timestamptz;
-- Not in any column grant, so people can't set it directly; only touch_last_seen() writes it.

-- Called by the app every couple of minutes while it's open. Writes at most once a minute per person,
-- so the heartbeat stays cheap.
create function public.touch_last_seen() returns void
language sql security definer set search_path = public as $$
  update dating_profiles set last_seen_at = now()
  where user_id = auth.uid()
    and (last_seen_at is null or last_seen_at < now() - interval '1 minute');
$$;
revoke execute on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;

create function dating_private.is_online(seen timestamptz) returns boolean
language sql stable as $$ select seen is not null and seen > now() - interval '5 minutes' $$;
create function dating_private.hours_since(seen timestamptz) returns int
language sql stable as $$ select case when seen is null then null else floor(extract(epoch from now() - seen) / 3600)::int end $$;

-- Discover cards, now with online + active_hours.
drop function public.discover_cards(int);
create function public.discover_cards(p_limit int default 20)
returns table (handle text, gender public.dating_gender, age int, location text, intent public.dating_intent,
               bio text, interests text[], online boolean, active_hours int)
language sql stable security definer set search_path = public, dating_private as $$
  select p.handle, p.gender, p.age, coalesce(nullif(p.location, ''), p.state, ''), p.intent, p.bio, p.interests,
         is_online(p.last_seen_at), hours_since(p.last_seen_at)
  from dating_profiles me
  join dating_profiles p on p.user_id <> me.user_id
  where me.user_id = auth.uid()
    and p.is_active and not p.suspended
    and p.gender = any (me.interested_in) and me.gender = any (p.interested_in)
    and p.age between me.min_age and me.max_age
    and (me.pref_state is null or p.state = me.pref_state)
    and not exists (select 1 from dating_likes l where l.from_user = me.user_id and l.to_user = p.user_id)
    and dating_conversation_between(me.user_id, p.user_id) is null
    and not dating_is_blocked(me.user_id, p.user_id)
  order by exists (select 1 from dating_likes l where l.from_user = p.user_id and l.to_user = me.user_id and l.liked) desc,
           p.created_at desc, p.handle
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
revoke execute on function public.discover_cards(int) from public, anon;
grant execute on function public.discover_cards(int) to authenticated;

-- Chat list, now with the other person's online + active_hours (hidden when either has blocked).
drop function public.my_conversations();
create function public.my_conversations()
returns table (
  conversation_id uuid, other_handle text, other_gender public.dating_gender, other_age int,
  other_location text, other_intent public.dating_intent, last_message text, last_from_me boolean,
  last_at timestamptz, unread int, i_revealed boolean, they_revealed boolean, blocked boolean, i_blocked boolean,
  status text, other_online boolean, other_active_hours int
)
language sql stable security definer set search_path = public, dating_private as $$
  select c.id,
         p.handle, p.gender, p.age, p.location, p.intent,
         m.body, m.sender_id = auth.uid(), coalesce(m.created_at, c.created_at),
         (select count(*)::int from dating_messages x
           where x.conversation_id = c.id and x.sender_id = o.uid
             and x.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)),
         exists (select 1 from dating_reveals v where v.conversation_id = c.id and v.user_id = auth.uid()),
         exists (select 1 from dating_reveals v where v.conversation_id = c.id and v.user_id = o.uid),
         bl.blocked,
         exists (select 1 from dating_blocks b where b.blocker_id = auth.uid() and b.blocked_id = o.uid),
         case when c.accepted_at is not null then 'chat'
              when c.started_by = auth.uid() then 'sent'
              else 'request' end,
         case when bl.blocked then false else is_online(p.last_seen_at) end,
         case when bl.blocked then null else hours_since(p.last_seen_at) end
  from dating_conversations c
  cross join lateral (select case when c.user_a = auth.uid() then c.user_b else c.user_a end as uid) o
  left join dating_profiles p on p.user_id = o.uid
  cross join lateral (select dating_is_blocked(auth.uid(), o.uid) or coalesce(p.suspended, false) as blocked) bl
  left join dating_reads r on r.conversation_id = c.id and r.user_id = auth.uid()
  left join lateral (
    select body, sender_id, created_at from dating_messages where conversation_id = c.id order by created_at desc, id desc limit 1
  ) m on true
  where auth.uid() in (c.user_a, c.user_b)
    and not (c.accepted_at is null and c.declined_at is not null and c.started_by is distinct from auth.uid())
  order by coalesce(m.created_at, c.created_at) desc;
$$;
revoke execute on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;
