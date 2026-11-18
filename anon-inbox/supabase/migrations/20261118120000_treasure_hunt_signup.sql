-- Treasure Hunt sign-up (Hydra, 18 Nov 2026).
--
-- * Every hunt belongs to one Nigerian state (36 + FCT). Members anywhere can SEE a hunt, but only
--   members whose profile state matches can REGISTER. Starting the hunt also checks the phone's
--   one-off location reading is within the hunt's area (join_radius_km of a checkpoint).
-- * Registering is required before starting a hunt that has a state. Registered members see how many
--   others registered (a count only, never who). Only staff see registrants' profiles.
-- * A scheduled hunt goes live by itself at its start time (the first "Start treasure hunt" flips it).
-- * Staff: live progress / final results per hunt, a message to all competitors (through the existing
--   announcements pipeline, logged in the staff audit log), and picture/video prizes.
-- Older hunts with no state keep working as before (anyone eligible can join, no registration).
set lock_timeout = '5s';

-- ---- Hunt area ---------------------------------------------------------------------------------------
alter table public.treasure_hunts
  add column if not exists state text check (state is null or state = any (dating_private.nigerian_states())),
  add column if not exists join_radius_km integer not null default 60 check (join_radius_km between 1 and 1000);

-- Existing hunts that haven't ended: take the state from the area text when exactly one state matches.
with names(word, st) as (
  select lower(s), s from unnest(dating_private.nigerian_states()) s
  union all values ('abuja', 'FCT'), ('port harcourt', 'Rivers'), ('ibadan', 'Oyo'), ('benin city', 'Edo'),
    ('uyo', 'Akwa Ibom'), ('calabar', 'Cross River'), ('owerri', 'Imo'), ('warri', 'Delta'), ('asaba', 'Delta'), ('jos', 'Plateau')
), guesses as (
  select h.id, (array_agg(distinct n.st))[1] as st, count(distinct n.st) as k
  from public.treasure_hunts h join names n on lower(h.region) ~ ('(^|[^a-z])' || n.word || '($|[^a-z])')
  where h.state is null and h.ends_at > now()
  group by h.id
)
update public.treasure_hunts h set state = g.st from guesses g where g.id = h.id and g.k = 1;

