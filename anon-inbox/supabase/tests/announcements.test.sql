-- Product Announcements: roles, validation, audience targeting, delivery (no duplicates, batches,
-- large audience), push rules, read/archive/click per person, scheduling and cancelling, corrections,
-- analytics as counts only, audit log. Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(45);

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

-- Rivers people seen in the last day, before the test people exist.
select set_config('test.e0', (select count(*)::text from dating_private.ann_targets('{"base":"recent","days":1,"states":["Rivers"]}')), true);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-0000000a00' || n)::uuid, 'ann' || n || '@test.invalid', 'authenticated', 'authenticated', now(), now(), now()
from unnest(array['01','02','03','11','12','13','14','15','16']) n;

-- s1 super admin, s2 editor (no publish), s3 analyst; members m1..m6.
insert into dating_profiles (user_id, name, gender, age, intent, handle, state, last_seen_at, created_at) values
  ('00000000-0000-0000-0000-0000000a0001', 'Ann Sup', 'female', 30, 'love', 'anntest_sup', 'Lagos', now(), now() - interval '200 days'),
  ('00000000-0000-0000-0000-0000000a0002', 'Ann Edi', 'male', 30, 'love', 'anntest_edi', 'Lagos', now(), now() - interval '200 days'),
  ('00000000-0000-0000-0000-0000000a0003', 'Ann Ana', 'male', 30, 'love', 'anntest_ana', 'Lagos', now(), now() - interval '200 days'),
  ('00000000-0000-0000-0000-0000000a0011', 'Ann One', 'female', 25, 'love', 'anntest_m1', 'Lagos', now(), now() - interval '100 days'),
  ('00000000-0000-0000-0000-0000000a0012', 'Ann Two', 'male', 25, 'love', 'anntest_m2', 'Rivers', now(), now() - interval '100 days'),
  ('00000000-0000-0000-0000-0000000a0013', 'Ann Three', 'female', 25, 'love', 'anntest_m3', 'Rivers', now() - interval '60 days', now() - interval '100 days'),
  ('00000000-0000-0000-0000-0000000a0014', 'Ann Four', 'male', 25, 'love', 'anntest_m4', 'Rivers', now(), now() - interval '100 days'),
  ('00000000-0000-0000-0000-0000000a0015', 'Ann Five', 'female', 25, 'love', 'anntest_m5', 'Rivers', now(), now() - interval '100 days'),
  ('00000000-0000-0000-0000-0000000a0016', 'Ann Six', 'male', 25, 'love', 'anntest_m6', 'Kano', now(), now() - interval '1 day');
update dating_profiles set suspended = true where user_id = '00000000-0000-0000-0000-0000000a0014';
update dating_profiles set dob_underage_at = now() where user_id = '00000000-0000-0000-0000-0000000a0015';
insert into announcement_staff (user_id, role, can_publish) values
  ('00000000-0000-0000-0000-0000000a0001', 'super_admin', true),
  ('00000000-0000-0000-0000-0000000a0002', 'editor', false),
  ('00000000-0000-0000-0000-0000000a0003', 'analyst', false);
insert into push_subscriptions (endpoint, user_id, p256dh, auth) values
  ('https://push.test.invalid/ann-m1', '00000000-0000-0000-0000-0000000a0011', repeat('p', 60), repeat('a', 20)),
  ('https://push.test.invalid/ann-m2', '00000000-0000-0000-0000-0000000a0012', repeat('p', 60), repeat('a', 20));
insert into announcement_prefs (user_id, push_updates) values ('00000000-0000-0000-0000-0000000a0012', false);
insert into app_seen_days (day, platform, user_id) values ((now() at time zone 'Africa/Lagos')::date, 'ios-app', '00000000-0000-0000-0000-0000000a0016');

-- ---- Permissions -------------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000a0011');
select ok(ann_me() is null, 'A member is not staff');
select throws_ok('select ann_overview()', '42501', null, 'A member cannot open the dashboard');
select throws_ok($$select ann_save(null, '{"title":"x","preview":"y","category":"event"}')$$, '42501', null, 'A member cannot create announcements');

select pg_temp.login('00000000-0000-0000-0000-0000000a0003');
select throws_ok($$select ann_save(null, '{"title":"x","preview":"y","category":"event"}')$$, '42501', null, 'An analyst cannot create announcements');
select lives_ok('select ann_overview()', 'An analyst can see the overview');

select pg_temp.login('00000000-0000-0000-0000-0000000a0002');
select set_config('test.ed', ann_save(null, '{"title":"Editor draft","preview":"Draft text","category":"community"}')::text, true);
select pg_temp.admin();
select is((select status from announcements where id = current_setting('test.ed')::uuid), 'draft', 'An editor can save a draft');
select pg_temp.login('00000000-0000-0000-0000-0000000a0002');
select throws_ok(format('select ann_publish(%L::uuid)', current_setting('test.ed')), '42501', null, 'An editor without publish permission cannot publish');
select throws_ok($$select ann_set_staff('anntest_m1', 'admin', true)$$, '42501', null, 'Only a Super Admin manages staff');

