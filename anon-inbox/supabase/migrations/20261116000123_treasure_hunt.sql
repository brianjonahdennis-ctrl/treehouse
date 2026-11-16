-- Treasure Hunt: local camera/location processing, event-driven checkpoint claims, and
-- idempotent in-app coins. No location trail, camera upload, new service, or background polling.
set lock_timeout = '5s';

create table if not exists public.treasure_hunts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 3 and 80),
  region text not null check (char_length(btrim(region)) between 2 and 80),
  description text not null default '' check (char_length(description) <= 500),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'active', 'completed', 'cancelled')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  completion_bonus_coins integer not null default 100 check (completion_bonus_coins between 0 and 100000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists treasure_hunts_active_time on public.treasure_hunts (starts_at, ends_at) where status = 'active';

create table if not exists public.treasure_hunt_checkpoints (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references public.treasure_hunts (id) on delete cascade,
  sequence integer not null check (sequence between 1 and 25),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  hint text not null default '' check (char_length(hint) <= 240),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_m integer not null default 45 check (radius_m between 20 and 200),
  reward_coins integer not null default 100 check (reward_coins between 0 and 100000),
  unique (hunt_id, sequence),
  unique (id, hunt_id)
);
create index if not exists treasure_hunt_checkpoints_order on public.treasure_hunt_checkpoints (hunt_id, sequence);

create table if not exists public.treasure_hunt_participants (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references public.treasure_hunts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  board_key uuid not null unique default gen_random_uuid(),
  joined_at timestamptz not null default now(),
  last_checkpoint_sequence integer not null default 0 check (last_checkpoint_sequence between 0 and 25),
  total_coins integer not null default 0 check (total_coins >= 0),
  claim_window_at timestamptz not null default now(),
  claim_attempts integer not null default 0 check (claim_attempts between 0 and 10),
  completion_bonus_coins integer not null default 0 check (completion_bonus_coins >= 0),
  completion_request_id uuid unique,
  completed_at timestamptz,
  unique (hunt_id, user_id),
  unique (id, hunt_id)
);
create index if not exists treasure_hunt_participants_board on public.treasure_hunt_participants
  (hunt_id, total_coins desc, joined_at asc, board_key asc);
create index if not exists treasure_hunt_participants_user on public.treasure_hunt_participants (user_id, joined_at desc);

create table if not exists public.treasure_hunt_claims (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null,
  participant_id uuid not null,
  checkpoint_id uuid not null,
  request_id uuid not null unique,
  coins_awarded integer not null check (coins_awarded >= 0),
  claimed_at timestamptz not null default now(),
  unique (participant_id, checkpoint_id),
  foreign key (participant_id, hunt_id) references public.treasure_hunt_participants (id, hunt_id) on delete cascade,
  foreign key (checkpoint_id, hunt_id) references public.treasure_hunt_checkpoints (id, hunt_id) on delete cascade
);
create index if not exists treasure_hunt_claims_progress on public.treasure_hunt_claims (participant_id, claimed_at);

alter table public.treasure_hunts enable row level security;
alter table public.treasure_hunt_checkpoints enable row level security;
alter table public.treasure_hunt_participants enable row level security;
alter table public.treasure_hunt_claims enable row level security;
revoke all on public.treasure_hunts, public.treasure_hunt_checkpoints, public.treasure_hunt_participants, public.treasure_hunt_claims from public, anon, authenticated;

create or replace function dating_private.treasure_hunt_check(p_user uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_user is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from dating_profiles p where p.user_id = p_user and not p.suspended and p.dob_underage_at is null and p.age >= 18) then
    raise exception 'Create an eligible treehouse profile first.' using errcode = '42501';
  end if;
end $$;
revoke all on function dating_private.treasure_hunt_check(uuid) from public, anon, authenticated;

create or replace function dating_private.treasure_hunt_progress(p_user uuid, p_hunt uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'hunt', jsonb_build_object('id', h.id, 'title', h.title, 'region', h.region, 'description', h.description,
      'starts_at', h.starts_at, 'ends_at', h.ends_at, 'completion_bonus_coins', h.completion_bonus_coins),
    'participant', jsonb_build_object('joined_at', p.joined_at, 'last_checkpoint_sequence', p.last_checkpoint_sequence,
      'total_coins', p.total_coins, 'completion_bonus_coins', p.completion_bonus_coins, 'completed_at', p.completed_at),
    'checkpoints', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'sequence', c.sequence, 'name', c.name, 'hint', c.hint, 'latitude', c.latitude,
      'longitude', c.longitude, 'radius_m', c.radius_m, 'reward_coins', c.reward_coins,
      'claimed', c.sequence <= p.last_checkpoint_sequence) order by c.sequence)
      from treasure_hunt_checkpoints c where c.hunt_id = h.id), '[]'::jsonb))
  from treasure_hunts h join treasure_hunt_participants p on p.hunt_id = h.id and p.user_id = p_user
  where h.id = p_hunt