-- ---- Registrations -----------------------------------------------------------------------------------
create table if not exists public.treasure_hunt_registrations (
  hunt_id       uuid not null references public.treasure_hunts (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  state         text not null,           -- the member's profile state when they registered
  registered_at timestamptz not null default now(),
  primary key (hunt_id, user_id)
);
create index if not exists treasure_hunt_registrations_user on public.treasure_hunt_registrations (user_id, registered_at desc);
alter table public.treasure_hunt_registrations enable row level security;
revoke all on public.treasure_hunt_registrations from public, anon, authenticated;

-- Why this member can't register (null = they can). One wording for the app and the database.
create or replace function dating_private.treasure_hunt_register_block(p_user uuid, p_hunt uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when h.id is null then 'This hunt could not be found.'
    when h.status not in ('scheduled', 'active') or h.ends_at <= now() then 'Registration for this hunt is closed.'
    when h.state is null then null
    when p.state is null then 'Add your state to your profile to register for hunts near you.'
    when p.state <> h.state then 'This hunt is only for members in ' || case h.state when 'FCT' then 'FCT (Abuja)' else h.state end
      || '. Your profile says ' || case p.state when 'FCT' then 'FCT (Abuja)' else p.state end || '.'
    else null end
  from (select 1) one
  left join treasure_hunts h on h.id = p_hunt
  left join dating_profiles p on p.user_id = p_user
$$;
revoke all on function dating_private.treasure_hunt_register_block(uuid, uuid) from public, anon, authenticated;

-- The rule lives on the table too, so no code path can add a registration from the wrong state.
create or replace function dating_private.treasure_hunt_registration_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare why text;
begin
  why := dating_private.treasure_hunt_register_block(new.user_id, new.hunt_id);
  if why is not null then raise exception '%', why using errcode = '42501'; end if;
  new.state := (select state from dating_profiles where user_id = new.user_id);
  if new.state is null then new.state := coalesce((select state from treasure_hunts where id = new.hunt_id), 'Nigeria'); end if;
  return new;
end $$;
revoke all on function dating_private.treasure_hunt_registration_guard() from public, anon, authenticated;
drop trigger if exists treasure_hunt_registration_guard on public.treasure_hunt_registrations;
create trigger treasure_hunt_registration_guard before insert on public.treasure_hunt_registrations
  for each row execute function dating_private.treasure_hunt_registration_guard();

-- A player can only start a hunt that has a state after registering for it (insert only: progress
-- updates on existing players are untouched).
create or replace function dating_private.treasure_hunt_participant_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from treasure_hunts h where h.id = new.hunt_id and h.state is not null)
     and not exists (select 1 from treasure_hunt_registrations r where r.hunt_id = new.hunt_id and r.user_id = new.user_id) then
    raise exception 'Register for this hunt first.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function dating_private.treasure_hunt_participant_guard() from public, anon, authenticated;
drop trigger if exists treasure_hunt_participant_guard on public.treasure_hunt_participants;
create trigger treasure_hunt_participant_guard before insert on public.treasure_hunt_participants
  for each row execute function dating_private.treasure_hunt_participant_guard();

-- ---- Prizes (pictures and videos) ---------------------------------------------------------------------
create table if not exists public.treasure_hunt_prizes (
  id         uuid primary key default gen_random_uuid(),
  hunt_id    uuid not null references public.treasure_hunts (id) on delete cascade,
  sequence   integer not null check (sequence between 1 and 12),
  place      integer check (place is null or place between 1 and 20),   -- null = for everyone who finishes
  title      text not null check (char_length(btrim(title)) between 2 and 80),
  media_type text not null check (media_type in ('image', 'video')),
  media_url  text not null check (char_length(media_url) <= 500
    and media_url ~ '^https://[a-z0-9-]+\.supabase\.co/storage/v1/object/public/hunt-prizes/[A-Za-z0-9/_.-]+$'),
  unique (hunt_id, sequence)
);
alter table public.treasure_hunt_prizes enable row level security;
revoke all on public.treasure_hunt_prizes from public, anon, authenticated;

create or replace function dating_private.treasure_hunt_prizes_json(p_hunt uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('place', z.place, 'title', z.title, 'media_type', z.media_type,
    'media_url', z.media_url) order by z.sequence), '[]'::jsonb)
  from treasure_hunt_prizes z where z.hunt_id = p_hunt
$$;
revoke all on function dating_private.treasure_hunt_prizes_json(uuid) from public, anon, authenticated;

-- Prize pictures and videos: a public bucket only Admins can write to. Videos up to 20 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hunt-prizes', 'hunt-prizes', true, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set public = true, file_size_limit = 20971520,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'];
drop policy if exists "hunt-prizes: admin upload" on storage.objects;
create policy "hunt-prizes: admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'hunt-prizes' and dating_private.staff_can('manage'));
drop policy if exists "hunt-prizes: admin replace" on storage.objects;
create policy "hunt-prizes: admin replace" on storage.objects for update to authenticated
  using (bucket_id = 'hunt-prizes' and dating_private.staff_can('manage'));
drop policy if exists "hunt-prizes: admin remove" on storage.objects;
create policy "hunt-prizes: admin remove" on storage.objects for delete to authenticated
  using (bucket_id = 'hunt-prizes' and dating_private.staff_can('manage'));

-- ---- Member: see, register, count, start ----------------------------------------------------------------
-- Every upcoming or running hunt in Nigeria, with what this member may do. The registered count is
-- sent only to members who registered, and never any names.
create or replace function public.treasure_hunts_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); result jsonb;
begin
  perform dating_private.treasure_hunt_check(me);
  select coalesce(jsonb_agg(x.j order by x.mine desc, x.starts_at, x.id), '[]'::jsonb) into result from (
    select h.id, h.starts_at, (r.user_id is not null) as mine, jsonb_build_object(
      'id', h.id, 'title', h.title, 'region', h.region, 'state', h.state, 'description', h.description,
      'starts_at', h.starts_at, 'ends_at', h.ends_at, 'coin_avatar', h.coin_avatar, 'treasure_avatar', h.treasure_avatar,
      'checkpoint_count', (select count(*) from treasure_hunt_checkpoints c where c.hunt_id = h.id),
      'live', h.starts_at <= now(),
      'needs_registration', h.state is not null,
      'registered', r.user_id is not null,
      'joined', exists (select 1 from treasure_hunt_participants p where p.hunt_id = h.id and p.user_id = me),
      'register_block', case when r.user_id is null then dating_private.treasure_hunt_register_block(me, h.id) end,
      'registered_count', case when r.user_id is not null then (select count(*) from treasure_hunt_registrations a where a.hunt_id = h.id) end,
      'prizes', dating_private.treasure_hunt_prizes_json(h.id)) as j
    from treasure_hunts h
    left join treasure_hunt_registrations r on r.hunt_id = h.id and r.user_id = me
    where h.status in ('scheduled', 'active') and h.ends_at > now()
      and exists (select 1 from treasure_hunt_checkpoints c where c.hunt_id = h.id)
  ) x;
  return result;
