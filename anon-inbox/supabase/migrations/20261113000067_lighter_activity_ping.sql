-- Bird Kingdom: the app now says "still here" every 3 minutes instead of every minute (a third of the
-- requests; the request gateway was getting slow). Same rules, scaled: up to 180 s per ping, nothing
-- after a gap over 200 s (idle, background, offline), 16 h per Lagos day, server clock only.

set lock_timeout = '5s';

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
  new_level := greatest(b.level, bird_level_for(b.historical_seconds + b.post_launch_seconds + add_s));
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
