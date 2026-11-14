-- Staff console (admin.treehouse.ng): roles, the authenticator step, audit log, members, reports,
-- private chats (reported only, any for Super Admin with a reason), rooms, ads, referrals, settings,
-- staff. Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(68);

create function pg_temp.login(uid text, aal text default 'aal2') returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', aal)::text, true);
end $$;
create function pg_temp.admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000c00' || n)::uuid, 'staff' || n || '@test.invalid', 'authenticated', 'authenticated', now(),
       case when n in ('25', '26') then now() else now() - interval '100 days' end, now()
from unnest(array['01','02','03','04','05','21','22','23','24','25','26']) n;

-- s super admin, a admin, m moderator, e editor, n analyst; members u1..u4; u5 and u6 are brand new.
insert into dating_profiles (user_id, name, gender, age, intent, handle, state, last_seen_at, created_at) values
  ('00000000-0000-0000-0000-0000000c0001', 'Sue Per', 'female', 30, 'love', 'sctest_s', 'Lagos', now(), now() - interval '100 days'),
  ('00000000-0000-0000-0000-0000000c0002', 'Ad Min', 'male', 30, 'love', 'sctest_a', 'Lagos', now(), now() - interval '100 days'),
  ('00000000-0000-0000-0000-0000000c0003', 'Mo Der', 'female', 30, 'love', 'sctest_m', 'Lagos', now(), now() - interval '100 days'),
  ('00000000-0000-0000-0000-0000000c0004', 'Ed Itor', 'male', 30, 'love', 'sctest_e', 'Lagos', now(), now() - interval '100 days'),
  ('00000000-0000-0000-0000-0000000c0005', 'An Alyst', 'male', 30, 'love', 'sctest_n', 'Lagos', now(), now() - interval '100 days'),
  ('00000000-0000-0000-0000-0000000c0021', 'Uno One', 'male', 27, 'love', 'sctest_u1', 'Lagos', now(), now() - interval '100 days'),
  ('00000000-0000-0000-0000-0000000c0022', 'Duo Two', 'female', 26, 'love', 'sctest_u2', 'Lagos', now(), now() - interval '100 days'),
  ('00000000-0000-0000-0000-0000000c0023', 'Tri Three', 'female', 24, 'love', 'sctest_u3', 'Lagos', now(), now() - interval '100 days'),
  ('00000000-0000-0000-0000-0000000c0024', 'Qua Four', 'male', 40, 'love', 'sctest_u4', 'Kano', now(), now() - interval '100 days'),
  ('00000000-0000-0000-0000-0000000c0025', 'Pen Five', 'female', 22, 'love', 'sctest_u5', 'Lagos', now(), now());
insert into announcement_staff (user_id, role, can_publish) values
  ('00000000-0000-0000-0000-0000000c0001', 'super_admin', true),
  ('00000000-0000-0000-0000-0000000c0002', 'admin', true),
  ('00000000-0000-0000-0000-0000000c0003', 'moderator', false),
  ('00000000-0000-0000-0000-0000000c0004', 'editor', true),
  ('00000000-0000-0000-0000-0000000c0005', 'analyst', false);

-- A reported chat (u2 reported u1) and a chat nobody reported (u3 and u4).
insert into dating_conversations (id, user_a, user_b, started_by, accepted_at, kind) values
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-0000000c0021', '00000000-0000-0000-0000-0000000c0022', '00000000-0000-0000-0000-0000000c0021', now(), 'dating'),
  ('00000000-0000-0000-0000-00000000cc02', '00000000-0000-0000-0000-0000000c0023', '00000000-0000-0000-0000-0000000c0024', '00000000-0000-0000-0000-0000000c0023', now(), 'dating');
insert into dating_messages (conversation_id, sender_id, body, created_at) values
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-0000000c0021', 'hello there', now() - interval '10 minutes'),
  ('00000000-0000-0000-0000-00000000cc01', '00000000-0000-0000-0000-0000000c0022', 'hi', now() - interval '9 minutes'),
  ('00000000-0000-0000-0000-00000000cc02', '00000000-0000-0000-0000-0000000c0023', 'private words', now() - interval '5 minutes');
insert into dating_reports (reporter_id, reported_id, conversation_id, reason, details) values
  ('00000000-0000-0000-0000-0000000c0022', '00000000-0000-0000-0000-0000000c0021', '00000000-0000-0000-0000-00000000cc01', 'harassment', 'rude');
