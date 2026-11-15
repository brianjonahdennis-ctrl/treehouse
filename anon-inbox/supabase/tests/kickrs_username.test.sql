-- Kickrs name: username when chosen, nickname otherwise.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(3);
insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'ku1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000f2', 'ku2@test.invalid', 'authenticated', 'authenticated', now(), now(), now());
create function pg_temp.login(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select create_my_profile('Ada Name', 'female', (current_date - interval '27 years 1 month')::date, 'Lagos', 'love');
select kickrs_connect();
select is((select handle from kickrs_identity()), (select handle from dating_profiles where user_id = auth.uid()), 'No username: Kickrs still gets the nickname');
select set_username('adakicks9');
select is((select handle from kickrs_identity()), 'adakicks9', 'With a username: Kickrs gets the username');

select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select create_my_profile('Bola Name', 'male', (current_date - interval '29 years 1 month')::date, 'Abuja', 'love');
select is((select handle from kickrs_connect()), (select handle from dating_profiles where user_id = auth.uid()), 'Connecting without a username shows the nickname');
select * from finish();
rollback;
