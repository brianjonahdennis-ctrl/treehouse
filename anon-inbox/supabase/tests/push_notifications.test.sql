-- Push notifications: devices are private, events queue private notifications, the server takes them with its key.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

insert into dating_private.admin_key values (encode(extensions.digest('test-admin-key', 'sha256'), 'hex'));
insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a6', 'a6@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b6', 'b6@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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
create function pg_temp.queued(uid text, k text) returns int language sql as $$
  select count(*)::int from dating_private.push_outbox where user_id = uid::uuid and kind = k
$$;

-- Ada and Bolu both have dating profiles.
select pg_temp.login('00000000-0000-0000-0000-0000000000a6');
select create_my_profile('Ada Push', 'female', 24, 'Lagos', 'love');
update dating_profiles set interested_in = '{male}' where user_id = '00000000-0000-0000-0000-0000000000a6';
select pg_temp.login('00000000-0000-0000-0000-0000000000b6');
select create_my_profile('Bolu Push', 'male', 26, 'Lagos', 'love');
select pg_temp.admin();
select set_config('test.ha', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000a6'), true);
select set_config('test.hb', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000b6'), true);

select pg_temp.anon();
select throws_ok($$ select save_push_subscription('https://push.example.test/anon', repeat('k', 87), repeat('a', 22)) $$,
  '42501', null, 'Signed-out visitors can''t save a device');

select pg_temp.login('00000000-0000-0000-0000-0000000000a6');
select lives_ok($$ select save_push_subscription('https://push.example.test/ada', repeat('k', 87), repeat('a', 22)) $$,
  'A signed-in person can save their device');
select pg_temp.login('00000000-0000-0000-0000-0000000000b6');
select is((select count(*)::int from push_subscriptions), 0, 'Nobody can see someone else''s devices');

-- Ada likes Bolu: Bolu has no device yet, so nothing is queued for him.
select pg_temp.login('00000000-0000-0000-0000-0000000000a6');
select like_profile(current_setting('test.hb'), true);
select pg_temp.admin();
select is(pg_temp.queued('00000000-0000-0000-0000-0000000000b6', 'like'), 0, 'People without a device get nothing queued');

-- Bolu saves a device, then likes Ada back: a match for Ada, not a "like".
select pg_temp.login('00000000-0000-0000-0000-0000000000b6');
select save_push_subscription('https://push.example.test/bolu', repeat('k', 87), repeat('a', 22));
select like_profile(current_setting('test.ha'), true);
select pg_temp.admin();
select is(pg_temp.queued('00000000-0000-0000-0000-0000000000a6', 'match'), 1, 'A match notifies the other person');
select is(pg_temp.queued('00000000-0000-0000-0000-0000000000a6', 'like'), 0, 'A like that makes a match isn''t also sent as a like');

-- Ada sends a chat message: Bolu is notified.
select set_config('test.conv', dating_private.dating_conversation_between('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000b6')::text, true);
select pg_temp.login('00000000-0000-0000-0000-0000000000a6');
insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'hey!');
select pg_temp.admin();
select is(pg_temp.queued('00000000-0000-0000-0000-0000000000b6', 'chat'), 1, 'A chat message notifies the other person');
select ok(not exists (select 1 from dating_private.push_outbox o where o.user_id in ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000b6')
  and (o.url ~* 'great|hey')), 'Notifications never carry message text');

-- The server takes them with its key.
select pg_temp.anon();
select throws_ok($$ select * from admin_take_push('wrong-key') $$, '42501', null, 'Taking notifications needs the admin key');
select is((select count(*)::int from admin_take_push('test-admin-key', 500) where endpoint like 'https://push.example.test/%'), 2,
  'The server gets each queued notification with its device');
select pg_temp.admin();
select is((select count(*)::int from dating_private.push_outbox where user_id in ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000b6')), 0,
  'Taken notifications leave the queue');

select pg_temp.login('00000000-0000-0000-0000-0000000000a6');
select delete_push_subscription('https://push.example.test/ada');
select is((select count(*)::int from push_subscriptions), 0, 'Turning notifications off removes the device');

select * from finish();
rollback;