select set_config('test.rep', (select id::text from dating_reports where conversation_id = '00000000-0000-0000-0000-00000000cc01'), true);

-- A reported room message from u1 in Lagos.
insert into room_messages (state, user_id, handle, body) values ('Lagos', '00000000-0000-0000-0000-0000000c0021', 'Room Uno', 'buy my thing');
select set_config('test.rmsg', (select max(id)::text from room_messages where user_id = '00000000-0000-0000-0000-0000000c0021'), true);
insert into room_reports (message_id, reporter, reason) values (current_setting('test.rmsg')::bigint, '00000000-0000-0000-0000-0000000c0022', 'spam');

-- ---- Who may come in ---------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000c0021');
select is(staff_me(), null, 'a member is not staff');
select throws_ok($$ select staff_dashboard(7) $$, '42501', 'Not allowed.', 'members can''t open the dashboard');

select pg_temp.login('00000000-0000-0000-0000-0000000c0005', 'aal1');
select is((staff_me() ->> 'mfa')::boolean, false, 'staff before the authenticator step: mfa false');
select throws_ok($$ select staff_dashboard(7) $$, '42501', 'Enter the code from your authenticator app first.', 'no console without the authenticator step');

select pg_temp.login('00000000-0000-0000-0000-0000000c0005');
select ok(staff_dashboard(7) ? 'profiles', 'analyst with the authenticator step sees the dashboard');
select ok(staff_dashboard(7) ? 'dating', 'dashboard reuses the existing admin stats');
select pg_temp.admin();
select is(dating_private.admin_ok(null), false, 'the admin-key bypass ends with the call');
select pg_temp.login('00000000-0000-0000-0000-0000000c0005');
select throws_ok($$ select staff_members('', 'all', 10, 0) $$, '42501', 'Your role doesn’t allow this.', 'analysts can''t list members');
select ok(not has_function_privilege('anon', 'public.staff_dashboard(int)', 'execute'), 'signed-out visitors can''t call staff functions');

-- ---- Members ----------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000c0003');
select ok(jsonb_array_length(staff_members('sctest_u', 'all', 50, 0)) >= 5, 'moderator searches members by handle');
select is(jsonb_array_length(staff_members('sctest_u', 'reported', 50, 0)), 1, 'reported filter finds u1');
select ok(not (staff_member('sctest_u1') ? 'email'), 'moderators don''t see emails or real names');
select pg_temp.admin();
select ok(exists (select 1 from dating_private.staff_audit where action = 'view_member' and target_id = 'sctest_u1'), 'opening a member is logged');
select pg_temp.login('00000000-0000-0000-0000-0000000c0003');
select throws_ok($$ select staff_member_suspend('sctest_u1', true, '') $$, '22023', 'Give a reason.', 'suspending needs a reason');
select lives_ok($$ select staff_member_suspend('sctest_u1', true, 'harassment in chat') $$, 'moderator suspends');
select pg_temp.admin();
select is((select suspended from dating_profiles where handle = 'sctest_u1'), true, 'suspension sticks (runs as the system, past the profile guard)');
select is((select status from dating_reports where id = current_setting('test.rep')::bigint), 'actioned', 'open reports against them are marked actioned');
select pg_temp.login('00000000-0000-0000-0000-0000000c0003');
select lives_ok($$ select staff_member_suspend('sctest_u1', false) $$, 'moderator lifts the suspension');
select throws_ok($$ select staff_member_suspend('sctest_a', true, 'testing') $$, '42501', 'Only a Super Admin can suspend a staff member.', 'moderators can''t suspend staff');
select lives_ok($$ select staff_room_ban('sctest_u3', 24, 'spamming links') $$, 'moderator bans from rooms');
select pg_temp.admin();
select ok(dating_private.room_block('00000000-0000-0000-0000-0000000c0023') is not null, 'the room ban is in force');
select pg_temp.login('00000000-0000-0000-0000-0000000c0003');
select lives_ok($$ select staff_room_ban('sctest_u3', 0) $$, 'moderator lifts the room ban');
select pg_temp.admin();
select ok(dating_private.room_block('00000000-0000-0000-0000-0000000c0023') is null, 'the room ban is gone');
update dating_profiles set age_changed_at = now() where handle = 'sctest_u3';
select pg_temp.login('00000000-0000-0000-0000-0000000c0003');
select lives_ok($$ select staff_member_reset_dob_clock('sctest_u3') $$, 'moderator resets the date-of-birth clock');
select pg_temp.admin();
select is((select age_changed_at from dating_profiles where handle = 'sctest_u3'), null, 'the clock is reset');
select pg_temp.login('00000000-0000-0000-0000-0000000c0003');
select throws_ok($$ select staff_member_block_sign_in('sctest_u4', true, 'scam') $$, '42501', 'Your role doesn’t allow this.', 'moderators can''t block sign-in');
select pg_temp.login('00000000-0000-0000-0000-0000000c0002');
select ok(staff_member('sctest_u1') ? 'email', 'admins see emails');
select lives_ok($$ select staff_member_block_sign_in('sctest_u4', true, 'scam') $$, 'admin blocks sign-in');
select throws_ok($$ select staff_member_delete('sctest_u4', 'scam') $$, '42501', 'Your role doesn’t allow this.', 'only Super Admin deletes accounts');

