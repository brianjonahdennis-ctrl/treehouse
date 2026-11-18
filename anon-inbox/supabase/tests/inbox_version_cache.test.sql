-- Inbox version counters change only for members whose cached list can change.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(44);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'iv-a@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b1', 'iv-b@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c1', 'iv-c@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000d1', 'iv-d@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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
create function pg_temp.inbox_v(uid text) returns bigint language sql as $$
  select coalesce((select v from dating_private.inbox_version where user_id = uid::uuid), 0)
$$;

select ok((select relrowsecurity from pg_class where oid = 'dating_private.inbox_version'::regclass), 'counter table has row-level security');
select is(has_table_privilege('authenticated', 'dating_private.inbox_version', 'select'), false, 'members cannot read the private counter table');
select is(has_function_privilege('authenticated', 'public.dating_summary_changes_v2(jsonb,text,bigint)', 'execute'), true, 'members can call v2');
select is(has_function_privilege('anon', 'public.dating_summary_changes_v2(jsonb,text,bigint)', 'execute'), false, 'signed-out visitors cannot call v2');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select create_my_profile('Inbox A', 'female', (current_date - interval '26 years 1 month')::date, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select create_my_profile('Inbox B', 'male', (current_date - interval '28 years 1 month')::date, 'Lagos', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select create_my_profile('Inbox C', 'female', (current_date - interval '27 years 1 month')::date, 'Abuja', 'love');
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select create_my_profile('Inbox D', 'male', (current_date - interval '30 years 1 month')::date, 'Abuja', 'love');

select pg_temp.admin();
select set_config('test.a0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1')::text, true);
select set_config('test.b0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1')::text, true);
insert into dating_conversations (id, user_a, user_b, started_by)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1') > current_setting('test.a0')::bigint, 'creating a conversation bumps member A');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1') > current_setting('test.b0')::bigint, 'creating a conversation bumps member B');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select set_config('test.version', (dating_summary_changes_v2('{}'::jsonb, '', null)->>'version'), true);
select is((dating_summary_changes_v2('{}'::jsonb, '', null)->>'unchanged')::boolean, false, 'a first fetch rebuilds the inbox');
select ok(current_setting('test.version')::bigint >= 1, 'full response includes the current version');
select is(jsonb_typeof(dating_summary_changes_v2('{}'::jsonb, '', null)->'friend_asks'), 'array', 'full response includes friend requests for caching');
select is((dating_summary_changes_v2('{}'::jsonb, '', current_setting('test.version')::bigint)->>'unchanged')::boolean, true, 'same version returns unchanged immediately');
select is(jsonb_typeof(dating_summary_changes('{}'::jsonb, '')->'changed'), 'array', 'the original function remains available to older apps');

select pg_temp.admin();
select set_config('test.c0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000c1')::text, true);
select set_config('test.d0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000d1')::text, true);
select set_config('test.a1', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1')::text, true);
insert into dating_conversations (id, user_a, user_b, started_by)
values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000c1') > current_setting('test.c0')::bigint, 'new conversation bumps its first member');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000d1') > current_setting('test.d0')::bigint, 'new conversation bumps its second member');
select is(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1'), current_setting('test.a1')::bigint, 'unrelated member is not bumped by another conversation');

select set_config('test.a0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1')::text, true);
select set_config('test.b0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1')::text, true);
select set_config('test.c0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000c1')::text, true);
insert into dating_messages (conversation_id, sender_id, body)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'hello');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1') > current_setting('test.a0')::bigint, 'message bumps the recipient');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1') > current_setting('test.b0')::bigint, 'message bumps the sender');
select is(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000c1'), current_setting('test.c0')::bigint, 'message does not bump a third member');

select set_config('test.c0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000c1')::text, true);
select set_config('test.d0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000d1')::text, true);
select set_config('test.a0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1')::text, true);
insert into dating_messages (conversation_id, sender_id, body)
values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000c1', 'unrelated chat');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000c1') > current_setting('test.c0')::bigint, 'another member’s message bumps its sender');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000d1') > current_setting('test.d0')::bigint, 'another member’s message bumps its recipient');
select is(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1'), current_setting('test.a0')::bigint, 'a third person’s message does not bump an unrelated member');

select set_config('test.a0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1')::text, true);
select set_config('test.b0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1')::text, true);
insert into dating_reads (conversation_id, user_id, last_read_at)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', now());
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1') > current_setting('test.a0')::bigint, 'new read receipt bumps its owner');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1') > current_setting('test.b0')::bigint, 'new read receipt bumps the other member');
select set_config('test.a0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1')::text, true);
select set_config('test.b0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1')::text, true);
update dating_reads set last_read_at = last_read_at + interval '1 second'
where conversation_id = '10000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-0000000000a1';
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1') > current_setting('test.a0')::bigint, 'read receipt updates bump its owner');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1') > current_setting('test.b0')::bigint, 'read receipt updates bump the other member');

