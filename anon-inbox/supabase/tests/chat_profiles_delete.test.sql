-- Seeing the profile of people you chat with, and deleting a chat for yourself only.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a8', 'a8@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b8', 'b8@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c8', 'c8@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

select pg_temp.login('00000000-0000-0000-0000-0000000000a8');
select create_my_profile('Ama Secret', 'female', 25, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000b8');
select create_my_profile('Bayo Secret', 'male', 27, 'Abuja', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000c8');
select create_my_profile('Chi Secret', 'male', 30, 'Enugu', 'fun');
select pg_temp.admin();
update dating_profiles set bio = 'I love jollof', interests = '{music,food}' where user_id = '00000000-0000-0000-0000-0000000000b8';
select set_config('test.ha', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000a8'), true);
select set_config('test.hb', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000b8'), true);

-- Bayo sends Ama a message request.
select pg_temp.login('00000000-0000-0000-0000-0000000000b8');
select set_config('test.conv', start_conversation(current_setting('test.ha'))::text, true);
insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'hi Ama');

-- Ama can see who sent it.
select pg_temp.login('00000000-0000-0000-0000-0000000000a8');
select is((select handle from chat_partner_profile(current_setting('test.conv')::uuid)), current_setting('test.hb'), 'You can see the profile of someone who sent you a request');
select is((select bio from chat_partner_profile(current_setting('test.conv')::uuid)), 'I love jollof', 'Their bio is included');
select is((select array_length(interests, 1) from chat_partner_profile(current_setting('test.conv')::uuid)), 2, 'Their interests are included');
select is((select count(*)::int from chat_partner_profile(current_setting('test.conv')::uuid) p where to_jsonb(p) ? 'name'), 0, 'Their real name is never included');

-- Someone outside the chat can't use it to look people up.
select pg_temp.login('00000000-0000-0000-0000-0000000000c8');
select is((select count(*)::int from chat_partner_profile(current_setting('test.conv')::uuid)), 0, 'People outside the chat see nothing');

-- Ama accepts and replies, then deletes the chat.
select pg_temp.login('00000000-0000-0000-0000-0000000000a8');
select accept_message_request(current_setting('test.conv')::uuid);
insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'hello Bayo');
select pg_temp.admin();
update dating_messages set created_at = now() - interval '10 minutes' where conversation_id = current_setting('test.conv')::uuid;
select pg_temp.login('00000000-0000-0000-0000-0000000000a8');
select delete_conversation(current_setting('test.conv')::uuid);
select pg_temp.admin();
update dating_cleared set cleared_at = now() - interval '5 minutes' where conversation_id = current_setting('test.conv')::uuid;

select pg_temp.login('00000000-0000-0000-0000-0000000000a8');
select is((select count(*)::int from my_conversations() where conversation_id = current_setting('test.conv')::uuid), 0, 'A deleted chat leaves your Inbox');
select is((select count(*)::int from dating_messages where conversation_id = current_setting('test.conv')::uuid), 0, 'Its old messages are gone for you');

select pg_temp.login('00000000-0000-0000-0000-0000000000b8');
select is((select count(*)::int from dating_messages where conversation_id = current_setting('test.conv')::uuid), 2, 'The other person keeps their copy');
select is((select count(*)::int from my_conversations() where conversation_id = current_setting('test.conv')::uuid), 1, 'And still has the chat');

-- Bayo messages again: the chat comes back for Ama, with only the new message.
insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'are you there?');
select pg_temp.login('00000000-0000-0000-0000-0000000000a8');
select is((select last_message from my_conversations() where conversation_id = current_setting('test.conv')::uuid), 'are you there?', 'A new message brings the chat back');
select is((select count(*)::int from dating_messages where conversation_id = current_setting('test.conv')::uuid), 1, 'Only the new message shows');

select pg_temp.login('00000000-0000-0000-0000-0000000000c8');
select throws_ok(format('select delete_conversation(%L::uuid)', current_setting('test.conv')), 'P0002', null, 'You can''t delete someone else''s chat');

select * from finish();
rollback;