$$;
revoke all on function dating_private.treasure_hunt_progress(uuid, uuid) from public, anon, authenticated;

-- One compact catalogue read per screen visit; checkpoint coordinates are returned only after joining.
create or replace function public.treasure_hunts_active() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); out_json jsonb;
begin
  perform dating_private.treasure_hunt_check(me);
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'title', h.title, 'region', h.region,
    'description', h.description, 'starts_at', h.starts_at, 'ends_at', h.ends_at,
    'checkpoint_count', (select count(*) from treasure_hunt_checkpoints c where c.hunt_id = h.id),
    'participants', (select count(*) from treasure_hunt_participants p where p.hunt_id = h.id),
    'joined', exists(select 1 from treasure_hunt_participants p where p.hunt_id = h.id and p.user_id = me))
    order by h.starts_at, h.id), '[]'::jsonb)
  into out_json from treasure_hunts h
  where h.status = 'active' and h.starts_at <= now() and h.ends_at > now()
    and exists(select 1 from treasure_hunt_checkpoints c where c.hunt_id = h.id);
  return out_json;
end $$;
revoke all on function public.treasure_hunts_active() from public, anon;
grant execute on function public.treasure_hunts_active() to authenticated;

-- Joining is safe to retry and returns the manifest only to a signed-in participant.
create or replace function public.treasure_hunt_join(p_hunt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); h treasure_hunts%rowtype;
begin
  perform dating_private.treasure_hunt_check(me);
  select * into h from treasure_hunts where id = p_hunt and status = 'active' and starts_at <= now() and ends_at > now() for share;
  if not found then raise exception 'This hunt is not open right now.' using errcode = 'P0002'; end if;
  if not exists(select 1 from treasure_hunt_checkpoints where hunt_id = p_hunt) then raise exception 'This hunt is not ready yet.' using errcode = 'P0001'; end if;
  insert into treasure_hunt_participants (hunt_id, user_id) values (p_hunt, me) on conflict (hunt_id, user_id) do nothing;
  return dating_private.treasure_hunt_progress(me, p_hunt);
end $$;
revoke all on function public.treasure_hunt_join(uuid) from public, anon;
grant execute on function public.treasure_hunt_join(uuid) to authenticated;

create or replace function public.treasure_hunt_progress(p_hunt uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); result jsonb;
begin
  perform dating_private.treasure_hunt_check(me);
  result := dating_private.treasure_hunt_progress(me, p_hunt);
  if result is null then raise exception 'Join this hunt first.' using errcode = '42501'; end if;
  return result;
end $$;
revoke all on function public.treasure_hunt_progress(uuid) from public, anon;
grant execute on function public.treasure_hunt_progress(uuid) to authenticated;

-- A claim is one deliberate location check. Coordinates are used in memory for this transaction only.
-- A per-participant ten-attempt/minute limit and row lock stop spam and concurrent duplicate awards.
create or replace function public.treasure_hunt_claim_checkpoint(
  p_hunt uuid, p_checkpoint uuid, p_latitude double precision, p_longitude double precision,
  p_accuracy_m double precision, p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); p treasure_hunt_participants%rowtype; h treasure_hunts%rowtype;
  c treasure_hunt_checkpoints%rowtype; old treasure_hunt_claims%rowtype;
  rad double precision := pi() / 180; a double precision; distance_m double precision;
