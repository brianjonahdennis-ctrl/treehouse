-- Staff console: find members by @username, and see a member's username (moderators and up).
-- Usernames (20261115000110) are private to members, but staff need them for reports like
-- "@someone keeps sending me requests". Searching "@ada" (or "ada") matches usernames starting with it.

create or replace function public.staff_members(p_q text default '', p_filter text default 'all', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  r text := staff_need('moderate');
  q text := btrim(coalesce(p_q, ''));
  by_email boolean := q like '_%@%' and staff_allows(r, 'manage');
  -- "@name" (or a bare word) also matches usernames that start with it.
  un text := lower(regexp_replace(q, '^@', ''));
  by_username boolean := un ~ '^[a-z0-9]{1,14}$';
begin
  return coalesce((select jsonb_agg(x order by x.sort_at desc nulls last) from (
    select p.handle, (select u.username from usernames u where u.user_id = p.user_id) as username, p.gender::text as gender, p.age, p.state, p.intent::text as intent, p.created_at, p.last_seen_at,
           p.suspended, p.is_active, p.dob_underage_at is not null as underage,
           (select b.until from room_bans b where b.user_id = p.user_id and b.until > now()) as room_ban_until,
           (select count(*) from dating_reports dr where dr.reported_id = p.user_id and dr.status = 'open') as open_reports,
           (select s.role from announcement_staff s where s.user_id = p.user_id) as staff_role,
           case when p_filter = 'new' then p.created_at else coalesce(p.last_seen_at, p.created_at) end as sort_at
    from dating_profiles p
    where (q = '' or (by_email and p.user_id in (select u.id from auth.users u where lower(u.email) = lower(q)))
                  or (not by_email and q not like '@%' and p.handle ilike '%' || replace(replace(q, '%', ''), '_', '\_') || '%')
                  or (not by_email and by_username and exists (select 1 from usernames u where u.user_id = p.user_id and u.username like un || '%')))
      and case coalesce(p_filter, 'all')
            when 'online' then p.last_seen_at > now() - interval '5 minutes'
            when 'new' then p.created_at > now() - interval '7 days'
            when 'suspended' then p.suspended
            when 'reported' then exists (select 1 from dating_reports dr where dr.reported_id = p.user_id and dr.status = 'open')
            when 'room_banned' then exists (select 1 from room_bans b where b.user_id = p.user_id and b.until > now())
            when 'underage' then p.dob_underage_at is not null
            when 'staff' then exists (select 1 from announcement_staff s where s.user_id = p.user_id)
            else true end
    order by case when p_filter = 'new' then p.created_at else coalesce(p.last_seen_at, p.created_at) end desc nulls last
    limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
  ) x), '[]'::jsonb);
end $$;

-- Member page: the same details as before, plus the username.
alter function public.staff_member(text) set schema dating_private;
alter function dating_private.staff_member(text) rename to staff_member_base;
revoke all on function dating_private.staff_member_base(text) from public, anon, authenticated;

create function public.staff_member(p_handle text) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare out jsonb;
begin
  out := staff_member_base(p_handle);   -- checks the role + authenticator code, and logs the view
  return out || jsonb_build_object('username',
    (select u.username from usernames u join dating_profiles p on p.user_id = u.user_id where p.handle = out ->> 'handle'));
end $$;
revoke all on function public.staff_member(text), public.staff_members(text, text, int, int) from public, anon;
grant execute on function public.staff_member(text), public.staff_members(text, text, int, int) to authenticated;
