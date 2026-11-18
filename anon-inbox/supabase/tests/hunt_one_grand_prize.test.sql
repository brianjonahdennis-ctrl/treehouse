-- One grand prize location per hunt, the same for every player (migration 20261118170000).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

create function pg_temp.login(uid text, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
end $$;
create function pg_temp.admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000009a1', 'gp1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000009a2', 'gp2@test.invalid', 'authenticated', 'authenticated', now(), now(), now());
select pg_temp.login('00000000-0000-0000-0000-0000000009a1');
select create_my_profile('GP One', 'female', (current_date - interval '25 years')::date, '', 'fun');
select pg_temp.login('00000000-0000-0000-0000-0000000009a2');
select create_my_profile('GP Two', 'male', (current_date - interval '26 years')::date, '', 'fun');
select pg_temp.admin();

-- Two checkpoints far apart and one grand prize near the first: player A starts at checkpoint 1
-- (ends at 2), player B starts at 2 (ends at 1). Both must be sent to the same grand prize.
insert into treasure_hunts (id, title, region, description, status, starts_at, ends_at, completion_bonus_coins)
values ('00000000-0000-4000-8000-0000000009b1', 'One prize test', 'Test', 'Test', 'active', now() - interval '1 hour', now() + interval '1 day', 100);
insert into treasure_hunt_checkpoints (id, hunt_id, sequence, name, hint, latitude, longitude, radius_m, reward_coins) values
 ('00000000-0000-4000-8000-0000000009c1', '00000000-0000-4000-8000-0000000009b1', 1, 'West', '', 6.50, 3.30, 80, 10),
 ('00000000-0000-4000-8000-0000000009c2', '00000000-0000-4000-8000-0000000009b1', 2, 'East', '', 6.50, 3.40, 80, 10);
insert into treasure_hunt_route_points (id, hunt_id, point_kind, sequence, name, latitude, longitude, radius_m, reward_coins) values
 ('00000000-0000-4000-8000-0000000009d1', '00000000-0000-4000-8000-0000000009b1', 'finish', 1, 'The grand prize', 6.50, 3.31, 80, 0);

select throws_ok($$ insert into treasure_hunt_route_points (hunt_id, point_kind, sequence, name, latitude, longitude) values ('00000000-0000-4000-8000-0000000009b1', 'finish', 2, 'Second prize spot', 6.5, 3.39) $$,
  '23505', null, 'a hunt cannot have a second grand prize location');

select pg_temp.login('00000000-0000-0000-0000-0000000009a1');
select treasure_hunt_join_with_routes('00000000-0000-4000-8000-0000000009b1', 6.50, 3.30, 8);
select treasure_hunt_claim_start('00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-0000000009c1', 6.50, 3.30, 8, '40000000-0000-4000-8000-000000000001');
select is((treasure_hunt_progress_with_routes('00000000-0000-4000-8000-0000000009b1')->'current_target'->>'kind'), 'checkpoint', 'the grand prize stays hidden until every checkpoint is found');
select treasure_hunt_claim_checkpoint('00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-0000000009c2', 6.50, 3.40, 8, '40000000-0000-4000-8000-000000000002');
select is((treasure_hunt_progress_with_routes('00000000-0000-4000-8000-0000000009b1')->'current_target'->>'id'), '00000000-0000-4000-8000-0000000009d1', 'player A (last stop East) is sent to the grand prize');

select pg_temp.login('00000000-0000-0000-0000-0000000009a2');
select treasure_hunt_join_with_routes('00000000-0000-4000-8000-0000000009b1', 6.50, 3.40, 8);
select treasure_hunt_claim_start('00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-0000000009c2', 6.50, 3.40, 8, '40000000-0000-4000-8000-000000000003');
select treasure_hunt_claim_checkpoint('00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-0000000009c1', 6.50, 3.30, 8, '40000000-0000-4000-8000-000000000004');
select is((treasure_hunt_progress_with_routes('00000000-0000-4000-8000-0000000009b1')->'current_target'->>'id'), '00000000-0000-4000-8000-0000000009d1', 'player B (last stop West) is sent to the same grand prize');

select pg_temp.admin();
select is((select count(distinct assigned_finish_point_id)::int from treasure_hunt_participants where hunt_id = '00000000-0000-4000-8000-0000000009b1'), 1, 'everyone has the same grand prize location');
select pg_temp.login('7cbd08d2-d6b1-4ccc-bb0d-738c1bb6d299');
select throws_ok($$ select staff_treasure_hunt_save_routes_personal(jsonb_build_object('title','Two prizes','region','Ikeja, Lagos','state','Lagos','status','draft','starts_at',now() + interval '1 day','ends_at',now() + interval '2 day'),
  '[{"sequence":1,"name":"Stop","latitude":6.6,"longitude":3.35}]', '[]', '[{"sequence":1,"name":"A","latitude":6.6,"longitude":3.35},{"sequence":2,"name":"B","latitude":6.61,"longitude":3.36}]') $$,
  '22023', 'Add exactly one grand prize location. Every player finishes there.', 'setup refuses more than one grand prize location');

select * from finish();
rollback;
