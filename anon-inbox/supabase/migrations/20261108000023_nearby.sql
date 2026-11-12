-- Nearby: find people around you, as a list or on a map. Privacy first:
--  * Off by default. You only appear (and can only browse) after you switch Nearby on.
--  * Exact GPS is never stored. The phone's position is snapped to a ~1 km grid and moved by a fixed,
--    secret, per-person random offset inside that cell; only that protected point is saved.
--  * Distances are worked out here, from protected points only. Nobody ever receives raw coordinates.
--  * One row per person (no history). Turning Nearby off deletes it; positions older than 7 days expire.
--  * Pause, Hide my distance and Hide me on the map; blocked people never see each other.

create table dating_private.nearby (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  plat           double precision not null,   -- protected point (never the real position)
  plng           double precision not null,
  updated_at     timestamptz not null default now(),
  paused         boolean not null default false,
  hide_distance  boolean not null default false,
  hide_on_map    boolean not null default false
);
create index nearby_box on dating_private.nearby (plat, plng);

-- Secret salt for the per-person offsets (nobody can read it through the API).
create table dating_private.nearby_secret (id int primary key default 1 check (id = 1), salt text not null);
insert into dating_private.nearby_secret (salt) values (encode(extensions.gen_random_bytes(32), 'hex')) on conflict do nothing;

create function dating_private.nearby_protect(uid uuid, lat double precision, lng double precision, out plat double precision, out plng double precision)
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  step_lat constant double precision := 0.009;                 -- ~1 km
  step_lng double precision := 0.009 / greatest(cos(radians(lat)), 0.2);
  ci bigint := floor(lat / step_lat);
  cj bigint := floor(lng / step_lng);
  h text := md5(uid::text || ':' || ci || ':' || cj || ':' || (select salt from nearby_secret));
  u double precision := ('x' || substr(h, 1, 8))::bit(32)::bigint / 4294967296.0;
  v double precision := ('x' || substr(h, 9, 8))::bit(32)::bigint / 4294967296.0;
begin
  plat := (ci + 0.15 + 0.7 * u) * step_lat;
  plng := (cj + 0.15 + 0.7 * v) * step_lng;
end $$;

create function dating_private.km_between(a_lat double precision, a_lng double precision, b_lat double precision, b_lng double precision)
returns double precision language sql immutable as $$
  select 6371 * 2 * asin(sqrt(power(sin(radians(b_lat - a_lat) / 2), 2)
         + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2)));
$$;

-- ---- Your settings -------------------------------------------------------------------------------
create function public.nearby_settings()
returns table (enabled boolean, paused boolean, hide_distance boolean, hide_on_map boolean, updated_at timestamptz,
               area_lat double precision, area_lng double precision)
language sql stable security definer set search_path = public, dating_private as $$
  select n.user_id is not null, coalesce(n.paused, false), coalesce(n.hide_distance, false), coalesce(n.hide_on_map, false), n.updated_at,
         round(n.plat::numeric, 4)::double precision, round(n.plng::numeric, 4)::double precision
  from (select auth.uid() as uid) me
  left join nearby n on n.user_id = me.uid and n.updated_at > now() - interval '7 days';
$$;

-- Share your approximate area (called only after you switch Nearby on, and when you refresh it).
create function public.nearby_set_location(p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  pt record;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from dating_profiles where user_id = auth.uid() and not suspended) then
    raise exception 'Create your dating card first.' using errcode = '28000';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -85 and 85 or p_lng not between -180 and 180 then
    raise exception 'That location isn''t valid.' using errcode = '22023';
  end if;
  select * into pt from nearby_protect(auth.uid(), p_lat, p_lng);
  insert into nearby (user_id, plat, plng) values (auth.uid(), pt.plat, pt.plng)
  on conflict (user_id) do update set plat = excluded.plat, plng = excluded.plng, updated_at = now();
  -- Housekeeping: forget stale positions.
  if random() < 0.05 then delete from nearby where updated_at < now() - interval '7 days'; end if;
end $$;

-- Change settings. Turning Nearby off deletes your position straight away.
create function public.nearby_update_settings(p_enabled boolean default null, p_paused boolean default null,
                                              p_hide_distance boolean default null, p_hide_on_map boolean default null) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if p_enabled is false then delete from nearby where user_id = auth.uid(); return; end if;
  update nearby set paused = coalesce(p_paused, paused), hide_distance = coalesce(p_hide_distance, hide_distance),
                    hide_on_map = coalesce(p_hide_on_map, hide_on_map)
  where user_id = auth.uid();
end $$;

-- ---- Browsing -----------------------------------------------------------------------------------
create function public.nearby_people(p_radius_km int default 10, p_min_age int default null, p_max_age int default null,
                                     p_genders text[] default null, p_interests text[] default null,
                                     p_sort text default 'distance', p_limit int default 100)