end $$;
revoke all on function public.treasure_hunts_list() from public, anon;
grant execute on function public.treasure_hunts_list() to authenticated;

create or replace function public.treasure_hunt_register(p_hunt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); why text;
begin
  perform dating_private.treasure_hunt_check(me);
  if not exists (select 1 from treasure_hunt_registrations where hunt_id = p_hunt and user_id = me) then
    why := dating_private.treasure_hunt_register_block(me, p_hunt);
    if why is not null then raise exception '%', why using errcode = '42501'; end if;
    insert into treasure_hunt_registrations (hunt_id, user_id, state) values (p_hunt, me, '') on conflict do nothing;
  end if;
  return jsonb_build_object('registered', true,
    'registered_count', (select count(*) from treasure_hunt_registrations where hunt_id = p_hunt));
end $$;
revoke all on function public.treasure_hunt_register(uuid) from public, anon;
grant execute on function public.treasure_hunt_register(uuid) to authenticated;

-- Changing your mind is allowed until you start playing.
create or replace function public.treasure_hunt_unregister(p_hunt uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  perform dating_private.treasure_hunt_check(me);
  if exists (select 1 from treasure_hunt_participants where hunt_id = p_hunt and user_id = me) then
    raise exception 'You have already started this hunt.' using errcode = '42501';
  end if;
  delete from treasure_hunt_registrations where hunt_id = p_hunt and user_id = me;
end $$;
revoke all on function public.treasure_hunt_unregister(uuid) from public, anon;
grant execute on function public.treasure_hunt_unregister(uuid) to authenticated;

-- Starting a hunt (same signature as before). New: a scheduled hunt goes live at its start time, a hunt
-- with a state needs a registration, a matching profile state and a location inside the hunt area.
-- The location is used once, in memory, and never stored (as before).
create or replace function public.treasure_hunt_join_with_routes(
  p_hunt uuid, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision
) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p treasure_hunt_participants%rowtype; h treasure_hunts%rowtype; first_id uuid; why text; nearest_km double precision;
begin
  perform dating_private.treasure_hunt_check(me);
  if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180
    or p_accuracy_m is null or p_accuracy_m <= 0 or p_accuracy_m > 75 then
    raise exception 'Your location is not accurate enough to choose a nearby starting point. Try again outdoors.' using errcode='22023';
  end if;
  update treasure_hunts set status = 'active', updated_at = now()
    where id = p_hunt and status = 'scheduled' and starts_at <= now() and ends_at > now()
      and exists (select 1 from treasure_hunt_checkpoints where hunt_id = p_hunt);
  select * into h from treasure_hunts where id = p_hunt and status = 'active' and starts_at <= now() and ends_at > now() for share;
  if not found then raise exception 'This hunt is not open right now.' using errcode='P0002'; end if;
  if not exists(select 1 from treasure_hunt_checkpoints where hunt_id=p_hunt) then
    raise exception 'This hunt is not ready yet.' using errcode='P0001';
  end if;
  if h.state is not null and not exists (select 1 from treasure_hunt_participants where hunt_id = p_hunt and user_id = me) then
    if not exists (select 1 from treasure_hunt_registrations where hunt_id = p_hunt and user_id = me) then
      raise exception 'Register for this hunt first.' using errcode = '42501';
    end if;
    if (select state from dating_profiles where user_id = me) is distinct from h.state then
      raise exception 'This hunt is only for members in %.', case h.state when 'FCT' then 'FCT (Abuja)' else h.state end using errcode = '42501';
    end if;
    select min(dating_private.treasure_hunt_distance_m(p_latitude, p_longitude, c.latitude, c.longitude)) / 1000 into nearest_km
      from treasure_hunt_checkpoints c where c.hunt_id = p_hunt;
    if nearest_km > h.join_radius_km then
      raise exception 'You need to be in % to start this hunt.', coalesce(nullif(h.region, ''), h.state) using errcode = '42501';
    end if;
  end if;
  insert into treasure_hunt_participants(hunt_id,user_id) values(p_hunt,me) on conflict(hunt_id,user_id) do nothing;
  select * into p from treasure_hunt_participants where hunt_id = p_hunt and user_id = me for update;
  if not exists(select 1 from treasure_hunt_routes where participant_id=p.id and hunt_id=p_hunt and position=1) then
    select c.id into first_id from treasure_hunt_checkpoints c where c.hunt_id=p_hunt
    order by dating_private.treasure_hunt_distance_m(p_latitude,p_longitude,c.latitude,c.longitude),c.sequence,c.id limit 1;
    insert into treasure_hunt_routes(participant_id,hunt_id,position,checkpoint_id) values(p.id,p_hunt,1,first_id);
  end if;
  return public.treasure_hunt_progress_with_routes(p_hunt);
end $$;
revoke all on function public.treasure_hunt_join_with_routes(uuid,double precision,double precision,double precision) from public, anon;
grant execute on function public.treasure_hunt_join_with_routes(uuid,double precision,double precision,double precision) to authenticated;

-- ---- Staff: setup ---------------------------------------------------------------------------------------
create or replace function public.staff_treasure_hunts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  perform dating_private.staff_need('manage');
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'title',h.title,'region',h.region,'state',h.state,'join_radius_km',h.join_radius_km,
    'description',h.description,'status',h.status,
    'starts_at',h.starts_at,'ends_at',h.ends_at,'completion_bonus_coins',h.completion_bonus_coins,'coin_avatar',h.coin_avatar,'treasure_avatar',h.treasure_avatar,
    'participant_count',(select count(*) from treasure_hunt_participants p where p.hunt_id=h.id),
    'registration_count',(select count(*) from treasure_hunt_registrations r where r.hunt_id=h.id),
    'finished_count',(select count(*) from treasure_hunt_participants p where p.hunt_id=h.id and p.completed_at is not null),
    'checkpoints',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'sequence',c.sequence,'name',c.name,'hint',c.hint,'latitude',c.latitude,'longitude',c.longitude,'radius_m',c.radius_m,'reward_coins',c.reward_coins) order by c.sequence) from treasure_hunt_checkpoints c where c.hunt_id=h.id),'[]'::jsonb),
    'start_points',coalesce((select jsonb_agg(to_jsonb(r)-'hunt_id' order by r.sequence) from treasure_hunt_route_points r where r.hunt_id=h.id and r.point_kind='start'),'[]'::jsonb),
    'finish_points',coalesce((select jsonb_agg(to_jsonb(r)-'hunt_id' order by r.sequence) from treasure_hunt_route_points r where r.hunt_id=h.id and r.point_kind='finish'),'[]'::jsonb),
    'prizes',coalesce((select jsonb_agg(jsonb_build_object('sequence',z.sequence,'place',z.place,'title',z.title,'media_type',z.media_type,'media_url',z.media_url) order by z.sequence) from treasure_hunt_prizes z where z.hunt_id=h.id),'[]'::jsonb))
    order by h.created_at desc),'[]'::jsonb)
    into result from treasure_hunts h;
  return result;