begin
  perform dating_private.treasure_hunt_check(me);
  if p_request_id is null then raise exception 'Try that checkpoint again.' using errcode = '22023'; end if;
  select * into p from treasure_hunt_participants where hunt_id = p_hunt and user_id = me for update;
  if not found then raise exception 'Join this hunt first.' using errcode = '42501'; end if;

  select * into old from treasure_hunt_claims where participant_id = p.id and request_id = p_request_id;
  if found then
    if old.checkpoint_id <> p_checkpoint then return jsonb_build_object('ok', false, 'error', 'That request was already used.'); end if;
    return jsonb_build_object('ok', true, 'idempotent', true, 'coins_awarded', old.coins_awarded,
      'total_coins', p.total_coins, 'checkpoint_sequence', p.last_checkpoint_sequence);
  end if;
  select * into old from treasure_hunt_claims where participant_id = p.id and checkpoint_id = p_checkpoint;
  if found then return jsonb_build_object('ok', true, 'idempotent', true, 'coins_awarded', old.coins_awarded,
    'total_coins', p.total_coins, 'checkpoint_sequence', p.last_checkpoint_sequence); end if;

  if p.claim_window_at < date_trunc('minute', now()) then
    update treasure_hunt_participants set claim_window_at = date_trunc('minute', now()), claim_attempts = 1 where id = p.id;
  elsif p.claim_attempts >= 10 then
    return jsonb_build_object('ok', false, 'error', 'Too many checkpoint tries. Wait a minute, then try again.');
  else
    update treasure_hunt_participants set claim_attempts = claim_attempts + 1 where id = p.id;
  end if;

  select * into h from treasure_hunts where id = p_hunt and status = 'active' and starts_at <= now() and ends_at > now() for share;
  if not found then return jsonb_build_object('ok', false, 'error', 'This hunt has ended.'); end if;
  select * into c from treasure_hunt_checkpoints where id = p_checkpoint and hunt_id = p_hunt and sequence = p.last_checkpoint_sequence + 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'Follow the checkpoints in order.'); end if;
  if p_latitude is null or p_latitude not between -90 and 90 or p_longitude is null or p_longitude not between -180 and 180
     or p_accuracy_m is null or p_accuracy_m <= 0 or p_accuracy_m > 75 then
    return jsonb_build_object('ok', false, 'error', 'Your location is not accurate enough yet. Try again outdoors.');
  end if;
  a := sin((p_latitude - c.latitude) * rad / 2)^2
     + cos(c.latitude * rad) * cos(p_latitude * rad) * sin((p_longitude - c.longitude) * rad / 2)^2;
  distance_m := 6371000 * 2 * asin(sqrt(least(1, greatest(0, a))));
  if distance_m > c.radius_m then return jsonb_build_object('ok', false, 'error', 'You are not close enough to this checkpoint yet.'); end if;

  insert into treasure_hunt_claims (hunt_id, participant_id, checkpoint_id, request_id, coins_awarded)
  values (p_hunt, p.id, c.id, p_request_id, c.reward_coins);
  update treasure_hunt_participants set last_checkpoint_sequence = c.sequence, total_coins = total_coins + c.reward_coins where id = p.id returning * into p;
  return jsonb_build_object('ok', true, 'idempotent', false, 'coins_awarded', c.reward_coins,
    'total_coins', p.total_coins, 'checkpoint_sequence', p.last_checkpoint_sequence);
end $$;
revoke all on function public.treasure_hunt_claim_checkpoint(uuid, uuid, double precision, double precision, double precision, uuid) from public, anon;
grant execute on function public.treasure_hunt_claim_checkpoint(uuid, uuid, double precision, double precision, double precision, uuid) to authenticated;

