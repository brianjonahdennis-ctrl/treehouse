-- Live-only chatrooms: you only see messages sent since you joined; leaving starts you fresh.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(5);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000ac', 'ac@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000bc', 'bc@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

-- Ada is in Kogi and sends a message before Bolu arrives.
select pg_temp.login('00000000-0000-0000-0000-0000000000ac');
select join_room('Kogi');
select send_room_message('before you came');
select pg_temp.admin();
update room_members set joined_at = now() - interval '10 minutes' where user_id = '00000000-0000-0000-0000-0000000000ac';
update room_messages set created_at = now() - interval '5 minutes' where body = 'before you came';

select pg_temp.login('00000000-0000-0000-0000-0000000000bc');
select join_room('Kogi');
select is((select count(*)::int from room_history() where body = 'before you came'), 0, 'Newcomers don''t see messages sent before they joined');

select pg_temp.login('00000000-0000-0000-0000-0000000000ac');
select is((select count(*)::int from room_history() where body = 'before you came'), 1, 'People who were there still see them');
select send_room_message('welcome!');

select pg_temp.login('00000000-0000-0000-0000-0000000000bc');
select is((select count(*)::int from room_history() where body = 'welcome!'), 1, 'Messages sent while you''re in the room show up');

-- Bolu leaves and comes back later: a fresh start.
select leave_room();
select pg_temp.admin();
update room_messages set created_at = now() - interval '1 minute' where body = 'welcome!';
select pg_temp.login('00000000-0000-0000-0000-0000000000bc');
select join_room('Kogi');
select is((select count(*)::int from room_history()), 0, 'Leaving clears the chat: rejoining starts fresh');

-- Minimizing the app for a while (no check-ins) doesn't drop you from the room.
select pg_temp.admin();
update room_members set last_seen_at = now() - interval '20 minutes' where user_id = '00000000-0000-0000-0000-0000000000ac';
select pg_temp.login('00000000-0000-0000-0000-0000000000ac');
select is(room_heartbeat(), 'Kogi', 'Twenty minutes away still keeps you in the room');

select * from finish();
rollback;
