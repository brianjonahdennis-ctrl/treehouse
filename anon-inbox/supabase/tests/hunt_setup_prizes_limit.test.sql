-- Hunt setup part 2: prizes from the app's own setup screen, and the participant limit (migration 20261118140000).
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(20);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000006a1', 'hp1@test.invalid', 'authenticated', 'authenticated', now(), now(), now());
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
select pg_temp.login('00000000-0000-0000-0000-0000000006a1');
select create_my_profile('Plain Robin 611', 'female', (current_date - interval '25 years')::date, '', 'fun');
select pg_temp.admin();
select set_config('t.url', 'https://ctyyxxermexmcknhfmtl.supabase.co/storage/v1/object/public/hunt-prizes/prizes/test-x.jpg', true);

-- Hydra's own app (no authenticator step) can create a hunt with a state and add prizes.
select pg_temp.login('7cbd08d2-d6b1-4ccc-bb0d-738c1bb6d299');
select set_config('t.h', staff_treasure_hunt_save_routes_personal(
  jsonb_build_object('title','App setup test','region','Ikeja, Lagos','state','Lagos','status','draft','starts_at',now() + interval '1 day','ends_at',now() + interval '2 day'),
  '[{"sequence":1,"name":"Stop one","latitude":6.6,"longitude":3.35}]', '[]', '[{"sequence":1,"name":"Prize spot","latitude":6.6,"longitude":3.35}]')::text, true);
select pg_temp.admin();
select is((select state from treasure_hunts where id = current_setting('t.h')::uuid), 'Lagos', 'the in-app setup saves the hunt state');
select pg_temp.login('7cbd08d2-d6b1-4ccc-bb0d-738c1bb6d299');
select lives_ok($$ select staff_treasure_hunt_prizes_save_personal(current_setting('t.h')::uuid, jsonb_build_array(jsonb_build_object('place',1,'title','Phone','media_type','image','media_url',current_setting('t.url')))) $$, 'Hydra can save prizes from the app');
select pg_temp.login('7cbd08d2-d6b1-4ccc-bb0d-738c1bb6d299');
select ok(dating_private.treasure_hunt_personal_admin_ok(), 'Hydra passes the storage check from the app');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('hunt-prizes', 'prizes/test-app-upload.jpg') $$, 'Hydra can upload a prize file from the app');
select pg_temp.admin();
select is((select count(*)::int from treasure_hunt_prizes where hunt_id = current_setting('t.h')::uuid), 1, 'the prize was stored');

-- Anyone else can't.
select pg_temp.login('00000000-0000-0000-0000-0000000006a1');
select ok(not dating_private.treasure_hunt_personal_admin_ok(), 'a member does not pass the storage check');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('hunt-prizes', 'prizes/test-member.jpg') $$, '42501', null, 'a member cannot upload prize files');
select pg_temp.login('00000000-0000-0000-0000-0000000006a1');
select throws_ok($$ select staff_treasure_hunt_prizes_save_personal(current_setting('t.h')::uuid, '[]') $$, '42501', 'Not allowed.', 'a member cannot save prizes');

-- Participant limit: 10 to 1,000, full hunts refuse new registrations, never below who's registered.
select pg_temp.admin();
do $$
declare i int;
begin
  for i in 1..11 loop
    insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at)
    values (('00000000-0000-0000-0000-0000000007' || lpad(i::text, 2, '0'))::uuid, 'lim' || i || '@test.invalid', 'authenticated', 'authenticated', now(), now(), now());
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000007' || lpad(i::text, 2, '0'), 'role', 'authenticated')::text, true);
    perform create_my_profile('Limit Tester', 'female', (current_date - interval '25 years')::date, '', 'fun');
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '', true);
  end loop;
