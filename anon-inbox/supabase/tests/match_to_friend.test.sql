-- Matches become friends only when both agree; outsiders can't ask or peek; blocks stop it.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'mf1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000f2', 'mf2@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000f3', 'mf3@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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
select create_my_profile('Ada Friend', 'female', 26, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select create_my_profile('Bola Friend', 'male', 28, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000f3');
select create_my_profile('Chi Friend', 'male', 30, 'Lagos', 'love');
select pg_temp.admin();
select set_config('test.ha', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000f1'), true);
select set_config('test.hb', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000f2'), true);

-- A match: Bola likes Ada, Ada likes back.
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select like_profile(current_setting('test.ha'), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select set_config('test.conv', (select conversation_id::text from like_profile(current_setting('test.hb'), true)), true);

select is(ask_friend(current_setting('test.conv')::uuid), 'asked', 'Ada asks Bola to be friends');
select is(friend_ask_state(current_setting('test.conv')::uuid), 'mine', 'Ada sees her own request');
select is((select who from my_friend_asks() where conversation_id = current_setting('test.conv')::uuid), 'mine', 'It shows in Ada''s pending list as sent');

select pg_temp.login('00000000-0000-0000-0000-0000000000f3');
select throws_ok(format('select ask_friend(%L::uuid)', current_setting('test.conv')), 'P0002', null, 'Someone outside the chat cannot ask');
select is(friend_ask_state(current_setting('test.conv')::uuid), null, 'Someone outside the chat sees nothing');

select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select is(friend_ask_state(current_setting('test.conv')::uuid), 'theirs', 'Bola sees Ada asked');
select is((select who from my_friend_asks() where conversation_id = current_setting('test.conv')::uuid), 'theirs', 'It shows in Bola''s requests to accept');
select is(ask_friend(current_setting('test.conv')::uuid, false), 'none', 'Bola can decline it');
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select ask_friend(current_setting('test.conv')::uuid);
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select is(ask_friend(current_setting('test.conv')::uuid), 'friends', 'Bola accepts: they are friends');
select pg_temp.admin();
select is((select kind from dating_conversations where id = current_setting('test.conv')::uuid), 'friend', 'The chat is now a friend chat');

-- Taking back: a fresh ask, withdrawn, leaves nothing pending.
update dating_conversations set kind = 'dating', friend_ask_by = null where id = current_setting('test.conv')::uuid;
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select ask_friend(current_setting('test.conv')::uuid);
select is(ask_friend(current_setting('test.conv')::uuid, false), 'none', 'Ada takes her request back');

-- Blocked: no friend requests.
select pg_temp.admin();
insert into dating_blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1');
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select throws_ok(format('select ask_friend(%L::uuid)', current_setting('test.conv')), 'P0002', null, 'No friend requests once blocked');

select * from finish();
rollback;