end $$;
revoke all on function public.staff_treasure_hunts() from public, anon;
grant execute on function public.staff_treasure_hunts() to authenticated;

-- Same signature as before; now also saves the hunt's state and area size. The state is required for
-- new hunts and can't change once anyone has registered.
create or replace function public.staff_treasure_hunt_save_routes(
  p_hunt jsonb, p_checkpoints jsonb, p_start_points jsonb, p_finish_points jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); hid uuid; joined integer; old_state text; registered integer;
  v_coin text := coalesce(p_hunt->>'coin_avatar','🪙'); v_treasure text := coalesce(p_hunt->>'treasure_avatar','🧰');
  v_state text := nullif(btrim(coalesce(p_hunt->>'state','')), '');
  v_radius integer;
begin
  perform dating_private.staff_need('manage');
  begin v_radius := coalesce((p_hunt->>'join_radius_km')::integer, 60);
  exception when others then raise exception 'The hunt area size must be a number of kilometres.' using errcode='22023'; end;
  if v_radius not between 1 and 1000 then raise exception 'The hunt area must be between 1 and 1,000 km.' using errcode='22023'; end if;
  if v_state is not null and v_state <> all (dating_private.nigerian_states()) then
    raise exception 'Choose one of the 36 states or the FCT.' using errcode='22023';
  end if;
  if nullif(p_hunt->>'id','') is not null then
    select state into old_state from treasure_hunts where id = (p_hunt->>'id')::uuid;
    select count(*)::integer into registered from treasure_hunt_registrations where hunt_id = (p_hunt->>'id')::uuid;
    select count(*)::integer into joined from treasure_hunt_participants where hunt_id = (p_hunt->>'id')::uuid;
    if registered > 0 and v_state is distinct from old_state then
      raise exception 'People have registered for this hunt, so its state can''t change.' using errcode='42501';
    end if;
    if v_state is null and old_state is null and joined > 0 then v_state := null;   -- older hunt in progress: leave as is
    elsif v_state is null then raise exception 'Choose the state this hunt is in.' using errcode='22023'; end if;
  elsif v_state is null then
    raise exception 'Choose the state this hunt is in.' using errcode='22023';
  end if;
  if jsonb_typeof(p_start_points) is distinct from 'array' or jsonb_array_length(p_start_points)>10
    or jsonb_typeof(p_finish_points) is distinct from 'array' or jsonb_array_length(p_finish_points) not between 1 and 10 then
    raise exception 'Starting locations are automatic. Add one to ten final treasure locations.' using errcode='22023';
  end if;
  if v_coin not in ('🪙','💰','⭐','💎','🟡','🟠') or v_treasure not in ('🧰','🎁','🏆','💎','👑','🪙') then
    raise exception 'Choose an available coin and treasure design.' using errcode='22023';
  end if;
  hid := public.staff_treasure_hunt_save(p_hunt,p_checkpoints);
  select count(*)::integer into joined from treasure_hunt_participants where hunt_id=hid;
  if joined=0 then
    update treasure_hunts set state=v_state,join_radius_km=v_radius,coin_avatar=v_coin,treasure_avatar=v_treasure,updated_at=now() where id=hid;
    delete from treasure_hunt_route_points where hunt_id=hid;
    insert into treasure_hunt_route_points(hunt_id,point_kind,sequence,name,latitude,longitude,radius_m,reward_coins)
      select hid,'finish',x.sequence,btrim(x.name),x.latitude,x.longitude,coalesce(x.radius_m,60),coalesce(x.reward_coins,0)
      from jsonb_to_recordset(p_finish_points) as x(sequence integer,name text,latitude double precision,longitude double precision,radius_m integer,reward_coins integer);
    if (select count(*) from treasure_hunt_route_points where hunt_id=hid and point_kind='finish')<>jsonb_array_length(p_finish_points) then
      raise exception 'Check all treasure names and coordinates.' using errcode='22023';
    end if;
    perform dating_private.staff_log(me,'treasure_hunt_routes_saved','treasure_hunt',hid::text,
      jsonb_build_object('start_points','nearest_checkpoint','finish_points',jsonb_array_length(p_finish_points),'coin_avatar',v_coin,'treasure_avatar',v_treasure,
        'state',v_state,'join_radius_km',v_radius));
  end if;
  return hid;
