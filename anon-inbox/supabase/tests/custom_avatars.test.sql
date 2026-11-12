-- Custom avatars: short codes only, visible by nickname, removable.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000ab', 'ab@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000bb', 'bb@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

create function pg_temp.login(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.login('00000000-0000-0000-0000-0000000000ab');
select create_my_profile('Ada Avatar', 'female', 25, 'Lagos', 'love');
select set_config('test.ha', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000ab'), true);
select lives_ok($$ select set_my_avatar('{"k":"f","s":"3","h":"afro","hc":"black"}') $$, 'People can save an avatar');
select throws_ok($$ select set_my_avatar('{"k":"m","s":"3","h":"fade"}') $$, '22023', null, 'Female profiles can only use female avatars');
select throws_ok($$ select set_my_avatar('{"k":"f","h":"<script>"}') $$, '22023', null, 'Only short codes are accepted');

select pg_temp.login('00000000-0000-0000-0000-0000000000bb');
select is((select config->>'h' from get_avatars(array[current_setting('test.ha')])), 'afro', 'Others see the avatar for a nickname');
select set_config('test.hb', (select handle from join_room('Lagos')), true);
select set_my_avatar('{"s":"6","h":"bun"}');
select is((select config->>'h' from get_avatars(array[current_setting('test.hb')])), 'bun', 'Chatroom names get avatars too');

select pg_temp.login('00000000-0000-0000-0000-0000000000ab');
select set_my_avatar(null);
select is((select count(*)::int from get_avatars(array[current_setting('test.ha')])), 0, 'Removing your avatar brings back initials');
select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select * from get_avatars(array['x']) $$, '42501', null, 'Signed-out visitors can''t look up avatars');

select * from finish();
rollback;
