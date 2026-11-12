-- Chatroom reactions and profile cards: only for people in the same room; cards show only dating-card details.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a8', 'a8@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b8', 'b8@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c8', 'c8@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

create function pg_temp.login(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- Ada (dating card) and Bolu (no card) are in Ebonyi; Chi is in Ekiti.
select pg_temp.login('00000000-0000-0000-0000-0000000000a8');
select create_my_profile('Ada Secretname', 'female', 25, 'Ebonyi', 'love');
select set_config('test.ha', (select handle from join_room('Ebonyi')), true);
select set_config('test.msg', (select id::text from send_room_message('anyone up?')), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000b8');
select set_config('test.hb', (select handle from join_room('Ebonyi')), true);

select is((select mine from toggle_room_reaction(current_setting('test.msg')::bigint, '❤️')), true, 'Members can react');
select is((select (reactions->>'❤️')::int from room_history() where id = current_setting('test.msg')::bigint), 1, 'Reaction counts come with the history');
select is((select my_reactions from room_history() where id = current_setting('test.msg')::bigint), array['❤️'], 'Your own reactions are marked');
select is((select mine from toggle_room_reaction(current_setting('test.msg')::bigint, '❤️')), false, 'Tapping again removes it');
select throws_ok($$ select * from toggle_room_reaction(current_setting('test.msg')::bigint, '🍆') $$, '23514', null, 'Only the offered emoji are allowed');

select is((select age from room_profile(current_setting('test.ha'))), 25, 'Profile cards show the dating card''s age');
select ok((select row_to_json(x)::text from room_profile(current_setting('test.ha')) x) !~ '(Secretname|test\.invalid)', 'Profile cards never show real names or emails');

select pg_temp.login('00000000-0000-0000-0000-0000000000c8');
select join_room('Ekiti');
select is((select count(*)::int from room_profile(current_setting('test.ha'))), 0, 'You can only see cards of people in your room');
select throws_ok($$ select * from toggle_room_reaction(current_setting('test.msg')::bigint, '🔥') $$, 'P0002', null, 'You can only react in your room');

select * from finish();
rollback;
