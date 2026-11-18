-- Treasure Hunt sign-up: state-only registration, count-only view, live start, staff board,
-- competitor messages and prizes (migration 20261118120000).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(56);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000005a1', 'hs1@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000005a2', 'hs2@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000005a3', 'hs3@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000005a4', 'hs4@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000005a5', 'hs5@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

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

-- e1 Rivers, e2 Lagos, e3 Rivers, e4 = staff (Admin), e5 no state.
select pg_temp.login('00000000-0000-0000-0000-0000000005a1');
select create_my_profile('Swift Egret 511', 'female', (current_date - interval '25 years')::date, 'Rivers', 'fun');
select pg_temp.login('00000000-0000-0000-0000-0000000005a2');
select create_my_profile('Quiet Ibis 522', 'male', (current_date - interval '27 years')::date, 'Lagos', 'fun');
select pg_temp.login('00000000-0000-0000-0000-0000000005a3');
select create_my_profile('Merry Finch 533', 'female', (current_date - interval '30 years')::date, 'Rivers', 'fun');
select pg_temp.login('00000000-0000-0000-0000-0000000005a4');
select create_my_profile('Steady Hawk 544', 'male', (current_date - interval '35 years')::date, 'Abuja', 'fun');
select pg_temp.login('00000000-0000-0000-0000-0000000005a5');
select create_my_profile('Gentle Wren 555', 'female', (current_date - interval '24 years')::date, '', 'fun');
select pg_temp.admin();
-- Profiles start with no state; set each once (Gentle Wren keeps none for now).
update dating_profiles set state = case user_id
  when '00000000-0000-0000-0000-0000000005a1' then 'Rivers' when '00000000-0000-0000-0000-0000000005a2' then 'Lagos'
  when '00000000-0000-0000-0000-0000000005a3' then 'Rivers' when '00000000-0000-0000-0000-0000000005a4' then 'FCT' end
where user_id in ('00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005a2', '00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-0000000005a4');
insert into announcement_staff (user_id, role, can_publish) values ('00000000-0000-0000-0000-0000000005a4', 'admin', false)
  on conflict (user_id) do update set role = 'admin', can_publish = false;

-- A Rivers hunt that starts in an hour, and an older hunt with no state.
insert into treasure_hunts (id, title, region, state, description, status, starts_at, ends_at, completion_bonus_coins, join_radius_km)
values ('00000000-0000-4000-8000-0000000005b1', 'PH sign-up test', 'Port Harcourt, Rivers', 'Rivers', 'Test', 'scheduled', now() + interval '1 hour', now() + interval '1 day', 100, 40),
       ('00000000-0000-4000-8000-0000000005b2', 'Old open hunt', 'Somewhere', null, 'Test', 'active', now() - interval '1 hour', now() + interval '1 day', 100, 60),
       ('00000000-0000-4000-8000-0000000005b3', 'Finished hunt', 'Port Harcourt', 'Rivers', 'Test', 'completed', now() - interval '2 day', now() - interval '1 day', 100, 60);
insert into treasure_hunt_checkpoints (id, hunt_id, sequence, name, hint, latitude, longitude, radius_m, reward_coins) values
 ('00000000-0000-4000-8000-0000000005c1', '00000000-0000-4000-8000-0000000005b1', 1, 'First stop', 'Look.', 4.8156, 7.0498, 80, 100),
 ('00000000-0000-4000-8000-0000000005c2', '00000000-0000-4000-8000-0000000005b1', 2, 'Second stop', 'Go.', 4.8158, 7.0498, 80, 100),
 ('00000000-0000-4000-8000-0000000005c3', '00000000-0000-4000-8000-0000000005b2', 1, 'Old stop', 'Look.', 9.0, 7.0, 80, 100),
 ('00000000-0000-4000-8000-0000000005c4', '00000000-0000-4000-8000-0000000005b3', 1, 'Done stop', 'Look.', 4.8, 7.0, 80, 100);
insert into treasure_hunt_route_points(hunt_id,point_kind,sequence,name,latitude,longitude,radius_m,reward_coins) values
 ('00000000-0000-4000-8000-0000000005b1','finish',1,'Grand prize',4.8160,7.0502,80,25);
select set_config('t.h', '00000000-0000-4000-8000-0000000005b1', true);

