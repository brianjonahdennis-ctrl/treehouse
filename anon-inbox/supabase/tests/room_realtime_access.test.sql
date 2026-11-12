-- Who can listen to a chatroom's live channel: only people in that room.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(4);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000ad', 'ad@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000bd', 'bd@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

create function pg_temp.login(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.login('00000000-0000-0000-0000-0000000000ad');
select join_room('Jigawa');
select send_room_message('live test');
select set_config('realtime.topic', 'room:Jigawa', true);
select ok(room_can_listen('room:Jigawa'), 'People in a room may listen to its live channel');
select lives_ok($$ select count(*) from realtime.messages $$, 'Checking channel access no longer errors for app users');
select ok((select count(*) from realtime.messages where topic = 'room:Jigawa') >= 1, 'Members can receive their room''s live messages');

select pg_temp.login('00000000-0000-0000-0000-0000000000bd');
select join_room('Kebbi');
-- Realtime checks access per channel: ask as if B were opening Jigawa's channel.
select set_config('realtime.topic', 'room:Jigawa', true);
select is((select count(*)::int from realtime.messages where topic = 'room:Jigawa'), 0, 'People in another room can''t listen in');

select * from finish();
rollback;
