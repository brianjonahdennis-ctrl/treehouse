-- Allow hunts to use any practical number of checkpoints while keeping one required.
set lock_timeout = '5s';

alter table public.treasure_hunt_checkpoints
  drop constraint if exists treasure_hunt_checkpoints_sequence_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'treasure_hunt_checkpoints_sequence_check') then
    alter table public.treasure_hunt_checkpoints
      add constraint treasure_hunt_checkpoints_sequence_check check (sequence >= 1);
  end if;
end $$;

alter table public.treasure_hunt_participants
  drop constraint if exists treasure_hunt_participants_last_checkpoint_sequence_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'treasure_hunt_participants_last_checkpoint_sequence_check') then
    alter table public.treasure_hunt_participants
      add constraint treasure_hunt_participants_last_checkpoint_sequence_check check (last_checkpoint_sequence >= 0);
  end if;
end $$;

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
    raise exception 'Add at least one checkpoint.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_checkpoints) < 1 then
    raise exception 'Add at least one checkpoint.' using errcode = '22023';
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
    if checkpoint_count <> jsonb_array_length(p_checkpoints) or checkpoint_count < 1 or
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
