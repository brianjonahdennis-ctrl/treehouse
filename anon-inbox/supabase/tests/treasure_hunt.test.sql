-- Treasure Hunt: personal routes, private next-target responses and safe rewards.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(38);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'hunt1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000e2', 'hunt2@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000e3', 'hunt3@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

create function pg_temp.login(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select create_my_profile('Lucky Heron 101', 'female', (current_date - interval '26 years')::date, 'Rivers', 'fun');
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select create_my_profile('Calm Kite 202', 'male', (current_date - interval '28 years')::date, 'Rivers', 'fun');
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select create_my_profile('Bright Sparrow 303', 'female', (current_date - interval '29 years')::date, 'Rivers', 'fun');
select pg_temp.admin();

insert into treasure_hunts (id, title, region, description, status, starts_at, ends_at, completion_bonus_coins)
values ('00000000-0000-4000-8000-0000000000e1', 'Port Harcourt preview', 'Rivers', 'Test route', 'active', now() - interval '1 hour', now() + interval '1 day', 100);
insert into treasure_hunt_checkpoints (id, hunt_id, sequence, name, hint, latitude, longitude, radius_m, reward_coins) values
 ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1', 1, 'First stop', 'Look around.', 4.8156, 7.0498, 80, 100),
 ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000e1', 2, 'Second stop', 'Keep going.', 4.8158, 7.0498, 80, 100),
 ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000e1', 3, 'Third stop', 'Look to the river.', 4.8156, 7.0500, 80, 100),
 ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000e1', 4, 'Fourth stop', 'The garden is close.', 4.8159, 7.0501, 80, 100);
insert into treasure_hunt_route_points(hunt_id,point_kind,sequence,name,latitude,longitude,radius_m,reward_coins) values
 ('00000000-0000-4000-8000-0000000000e1','finish',1,'Grand prize near park',4.8160,7.0502,80,25),
 ('00000000-0000-4000-8000-0000000000e1','finish',2,'Grand prize near market',4.8154,7.0496,80,25);
select set_config('test.hunt', '00000000-0000-4000-8000-0000000000e1', true);
select set_config('test.cp1', '00000000-0000-4000-8000-0000000000f1', true);
select set_config('test.cp2', '00000000-0000-4000-8000-0000000000f2', true);
select set_config('test.cp3', '00000000-0000-4000-8000-0000000000f3', true);
select set_config('test.cp4', '00000000-0000-4000-8000-0000000000f4', true);

select ok(not has_table_privilege('authenticated', 'public.treasure_hunt_routes', 'select'), 'members cannot read other players’ route rows directly');
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select is((treasure_hunts_active() -> 0 ->> 'title'), 'Port Harcourt preview', 'an eligible member sees an open hunt');
select is((treasure_hunt_join_with_routes(current_setting('test.hunt')::uuid,4.8156,7.0498,8)->'current_target'->>'kind'), 'start', 'the nearest checkpoint is the starting point');
select is((treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'id'), current_setting('test.cp1'), 'the grand prize is never selected as a starting point');
select ok(not (treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid) ? 'checkpoints'), 'progress does not send the full checkpoint list');
select is((treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->>'total_count'), '4', 'progress sends only the total checkpoint count');
select is((treasure_hunt_join_with_routes(current_setting('test.hunt')::uuid,4.8159,7.0501,8)->'current_target'->>'id'), current_setting('test.cp1'), 'rejoining keeps the original nearest starting checkpoint even when the phone has moved');
select pg_temp.admin();
select is((select count(*)::integer from treasure_hunt_participants where hunt_id=current_setting('test.hunt')::uuid and user_id='00000000-0000-0000-0000-0000000000e1'), 1, 'retrying join creates one participant');
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select is((treasure_hunt_claim_start(current_setting('test.hunt')::uuid,current_setting('test.cp1')::uuid,4.8156,7.0498,8,'10000000-0000-4000-8000-000000000001'::uuid)->>'coins_awarded'),'100','checking in at the starting checkpoint awards its configured coins');
select is((treasure_hunt_claim_start(current_setting('test.hunt')::uuid,current_setting('test.cp1')::uuid,4.8156,7.0498,8,'10000000-0000-4000-8000-000000000001'::uuid)->>'idempotent'),'true','repeating the start request does not award coins again');
select set_config('test.p1next',(treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'id'),true);
select pg_temp.admin();
select set_config('test.wrongcp',(select checkpoint_id::text from treasure_hunt_routes where participant_id=(select id from treasure_hunt_participants where user_id='00000000-0000-0000-0000-0000000000e1') and position=3),true);
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select is((treasure_hunt_claim_checkpoint(current_setting('test.hunt')::uuid,current_setting('test.wrongcp')::uuid,4.8156,7.0498,8,'10000000-0000-4000-8000-000000000002'::uuid)->>'ok'),'false','a checkpoint claimed out of the personal route order is refused');
select is((treasure_hunt_claim_checkpoint(current_setting('test.hunt')::uuid,(treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'id')::uuid,4.8156,7.0498,100,'10000000-0000-4000-8000-000000000003'::uuid)->>'ok'),'false','a location with poor accuracy is rejected');
select is((treasure_hunt_finish(current_setting('test.hunt')::uuid,4.8156,7.0498,8,'20000000-0000-4000-8000-000000000001'::uuid)->>'ok'),'false','the final prize stays locked until every checkpoint is reached');
select set_config('test.p1first',(treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'id'),true);
select is((treasure_hunt_claim_checkpoint(current_setting('test.hunt')::uuid,current_setting('test.p1first')::uuid,(treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'latitude')::double precision,(treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'longitude')::double precision,8,'10000000-0000-4000-8000-000000000004'::uuid)->>'coins_awarded'),'100','the next checkpoint in the assigned route can be collected');
select is((treasure_hunt_claim_checkpoint(current_setting('test.hunt')::uuid,current_setting('test.p1first')::uuid,4.8156,7.0498,8,'10000000-0000-4000-8000-000000000004'::uuid)->>'idempotent'),'true','repeating a checkpoint claim does not award its coins twice');
select is((treasure_hunt_claim_checkpoint(current_setting('test.hunt')::uuid,(treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'id')::uuid,(treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'latitude')::double precision,(treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'longitude')::double precision,8,'10000000-0000-4000-8000-000000000005'::uuid)->>'coins_awarded'),'100','the next personal stop is unlocked after a successful claim');
select is((treasure_hunt_claim_checkpoint(current_setting('test.hunt')::uuid,(treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'id')::uuid,(treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'latitude')::double precision,(treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'longitude')::double precision,8,'10000000-0000-4000-8000-000000000006'::uuid)->>'coins_awarded'),'100','the final checkpoint can be collected');
select is((treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->>'found_count'),'4','all four required checkpoints must be collected');
select is((treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'kind'),'finish','the final treasure appears only after every checkpoint');
select pg_temp.admin();
select set_config('test.expected_finish',(select r.id::text from treasure_hunt_route_points r join treasure_hunt_checkpoints c on c.id=(select checkpoint_id from treasure_hunt_routes where participant_id=(select id from treasure_hunt_participants where user_id='00000000-0000-0000-0000-0000000000e1') and position=4) where r.hunt_id=current_setting('test.hunt')::uuid and r.point_kind='finish' order by dating_private.treasure_hunt_distance_m(c.latitude,c.longitude,r.latitude,r.longitude),r.sequence,r.id limit 1),true);
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select is((treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'id'),current_setting('test.expected_finish'),'the assigned final treasure is nearest to the last checkpoint');
select is((treasure_hunt_finish(current_setting('test.hunt')::uuid,0,0,8,'20000000-0000-4000-8000-000000000002'::uuid)->>'ok'),'false','claiming the final treasure from far away is rejected');
select is((treasure_hunt_finish(current_setting('test.hunt')::uuid,(treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'latitude')::double precision,(treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'longitude')::double precision,8,'20000000-0000-4000-8000-000000000003'::uuid)->>'total_coins'),'525','the database awards checkpoint, prize and completion coins');
select is((treasure_hunt_finish(current_setting('test.hunt')::uuid,4.8160,7.0502,8,'20000000-0000-4000-8000-000000000004'::uuid)->>'idempotent'),'true','repeating the final claim cannot award coins again');

