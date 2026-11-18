-- Treasure Hunt part 3: winners notice, quitting, live ranking and the hunt chatroom (migration 20261118160000).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(41);

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
create function pg_temp.u(i int) returns uuid language sql as $$ select ('00000000-0000-0000-0000-0000000008' || lpad(i::text, 2, '0'))::uuid $$;

-- Players 1-4 (Lagos), 5 = outsider (Lagos, not registered), 6 = staff Admin.
do $$
declare i int;
begin
  for i in 1..6 loop
    insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at)
    values (pg_temp.u(i), 'hw' || i || '@test.invalid', 'authenticated', 'authenticated', now(), now(), now());
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(i), 'role', 'authenticated')::text, true);
    perform create_my_profile('Hunt Tester', 'male', (current_date - interval '28 years')::date, '', 'fun');
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
  end loop;
end $$;
update dating_profiles set state = 'Lagos' where user_id in (pg_temp.u(1), pg_temp.u(2), pg_temp.u(3), pg_temp.u(4), pg_temp.u(5), pg_temp.u(6));
insert into announcement_staff (user_id, role, can_publish) values (pg_temp.u(6), 'admin', false) on conflict (user_id) do update set role = 'admin';
select set_config('t.h1', (select handle from dating_profiles where user_id = pg_temp.u(1)), true);
select set_config('t.h3', (select handle from dating_profiles where user_id = pg_temp.u(3)), true);

insert into treasure_hunts (id, title, region, state, description, status, starts_at, ends_at, completion_bonus_coins, winners_count, rules)
values ('00000000-0000-4000-8000-0000000008b1', 'Lekki Winners Test', 'Lekki, Lagos', 'Lagos', 'Test', 'active', now() - interval '1 hour', now() + interval '1 day', 100, 2,
  'Stay on public roads. Be kind.');
insert into treasure_hunt_checkpoints (hunt_id, sequence, name, hint, latitude, longitude, radius_m, reward_coins) values
 ('00000000-0000-4000-8000-0000000008b1', 1, 'One', '', 6.44, 3.47, 80, 100),
 ('00000000-0000-4000-8000-0000000008b1', 2, 'Two', '', 6.441, 3.47, 80, 100);
select set_config('t.h', '00000000-0000-4000-8000-0000000008b1', true);
do $$
declare i int;
begin
  for i in 1..4 loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(i), 'role', 'authenticated')::text, true);
    perform treasure_hunt_register(current_setting('t.h')::uuid);
  end loop;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into treasure_hunt_participants (hunt_id, user_id, legacy_route_order, last_checkpoint_sequence)
  select current_setting('t.h')::uuid, pg_temp.u(g.n), false, case when g.n = 2 then 1 else 0 end from generate_series(1, 4) g(n);
end $$;

-- Triggers are installed.
select is((select count(*)::int from pg_trigger where tgname in ('treasure_hunt_quit_guard', 'treasure_hunt_winners_check') and not tgisinternal), 2, 'quit and winners triggers are installed');
select ok(exists (select 1 from cron.job where jobname = 'treasure-hunt-chat-cleanup'), 'the chat clean-up job is scheduled');

-- Live ranking.
select pg_temp.login(pg_temp.u(1)::text);
select is(jsonb_array_length(treasure_hunt_live_board(current_setting('t.h')::uuid)->'items'), 4, 'a player sees every competitor');
select is((treasure_hunt_live_board(current_setting('t.h')::uuid)->'items'->0->>'checkpoints'), '1', 'the player with most checkpoints ranks first');
select is((treasure_hunt_live_board(current_setting('t.h')::uuid)->'hunt'->>'checkpoint_count'), '2', 'the ranking shows the checkpoint total (x of 2)');
select ok(not (treasure_hunt_live_board(current_setting('t.h')::uuid)->'items'->0 ? 'coins'), 'other players'' coins are not shown');
select ok(treasure_hunt_live_board(current_setting('t.h')::uuid)::text like '%' || current_setting('t.h1') || '%', 'players see nicknames');
select ok((treasure_hunt_live_board(current_setting('t.h')::uuid)->'me'->>'place') is not null, 'a player sees their own place');
select pg_temp.login(pg_temp.u(5)::text);
select throws_ok($$ select treasure_hunt_live_board(current_setting('t.h')::uuid) $$, '42501', 'Register for this hunt to see the ranking.', 'someone not in the hunt cannot see the ranking');

