-- Give every participant a private checkpoint order. New routes start at the
-- nearest checkpoint; old participants keep their original numbered order.
set lock_timeout = '5s';

create table if not exists public.treasure_hunt_routes (
  participant_id uuid not null,
  hunt_id uuid not null,
  position integer not null check (position >= 1),
  checkpoint_id uuid not null,
  primary key (participant_id, position),
  unique (participant_id, checkpoint_id),
  foreign key (participant_id, hunt_id)
    references public.treasure_hunt_participants(id, hunt_id) on delete cascade,
  foreign key (checkpoint_id, hunt_id)
    references public.treasure_hunt_checkpoints(id, hunt_id) on delete cascade
);
create index if not exists treasure_hunt_routes_hunt_position
  on public.treasure_hunt_routes(hunt_id, position, checkpoint_id, participant_id);
create index if not exists treasure_hunt_routes_participant_hunt
  on public.treasure_hunt_routes(participant_id, hunt_id);
create index if not exists treasure_hunt_routes_checkpoint_hunt
  on public.treasure_hunt_routes(checkpoint_id, hunt_id);
create index if not exists treasure_hunt_routes_start_cohort
  on public.treasure_hunt_routes(hunt_id, checkpoint_id, participant_id) where position = 1;
alter table public.treasure_hunt_routes enable row level security;
revoke all on public.treasure_hunt_routes from public, anon, authenticated;

-- Distinguish routes copied from the former shared order from routes created
-- for new joins. This keeps the old order fixed for existing players.
alter table public.treasure_hunt_participants
  add column if not exists legacy_route_order boolean not null default true;
alter table public.treasure_hunt_participants
  alter column legacy_route_order set default false;

-- Preserve the previous fixed order for everyone who had joined before this
-- migration. Newly joined participants get their own order in the join RPC.
insert into public.treasure_hunt_routes(participant_id, hunt_id, position, checkpoint_id)
select p.id, p.hunt_id, c.sequence, c.id
from public.treasure_hunt_participants p
join public.treasure_hunt_checkpoints c on c.hunt_id = p.hunt_id
where p.legacy_route_order
on conflict do nothing;

create or replace function dating_private.treasure_hunt_distance_m(
  p_latitude_a double precision, p_longitude_a double precision,
  p_latitude_b double precision, p_longitude_b double precision
) returns double precision
language sql immutable strict set search_path = public as $$
  select 6371000 * 2 * asin(sqrt(least(1, greatest(0,
    sin((p_latitude_a - p_latitude_b) * pi() / 360)^2
      + cos(p_latitude_a * pi() / 180) * cos(p_latitude_b * pi() / 180)
      * sin((p_longitude_a - p_longitude_b) * pi() / 360)^2))))
$$;
revoke all on function dating_private.treasure_hunt_distance_m(double precision,double precision,double precision,double precision) from public, anon, authenticated;

create or replace function dating_private.treasure_hunt_route_length(p_hunt uuid, p_route uuid[])
returns double precision language sql stable security definer set search_path = public as $$
  select case when exists (
    select 1 from unnest(p_route) with ordinality as route(checkpoint_id, position)
    left join public.treasure_hunt_checkpoints c on c.id = route.checkpoint_id and c.hunt_id = p_hunt
    where c.id is null
  ) then 'Infinity'::double precision else coalesce((
    select sum(dating_private.treasure_hunt_distance_m(previous_latitude, previous_longitude, latitude, longitude))
    from (
      select c.latitude, c.longitude,
        lag(c.latitude) over (order by route.position) as previous_latitude,
        lag(c.longitude) over (order by route.position) as previous_longitude
      from unnest(p_route) with ordinality as route(checkpoint_id, position)
      join public.treasure_hunt_checkpoints c on c.id = route.checkpoint_id and c.hunt_id = p_hunt
    ) points where previous_latitude is not null
  ), 0::double precision) end
$$;
revoke all on function dating_private.treasure_hunt_route_length(uuid,uuid[]) from public, anon, authenticated;

