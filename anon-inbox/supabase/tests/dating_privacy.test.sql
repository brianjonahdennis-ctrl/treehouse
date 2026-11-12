-- Privacy and safety tests for anonymous dating.
-- Runs inside a transaction that is rolled back, so the test users never persist.
--   supabase test db --remote supabase/tests

begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(34);

-- Test users ---------------------------------------------------------------
insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000ff', 'u@test.invalid', 'authenticated', 'authenticated', null,  now(), now());

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

-- Sign-up rules ------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000ff');
select throws_ok($$ select create_my_profile('Una', 'female', 25, 'Lagos', 'love') $$,
  '28000', 'Verify your email first.', 'Unverified accounts cannot create a profile');

select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select create_my_profile('Dee', 'male', 17, 'Abuja', 'fun') $$,
  '22023', null, 'Under-18s are blocked by the server');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select matches((select handle from create_my_profile('Ada Real-Name', 'female', 24, 'Lagos', 'love')),
  '^[A-Z][a-z]+ [A-Z][a-z]+ [0-9]{3}$', 'A gets an anonymous handle like "Quiet Falcon 214"');
select throws_ok($$ select create_my_profile('Ada Again', 'female', 24, 'Lagos', 'love') $$,
  '23505', null, 'One profile per account');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select lives_ok($$ select create_my_profile('Bayo Real-Name', 'male', 27, 'Port Harcourt', 'marriage') $$, 'B creates a profile');
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select lives_ok($$ select create_my_profile('Chi Real-Name', 'other', 30, 'Abuja', 'fun') $$, 'C creates a profile');

select pg_temp.admin();
select throws_ok($$ insert into dating_profiles (user_id, name, gender, age, location, intent, handle)
  values ('00000000-0000-0000-0000-00000000000d', 'Dee', 'male', 17, '', 'fun', 'Test Handle 999') $$,
  '23514', null, 'The table itself rejects ages under 18');

-- Names stay private -------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from dating_profiles), 1, 'B can read only their own profile row');
select is((select count(*)::int from dating_profiles where user_id = '00000000-0000-0000-0000-00000000000a'), 0,
  'B cannot read A''s profile (name) directly');
select throws_ok($$ update dating_profiles set handle = 'Chosen Name 111' $$, '42501', null,
  'Users cannot change their own handle');
select lives_ok($$ update dating_profiles set is_active = false $$, 'Users can pause their profile');
select lives_ok($$ update dating_profiles set is_active = true $$, 'Users can unpause their profile');

select pg_temp.anon();
select throws_ok($$ select name from dating_profiles $$, '42501', null, 'Visitors cannot read the profiles table');
select ok((select count(*) from discover_profiles()) >= 3, 'Visitors can browse dating cards');
select ok((select count(*) from (select handle from discover_profiles(2, 0) intersect select handle from discover_profiles(2, 2)) x) = 0, 'Pages of cards never repeat a profile');

select pg_temp.admin();
select is(pg_get_function_result('public.discover_profiles(int, int)'::regprocedure),
  'TABLE(handle text, gender dating_gender, age integer, location text, intent dating_intent)',
  'Dating cards contain only handle, gender, age, location and intent');
select is((select count(*)::int from information_schema.columns
           where table_schema = 'public' and column_name ilike '%email%'), 0,
  'No public table or view has an email column');

-- Chat and access ----------------------------------------------------------
-- B can't read A's handle from the table (cards show it), so look it up as admin and start the chat with it.
select pg_temp.admin();
select set_config('test.handle_a', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-00000000000a'), true);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
-- (requests-only) the other person liked 0b first, so starting the chat accepts it
select pg_temp.admin();
insert into dating_likes (from_user, to_user, liked) select user_id, '00000000-0000-0000-0000-00000000000b'::uuid, true from dating_profiles where handle = current_setting('test.handle_a') on conflict do nothing;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select set_config('test.conv_ab', start_conversation(current_setting('test.handle_a'))::text, true);
select isnt(current_setting('test.conv_ab'), '', 'B starts an anonymous chat with A by handle');
select lives_ok($$ insert into dating_messages (conversation_id, body) values (current_setting('test.conv_ab')::uuid, 'hi A') $$,
  'B can message A');
select throws_ok($$ insert into dating_messages (conversation_id, sender_id, body)
  values (current_setting('test.conv_ab')::uuid, '00000000-0000-0000-0000-00000000000a', 'spoofed') $$,
  '42501', null, 'B cannot send a message pretending to be A');

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from dating_messages where conversation_id = current_setting('test.conv_ab')::uuid), 0,
  'An outsider (C) cannot read A and B''s messages');
