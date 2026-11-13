-- Speed Dating: compatible people are paired once, incompatible or blocked people never are, the
-- clock starts only when both connect, decisions are private, two Likes make exactly one match
-- (not a friendship), and outsiders can't see a date.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(24);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'sd1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c2', 'sd2@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c3', 'sd3@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c4', 'sd4@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

select pg_temp.login('00000000-0000-0000-0000-0000000000c1'); select create_my_profile('Ada Speed', 'female', 26, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000c2'); select create_my_profile('Bola Speed', 'male', 28, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000c3'); select create_my_profile('Chi Speed', 'male', 30, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000c4'); select create_my_profile('Dayo Speed', 'female', 24, 'Lagos', 'love');
select pg_temp.admin();
-- Ada wants men 25-35; Bola and Chi want women 20-30; Dayo wants women only (so not Bola/Chi).
update dating_profiles set interested_in = '{male}', min_age = 25, max_age = 35, pref_state = null where user_id = '00000000-0000-0000-0000-0000000000c1';
update dating_profiles set interested_in = '{female}', min_age = 20, max_age = 30, pref_state = null where user_id in ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c3');
update dating_profiles set interested_in = '{female}', min_age = 18, max_age = 40, pref_state = null where user_id = '00000000-0000-0000-0000-0000000000c4';
-- Keep the live queue out of the test: only our four people.
create temp table saved_queue as select * from speed_queue;
delete from speed_queue;

-- Dayo waits first; Bola isn't her type (she wants women), so Bola must not be paired with her.
select pg_temp.login('00000000-0000-0000-0000-0000000000c4');
select is(speed_join() ->> 'status', 'waiting', 'Dayo waits in the queue');
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select is(speed_join() ->> 'status', 'waiting', 'Bola is not paired with someone who does not want men');

-- Ada joins: she and Bola fit each other both ways.
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select set_config('test.s', (speed_join() ->> 'id'), true);
select isnt(current_setting('test.s'), '', 'Ada is paired');
select pg_temp.admin();
select is((select count(*)::int from speed_sessions where id = current_setting('test.s')::uuid
           and '00000000-0000-0000-0000-0000000000c1' in (user_a, user_b) and '00000000-0000-0000-0000-0000000000c2' in (user_a, user_b)), 1, 'Ada is paired with Bola');
select is((select count(*)::int from speed_queue where user_id in ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2')), 0, 'Both leave the queue');
select is((select count(*)::int from speed_active where session_id = current_setting('test.s')::uuid), 2, 'Exactly two people on the date');

-- Chi can't see their date.
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select is(speed_session(current_setting('test.s')::uuid), null, 'Someone else cannot see the date');
select throws_ok(format('select speed_signal(%L::uuid, %L::jsonb)', current_setting('test.s'), '{"x":1}'), 'P0002', null, 'Someone else cannot send call signals');

-- The clock starts only when both are connected.
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(speed_ready(current_setting('test.s')::uuid) ->> 'status', 'connecting', 'One side connected: not started');
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select is(speed_ready(current_setting('test.s')::uuid) ->> 'status', 'live', 'Both connected: the three minutes start');
select pg_temp.admin();
select is((select ends_at - started_at from speed_sessions where id = current_setting('test.s')::uuid), interval '3 minutes', 'Exactly three minutes');

-- Bola can't join another queue or date meanwhile.
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select is(speed_join() ->> 'id', current_setting('test.s'), 'Joining again returns the same date (no second date)');

-- Time's up (simulated): decisions.
select pg_temp.admin();
update speed_sessions set ends_at = now() - interval '1 second', started_at = now() - interval '301 seconds' where id = current_setting('test.s')::uuid;
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(speed_decide(current_setting('test.s')::uuid, true) ->> 'result', null, 'Ada likes: nothing revealed while Bola decides');
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select is(speed_session(current_setting('test.s')::uuid) ->> 'my_decision', null, 'Bola does not see Ada''s choice');
select is(speed_decide(current_setting('test.s')::uuid, true) ->> 'result', 'match', 'Two likes: a match');
select pg_temp.admin();
select is((select count(*)::int from dating_conversations where user_a = least('00000000-0000-0000-0000-0000000000c1'::uuid, '00000000-0000-0000-0000-0000000000c2'::uuid)
           and user_b = greatest('00000000-0000-0000-0000-0000000000c1'::uuid, '00000000-0000-0000-0000-0000000000c2'::uuid) and kind = 'dating' and accepted_at is not null), 1, 'Exactly one dating chat (not a friendship)');
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select speed_decide(current_setting('test.s')::uuid, false);
select pg_temp.admin();
select is((select b_like from speed_sessions where id = current_setting('test.s')::uuid), true, 'A decision cannot be changed');

-- After a match, both take a 12-hour break from Speed Dating, pointed at their new chat.
select pg_temp.admin();
select set_config('test.conv', (select conversation_id::text from speed_sessions where id = current_setting('test.s')::uuid), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(speed_join() -> 'quota' ->> 'reason', 'match', 'After a match: a break from Speed Dating');
select ok(((speed_quota() ->> 'available_at')::timestamptz) between now() + interval '11 hours 59 minutes' and now() + interval '12 hours 1 minute', 'The break lasts 12 hours');
select is((speed_quota() ->> 'match_conversation'), current_setting('test.conv'), 'The break points to the new match''s chat');
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select is(speed_join() ->> 'status', 'limit', 'The other person takes the break too');
select pg_temp.admin();
update speed_sessions set matched_at = now() - interval '13 hours' where id = current_setting('test.s')::uuid;

-- Blocked people are never paired: Chi blocks Ada, then both wait.
insert into dating_blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000c1');
delete from speed_active;
select pg_temp.login('00000000-0000-0000-0000-0000000000c3'); select speed_join();
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(speed_join() ->> 'status', 'waiting', 'Blocked people are never paired');

-- Daily limit: 5 dates that started in the last 24 hours → cool down, with the time it reopens.
select pg_temp.admin();
delete from speed_active; delete from speed_queue;
insert into speed_sessions (user_a, user_b, created_at, started_at, ends_at, ended_at, end_reason)
  select '00000000-0000-0000-0000-0000000000c4', '00000000-0000-0000-0000-0000000000c3', now() - make_interval(hours => g), now() - make_interval(hours => g), now() - make_interval(hours => g) + interval '5 minutes', now() - make_interval(hours => g) + interval '5 minutes', 'time'
  from generate_series(1, 5) g;
select pg_temp.login('00000000-0000-0000-0000-0000000000c4');
select is(speed_join() ->> 'status', 'limit', 'After 5 dates in 24 hours: cooling down');
select ok(((speed_quota() ->> 'available_at')::timestamptz) between now() + interval '18 hours 59 minutes' and now() + interval '19 hours 1 minute', 'Next date opens when the oldest counted date turns 24 hours old');

select pg_temp.admin();
delete from speed_queue; insert into speed_queue select * from saved_queue;
select * from finish();
rollback;
