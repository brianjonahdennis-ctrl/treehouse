-- Only the sender can cancel a request, only before it's accepted; it then disappears for both.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'cr1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', 'cr2@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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
select create_my_profile('Ada Cancel', 'female', 26, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select create_my_profile('Bola Cancel', 'male', 28, 'Lagos', 'love');
select pg_temp.admin();
select set_config('test.hb', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000d2'), true);

-- Ada sends Bola a friend request.
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select set_config('test.conv', start_friend_request(current_setting('test.hb'))::text, true);

select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select throws_ok(format('select cancel_request(%L::uuid)', current_setting('test.conv')), 'P0002', null, 'The person who received it cannot cancel it');

select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select lives_ok(format('select cancel_request(%L::uuid)', current_setting('test.conv')), 'The sender cancels it');
select pg_temp.admin();
select is((select count(*)::int from dating_conversations where id = current_setting('test.conv')::uuid), 0, 'The request is gone for both');

-- Once accepted, it's a chat: no cancelling.
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select set_config('test.conv2', start_friend_request(current_setting('test.hb'))::text, true);
select isnt(current_setting('test.conv2'), current_setting('test.conv'), 'A new request can be sent after cancelling');
select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select accept_message_request(current_setting('test.conv2')::uuid);
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select throws_ok(format('select cancel_request(%L::uuid)', current_setting('test.conv2')), 'P0001', null, 'An accepted request cannot be cancelled');

-- Daily limit on cancelling.
select pg_temp.admin();
insert into dating_private.request_cancels (user_id) select '00000000-0000-0000-0000-0000000000d1' from generate_series(1, 20);
update dating_conversations set accepted_at = null where id = current_setting('test.conv2')::uuid;
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select throws_ok(format('select cancel_request(%L::uuid)', current_setting('test.conv2')), 'P0001', null, 'At most 20 cancels a day');

select * from finish();
rollback;