select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select is((treasure_hunt_join_with_routes(current_setting('test.hunt')::uuid,4.8156,7.0498,8)->'current_target'->>'id'),current_setting('test.cp1'),'a second player in the same area gets the same nearest start');
select is((treasure_hunt_claim_start(current_setting('test.hunt')::uuid,current_setting('test.cp1')::uuid,4.8156,7.0498,8,'10000000-0000-4000-8000-000000000011'::uuid)->>'ok'),'true','the second player can check in at that start');
select ok((treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'id') <> current_setting('test.p1next'),'players with the same starting checkpoint are sent to different next stops');
select pg_temp.admin();
select is((select count(*)::integer from treasure_hunt_routes r where r.participant_id=(select id from treasure_hunt_participants where user_id='00000000-0000-0000-0000-0000000000e2') and r.hunt_id=current_setting('test.hunt')::uuid),4,'the second player receives every checkpoint exactly once');

-- Route spreading must choose among complete nearest-neighbour routes. The
-- far checkpoint makes zig-zagging candidates fail the 30% distance rule.
insert into treasure_hunts (id, title, region, description, status, starts_at, ends_at, completion_bonus_coins)
values ('00000000-0000-4000-8000-0000000000e2', 'Route spreading preview', 'Rivers', 'Shared start route test', 'active', now() - interval '1 hour', now() + interval '1 day', 100);
insert into treasure_hunt_checkpoints (id, hunt_id, sequence, name, hint, latitude, longitude, radius_m, reward_coins) values
 ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000e2', 1, 'Gate', 'Start here.', 5.0000, 7.0000, 80, 100),
 ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000e2', 2, 'Mall', 'Nearby stop.', 5.0010, 7.0000, 80, 100),
 ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000e2', 3, 'Stadium', 'Nearby stop.', 5.0000, 7.0010, 80, 100),
 ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000e2', 4, 'Park', 'Nearby stop.', 4.9990, 7.0000, 80, 100),
 ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000e2', 5, 'Far lookout', 'Distant stop.', 5.0500, 7.0000, 80, 100);