-- Winners and the notice.
select pg_temp.admin();
update treasure_hunt_participants set last_checkpoint_sequence = 2, completed_at = now() - interval '10 minutes' where hunt_id = current_setting('t.h')::uuid and user_id = pg_temp.u(1);
select ok(not exists (select 1 from treasure_hunt_winner_notices where hunt_id = current_setting('t.h')::uuid), 'no notice after the first of two winners');
update treasure_hunt_participants set last_checkpoint_sequence = 2, completed_at = now() - interval '5 minutes' where hunt_id = current_setting('t.h')::uuid and user_id = pg_temp.u(2);
select ok(exists (select 1 from treasure_hunt_winner_notices where hunt_id = current_setting('t.h')::uuid and announcement_id is not null), 'the notice goes out when the second winner finishes');
select ok(exists (select 1 from announcement_deliveries d join treasure_hunt_winner_notices n on n.announcement_id = d.announcement_id where n.hunt_id = current_setting('t.h')::uuid and d.user_id = pg_temp.u(3)), 'a player still on the hunt is notified');
select ok(not exists (select 1 from announcement_deliveries d join treasure_hunt_winner_notices n on n.announcement_id = d.announcement_id where n.hunt_id = current_setting('t.h')::uuid and d.user_id = pg_temp.u(1)), 'a winner is not sent the notice');
select ok(not exists (select 1 from announcement_deliveries d join treasure_hunt_winner_notices n on n.announcement_id = d.announcement_id where n.hunt_id = current_setting('t.h')::uuid and d.user_id = pg_temp.u(5)), 'someone not in the hunt is not sent the notice');
update treasure_hunt_participants set completed_at = completed_at where hunt_id = current_setting('t.h')::uuid;
select is((select count(*)::int from treasure_hunt_winner_notices where hunt_id = current_setting('t.h')::uuid), 1, 'the notice is sent only once');
select pg_temp.login(pg_temp.u(3)::text);
select is((treasure_hunt_live_board(current_setting('t.h')::uuid)->'hunt'->>'winners_done'), 'true', 'players see the winners are in');
select is((select (j->>'winners_done')::boolean from jsonb_array_elements(treasure_hunts_list()) j where j->>'id' = current_setting('t.h')), true, 'the hunt list shows the winners are in');
select is((treasure_hunt_live_board(current_setting('t.h')::uuid)->'items'->1->>'winner'), 'true', 'the second finisher is a winner');

-- Quitting.
select lives_ok($$ select treasure_hunt_quit(current_setting('t.h')::uuid) $$, 'a player can quit');
select is((treasure_hunt_live_board(current_setting('t.h')::uuid)->'me'->>'quit'), 'true', 'the ranking shows they quit');
select pg_temp.admin();
select throws_ok($$ update treasure_hunt_participants set last_checkpoint_sequence = 1 where hunt_id = current_setting('t.h')::uuid and user_id = '00000000-0000-0000-0000-000000000803' $$, '42501', 'You left this hunt, so it can''t be continued.', 'a player who quit cannot collect more (update)');
select lives_ok($$ update treasure_hunt_participants set claim_attempts = 1 where hunt_id = current_setting('t.h')::uuid and user_id = '00000000-0000-0000-0000-000000000803' $$, 'other updates to a player who quit still work');
select pg_temp.login(pg_temp.u(1)::text);
select throws_ok($$ select treasure_hunt_quit(current_setting('t.h')::uuid) $$, '42501', 'You already finished this hunt.', 'a finisher cannot quit');
select pg_temp.admin();
update treasure_hunt_participants set last_checkpoint_sequence = 2, completed_at = now() where hunt_id = current_setting('t.h')::uuid and user_id = pg_temp.u(4);
select pg_temp.login(pg_temp.u(4)::text);
select is((treasure_hunt_live_board(current_setting('t.h')::uuid)->'me'->>'winner'), 'false', 'finishing after the winners still counts, but not as a winner');
select is((treasure_hunt_live_board(current_setting('t.h')::uuid)->'me'->>'finished'), 'true', 'the late finisher is shown as finished');

