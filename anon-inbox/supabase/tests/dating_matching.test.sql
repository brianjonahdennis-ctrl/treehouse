-- Likes, requests, mutual matches, discovery preferences, unmatch and message reactions.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(24);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a2', 'a2@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b2', 'b2@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000e2', 'e2@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

-- Amy (f, 26) likes men; Ben (m, 28) likes women; Cy (m, 40) likes women; Dee (f, 24) likes women.
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select create_my_profile('Amy Secret', 'female', 26, 'Lagos', 'love');
update dating_profiles set interested_in = '{male}', bio = 'Jollof critic', interests = '{music,food}', max_age = 35
  where user_id = '00000000-0000-0000-0000-0000000000a2';
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select create_my_profile('Ben Secret', 'male', 28, 'Abuja', 'love');
update dating_profiles set interested_in = '{female}' where user_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select create_my_profile('Cy Secret', 'male', 40, 'Kano', 'fun');
update dating_profiles set interested_in = '{female}' where user_id = '00000000-0000-0000-0000-0000000000c2';
select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
select create_my_profile('Dee Secret', 'female', 24, 'Enugu', 'fun');
update dating_profiles set interested_in = '{female}' where user_id = '00000000-0000-0000-0000-0000000000d2';
select pg_temp.admin();
update dating_profiles set last_seen_at = now() where user_id in (select id from auth.users where email like '%@test.invalid');  -- test people rank first in Discover
select set_config('test.ha', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000a2'), true);
select set_config('test.hb', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000b2'), true);
select set_config('test.hc', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000c2'), true);
select set_config('test.hd', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000d2'), true);

-- Discovery follows both people's preferences
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select ok(exists (select 1 from discover_cards(50) where handle = current_setting('test.hb')),
  'Amy sees Ben: each fits the other''s preferences');
select ok(not exists (select 1 from discover_cards(50) where handle = current_setting('test.hc')),
  'Amy doesn''t see Cy: he is older than her max age');
select ok(not exists (select 1 from discover_cards(50) where handle = current_setting('test.hd')),
  'Amy doesn''t see Dee: neither is interested in the other''s gender');
select is((select bio from discover_cards(50) where handle = current_setting('test.hb')), '',
  'Cards include the bio');

-- Likes are private
select throws_ok($$ select * from dating_likes $$, '42501', null, 'The likes table can''t be read directly');

-- A like is a request; liking back is a match
select is((select matched from like_profile(current_setting('test.hb'), true)), false,
  'Amy likes Ben: no match yet');
select is(my_pending_likes(), 1, 'Amy has one like waiting for an answer');
select ok(not exists (select 1 from discover_cards(50) where handle = current_setting('test.hb')),
  'Ben is no longer in Amy''s cards after she liked him');

select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select is((select count(*)::int from incoming_requests()), 1, 'Ben has one request');
select is((select handle from incoming_requests()), current_setting('test.ha'), 'The request is from Amy''s handle');
select is((select bio from incoming_requests()), 'Jollof critic', 'Requests show the bio');
select ok(position('Amy' in (select row_to_json(r)::text from incoming_requests() r)) = 0,
  'Requests never include the name');
select ok(exists (select 1 from discover_cards(50) where handle = current_setting('test.ha')),
  'Ben sees Amy in his cards too');
select set_config('test.conv', (select conversation_id::text from like_profile(current_setting('test.ha'), true)), true);
select ok(current_setting('test.conv') <> '', 'Ben likes Amy back: it''s a match and a chat opens');
select is((select count(*)::int from incoming_requests()), 0, 'The request is gone once answered');
select ok(exists (select 1 from my_conversations() where conversation_id = current_setting('test.conv')::uuid),
  'The match appears in Ben''s chats');

-- Declining a request
select pg_temp.login('00000000-0000-0000-0000-0000000000d2');
update dating_profiles set interested_in = '{male}' where user_id = '00000000-0000-0000-0000-0000000000d2';
select like_profile(current_setting('test.hc'), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select is((select matched from like_profile(current_setting('test.hd'), false)), false, 'Cy declines Dee''s request');
select is((select count(*)::int from incoming_requests()), 0, 'A declined request is gone');

-- The old "Message" button no longer opens chats without a match
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select is(start_conversation(current_setting('test.ha'))::text, current_setting('test.conv'),
  'start_conversation still reopens a chat with a match');
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select set_config('test.req', start_conversation(current_setting('test.ha'))::text, true);
select is((select status from my_conversations() where conversation_id = current_setting('test.req')::uuid), 'sent',
  'Messaging without a match sends a message request');

-- Without a dating profile
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select throws_ok($$ select like_profile(current_setting('test.ha'), true) $$, '28000', null,
  'You need a dating profile to like anyone');

-- Unmatch closes the chat for both
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select unmatch_conversation(current_setting('test.conv')::uuid);
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select throws_ok($$ insert into dating_messages (conversation_id, body) values (current_setting('test.conv')::uuid, 'still there?') $$,
  '42501', null, 'After an unmatch, the other person can''t send messages');

-- Reactions on anonymous messages
select pg_temp.admin();
insert into links (user_id, username, display_name) values ('00000000-0000-0000-0000-0000000000e2', 'testreacts', 'Tess');
insert into link_messages (owner_id, body) values ('00000000-0000-0000-0000-0000000000e2', 'hi');
select pg_temp.login('00000000-0000-0000-0000-0000000000e2');
select lives_ok($$ update link_messages set reaction = '🔥' $$, 'Owners can react to their messages');
select throws_ok($$ update link_messages set reaction = 'lol' $$, '23514', null, 'Only the listed reactions are allowed');

select * from finish();
rollback;
