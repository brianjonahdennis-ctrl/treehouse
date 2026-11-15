-- Staff console: find members by @username and see their username. Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

create function pg_temp.login(uid text, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
end $$;

insert into auth.users (id, email, created_at)
select ('00000000-0000-0000-0000-0000000f' || lpad(n::text, 4, '0'))::uuid, 'su' || n || '@test.invalid', now() - interval '60 days'
from generate_series(1, 3) n;
insert into dating_profiles (user_id, name, gender, age, intent, handle, state, last_seen_at) values
  ('00000000-0000-0000-0000-0000000f0001', 'Ada', 'female', 30, 'love', 'sutest_member', 'Lagos', now()),
  ('00000000-0000-0000-0000-0000000f0002', 'Mo', 'male', 30, 'love', 'sutest_mod', 'Lagos', now()),
  ('00000000-0000-0000-0000-0000000f0003', 'Ngo', 'female', 30, 'love', 'sutest_plain', 'Lagos', now());
insert into announcement_staff (user_id, role) values ('00000000-0000-0000-0000-0000000f0002', 'moderator');
insert into dating_private.usernames (user_id, username) values ('00000000-0000-0000-0000-0000000f0001', 'zqsearchada');

select pg_temp.login('00000000-0000-0000-0000-0000000f0002');
select is((select string_agg(e ->> 'handle', ',') from jsonb_array_elements(staff_members('@zqsearchada')) e), 'sutest_member', '@username finds the member');
select is((select string_agg(e ->> 'username', ',') from jsonb_array_elements(staff_members('@ZQSEARCH')) e), 'zqsearchada', 'the start of a username works too (any case), and the row shows the username');
select is((select count(*)::int from jsonb_array_elements(staff_members('zqsearcha')) e), 1, 'a bare word also matches usernames');
select is(jsonb_array_length(staff_members('@zqnobodyhere')), 0, 'unknown username: nothing');
select is(staff_member('sutest_member') ->> 'username', 'zqsearchada', 'the member page shows the username');
select is(staff_member('sutest_plain') ->> 'username', null, 'no username yet: empty');

select pg_temp.login('00000000-0000-0000-0000-0000000f0002', 'aal1');
select throws_ok($$ select staff_members('@zqsearchada') $$, '42501', null, 'staff without the authenticator code are refused');
select pg_temp.login('00000000-0000-0000-0000-0000000f0003');
select throws_ok($$ select staff_member('sutest_member') $$, '42501', null, 'members who aren''t staff are refused');

select set_config('role', 'postgres', true);
select * from finish();
rollback;
