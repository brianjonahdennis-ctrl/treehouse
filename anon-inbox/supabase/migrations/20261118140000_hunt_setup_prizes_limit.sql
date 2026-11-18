-- Treasure Hunt setup, part 2 (Hydra, 18 Nov 2026): prizes from the treehouse app's own setup screen,
-- and a participant limit per hunt.
--
-- Prizes from the app:
-- Hydra already manages hunts from the signed-in app without the authenticator step
-- (treasure_hunt_personal_admin_mfa). This lets that same setup upload prize pictures/videos and save
-- prizes. Everyone else still needs an Admin role and the authenticator step.
set lock_timeout = '5s';

-- Yes/no version of the personal-admin check, for storage rules.
create or replace function dating_private.treasure_hunt_personal_admin_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() = '7cbd08d2-d6b1-4ccc-bb0d-738c1bb6d299'::uuid
    and exists (select 1 from public.announcement_staff where user_id = auth.uid() and role = 'super_admin')
$$;
revoke all on function dating_private.treasure_hunt_personal_admin_ok() from public, anon;
grant execute on function dating_private.treasure_hunt_personal_admin_ok() to authenticated;

drop policy if exists "hunt-prizes: admin upload" on storage.objects;
create policy "hunt-prizes: admin upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'hunt-prizes' and (dating_private.staff_can('manage') or dating_private.treasure_hunt_personal_admin_ok()));
drop policy if exists "hunt-prizes: admin replace" on storage.objects;
create policy "hunt-prizes: admin replace" on storage.objects for update to authenticated
  using (bucket_id = 'hunt-prizes' and (dating_private.staff_can('manage') or dating_private.treasure_hunt_personal_admin_ok()));
drop policy if exists "hunt-prizes: admin remove" on storage.objects;
create policy "hunt-prizes: admin remove" on storage.objects for delete to authenticated
  using (bucket_id = 'hunt-prizes' and (dating_private.staff_can('manage') or dating_private.treasure_hunt_personal_admin_ok()));

create or replace function public.staff_treasure_hunt_prizes_save_personal(p_hunt uuid, p_prizes jsonb) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  perform dating_private.treasure_hunt_personal_admin_mfa();
  perform public.staff_treasure_hunt_prizes_save(p_hunt, p_prizes);
end $$;
revoke all on function public.staff_treasure_hunt_prizes_save_personal(uuid, jsonb) from public, anon;
grant execute on function public.staff_treasure_hunt_prizes_save_personal(uuid, jsonb) to authenticated;

-- ---- Participant limit (Hydra, 18 Nov 2026) --------------------------------------------------------
-- Each hunt takes 10 to 1,000 registrations (default 1,000). When it's full nobody else can register;
-- the limit can never be set below the number already registered.
alter table public.treasure_hunts
  add column if not exists max_registrations integer not null default 1000 check (max_registrations between 10 and 1000);

create or replace function dating_private.treasure_hunt_register_block(p_user uuid, p_hunt uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when h.id is null then 'This hunt could not be found.'
    when h.status not in ('scheduled', 'active') or h.ends_at <= now() then 'Registration for this hunt is closed.'
    when (select count(*) from treasure_hunt_registrations r where r.hunt_id = h.id) >= h.max_registrations
      then 'This hunt is full: all ' || h.max_registrations || ' places are taken.'
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

create or replace function dating_private.treasure_hunt_registration_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare why text;
begin
  -- One registration at a time per hunt, so the last place can't be taken twice.
  perform 1 from treasure_hunts where id = new.hunt_id for update;
  why := dating_private.treasure_hunt_register_block(new.user_id, new.hunt_id);
  if why is not null then raise exception '%', why using errcode = '42501'; end if;
  new.state := (select state from dating_profiles where user_id = new.user_id);
  if new.state is null then new.state := coalesce((select state from treasure_hunts where id = new.hunt_id), 'Nigeria'); end if;
  return new;
end $$;
revoke all on function dating_private.treasure_hunt_registration_guard() from public, anon, authenticated;

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
      'max_registrations', h.max_registrations,
      'full', (select count(*) from treasure_hunt_registrations a where a.hunt_id = h.id) >= h.max_registrations,
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

create or replace function public.staff_treasure_hunts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  perform dating_private.staff_need('manage');
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'title',h.title,'region',h.region,'state',h.state,'join_radius_km',h.join_radius_km,'max_registrations',h.max_registrations,
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

create or replace function public.staff_treasure_hunt_save_routes(
  p_hunt jsonb, p_checkpoints jsonb, p_start_points jsonb, p_finish_points jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); hid uuid; joined integer; old_state text; registered integer;
  v_coin text := coalesce(p_hunt->>'coin_avatar','🪙'); v_treasure text := coalesce(p_hunt->>'treasure_avatar','🧰');
  v_state text := nullif(btrim(coalesce(p_hunt->>'state','')), '');
  v_radius integer; v_max integer;
begin
  perform dating_private.staff_need('manage');
  begin v_radius := coalesce((p_hunt->>'join_radius_km')::integer, 60);
  exception when others then raise exception 'The hunt area size must be a number of kilometres.' using errcode='22023'; end;
  if v_radius not between 1 and 1000 then raise exception 'The hunt area must be between 1 and 1,000 km.' using errcode='22023'; end if;
  begin v_max := coalesce((p_hunt->>'max_registrations')::integer,
    (select max_registrations from treasure_hunts where id = nullif(p_hunt->>'id','')::uuid), 1000);
  exception when others then raise exception 'The participant limit must be a number.' using errcode='22023'; end;
  if v_max not between 10 and 1000 then raise exception 'The participant limit must be between 10 and 1,000.' using errcode='22023'; end if;
  if v_state is not null and v_state <> all (dating_private.nigerian_states()) then
    raise exception 'Choose one of the 36 states or the FCT.' using errcode='22023';
  end if;
  if nullif(p_hunt->>'id','') is not null then
    select state into old_state from treasure_hunts where id = (p_hunt->>'id')::uuid;
    select count(*)::integer into registered from treasure_hunt_registrations where hunt_id = (p_hunt->>'id')::uuid;
    select count(*)::integer into joined from treasure_hunt_participants where hunt_id = (p_hunt->>'id')::uuid;
    if v_max < registered then
      raise exception '% people have already registered, so the limit can''t be lower than %.', registered, registered using errcode='42501';
    end if;
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
  update treasure_hunts set max_registrations = v_max where id = hid and max_registrations is distinct from v_max;
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
        'state',v_state,'join_radius_km',v_radius,'max_registrations',v_max));
  end if;
  return hid;
end $$;
revoke all on function public.staff_treasure_hunt_save_routes(jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.staff_treasure_hunt_save_routes(jsonb,jsonb,jsonb,jsonb) to authenticated;
