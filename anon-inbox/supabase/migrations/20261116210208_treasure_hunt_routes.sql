-- Treehouse Treasure Hunt: nearest start/finish route choices and coin/treasure designs.
-- Location is read only at join/start/checkpoint/finish actions; no location history is stored.
set lock_timeout = '5s';

alter table public.treasure_hunts
  add column if not exists coin_avatar text not null default '🪙' check (char_length(coin_avatar) <= 8),
  add column if not exists treasure_avatar text not null default '🧰' check (char_length(treasure_avatar) <= 8);

create table if not exists public.treasure_hunt_route_points (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references public.treasure_hunts(id) on delete cascade,
  point_kind text not null check (point_kind in ('start', 'finish')),
  sequence integer not null check (sequence between 1 and 10),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_m integer not null default 60 check (radius_m between 20 and 200),
  reward_coins integer not null default 0 check (reward_coins between 0 and 100000),
  unique (hunt_id, point_kind, sequence),
  unique (id, hunt_id),
  unique (id, hunt_id, point_kind)
);
create index if not exists treasure_hunt_route_points_nearest
  on public.treasure_hunt_route_points (hunt_id, point_kind, sequence);

alter table public.treasure_hunt_participants
  add column if not exists assigned_start_point_id uuid,
  add column if not exists assigned_finish_point_id uuid,
  add column if not exists start_claimed_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'treasure_hunt_participants_start_route_fk') then
    alter table public.treasure_hunt_participants add constraint treasure_hunt_participants_start_route_fk
      foreign key (assigned_start_point_id, hunt_id) references public.treasure_hunt_route_points(id, hunt_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'treasure_hunt_participants_finish_route_fk') then
    alter table public.treasure_hunt_participants add constraint treasure_hunt_participants_finish_route_fk
      foreign key (assigned_finish_point_id, hunt_id) references public.treasure_hunt_route_points(id, hunt_id);
  end if;
end $$;

create table if not exists public.treasure_hunt_route_claims (
  participant_id uuid not null references public.treasure_hunt_participants(id) on delete cascade,
  route_point_id uuid not null references public.treasure_hunt_route_points(id) on delete cascade,
  request_id uuid not null unique,
  coins_awarded integer not null check (coins_awarded >= 0),
  claimed_at timestamptz not null default now(),
  primary key (participant_id, route_point_id)
);
create index if not exists treasure_hunt_route_claims_recent on public.treasure_hunt_route_claims(participant_id, claimed_at desc);

alter table public.treasure_hunt_route_points enable row level security;
alter table public.treasure_hunt_route_claims enable row level security;
revoke all on public.treasure_hunt_route_points, public.treasure_hunt_route_claims from public, anon, authenticated;

-- Return only the selected public route points to a participant, never other route alternatives.
create or replace function public.treasure_hunt_progress_with_routes(p_hunt uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); result jsonb; p treasure_hunt_participants%rowtype; h treasure_hunts%rowtype;
begin
  perform dating_private.treasure_hunt_check(me);
  result := dating_private.treasure_hunt_progress(me, p_hunt);
  if result is null then raise exception 'Join this hunt first.' using errcode = '42501'; end if;
  select * into p from treasure_hunt_participants where hunt_id = p_hunt and user_id = me;
  select * into h from treasure_hunts where id = p_hunt;
  return jsonb_set(result, '{hunt}', result->'hunt' || jsonb_build_object('coin_avatar', h.coin_avatar,
    'treasure_avatar', h.treasure_avatar), true)
    || jsonb_build_object('route', jsonb_build_object(
      'start_claimed_at', p.start_claimed_at,
      'start', (select jsonb_build_object('id', r.id, 'name', r.name, 'latitude', r.latitude, 'longitude', r.longitude,
        'radius_m', r.radius_m, 'reward_coins', r.reward_coins) from treasure_hunt_route_points r
        where r.id = p.assigned_start_point_id and r.hunt_id = p_hunt),
      'finish', (select jsonb_build_object('id', r.id, 'name', r.name, 'latitude', r.latitude, 'longitude', r.longitude,
        'radius_m', r.radius_m, 'reward_coins', r.reward_coins) from treasure_hunt_route_points r
        where r.id = p.assigned_finish_point_id and r.hunt_id = p_hunt)));