select set_config('test.a0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1')::text, true);
select set_config('test.c0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000c1')::text, true);
insert into dating_likes (from_user, to_user, liked)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', true);
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1') > current_setting('test.a0')::bigint, 'new request bumps the recipient');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000c1') > current_setting('test.c0')::bigint, 'new like bumps its sender');
select set_config('test.a0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1')::text, true);
select set_config('test.c0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000c1')::text, true);
update dating_profiles set bio = 'A newer short bio' where user_id = '00000000-0000-0000-0000-0000000000c1';
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1') > current_setting('test.a0')::bigint, 'profile changes bump people with a pending request');
select is(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000c1'), current_setting('test.c0')::bigint, 'profile changes do not bump the profile owner');

select set_config('test.a0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1')::text, true);
select set_config('test.b0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1')::text, true);
update dating_conversations set accepted_at = now(), kind = 'friend'
where id = '10000000-0000-0000-0000-000000000001';
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1') > current_setting('test.a0')::bigint, 'accepting a conversation bumps member A');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1') > current_setting('test.b0')::bigint, 'accepting a conversation bumps member B');

select set_config('test.a0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1')::text, true);
select set_config('test.b0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1')::text, true);
insert into dating_statuses (user_id, body) values ('00000000-0000-0000-0000-0000000000a1', 'Here today');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1') > current_setting('test.a0')::bigint, 'posting a status bumps its owner');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1') > current_setting('test.b0')::bigint, 'posting a status bumps accepted friends');
select set_config('test.a0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1')::text, true);
select set_config('test.b0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1')::text, true);
update dating_statuses set body = 'Still here' where user_id = '00000000-0000-0000-0000-0000000000a1';
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1') > current_setting('test.a0')::bigint, 'editing a status bumps its owner');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1') > current_setting('test.b0')::bigint, 'editing a status bumps accepted friends');
select set_config('test.a0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1')::text, true);
select set_config('test.b0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1')::text, true);
delete from dating_statuses where user_id = '00000000-0000-0000-0000-0000000000a1';
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1') > current_setting('test.a0')::bigint, 'clearing a status bumps its owner');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1') > current_setting('test.b0')::bigint, 'clearing a status bumps accepted friends');

select set_config('test.a0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1')::text, true);
select set_config('test.b0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1')::text, true);
insert into dating_cleared (conversation_id, user_id)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1') > current_setting('test.a0')::bigint, 'hiding a conversation bumps the member who hid it');
select is(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1'), current_setting('test.b0')::bigint, 'hiding a conversation does not bump the other member');

select set_config('test.a0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1')::text, true);
select set_config('test.b0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1')::text, true);
update dating_profiles set last_seen_at = now() + interval '1 second' where user_id = '00000000-0000-0000-0000-0000000000b1';
select is(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1'), current_setting('test.a0')::bigint, 'presence updates do not invalidate the inbox');
select is(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1'), current_setting('test.b0')::bigint, 'presence updates do not bump the profile owner');

select set_config('test.a0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1')::text, true);
select set_config('test.b0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1')::text, true);
insert into dating_blocks (blocker_id, blocked_id)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1') > current_setting('test.a0')::bigint, 'blocking bumps the blocker');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1') > current_setting('test.b0')::bigint, 'blocking bumps the blocked member');

select set_config('test.a0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1')::text, true);
select set_config('test.b0', pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1')::text, true);
delete from dating_conversations where id = '10000000-0000-0000-0000-000000000001';
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000a1') > current_setting('test.a0')::bigint, 'deleting a conversation bumps member A');
select ok(pg_temp.inbox_v('00000000-0000-0000-0000-0000000000b1') > current_setting('test.b0')::bigint, 'deleting a conversation bumps member B');

select * from finish();
rollback;
