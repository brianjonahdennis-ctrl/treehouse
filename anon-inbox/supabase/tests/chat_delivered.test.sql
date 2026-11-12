-- Message status: Delivered once the other person opens treehouse after your message, Seen once they read it.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(5);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000aa', 'aa@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000bb', 'bb@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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
create function pg_temp.mine() returns record language sql as $$
  select (other_delivered_at, other_read_at) from my_conversations() where conversation_id = current_setting('test.conv')::uuid
$$;

select pg_temp.login('00000000-0000-0000-0000-0000000000aa');
select create_my_profile('Ada Quiet', 'female', 26, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000bb');
select create_my_profile('Bola Quiet', 'male', 28, 'Lagos', 'love');
select pg_temp.admin();
select set_config('test.ha', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000aa'), true);
select set_config('test.hb', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000bb'), true);
-- Bola was last in the app an hour ago.
update dating_profiles set last_seen_at = now() - interval '1 hour' where user_id = '00000000-0000-0000-0000-0000000000bb';

-- Ada and Bola match, then Ada sends a message.
select pg_temp.login('00000000-0000-0000-0000-0000000000bb');
select like_profile(current_setting('test.ha'), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000aa');
select set_config('test.conv', (select conversation_id::text from like_profile(current_setting('test.hb'), true)), true);
insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'hey Bola');
select pg_temp.admin();
update dating_messages set created_at = now() - interval '10 minutes' where conversation_id = current_setting('test.conv')::uuid;

select pg_temp.login('00000000-0000-0000-0000-0000000000aa');
select is((select other_delivered_at from my_conversations() where conversation_id = current_setting('test.conv')::uuid), null,
  'Not delivered while they haven''t opened treehouse since');

-- Bola opens the app (but not the chat): delivered, not seen.
select pg_temp.admin();
update dating_profiles set last_seen_at = now() where user_id = '00000000-0000-0000-0000-0000000000bb';
select pg_temp.login('00000000-0000-0000-0000-0000000000aa');
select ok((select other_delivered_at is not null from my_conversations() where conversation_id = current_setting('test.conv')::uuid),
  'Delivered once they open treehouse');
select ok((select other_delivered_at < now() - interval '5 minutes' from my_conversations() where conversation_id = current_setting('test.conv')::uuid),
  'The delivered time is your message''s time, not when they were online');
select is((select other_read_at from my_conversations() where conversation_id = current_setting('test.conv')::uuid), null,
  'Not seen until they open the chat');

-- Bola opens the chat: seen.
select pg_temp.login('00000000-0000-0000-0000-0000000000bb');
select mark_conversation_read(current_setting('test.conv')::uuid);
select pg_temp.login('00000000-0000-0000-0000-0000000000aa');
select ok((select other_read_at is not null from my_conversations() where conversation_id = current_setting('test.conv')::uuid),
  'Seen once they open the chat');

select * from finish();
rollback;