end $$;
revoke all on function public.treasure_hunt_progress_with_routes(uuid) from public, anon;
grant execute on function public.treasure_hunt_progress_with_routes(uuid) to authenticated;

create or replace function public.treasure_hunts_active() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid:=auth.uid(); out_json jsonb;
begin
  perform dating_private.treasure_hunt_check(me);
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'title',h.title,'region',h.region,'description',h.description,
    'starts_at',h.starts_at,'ends_at',h.ends_at,'checkpoint_count',(select count(*) from treasure_hunt_checkpoints c where c.hunt_id=h.id),
    'participants',(select count(*) from treasure_hunt_participants p where p.hunt_id=h.id),
    'joined',exists(select 1 from treasure_hunt_participants p where p.hunt_id=h.id and p.user_id=me),
    'route_assignment_required',exists(select 1 from treasure_hunt_route_points r where r.hunt_id=h.id and r.point_kind='start')) order by h.starts_at,h.id),'[]'::jsonb)
    into out_json from treasure_hunts h where h.status='active' and h.starts_at<=now() and h.ends_at>now()
      and exists(select 1 from treasure_hunt_checkpoints c where c.hunt_id=h.id);
  return out_json;
end $$;
revoke all on function public.treasure_hunts_active() from public, anon;
grant execute on function public.treasure_hunts_active() to authenticated;

