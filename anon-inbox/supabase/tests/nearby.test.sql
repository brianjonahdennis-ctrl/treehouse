-- Nearby: opt-in, protected locations, server-side distances, privacy switches, blocks.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'nd1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', 'nd2@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000d3', 'nd3@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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
create function pg_temp.near(h text) returns record language sql as $$
  select (distance_km, map_lat, map_lng) from nearby_people(25) where handle = h
$$;

select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select create_my_profile('Ada Near', 'female', 26, 'Abuja', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select create_my_profile('Bayo Near', 'male', 28, 'Abuja', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000d3');
select create_my_profile('Chidi Near', 'male', 30, 'Abuja', 'fun');
select pg_temp.admin();
select set_config('test.hb', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000d2'), true);
select set_config('test.hc', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000d3'), true);
update dating_profiles set min_age = 18, max_age = 99 where user_id = '00000000-0000-0000-0000-0000000000d1';

-- Off by default.
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select is((select enabled from nearby_settings()), false, 'Nearby is off until you turn it on');
select throws_ok($$ select * from nearby_people(10) $$, 'P0002', null, 'You can''t browse Nearby without sharing your area');

-- Ada (Wuse) and Bayo (~2 km away, Garki) switch it on. Chidi doesn't.
select lives_ok($$ select nearby_set_location(9.0765, 7.4793) $$, 'You can share your area');
select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select nearby_set_location(9.0590, 7.4880);
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from nearby_people(25) where handle = current_setting('test.hb')), 1, 'People who turned Nearby on show up');
select is((select count(*)::int from nearby_people(25) where handle = current_setting('test.hc')), 0, 'People who didn''t turn it on never show up');
select ok((select distance_km between 0.5 and 4.5 from nearby_people(25) where handle = current_setting('test.hb')), 'Distance is roughly right');

-- The stored point is protected, not the real position.
select pg_temp.admin();
select ok((select dating_private.km_between(plat, plng, 9.0765, 7.4793) > 0.01 and dating_private.km_between(plat, plng, 9.0765, 7.4793) < 1.6
           from dating_private.nearby where user_id = '00000000-0000-0000-0000-0000000000d1'),
  'The saved point is moved away from the real position (but stays within the ~1 km area)');
select is((select count(*)::int from information_schema.column_privileges
           where table_schema = 'dating_private' and table_name = 'nearby' and grantee in ('authenticated', 'anon')), 0,
  'Nobody can read the location table directly');
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select is((select nearby_set_location(9.0766, 7.4794)::text), '', 'Moving a few metres…');
select pg_temp.admin();
select ok((select abs(plat - (select plat from dating_private.nearby where user_id = '00000000-0000-0000-0000-0000000000d1')) < 0.0000001
           from dating_private.nearby where user_id = '00000000-0000-0000-0000-0000000000d1'),
  '…gives the same protected point, so small moves can''t be tracked');

-- Privacy switches.
select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select nearby_update_settings(p_hide_on_map => true);
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select ok((select map_lat is null and distance_km is not null from nearby_people(25) where handle = current_setting('test.hb')), 'Hide me on the map keeps you off the map');
select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select nearby_update_settings(p_hide_distance => true);
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select ok((select distance_km is null from nearby_people(25) where handle = current_setting('test.hb')), 'Hide my distance hides your distance');
select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select nearby_update_settings(p_paused => true);
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from nearby_people(25) where handle = current_setting('test.hb')), 0, 'Pausing hides you from Nearby');

-- Blocks, and turning it off.
select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select nearby_update_settings(p_paused => false);
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select block_profile(current_setting('test.hb'));
select is((select count(*)::int from nearby_people(25) where handle = current_setting('test.hb')), 0, 'Blocked people never see each other');
select nearby_update_settings(p_enabled => false);
select is((select enabled from nearby_settings()), false, 'Turning Nearby off…');
select pg_temp.admin();
select is((select count(*)::int from dating_private.nearby where user_id = '00000000-0000-0000-0000-0000000000d1'), 0, '…deletes your location straight away');

select * from finish();
rollback;
