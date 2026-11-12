-- Private chats: reply, edit (15 minutes), unsend for everyone, delete for me.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(13);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000ac', 'ac2@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000bc', 'bc2@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000cc', 'cc2@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

select pg_temp.login('00000000-0000-0000-0000-0000000000ac');
select create_my_profile('Ama Edit', 'female', 25, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000bc');
select create_my_profile('Bayo Edit', 'male', 27, 'Lagos', 'love');
select pg_temp.admin();
select set_config('test.ha', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000ac'), true);
select set_config('test.hb', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000bc'), true);

-- Match, then chat.
select pg_temp.login('00000000-0000-0000-0000-0000000000bc');
select like_profile(current_setting('test.ha'), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000ac');
select set_config('test.conv', (select conversation_id::text from like_profile(current_setting('test.hb'), true)), true);
insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'Fancy suya on Friday?');
select pg_temp.admin();
select set_config('test.m1', (select id::text from dating_messages where body = 'Fancy suya on Friday?'), true);

-- Bayo replies to it.
select pg_temp.login('00000000-0000-0000-0000-0000000000bc');
select lives_ok(format($$ insert into dating_messages (conversation_id, body, reply_to) values (%L, 'Yes please!', %s) $$,
  current_setting('test.conv'), current_setting('test.m1')), 'You can reply to a message in the chat');
select is((select reply_to::text from dating_messages where body = 'Yes please!'), current_setting('test.m1'), 'The reply points at the original');

-- Ama edits her message.
select pg_temp.login('00000000-0000-0000-0000-0000000000ac');
select lives_ok(format('select edit_dating_message(%s, %L)', current_setting('test.m1'), 'Fancy suya on Saturday?'), 'You can edit your message');
select pg_temp.login('00000000-0000-0000-0000-0000000000bc');
select is((select body from dating_messages where id = current_setting('test.m1')::bigint), 'Fancy suya on Saturday?', 'The other person sees the edit');
select ok((select edited_at is not null from dating_messages where id = current_setting('test.m1')::bigint), 'It''s marked as edited');
select throws_ok(format('select edit_dating_message(%s, %L)', current_setting('test.m1'), 'hacked'), 'P0002', null, 'Nobody else can edit your message');

-- Too late to edit after 15 minutes.
select pg_temp.admin();
update dating_messages set created_at = now() - interval '20 minutes' where id = current_setting('test.m1')::bigint;
select pg_temp.login('00000000-0000-0000-0000-0000000000ac');
select throws_ok(format('select edit_dating_message(%s, %L)', current_setting('test.m1'), 'late'), 'P0001', null, 'Editing stops after 15 minutes');

-- Unsend for everyone.
select lives_ok(format('select unsend_dating_message(%s)', current_setting('test.m1')), 'You can unsend your message');
select pg_temp.login('00000000-0000-0000-0000-0000000000bc');
select is((select body from dating_messages where id = current_setting('test.m1')::bigint), 'This message was deleted', 'Unsent text is gone for the other person');
select pg_temp.admin();
select is((select body from dating_private.unsent_messages where message_id = current_setting('test.m1')::bigint), 'Fancy suya on Saturday?',
  'A private copy is kept for safety reviews');

-- Delete for me.
select pg_temp.login('00000000-0000-0000-0000-0000000000bc');
select hide_dating_message((select id from dating_messages where body = 'Yes please!'));
select is((select count(*)::int from dating_messages where body = 'Yes please!'), 0, 'Delete for me hides it for you');
select pg_temp.login('00000000-0000-0000-0000-0000000000ac');
select is((select count(*)::int from dating_messages where body = 'Yes please!'), 1, '…but not for the other person');

-- Outsiders can't hide or touch the chat.
select pg_temp.login('00000000-0000-0000-0000-0000000000cc');
select throws_ok(format('select hide_dating_message(%s)', current_setting('test.m1')), 'P0002', null, 'People outside the chat can''t touch its messages');

select * from finish();
rollback;
