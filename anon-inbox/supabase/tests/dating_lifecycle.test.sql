-- Pause, delete profile and delete account.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(10);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'e1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000e2', 'e2@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select create_my_profile('Eve One', 'female', 29, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select create_my_profile('Ed Two', 'male', 31, 'Abuja', 'marriage');
select pg_temp.admin();
select set_config('test.h1', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000e1'), true);

-- Pause hides the card, resume brings it back
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
update dating_profiles set is_active = false;
select pg_temp.anon();
select is((select count(*)::int from discover_profiles() where handle = current_setting('test.h1')), 0,
  'A paused profile is hidden from dating cards');
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select throws_ok($$ select start_conversation(current_setting('test.h1')) $$, 'P0002', null,
  'Nobody can start a new chat with a paused profile');
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
update dating_profiles set is_active = true;
select pg_temp.anon();
select is((select count(*)::int from discover_profiles() where handle = current_setting('test.h1')), 1,
  'Resuming shows the card again');

-- Chat, then delete the dating profile only
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
-- (requests-only) the other person liked e2 first, so starting the chat accepts it
select pg_temp.admin();
insert into dating_likes (from_user, to_user, liked) select user_id, '00000000-0000-0000-0000-0000000000e2'::uuid, true from dating_profiles where handle = current_setting('test.h1') on conflict do nothing;
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select set_config('test.conv', start_conversation(current_setting('test.h1'))::text, true);
insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'hello');
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
delete from dating_profiles;
select is((select count(*)::int from dating_profiles), 0, 'People can delete their own dating profile');
select pg_temp.anon();
select is((select count(*)::int from discover_profiles() where handle = current_setting('test.h1')), 0,
  'A deleted profile disappears from dating cards');

-- Others can't delete someone else's account
select pg_temp.anon();
select throws_ok($$ select delete_my_account() $$, '42501', null, 'Visitors cannot call delete_my_account');

-- Delete the whole account
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select lives_ok($$ select delete_my_account() $$, 'People can delete their whole account');
select pg_temp.admin();
select is((select count(*)::int from auth.users where id = '00000000-0000-0000-0000-0000000000e2'), 0,
  'Deleting the account removes the sign-in and email');
select is((select count(*)::int from dating_conversations where id = current_setting('test.conv')::uuid), 0,
  'Deleting the account removes their chats');
select is((select count(*)::int from auth.users where id = '00000000-0000-0000-0000-0000000000e1'), 1,
  'The other person''s account is untouched');

select * from finish();
rollback;
