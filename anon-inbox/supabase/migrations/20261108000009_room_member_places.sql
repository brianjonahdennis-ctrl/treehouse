-- Chatroom members dropdown (new design): each member's place (from their dating card, or the
-- room's state) and whether they can get a message request (they have an active dating card).

drop function public.room_people();
create function public.room_people()
returns table (handle text, me boolean, dating boolean, place text)
language sql stable security definer set search_path = public, dating_private as $$
  select o.handle, o.user_id = auth.uid(),
         coalesce(p.is_active and not p.suspended, false),
         coalesce(nullif(btrim(p.location), ''), o.state)
  from room_members m
  join room_members o on o.state = m.state and room_active(o.last_seen_at)
  left join dating_profiles p on p.user_id = o.user_id
  where m.user_id = auth.uid() and room_active(m.last_seen_at)
  order by o.user_id = auth.uid() desc, o.joined_at
  limit 100;
$$;

drop function public.room_profile(text);
create function public.room_profile(p_handle text)
returns table (handle text, room text, online boolean, age int, gender public.dating_gender, bio text,
               interests text[], dating boolean, me boolean, place text)
language sql stable security definer set search_path = public, dating_private as $$
  select o.handle, o.state, room_active(o.last_seen_at),
         p.age, p.gender, p.bio, p.interests,
         coalesce(p.is_active and not p.suspended, false),
         o.user_id = auth.uid(),
         coalesce(nullif(btrim(p.location), ''), o.state)
  from room_members m
  join room_members o on o.state = m.state and o.handle = p_handle
  left join dating_profiles p on p.user_id = o.user_id
  where m.user_id = auth.uid() and room_active(m.last_seen_at)
  limit 1;
$$;

revoke execute on function public.room_people(), public.room_profile(text) from public, anon;
grant execute on function public.room_people(), public.room_profile(text) to authenticated;
