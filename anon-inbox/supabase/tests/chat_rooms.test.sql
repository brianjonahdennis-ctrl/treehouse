-- State chat rooms: one room at a time, 200 people per room, anonymous names, members-only history.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a7', 'a7@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b7', 'b7@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c7', 'c7@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

-- Ada has a dating profile; Bolu and Chi don't.
select pg_temp.login('00000000-0000-0000-0000-0000000000a7');
select create_my_profile('Ada Roomtest', 'female', 24, 'Lagos', 'love');
select pg_temp.admin();
select set_config('test.ha', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000a7'), true);

select pg_temp.login('00000000-0000-0000-0000-0000000000a7');
select throws_ok($$ select * from join_room('Atlantis') $$, 'P0002', null, 'Only real state rooms exist');
select is((select handle from join_room('Lagos')), current_setting('test.ha'), 'People with a dating card chat under their dating nickname');

select pg_temp.login('00000000-0000-0000-0000-0000000000b7');
select ok((select handle from join_room('Lagos')) ~ '^[A-Z][a-z]+ [A-Z][a-z]+ \d{3}$', 'Others get an app-given anonymous name');
select is((select handle from join_room('Lagos')), (select handle from join_room('Lagos')), 'Your room name stays the same');
select ok((select string_agg(row_to_json(x)::text, ',') from room_people() x) !~ '(Roomtest|test\.invalid)', 'Room lists never show real names or emails');

select lives_ok($$ select send_room_message('hello Lagos!') $$, 'Members can send messages');
select is((select count(*)::int from room_history() where body = 'hello Lagos!' and mine), 1, 'Your own messages come back marked as yours');

-- Moving rooms: one room at a time.
select join_room('FCT');
select is((select count(*)::int from room_list() where mine), 1, 'You''re only ever in one room');
select is((select state from room_list() where mine), 'FCT', 'Joining another room moves you there');
select is((select count(*)::int from room_history() where body = 'hello Lagos!'), 0, 'You only see the room you''re in');

-- Chi isn't in Lagos, so she can't read it or post there.
select pg_temp.login('00000000-0000-0000-0000-0000000000c7');
select is((select count(*)::int from room_history()), 0, 'People outside a room can''t read it');
select throws_ok($$ select send_room_message('hi') $$, 'P0002', null, 'You have to join before sending');
select throws_ok($$ select * from room_messages $$, '42501', null, 'Nobody reads the messages table directly');

-- A full room turns people away. Fill Kano with 200 people.
select pg_temp.admin();
insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at)
  select ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'fill' || g || '@test.invalid', 'authenticated', 'authenticated', now(), now(), now()
  from generate_series(1, 200) g;
-- Top Kano up to exactly 200 people, counting anyone really in it right now.
insert into room_members (user_id, state, handle)
  select ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'Kano', 'Test Person ' || g
  from generate_series(1, 200 - (select count(*)::int from room_members where state = 'Kano' and dating_private.room_active(last_seen_at))) g;
select pg_temp.login('00000000-0000-0000-0000-0000000000c7');
select throws_ok($$ select * from join_room('Kano') $$, 'P0001', null, 'A room with 200 people is full');

-- 30 minutes away from treehouse frees up your place.
select pg_temp.admin();
update room_members set last_seen_at = now() - interval '31 minutes' where handle = 'Test Person 1';
select pg_temp.login('00000000-0000-0000-0000-0000000000c7');
select is((select people from join_room('Kano')), 200, 'When someone leaves, the next person can join');

-- Flood control.
select pg_temp.login('00000000-0000-0000-0000-0000000000b7');
select send_room_message('1'); select send_room_message('2'); select send_room_message('3'); select send_room_message('4');
select throws_ok($$ select send_room_message('5') $$, 'P0001', null, 'At most 5 messages every 10 seconds');

select * from finish();
rollback;
