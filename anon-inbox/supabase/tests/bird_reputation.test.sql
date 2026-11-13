-- Bird Kingdom + Community Star Ratings: hours only come from real, server-timed activity and levels
-- never drop; ratings need a real relationship, are once per 7 days per direction, stay anonymous,
-- and blocks/reports never change anyone's score.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(31);

-- r1..r6 raters, t1 the person being rated, n1 a brand-new account. Older accounts can rate.
insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000000' || x)::uuid, x || '@rep.test.invalid', 'authenticated', 'authenticated', now(),
       case when x = 'e9' then now() else now() - interval '10 days' end, now()
from unnest(array['e1','e2','e3','e4','e5','e6','e7','e9']) x;
-- e7 = t1 (rated), e9 = n1 (new)

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
-- A chat between two people with n messages from each.
create function pg_temp.chat(a text, b text, kind text, n int) returns uuid language plpgsql as $$
declare c uuid;
begin
  insert into dating_conversations (user_a, user_b, started_by, accepted_at, kind)
  values (least(a::uuid, b::uuid), greatest(a::uuid, b::uuid), a::uuid, now(), kind) returning id into c;
  insert into dating_messages (conversation_id, sender_id, body)
  select c, s, 'hello ' || g from unnest(array[a::uuid, b::uuid]) s, generate_series(1, n) g;
  return c;
end $$;

-- ---- Bird Kingdom -----------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000e9');
select is((my_bird() ->> 'level')::int, 1, 'A new member starts at Sparrow (level 1)');
select is((activity_ping() ->> 'added')::int, 0, 'The first ping adds no time (nothing measured yet)');
select pg_temp.admin();
update dating_private.bird_kingdom set last_ping_at = now() - interval '30 seconds' where user_id = '00000000-0000-0000-0000-0000000000e9';
select pg_temp.login('00000000-0000-0000-0000-0000000000e9');
select ok((activity_ping() ->> 'added')::int between 28 and 32, 'Active time is measured on the server clock (about 30 s)');
select pg_temp.admin();
update dating_private.bird_kingdom set last_ping_at = now() - interval '10 minutes' where user_id = '00000000-0000-0000-0000-0000000000e9';
select pg_temp.login('00000000-0000-0000-0000-0000000000e9');
select is((activity_ping() ->> 'added')::int, 0, 'A long gap (idle, background, offline) adds nothing');
select pg_temp.admin();
update dating_private.bird_kingdom set last_ping_at = now() - interval '85 seconds' where user_id = '00000000-0000-0000-0000-0000000000e9';
select pg_temp.login('00000000-0000-0000-0000-0000000000e9');
select ok((activity_ping() ->> 'added')::int <= 60, 'One ping never adds more than 60 seconds');
select pg_temp.admin();
select is(dating_private.bird_level_for(5 * 3600 - 1), 1::smallint, '4h59m is still Sparrow');
select is(dating_private.bird_level_for(5 * 3600), 2::smallint, '5 hours is Dove');
select is(dating_private.bird_level_for(100 * 3600), 5::smallint, '100 hours is Eagle');
select is(dating_private.bird_level_for(1000 * 3600), 8::smallint, '1,000 hours is Phoenix');
update dating_private.bird_kingdom set historical_seconds = 5 * 3600 - 10, post_launch_seconds = 0, level = 1,
  last_ping_at = now() - interval '30 seconds' where user_id = '00000000-0000-0000-0000-0000000000e9';
select pg_temp.login('00000000-0000-0000-0000-0000000000e9');
select is(activity_ping() ->> 'leveled_up', 'true', 'Crossing 5 hours levels up to Dove');
select pg_temp.admin();
update dating_private.bird_kingdom set level = 5, historical_seconds = 0, post_launch_seconds = 0 where user_id = '00000000-0000-0000-0000-0000000000e9';
select pg_temp.login('00000000-0000-0000-0000-0000000000e9');
select is((activity_ping() ->> 'level')::int, 5, 'A level once reached is kept');
select pg_temp.admin();

-- ---- Ratings: eligibility -----------------------------------------------------------------------
select set_config('test.c1', pg_temp.chat('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e7', 'friend', 2)::text, true);
select set_config('test.c2', pg_temp.chat('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e7', 'dating', 1)::text, true);
select set_config('test.c5', pg_temp.chat('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000e7', 'dating', 3)::text, true);
select set_config('test.c9', pg_temp.chat('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000e7', 'dating', 3)::text, true);
insert into dating_cleared (conversation_id, user_id) values (current_setting('test.c5')::uuid, '00000000-0000-0000-0000-0000000000e5');

select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select is(rating_status_convo(current_setting('test.c1')::uuid) ->> 'eligible', 'true', 'Friends who both chatted can rate each other');
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select is(rating_status_convo(current_setting('test.c2')::uuid) ->> 'eligible', 'false', 'One message each is not enough to rate');
select pg_temp.login('00000000-0000-0000-0000-0000000000e5');
select is(rating_status_convo(current_setting('test.c5')::uuid) ->> 'eligible', 'false', 'A deleted chat can no longer be used to rate');
select pg_temp.login('00000000-0000-0000-0000-0000000000e9');
select matches(rating_status_convo(current_setting('test.c9')::uuid) ->> 'reason', 'New accounts', 'Brand-new accounts cannot rate yet');

