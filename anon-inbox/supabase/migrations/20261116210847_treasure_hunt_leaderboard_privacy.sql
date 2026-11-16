-- Hide every other participant's leaderboard details until a hunt has ended.
-- During a hunt, the member gets only their own rank/coins and the player count.
set lock_timeout = '5s';

create or replace function public.treasure_hunt_leaderboard(
  p_hunt uuid, p_limit integer default 25, p_after_coins integer default null,
  p_after_joined_at timestamptz default null, p_after_board_key uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  h treasure_hunts%rowtype;
  own_row treasure_hunt_participants%rowtype;
  take_n integer := least(50, greatest(1, coalesce(p_limit, 25)));
  total_players integer;
  own_rank integer;
  rank_offset integer := 0;
  result jsonb;
begin
  perform dating_private.treasure_hunt_check(me);
  select * into h from treasure_hunts where id = p_hunt;
  if not found then raise exception 'This hunt could not be found.' using errcode = 'P0002'; end if;

  select * into own_row from treasure_hunt_participants
  where hunt_id = p_hunt and user_id = me;
  if not found then raise exception 'Join this hunt to see your standing.' using errcode = '42501'; end if;

  select count(*)::integer into total_players
  from treasure_hunt_participants p
  join dating_profiles d on d.user_id = p.user_id
  where p.hunt_id = p_hunt and not d.suspended and d.dob_underage_at is null and d.age >= 18;

  select (1 + count(*))::integer into own_rank
  from treasure_hunt_participants p
  join dating_profiles d on d.user_id = p.user_id
  where p.hunt_id = p_hunt and not d.suspended and d.dob_underage_at is null and d.age >= 18
    and (p.total_coins > own_row.total_coins
      or (p.total_coins = own_row.total_coins and p.joined_at < own_row.joined_at)
      or (p.total_coins = own_row.total_coins and p.joined_at = own_row.joined_at and p.board_key < own_row.board_key));

  -- Full names and progress are available only after the hunt end time or when
  -- staff has explicitly marked the hunt completed. Keep every other state private.
  if h.status <> 'completed' and h.ends_at > now() then
    return jsonb_build_object(
      'visibility', 'self', 'player_count', total_players,
      'own_rank', own_rank, 'own_coins', own_row.total_coins,
      'items', '[]'::jsonb, 'has_more', false
    );
  end if;

  if p_after_coins is null then
    if p_after_joined_at is not null or p_after_board_key is not null then
      raise exception 'That leaderboard page is invalid.' using errcode = '22023';
    end if;
  else
    if p_after_joined_at is null or p_after_board_key is null then
      raise exception 'That leaderboard page is invalid.' using errcode = '22023';
    end if;
    select count(*)::integer into rank_offset
    from treasure_hunt_participants p
    join dating_profiles d on d.user_id = p.user_id
    where p.hunt_id = p_hunt and not d.suspended and d.dob_underage_at is null and d.age >= 18
      and (p.total_coins > p_after_coins
        or (p.total_coins = p_after_coins and p.joined_at < p_after_joined_at)
        or (p.total_coins = p_after_coins and p.joined_at = p_after_joined_at and p.board_key < p_after_board_key));
  end if;

  with candidates as materialized (
    select p.board_key, p.total_coins, p.joined_at, p.last_checkpoint_sequence, p.completed_at, d.handle
    from treasure_hunt_participants p
    join dating_profiles d on d.user_id = p.user_id
    where p.hunt_id = p_hunt and not d.suspended and d.dob_underage_at is null and d.age >= 18
      and (p_after_coins is null or p.total_coins < p_after_coins
        or (p.total_coins = p_after_coins and p.joined_at > p_after_joined_at)
        or (p.total_coins = p_after_coins and p.joined_at = p_after_joined_at and p.board_key > p_after_board_key))
    order by p.total_coins desc, p.joined_at asc, p.board_key asc
    limit take_n + 1
  ), page as (
    select c.*, row_number() over (order by c.total_coins desc, c.joined_at asc, c.board_key asc)::integer as page_position
    from (select * from candidates order by total_coins desc, joined_at asc, board_key asc limit take_n) c
  )
  select jsonb_build_object(
    'visibility', 'full', 'player_count', total_players,
    'own_rank', own_rank, 'own_coins', own_row.total_coins,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'rank', rank_offset + page_position, 'handle', handle, 'coins', total_coins,
      'checkpoints', last_checkpoint_sequence, 'completed_at', completed_at,
      'cursor_key', board_key, 'cursor_coins', total_coins, 'cursor_joined_at', joined_at
    ) order by total_coins desc, joined_at asc, board_key asc) from page), '[]'::jsonb),
    'has_more', (select count(*) > take_n from candidates)
  ) into result;
  return result;
end $$;

revoke all on function public.treasure_hunt_leaderboard(uuid, integer, integer, timestamptz, uuid) from public, anon;
grant execute on function public.treasure_hunt_leaderboard(uuid, integer, integer, timestamptz, uuid) to authenticated;