-- One join-time location reading assigns the nearest start and finish options exactly once.
create or replace function public.treasure_hunt_join_with_routes(
  p_hunt uuid, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p treasure_hunt_participants%rowtype; h treasure_hunts%rowtype; start_id uuid; finish_id uuid; rad double precision := pi()/180;
begin
  perform dating_private.treasure_hunt_check(me);
  if exists(select 1 from treasure_hunt_route_points where hunt_id=p_hunt and point_kind='start') and
    (p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180
    or p_accuracy_m is null or p_accuracy_m <= 0 or p_accuracy_m > 75) then
    raise exception 'Your location is not accurate enough to choose a nearby route. Try again outdoors.' using errcode = '22023';
  end if;
  select * into h from treasure_hunts where id=p_hunt and status='active' and starts_at<=now() and ends_at>now() for share;
  if not found then raise exception 'This hunt is not open right now.' using errcode='P0002'; end if;
  if not exists(select 1 from treasure_hunt_checkpoints where hunt_id=p_hunt) then raise exception 'This hunt is not ready yet.' using errcode='P0001'; end if;
  insert into treasure_hunt_participants(hunt_id,user_id) values(p_hunt,me) on conflict(hunt_id,user_id) do nothing;
  select * into p from treasure_hunt_participants where hunt_id = p_hunt and user_id = me for update;
  if p.assigned_start_point_id is null then
    select r.id into start_id from treasure_hunt_route_points r where r.hunt_id = p_hunt and r.point_kind = 'start'
      order by 6371000 * 2 * asin(sqrt(least(1, greatest(0,
        sin((p_latitude-r.latitude)*rad/2)^2 + cos(r.latitude*rad)*cos(p_latitude*rad)*sin((p_longitude-r.longitude)*rad/2)^2)))), r.sequence limit 1;
    select r.id into finish_id from treasure_hunt_route_points r where r.hunt_id = p_hunt and r.point_kind = 'finish'
      order by 6371000 * 2 * asin(sqrt(least(1, greatest(0,
        sin((p_latitude-r.latitude)*rad/2)^2 + cos(r.latitude*rad)*cos(p_latitude*rad)*sin((p_longitude-r.longitude)*rad/2)^2)))), r.sequence limit 1;
    update treasure_hunt_participants set assigned_start_point_id = start_id, assigned_finish_point_id = finish_id
      where id = p.id and assigned_start_point_id is null and assigned_finish_point_id is null;
  end if;
  return public.treasure_hunt_progress_with_routes(p_hunt);
end $$;
revoke all on function public.treasure_hunt_join_with_routes(uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.treasure_hunt_join_with_routes(uuid, double precision, double precision, double precision) to authenticated;

-- Keep the old join entry safe for older clients: hunts with assigned route options must use the location-aware RPC.
create or replace function public.treasure_hunt_join(p_hunt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid:=auth.uid(); h treasure_hunts%rowtype;
begin
  perform dating_private.treasure_hunt_check(me);
  if exists(select 1 from treasure_hunt_route_points where hunt_id=p_hunt) then
    raise exception 'This hunt needs location-based route assignment. Update the app to join.' using errcode='22023';
  end if;
  select * into h from treasure_hunts where id=p_hunt and status='active' and starts_at<=now() and ends_at>now() for share;
  if not found then raise exception 'This hunt is not open right now.' using errcode='P0002'; end if;
  if not exists(select 1 from treasure_hunt_checkpoints where hunt_id=p_hunt) then raise exception 'This hunt is not ready yet.' using errcode='P0001'; end if;
  insert into treasure_hunt_participants(hunt_id,user_id) values(p_hunt,me) on conflict(hunt_id,user_id) do nothing;
  return dating_private.treasure_hunt_progress(me,p_hunt);
end $$;
revoke all on function public.treasure_hunt_join(uuid) from public, anon;
grant execute on function public.treasure_hunt_join(uuid) to authenticated;

create or replace function public.treasure_hunt_claim_start(
  p_hunt uuid, p_route_point uuid, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision, p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p treasure_hunt_participants%rowtype; r treasure_hunt_route_points%rowtype; h treasure_hunts%rowtype;
  old treasure_hunt_route_claims%rowtype; rad double precision := pi()/180; a double precision; dist double precision;
begin
  perform dating_private.treasure_hunt_check(me);
  if p_request_id is null then raise exception 'Try checking in again.' using errcode = '22023'; end if;
  select * into p from treasure_hunt_participants where hunt_id=p_hunt and user_id=me for update;
  if not found then raise exception 'Join this hunt first.' using errcode='42501'; end if;
  select * into old from treasure_hunt_route_claims where participant_id=p.id and route_point_id=p_route_point;
  if found then return jsonb_build_object('ok',true,'idempotent',true,'coins_awarded',old.coins_awarded,'total_coins',p.total_coins); end if;
  if p.start_claimed_at is not null then return jsonb_build_object('ok',false,'error','Your start point is already checked in.'); end if;
  if p.assigned_start_point_id is distinct from p_route_point then return jsonb_build_object('ok',false,'error','This is not your assigned start point.'); end if;
  select * into h from treasure_hunts where id=p_hunt and status='active' and starts_at<=now() and ends_at>now() for share;
  if not found then return jsonb_build_object('ok',false,'error','This hunt has ended.'); end if;
  select * into r from treasure_hunt_route_points where id=p_route_point and hunt_id=p_hunt and point_kind='start';
  if not found then return jsonb_build_object('ok',false,'error','Start point not found.'); end if;
  if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180
    or p_accuracy_m is null or p_accuracy_m <= 0 or p_accuracy_m > 75 then return jsonb_build_object('ok',false,'error','Your location is not accurate enough yet.'); end if;
  a:=sin((p_latitude-r.latitude)*rad/2)^2+cos(r.latitude*rad)*cos(p_latitude*rad)*sin((p_longitude-r.longitude)*rad/2)^2;
  dist:=6371000*2*asin(sqrt(least(1,greatest(0,a))));
  if dist>r.radius_m then return jsonb_build_object('ok',false,'error','You are not close enough to your assigned start point yet.'); end if;
  if p.claim_window_at<date_trunc('minute',now()) then update treasure_hunt_participants set claim_window_at=date_trunc('minute',now()),claim_attempts=1 where id=p.id;
  elsif p.claim_attempts>=10 then return jsonb_build_object('ok',false,'error','Too many check-in tries. Wait a minute, then try again.');
  else update treasure_hunt_participants set claim_attempts=claim_attempts+1 where id=p.id; end if;
  insert into treasure_hunt_route_claims(participant_id,route_point_id,request_id,coins_awarded) values(p.id,r.id,p_request_id,r.reward_coins);
  update treasure_hunt_participants set start_claimed_at=now(),total_coins=total_coins+r.reward_coins where id=p.id returning * into p;
  return jsonb_build_object('ok',true,'idempotent',false,'coins_awarded',r.reward_coins,'total_coins',p.total_coins);
end $$;
revoke all on function public.treasure_hunt_claim_start(uuid, uuid, double precision, double precision, double precision, uuid) from public, anon;
grant execute on function public.treasure_hunt_claim_start(uuid, uuid, double precision, double precision, double precision, uuid) to authenticated;

-- Stop checkpoint claims until an assigned start point is checked in.
create or replace function public.treasure_hunt_claim_checkpoint(
  p_hunt uuid, p_checkpoint uuid, p_latitude double precision, p_longitude double precision,
  p_accuracy_m double precision, p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p treasure_hunt_participants%rowtype; h treasure_hunts%rowtype;
  c treasure_hunt_checkpoints%rowtype; old treasure_hunt_claims%rowtype; rad double precision := pi()/180; a double precision; distance_m double precision;
begin
  perform dating_private.treasure_hunt_check(me);
  if p_request_id is null then raise exception 'Try that checkpoint again.' using errcode='22023'; end if;
  select * into p from treasure_hunt_participants where hunt_id=p_hunt and user_id=me for update;
  if not found then raise exception 'Join this hunt first.' using errcode='42501'; end if;
  select * into old from treasure_hunt_claims where participant_id=p.id and request_id=p_request_id;
  if found then
    if old.checkpoint_id<>p_checkpoint then return jsonb_build_object('ok',false,'error','That request was already used.'); end if;
    return jsonb_build_object('ok',true,'idempotent',true,'coins_awarded',old.coins_awarded,'total_coins',p.total_coins,'checkpoint_sequence',p.last_checkpoint_sequence);
  end if;
  select * into old from treasure_hunt_claims where participant_id=p.id and checkpoint_id=p_checkpoint;
  if found then return jsonb_build_object('ok',true,'idempotent',true,'coins_awarded',old.coins_awarded,'total_coins',p.total_coins,'checkpoint_sequence',p.last_checkpoint_sequence); end if;
  if p.assigned_start_point_id is not null and p.start_claimed_at is null then return jsonb_build_object('ok',false,'error','Check in at your assigned start point first.'); end if;
  if p.claim_window_at<date_trunc('minute',now()) then update treasure_hunt_participants set claim_window_at=date_trunc('minute',now()),claim_attempts=1 where id=p.id;
  elsif p.claim_attempts>=10 then return jsonb_build_object('ok',false,'error','Too many checkpoint tries. Wait a minute, then try again.');
  else update treasure_hunt_participants set claim_attempts=claim_attempts+1 where id=p.id; end if;
  select * into h from treasure_hunts where id=p_hunt and status='active' and starts_at<=now() and ends_at>now() for share;
  if not found then return jsonb_build_object('ok',false,'error','This hunt has ended.'); end if;
  select * into c from treasure_hunt_checkpoints where id=p_checkpoint and hunt_id=p_hunt and sequence=p.last_checkpoint_sequence+1;
  if not found then return jsonb_build_object('ok',false,'error','Follow the checkpoints in order.'); end if;
  if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180 or p_accuracy_m is null or p_accuracy_m<=0 or p_accuracy_m>75 then
    return jsonb_build_object('ok',false,'error','Your location is not accurate enough yet. Try again outdoors.'); end if;
  a:=sin((p_latitude-c.latitude)*rad/2)^2+cos(c.latitude*rad)*cos(p_latitude*rad)*sin((p_longitude-c.longitude)*rad/2)^2;
  distance_m:=6371000*2*asin(sqrt(least(1,greatest(0,a))));
  if distance_m>c.radius_m then return jsonb_build_object('ok',false,'error','You are not close enough to this checkpoint yet.'); end if;
  insert into treasure_hunt_claims(hunt_id,participant_id,checkpoint_id,request_id,coins_awarded) values(p_hunt,p.id,c.id,p_request_id,c.reward_coins);
  update treasure_hunt_participants set last_checkpoint_sequence=c.sequence,total_coins=total_coins+c.reward_coins where id=p.id returning * into p;
  return jsonb_build_object('ok',true,'idempotent',false,'coins_awarded',c.reward_coins,'total_coins',p.total_coins,'checkpoint_sequence',p.last_checkpoint_sequence);
end $$;
revoke all on function public.treasure_hunt_claim_checkpoint(uuid, uuid, double precision, double precision, double precision, uuid) from public, anon;
grant execute on function public.treasure_hunt_claim_checkpoint(uuid, uuid, double precision, double precision, double precision, uuid) to authenticated;

-- Final treasure claim verifies the selected finish point and awards the finishing coins once.
drop function if exists public.treasure_hunt_finish(uuid, uuid);
create or replace function public.treasure_hunt_finish(
  p_hunt uuid, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision, p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid:=auth.uid(); p treasure_hunt_participants%rowtype; h treasure_hunts%rowtype; r treasure_hunt_route_points%rowtype;
  n integer; rad double precision:=pi()/180; a double precision; dist double precision; award integer;
begin
  perform dating_private.treasure_hunt_check(me);
  if p_request_id is null then raise exception 'Try claiming the treasure again.' using errcode='22023'; end if;
  select * into p from treasure_hunt_participants where hunt_id=p_hunt and user_id=me for update;
  if not found then raise exception 'Join this hunt first.' using errcode='42501'; end if;
  if p.completed_at is not null then return jsonb_build_object('ok',true,'idempotent',true,'coins_awarded',p.completion_bonus_coins,'total_coins',p.total_coins); end if;
  select * into h from treasure_hunts where id=p_hunt and status='active' and starts_at<=now() and ends_at>now() for share;
  if not found then return jsonb_build_object('ok',false,'error','This hunt has ended.'); end if;
  select count(*) into n from treasure_hunt_checkpoints where hunt_id=p_hunt;
  if n=0 or p.last_checkpoint_sequence<>n then return jsonb_build_object('ok',false,'error','Find every checkpoint before claiming the treasure.'); end if;
  if p.assigned_start_point_id is not null and p.start_claimed_at is null then return jsonb_build_object('ok',false,'error','Check in at your assigned start point first.'); end if;
  award:=h.completion_bonus_coins;
  if p.assigned_finish_point_id is not null then
    select * into r from treasure_hunt_route_points where id=p.assigned_finish_point_id and hunt_id=p_hunt and point_kind='finish';
    if not found then return jsonb_build_object('ok',false,'error','Your final treasure location is unavailable.'); end if;
    if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180 or p_accuracy_m is null or p_accuracy_m<=0 or p_accuracy_m>75 then
      return jsonb_build_object('ok',false,'error','Your location is not accurate enough yet. Try again outdoors.'); end if;
    a:=sin((p_latitude-r.latitude)*rad/2)^2+cos(r.latitude*rad)*cos(p_latitude*rad)*sin((p_longitude-r.longitude)*rad/2)^2;
    dist:=6371000*2*asin(sqrt(least(1,greatest(0,a))));
    if dist>r.radius_m then return jsonb_build_object('ok',false,'error','Reach your assigned final treasure location first.'); end if;
    award:=award+r.reward_coins;
  end if;
  update treasure_hunt_participants set completed_at=now(),completion_bonus_coins=award,completion_request_id=p_request_id,total_coins=total_coins+award where id=p.id returning * into p;
  return jsonb_build_object('ok',true,'idempotent',false,'coins_awarded',p.completion_bonus_coins,'total_coins',p.total_coins);
end $$;
revoke all on function public.treasure_hunt_finish(uuid, double precision, double precision, double precision, uuid) from public, anon;
grant execute on function public.treasure_hunt_finish(uuid, double precision, double precision, double precision, uuid) to authenticated;

-- Add/map multiple route choices and avatar options from the existing MFA-checked staff console.
create or replace function public.staff_treasure_hunts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  perform dating_private.staff_need('manage');
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'title',h.title,'region',h.region,'description',h.description,'status',h.status,
    'starts_at',h.starts_at,'ends_at',h.ends_at,'completion_bonus_coins',h.completion_bonus_coins,'coin_avatar',h.coin_avatar,'treasure_avatar',h.treasure_avatar,
    'participant_count',(select count(*) from treasure_hunt_participants p where p.hunt_id=h.id),
    'checkpoints',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'sequence',c.sequence,'name',c.name,'hint',c.hint,'latitude',c.latitude,'longitude',c.longitude,'radius_m',c.radius_m,'reward_coins',c.reward_coins) order by c.sequence) from treasure_hunt_checkpoints c where c.hunt_id=h.id),'[]'::jsonb),
    'start_points',coalesce((select jsonb_agg(to_jsonb(r)-'hunt_id' order by r.sequence) from treasure_hunt_route_points r where r.hunt_id=h.id and r.point_kind='start'),'[]'::jsonb),
    'finish_points',coalesce((select jsonb_agg(to_jsonb(r)-'hunt_id' order by r.sequence) from treasure_hunt_route_points r where r.hunt_id=h.id and r.point_kind='finish'),'[]'::jsonb)) order by h.created_at desc),'[]'::jsonb)
    into result from treasure_hunts h;
  return result;
