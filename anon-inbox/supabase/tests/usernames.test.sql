-- Usernames, add friend by username, and invite links that use the username. Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(30);

create function pg_temp.login(uid text, aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
end $$;
create function pg_temp.admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- a, b, c: members. d: brand-new member (can be credited for an invite). s: staff admin.
insert into auth.users (id, email, created_at)
select ('00000000-0000-0000-0000-0000000e' || lpad(n::text, 4, '0'))::uuid, 'un' || n || '@test.invalid',
       case when n = 4 then now() else now() - interval '60 days' end
from generate_series(1, 5) n;
insert into dating_profiles (user_id, name, gender, age, intent, handle, state, last_seen_at) values
  ('00000000-0000-0000-0000-0000000e0001', 'Ada', 'female', 30, 'love', 'untest_a', 'Lagos', now()),
  ('00000000-0000-0000-0000-0000000e0002', 'Bayo', 'male', 30, 'love', 'untest_b', 'Lagos', now()),
  ('00000000-0000-0000-0000-0000000e0003', 'Chi', 'female', 30, 'love', 'untest_c', 'Lagos', now()),
  ('00000000-0000-0000-0000-0000000e0004', 'Dayo', 'male', 25, 'fun', 'untest_d', 'Oyo', now()),
  ('00000000-0000-0000-0000-0000000e0005', 'Sade', 'female', 30, 'love', 'untest_s', 'Lagos', now());
insert into announcement_staff (user_id, role) values ('00000000-0000-0000-0000-0000000e0005', 'admin');

-- ---- Rules ----------------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000e0001');
select is(check_username('ab') ->> 'reason', 'format', 'too short');
select is(check_username('abcdefghijklmno') ->> 'reason', 'format', 'more than 14 characters');
select is(check_username('ada_2026') ->> 'reason', 'format', 'only letters and numbers');
select is(check_username('20262026') ->> 'reason', 'format', 'needs at least one letter');
select is(check_username('MyTreehouse') ->> 'reason', 'reserved', 'treehouse-sounding names are reserved');
select is((check_username('  Ada2026 ') ->> 'ok')::boolean, true, 'letters and numbers, 14 or fewer, are fine (case and spaces ignored)');
select is((check_username('Adaeze') ->> 'ok')::boolean, true, 'letters only are fine');

-- ---- Invite link needs a username -----------------------------------------------------------------
select is((my_referral() ->> 'needs_username')::boolean, true, 'no username yet: no invite link');
select is(my_referral() ->> 'code', null, 'no code until a username is chosen');
select is(my_username(), null, 'no username yet');
select is(set_username(' Ada2026 ') ->> 'username', 'ada2026', 'username saved in lower case');
select is((my_username() ->> 'can_change')::boolean, false, 'can''t change straight away');
select is(my_referral() ->> 'code', 'ada2026', 'the invite code is the username');
select throws_ok($$ select set_username('adaobi') $$, 'P0001', null, 'changing again within a year is refused');

select pg_temp.login('00000000-0000-0000-0000-0000000e0002');
select throws_ok($$ select set_username('ADA2026') $$, '23505', 'That username is taken. Try another.', 'usernames are unique (any case)');
select is((check_username('ada2026') ->> 'reason'), 'taken', 'the live check says taken');

-- A new member joins with Ada's link.
select pg_temp.login('00000000-0000-0000-0000-0000000e0004');
select is(claim_referral('Ada2026'), true, 'a new member is credited with the username link');

-- A year later Ada changes her username: the link follows, the old one is held for 30 days.
select pg_temp.admin();
update dating_private.usernames set set_at = now() - interval '366 days' where user_id = '00000000-0000-0000-0000-0000000e0001';
select pg_temp.login('00000000-0000-0000-0000-0000000e0001');
select is(set_username('AdaObi') ->> 'username', 'adaobi', 'after a year the username can change');
select is((my_referral() ->> 'joined')::int, 1, 'invites already credited move to the new link');
select pg_temp.login('00000000-0000-0000-0000-0000000e0002');
select is((check_username('ada2026') ->> 'reason'), 'taken', 'the old username is held for 30 days');

-- ---- Add friend by username -------------------------------------------------------------------------
select throws_ok($$ select add_friend_by_username('nobodyhere1') $$, 'P0002', 'No one on treehouse has that username.', 'unknown username');
select is(add_friend_by_username('@AdaObi') ->> 'status', 'sent', 'friend request sent by username (with @, any case)');
select is((select kind || ':' || (started_by = '00000000-0000-0000-0000-0000000e0002')::text from dating_conversations
           where id = (add_friend_by_username('adaobi') ->> 'conversation_id')::uuid), 'friend:true', 'it is a normal friend request (asking twice keeps one chat)');
select pg_temp.login('00000000-0000-0000-0000-0000000e0001');
select throws_ok($$ select add_friend_by_username('adaobi') $$, '22023', 'That’s your own username.', 'can''t add yourself');

-- Blocked people get the same answer as an unknown username.
select pg_temp.admin();
insert into dating_blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000e0001', '00000000-0000-0000-0000-0000000e0003');
select pg_temp.login('00000000-0000-0000-0000-0000000e0003');
select throws_ok($$ select add_friend_by_username('adaobi') $$, 'P0002', 'No one on treehouse has that username.', 'blocked: looks like an unknown username');

-- ---- Usernames only show after both reveal --------------------------------------------------------
select pg_temp.admin();
update dating_conversations set accepted_at = now()
where user_a = least('00000000-0000-0000-0000-0000000e0001'::uuid, '00000000-0000-0000-0000-0000000e0002'::uuid)
  and user_b = greatest('00000000-0000-0000-0000-0000000e0001'::uuid, '00000000-0000-0000-0000-0000000e0002'::uuid);
select set_config('test.conv', (select id::text from dating_conversations
  where user_a = least('00000000-0000-0000-0000-0000000e0001'::uuid, '00000000-0000-0000-0000-0000000e0002'::uuid)
    and user_b = greatest('00000000-0000-0000-0000-0000000e0001'::uuid, '00000000-0000-0000-0000-0000000e0002'::uuid)), true);
select pg_temp.login('00000000-0000-0000-0000-0000000e0002');
select is((select count(*)::int from revealed_details(current_setting('test.conv')::uuid)), 0, 'no username before revealing');
select pg_temp.admin();
insert into dating_reveals (conversation_id, user_id) values
  (current_setting('test.conv')::uuid, '00000000-0000-0000-0000-0000000e0001'), (current_setting('test.conv')::uuid, '00000000-0000-0000-0000-0000000e0002');
select pg_temp.login('00000000-0000-0000-0000-0000000e0002');
select is((select username from revealed_details(current_setting('test.conv')::uuid)), 'adaobi', 'after both reveal, the username shows');

-- ---- Limits and staff -------------------------------------------------------------------------------
select pg_temp.admin();
insert into dating_private.username_lookups (user_id) select '00000000-0000-0000-0000-0000000e0003' from generate_series(1, 30);
select pg_temp.login('00000000-0000-0000-0000-0000000e0003');
select throws_ok($$ select add_friend_by_username('adaobi') $$, 'P0001', 'Too many tries. Please wait a while and try again.', '30 tries an hour');
select pg_temp.login('00000000-0000-0000-0000-0000000e0005', 'aal2');
select throws_ok($$ select staff_referral_campaign('adaobi', 'Flyers', '') $$, '23505', 'A member already uses that code.', 'campaign codes can''t take a username');
select pg_temp.admin();
set local role anon;
select throws_ok($$ select set_username('someone') $$, '42501', null, 'signed-out visitors can''t set usernames');

select set_config('role', 'postgres', true);
select * from finish();
rollback;
