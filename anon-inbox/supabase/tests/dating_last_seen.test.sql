-- Last active: only a coarse online/hours value is shown, and only the app's heartbeat can set it.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(11);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a5', 'a5@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b5', 'b5@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select create_my_profile('Ada Seen', 'female', 24, 'Lagos', 'love');
update dating_profiles set interested_in = '{male}', pref_state = null where user_id = '00000000-0000-0000-0000-0000000000a5';
select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select create_my_profile('Bolu Seen', 'male', 26, 'Lagos', 'love');
update dating_profiles set pref_state = null where user_id = '00000000-0000-0000-0000-0000000000b5';

select throws_ok($$ update dating_profiles set last_seen_at = now() where user_id = '00000000-0000-0000-0000-0000000000b5' $$,
  '42501', null, 'People can''t set their last-seen time directly');

select pg_temp.admin();
select set_config('test.hb', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000b5'), true);

select is(dating_private.is_online(null), false, 'Someone never seen isn''t online');
select is(dating_private.hours_since(null), null, 'Someone never seen has no last-active time');

select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select lives_ok($$ select touch_last_seen() $$, 'The app heartbeat records activity');

select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select is((select online from discover_cards(50) where handle = current_setting('test.hb')), true, 'Active in the last 5 minutes shows as online');
select is((select active_hours from discover_cards(50) where handle = current_setting('test.hb')), 0, 'Just now is 0 hours');

select pg_temp.admin();
update dating_profiles set last_seen_at = now() - interval '3 hours 20 minutes' where user_id = '00000000-0000-0000-0000-0000000000b5';
select is(dating_private.hours_since(now() - interval '3 hours 20 minutes'), 3, 'Last active is shown in whole hours');
select is(dating_private.is_online(now() - interval '3 hours 20 minutes'), false, 'Hours ago is not online');

select pg_temp.login('00000000-0000-0000-0000-0000000000b5');
select touch_last_seen();
select pg_temp.admin();
select ok((select last_seen_at > now() - interval '1 minute' from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000b5'),
  'A new heartbeat updates an old last-seen time');

-- Online people come first in Discover: Chuks (online) before Bolu (active hours ago, and newer).
insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000c5', 'c5@test.invalid', 'authenticated', 'authenticated', now(), now(), now());
select pg_temp.login('00000000-0000-0000-0000-0000000000c5');
select create_my_profile('Chuks Seen', 'male', 27, 'Lagos', 'love');
update dating_profiles set pref_state = null where user_id = '00000000-0000-0000-0000-0000000000c5';
select pg_temp.admin();
update dating_profiles set created_at = now() - interval '30 days', last_seen_at = now() where user_id = '00000000-0000-0000-0000-0000000000c5';
-- Keep real profiles out of these ranking checks: only the test people are aged 110+.
update dating_profiles set age = 110 where user_id in ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000c5');
update dating_profiles set min_age = 110, max_age = 120 where user_id = '00000000-0000-0000-0000-0000000000a5';
update dating_profiles set last_seen_at = now() - interval '5 minutes' where user_id = '00000000-0000-0000-0000-0000000000b5';
select set_config('test.hc', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000c5'), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select is((select handle from discover_cards(50) where handle in (current_setting('test.hb'), current_setting('test.hc')) limit 1),
  current_setting('test.hc'), 'Someone online now comes before someone offline, even an older profile');
select pg_temp.admin();
update dating_profiles set last_seen_at = now() - interval '5 minutes 1 second' where user_id = '00000000-0000-0000-0000-0000000000c5';
update dating_profiles set created_at = now() - interval '60 days' where user_id = '00000000-0000-0000-0000-0000000000b5';
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select is((select handle from discover_cards(50) where handle in (current_setting('test.hb'), current_setting('test.hc')) limit 1),
  current_setting('test.hb'), 'Among offline people, the more recently active comes first');

select * from finish();
rollback;
