-- Message requests: anyone can message anyone; the first message is a request until the other
-- person replies; senders can send 3 messages before a reply; recipients can decline.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(20);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a3', 'a3@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b3', 'b3@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c3', 'c3@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000d3', 'd3@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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
create function pg_temp.status(conv text) returns text language sql as $$
  select status from my_conversations() where conversation_id = conv::uuid;
$$;

select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select create_my_profile('Ama Hidden', 'female', 25, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000b3');
select create_my_profile('Bayo Hidden', 'male', 27, 'Abuja', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select create_my_profile('Chi Hidden', 'male', 30, 'Enugu', 'fun');
select pg_temp.login('00000000-0000-0000-0000-0000000000d3');
select create_my_profile('Dayo Hidden', 'male', 29, 'Ibadan', 'fun');
select pg_temp.admin();
select set_config('test.ha', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000a3'), true);
select set_config('test.hb', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000b3'), true);
select set_config('test.hc', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000c3'), true);
select set_config('test.hd', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000d3'), true);

-- Bayo messages Ama without a match: it's a request
select pg_temp.login('00000000-0000-0000-0000-0000000000b3');
select set_config('test.conv', start_conversation(current_setting('test.ha'))::text, true);
select ok(current_setting('test.conv') <> '', 'Anyone can start a chat with anyone');
select is(pg_temp.status(current_setting('test.conv')), 'sent', 'For the sender it''s a sent request');
insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'hi Ama');
insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'loved your bio');
insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'ok last one');
select throws_ok($$ insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'hello??') $$,
  'P0001', null, 'A fourth message before a reply is refused');

select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(pg_temp.status(current_setting('test.conv')), 'request', 'For the recipient it''s a message request');
select is((select unread from my_conversations() where conversation_id = current_setting('test.conv')::uuid), 3, 'The request shows its unread messages');
select is((select count(*)::int from dating_messages where conversation_id = current_setting('test.conv')::uuid), 3,
  'The recipient can read the request before answering');
select ok(position('Bayo' in (select row_to_json(c)::text from my_conversations() c where conversation_id = current_setting('test.conv')::uuid)) = 0,
  'A request never shows the sender''s name');

-- Replying doesn't silently accept: Ama has to accept first
select throws_ok($$ insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'hey you!') $$,
  '42501', null, 'The recipient can''t reply before accepting');
select pg_temp.login('00000000-0000-0000-0000-0000000000b3');
select throws_ok($$ select accept_message_request(current_setting('test.conv')::uuid) $$, 'P0002', null, 'Only the recipient can accept');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$ select accept_message_request(current_setting('test.conv')::uuid) $$, 'The recipient can accept');
insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'hey you!');
select is(pg_temp.status(current_setting('test.conv')), 'chat', 'Accepting moves it to the recipient''s chats');
select is((select matched from my_conversations() where conversation_id = current_setting('test.conv')::uuid), false, 'An accepted request is not a match');
select pg_temp.login('00000000-0000-0000-0000-0000000000b3');
select is(pg_temp.status(current_setting('test.conv')), 'chat', '…and to the sender''s chats');
select lives_ok($$ insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'yay') $$,
  'After a reply there''s no message limit');

-- Chi messages Ama, Ama declines
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select set_config('test.conv2', start_conversation(current_setting('test.ha'))::text, true);
insert into dating_messages (conversation_id, body) values (current_setting('test.conv2')::uuid, 'hey');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select lives_ok($$ select decline_message_request(current_setting('test.conv2')::uuid) $$, 'The recipient can decline a request');
select ok(not exists (select 1 from my_conversations() where conversation_id = current_setting('test.conv2')::uuid),
  'A declined request disappears for the recipient');
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$ insert into dating_messages (conversation_id, body) values (current_setting('test.conv2')::uuid, 'why?') $$,
  '42501', null, 'After a decline the sender can''t send more');
select throws_ok($$ select decline_message_request(current_setting('test.conv2')::uuid) $$, 'P0002', null,
  'Only the recipient can decline');

-- Messaging someone who already liked you opens a normal chat
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select like_profile(current_setting('test.hd'), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000d3');
select set_config('test.conv3', start_conversation(current_setting('test.ha'))::text, true);
select is(pg_temp.status(current_setting('test.conv3')), 'chat', 'Messaging someone who liked you is an accepted chat');

-- Likes still work alongside requests
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select like_profile(current_setting('test.hb'), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000b3');
select is((select matched from like_profile(current_setting('test.hc'), true)), true,
  'Liking each other is a match');

select * from finish();
rollback;
