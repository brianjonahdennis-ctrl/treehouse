-- Chat list, unread counts and starting chats.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(11);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'a1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', 'b1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c1', 'c1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', 'd1@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select create_my_profile('Amy Secret', 'female', 26, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select create_my_profile('Ben Secret', 'male', 28, 'Abuja', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select create_my_profile('Cy Secret', 'other', 33, 'Kano', 'fun');
select pg_temp.admin();
select set_config('test.ha', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000a1'), true);

-- Starting chats
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
-- (requests-only) the other person liked b1 first, so starting the chat accepts it
select pg_temp.admin();
insert into dating_likes (from_user, to_user, liked) select user_id, '00000000-0000-0000-0000-0000000000b1'::uuid, true from dating_profiles where handle = current_setting('test.ha') on conflict do nothing;
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select set_config('test.conv', start_conversation(current_setting('test.ha'))::text, true);
select is(start_conversation(current_setting('test.ha'))::text, current_setting('test.conv'),
  'Messaging the same person again reopens the same chat');
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$ select start_conversation(current_setting('test.ha')) $$, '28000', null,
  'You need a dating profile before you can message anyone');

-- Unread counts
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
insert into dating_messages (conversation_id, body) values
  (current_setting('test.conv')::uuid, 'hey there'), (current_setting('test.conv')::uuid, 'how are you?');
select is((select unread from my_conversations() where conversation_id = current_setting('test.conv')::uuid), 0,
  'Your own messages never count as unread');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select unread from my_conversations() where conversation_id = current_setting('test.conv')::uuid), 2,
  'The other person sees 2 unread messages');
select is((select last_from_me from my_conversations() where conversation_id = current_setting('test.conv')::uuid), false,
  'The chat list knows the last message came from them');
select lives_ok($$ select mark_conversation_read(current_setting('test.conv')::uuid) $$, 'Opening the chat marks it read');
select is((select unread from my_conversations() where conversation_id = current_setting('test.conv')::uuid), 0,
  'After reading, unread is 0');

select pg_temp.admin();
insert into dating_messages (conversation_id, sender_id, body, created_at)
  values (current_setting('test.conv')::uuid, '00000000-0000-0000-0000-0000000000b1', 'you there?', now() + interval '1 minute');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select unread from my_conversations() where conversation_id = current_setting('test.conv')::uuid), 1,
  'A newer message shows as 1 unread');

-- Outsiders
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select mark_conversation_read(current_setting('test.conv')::uuid) $$, 'P0002', null,
  'An outsider cannot touch someone else''s chat');
select is((select count(*)::int from dating_reads), 0, 'An outsider sees no read markers');

select pg_temp.admin();
select ok(pg_get_function_result('public.my_conversations()'::regprocedure) !~ '\mname\M',
  'The chat list never returns a name');

select * from finish();
rollback;