end $$;
revoke all on function public.staff_treasure_hunt_save_routes(jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.staff_treasure_hunt_save_routes(jsonb,jsonb,jsonb,jsonb) to authenticated;

-- Replace a hunt's prize pictures/videos (up to 12). Allowed until the hunt ends.
create or replace function public.staff_treasure_hunt_prizes_save(p_hunt uuid, p_prizes jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); n integer;
begin
  perform dating_private.staff_need('manage');
  perform 1 from treasure_hunts where id = p_hunt and ends_at > now() and status not in ('completed', 'cancelled') for update;
  if not found then raise exception 'Prizes can only be changed before the hunt ends.' using errcode = '42501'; end if;
  if jsonb_typeof(p_prizes) is distinct from 'array' or jsonb_array_length(p_prizes) > 12 then
    raise exception 'Add up to 12 prizes.' using errcode = '22023';
  end if;
  delete from treasure_hunt_prizes where hunt_id = p_hunt;
  begin
    insert into treasure_hunt_prizes (hunt_id, sequence, place, title, media_type, media_url)
    select p_hunt, a.ord::integer, v.place, btrim(v.title), v.media_type, v.media_url
    from jsonb_array_elements(p_prizes) with ordinality as a(e, ord)
    cross join lateral jsonb_to_record(a.e) as v(place integer, title text, media_type text, media_url text);
  exception when check_violation or not_null_violation or invalid_text_representation then
    raise exception 'Each prize needs a name, an uploaded picture or video, and a place from 1 to 20 (or none).' using errcode = '22023';
  end;
  get diagnostics n = row_count;
  perform dating_private.staff_log(me, 'treasure_hunt_prizes_saved', 'treasure_hunt', p_hunt::text,
    jsonb_build_object('prizes', jsonb_array_length(p_prizes),
      'videos', (select count(*) from treasure_hunt_prizes where hunt_id = p_hunt and media_type = 'video')));
end $$;
revoke all on function public.staff_treasure_hunt_prizes_save(uuid, jsonb) from public, anon;
grant execute on function public.staff_treasure_hunt_prizes_save(uuid, jsonb) to authenticated;

-- ---- Staff: who is playing, and the results ----------------------------------------------------------------
-- Everyone registered for one hunt with their profile and progress, ranked: finishers first by finish
-- time, then by checkpoints found, coins and start time. Staff only (Admin and Super Admin); each look
-- is written to the staff audit log.
create or replace function public.staff_treasure_hunt_board(p_hunt uuid, p_limit integer default 500) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); h treasure_hunts%rowtype; total integer; take_n integer := least(2000, greatest(1, coalesce(p_limit, 500))); result jsonb;
begin
  perform dating_private.staff_need('manage');
  select * into h from treasure_hunts where id = p_hunt;
  if not found then raise exception 'That hunt no longer exists.' using errcode = 'P0002'; end if;
  select count(*)::integer into total from treasure_hunt_checkpoints where hunt_id = p_hunt;
  with people as (
    select coalesce(r.user_id, p.user_id) as user_id, r.registered_at, p.id as participant_id, p.joined_at, p.start_claimed_at,
      p.last_checkpoint_sequence, p.total_coins, p.completed_at
    from (select * from treasure_hunt_registrations where hunt_id = p_hunt) r
    full join (select * from treasure_hunt_participants where hunt_id = p_hunt) p on p.user_id = r.user_id
  ), ranked as (
    select x.*, d.handle, d.gender, d.age, d.state, d.suspended, u.username,
      (select max(c.claimed_at) from treasure_hunt_claims c where c.participant_id = x.participant_id) as last_claim_at,
      row_number() over (order by (x.completed_at is null), x.completed_at, coalesce(x.last_checkpoint_sequence, -1) desc,
        coalesce(x.total_coins, -1) desc, x.joined_at nulls last, x.registered_at, x.user_id) as place
    from people x
    left join dating_profiles d on d.user_id = x.user_id
    left join dating_private.usernames u on u.user_id = x.user_id
  )
  select jsonb_build_object(
    'hunt', jsonb_build_object('id', h.id, 'title', h.title, 'region', h.region, 'state', h.state, 'status', h.status,
      'starts_at', h.starts_at, 'ends_at', h.ends_at, 'checkpoint_count', total,
      'running', h.status in ('scheduled', 'active') and h.starts_at <= now() and h.ends_at > now(),
      'ended', h.status = 'completed' or h.ends_at <= now()),
    'registered', (select count(*) from ranked),
    'started', (select count(*) from ranked where participant_id is not null),
    'finished', (select count(*) from ranked where completed_at is not null),
    'people', coalesce((select jsonb_agg(jsonb_build_object(
      'place', place, 'handle', handle, 'username', username, 'gender', gender, 'age', age, 'state', state, 'suspended', coalesce(suspended, false),
      'registered_at', registered_at, 'started_at', joined_at, 'checkpoints', coalesce(last_checkpoint_sequence, 0),
      'coins', coalesce(total_coins, 0), 'last_claim_at', last_claim_at, 'finished_at', completed_at,
      'took_seconds', case when completed_at is not null then floor(extract(epoch from completed_at - greatest(joined_at, h.starts_at)))::integer end
    ) order by place) from (select * from ranked order by place limit take_n) t), '[]'::jsonb)
  ) into result;
  perform dating_private.staff_log(me, 'treasure_hunt_board_viewed', 'treasure_hunt', p_hunt::text,
    jsonb_build_object('registered', result->'registered'));
  return result;
