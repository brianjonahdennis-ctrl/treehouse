-- Nigerian states: only real states are accepted, and Discover filters by the chosen state.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a4', 'a4@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b4', 'b4@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c4', 'c4@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

-- Ada (f) in Lagos looking for men; Bolu (m) in Lagos; Chuks (m) in Rivers
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select create_my_profile('Ada Hidden', 'female', 24, 'Lagos', 'love');
update dating_profiles set state = 'Lagos', pref_state = 'Lagos', interested_in = '{male}' where user_id = '00000000-0000-0000-0000-0000000000a4';
select pg_temp.login('00000000-0000-0000-0000-0000000000b4');
select create_my_profile('Bolu Hidden', 'male', 26, 'Lagos', 'love');
update dating_profiles set state = 'Lagos', pref_state = 'Lagos' where user_id = '00000000-0000-0000-0000-0000000000b4';
select pg_temp.login('00000000-0000-0000-0000-0000000000c4');
select create_my_profile('Chuks Hidden', 'male', 27, 'Rivers', 'love');
update dating_profiles set state = 'Rivers', pref_state = 'Rivers' where user_id = '00000000-0000-0000-0000-0000000000c4';
select throws_ok($$ update dating_profiles set state = 'Atlantis' where user_id = '00000000-0000-0000-0000-0000000000c4' $$,
  '23514', null, 'Only Nigerian states are accepted');
select throws_ok($$ update dating_profiles set pref_state = 'lagos ' where user_id = '00000000-0000-0000-0000-0000000000c4' $$,
  '23514', null, 'The filter only accepts states from the list');

select pg_temp.admin();
update dating_profiles set last_seen_at = now() where user_id in (select id from auth.users where email like '%@test.invalid');  -- test people rank first in Discover
select set_config('test.hb', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000b4'), true);
select set_config('test.hc', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000c4'), true);

select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select ok(exists (select 1 from discover_cards(50) where handle = current_setting('test.hb')), 'Ada sees people in her state');
select ok(not exists (select 1 from discover_cards(50) where handle = current_setting('test.hc')), 'Ada doesn''t see other states while filtering');
update dating_profiles set pref_state = 'Rivers' where user_id = '00000000-0000-0000-0000-0000000000a4';
select ok(exists (select 1 from discover_cards(50) where handle = current_setting('test.hc')), 'Switching the filter to Rivers shows people in Rivers');
update dating_profiles set pref_state = null where user_id = '00000000-0000-0000-0000-0000000000a4';
select is((select count(*)::int from discover_cards(50) where handle in (current_setting('test.hb'), current_setting('test.hc'))), 2,
  '"Anywhere in Nigeria" shows every state');
select ok((select people from dating_state_counts() where state = 'Lagos') >= 1, 'State counts are available for the picker');

select * from finish();
rollback;
