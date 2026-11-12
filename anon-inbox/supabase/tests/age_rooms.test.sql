-- Age rooms + date of birth: everyone sees all three age rooms but joins only theirs, with the right
-- message; age comes from date of birth; under-18 dates suspend the profile for good; date of birth
-- changes once every 365 days; people can't lift their own suspension.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(17);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'ar1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000a2', 'ar2@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000a3', 'ar3@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select create_my_profile('Ada Age', 'female', 30, 'Lagos', 'love');
-- The first date of birth is always accepted and sets the age (even inside the 365 days).
select lives_ok(format($$update dating_profiles set birth_date = %L where user_id = auth.uid()$$, pg_temp.dob(22)), 'First date of birth is accepted');
select is((select age from dating_profiles where user_id = auth.uid()), 22, 'Age comes from the date of birth');

select is((select count(*)::int from room_list() where state like 'Ages %'), 3, 'Everyone sees all three age rooms');
select lives_ok($$select join_room('Ages 18-25')$$, 'Ada (22) joins Ages 18-25');
select throws_ok($$select join_room('Ages 26-35')$$, '42501', 'You are too young for this group.', 'Ada is too young for Ages 26-35');
select throws_ok($$select join_room('Ages 36+')$$, '42501', 'You are too young for this group.', 'Ada is too young for Ages 36+');

select throws_ok($$update dating_profiles set age = 40 where user_id = auth.uid()$$, 'P0001', 'Your age comes from your date of birth.', 'Age cannot be typed in once there is a date of birth');
select throws_ok(format($$update dating_profiles set birth_date = %L where user_id = auth.uid()$$, pg_temp.dob(30)), 'P0001', null, 'Date of birth is locked for 365 days');

select pg_temp.admin();
update dating_profiles set age_changed_at = now() - interval '366 days' where user_id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok(format($$update dating_profiles set birth_date = %L where user_id = auth.uid()$$, pg_temp.dob(30)), 'After 365 days the date of birth can change');
select pg_temp.admin();
select is((select count(*)::int from room_members where user_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'Moving age range leaves the old age room');

-- Bola (30, no date of birth yet): age rooms ask for it first; typed age changes wait 365 days.
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select create_my_profile('Bola Age', 'male', 30, 'Lagos', 'love');
select throws_ok($$select join_room('Ages 26-35')$$, '42501', 'Add your date of birth to join the age rooms.', 'Without a date of birth, age rooms ask for it');
select throws_ok($$update dating_profiles set age = 22 where user_id = auth.uid()$$, 'P0001', null, 'Without a date of birth, age changes wait 365 days too');
update dating_profiles set birth_date = pg_temp.dob(30) where user_id = auth.uid();
select throws_ok($$select join_room('Ages 18-25')$$, '42501', 'You are too old for this group.', 'Bola (30) is too old for Ages 18-25');

-- Chi gives an under-18 date of birth: suspended, can't retry, can't lift it.
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select create_my_profile('Chi Age', 'male', 19, 'Lagos', 'love');
update dating_profiles set birth_date = pg_temp.dob(16) where user_id = auth.uid();
select is((select suspended and dob_underage_at is not null from dating_profiles where user_id = auth.uid()), true, 'An under-18 date of birth suspends the profile');
select throws_ok(format($$update dating_profiles set birth_date = %L where user_id = auth.uid()$$, pg_temp.dob(20)), '42501', null, 'They cannot try another date');
select throws_ok($$update dating_profiles set suspended = false where user_id = auth.uid()$$, '42501', null, 'People cannot lift their own suspension');

-- The server's birthday refresh is not blocked by the 365-day rule.
select pg_temp.admin();
update dating_profiles set age = 29 where user_id = '00000000-0000-0000-0000-0000000000a1';
select is((select age from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000a1'), 29, 'System age updates are allowed');

select * from finish();
rollback;