create or replace function public.treasure_hunt_finish(p_hunt uuid, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p treasure_hunt_participants%rowtype; h treasure_hunts%rowtype; n integer;
begin
  perform dating_private.treasure_hunt_check(me);
  if p_request_id is null then raise exception 'Try claiming the treasure again.' using errcode = '22023'; end if;
  select * into p from treasure_hunt_participants where hunt_id = p_hunt and user_id = me for update;
  if not found then raise exception 'Join this hunt first.' using errcode = '42501'; end if;
  if p.completed_at is not null then
    if p.completion_request_id is distinct from p_request_id then
      return jsonb_build_object('ok', true, 'idempotent', true, 'coins_awarded', p.completion_bonus_coins, 'total_coins', p.total_coins);
    end if;
    return jsonb_build_object('ok', true, 'idempotent', true, 'coins_awarded', p.completion_bonus_coins, 'total_coins', p.total_coins);
  end if;
  select * into h from treasure_hunts where id = p_hunt and status = 'active' and starts_at <= now() and ends_at > now() for share;
  if not found then return jsonb_build_object('ok', false, 'error', 'This hunt has ended.'); end if;
  select count(*) into n from treasure_hunt_checkpoints where hunt_id = p_hunt;
  if n = 0 or p.last_checkpoint_sequence <> n then return jsonb_build_object('ok', false, 'error', 'Find every checkpoint before claiming the treasure.'); end if;
  update treasure_hunt_participants set completed_at = now(), completion_bonus_coins = h.completion_bonus_coins,
    completion_request_id = p_request_id, total_coins = total_coins + h.completion_bonus_coins
  where id = p.id returning * into p;
  return jsonb_build_object('ok', true, 'idempotent', false, 'coins_awarded', p.completion_bonus_coins, 'total_coins', p.total_coins);
end $$;
revoke all on function public.treasure_hunt_finish(uuid, uuid) from public, anon;
grant execute on function public.treasure_hunt_finish(uuid, uuid) to authenticated;

-- Keyset pagination uses an opaque per-participant board key, never a treehouse user id.
create or replace function public.treasure_hunt_leaderboard(
  p_hunt uuid, p_limit integer default 25, p_after_coins integer default null,
  p_after_joined_at timestamptz default null, p_after_board_key uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); take_n integer := least(50, greatest(1, coalesce(p_limit, 25))); result jsonb;
begin
  perform dating_private.treasure_hunt_check(me);
  if not exists(select 1 from treasure_hunt_participants where hunt_id = p_hunt and user_id = me) then
    raise exception 'Join this hunt to see its leaderboard.' using errcode = '42501';
  end if;
  with candidates as (
    select p.board_key, p.total_coins, p.joined_at, p.last_checkpoint_sequence, p.completed_at, d.handle
    from treasure_hunt_participants p join dating_profiles d on d.user_id = p.user_id
    where p.hunt_id = p_hunt and not d.suspended and d.dob_underage_at is null and d.age >= 18
      and (p_after_coins is null or p.total_coins < p_after_coins
        or (p.total_coins = p_after_coins and p.joined_at > p_after_joined_at)
        or (p.total_coins = p_after_coins and p.joined_at = p_after_joined_at and p.board_key > p_after_board_key))
    order by p.total_coins desc, p.joined_at asc, p.board_key asc limit take_n + 1
  ), page as (select * from candidates order by total_coins desc, joined_at asc, board_key asc limit take_n)
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('handle', handle, 'coins', total_coins,
      'checkpoints', last_checkpoint_sequence, 'completed_at', completed_at, 'cursor_key', board_key,
      'cursor_coins', total_coins, 'cursor_joined_at', joined_at) order by total_coins desc, joined_at asc, board_key asc) from page), '[]'::jsonb),
    'has_more', (select count(*) > take_n from candidates)) into result;
  return result;
end $$;
revoke all on function public.treasure_hunt_leaderboard(uuid, integer, integer, timestamptz, uuid) from public, anon;
grant execute on function public.treasure_hunt_leaderboard(uuid, integer, integer, timestamptz, uuid) to authenticated;

-- Admin content controls use the existing MFA-checked staff role and audit log.
create or replace function public.staff_treasure_hunts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  perform dating_private.staff_need('manage');
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'title', h.title, 'region', h.region,
    'description', h.description, 'status', h.status, 'starts_at', h.starts_at, 'ends_at', h.ends_at,
    'completion_bonus_coins', h.completion_bonus_coins,
    'participant_count', (select count(*) from treasure_hunt_participants p where p.hunt_id = h.id),
    'checkpoints', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'sequence', c.sequence, 'name', c.name,
      'hint', c.hint, 'latitude', c.latitude, 'longitude', c.longitude, 'radius_m', c.radius_m,
      'reward_coins', c.reward_coins) order by c.sequence) from treasure_hunt_checkpoints c where c.hunt_id = h.id), '[]'::jsonb))
    order by h.created_at desc), '[]'::jsonb) into result from treasure_hunts h;
  return result;