select throws_ok($$ insert into dating_messages (conversation_id, body) values (current_setting('test.conv_ab')::uuid, 'intrude') $$,
  '42501', null, 'An outsider (C) cannot post into A and B''s chat');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is((select other_handle from my_conversations() limit 1) ~ '^[A-Z][a-z]+ [A-Z][a-z]+ [0-9]{3}$', true,
  'A sees B only by anonymous handle in their inbox');

-- Mutual reveal ------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
insert into dating_reveals (conversation_id) values (current_setting('test.conv_ab')::uuid);
select is((select count(*)::int from revealed_details(current_setting('test.conv_ab')::uuid)), 0,
  'One-sided reveal does not expose a name');
delete from dating_reveals where conversation_id = current_setting('test.conv_ab')::uuid;
select is((select count(*)::int from dating_reveals where conversation_id = current_setting('test.conv_ab')::uuid), 0,
  'B can cancel their reveal before A agrees');
insert into dating_reveals (conversation_id) values (current_setting('test.conv_ab')::uuid);

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is((select they_revealed from my_conversations() limit 1), true, 'A sees "They want to reveal"');
insert into dating_reveals (conversation_id) values (current_setting('test.conv_ab')::uuid);
select is((select name from revealed_details(current_setting('test.conv_ab')::uuid)), 'Bayo Real-Name',
  'After both agree, A sees B''s name');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select name from revealed_details(current_setting('test.conv_ab')::uuid)), 'Ada Real-Name',
  'After both agree, B sees A''s name');
delete from dating_reveals where conversation_id = current_setting('test.conv_ab')::uuid;
select is((select count(*)::int from dating_reveals where conversation_id = current_setting('test.conv_ab')::uuid), 2,
  'A mutual reveal cannot be taken back');

-- Blocking -----------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select block_conversation_partner(current_setting('test.conv_ab')::uuid);
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ insert into dating_messages (conversation_id, body) values (current_setting('test.conv_ab')::uuid, 'still there?') $$,
  '42501', null, 'A blocked person cannot message');
select is((select count(*)::int from discover_profiles() where handle = current_setting('test.handle_a')), 0,
  'A blocked person no longer sees the blocker''s card');

-- Rate limit and reports ---------------------------------------------------
select pg_temp.admin();
select set_config('test.handle_b', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-00000000000b'), true);
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
-- (requests-only) the other person liked 0c first, so starting the chat accepts it
select pg_temp.admin();
insert into dating_likes (from_user, to_user, liked) select user_id, '00000000-0000-0000-0000-00000000000c'::uuid, true from dating_profiles where handle = current_setting('test.handle_b') on conflict do nothing;
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select set_config('test.conv_cb', start_conversation(current_setting('test.handle_b'))::text, true);
insert into dating_messages (conversation_id, body)
  select current_setting('test.conv_cb')::uuid, 'msg ' || g from generate_series(1, 20) g;
select throws_ok($$ insert into dating_messages (conversation_id, body) values (current_setting('test.conv_cb')::uuid, 'one too many') $$,
  'P0001', null, 'More than 20 messages a minute is blocked');
select lives_ok($$ select report_conversation_partner(current_setting('test.conv_cb')::uuid, 'spam', 'test report') $$,
  'C can report B');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from dating_reports), 0, 'B cannot see reports made about them');

select * from finish();
rollback;