-- ---- Validation ---------------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000a0001');
select throws_ok($$select ann_save(null, '{"title":"x","preview":"y","category":"event","cta_label":"Go","cta_url":"javascript:alert(1)"}')$$, '22023', null, 'Script links are refused');
select throws_ok($$select ann_save(null, '{"title":"x","preview":"y","category":"event","cta_label":"Go","cta_url":"/home/secret-admin"}')$$, '22023', null, 'Unknown treehouse pages are refused');
select throws_ok($$select ann_save(null, '{"title":"x","preview":"y","category":"event","cta_label":"Go","cta_url":"http://example.com"}')$$, '22023', null, 'Plain http links are refused');
select throws_ok($$select ann_save(null, '{"title":"x","preview":"y","category":"event","body":"hi <script>x</script>"}')$$, '22023', null, 'Scripts in the content are refused');
select throws_ok($$select ann_save(null, '{"title":"x","preview":"y","category":"event","audience":{"base":"all","states":["Atlantis"]}}')$$, '22023', null, 'Unknown states are refused');
select lives_ok($$select ann_save(null, '{"title":"x","preview":"y","category":"event","cta_label":"Explore Nearby","cta_url":"/home/discover/nearby"}')$$, 'Approved treehouse pages are accepted');

-- ---- Audience -------------------------------------------------------------------------------------------
select is(ann_estimate('{"base":"recent","days":1,"states":["Rivers"]}'), current_setting('test.e0')::int + 1,
  'Estimate counts active Rivers people, leaving out inactive, suspended and under-18 accounts');
select pg_temp.admin();
select ok(exists (select 1 from dating_private.ann_targets('{"base":"new","days":7}') where user_id = '00000000-0000-0000-0000-0000000a0016')
  and not exists (select 1 from dating_private.ann_targets('{"base":"new","days":7}') where user_id = '00000000-0000-0000-0000-0000000a0013'),
  'New users: joined in the last 7 days only');
select ok(exists (select 1 from dating_private.ann_targets('{"base":"inactive","days":30}') where user_id = '00000000-0000-0000-0000-0000000a0013')
  and not exists (select 1 from dating_private.ann_targets('{"base":"inactive","days":30}') where user_id = '00000000-0000-0000-0000-0000000a0012'),
  'Inactive users: not seen for 30 days only');
select ok(exists (select 1 from dating_private.ann_targets('{"base":"all","platforms":["ios-app"]}') where user_id = '00000000-0000-0000-0000-0000000a0016')
  and not exists (select 1 from dating_private.ann_targets('{"base":"all","platforms":["ios-app"]}') where user_id = '00000000-0000-0000-0000-0000000a0011'),
  'Platform filter: iPhone app users only');

-- ---- Publish to a selected audience (Rivers, non-essential, push on) ------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000a0001');
select set_config('test.a', ann_save(null, '{"title":"Treehouse Beach Hangout","preview":"Games and music at Ibeno Beach","category":"event","body":"## Join us\n- Games\n- Music","cta_label":"Learn More","cta_url":"/home/rooms","audience":{"base":"recent","days":1,"states":["Rivers"]},"send_push":true}')::text, true);
select ann_publish(current_setting('test.a')::uuid);
select pg_temp.admin();
select is((select array_agg(user_id order by user_id)::text from announcement_deliveries where announcement_id = current_setting('test.a')::uuid and user_id::text like '00000000-0000-0000-0000-0000000a00%'),
  '{00000000-0000-0000-0000-0000000a0012}', 'Only the active, allowed Rivers member receives it');
select is((select status from announcements where id = current_setting('test.a')::uuid), 'published', 'A small audience is delivered at once');
select ok((select push_queued_at is null from announcement_deliveries where announcement_id = current_setting('test.a')::uuid and user_id = '00000000-0000-0000-0000-0000000a0012'),
  'No push for someone who turned treehouse updates off');

-- ---- Essential notice: push even with updates off; no duplicates on retry ---------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000a0001');
select set_config('test.b', ann_save(null, '{"title":"Scheduled maintenance","preview":"Offline 2-4 AM","category":"maintenance","audience":{"base":"recent","days":1,"states":["Lagos","Rivers"]}}')::text, true);
select ann_publish(current_setting('test.b')::uuid);
select pg_temp.admin();
select is((select count(*)::int from dating_private.push_outbox where kind = 'announcement' and url = '/home/matches/announcements/' || current_setting('test.b')
  and user_id in ('00000000-0000-0000-0000-0000000a0011', '00000000-0000-0000-0000-0000000a0012')), 2, 'Essential notices push to both members with a phone');
update announcements set status = 'publishing', delivery_cursor = null where id = current_setting('test.b')::uuid;
select dating_private.ann_deliver_batch(current_setting('test.b')::uuid);
select is((select count(*)::int from announcement_deliveries where announcement_id = current_setting('test.b')::uuid and user_id = '00000000-0000-0000-0000-0000000a0011'), 1, 'A retry makes no duplicate delivery');
select is((select count(*)::int from dating_private.push_outbox where kind = 'announcement' and url = '/home/matches/announcements/' || current_setting('test.b')
  and user_id = '00000000-0000-0000-0000-0000000a0011'), 1, 'A retry sends no second push');

