-- Older accounts without a date of birth must add one before chatrooms, likes, Discover and Nearby.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(10);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000d0c1', 'dobg1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-00000000d0c2', 'dobg2@test.invalid', 'authenticated', 'authenticated', now(), now(), now());
-- d0c1: a new-style account with a date of birth. d0c2: an older account with only a typed age.
insert into dating_profiles (user_id, name, gender, age, birth_date, location, intent, handle, state) values
  ('00000000-0000-0000-0000-00000000d0c1', 'Dob Yes', 'female', 25, (current_date - interval '25 years 2 months')::date, 'Lagos', 'love', 'dobtest_yes', 'Lagos'),
  ('00000000-0000-0000-0000-00000000d0c2', 'Dob No', 'male', 30, null, 'Lagos', 'love', 'dobtest_no', 'Lagos');
create function pg_temp.login(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.login('00000000-0000-0000-0000-00000000d0c2');
select throws_ok('select * from discover_cards(5, array[]::text[])', '42501', 'Add your date of birth first. It’s private, and keeps treehouse 18+.', 'No date of birth: Discover is closed');
select throws_ok('select * from discover_profiles(5, 0)', '42501', 'Add your date of birth first. It’s private, and keeps treehouse 18+.', 'No date of birth: the older Discover list is closed too');
select throws_ok($$select * from nearby_people(10, null, null, array[]::text[], array[]::text[], 'distance', 20)$$, '42501', 'Add your date of birth first. It’s private, and keeps treehouse 18+.', 'No date of birth: Nearby is closed');
select throws_ok($$select * from join_room('Nigeria')$$, '42501', 'Add your date of birth first. It’s private, and keeps treehouse 18+.', 'No date of birth: cannot join a chatroom');
select throws_ok($$select * from like_profile('dobtest_yes', true)$$, '42501', 'Add your date of birth first. It’s private, and keeps treehouse 18+.', 'No date of birth: cannot like people');
select throws_ok($$select speed_join()$$, '42501', 'Add your date of birth first. It’s private, and keeps treehouse 18+.', 'No date of birth: cannot join Speed Dating');

select pg_temp.login('00000000-0000-0000-0000-00000000d0c1');
select lives_ok('select * from discover_cards(5, array[]::text[])', 'With a date of birth: Discover works');
select lives_ok($$select * from join_room('Nigeria')$$, 'With a date of birth: joining a chatroom works');

select pg_temp.login('00000000-0000-0000-0000-00000000d0c2');
update dating_profiles set birth_date = (current_date - interval '30 years 3 months')::date where user_id = auth.uid();
select lives_ok('select * from discover_cards(5, array[]::text[])', 'After adding a date of birth: Discover opens');
select lives_ok($$select * from join_room('Nigeria')$$, 'After adding a date of birth: chatrooms open');

select set_config('role', 'postgres', true);
select * from finish();
rollback;
