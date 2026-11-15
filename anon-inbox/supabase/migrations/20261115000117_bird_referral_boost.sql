-- Bird Kingdom: invites help your bird grow (Hydra, 15 Nov 2026). "60-40": time on treehouse is at
-- least 60% of every level; invites can cover the other 40%.
-- * Each person who joined with your invite link (and counts in My Treehouse: profile, not suspended,
--   not under 18, not disqualified) covers 40% of the hours needed for ONE level step.
-- * At most one invite per level step, so active time must still make up at least 60% of each step.
--   Invites beyond that carry over to the next levels. Nobody reaches the top on invites alone.
-- * Levels still never go down. Existing invites count from today: everyone is recalculated below.
-- Level hours (unchanged): 5, 20, 50, 100, 250, 500, 1000 (steps of 5, 15, 30, 50, 150, 250, 500 h).

set lock_timeout = '5s';

-- Direct invites that count for this person.
create or replace function dating_private.bird_referrals(p_user uuid) returns int
language sql stable security definer set search_path = public, dating_private as $$
  select count(*)::int from referrals r where r.referrer = p_user and referral_counts(r.user_id) $$;

-- Level from active seconds plus invites. effective = seconds counted toward the bar in the app
-- (real time + the invite share already used + the invite share waiting for the current step).
create or replace function dating_private.bird_progress(p_seconds bigint, p_refs int,
  out level smallint, out effective bigint, out used int)
language plpgsql immutable as $$
declare
  t bigint[] := array[0, 5, 20, 50, 100, 250, 500, 1000];
  lvl int := 1; bonus bigint := 0; r int := greatest(coalesce(p_refs, 0), 0); b bigint; step bigint;
begin
  loop
    exit when lvl >= 8;
    step := (t[lvl + 1] - t[lvl]) * 3600;
    b := case when r > 0 then (step * 4) / 10 else 0 end;
    if coalesce(p_seconds, 0) + bonus + b >= t[lvl + 1] * 3600 then
      lvl := lvl + 1; bonus := bonus + b;
      if b > 0 then r := r - 1; end if;
    else
      exit;
    end if;
  end loop;
  level := lvl;
  effective := coalesce(p_seconds, 0) + bonus
    + case when lvl < 8 and r > 0 then ((t[lvl + 1] - t[lvl]) * 3600 * 4) / 10 else 0 end;
  used := greatest(coalesce(p_refs, 0), 0) - r;
end $$;

-- What the app sees: 'seconds' now includes the invite share (the bar fills the same way).
create or replace function dating_private.bird_view(b dating_private.bird_kingdom) returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select jsonb_build_object(
    'level', b.level,
    'seconds', greatest(p.effective, b.historical_seconds + b.post_launch_seconds),
    'historical_seconds', b.historical_seconds,
    'invites', p.used,
    'launch_level', case when b.launch_seen_at is null and coalesce(b.launch_level, 1) >= 2 then b.launch_level end,
    'leveled_at', b.leveled_at,
    'now', now())
  from bird_progress(b.historical_seconds + b.post_launch_seconds, bird_referrals(b.user_id)) p $$;

create or replace function public.activity_ping() returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  b bird_kingdom%rowtype;
  today date := (now() at time zone 'Africa/Lagos')::date;
  add_s integer := 0;
  new_level smallint;
  up boolean := false;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  insert into bird_kingdom (user_id, migration_status) values (me, bird_start_status(me)) on conflict (user_id) do nothing;
  select * into b from bird_kingdom where user_id = me for update;
  if b.last_ping_at is not null and b.last_ping_at > now() - interval '200 seconds' then
    add_s := least(greatest(floor(extract(epoch from now() - b.last_ping_at))::integer, 0), 180);
  end if;
  if b.day is distinct from today then b.day := today; b.day_seconds := 0; end if;
  add_s := least(add_s, greatest(16 * 3600 - b.day_seconds, 0));
  new_level := greatest(b.level, (bird_progress(b.historical_seconds + b.post_launch_seconds + add_s, bird_referrals(me))).level);
  up := new_level > b.level;
  update bird_kingdom set
    post_launch_seconds = post_launch_seconds + add_s,
    day = b.day, day_seconds = b.day_seconds + add_s,
    last_ping_at = now(),
    level = new_level,
    leveled_at = case when up then now() else leveled_at end
  where user_id = me
  returning * into b;
  return bird_view(b) || jsonb_build_object('leveled_up', up, 'added', add_s);
end $$;

-- Recalculate one person's level now (never lower). Used when someone joins with their link.
create or replace function dating_private.bird_refresh(p_user uuid) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare b bird_kingdom%rowtype; lvl smallint;
begin
  if p_user is null then return; end if;
  insert into bird_kingdom (user_id, migration_status) values (p_user, bird_start_status(p_user)) on conflict (user_id) do nothing;
  select * into b from bird_kingdom where user_id = p_user for update;
  lvl := (bird_progress(b.historical_seconds + b.post_launch_seconds, bird_referrals(p_user))).level;
  if lvl > b.level then
    update bird_kingdom set level = lvl, leveled_at = now() where user_id = p_user;
  end if;
end $$;

create or replace function dating_private.referrals_bird() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  begin
    perform bird_refresh(new.referrer);
  exception when others then null;   -- a level update must never block a sign-up
  end;
  return null;
end $$;
drop trigger if exists referrals_bird on dating_private.referrals;
create trigger referrals_bird after insert or update of referrer on dating_private.referrals
  for each row when (new.referrer is not null) execute function dating_private.referrals_bird();

revoke all on function dating_private.bird_referrals(uuid), dating_private.bird_progress(bigint, int), dating_private.bird_refresh(uuid),
  dating_private.referrals_bird() from public, anon, authenticated;

-- Existing invites count now: recalculate everyone who has invited someone.
do $$ declare u uuid; begin
  for u in select distinct referrer from dating_private.referrals where referrer is not null loop
    perform dating_private.bird_refresh(u);
  end loop;
end $$;
