-- Photos in private chats: locked until 50 messages (10+ from each person) in an accepted chat;
-- only the two people can upload to / open the chat's folder; a photo message needs your own upload.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'ph1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000f2', 'ph2@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000f3', 'ph3@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select create_my_profile('Ada Photo', 'female', 26, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select create_my_profile('Bola Photo', 'male', 28, 'Lagos', 'love');
select pg_temp.admin();
select set_config('test.ha', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000f1'), true);
select set_config('test.hb', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000f2'), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select like_profile(current_setting('test.ha'), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select set_config('test.conv', (select conversation_id::text from like_profile(current_setting('test.hb'), true)), true);
select set_config('test.p1', current_setting('test.conv') || '/11111111-1111-4111-8111-111111111111.jpg', true);
select set_config('test.p2', current_setting('test.conv') || '/22222222-2222-4222-8222-222222222222.jpg', true);

-- A new match: locked.
select ok(not photos_unlocked(current_setting('test.conv')::uuid), 'A new match can''t send photos yet');
select throws_ok(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('chat-photos', %L, auth.uid()::text) $$, current_setting('test.p1')),
  '42501', null, 'Uploading is refused while photos are locked');

-- 50 messages, but only 5 from Bola: still locked (one person can't unlock it alone).
select pg_temp.admin();
update dating_conversations set accepted_at = coalesce(accepted_at, now()) where id = current_setting('test.conv')::uuid;
insert into dating_messages (conversation_id, sender_id, body, created_at)
  select current_setting('test.conv')::uuid, '00000000-0000-0000-0000-0000000000f1', 'hi ' || g, now() - interval '2 hours' + g * interval '1 second' from generate_series(1, 45) g;
insert into dating_messages (conversation_id, sender_id, body, created_at)
  select current_setting('test.conv')::uuid, '00000000-0000-0000-0000-0000000000f2', 'hey ' || g, now() - interval '1 hour' + g * interval '1 second' from generate_series(1, 5) g;
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select ok(not photos_unlocked(current_setting('test.conv')::uuid), '50 messages mostly from one person don''t unlock photos');

-- 5 more from Bola: 55 in all, 10+ each: unlocked.
select pg_temp.admin();
insert into dating_messages (conversation_id, sender_id, body, created_at)
  select current_setting('test.conv')::uuid, '00000000-0000-0000-0000-0000000000f2', 'yo ' || g, now() - interval '30 minutes' + g * interval '1 second' from generate_series(1, 5) g;
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select ok(photos_unlocked(current_setting('test.conv')::uuid), 'After a real conversation, photos unlock');

-- Upload and send.
select lives_ok(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('chat-photos', %L, auth.uid()::text) $$, current_setting('test.p1')),
  'Ada can upload into the chat''s folder');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id) values ('chat-photos', 'not-a-chat/x.jpg', auth.uid()::text) $$,
  '42501', null, 'Bad file names are refused');
select lives_ok(format($$ insert into dating_messages (conversation_id, body, photo, photo_w, photo_h) values (%L, 'x', %L, 800, 600) $$,
  current_setting('test.conv'), current_setting('test.p1')), 'Ada can send her uploaded photo');
select is((select body from dating_messages where photo = current_setting('test.p1')), '📷 Photo', 'Photo messages read "📷 Photo" in lists');
select throws_ok(format($$ select edit_dating_message((select id from dating_messages where photo = %L), 'changed') $$, current_setting('test.p1')),
  '22023', null, 'Photo messages can''t be edited');

-- Bola can open it; an outsider can't.
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select is((select count(*)::int from storage.objects where bucket_id = 'chat-photos' and name = current_setting('test.p1')), 1, 'The other person in the chat can open the photo');
select throws_ok(format($$ insert into dating_messages (conversation_id, body, photo, photo_w, photo_h) values (%L, 'x', %L, 800, 600) $$,
  current_setting('test.conv'), current_setting('test.p2')), '22023', null, 'You can''t send a photo you didn''t upload');
select pg_temp.login('00000000-0000-0000-0000-0000000000f3');
select is((select count(*)::int from storage.objects where bucket_id = 'chat-photos' and name = current_setting('test.p1')), 0, 'Outsiders can''t open chat photos');
select ok(not photos_unlocked(current_setting('test.conv')::uuid), 'Outsiders are told photos are locked');
select throws_ok(format($$ insert into storage.objects (bucket_id, name, owner_id) values ('chat-photos', %L, auth.uid()::text) $$, current_setting('test.p2')),
  '42501', null, 'Outsiders can''t upload into someone else''s chat');

-- Unsending a photo hides it and marks the file for removal.
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select lives_ok(format($$ select unsend_dating_message((select id from dating_messages where photo = %L)) $$, current_setting('test.p1')),
  'Photo messages can be unsent');
select pg_temp.admin();
select ok(dating_private.photo_gone(current_setting('test.p1'), now()), 'An unsent photo''s file is due for removal');

select * from finish();
rollback;