insert into treasure_hunt_participants (hunt_id, user_id, legacy_route_order) values
 ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', false),
 ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-0000-0000-0000000000e2', false),
 ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-0000-0000-0000000000e3', false);
insert into treasure_hunt_routes (participant_id, hunt_id, position, checkpoint_id)
select p.id, p.hunt_id, 1, '10000000-0000-4000-8000-000000000001'
from treasure_hunt_participants p where p.hunt_id = '00000000-0000-4000-8000-0000000000e2';
do $$ declare p record; begin
  for p in select id from treasure_hunt_participants where hunt_id = '00000000-0000-4000-8000-0000000000e2' order by user_id loop
    perform dating_private.treasure_hunt_assign_remaining('00000000-0000-4000-8000-0000000000e2', p.id);
  end loop;
end $$;
select is((select count(distinct checkpoint_id)::integer from treasure_hunt_routes where hunt_id='00000000-0000-4000-8000-0000000000e2' and position=2),3,'three players sharing a start get three different next stops');
select is((select count(*)::integer from treasure_hunt_routes where hunt_id='00000000-0000-4000-8000-0000000000e2' and checkpoint_id='10000000-0000-4000-8000-000000000005' and position=5),3,'the distant checkpoint remains in every complete route without becoming the next stop');
select ok((select max(route_length) <= min(route_length) * 1.3 from (
  select dating_private.treasure_hunt_route_length('00000000-0000-4000-8000-0000000000e2', array_agg(checkpoint_id order by position)) as route_length
  from treasure_hunt_routes where hunt_id='00000000-0000-4000-8000-0000000000e2' group by participant_id
) routes),'spread routes stay within 30% of the shortest complete route');

select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select is((treasure_hunt_leaderboard(current_setting('test.hunt')::uuid,25)->>'visibility'),'self','an active hunt hides the named leaderboard');
select ok(not (treasure_hunt_leaderboard(current_setting('test.hunt')::uuid,25)::text like '%Lucky Heron 101%'),'the active leaderboard does not reveal another player');

-- A player already joined before this migration retains the old numbered route.
select pg_temp.admin();
insert into treasure_hunt_route_points(id,hunt_id,point_kind,sequence,name,latitude,longitude,radius_m,reward_coins) values
 ('00000000-0000-4000-8000-0000000000a1',current_setting('test.hunt')::uuid,'start',1,'Old start',4.8156,7.0498,80,0);
insert into treasure_hunt_participants(id,hunt_id,user_id,assigned_start_point_id,assigned_finish_point_id,legacy_route_order)
values ('00000000-0000-4000-8000-0000000000a3',current_setting('test.hunt')::uuid,'00000000-0000-0000-0000-0000000000e3',
  '00000000-0000-4000-8000-0000000000a1',(select id from treasure_hunt_route_points where hunt_id=current_setting('test.hunt')::uuid and point_kind='finish' and sequence=1),true);
insert into treasure_hunt_routes(participant_id,hunt_id,position,checkpoint_id)
select '00000000-0000-4000-8000-0000000000a3',current_setting('test.hunt')::uuid,sequence,id from treasure_hunt_checkpoints where hunt_id=current_setting('test.hunt')::uuid;
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select is((treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'name'),'Old start','an existing player keeps the original assigned start');
select is((treasure_hunt_claim_start(current_setting('test.hunt')::uuid,'00000000-0000-4000-8000-0000000000a1'::uuid,4.8156,7.0498,8,'10000000-0000-4000-8000-000000000021'::uuid)->>'ok'),'true','an existing player can still check in at that start');
select is((treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'kind'),'checkpoint','the old order continues after its start');
select is((treasure_hunt_claim_checkpoint(current_setting('test.hunt')::uuid,current_setting('test.cp1')::uuid,4.8156,7.0498,8,'10000000-0000-4000-8000-000000000022'::uuid)->>'ok'),'true','an old-order player can claim the original first checkpoint');
select is((treasure_hunt_progress_with_routes(current_setting('test.hunt')::uuid)->'current_target'->>'id'),current_setting('test.cp2'),'the old numbered order is preserved');
select pg_temp.admin();
update dating_profiles set dob_underage_at=now() where user_id='00000000-0000-0000-0000-0000000000e3';
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select throws_ok($$ select treasure_hunts_active() $$,'42501','Create an eligible treehouse profile first.','underage accounts cannot list hunts');

select * from finish();
rollback;