-- ---- Reports and private chats ----------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000c0003');
select is(jsonb_array_length(staff_reports('chat', 'actioned', 50, null)), 1, 'moderator sees chat reports');
select is(jsonb_array_length(staff_report_context('chat', current_setting('test.rep')::bigint) -> 'messages'), 2, 'report context shows the reported chat');
select pg_temp.admin();
select ok(exists (select 1 from dating_private.staff_audit where action = 'view_reported_chat'), 'opening a reported chat is logged');
select pg_temp.login('00000000-0000-0000-0000-0000000c0003');
select lives_ok($$ select staff_chat('00000000-0000-0000-0000-00000000cc01') $$, 'moderators open reported chats');
select throws_ok($$ select staff_chat('00000000-0000-0000-0000-00000000cc02') $$, '42501', 'Your role doesn’t allow this.', 'moderators can''t open chats nobody reported');
select is(dating_private.staff_photo_ok('00000000-0000-0000-0000-00000000cc01/00000000-0000-0000-0000-000000000001.jpg'), true, 'moderators may open photos in reported chats');
select is(dating_private.staff_photo_ok('00000000-0000-0000-0000-00000000cc02/00000000-0000-0000-0000-000000000001.jpg'), false, 'but not in other chats');
select pg_temp.login('00000000-0000-0000-0000-0000000c0002');
select throws_ok($$ select staff_member_chats('sctest_u3') $$, '42501', 'Your role doesn’t allow this.', 'admins can''t list someone''s chats');
select pg_temp.login('00000000-0000-0000-0000-0000000c0001');
select is(jsonb_array_length(staff_member_chats('sctest_u3')), 1, 'Super Admin lists a member''s chats');
select throws_ok($$ select staff_chat('00000000-0000-0000-0000-00000000cc02') $$, '22023', 'Nobody reported this chat. Write why you need to open it.', 'Super Admin must give a reason');
select is(jsonb_array_length(staff_chat('00000000-0000-0000-0000-00000000cc02', 'police request ref 123') -> 'messages'), 1, 'Super Admin opens any chat with a reason');
select pg_temp.admin();
select is((select meta ->> 'basis' from dating_private.staff_audit where action = 'view_chat' and target_id = '00000000-0000-0000-0000-00000000cc02'), 'super_admin', 'and it is logged with the reason');

select pg_temp.login('00000000-0000-0000-0000-0000000c0003');
select is((staff_reports('room', 'open', 50, null) -> 0 ->> 'author'), 'sctest_u1', 'room reports show the author');
select lives_ok(format('select staff_room_delete_message(%s, %L)', current_setting('test.rmsg'), 'spam'), 'moderator removes a room message');
select pg_temp.admin();
select is((select count(*)::int from room_messages where id = current_setting('test.rmsg')::bigint), 0, 'the message is gone');

-- ---- Rooms -----------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000c0003');
select throws_ok($$ select staff_room_set('Lagos', true, 'x') $$, '42501', 'Your role doesn’t allow this.', 'moderators can''t close rooms');
select pg_temp.login('00000000-0000-0000-0000-0000000c0002');
select lives_ok($$ select staff_room_set('Lagos', true, 'Closed for maintenance.') $$, 'admin closes a room');
select pg_temp.admin();
select throws_ok($$ insert into room_members (user_id, state, handle) values ('00000000-0000-0000-0000-0000000c0022', 'Lagos', 'Room Duo') $$, 'P0001', 'Closed for maintenance.', 'nobody can join a closed room');
select pg_temp.login('00000000-0000-0000-0000-0000000c0002');
select lives_ok($$ select staff_room_set('Lagos', false) $$, 'admin reopens it');

