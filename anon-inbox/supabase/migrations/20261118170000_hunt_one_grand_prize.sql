-- One grand prize location per hunt (Hydra, 18 Nov 2026).
-- Players start at their nearest checkpoint and work through every checkpoint; then they all go to the
-- SAME grand prize location. Before, a hunt could have up to 10 grand prize spots and each player was
-- sent to the one nearest their last checkpoint. Now a hunt has exactly one, so the existing
-- "assign the grand prize after the last checkpoint" step always picks that same spot for everyone.
-- (The grand prize still only unlocks after every checkpoint is found; that check is unchanged.)
set lock_timeout = '5s';

-- No hunts exist today, but be safe: keep only the first grand prize spot of any older hunt nobody has
-- been assigned to yet. (A spot a player is already heading to is kept.)
delete from public.treasure_hunt_route_points r
where r.point_kind = 'finish'
  and exists (select 1 from public.treasure_hunt_route_points f where f.hunt_id = r.hunt_id and f.point_kind = 'finish' and f.sequence < r.sequence)
  and not exists (select 1 from public.treasure_hunt_participants p where p.assigned_finish_point_id = r.id);

-- The database itself allows only one grand prize spot per hunt.
create unique index if not exists treasure_hunt_one_grand_prize
  on public.treasure_hunt_route_points (hunt_id) where point_kind = 'finish';

create or replace function public.staff_treasure_hunt_save_routes(
  p_hunt jsonb, p_checkpoints jsonb, p_start_points jsonb, p_finish_points jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); hid uuid; joined integer; old_state text; registered integer;
  v_coin text := coalesce(p_hunt->>'coin_avatar','🪙'); v_treasure text := coalesce(p_hunt->>'treasure_avatar','🧰');
  v_state text := nullif(btrim(coalesce(p_hunt->>'state','')), '');
  v_radius integer; v_max integer; v_winners integer; v_rules text := coalesce(p_hunt->>'rules', '');
begin
  perform dating_private.staff_need('manage');
  begin v_radius := coalesce((p_hunt->>'join_radius_km')::integer, 60);
  exception when others then raise exception 'The hunt area size must be a number of kilometres.' using errcode='22023'; end;
  if v_radius not between 1 and 1000 then raise exception 'The hunt area must be between 1 and 1,000 km.' using errcode='22023'; end if;
  begin v_max := coalesce((p_hunt->>'max_registrations')::integer,
    (select max_registrations from treasure_hunts where id = nullif(p_hunt->>'id','')::uuid), 1000);
  exception when others then raise exception 'The participant limit must be a number.' using errcode='22023'; end;
  if v_max not between 10 and 1000 then raise exception 'The participant limit must be between 10 and 1,000.' using errcode='22023'; end if;
  begin v_winners := coalesce((p_hunt->>'winners_count')::integer,
    (select winners_count from treasure_hunts where id = nullif(p_hunt->>'id','')::uuid), 10);
  exception when others then raise exception 'The number of winners must be a number.' using errcode='22023'; end;
  if v_winners not between 1 and 100 or v_winners > v_max then
    raise exception 'Choose between 1 and 100 winners (no more than the participant limit).' using errcode='22023';
  end if;
  if not (p_hunt ? 'rules') then v_rules := coalesce((select rules from treasure_hunts where id = nullif(p_hunt->>'id','')::uuid), ''); end if;
  if char_length(v_rules) > 2000 then raise exception 'Keep the hunt rules under 2,000 characters.' using errcode='22023'; end if;
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
    or jsonb_typeof(p_finish_points) is distinct from 'array' or jsonb_array_length(p_finish_points) <> 1 then
    raise exception 'Add exactly one grand prize location. Every player finishes there.' using errcode='22023';
  end if;
  if v_coin not in ('🪙','💰','⭐','💎','🟡','🟠') or v_treasure not in ('🧰','🎁','🏆','💎','👑','🪙') then
    raise exception 'Choose an available coin and treasure design.' using errcode='22023';
  end if;
  hid := public.staff_treasure_hunt_save(p_hunt,p_checkpoints);
  update treasure_hunts set max_registrations = v_max, rules = v_rules,
    winners_count = case when not exists (select 1 from treasure_hunt_winner_notices n where n.hunt_id = treasure_hunts.id) then v_winners else winners_count end
  where id = hid and (max_registrations, rules, winners_count) is distinct from (v_max, v_rules, v_winners);
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
        'state',v_state,'join_radius_km',v_radius,'max_registrations',v_max,'winners_count',v_winners));
  end if;
  return hid;
end $$;
revoke all on function public.staff_treasure_hunt_save_routes(jsonb,jsonb,jsonb,jsonb) from public, anon;
grant execute on function public.staff_treasure_hunt_save_routes(jsonb,jsonb,jsonb,jsonb) to authenticated;