end $$;
revoke all on function public.staff_treasure_hunts() from public, anon;
grant execute on function public.staff_treasure_hunts() to authenticated;

create or replace function public.staff_treasure_hunt_save(p_hunt jsonb, p_checkpoints jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); hid uuid; participant_count integer := 0;
  v_title text := btrim(coalesce(p_hunt->>'title', ''));
  v_region text := btrim(coalesce(p_hunt->>'region', ''));
  v_description text := coalesce(p_hunt->>'description', '');
  v_status text := coalesce(p_hunt->>'status', 'draft');
  v_starts_at timestamptz := (p_hunt->>'starts_at')::timestamptz;
  v_ends_at timestamptz := (p_hunt->>'ends_at')::timestamptz;
  v_bonus integer := coalesce((p_hunt->>'completion_bonus_coins')::integer, 100);
  checkpoint_count integer;
begin
  perform dating_private.staff_need('manage');
  if jsonb_typeof(p_checkpoints) is distinct from 'array' then
    raise exception 'Add between 2 and 25 checkpoints.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_checkpoints) not between 2 and 25 then
    raise exception 'Add between 2 and 25 checkpoints.' using errcode = '22023';
  end if;
  if char_length(v_title) not between 3 and 80 or char_length(v_region) not between 2 and 80 or char_length(v_description) > 500
     or v_status not in ('draft', 'scheduled', 'active', 'completed', 'cancelled') or v_ends_at <= v_starts_at or v_bonus not between 0 and 100000 then
    raise exception 'Check the hunt title, area, dates, status and bonus.' using errcode = '22023';
  end if;
  if p_hunt ? 'id' and nullif(p_hunt->>'id', '') is not null then
    hid := (p_hunt->>'id')::uuid;
    perform 1 from treasure_hunts where id = hid for update;
    if not found then raise exception 'That hunt no longer exists.' using errcode = 'P0002'; end if;
    select count(*) into participant_count from treasure_hunt_participants where hunt_id = hid;
    if participant_count > 0 and v_status <> 'cancelled' then raise exception 'A hunt with players already joined can only be cancelled.' using errcode = '42501'; end if;
    update treasure_hunts as h set title = v_title, region = v_region, description = v_description, status = v_status,
      starts_at = v_starts_at, ends_at = v_ends_at, completion_bonus_coins = v_bonus, updated_at = now() where h.id = hid;
    if participant_count = 0 then delete from treasure_hunt_checkpoints where hunt_id = hid; end if;
  else
    insert into treasure_hunts (title, region, description, status, starts_at, ends_at, completion_bonus_coins, created_by)
    values (v_title, v_region, v_description, v_status, v_starts_at, v_ends_at, v_bonus, me) returning id into hid;
  end if;
  if participant_count = 0 then
    insert into treasure_hunt_checkpoints (hunt_id, sequence, name, hint, latitude, longitude, radius_m, reward_coins)
    select hid, x.sequence, btrim(x.name), coalesce(x.hint, ''), x.latitude, x.longitude,
      coalesce(x.radius_m, 45), coalesce(x.reward_coins, 100)
    from jsonb_to_recordset(p_checkpoints) as x(sequence integer, name text, hint text, latitude double precision,
      longitude double precision, radius_m integer, reward_coins integer);
    get diagnostics checkpoint_count = row_count;
    if checkpoint_count <> jsonb_array_length(p_checkpoints) or
       (select min(sequence) <> 1 or max(sequence) <> checkpoint_count or count(distinct sequence) <> checkpoint_count from treasure_hunt_checkpoints where hunt_id = hid) then
      raise exception 'Checkpoint numbers must run from 1 in order, with no gaps.' using errcode = '22023';
    end if;
  end if;
  perform dating_private.staff_log(me, 'treasure_hunt_saved', 'treasure_hunt', hid::text,
    jsonb_build_object('status', v_status, 'checkpoints', (select count(*) from treasure_hunt_checkpoints where hunt_id = hid)));
  return hid;
end $$;
revoke all on function public.staff_treasure_hunt_save(jsonb, jsonb) from public, anon;
grant execute on function public.staff_treasure_hunt_save(jsonb, jsonb) to authenticated;
