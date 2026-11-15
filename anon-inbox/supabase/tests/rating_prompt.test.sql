-- "Rate this user" prompt in chats: after 10+ messages, Not now = again 20 messages later,
-- rating once a week. Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

create function pg_temp.login(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;
create function pg_temp.admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- n messages, alternating a / b
create function pg_temp.msgs(n int) returns void language sql as $$
  insert into dating_messages (conversation_id, sender_id, body, created_at)
  select '00000000-0000-0000-0000-0000000aa001',
         case when g % 2 = 0 then '00000000-0000-0000-0000-0000000a0001'::uuid else '00000000-0000-0000-0000-0000000a0002'::uuid end,
         'rp test ' || g, now() - interval '1 hour' + make_interval(secs => g)
  from generate_series(1, n) g
$$;

insert into auth.users (id, email, created_at)
select ('00000000-0000-0000-0000-0000000a' || lpad(n::text, 4, '0'))::uuid, 'rp' || n || '@test.invalid', now() - interval '60 days'
from generate_series(1, 4) n;
insert into dating_profiles (user_id, name, gender, age, intent, handle, state, last_seen_at) values
  ('00000000-0000-0000-0000-0000000a0001', 'A', 'female', 30, 'love', 'rptest_a', 'Lagos', now()),
  ('00000000-0000-0000-0000-0000000a0002', 'B', 'male', 30, 'love', 'rptest_b', 'Lagos', now()),
  ('00000000-0000-0000-0000-0000000a0003', 'C', 'male', 30, 'love', 'rptest_c', 'Lagos', now()),
  ('00000000-0000-0000-0000-0000000a0004', 'D', 'male', 30, 'love', 'rptest_d', 'Lagos', now());
insert into dating_conversations (id, user_a, user_b, started_by, kind, accepted_at) values
  ('00000000-0000-0000-0000-0000000aa001', '00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000a0002', '00000000-0000-0000-0000-0000000a0001', 'friend', now() - interval '2 hours'),
  ('00000000-0000-0000-0000-0000000aa002', '00000000-0000-0000-0000-0000000a0003', '00000000-0000-0000-0000-0000000a0004', '00000000-0000-0000-0000-0000000a0003', 'dating', null);

select pg_temp.msgs(6);
select pg_temp.login('00000000-0000-0000-0000-0000000a0001');
select is((rating_prompt('00000000-0000-0000-0000-0000000aa001') ->> 'show')::boolean, false, '6 messages: no prompt yet');
select pg_temp.admin(); select pg_temp.msgs(5);   -- 11 messages
select pg_temp.login('00000000-0000-0000-0000-0000000a0001');
select is((rating_prompt('00000000-0000-0000-0000-0000000aa001') ->> 'show')::boolean, true, 'more than 10 messages: prompt shows');
select pg_temp.login('00000000-0000-0000-0000-0000000a0002');
select is((rating_prompt('00000000-0000-0000-0000-0000000aa001') ->> 'show')::boolean, true, 'it shows for the other person too');

-- A says Not now: back after 20 more messages (at 31).
select pg_temp.login('00000000-0000-0000-0000-0000000a0001');
select lives_ok($$ select rating_prompt_later('00000000-0000-0000-0000-0000000aa001') $$, 'Not now');
select is((rating_prompt('00000000-0000-0000-0000-0000000aa001') ->> 'show')::boolean, false, 'after Not now: hidden');
select pg_temp.admin(); select pg_temp.msgs(19);  -- 30
select pg_temp.login('00000000-0000-0000-0000-0000000a0001');
select is((rating_prompt('00000000-0000-0000-0000-0000000aa001') ->> 'show')::boolean, false, '19 more messages: still hidden');
select pg_temp.admin(); select pg_temp.msgs(1);   -- 31
select pg_temp.login('00000000-0000-0000-0000-0000000a0001');
select is((rating_prompt('00000000-0000-0000-0000-0000000aa001') ->> 'show')::boolean, true, '20 messages after Not now: shows again');

-- A rates: hidden (once a week), and back 20 messages later once the week has passed.
select lives_ok($$ select rate_convo('00000000-0000-0000-0000-0000000aa001', 4) $$, 'rating from the prompt works');
select pg_temp.admin(); select pg_temp.msgs(20);  -- 51
select pg_temp.login('00000000-0000-0000-0000-0000000a0001');
select is((rating_prompt('00000000-0000-0000-0000-0000000aa001') ->> 'show')::boolean, false, 'rated this week: no prompt even after 20 messages');
select pg_temp.admin();
update dating_private.rating_pairs set last_rated_at = now() - interval '8 days'
where rater = '00000000-0000-0000-0000-0000000a0001' and ratee = '00000000-0000-0000-0000-0000000a0002';
select pg_temp.login('00000000-0000-0000-0000-0000000a0001');
select is((rating_prompt('00000000-0000-0000-0000-0000000aa001') ->> 'show')::boolean, true, 'a week later and 20 messages on: shows again');

-- Requests that aren't accepted never prompt; strangers can't touch someone else's chat.
select pg_temp.login('00000000-0000-0000-0000-0000000a0003');
select is((rating_prompt('00000000-0000-0000-0000-0000000aa002') ->> 'show')::boolean, false, 'unaccepted request: no prompt');
select throws_ok($$ select rating_prompt_later('00000000-0000-0000-0000-0000000aa001') $$, 'P0002', 'Chat not found.', 'not your chat');

select set_config('role', 'postgres', true);
select * from finish();
rollback;
