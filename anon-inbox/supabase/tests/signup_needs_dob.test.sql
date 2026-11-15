-- Sign-up needs a date of birth (security report F2): the age-only path is closed, under-18 and missing
-- dates are refused, and the saved age comes from the date of birth.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-00000000d0b1', 'dob1@test.invalid', 'authenticated', 'authenticated', now(), now(), now());
create function pg_temp.login(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.login('00000000-0000-0000-0000-00000000d0b1');
select throws_ok($$select create_my_profile('Ada', 'female', 30, 'Lagos', 'love')$$, '22023', null, 'The old age-only sign-up is closed');
select throws_ok($$select create_my_profile('Ada', 'female', null::date, 'Lagos', 'love')$$, '22023', null, 'A missing date of birth is refused');
select throws_ok(format($$select create_my_profile('Ada', 'female', %L::date, 'Lagos', 'love')$$, (current_date - interval '17 years')::date), '22023', null, 'Under 18 is refused');
select throws_ok(format($$select create_my_profile('Ada', 'female', %L::date, 'Lagos', 'love')$$, (current_date + 1)::date), '22023', null, 'A future date is refused');
select lives_ok(format($$select create_my_profile('Ada', 'female', %L::date, 'Lagos', 'love')$$, (current_date - interval '25 years 2 months')::date), 'An adult with a date of birth can sign up');
select is((select age::text || '/' || (birth_date is not null)::text from dating_profiles where user_id = '00000000-0000-0000-0000-00000000d0b1'), '25/true', 'The date of birth is saved and the age comes from it');

select set_config('role', 'postgres', true);
select * from finish();
rollback;
