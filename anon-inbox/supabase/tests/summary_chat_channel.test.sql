-- dating_summary() returns chats, likes and pending count in one call; private chat channels are
-- only open to the chat's two participants; messages still send with the broadcast trigger.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'se1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000e2', 'se2@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000e3', 'se3@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select create_my_profile('Ada Sum', 'female', 26, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select create_my_profile('Bola Sum', 'male', 28, 'Lagos', 'love');
select pg_temp.admin();
select set_config('test.ha', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000e1'), true);
select set_config('test.hb', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000e2'), true);

select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select like_profile(current_setting('test.ha'), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select is((select (dating_summary() ->> 'pending')::int), my_pending_likes(), 'The summary includes the pending-likes count');
select is((select jsonb_array_length(dating_summary() -> 'requests')), (select count(*)::int from incoming_requests()), 'The summary includes incoming likes');
select set_config('test.conv', (select conversation_id::text from like_profile(current_setting('test.hb'), true)), true);
select is((select jsonb_array_length(dating_summary() -> 'convos')), (select count(*)::int from my_conversations()), 'The summary includes your chats');

-- Private chat channel: participants only.
select ok(chat_can_listen('chat:' || current_setting('test.conv')), 'You can listen to your own chat''s channel');
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select ok(not chat_can_listen('chat:' || current_setting('test.conv')), 'Outsiders can''t listen to it');
select ok(not chat_can_listen('chat:not-a-uuid'), 'Bad channel names are refused');

-- Sending still works with the broadcast trigger in place.
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select lives_ok(format($$ insert into dating_messages (conversation_id, body) values (%L, 'hi Bola') $$, current_setting('test.conv')), 'Messages send and broadcast');

select * from finish();
rollback;