select is((select string_agg(coalesce(state, '-'), ',' order by user_id) from dating_profiles where user_id::text like '00000000-0000-0000-0000-0000000005a_'), 'Rivers,Lagos,Rivers,FCT,-', 'test members are in the expected states');
select set_config('t.h1', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000005a1'), true);

-- Tables are closed to members; the triggers exist.
select ok(not has_table_privilege('authenticated', 'public.treasure_hunt_registrations', 'select'), 'members cannot read the registration list directly');
select ok(not has_table_privilege('authenticated', 'public.treasure_hunt_prizes', 'insert'), 'members cannot add prizes directly');
select is((select count(*)::int from pg_trigger where tgname in ('treasure_hunt_registration_guard', 'treasure_hunt_participant_guard') and not tgisinternal), 2, 'both guard triggers are installed');

-- Seeing and registering.
select pg_temp.login('00000000-0000-0000-0000-0000000005a2');
select ok(exists (select 1 from jsonb_array_elements(treasure_hunts_list()) j where j->>'id' = current_setting('t.h')), 'a Lagos member can see the Rivers hunt');
select matches((select j->>'register_block' from jsonb_array_elements(treasure_hunts_list()) j where j->>'id' = current_setting('t.h')), 'only for members in Rivers', 'the Lagos member is told why they cannot register');
select throws_ok($$ select treasure_hunt_register(current_setting('t.h')::uuid) $$, '42501', 'This hunt is only for members in Rivers. Your profile says Lagos.', 'a Lagos member cannot register for a Rivers hunt');
select ok(not exists (select 1 from jsonb_array_elements(treasure_hunts_list()) j where j->>'id' = '00000000-0000-4000-8000-0000000005b3'), 'finished hunts are not listed');
select pg_temp.login('00000000-0000-0000-0000-0000000005a5');
select throws_ok($$ select treasure_hunt_register(current_setting('t.h')::uuid) $$, '42501', 'Add your state to your profile to register for hunts near you.', 'a member with no state cannot register');

select pg_temp.admin();
select throws_ok($$ insert into treasure_hunt_registrations (hunt_id, user_id, state) values (current_setting('t.h')::uuid, '00000000-0000-0000-0000-0000000005a2', 'Rivers') $$,
  '42501', 'This hunt is only for members in Rivers. Your profile says Lagos.', 'the table trigger also refuses a wrong-state registration (insert)');
select throws_ok($$ insert into treasure_hunt_registrations (hunt_id, user_id, state) values ('00000000-0000-4000-8000-0000000005b3', '00000000-0000-0000-0000-0000000005a1', 'Rivers') $$,
  '42501', 'Registration for this hunt is closed.', 'the trigger refuses a registration for a finished hunt');

select pg_temp.login('00000000-0000-0000-0000-0000000005a1');
select is((treasure_hunt_register(current_setting('t.h')::uuid)->>'registered_count'), '1', 'a Rivers member can register and sees the count');
select is((treasure_hunt_register(current_setting('t.h')::uuid)->>'registered_count'), '1', 'registering twice is harmless');
select pg_temp.login('00000000-0000-0000-0000-0000000005a3');
select is((treasure_hunt_register(current_setting('t.h')::uuid)->>'registered_count'), '2', 'a second Rivers member registers');
select is((select j->>'registered_count' from jsonb_array_elements(treasure_hunts_list()) j where j->>'id' = current_setting('t.h')), '2', 'registered members see how many registered');
select is((select (j->>'registered')::boolean from jsonb_array_elements(treasure_hunts_list()) j where j->>'id' = current_setting('t.h')), true, 'the list marks the hunt as registered');
select ok(treasure_hunts_list()::text not like '%' || current_setting('t.h1') || '%', 'the list never names other registrants');
select pg_temp.login('00000000-0000-0000-0000-0000000005a2');
select ok((select j->'registered_count' from jsonb_array_elements(treasure_hunts_list()) j where j->>'id' = current_setting('t.h')) = 'null'::jsonb, 'people who did not register do not get the count');
select pg_temp.admin();
select is((select state from treasure_hunt_registrations where hunt_id = current_setting('t.h')::uuid and user_id = '00000000-0000-0000-0000-0000000005a1'), 'Rivers', 'the registration records the member’s state');

-- Starting.
select pg_temp.login('00000000-0000-0000-0000-0000000005a1');
select throws_ok($$ select treasure_hunt_join_with_routes(current_setting('t.h')::uuid, 4.8156, 7.0498, 8) $$, 'P0002', 'This hunt is not open right now.', 'nobody can start before the start time');
select pg_temp.admin();
update treasure_hunts set starts_at = now() - interval '1 minute' where id = current_setting('t.h')::uuid;
select pg_temp.login('00000000-0000-0000-0000-0000000005a1');
select throws_ok($$ select treasure_hunt_join_with_routes(current_setting('t.h')::uuid, 6.5244, 3.3792, 8) $$, '42501', 'You need to be in Port Harcourt, Rivers to start this hunt.', 'a registered member in Lagos cannot start the Port Harcourt hunt');
select is((select (j->>'live')::boolean from jsonb_array_elements(treasure_hunts_list()) j where j->>'id' = current_setting('t.h')), true, 'the hunt shows as live at its start time');
select is((treasure_hunt_join_with_routes(current_setting('t.h')::uuid, 4.8156, 7.0498, 8)->'current_target'->>'kind'), 'start', 'a registered member in the area can start');
select pg_temp.admin();
select is((select status from treasure_hunts where id = current_setting('t.h')::uuid), 'active', 'the first start turns a scheduled hunt active');
select pg_temp.login('00000000-0000-0000-0000-0000000005a1');
select is((treasure_hunt_claim_start(current_setting('t.h')::uuid, '00000000-0000-4000-8000-0000000005c1'::uuid, 4.8156, 7.0498, 8, '30000000-0000-4000-8000-000000000001'::uuid)->>'ok'), 'true', 'checking in still updates the player row (the insert-only trigger does not block it)');
select throws_ok($$ select treasure_hunt_unregister(current_setting('t.h')::uuid) $$, '42501', 'You have already started this hunt.', 'a player cannot unregister after starting');

select pg_temp.admin();
update dating_profiles set state = 'Rivers' where user_id = '00000000-0000-0000-0000-0000000005a5';
select lives_ok($$ insert into treasure_hunt_registrations (hunt_id, user_id, state) values (current_setting('t.h')::uuid, '00000000-0000-0000-0000-0000000005a5', 'x') $$, 'a matching-state registration passes the trigger');
select throws_ok($$ insert into treasure_hunt_participants (hunt_id, user_id) values (current_setting('t.h')::uuid, '00000000-0000-0000-0000-0000000005a2') $$,
  '42501', 'Register for this hunt first.', 'the player-table trigger refuses an unregistered player (insert)');
select pg_temp.login('00000000-0000-0000-0000-0000000005a5');
select lives_ok($$ select treasure_hunt_unregister(current_setting('t.h')::uuid) $$, 'a member can cancel before starting');
select pg_temp.login('00000000-0000-0000-0000-0000000005a3');
select is((select j->>'registered_count' from jsonb_array_elements(treasure_hunts_list()) j where j->>'id' = current_setting('t.h')), '2', 'the count drops after a cancellation');

select pg_temp.login('00000000-0000-0000-0000-0000000005a2');
select ok((treasure_hunt_join_with_routes('00000000-0000-4000-8000-0000000005b2', 9.0, 7.0, 8)->'current_target') is not null, 'an older hunt with no state still works without registering');

-- Staff board.
select pg_temp.login('00000000-0000-0000-0000-0000000005a1', 'aal2');
select throws_ok($$ select staff_treasure_hunt_board(current_setting('t.h')::uuid) $$, '42501', 'Not allowed.', 'members cannot open the staff board');
select pg_temp.login('00000000-0000-0000-0000-0000000005a4', 'aal1');
select throws_ok($$ select staff_treasure_hunt_board(current_setting('t.h')::uuid) $$, '42501', 'Enter the code from your authenticator app first.', 'staff need the authenticator step');
select pg_temp.login('00000000-0000-0000-0000-0000000005a4', 'aal2');
select is((staff_treasure_hunt_board(current_setting('t.h')::uuid)->>'registered'), '2', 'staff see everyone registered');
select is((staff_treasure_hunt_board(current_setting('t.h')::uuid)->>'started'), '1', 'staff see how many started');
select is((staff_treasure_hunt_board(current_setting('t.h')::uuid)->'people'->0->>'handle'), current_setting('t.h1'), 'the player with progress ranks first and staff see the profile name');
select is((staff_treasure_hunt_board(current_setting('t.h')::uuid)->'people'->0->>'checkpoints'), '1', 'staff see checkpoints done');
select ok((staff_treasure_hunt_board(current_setting('t.h')::uuid)->'people'->0) ? 'username', 'staff see the username field');
select pg_temp.admin();
select ok(exists (select 1 from dating_private.staff_audit where action = 'treasure_hunt_board_viewed' and target_id = current_setting('t.h')), 'opening the board is in the staff audit log');
update treasure_hunt_participants set completed_at = now() where hunt_id = current_setting('t.h')::uuid and user_id = '00000000-0000-0000-0000-0000000005a1';
select pg_temp.login('00000000-0000-0000-0000-0000000005a4', 'aal2');
select ok((staff_treasure_hunt_board(current_setting('t.h')::uuid)->'people'->0->>'took_seconds')::int >= 0, 'finishers get a finish time');

-- Messages to competitors.
select is((staff_treasure_hunt_message(current_setting('t.h')::uuid, 'Hunt update', 'Meet at the gate at 5pm.')->>'recipients'), '2', 'a message goes to everyone registered');
select pg_temp.admin();
select ok(exists (select 1 from announcement_deliveries d join announcements a on a.id = d.announcement_id
  where a.title = 'Hunt update' and d.user_id = '00000000-0000-0000-0000-0000000005a1'), 'a registered player receives the message');
select ok(not exists (select 1 from announcement_deliveries d join announcements a on a.id = d.announcement_id
  where a.title = 'Hunt update' and d.user_id = '00000000-0000-0000-0000-0000000005a2'), 'someone not registered does not receive it');
select ok(exists (select 1 from dating_private.staff_audit where action = 'treasure_hunt_message_sent' and target_id = current_setting('t.h')), 'sending is in the staff audit log');
select pg_temp.login('00000000-0000-0000-0000-0000000005a4', 'aal2');
select throws_ok($$ select staff_treasure_hunt_message(current_setting('t.h')::uuid, 'Hunt update', 'Meet at the gate at 5pm.') $$, '42501', 'That message was just sent. Wait a moment before sending another.', 'a double tap does not send twice');
select is((staff_treasure_hunt_message(current_setting('t.h')::uuid, 'Players only', 'Keep going!', 'started')->>'recipients'), '1', 'a message can go only to people who started');
select pg_temp.admin();
select is(dating_private.ann_clean_audience('{"base":"all","hunt":"00000000-0000-4000-8000-0000000005b1","hunt_group":"started"}')->>'hunt', '00000000-0000-4000-8000-0000000005b1', 'cleaning an audience keeps the hunt');
select throws_ok($$ select dating_private.ann_clean_audience('{"base":"all","hunt":"not-a-hunt"}') $$, '22023', 'Choose a valid audience.', 'a bad hunt id is refused');
select ok(exists (select 1 from dating_private.ann_targets('{"base":"all"}') t where t.user_id = '00000000-0000-0000-0000-0000000005a2'), 'audiences without a hunt are unchanged');

-- Prizes and setup.
select pg_temp.login('00000000-0000-0000-0000-0000000005a4', 'aal2');
select lives_ok($$ select staff_treasure_hunt_prizes_save(current_setting('t.h')::uuid, '[{"place":1,"title":"Phone","media_type":"image","media_url":"https://ctyyxxermexmcknhfmtl.supabase.co/storage/v1/object/public/hunt-prizes/prizes/a.jpg"},{"title":"Tour video","media_type":"video","media_url":"https://ctyyxxermexmcknhfmtl.supabase.co/storage/v1/object/public/hunt-prizes/prizes/b.mp4"}]') $$, 'staff can add a picture and a video prize');
select throws_ok($$ select staff_treasure_hunt_prizes_save(current_setting('t.h')::uuid, '[{"place":1,"title":"Phone","media_type":"image","media_url":"https://evil.example.com/a.jpg"}]') $$, '22023', null, 'a prize must use the treehouse prize storage');
select throws_ok($$ select staff_treasure_hunt_prizes_save(current_setting('t.h')::uuid, '[{"place":25,"title":"Phone","media_type":"image","media_url":"https://ctyyxxermexmcknhfmtl.supabase.co/storage/v1/object/public/hunt-prizes/prizes/a.jpg"}]') $$, '22023', null, 'prize places go from 1 to 20');
select throws_ok($$ select staff_treasure_hunt_save_routes('{"title":"No state hunt","region":"Somewhere","status":"draft","starts_at":"2030-01-01T10:00:00Z","ends_at":"2030-01-02T10:00:00Z"}', '[{"sequence":1,"name":"Stop","latitude":6.5,"longitude":3.3}]', '[]', '[{"sequence":1,"name":"Prize","latitude":6.5,"longitude":3.3}]') $$, '22023', 'Choose the state this hunt is in.', 'a new hunt needs a state');
select throws_ok($$ select staff_treasure_hunt_save_routes(jsonb_build_object('id', current_setting('t.h'), 'title','PH sign-up test','region','Lagos','state','Lagos','status','cancelled','starts_at',now(),'ends_at',now() + interval '1 day'), '[{"sequence":1,"name":"Stop","latitude":6.5,"longitude":3.3}]', '[]', '[{"sequence":1,"name":"Prize","latitude":6.5,"longitude":3.3}]') $$, '42501', 'People have registered for this hunt, so its state can''t change.', 'the state is locked once people register');
select pg_temp.login('00000000-0000-0000-0000-0000000005a2');
select is((select jsonb_array_length(j->'prizes') from jsonb_array_elements(treasure_hunts_list()) j where j->>'id' = current_setting('t.h')), 2, 'members see the prizes');
select pg_temp.admin();
select is((select file_size_limit from storage.buckets where id = 'hunt-prizes'), 20971520::bigint, 'the prize bucket limits files to 20 MB');

select * from finish();
rollback;