-- Build a nearby-first route, spreading players who share a start across the
-- four closest reasonable choices. Keep the route only when its walking
-- distance stays within 30% of a simple nearest-neighbour route.
create or replace function dating_private.treasure_hunt_assign_remaining(p_hunt uuid, p_participant uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  start_id uuid; checkpoint_total integer; route_count integer;
  shortest uuid[]; balanced uuid[]; selected_route uuid[]; selected_id uuid;
  shortest_length double precision; balanced_length double precision;
  pos integer;
begin
  select checkpoint_id into start_id from treasure_hunt_routes
    where participant_id = p_participant and hunt_id = p_hunt and position = 1;
  if start_id is null then return; end if;
  select count(*)::integer into checkpoint_total from treasure_hunt_checkpoints where hunt_id = p_hunt;
  select count(*)::integer into route_count from treasure_hunt_routes where participant_id = p_participant and hunt_id = p_hunt;
  if route_count = checkpoint_total then return; end if;

  shortest := array[start_id]::uuid[];
  while cardinality(shortest) < checkpoint_total loop
    select c.id into selected_id
    from treasure_hunt_checkpoints c
    where c.hunt_id = p_hunt and not (c.id = any(shortest))
    order by dating_private.treasure_hunt_distance_m(
      (select latitude from treasure_hunt_checkpoints where id = shortest[cardinality(shortest)]),
      (select longitude from treasure_hunt_checkpoints where id = shortest[cardinality(shortest)]),
      c.latitude, c.longitude), c.sequence, c.id
    limit 1;
    if selected_id is null then exit; end if;
    shortest := array_append(shortest, selected_id);
  end loop;
  shortest_length := dating_private.treasure_hunt_route_length(p_hunt, shortest);

  balanced := array[start_id]::uuid[];
  while cardinality(balanced) < checkpoint_total loop
    pos := cardinality(balanced) + 1;
    with nearby as materialized (
      select c.id, c.latitude, c.longitude,
        dating_private.treasure_hunt_distance_m(
          (select latitude from treasure_hunt_checkpoints where id = balanced[cardinality(balanced)]),
          (select longitude from treasure_hunt_checkpoints where id = balanced[cardinality(balanced)]),
          c.latitude, c.longitude) as metres
      from treasure_hunt_checkpoints c
      where c.hunt_id = p_hunt and not (c.id = any(balanced))
      order by metres, c.sequence, c.id limit 4
    ), scored as (
      select n.*,
        (select count(*) from treasure_hunt_routes r
          where r.hunt_id = p_hunt and r.position = pos and r.checkpoint_id = n.id
            and r.participant_id <> p_participant
            and exists (select 1 from treasure_hunt_participants cohort
              join treasure_hunt_routes s on s.participant_id = cohort.id and s.hunt_id = cohort.hunt_id
              where cohort.id = r.participant_id and cohort.legacy_route_order = false
                and s.hunt_id = p_hunt and s.position = 1 and s.checkpoint_id = start_id)) as current_load,
        coalesce((select count(*) from treasure_hunt_routes r
          where r.hunt_id = p_hunt and r.position = pos + 1
            and r.checkpoint_id = (select future.id from treasure_hunt_checkpoints future
              where future.hunt_id = p_hunt and not (future.id = any(balanced || n.id))
              order by dating_private.treasure_hunt_distance_m(n.latitude,n.longitude,future.latitude,future.longitude),future.sequence,future.id
              limit 1)
            and r.participant_id <> p_participant
            and exists (select 1 from treasure_hunt_participants cohort
              join treasure_hunt_routes s on s.participant_id = cohort.id and s.hunt_id = cohort.hunt_id
              where cohort.id = r.participant_id and cohort.legacy_route_order = false
                and s.hunt_id = p_hunt and s.position = 1 and s.checkpoint_id = start_id)), 0) as next_load
      from nearby n
    )
    select id into selected_id from scored order by current_load, next_load, metres, id limit 1;
    if selected_id is null then exit; end if;
    balanced := array_append(balanced, selected_id);
  end loop;
  balanced_length := dating_private.treasure_hunt_route_length(p_hunt, balanced);
  if cardinality(shortest) <> checkpoint_total or cardinality(balanced) <> checkpoint_total then
    raise exception 'Could not create a complete route for this hunt.' using errcode = '22023';
  end if;
  selected_route := case when shortest_length = 0 or balanced_length <= shortest_length * 1.3 then balanced else shortest end;

  delete from treasure_hunt_routes where participant_id = p_participant and hunt_id = p_hunt and position > 1;
  for pos in 2..cardinality(selected_route) loop
    insert into treasure_hunt_routes(participant_id,hunt_id,position,checkpoint_id)
      values(p_participant,p_hunt,pos,selected_route[pos]);
  end loop;
end $$;
revoke all on function dating_private.treasure_hunt_assign_remaining(uuid,uuid) from public, anon, authenticated;

-- Progress is deliberately compact: the phone receives one target and no
-- other checkpoint coordinates, names or route positions.
create or replace function dating_private.treasure_hunt_progress(p_user uuid, p_hunt uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p treasure_hunt_participants%rowtype; h treasure_hunts%rowtype;
  total integer; target jsonb := null; target_checkpoint treasure_hunt_checkpoints%rowtype;
  target_point treasure_hunt_route_points%rowtype;
begin
  select * into p from treasure_hunt_participants where hunt_id = p_hunt and user_id = p_user;
  if not found then return null; end if;
  select * into h from treasure_hunts where id = p_hunt;
  if not found then return null; end if;
  select count(*)::integer into total from treasure_hunt_checkpoints where hunt_id = p_hunt;

  if p.completed_at is null and p.assigned_start_point_id is not null and p.start_claimed_at is null then
    select * into target_point from treasure_hunt_route_points
      where id = p.assigned_start_point_id and hunt_id = p_hunt and point_kind = 'start';
    if found then target := jsonb_build_object('kind','start','id',target_point.id,'name',target_point.name,
      'hint','Reach your starting point, then collect its checkpoint.','latitude',target_point.latitude,'longitude',target_point.longitude,
      'radius_m',target_point.radius_m,'reward_coins',target_point.reward_coins); end if;
  elsif p.completed_at is null and p.last_checkpoint_sequence < total then
    select c.* into target_checkpoint from treasure_hunt_routes r
      join treasure_hunt_checkpoints c on c.id = r.checkpoint_id and c.hunt_id = r.hunt_id
      where r.participant_id = p.id and r.hunt_id = p_hunt and r.position = p.last_checkpoint_sequence + 1;
    if found then target := jsonb_build_object('kind',case when p.last_checkpoint_sequence = 0 and not p.legacy_route_order then 'start' else 'checkpoint' end,
      'id',target_checkpoint.id,'name',target_checkpoint.name,'hint',target_checkpoint.hint,'latitude',target_checkpoint.latitude,
      'longitude',target_checkpoint.longitude,'radius_m',target_checkpoint.radius_m,'reward_coins',target_checkpoint.reward_coins); end if;
  elsif p.completed_at is null and p.last_checkpoint_sequence >= total and p.assigned_finish_point_id is not null then
    select * into target_point from treasure_hunt_route_points
      where id = p.assigned_finish_point_id and hunt_id = p_hunt and point_kind = 'finish';
    if found then target := jsonb_build_object('kind','finish','id',target_point.id,'name',target_point.name,
      'hint','Every checkpoint is done. Reach your final treasure.','latitude',target_point.latitude,'longitude',target_point.longitude,
      'radius_m',target_point.radius_m,'reward_coins',target_point.reward_coins); end if;
  end if;

  return jsonb_build_object(
    'hunt',jsonb_build_object('id',h.id,'title',h.title,'region',h.region,'description',h.description,
      'starts_at',h.starts_at,'ends_at',h.ends_at,'completion_bonus_coins',h.completion_bonus_coins,
      'coin_avatar',h.coin_avatar,'treasure_avatar',h.treasure_avatar,'checkpoint_count',total),
    'participant',jsonb_build_object('joined_at',p.joined_at,
      'total_coins',p.total_coins,'completion_bonus_coins',p.completion_bonus_coins,'completed_at',p.completed_at),
    'found_count',p.last_checkpoint_sequence,'total_count',total,'current_target',target);
end $$;
revoke all on function dating_private.treasure_hunt_progress(uuid,uuid) from public, anon, authenticated;

create or replace function public.treasure_hunt_progress(p_hunt uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); result jsonb;
begin
  perform dating_private.treasure_hunt_check(me);
  result := dating_private.treasure_hunt_progress(me,p_hunt);
  if result is null then raise exception 'Join this hunt first.' using errcode = '42501'; end if;
  return result;
end $$;
revoke all on function public.treasure_hunt_progress(uuid) from public, anon;
grant execute on function public.treasure_hunt_progress(uuid) to authenticated;

create or replace function public.treasure_hunt_progress_with_routes(p_hunt uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); result jsonb;
begin
  perform dating_private.treasure_hunt_check(me);
  result := dating_private.treasure_hunt_progress(me,p_hunt);
  if result is null then raise exception 'Join this hunt first.' using errcode = '42501'; end if;
  return result;
end $$;
revoke all on function public.treasure_hunt_progress_with_routes(uuid) from public, anon;
grant execute on function public.treasure_hunt_progress_with_routes(uuid) to authenticated;

-- New joins choose the nearest checkpoint once. Existing route assignments are
-- retained when a participant retries this call.
create or replace function public.treasure_hunt_join_with_routes(
  p_hunt uuid, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision
) returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p treasure_hunt_participants%rowtype; h treasure_hunts%rowtype; first_id uuid;
begin
  perform dating_private.treasure_hunt_check(me);
  if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180
    or p_accuracy_m is null or p_accuracy_m <= 0 or p_accuracy_m > 75 then
    raise exception 'Your location is not accurate enough to choose a nearby starting point. Try again outdoors.' using errcode='22023';
  end if;
  insert into treasure_hunt_participants(hunt_id,user_id) values(p_hunt,me) on conflict(hunt_id,user_id) do nothing;
  select * into p from treasure_hunt_participants where hunt_id = p_hunt and user_id = me for update;
  select * into h from treasure_hunts where id = p_hunt and status = 'active' and starts_at <= now() and ends_at > now() for share;
  if not found then raise exception 'This hunt is not open right now.' using errcode='P0002'; end if;
  if not exists(select 1 from treasure_hunt_checkpoints where hunt_id=p_hunt) then
    raise exception 'This hunt is not ready yet.' using errcode='P0001';
  end if;
  if not exists(select 1 from treasure_hunt_routes where participant_id=p.id and hunt_id=p_hunt and position=1) then
    select c.id into first_id from treasure_hunt_checkpoints c where c.hunt_id=p_hunt
    order by dating_private.treasure_hunt_distance_m(p_latitude,p_longitude,c.latitude,c.longitude),c.sequence,c.id limit 1;
    insert into treasure_hunt_routes(participant_id,hunt_id,position,checkpoint_id) values(p.id,p_hunt,1,first_id);
  end if;
  return public.treasure_hunt_progress_with_routes(p_hunt);
end $$;
revoke all on function public.treasure_hunt_join_with_routes(uuid,double precision,double precision,double precision) from public, anon;
grant execute on function public.treasure_hunt_join_with_routes(uuid,double precision,double precision,double precision) to authenticated;

-- The no-location legacy join remains available only to participants who had
-- already joined before this migration. It cannot create a new route.
create or replace function public.treasure_hunt_join(p_hunt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); result jsonb;
begin
  perform dating_private.treasure_hunt_check(me);
  if not exists(select 1 from treasure_hunt_participants where hunt_id=p_hunt and user_id=me) then
    raise exception 'Update Treehouse to choose a nearby starting checkpoint.' using errcode='22023';
  end if;
  result := dating_private.treasure_hunt_progress(me,p_hunt);
  if result is null then raise exception 'Join this hunt first.' using errcode='42501'; end if;
  return result;
end $$;
revoke all on function public.treasure_hunt_join(uuid) from public, anon;
grant execute on function public.treasure_hunt_join(uuid) to authenticated;

create or replace function public.treasure_hunt_claim_start(
  p_hunt uuid, p_route_point uuid, p_latitude double precision, p_longitude double precision,
  p_accuracy_m double precision, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); p treasure_hunt_participants%rowtype; h treasure_hunts%rowtype;
  r treasure_hunt_route_points%rowtype; c treasure_hunt_checkpoints%rowtype;
  old treasure_hunt_route_claims%rowtype; old_checkpoint treasure_hunt_claims%rowtype;
  distance_m double precision; attempt_window timestamptz; total integer;
begin
  perform dating_private.treasure_hunt_check(me);
  if p_request_id is null then raise exception 'Try checking in again.' using errcode='22023'; end if;
  select * into p from treasure_hunt_participants where hunt_id=p_hunt and user_id=me for update;
  if not found then raise exception 'Join this hunt first.' using errcode='42501'; end if;

  -- Existing participants keep the staff-assigned start and its old reward.
  if p.assigned_start_point_id is not null then
    select * into old from treasure_hunt_route_claims where participant_id=p.id and route_point_id=p_route_point;
    if found then return jsonb_build_object('ok',true,'idempotent',true,'coins_awarded',old.coins_awarded,'total_coins',p.total_coins,
      'progress',dating_private.treasure_hunt_progress(me,p_hunt)); end if;
    if p.start_claimed_at is not null then return jsonb_build_object('ok',false,'error','Your start point is already checked in.'); end if;
    if p.assigned_start_point_id is distinct from p_route_point then return jsonb_build_object('ok',false,'error','This is not your assigned start point.'); end if;
    select * into h from treasure_hunts where id=p_hunt and status='active' and starts_at<=now() and ends_at>now() for share;
    if not found then return jsonb_build_object('ok',false,'error','This hunt has ended.'); end if;
    select * into r from treasure_hunt_route_points where id=p_route_point and hunt_id=p_hunt and point_kind='start';
    if not found then return jsonb_build_object('ok',false,'error','Start point not found.'); end if;
    if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180
      or p_accuracy_m is null or p_accuracy_m<=0 or p_accuracy_m>75 then return jsonb_build_object('ok',false,'error','Your location is not accurate enough yet.'); end if;
    distance_m := dating_private.treasure_hunt_distance_m(p_latitude,p_longitude,r.latitude,r.longitude);
    if distance_m > r.radius_m then return jsonb_build_object('ok',false,'error','You are not close enough to your assigned start point yet.'); end if;
    attempt_window := date_trunc('minute',now());
    if p.claim_window_at < attempt_window then update treasure_hunt_participants set claim_window_at=attempt_window,claim_attempts=1 where id=p.id;
    elsif p.claim_attempts>=10 then return jsonb_build_object('ok',false,'error','Too many check-in tries. Wait a minute, then try again.');
    else update treasure_hunt_participants set claim_attempts=claim_attempts+1 where id=p.id; end if;
    insert into treasure_hunt_route_claims(participant_id,route_point_id,request_id,coins_awarded) values(p.id,r.id,p_request_id,r.reward_coins);
    update treasure_hunt_participants set start_claimed_at=now(),total_coins=total_coins+r.reward_coins where id=p.id returning * into p;
    return jsonb_build_object('ok',true,'idempotent',false,'coins_awarded',r.reward_coins,'total_coins',p.total_coins,
      'progress',dating_private.treasure_hunt_progress(me,p_hunt));
  end if;

  select * into old_checkpoint from treasure_hunt_claims where participant_id=p.id and request_id=p_request_id;
  if found then
    if old_checkpoint.checkpoint_id <> p_route_point then return jsonb_build_object('ok',false,'error','That request was already used.'); end if;
    return jsonb_build_object('ok',true,'idempotent',true,'coins_awarded',old_checkpoint.coins_awarded,'total_coins',p.total_coins,'checkpoint_sequence',p.last_checkpoint_sequence,
      'progress',dating_private.treasure_hunt_progress(me,p_hunt));
  end if;
  select * into old_checkpoint from treasure_hunt_claims where participant_id=p.id and checkpoint_id=p_route_point;
  if found then return jsonb_build_object('ok',true,'idempotent',true,'coins_awarded',old_checkpoint.coins_awarded,'total_coins',p.total_coins,'checkpoint_sequence',p.last_checkpoint_sequence,
    'progress',dating_private.treasure_hunt_progress(me,p_hunt)); end if;
  if p.start_claimed_at is not null then return jsonb_build_object('ok',false,'error','Your starting checkpoint is already collected.'); end if;
  select cp.* into c from treasure_hunt_routes rt join treasure_hunt_checkpoints cp on cp.id=rt.checkpoint_id and cp.hunt_id=rt.hunt_id
    where rt.participant_id=p.id and rt.hunt_id=p_hunt and rt.position=1 and rt.checkpoint_id=p_route_point;
  if not found then return jsonb_build_object('ok',false,'error','This is not your starting checkpoint.'); end if;
  select * into h from treasure_hunts where id=p_hunt and status='active' and starts_at<=now() and ends_at>now() for update;
  if not found then return jsonb_build_object('ok',false,'error','This hunt has ended.'); end if;
  if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180
    or p_accuracy_m is null or p_accuracy_m<=0 or p_accuracy_m>75 then return jsonb_build_object('ok',false,'error','Your location is not accurate enough yet. Try again outdoors.'); end if;
  distance_m := dating_private.treasure_hunt_distance_m(p_latitude,p_longitude,c.latitude,c.longitude);
  if distance_m > c.radius_m then return jsonb_build_object('ok',false,'error','You are not close enough to your starting checkpoint yet.'); end if;
  attempt_window := date_trunc('minute',now());
  if p.claim_window_at < attempt_window then update treasure_hunt_participants set claim_window_at=attempt_window,claim_attempts=1 where id=p.id;
  elsif p.claim_attempts>=10 then return jsonb_build_object('ok',false,'error','Too many check-in tries. Wait a minute, then try again.');
  else update treasure_hunt_participants set claim_attempts=claim_attempts+1 where id=p.id; end if;
  insert into treasure_hunt_claims(hunt_id,participant_id,checkpoint_id,request_id,coins_awarded)
    values(p_hunt,p.id,c.id,p_request_id,c.reward_coins);
  update treasure_hunt_participants set start_claimed_at=now(),last_checkpoint_sequence=1,total_coins=total_coins+c.reward_coins
    where id=p.id returning * into p;
  if not p.legacy_route_order then perform dating_private.treasure_hunt_assign_remaining(p_hunt,p.id); end if;
  select count(*)::integer into total from treasure_hunt_checkpoints where hunt_id=p_hunt;
  if total = 1 and p.assigned_finish_point_id is null then
    update treasure_hunt_participants participant set assigned_finish_point_id = (
      select point.id from treasure_hunt_route_points point
      where point.hunt_id=p_hunt and point.point_kind='finish'
      order by dating_private.treasure_hunt_distance_m(c.latitude,c.longitude,point.latitude,point.longitude),point.sequence,point.id limit 1
    ) where participant.id=p.id returning * into p;
  end if;
  return jsonb_build_object('ok',true,'idempotent',false,'coins_awarded',c.reward_coins,'total_coins',p.total_coins,'checkpoint_sequence',1,
    'progress',dating_private.treasure_hunt_progress(me,p_hunt));
end $$;
revoke all on function public.treasure_hunt_claim_start(uuid,uuid,double precision,double precision,double precision,uuid) from public, anon;
grant execute on function public.treasure_hunt_claim_start(uuid,uuid,double precision,double precision,double precision,uuid) to authenticated;

create or replace function public.treasure_hunt_claim_checkpoint(
  p_hunt uuid, p_checkpoint uuid, p_latitude double precision, p_longitude double precision,
  p_accuracy_m double precision, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); p treasure_hunt_participants%rowtype; h treasure_hunts%rowtype;
  c treasure_hunt_checkpoints%rowtype; old treasure_hunt_claims%rowtype;
  distance_m double precision; attempt_window timestamptz; total integer;
begin
  perform dating_private.treasure_hunt_check(me);
  if p_request_id is null then raise exception 'Try that checkpoint again.' using errcode='22023'; end if;
  select * into p from treasure_hunt_participants where hunt_id=p_hunt and user_id=me for update;
  if not found then raise exception 'Join this hunt first.' using errcode='42501'; end if;
  select * into old from treasure_hunt_claims where participant_id=p.id and request_id=p_request_id;
  if found then
    if old.checkpoint_id<>p_checkpoint then return jsonb_build_object('ok',false,'error','That request was already used.'); end if;
    return jsonb_build_object('ok',true,'idempotent',true,'coins_awarded',old.coins_awarded,'total_coins',p.total_coins,'checkpoint_sequence',p.last_checkpoint_sequence,
      'progress',dating_private.treasure_hunt_progress(me,p_hunt));
  end if;
  select * into old from treasure_hunt_claims where participant_id=p.id and checkpoint_id=p_checkpoint;
  if found then return jsonb_build_object('ok',true,'idempotent',true,'coins_awarded',old.coins_awarded,'total_coins',p.total_coins,'checkpoint_sequence',p.last_checkpoint_sequence,
    'progress',dating_private.treasure_hunt_progress(me,p_hunt)); end if;
  if p.assigned_start_point_id is not null and p.start_claimed_at is null then return jsonb_build_object('ok',false,'error','Check in at your assigned start point first.'); end if;
  if p.start_claimed_at is null and p.last_checkpoint_sequence=0 and not p.legacy_route_order then
    return jsonb_build_object('ok',false,'error','Check in at your starting checkpoint first.');
  end if;
  attempt_window := date_trunc('minute',now());
  if p.claim_window_at < attempt_window then update treasure_hunt_participants set claim_window_at=attempt_window,claim_attempts=1 where id=p.id;
  elsif p.claim_attempts>=10 then return jsonb_build_object('ok',false,'error','Too many checkpoint tries. Wait a minute, then try again.');
  else update treasure_hunt_participants set claim_attempts=claim_attempts+1 where id=p.id; end if;
  select * into h from treasure_hunts where id=p_hunt and status='active' and starts_at<=now() and ends_at>now() for share;
  if not found then return jsonb_build_object('ok',false,'error','This hunt has ended.'); end if;
  select count(*)::integer into total from treasure_hunt_checkpoints where hunt_id=p_hunt;
  select cp.* into c from treasure_hunt_routes rt join treasure_hunt_checkpoints cp on cp.id=rt.checkpoint_id and cp.hunt_id=rt.hunt_id
    where rt.participant_id=p.id and rt.hunt_id=p_hunt and rt.position=p.last_checkpoint_sequence+1;
  if not found or c.id is distinct from p_checkpoint then return jsonb_build_object('ok',false,'error','Follow your next checkpoint.'); end if;
  if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180
    or p_accuracy_m is null or p_accuracy_m<=0 or p_accuracy_m>75 then return jsonb_build_object('ok',false,'error','Your location is not accurate enough yet. Try again outdoors.'); end if;
  distance_m := dating_private.treasure_hunt_distance_m(p_latitude,p_longitude,c.latitude,c.longitude);
  if distance_m > c.radius_m then return jsonb_build_object('ok',false,'error','You are not close enough to this checkpoint yet.'); end if;
  insert into treasure_hunt_claims(hunt_id,participant_id,checkpoint_id,request_id,coins_awarded) values(p_hunt,p.id,c.id,p_request_id,c.reward_coins);
  update treasure_hunt_participants set last_checkpoint_sequence=last_checkpoint_sequence+1,total_coins=total_coins+c.reward_coins
    where id=p.id returning * into p;
  if p.last_checkpoint_sequence=total and p.assigned_finish_point_id is null then
    update treasure_hunt_participants participant set assigned_finish_point_id = (
      select point.id from treasure_hunt_route_points point
      where point.hunt_id=p_hunt and point.point_kind='finish'
      order by dating_private.treasure_hunt_distance_m(c.latitude,c.longitude,point.latitude,point.longitude),point.sequence,point.id limit 1
    ) where participant.id=p.id returning * into p;
  end if;
  return jsonb_build_object('ok',true,'idempotent',false,'coins_awarded',c.reward_coins,'total_coins',p.total_coins,'checkpoint_sequence',p.last_checkpoint_sequence,
    'progress',dating_private.treasure_hunt_progress(me,p_hunt));
end $$;
revoke all on function public.treasure_hunt_claim_checkpoint(uuid,uuid,double precision,double precision,double precision,uuid) from public, anon;
grant execute on function public.treasure_hunt_claim_checkpoint(uuid,uuid,double precision,double precision,double precision,uuid) to authenticated;

create or replace function public.treasure_hunt_finish(
  p_hunt uuid, p_latitude double precision, p_longitude double precision, p_accuracy_m double precision, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); p treasure_hunt_participants%rowtype; h treasure_hunts%rowtype;
  r treasure_hunt_route_points%rowtype; n integer; distance_m double precision; award integer;
begin
  perform dating_private.treasure_hunt_check(me);
  if p_request_id is null then raise exception 'Try claiming the treasure again.' using errcode='22023'; end if;
  select * into p from treasure_hunt_participants where hunt_id=p_hunt and user_id=me for update;
  if not found then raise exception 'Join this hunt first.' using errcode='42501'; end if;
  if p.completed_at is not null then return jsonb_build_object('ok',true,'idempotent',true,'coins_awarded',p.completion_bonus_coins,'total_coins',p.total_coins); end if;
  select * into h from treasure_hunts where id=p_hunt and status='active' and starts_at<=now() and ends_at>now() for share;
  if not found then return jsonb_build_object('ok',false,'error','This hunt has ended.'); end if;
  select count(*)::integer into n from treasure_hunt_checkpoints where hunt_id=p_hunt;
  if n=0 or p.last_checkpoint_sequence<>n then return jsonb_build_object('ok',false,'error','Find every checkpoint before claiming the treasure.'); end if;
  if p.assigned_start_point_id is not null and p.start_claimed_at is null then return jsonb_build_object('ok',false,'error','Check in at your assigned start point first.'); end if;
  if p.assigned_finish_point_id is not null then
    select * into r from treasure_hunt_route_points where id=p.assigned_finish_point_id and hunt_id=p_hunt and point_kind='finish';
    if not found then return jsonb_build_object('ok',false,'error','Your final treasure location is unavailable.'); end if;
    if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180
      or p_accuracy_m is null or p_accuracy_m<=0 or p_accuracy_m>75 then return jsonb_build_object('ok',false,'error','Your location is not accurate enough yet. Try again outdoors.'); end if;
    distance_m := dating_private.treasure_hunt_distance_m(p_latitude,p_longitude,r.latitude,r.longitude);
    if distance_m > r.radius_m then return jsonb_build_object('ok',false,'error','Reach your assigned final treasure location first.'); end if;
    award := h.completion_bonus_coins + r.reward_coins;
  else
    award := h.completion_bonus_coins;
  end if;
  update treasure_hunt_participants set completed_at=now(),completion_bonus_coins=award,
    completion_request_id=p_request_id,total_coins=total_coins+award where id=p.id returning * into p;
  return jsonb_build_object('ok',true,'idempotent',false,'coins_awarded',p.completion_bonus_coins,'total_coins',p.total_coins);
end $$;
revoke all on function public.treasure_hunt_finish(uuid,double precision,double precision,double precision,uuid) from public, anon;
grant execute on function public.treasure_hunt_finish(uuid,double precision,double precision,double precision,uuid) to authenticated;

create or replace function public.treasure_hunts_active() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); result jsonb;
begin
  perform dating_private.treasure_hunt_check(me);
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'title',h.title,'region',h.region,'description',h.description,
    'starts_at',h.starts_at,'ends_at',h.ends_at,
    'checkpoint_count',(select count(*) from treasure_hunt_checkpoints c where c.hunt_id=h.id),
    'participants',(select count(*) from treasure_hunt_participants p where p.hunt_id=h.id),
    'joined',exists(select 1 from treasure_hunt_participants p where p.hunt_id=h.id and p.user_id=me)) order by h.starts_at,h.id),'[]'::jsonb)
  into result from treasure_hunts h where h.status='active' and h.starts_at<=now() and h.ends_at>now()
    and exists(select 1 from treasure_hunt_checkpoints c where c.hunt_id=h.id);
  return result;
