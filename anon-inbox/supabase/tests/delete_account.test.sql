-- "Delete my account" removes the person, their chats and messages, keeps working when others replied
-- to them, and is counted (without saying who) for the owner's stats.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'da1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', 'da2@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select create_my_profile('Ada Delete', 'female', 26, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select create_my_profile('Bola Delete', 'male', 28, 'Lagos', 'love');
select pg_temp.admin();
select set_config('test.ha', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000b1'), true);
select set_config('test.hb', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000b2'), true);

-- A match with messages (a few: the spam limit stops bursts) and a reply to Ada's message.
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select like_profile(current_setting('test.ha'), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select set_config('test.conv', (select conversation_id::text from like_profile(current_setting('test.hb'), true)), true);
select pg_temp.admin();
insert into dating_messages (conversation_id, sender_id, body) select current_setting('test.conv')::uuid, '00000000-0000-0000-0000-0000000000b1', 'hello ' || g from generate_series(1, 5) g;
insert into dating_messages (conversation_id, sender_id, body, reply_to)
  select current_setting('test.conv')::uuid, '00000000-0000-0000-0000-0000000000b2', 'reply', (select min(id) from dating_messages where conversation_id = current_setting('test.conv')::uuid);
select set_config('test.before', (select count(*)::text from dating_private.account_deletions), true);

select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select lives_ok($$select delete_my_account()$$, 'Ada deletes her account');

select pg_temp.admin();
select is((select count(*)::int from auth.users where id = '00000000-0000-0000-0000-0000000000b1'), 0, 'Her login is gone');
select is((select count(*)::int from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000b1'), 0, 'Her profile is gone');
select is((select count(*)::int from dating_conversations where id = current_setting('test.conv')::uuid), 0, 'Her chats (and their messages) are gone');
select is((select count(*)::int from dating_private.account_deletions), current_setting('test.before')::int + 1, 'The deletion is counted');
select is((select had_profile from dating_private.account_deletions order by at desc limit 1), true, 'It records only that she had a dating profile');

select * from finish();
rollback;
