-- Suspensions, unblocking and the owner's moderation API.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'f1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000f2', 'f2@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

create function pg_temp.login(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end $$;
create function pg_temp.admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- A throwaway admin key just for this test (rolled back at the end).
insert into dating_private.admin_key values (encode(extensions.digest('test-admin-key', 'sha256'), 'hex'));

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select create_my_profile('Fola Private', 'female', 25, 'Ibadan', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select create_my_profile('Gbenga Private', 'male', 30, 'Lagos', 'love');
select pg_temp.admin();
select set_config('test.hf', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000f1'), true);
select set_config('test.hg', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000f2'), true);

-- G messages F, then F blocks G
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
-- (requests-only) the other person liked f2 first, so starting the chat accepts it
select pg_temp.admin();
insert into dating_likes (from_user, to_user, liked) select user_id, '00000000-0000-0000-0000-0000000000f2'::uuid, true from dating_profiles where handle = current_setting('test.hf') on conflict do nothing;
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select set_config('test.conv', start_conversation(current_setting('test.hf'))::text, true);
insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'rude message');
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select block_conversation_partner(current_setting('test.conv')::uuid);
select is((select i_blocked from my_conversations()), true, 'The blocker sees they blocked (so they can unblock)');
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select is((select i_blocked from my_conversations()), false, 'The blocked person is not told they blocked');
select is((select blocked from my_conversations()), true, 'The blocked person''s chat shows as closed');
select lives_ok($$ select unblock_conversation_partner(current_setting('test.conv')::uuid) $$, 'Unblocking only works for the blocker…');
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select is((select i_blocked from my_conversations()), true, '…so the blocked person cannot lift the block');
select unblock_conversation_partner(current_setting('test.conv')::uuid);
select is((select blocked from my_conversations()), false, 'The blocker can unblock');

-- F reports G
select report_conversation_partner(current_setting('test.conv')::uuid, 'harassment', 'kept being rude');

-- Users can't suspend or unsuspend themselves
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$ update dating_profiles set suspended = false $$, '42501', null, 'Users cannot change their own suspension');

-- Moderation API
select pg_temp.anon();
select throws_ok($$ select * from admin_dating_reports('wrong-key') $$, '42501', null, 'The reports list needs the admin key');
select is((select count(*)::int from admin_dating_reports('test-admin-key') where reported_handle = current_setting('test.hg')), 1,
  'With the admin key, the owner sees the report');
select is((select reporter_handle from admin_dating_reports('test-admin-key') where reported_handle = current_setting('test.hg')),
  current_setting('test.hf'), 'Reports show anonymous handles…');
select ok((select recent_messages::text from admin_dating_reports('test-admin-key') where reported_handle = current_setting('test.hg'))
  !~ 'Private', '…and never real names, even in the chat excerpt');
select ok((select recent_messages::text from admin_dating_reports('test-admin-key') where reported_handle = current_setting('test.hg'))
  ~ 'rude message', 'The report includes the chat for context');

select set_config('test.report', (select id::text from admin_dating_reports('test-admin-key') where reported_handle = current_setting('test.hg')), true);
select admin_suspend_reported('test-admin-key', current_setting('test.report')::bigint, true);
select is((select count(*)::int from discover_profiles() where handle = current_setting('test.hg')), 0,
  'A suspended profile disappears from dating cards');

select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select throws_ok($$ insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'still here') $$,
  '42501', null, 'A suspended person cannot send messages');
select is((select count(*)::int from discover_profiles() where handle = current_setting('test.hf')), 1,
  'Suspension does not affect the other person');

select pg_temp.anon();
select is((select status from admin_dating_reports('test-admin-key', 'all') where reported_handle = current_setting('test.hg')),
  'actioned', 'Suspending marks the report as actioned');

select * from finish();
rollback;