end $$;
revoke all on function public.treasure_hunts_active() from public, anon;
grant execute on function public.treasure_hunts_active() to authenticated;

-- New hunts no longer take separate start locations. Keep the old column and
-- rows for existing joined hunts, while final treasure choices remain staff-set.
create or replace function public.staff_treasure_hunt_save_routes(
  p_hunt jsonb, p_checkpoints jsonb, p_start_points jsonb, p_finish_points jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); hid uuid; joined integer;
  v_coin text := coalesce(p_hunt->>'coin_avatar','🪙'); v_treasure text := coalesce(p_hunt->>'treasure_avatar','🧰');
begin
  perform dating_private.staff_need('manage');
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
    update treasure_hunts set coin_avatar=v_coin,treasure_avatar=v_treasure,updated_at=now() where id=hid;
    delete from treasure_hunt_route_points where hunt_id=hid;
    insert into treasure_hunt_route_points(hunt_id,point_kind,sequence,name,latitude,longitude,radius_m,reward_coins)
      select hid,'finish',x.sequence,btrim(x.name),x.latitude,x.longitude,coalesce(x.radius_m,60),coalesce(x.reward_coins,0)
      from jsonb_to_recordset(p_finish_points) as x(sequence integer,name text,latitude double precision,longitude double precision,radius_m integer,reward_coins integer);
    if (select count(*) from treasure_hunt_route_points where hunt_id=hid and point_kind='finish')<>jsonb_array_length(p_finish_points) then
      raise exception 'Check all treasure names and coordinates.' using errcode='22023';
    end if;
    perform dating_private.staff_log(me,'treasure_hunt_routes_saved','treasure_hunt',hid::text,
      jsonb_build_object('start_points','nearest_checkpoint','finish_points',jsonb_array_length(p_finish_points),'coin_avatar',v_coin,'treasure_avatar',v_treasure));
  end if;
  return hid;
end $$;
revoke all on function public.staff_treasure_hunt_save_routes(jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.staff_treasure_hunt_save_routes(jsonb,jsonb,jsonb,jsonb) to authenticated;