-- ---- Member: unread, open, read filter, mark all, archive, click ------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000a0012');
select is(my_announcements_unread(), 2, 'The member has two unread announcements');
select is((open_announcement(current_setting('test.a')::uuid) ->> 'title'), 'Treehouse Beach Hangout', 'The member can open it');
select is(my_announcements_unread(), 1, 'Opening marks it read');
select is((select count(*)::int from my_announcements('read') where id = current_setting('test.a')::uuid), 1, 'The Read filter shows it');
select is((select count(*)::int from my_announcements('unread')), 1, 'The Unread filter shows the other one');
select is(mark_all_announcements_read(), 1, 'Mark all read');
select mark_announcement(current_setting('test.a')::uuid, 'click');
select mark_announcement(current_setting('test.a')::uuid, 'archive');
select ok(not exists (select 1 from my_announcements('all') where id = current_setting('test.a')::uuid)
  and exists (select 1 from my_announcements('archived') where id = current_setting('test.a')::uuid), 'Archiving only moves it in my own view');
select pg_temp.login('00000000-0000-0000-0000-0000000a0011');
select throws_ok(format('select open_announcement(%L::uuid)', current_setting('test.a')), 'P0002', null, 'Someone outside the audience cannot open it');

-- ---- Published announcements are never rewritten; corrections are new ----------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000a0001');
select throws_ok(format($$select ann_save(%L::uuid, '{"title":"Changed","preview":"y","category":"event"}')$$, current_setting('test.a')), '42501', null, 'A published announcement cannot be edited');
select set_config('test.c', ann_correction(current_setting('test.a')::uuid)::text, true);
select pg_temp.admin();
select ok((select revises = current_setting('test.a')::uuid and status = 'draft' from announcements where id = current_setting('test.c')::uuid)
  and (select title from announcements where id = current_setting('test.a')::uuid) = 'Treehouse Beach Hangout', 'A correction is a new linked draft; the original stays');
select pg_temp.login('00000000-0000-0000-0000-0000000a0001');

-- ---- Schedule, cancel, scheduled publishing ----------------------------------------------------------------
select set_config('test.s', ann_save(null, '{"title":"Game night","preview":"Friday","category":"event","audience":{"base":"all","states":["Kano"]}}')::text, true);
select is((ann_publish(current_setting('test.s')::uuid, now() + interval '1 hour') ->> 'status'), 'scheduled', 'It can be scheduled');
select ann_cancel(current_setting('test.s')::uuid);
select is((ann_get(current_setting('test.s')::uuid) ->> 'status'), 'draft', 'Cancelling returns it to Drafts');
select throws_ok(format('select ann_cancel(%L::uuid)', current_setting('test.a')), '42501', null, 'A published announcement cannot be cancelled');
select ann_publish(current_setting('test.s')::uuid, now() + interval '1 hour');
select pg_temp.admin();
select is((select count(*)::int from announcement_deliveries where announcement_id = current_setting('test.s')::uuid), 0, 'Nothing is delivered before the time');
update announcements set scheduled_for = now() - interval '1 minute' where id = current_setting('test.s')::uuid;
select dating_private.ann_tick();
select ok((select status in ('publishing', 'published') from announcements where id = current_setting('test.s')::uuid)
  and exists (select 1 from announcement_deliveries where announcement_id = current_setting('test.s')::uuid and user_id = '00000000-0000-0000-0000-0000000a0016'),
  'The minute job publishes it when due');

-- ---- Large audience: all active users, in batches ----------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000a0001');
select set_config('test.l', ann_save(null, '{"title":"Introducing Nearby!","preview":"Discover people around you","category":"feature_launch","audience":{"base":"active"},"send_push":false}')::text, true);
select ann_publish(current_setting('test.l')::uuid);
select pg_temp.admin();
select is((select delivered_count from announcements where id = current_setting('test.l')::uuid), 5000, 'Publishing delivers the first 5,000 straight away');
select dating_private.ann_tick();
select dating_private.ann_tick();
select ok((select status = 'published' and delivered_count = eligible_count and eligible_count > 5000 from announcements where id = current_setting('test.l')::uuid),
  'The minute job finishes the whole audience');
select is((select count(*) - count(distinct user_id) from announcement_deliveries where announcement_id = current_setting('test.l')::uuid), 0::bigint, 'No one gets it twice');

-- ---- Analytics: counts only ---------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000a0003');
select ok((select (j ->> 'delivered')::int = (j ->> 'targeted')::int and (j ->> 'reads')::int >= 1 and (j ->> 'clicks')::int >= 1 and (j ->> 'pending')::int = 0
  from ann_analytics(current_setting('test.a')::uuid) j), 'Analytics: everyone targeted got it, with the read and the button tap counted');
select ok(not (ann_analytics(current_setting('test.a')::uuid)::text ~ 'anntest_m'), 'Analytics never names recipients');
select ok(exists (select 1 from ann_audit_log(current_setting('test.a')::uuid) where action = 'published' and actor_handle = 'anntest_sup'), 'The audit log records who published');

select pg_temp.admin();
select * from finish();
rollback;