end $$;
revoke all on function public.staff_treasure_hunts() from public, anon;
grant execute on function public.staff_treasure_hunts() to authenticated;

create or replace function public.staff_treasure_hunt_save_routes(p_hunt jsonb,p_checkpoints jsonb,p_start_points jsonb,p_finish_points jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid:=auth.uid(); hid uuid; joined integer; v_coin text:=coalesce(p_hunt->>'coin_avatar','🪙'); v_treasure text:=coalesce(p_hunt->>'treasure_avatar','🧰');
begin
  perform dating_private.staff_need('manage');
  if jsonb_typeof(p_start_points) is distinct from 'array' or jsonb_array_length(p_start_points) not between 1 and 10
    or jsonb_typeof(p_finish_points) is distinct from 'array' or jsonb_array_length(p_finish_points) not between 1 and 10 then
    raise exception 'Add between one and ten start points and one and ten final treasure locations.' using errcode='22023'; end if;
  if v_coin not in ('🪙','💰','⭐','💎','🟡','🟠') or v_treasure not in ('🧰','🎁','🏆','💎','👑','🪙') then
    raise exception 'Choose an available coin and treasure design.' using errcode='22023'; end if;
  hid:=public.staff_treasure_hunt_save(p_hunt,p_checkpoints);
  select count(*) into joined from treasure_hunt_participants where hunt_id=hid;
  if joined=0 then
    update treasure_hunts set coin_avatar=v_coin,treasure_avatar=v_treasure,updated_at=now() where id=hid;
    delete from treasure_hunt_route_points where hunt_id=hid;
    insert into treasure_hunt_route_points(hunt_id,point_kind,sequence,name,latitude,longitude,radius_m,reward_coins)
      select hid,'start',x.sequence,btrim(x.name),x.latitude,x.longitude,coalesce(x.radius_m,60),coalesce(x.reward_coins,0)
      from jsonb_to_recordset(p_start_points) as x(sequence integer,name text,latitude double precision,longitude double precision,radius_m integer,reward_coins integer);
    insert into treasure_hunt_route_points(hunt_id,point_kind,sequence,name,latitude,longitude,radius_m,reward_coins)
      select hid,'finish',x.sequence,btrim(x.name),x.latitude,x.longitude,coalesce(x.radius_m,60),coalesce(x.reward_coins,0)
      from jsonb_to_recordset(p_finish_points) as x(sequence integer,name text,latitude double precision,longitude double precision,radius_m integer,reward_coins integer);
    if (select count(*) from treasure_hunt_route_points where hunt_id=hid and point_kind='start')<>jsonb_array_length(p_start_points)
      or (select count(*) from treasure_hunt_route_points where hunt_id=hid and point_kind='finish')<>jsonb_array_length(p_finish_points) then
      raise exception 'Check all start and treasure location names and coordinates.' using errcode='22023'; end if;
    perform dating_private.staff_log(me,'treasure_hunt_routes_saved','treasure_hunt',hid::text,
      jsonb_build_object('start_points',jsonb_array_length(p_start_points),'finish_points',jsonb_array_length(p_finish_points),'coin_avatar',v_coin,'treasure_avatar',v_treasure));
  end if;
  return hid;
end $$;
revoke all on function public.staff_treasure_hunt_save_routes(jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.staff_treasure_hunt_save_routes(jsonb,jsonb,jsonb,jsonb) to authenticated;

