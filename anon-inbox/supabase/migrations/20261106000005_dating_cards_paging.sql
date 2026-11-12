-- Dating cards in pages: discover_profiles(limit, offset), newest first with a stable order.
drop function public.discover_profiles(int);
create function public.discover_profiles(p_limit int default 30, p_offset int default 0)
returns table (handle text, gender public.dating_gender, age int, location text, intent public.dating_intent)
language sql stable security definer set search_path = public, dating_private as $$
  select p.handle, p.gender, p.age, p.location, p.intent
  from dating_profiles p
  where p.is_active and not p.suspended
    and p.user_id is distinct from auth.uid()
    and (auth.uid() is null or not dating_is_blocked(auth.uid(), p.user_id))
  order by p.created_at desc, p.handle
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
revoke execute on function public.discover_profiles(int, int) from public;
grant execute on function public.discover_profiles(int, int) to anon, authenticated;
