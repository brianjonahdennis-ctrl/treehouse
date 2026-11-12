-- Chatrooms: you keep your seat while you're using treehouse (anywhere in the app), you're taken out
-- after 30 minutes away, and coming back to your room picks up where you left off with an unread count.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(13);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a7', 'a7@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b7', 'b7@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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
create function pg_temp.unread(st text) returns int language sql as $$ select unread from room_list() where state = st $$;

-- Ada and Bolu are both in Ekiti. Bolu steps out of the room to reply to a private chat.
select pg_temp.login('00000000-0000-0000-0000-0000000000a7');
select join_room('Ekiti');
select pg_temp.login('00000000-0000-0000-0000-0000000000b7');
select is((select rejoined from join_room('Ekiti')), false, 'Joining a room for the first time is a fresh join');
select room_mark_read();
select pg_temp.admin();
select set_config('test.read', (select last_read_id::text from room_members where user_id = '00000000-0000-0000-0000-0000000000b7'), true);
select set_config('test.ha', (select handle from room_members where user_id = '00000000-0000-0000-0000-0000000000a7'), true);
select set_config('test.hb', (select handle from room_members where user_id = '00000000-0000-0000-0000-0000000000b7'), true);

select pg_temp.login('00000000-0000-0000-0000-0000000000a7');
select send_room_message('one');
select send_room_message('two');
select send_room_message('three');
select is(pg_temp.unread('Ekiti'), 0, 'Your own messages never count as unread');

select pg_temp.login('00000000-0000-0000-0000-0000000000b7');
select is(pg_temp.unread('Ekiti'), 3, 'Messages sent while you were out of the room show as unread');
select is((select count(*)::int from room_list() where unread > 0), 1, 'Only your own room has a counter');

-- Bolu comes back to the room: same seat, and the app learns where they'd read up to.
select is((select rejoined from join_room('Ekiti')), true, 'Coming back to your room isn''t a new join');
select is((select last_read_id::text from join_room('Ekiti')), current_setting('test.read'), 'Coming back tells the app the last message you saw');
select room_mark_read();
select is(pg_temp.unread('Ekiti'), 0, 'Opening the room clears the counter');

-- Using another part of the app (the app's "I'm here" ping) keeps your seat.
select pg_temp.admin();
update room_members set last_seen_at = now() - interval '25 minutes' where user_id = '00000000-0000-0000-0000-0000000000b7';
select pg_temp.login('00000000-0000-0000-0000-0000000000b7');
select touch_last_seen();
select pg_temp.admin();
select ok((select last_seen_at > now() - interval '1 minute' from room_members where user_id = '00000000-0000-0000-0000-0000000000b7'),
  'Being active anywhere in treehouse keeps your room seat');

-- Online vs away.
select pg_temp.admin();
update room_members set last_seen_at = now() - interval '10 minutes' where user_id = '00000000-0000-0000-0000-0000000000b7';
select pg_temp.login('00000000-0000-0000-0000-0000000000a7');
select is((select online from room_people() where handle = current_setting('test.hb')), false, 'Quiet for 10 minutes shows as away');
select is((select count(*)::int from room_people() where handle = current_setting('test.hb')), 1, 'Away members are still in the room');

-- 30 minutes away from treehouse: out of the room.
select pg_temp.admin();
update room_members set last_seen_at = now() - interval '31 minutes' where user_id = '00000000-0000-0000-0000-0000000000b7';
select pg_temp.login('00000000-0000-0000-0000-0000000000b7');
select is(room_heartbeat(), null, '30 minutes away takes you out of the room');
select is(coalesce((select sum(unread)::int from room_list()), 0), 0, 'Once you''re out, there''s no counter');
select is((select rejoined from join_room('Ekiti')), false, 'Coming back after that is a fresh join');

select * from finish();
rollback;