end $$;
update dating_profiles set state = 'Lagos' where user_id::text like '00000000-0000-0000-0000-0000000007__';
update treasure_hunts set status = 'scheduled' where id = current_setting('t.h')::uuid;
select pg_temp.login('7cbd08d2-d6b1-4ccc-bb0d-738c1bb6d299');
select throws_ok($$ select staff_treasure_hunt_save_routes_personal(jsonb_build_object('id', current_setting('t.h'), 'title','App setup test','region','Ikeja, Lagos','state','Lagos','status','scheduled','starts_at',now() + interval '1 day','ends_at',now() + interval '2 day','max_registrations',5), '[{"sequence":1,"name":"Stop one","latitude":6.6,"longitude":3.35}]', '[]', '[{"sequence":1,"name":"Prize spot","latitude":6.6,"longitude":3.35}]') $$, '22023', 'The participant limit must be between 10 and 1,000.', 'a limit under 10 is refused');
select pg_temp.login('7cbd08d2-d6b1-4ccc-bb0d-738c1bb6d299');
select lives_ok($$ select staff_treasure_hunt_save_routes_personal(jsonb_build_object('id', current_setting('t.h'), 'title','App setup test','region','Ikeja, Lagos','state','Lagos','status','scheduled','starts_at',now() + interval '1 day','ends_at',now() + interval '2 day','max_registrations',10), '[{"sequence":1,"name":"Stop one","latitude":6.6,"longitude":3.35}]', '[]', '[{"sequence":1,"name":"Prize spot","latitude":6.6,"longitude":3.35}]') $$, 'a limit of 10 is saved');
select pg_temp.admin();
select is((select max_registrations from treasure_hunts where id = current_setting('t.h')::uuid), 10, 'the hunt keeps its limit');
do $$
declare i int;
begin
  for i in 1..10 loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000007' || lpad(i::text, 2, '0'), 'role', 'authenticated')::text, true);
    perform treasure_hunt_register(current_setting('t.h')::uuid);
  end loop;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
select is((select count(*)::int from treasure_hunt_registrations where hunt_id = current_setting('t.h')::uuid), 10, 'ten people fill the ten places');
select pg_temp.login('00000000-0000-0000-0000-000000000711');
select is((select (j->>'full')::boolean from jsonb_array_elements(treasure_hunts_list()) j where j->>'id' = current_setting('t.h')), true, 'members see the hunt is full');
select throws_ok($$ select treasure_hunt_register(current_setting('t.h')::uuid) $$, '42501', 'This hunt is full: all 10 places are taken.', 'the 11th person cannot register');
select pg_temp.admin();
select throws_ok($$ insert into treasure_hunt_registrations (hunt_id, user_id, state) values (current_setting('t.h')::uuid, '00000000-0000-0000-0000-000000000711', 'x') $$, '42501', 'This hunt is full: all 10 places are taken.', 'the table trigger also refuses an 11th registration');
select pg_temp.login('00000000-0000-0000-0000-000000000701');
select is((treasure_hunt_register(current_setting('t.h')::uuid)->>'registered_count'), '10', 'someone already registered still sees their place');
select pg_temp.login('7cbd08d2-d6b1-4ccc-bb0d-738c1bb6d299');
select lives_ok($$ select staff_treasure_hunt_save_routes_personal(jsonb_build_object('id', current_setting('t.h'), 'title','App setup test','region','Ikeja, Lagos','state','Lagos','status','scheduled','starts_at',now() + interval '1 day','ends_at',now() + interval '2 day','max_registrations',20), '[{"sequence":1,"name":"Stop one","latitude":6.6,"longitude":3.35}]', '[]', '[{"sequence":1,"name":"Prize spot","latitude":6.6,"longitude":3.35}]') $$, 'the limit can be raised after people register');
select pg_temp.login('00000000-0000-0000-0000-000000000711');
select is((treasure_hunt_register(current_setting('t.h')::uuid)->>'registered_count'), '11', 'after raising the limit the next person can register');
select pg_temp.login('7cbd08d2-d6b1-4ccc-bb0d-738c1bb6d299');
select throws_ok($$ select staff_treasure_hunt_save_routes_personal(jsonb_build_object('id', current_setting('t.h'), 'title','App setup test','region','Ikeja, Lagos','state','Lagos','status','scheduled','starts_at',now() + interval '1 day','ends_at',now() + interval '2 day','max_registrations',10), '[{"sequence":1,"name":"Stop one","latitude":6.6,"longitude":3.35}]', '[]', '[{"sequence":1,"name":"Prize spot","latitude":6.6,"longitude":3.35}]') $$, '42501', '11 people have already registered, so the limit can''t be lower than 11.', 'the limit cannot go below the people registered');
select pg_temp.admin();
select ok(exists (select 1 from pg_constraint where conname like 'treasure_hunts_max_registrations%'), 'the 10 to 1,000 range is a table rule too');

select * from finish();
rollback;