-- ---- Ads -------------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000c0003');
select throws_ok($$ select staff_ad_save('{"name":"x","title":"x","cta_url":"https://a.ng"}') $$, '42501', 'Your role doesn’t allow this.', 'moderators can''t make ads');
select pg_temp.login('00000000-0000-0000-0000-0000000c0004');
select throws_ok($$ select staff_ad_save('{"name":"x","title":"x","cta_url":"http://a.ng"}') $$, '23514', null, 'ads need an https link');
select set_config('test.ad', staff_ad_save('{"name":"Suya promo","advertiser":"Suya Spot","title":"Best suya in Lagos","cta_url":"https://suya.example.ng","placements":["home","rooms"],"audience":{"states":["Lagos"]}}')::text, true);
select lives_ok(format('select staff_ad_status(%L, %L)', current_setting('test.ad'), 'active'), 'editor makes and starts an ad');
select pg_temp.login('00000000-0000-0000-0000-0000000c0022');
select is(ad_for('home') ->> 'title', 'Best suya in Lagos', 'a Lagos member sees it');
select ad_event(current_setting('test.ad')::uuid, 'home', 'view');
select ad_event(current_setting('test.ad')::uuid, 'home', 'view');
select ad_event(current_setting('test.ad')::uuid, 'home', 'tap');
select pg_temp.login('00000000-0000-0000-0000-0000000c0024');
select is(ad_for('home'), null, 'a Kano member doesn''t (targeting)');
select pg_temp.admin();
select is((select (views, taps)::text from dating_private.ad_daily where ad_id = current_setting('test.ad')::uuid), '(1,1)', 'one view and one tap per member per day');
update dating_private.app_settings set value = 'false' where key = 'ads_enabled';
select pg_temp.login('00000000-0000-0000-0000-0000000c0022');
select is(ad_for('home'), null, 'ads switched off: nothing shows');

-- ---- Referrals -------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000c0022');
select set_config('test.code', my_referral() ->> 'code', true);
select is(claim_referral(current_setting('test.code')), false, 'you can''t use your own code');
select pg_temp.login('00000000-0000-0000-0000-0000000c0023');
select is(claim_referral(current_setting('test.code')), false, 'old accounts can''t be referred');
select pg_temp.login('00000000-0000-0000-0000-0000000c0025');
select is(claim_referral(current_setting('test.code')), true, 'a new member joins with a code');
select is(claim_referral(current_setting('test.code')), false, 'only once');
select pg_temp.login('00000000-0000-0000-0000-0000000c0003');
select throws_ok($$ select staff_referral_campaign('lagosfair', 'Lagos fair flyers') $$, '42501', 'Your role doesn’t allow this.', 'moderators can''t make campaign codes');
select pg_temp.login('00000000-0000-0000-0000-0000000c0002');
select is((staff_referrals(30) -> 'top' -> 0 ->> 'joined')::int, 1, 'staff see who brought people in');

-- ---- Settings and staff ------------------------------------------------------------------------
select lives_ok($$ select staff_setting_set('signups_paused', 'true') $$, 'admin pauses sign-ups');
select pg_temp.admin();
select throws_ok($$ insert into dating_profiles (user_id, name, gender, age, intent, handle) values ('00000000-0000-0000-0000-0000000c0026', 'Six', 'male', 30, 'love', 'sctest_u6') $$,
  'P0001', 'New sign-ups are paused for a short while. Please try again later.', 'new profiles wait while sign-ups are paused');
select pg_temp.login('00000000-0000-0000-0000-0000000c0002');
select throws_ok($$ select staff_rating_set('min_raters', 3) $$, '42501', 'Your role doesn’t allow this.', 'only Super Admin changes rating rules');
select throws_ok($$ select staff_team_set('sctest_u4', 'moderator') $$, '42501', 'Your role doesn’t allow this.', 'only Super Admin manages staff');
select ok(jsonb_array_length(staff_audit_log(null, 'suspend', null, 50)) >= 1, 'admins read the audit log');
select pg_temp.login('00000000-0000-0000-0000-0000000c0001');
select lives_ok($$ select staff_team_set('sctest_u3', 'moderator') $$, 'Super Admin adds a moderator');
select throws_ok($$ select staff_team_set('sctest_s', 'admin') $$, '42501', 'You can’t lower your own role.', 'Super Admin can''t demote themselves');

select pg_temp.admin();
select * from finish();
rollback;