end $$;
revoke all on function public.staff_treasure_hunt_board(uuid, integer) from public, anon;
grant execute on function public.staff_treasure_hunt_board(uuid, integer) to authenticated;

-- ---- Staff: message every competitor ----------------------------------------------------------------------
-- The announcement audience gains an optional hunt: only people registered for (or playing) that hunt.
-- hunt_group 'started' narrows it to people who have started playing.
create or replace function dating_private.ann_targets(p_aud jsonb)
returns table (user_id uuid)
language sql stable as $$
  select p.user_id
  from public.dating_profiles p
  where not p.suspended
    and p.dob_underage_at is null
    and case coalesce(p_aud ->> 'base', 'active')
          when 'all' then true
          when 'active' then p.last_seen_at > now() - interval '30 days'
          when 'new' then p.created_at > now() - make_interval(days => least(greatest(coalesce((p_aud ->> 'days')::int, 7), 1), 365))
          when 'recent' then p.last_seen_at > now() - make_interval(days => least(greatest(coalesce((p_aud ->> 'days')::int, 30), 1), 365))
          when 'inactive' then p.last_seen_at is null or p.last_seen_at <= now() - make_interval(days => least(greatest(coalesce((p_aud ->> 'days')::int, 30), 1), 365))
          else false end
    and (jsonb_array_length(coalesce(p_aud -> 'states', '[]'::jsonb)) = 0
         or p.state in (select jsonb_array_elements_text(p_aud -> 'states')))
    and (jsonb_array_length(coalesce(p_aud -> 'platforms', '[]'::jsonb)) = 0
         or p.user_id in (select d.user_id from public.app_seen_days d
                          where d.day >= ((now() at time zone 'Africa/Lagos')::date - 30)
                            and d.platform in (select jsonb_array_elements_text(p_aud -> 'platforms'))))
    and (p_aud ->> 'hunt' is null
         or p.user_id in (select tp.user_id from public.treasure_hunt_participants tp where tp.hunt_id = (p_aud ->> 'hunt')::uuid)
         or (coalesce(p_aud ->> 'hunt_group', 'registered') <> 'started'
             and p.user_id in (select r.user_id from public.treasure_hunt_registrations r where r.hunt_id = (p_aud ->> 'hunt')::uuid)));