returns table (handle text, gender public.dating_gender, age int, location text, intent public.dating_intent, bio text,
               interests text[], online boolean, active_hours int, distance_km double precision,
               map_lat double precision, map_lng double precision, liked_me boolean, i_liked boolean, conversation_id uuid)
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  me_n nearby%rowtype;
  me_p dating_profiles%rowtype;
  r double precision := least(greatest(coalesce(p_radius_km, 10), 1), 50);
  dlat double precision;
  dlng double precision;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into me_p from dating_profiles where user_id = uid;
  if not found or me_p.suspended then raise exception 'Create your dating card first.' using errcode = '28000'; end if;
  select * into me_n from nearby where user_id = uid and updated_at > now() - interval '7 days';
  if not found then raise exception 'Turn on Nearby to see people around you.' using errcode = 'P0002'; end if;
  if me_n.paused then raise exception 'Nearby is paused. Resume it to see people around you.' using errcode = 'P0001'; end if;
  dlat := r / 111.0;
  dlng := r / (111.0 * greatest(cos(radians(me_n.plat)), 0.2));
  return query
    select p.handle, p.gender, p.age, coalesce(nullif(p.location, ''), p.state, ''), p.intent, p.bio, p.interests,
           is_online(p.last_seen_at), hours_since(p.last_seen_at),
           case when n.hide_distance then null
                else round(greatest(km_between(me_n.plat, me_n.plng, n.plat, n.plng), 0.5)::numeric, 1)::double precision end,
           case when n.hide_distance or n.hide_on_map then null else round(n.plat::numeric, 4)::double precision end,
           case when n.hide_distance or n.hide_on_map then null else round(n.plng::numeric, 4)::double precision end,
           exists (select 1 from dating_likes l where l.from_user = p.user_id and l.to_user = uid and l.liked),
           exists (select 1 from dating_likes l where l.from_user = uid and l.to_user = p.user_id and l.liked),
           dating_conversation_between(uid, p.user_id)
    from nearby n
    join dating_profiles p on p.user_id = n.user_id
    where n.user_id <> uid
      and not n.paused and n.updated_at > now() - interval '7 days'
      and n.plat between me_n.plat - dlat and me_n.plat + dlat
      and n.plng between me_n.plng - dlng and me_n.plng + dlng
      and km_between(me_n.plat, me_n.plng, n.plat, n.plng) <= r
      and p.is_active and not p.suspended
      and not dating_is_blocked(uid, p.user_id)
      and p.age between coalesce(p_min_age, me_p.min_age, 18) and coalesce(p_max_age, me_p.max_age, 120)
      and (coalesce(cardinality(p_genders), 0) = 0 or p.gender::text = any (p_genders))
      and (coalesce(cardinality(p_interests), 0) = 0 or p.interests && p_interests)
    order by case when p_sort = 'active' then is_online(p.last_seen_at) end desc nulls last,
             case when p_sort = 'active' then p.last_seen_at end desc nulls last,
             km_between(me_n.plat, me_n.plng, n.plat, n.plng),
             p.handle
    limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ---- Safety from a Nearby profile (no chat needed) -------------------------------------------------
create function public.block_profile(p_handle text) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  other uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select user_id into other from dating_profiles where handle = p_handle;
  if other is null or other = auth.uid() then raise exception 'That profile is not available.' using errcode = 'P0002'; end if;
  insert into dating_blocks (blocker_id, blocked_id) values (auth.uid(), other) on conflict do nothing;
end $$;

create function public.report_profile(p_handle text, p_reason text, p_details text default '') returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  other uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select user_id into other from dating_profiles where handle = p_handle;
  if other is null or other = auth.uid() then raise exception 'That profile is not available.' using errcode = 'P0002'; end if;
  if (select count(*) from dating_reports where reporter_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many reports. Try again later.' using errcode = 'P0001';
  end if;
  insert into dating_reports (reporter_id, reported_id, reason, details)
  values (auth.uid(), other, p_reason, left(coalesce(p_details, ''), 1000));
end $$;

revoke all on table dating_private.nearby, dating_private.nearby_secret from public, anon, authenticated;
revoke execute on function dating_private.nearby_protect(uuid, double precision, double precision) from public, anon, authenticated;
revoke execute on function public.nearby_settings(), public.nearby_set_location(double precision, double precision),
  public.nearby_update_settings(boolean, boolean, boolean, boolean),
  public.nearby_people(int, int, int, text[], text[], text, int),
  public.block_profile(text), public.report_profile(text, text, text) from public, anon;
grant execute on function public.nearby_settings(), public.nearby_set_location(double precision, double precision),
  public.nearby_update_settings(boolean, boolean, boolean, boolean),
  public.nearby_people(int, int, int, text[], text[], text, int),
  public.block_profile(text), public.report_profile(text, text, text) to authenticated;
