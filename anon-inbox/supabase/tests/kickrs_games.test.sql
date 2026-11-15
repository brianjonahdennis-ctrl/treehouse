-- Kickrs games: members with a dating profile (18+) can connect, suspended ones can't; the Kickrs id is stable and private;
-- friend requests from a game follow the normal rules; disconnect stops passes and requests.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(19);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'kg1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000e2', 'kg2@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000e3', 'kg3@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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
create function pg_temp.dob(years int) returns date language sql as $$
  select (((now() at time zone 'Africa/Lagos')::date - make_interval(years => years))::date - 10)
$$;

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select is(kickrs_status() ->> 'blocker', 'profile', 'Without a dating profile the member is asked to make one');
-- Older accounts were created with a typed age and no date of birth (sign-up now requires one); these
-- tests cover adding the date of birth afterwards, so they make such accounts directly.
create function pg_temp.old_profile(p_name text, p_gender text, p_age int, p_loc text, p_intent text) returns void language plpgsql as $$
declare c text := current_setting('request.jwt.claims', true); r text := current_setting('role');
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into dating_profiles (user_id, name, gender, age, location, intent, handle)
  values ((c::json ->> 'sub')::uuid, p_name, p_gender::dating_gender, p_age, p_loc, p_intent::dating_intent, dating_private.dating_new_handle());
  perform set_config('request.jwt.claims', c, true);
  perform set_config('role', r, true);
end $$;
select pg_temp.old_profile('Ada Kick', 'female', 27, 'Lagos', 'love');
select is(kickrs_status(), '{"ready": true, "blocker": null, "connected": false}'::jsonb, 'With a profile the member can play but has not allowed Kickrs yet');
select throws_ok('select * from kickrs_identity()', 'P0001', 'Allow Kickrs first.', 'No pass before the member taps Allow');

select is((select handle from kickrs_connect()), (select handle from dating_profiles where user_id = auth.uid()), 'Connecting returns the member''s own nickname');
select set_config('test.k1', (select kickrs_id::text from kickrs_identity()), true);
select isnt(current_setting('test.k1'), '00000000-0000-0000-0000-0000000000e1', 'The Kickrs id is not the treehouse user id');
select is((select kickrs_id::text from kickrs_connect()), current_setting('test.k1'), 'Connecting again keeps the same Kickrs id');
select is(kickrs_status() ->> 'connected', 'true', 'Status shows the member is connected');

select throws_ok('select * from dating_private.kickrs_links', '42501', null, 'Members cannot read the link table directly');

select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select pg_temp.old_profile('Bola Kick', 'male', 29, 'Abuja', 'love');
update dating_profiles set birth_date = pg_temp.dob(29) where user_id = auth.uid();
select set_config('test.k2', (select kickrs_id::text from kickrs_connect()), true);

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select set_config('test.conv', kickrs_friend_request(current_setting('test.k2')::uuid)::text, true);
select is((select kind from my_conversations() where conversation_id = current_setting('test.conv')::uuid), 'friend', 'Add friend from a game sends a normal friend request');
select is((select status from my_conversations() where conversation_id = current_setting('test.conv')::uuid), 'sent', 'It waits for the other person to accept');
select throws_ok(format('select kickrs_friend_request(%L::uuid)', current_setting('test.k1')), 'P0002', 'That person is not available.', 'Nobody can friend-request themselves');
select throws_ok('select kickrs_friend_request(gen_random_uuid())', 'P0002', 'That person is not available.', 'An unknown Kickrs id says nothing about who exists');

select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select kickrs_disconnect();
select throws_ok('select * from kickrs_identity()', 'P0001', 'Allow Kickrs first.', 'After disconnecting there are no more passes');
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select throws_ok(format('select kickrs_friend_request(%L::uuid)', current_setting('test.k2')), 'P0002', 'That person is not available.', 'Disconnected members cannot be friend-requested from a game');
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select is((select kickrs_id::text from kickrs_connect()), current_setting('test.k2'), 'Reconnecting gives back the same Kickrs id');

select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select pg_temp.old_profile('Chi Kick', 'male', 31, 'Lagos', 'love');
select pg_temp.admin();
update dating_profiles set suspended = true where user_id = '00000000-0000-0000-0000-0000000000e3';
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select throws_ok('select * from kickrs_connect()', '42501', 'Your profile is suspended.', 'Suspended members cannot connect');
select pg_temp.admin();
update dating_profiles set suspended = false where user_id = '00000000-0000-0000-0000-0000000000e3';
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
update dating_profiles set birth_date = pg_temp.dob(16) where user_id = auth.uid();
select is(kickrs_status() ->> 'blocker', 'suspended', 'A date of birth under 18 blocks games too');

set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok('select * from kickrs_identity()', '42501', null, 'Signed-out visitors cannot ask for an identity');

select pg_temp.admin();
delete from auth.users where id = '00000000-0000-0000-0000-0000000000e1';
select is((select count(*)::int from dating_private.kickrs_links where kickrs_id = current_setting('test.k1')::uuid), 0, 'Deleting the treehouse account deletes the Kickrs link');

select * from finish();
rollback;