-- ---- Ratings: submitting ------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select throws_ok(format('select rate_convo(%L, 6)', current_setting('test.c1')), '22023', null, 'Only 1 to 5 stars');
select lives_ok(format('select rate_convo(%L, 4)', current_setting('test.c1')), 'An eligible friend can rate (4 stars)');
select throws_ok(format('select rate_convo(%L, 5)', current_setting('test.c1')), 'P0001', null, 'Rating the same person again within 7 days is refused');
select is(rating_status_convo(current_setting('test.c1')::uuid) ->> 'cooldown', 'true', 'The profile shows the 7-day wait');
select pg_temp.login('00000000-0000-0000-0000-0000000000e7');
select lives_ok(format('select rate_convo(%L, 5)', current_setting('test.c1')), 'The other direction is independent');
select throws_ok('select count(*) from dating_private.star_ratings', '42501', null, 'Members cannot read who rated them');

-- ---- Ratings: chatroom --------------------------------------------------------------------------
select pg_temp.admin();
insert into room_members (user_id, state, handle, joined_at, last_seen_at) values
  ('00000000-0000-0000-0000-0000000000e3', 'Lagos', 'Rep Tester Three', now(), now()),
  ('00000000-0000-0000-0000-0000000000e4', 'Lagos', 'Rep Tester Four', now(), now()),
  ('00000000-0000-0000-0000-0000000000e7', 'Lagos', 'Rep Tester Seven', now(), now())
on conflict do nothing;
insert into room_messages (state, user_id, handle, body)
select 'Lagos', u::uuid, h, 'room hi ' || g from (values ('00000000-0000-0000-0000-0000000000e3', 'Rep Tester Three'),
  ('00000000-0000-0000-0000-0000000000e7', 'Rep Tester Seven')) v(u, h), generate_series(1, 3) g;
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select is(rating_status_room('Rep Tester Seven') ->> 'eligible', 'true', 'Room members who chatted together can rate');
select pg_temp.login('00000000-0000-0000-0000-0000000000e4');
select is(rating_status_room('Rep Tester Seven') ->> 'eligible', 'false', 'Just being in the room is not enough');
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select is(rating_status_room('Rep Tester Three') ->> 'eligible', 'false', 'Nobody can rate themselves');

-- ---- Hourly score ---------------------------------------------------------------------------------
select pg_temp.admin();
select dating_private.refresh_reputation();
select pg_temp.login('00000000-0000-0000-0000-0000000000e7');
select is(my_reputation() ->> 'established', 'false', 'One rating is "not enough ratings yet"');
select is((my_reputation() ->> 'score')::numeric, 5.0, 'A not-yet-established member still shows 5.0');
-- Five more different people give 1 star.
select pg_temp.admin();
insert into dating_private.star_ratings (rater, ratee, stars, basis)
select ('00000000-0000-0000-0000-0000000000' || x)::uuid, '00000000-0000-0000-0000-0000000000e7', 1, 'match'
from unnest(array['e2','e3','e4','e5','e6']) x;
select dating_private.refresh_reputation();
select pg_temp.login('00000000-0000-0000-0000-0000000000e7');
select is(my_reputation() ->> 'established', 'true', 'Six raters make an established score');
select ok((my_reputation() ->> 'score')::numeric < 4.0, 'Low ratings lower the score (no automatic ban)');
select pg_temp.admin();
select set_config('test.before', (select score::text from dating_private.reputation where user_id = '00000000-0000-0000-0000-0000000000e7'), true);
-- Blocks and reports: lots of them, both directions.
insert into dating_blocks (blocker_id, blocked_id)
select ('00000000-0000-0000-0000-0000000000' || x)::uuid, '00000000-0000-0000-0000-0000000000e7' from unnest(array['e1','e2','e3','e4']) x
on conflict do nothing;
insert into dating_reports (reporter_id, reported_id, reason)
select ('00000000-0000-0000-0000-0000000000' || x)::uuid, '00000000-0000-0000-0000-0000000000e7', 'spam' from unnest(array['e1','e2','e3']) x;
select dating_private.refresh_reputation();
select is((select score::text from dating_private.reputation where user_id = '00000000-0000-0000-0000-0000000000e7'),
  current_setting('test.before'), 'Being blocked and reported does not change the star rating');
select pg_temp.login('00000000-0000-0000-0000-0000000000e3');
select is(rating_status_room('Rep Tester Seven') ->> 'eligible', 'false', 'After a block, no new ratings can be given');
select pg_temp.login('00000000-0000-0000-0000-0000000000e7');
select isnt(my_reputation() -> 'distribution', 'null'::jsonb, 'The owner sees a star distribution once established');

select pg_temp.admin();
select * from finish();
rollback;
