-- Treasure Hunt: member eligibility, location checks, one-time rewards and private leaderboard data.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(17);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'hunt1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000e2', 'hunt2@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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
select pg_temp.admin();

insert into treasure_hunts (id, title, region, description, status, starts_at, ends_at, completion_bonus_coins)
values ('00000000-0000-4000-8000-0000000000e1', 'Port Harcourt preview', 'Rivers', 'Test route', 'active', now() - interval '1 hour', now() + interval '1 day', 100);
insert into treasure_hunt_checkpoints (id, hunt_id, sequence, name, hint, latitude, longitude, radius_m, reward_coins) values
 ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1', 1, 'First stop', 'Look around.', 4.8156, 7.0498, 60, 100),
 ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000e1', 2, 'Second stop', 'Keep going.', 4.8157, 7.0499, 60, 100);
select set_config('test.hunt', '00000000-0000-4000-8000-0000000000e1', true);
select set_config('test.cp1', '00000000-0000-4000-8000-0000000000f1', true);
select set_config('test.cp2', '00000000-0000-4000-8000-0000000000f2', true);

select ok(not has_table_privilege('authenticated', 'public.treasure_hunt_claims', 'select'), 'members cannot read reward rows directly');
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select is((treasure_hunts_active() -> 0 ->> 'title'), 'Port Harcourt preview', 'an eligible member sees an open hunt');
select is((treasure_hunt_join(current_setting('test.hunt')::uuid) -> 'participant' ->> 'total_coins'), '0', 'joining returns zero starting coins');
select treasure_hunt_join(current_setting('test.hunt')::uuid);
select pg_temp.admin();
select is((select count(*)::int from treasure_hunt_participants where hunt_id = current_setting('test.hunt')::uuid and user_id = '00000000-0000-0000-0000-0000000000e1'), 1, 'joining twice creates one participant');
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');

select is(treasure_hunt_claim_checkpoint(current_setting('test.hunt')::uuid, current_setting('test.cp2')::uuid, 4.8157, 7.0499, 10,
  '10000000-0000-4000-8000-000000000001'::uuid) ->> 'ok', 'false', 'a later checkpoint cannot be claimed out of order');
select is(treasure_hunt_claim_checkpoint(current_setting('test.hunt')::uuid, current_setting('test.cp1')::uuid, 4.8156, 7.0498, 10,
  '10000000-0000-4000-8000-000000000001'::uuid) ->> 'coins_awarded', '100', 'a nearby checkpoint awards its configured coins');
select is(treasure_hunt_claim_checkpoint(current_setting('test.hunt')::uuid, current_setting('test.cp1')::uuid, 4.8156, 7.0498, 10,
  '10000000-0000-4000-8000-000000000001'::uuid) ->> 'idempotent', 'true', 'repeating the same request returns the old award');
select is(treasure_hunt_claim_checkpoint(current_setting('test.hunt')::uuid, current_setting('test.cp1')::uuid, 4.8156, 7.0498, 10,
  '10000000-0000-4000-8000-000000000002'::uuid) ->> 'idempotent', 'true', 'a second request cannot award the same checkpoint again');
select is(treasure_hunt_claim_checkpoint(current_setting('test.hunt')::uuid, current_setting('test.cp2')::uuid, 4.9, 7.2, 10,
  '10000000-0000-4000-8000-000000000003'::uuid) ->> 'ok', 'false', 'location outside the checkpoint radius is rejected');
select is(treasure_hunt_claim_checkpoint(current_setting('test.hunt')::uuid, current_setting('test.cp2')::uuid, 4.8157, 7.0499, 200,
  '10000000-0000-4000-8000-000000000004'::uuid) ->> 'ok', 'false', 'inaccurate location is rejected');
select is(treasure_hunt_finish(current_setting('test.hunt')::uuid, '20000000-0000-4000-8000-000000000001'::uuid) ->> 'ok', 'false', 'final treasure stays locked until every stop is reached');
select is(treasure_hunt_claim_checkpoint(current_setting('test.hunt')::uuid, current_setting('test.cp2')::uuid, 4.8157, 7.0499, 10,
  '10000000-0000-4000-8000-000000000005'::uuid) ->> 'coins_awarded', '100', 'the next nearby checkpoint can be claimed');
select is(treasure_hunt_finish(current_setting('test.hunt')::uuid, '20000000-0000-4000-8000-000000000001'::uuid) ->> 'total_coins', '300', 'completion bonus is included in the total');
select is(treasure_hunt_finish(current_setting('test.hunt')::uuid, '20000000-0000-4000-8000-000000000002'::uuid) ->> 'total_coins', '300', 'claiming the final treasure again cannot add coins');

select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select treasure_hunt_join(current_setting('test.hunt')::uuid);
select is((treasure_hunt_leaderboard(current_setting('test.hunt')::uuid, 1) ->> 'has_more'), 'true', 'leaderboard returns a next-page flag');
select ok(not (treasure_hunt_leaderboard(current_setting('test.hunt')::uuid, 1)::text like '%00000000-0000-0000-0000-0000000000e1%'), 'leaderboard never returns an auth user id');
select pg_temp.admin();
update dating_profiles set dob_underage_at = now() where user_id = '00000000-0000-0000-0000-0000000000e2';
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select throws_ok($$ select treasure_hunts_active() $$, '42501', 'Create an eligible treehouse profile first.', 'underage accounts cannot list or join hunts');

select * from finish();
rollback;
