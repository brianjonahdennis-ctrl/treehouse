-- Sending no longer queues on shared stats rows: messages still send, are counted exactly once in
-- the owner's stats, mark the sender as chatting, and the push wake-up / nudges never block.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'nw1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', 'nw2@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select create_my_profile('Nwa One', 'female', 26, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select create_my_profile('Nwa Two', 'male', 28, 'Lagos', 'love');
select pg_temp.admin();
select set_config('test.h1', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000d1'), true);
select set_config('test.h2', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000d2'), true);
select set_config('test.before', (select coalesce(sum(messages), 0)::text from dating_private.stat_messages_by_day), true);

select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select like_profile(current_setting('test.h1'), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select set_config('test.conv', (select conversation_id::text from like_profile(current_setting('test.h2'), true)), true);

select lives_ok(format($$ insert into dating_messages (conversation_id, body) values (%L, 'one'), (%L, 'two'), (%L, 'three') $$,
  current_setting('test.conv'), current_setting('test.conv'), current_setting('test.conv')), 'Messages send');
select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select lives_ok(format($$ insert into dating_messages (conversation_id, body) values (%L, 'hey back') $$, current_setting('test.conv')), 'Replies send');

select pg_temp.admin();
select is(((select coalesce(sum(messages), 0) from dating_private.stat_messages_by_day) - current_setting('test.before')::numeric)::int, 4,
  'Each message is counted exactly once in the owner''s stats');
select is((select count(*)::int from dating_private.stat_day_senders where sender_id in
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2')), 2, 'Both people count as chatting today, once each');
select is((select count(*)::int from dating_private.stat_senders where sender_id in
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2')), 2, 'Both people count as having chatted');
select lives_ok($$ select dating_private.nudge_message('00000000-0000-0000-0000-0000000000d1', gen_random_uuid(), 'hi', now()) $$, 'New-message nudges never fail');
select lives_ok($$ insert into dating_private.push_outbox (user_id, kind, url) values ('00000000-0000-0000-0000-0000000000d1', 'chat', '/home/matches') $$,
  'The push wake-up never blocks');

select * from finish();
rollback;