$$;
revoke all on function dating_private.ann_targets(jsonb) from public, anon, authenticated;

-- Keep (and check) the hunt keys when an audience is cleaned, so a hunt message can never widen to everyone.
create or replace function dating_private.ann_clean_audience(p_aud jsonb) returns jsonb
language plpgsql immutable set search_path = dating_private as $$
declare
  base text := coalesce(p_aud ->> 'base', 'active');
  days int;
  states jsonb := coalesce(p_aud -> 'states', '[]'::jsonb);
  plats jsonb := coalesce(p_aud -> 'platforms', '[]'::jsonb);
  hunt text := p_aud ->> 'hunt';
  hunt_group text := p_aud ->> 'hunt_group';
begin
  if base not in ('all', 'active', 'new', 'recent', 'inactive') then raise exception 'Choose a valid audience.' using errcode = '22023'; end if;
  if jsonb_typeof(states) <> 'array' or jsonb_typeof(plats) <> 'array' then raise exception 'Choose a valid audience.' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements_text(states) s where s <> all (nigerian_states())) then
    raise exception 'Unknown state in the audience.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements_text(plats) s where s not in ('android-play', 'android-apk', 'android-app', 'ios-app', 'web')) then
    raise exception 'Unknown platform in the audience.' using errcode = '22023';
  end if;
  if hunt is not null and hunt !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Choose a valid audience.' using errcode = '22023';
  end if;
  if hunt_group is not null and (hunt is null or hunt_group not in ('registered', 'started')) then
    raise exception 'Choose a valid audience.' using errcode = '22023';
  end if;
  if base in ('new', 'recent', 'inactive') then
    begin days := coalesce((p_aud ->> 'days')::int, case base when 'new' then 7 else 30 end);
    exception when others then raise exception 'Days must be a number.' using errcode = '22023'; end;
    if days not between 1 and 365 then raise exception 'Days must be between 1 and 365.' using errcode = '22023'; end if;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('base', base, 'days', days,
    'states', case when jsonb_array_length(states) > 0 then (select jsonb_agg(distinct s) from jsonb_array_elements_text(states) s) end,
    'platforms', case when jsonb_array_length(plats) > 0 then (select jsonb_agg(distinct s) from jsonb_array_elements_text(plats) s) end,
    'hunt', hunt, 'hunt_group', hunt_group));
