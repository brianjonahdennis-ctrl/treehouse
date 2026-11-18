-- Android app push: the app saves a Firebase token as an 'fcm:' device, and notifications reach it.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

insert into dating_private.admin_key values (encode(extensions.digest('test-admin-key', 'sha256'), 'hex'));
insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a7', 'a7@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b7', 'b7@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

select pg_temp.login('00000000-0000-0000-0000-0000000000a7');
select create_my_profile('Ada App', 'female', (current_date - interval '24 years 1 month')::date, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000b7');
select create_my_profile('Bolu App', 'male', (current_date - interval '26 years 1 month')::date, 'Lagos', 'love');
select pg_temp.admin();
update dating_profiles set interested_in = '{male}' where user_id = '00000000-0000-0000-0000-0000000000a7';
update dating_profiles set interested_in = '{female}' where user_id = '00000000-0000-0000-0000-0000000000b7';
select set_config('test.ha', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000a7'), true);

select pg_temp.anon();
select throws_ok($$ select save_native_push('testtoken_abcdefghijklmnopqrstuvwxyz') $$, '42501', null, 'Signed-out visitors can''t save an app device');

select pg_temp.login('00000000-0000-0000-0000-0000000000b7');
select throws_ok($$ select save_native_push('bad token!') $$, '22023', null, 'Junk device codes are refused');
select lives_ok($$ select save_native_push('testtoken_bolu:APA91b-abcdefghijklmnopqrstuvwxyz') $$, 'The app can save its device');
select lives_ok($$ select save_native_push('testtoken_bolu:APA91b-abcdefghijklmnopqrstuvwxyz') $$, 'Saving the same device again is fine');
select is((select count(*)::int from push_subscriptions where endpoint like 'fcm:testtoken_bolu%'), 1, 'It is saved once, as an fcm: device');

select throws_ok($$ insert into push_subscriptions (endpoint, user_id) values ('https://push.example.test/nokeys', '00000000-0000-0000-0000-0000000000b7') $$,
  null, null, 'Web devices still need their keys');

-- A notification queued for Bolu (as the like/message triggers do) reaches his app device.
select pg_temp.admin();
select dating_private.queue_push('00000000-0000-0000-0000-0000000000b7', 'like', '/home/matches/likes');
select pg_temp.anon();
select is((select count(*)::int from admin_take_push('test-admin-key', 500) where endpoint like 'fcm:testtoken_bolu%' and kind = 'like'), 1,
  'Notifications reach app devices');

select pg_temp.login('00000000-0000-0000-0000-0000000000b7');
select delete_push_subscription('fcm:testtoken_bolu:APA91b-abcdefghijklmnopqrstuvwxyz');
select is((select count(*)::int from push_subscriptions), 0, 'Turning off in the app removes the device');
select pg_temp.login('00000000-0000-0000-0000-0000000000a7');
select is((select count(*)::int from push_subscriptions), 0, 'Nobody sees someone else''s app devices');

select * from finish();
rollback;