-- The hunt chatroom.
select pg_temp.login(pg_temp.u(1)::text);
select is((treasure_hunt_chat(current_setting('t.h')::uuid)->>'title'), 'Lekki Winners Test', 'the chat is named after the hunt');
select is((treasure_hunt_chat(current_setting('t.h')::uuid)->>'rules'), 'Stay on public roads. Be kind.', 'the rules are pinned in the chat');
select ok(treasure_hunt_chat_send(current_setting('t.h')::uuid, 'Where do we start?') > 0, 'a registered player can ask a question');
select throws_ok($$ select treasure_hunt_chat_send(current_setting('t.h')::uuid, 'Hello again') $$, '42501', 'You''re sending messages too fast. Wait a moment.', 'members cannot flood the chat');
select throws_ok($$ select treasure_hunt_chat_send(current_setting('t.h')::uuid, 'psst', current_setting('t.h3')) $$, '42501', 'Only the treehouse team can send private messages here.', 'players cannot message each other privately');
select ok(not (treasure_hunt_chat(current_setting('t.h')::uuid) ? 'members'), 'the chat never sends a member list');
select pg_temp.login(pg_temp.u(5)::text);
select throws_ok($$ select treasure_hunt_chat(current_setting('t.h')::uuid) $$, '42501', 'Register for this hunt to join its chat.', 'someone not registered cannot read the chat');
select pg_temp.login(pg_temp.u(6)::text, 'aal2');
select ok(treasure_hunt_chat_send(current_setting('t.h')::uuid, 'Start at the main gate.') > 0, 'staff can post in the chat');
select set_config('t.pm', treasure_hunt_chat_send(current_setting('t.h')::uuid, 'Are you okay? You stopped moving.', current_setting('t.h3'))::text, true);
select pg_temp.login(pg_temp.u(3)::text);
select ok(treasure_hunt_chat(current_setting('t.h')::uuid)::text like '%Are you okay%', 'the player sees the private message from staff');
select pg_temp.login(pg_temp.u(4)::text);
select ok(treasure_hunt_chat(current_setting('t.h')::uuid)::text not like '%Are you okay%', 'other players do not see it');
select is((select count(*)::int from jsonb_array_elements(treasure_hunt_chat(current_setting('t.h')::uuid)->'messages') m where m->>'sender' = 'treehouse team'), 1, 'staff posts show as the treehouse team');
select pg_temp.login(pg_temp.u(6)::text, 'aal2');
select lives_ok($$ select treasure_hunt_chat_delete(current_setting('t.pm')::bigint) $$, 'staff can remove a message');
select pg_temp.admin();
select ok(exists (select 1 from dating_private.staff_audit where action = 'treasure_hunt_chat_private' and target_id = current_setting('t.h')), 'private staff messages are in the audit log');

-- When the hunt ends the chat closes and is deleted.
update treasure_hunts set ends_at = now() - interval '1 minute', starts_at = now() - interval '2 hour' where id = current_setting('t.h')::uuid;
select pg_temp.login(pg_temp.u(1)::text);
select throws_ok($$ select treasure_hunt_chat(current_setting('t.h')::uuid) $$, '42501', 'This hunt has ended, so its chat is closed.', 'the chat closes when the hunt ends');
select pg_temp.admin();
select dating_private.treasure_hunt_chat_cleanup();
select is((select count(*)::int from treasure_hunt_chat where hunt_id = current_setting('t.h')::uuid), 0, 'the clean-up deletes the ended hunt''s chat');
select throws_ok($$ update treasure_hunts set winners_count = 0 where id = current_setting('t.h')::uuid $$, '23514', null, 'winners must be 1 to 100');

select * from finish();
rollback;