end $$;
revoke all on function dating_private.ann_clean_audience(jsonb) from public, anon, authenticated;

-- Send one message to everyone registered for a hunt (or only those who started). It is an ordinary
-- announcement: it lands in their Inbox → Announcements, with a push when they allow it, delivered by
-- the existing minute job. Logged in both the staff and the announcements audit logs.
create or replace function public.staff_treasure_hunt_message(p_hunt uuid, p_title text, p_body text,
  p_group text default 'registered', p_push boolean default true) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); h treasure_hunts%rowtype; v_title text := btrim(coalesce(p_title, '')); v_body text := btrim(coalesce(p_body, ''));
  v_group text := coalesce(p_group, 'registered'); aud jsonb; aid uuid; n integer;
begin
  perform dating_private.staff_need('manage');
  select * into h from treasure_hunts where id = p_hunt;
  if not found then raise exception 'That hunt no longer exists.' using errcode = 'P0002'; end if;
  if char_length(v_title) not between 1 and 100 or char_length(v_body) not between 1 and 2000 then
    raise exception 'Write a title (up to 100 characters) and a message (up to 2,000).' using errcode = '22023';
  end if;
  if v_group not in ('registered', 'started') then raise exception 'Choose who gets this message.' using errcode = '22023'; end if;
  aud := ann_clean_audience(jsonb_build_object('base', 'all', 'hunt', p_hunt::text, 'hunt_group', v_group));
  if exists (select 1 from announcements where audience = aud and created_by = me and created_at > now() - interval '30 seconds') then
    raise exception 'That message was just sent. Wait a moment before sending another.' using errcode = '42501';
  end if;
  n := (select count(*) from ann_targets(aud));
  if n = 0 then raise exception 'Nobody is registered for this hunt yet.' using errcode = '42501'; end if;
  insert into announcements (title, preview, body, category, cta_label, cta_url, audience, send_push,
    status, published_at, published_by, was_published, eligible_count, created_by, updated_by)
  values (left(v_title, 100), left(regexp_replace(v_body, '\s+', ' ', 'g'), 160), v_body, 'event', 'Open the hunt', '/home/games/treasure-hunt',
    aud, coalesce(p_push, true), 'publishing', now(), me, true, n, me, me)
  returning id into aid;
  perform ann_log('published', aid, jsonb_build_object('eligible', n, 'treasure_hunt', p_hunt));
  perform dating_private.staff_log(me, 'treasure_hunt_message_sent', 'treasure_hunt', p_hunt::text,
    jsonb_build_object('announcement', aid, 'recipients', n, 'group', v_group, 'title', left(v_title, 100), 'push', coalesce(p_push, true)));
  perform ann_deliver_batch(aid);
  return jsonb_build_object('announcement', aid, 'recipients', n);
end $$;
revoke all on function public.staff_treasure_hunt_message(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.staff_treasure_hunt_message(uuid, text, text, text, boolean) to authenticated;
