-- Chatroom replies: quote a message in your own room; history shows the quote.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a9', 'a9@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b9', 'b9@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

create function pg_temp.login(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.login('00000000-0000-0000-0000-0000000000a9');
select join_room('Gombe');
select set_config('test.orig', (select id::text from send_room_message('Who is going to the match on Saturday?')), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000b9');
select join_room('Gombe');

select is((select reply_to::text from send_room_message('Me! Count me in', current_setting('test.orig')::bigint)), current_setting('test.orig'),
  'You can reply to a message in your room');
select is((select reply_body from room_history() where body = 'Me! Count me in'), 'Who is going to the match on Saturday?',
  'History shows what the reply quotes');
select ok((select reply_handle is not null from room_history() where body = 'Me! Count me in'), 'The quote names who said it');
select is((select reply_to from room_history() where body = 'Who is going to the match on Saturday?'), null, 'Normal messages aren''t replies');
select lives_ok($$ select send_room_message('plain message') $$, 'Sending without a reply still works');

-- Can't quote a message from another room.
select pg_temp.login('00000000-0000-0000-0000-0000000000a9');
select join_room('Yobe');
select throws_ok(format('select send_room_message(%L, %s)', 'hi', current_setting('test.orig')), 'P0002', null,
  'You can only reply to messages in your own room');
select is((select char_length(reply_body) <= 140 from (select left(repeat('x', 300), 140) as reply_body) t), true, 'Quotes are kept short');

select * from finish();
rollback;
