-- Weekly invite leaderboard and Man / Woman of the Week. Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

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
-- A time inside this week / last week (Lagos), a few hours after Monday 00:00.
create function pg_temp.this_week(h int) returns timestamptz language sql as $$
  select (dating_private.lagos_week()::timestamp at time zone 'Africa/Lagos') + make_interval(hours => h) $$;
create function pg_temp.last_week(h int) returns timestamptz language sql as $$
  select ((dating_private.lagos_week() - 7)::timestamp at time zone 'Africa/Lagos') + make_interval(hours => h) $$;

-- Inviters: a (man), b (woman) this week; c (woman), d (man) last week. Staff: s admin, m moderator.
insert into auth.users (id, email, created_at)
select ('00000000-0000-0000-0000-0000000d' || lpad(n::text, 4, '0'))::uuid, 'lb' || n || '@test.invalid', now() - interval '60 days'
from generate_series(1, 30) n;
insert into dating_profiles (user_id, name, gender, age, intent, handle, state, last_seen_at) values
  ('00000000-0000-0000-0000-0000000d0001', 'A', 'male', 30, 'love', 'lbtest_a', 'Lagos', now()),
  ('00000000-0000-0000-0000-0000000d0002', 'B', 'female', 30, 'love', 'lbtest_b', 'Lagos', now()),
  ('00000000-0000-0000-0000-0000000d0003', 'C', 'female', 30, 'love', 'lbtest_c', 'Lagos', now()),
  ('00000000-0000-0000-0000-0000000d0004', 'D', 'male', 30, 'love', 'lbtest_d', 'Lagos', now()),
  ('00000000-0000-0000-0000-0000000d0005', 'S', 'female', 30, 'love', 'lbtest_s', 'Lagos', now()),
  ('00000000-0000-0000-0000-0000000d0006', 'M', 'male', 30, 'love', 'lbtest_m', 'Lagos', now());
insert into announcement_staff (user_id, role) values ('00000000-0000-0000-0000-0000000d0005', 'admin'), ('00000000-0000-0000-0000-0000000d0006', 'moderator');
insert into dating_private.referral_codes (code, owner) values
  ('lbcodea', '00000000-0000-0000-0000-0000000d0001'), ('lbcodeb', '00000000-0000-0000-0000-0000000d0002'),
  ('lbcodec', '00000000-0000-0000-0000-0000000d0003'), ('lbcoded', '00000000-0000-0000-0000-0000000d0004');

-- Invitees 11..30. joined(h) = claimed h hours after Monday; seen = came back 13 h later (counts) or 1 h later (doesn't).
insert into dating_profiles (user_id, name, gender, age, intent, handle, state, last_seen_at, suspended)
select ('00000000-0000-0000-0000-0000000d' || lpad(n::text, 4, '0'))::uuid, 'N' || n, 'female', 25, 'fun', 'lbtest_n' || n, 'Oyo',
       case when n in (13, 23) then (case when n < 20 then pg_temp.this_week(2) else pg_temp.last_week(2) end) + interval '1 hour'
            when n < 20 then pg_temp.this_week(2) + interval '13 hours' else pg_temp.last_week(2) + interval '13 hours' end,
       n = 14
from generate_series(11, 30) n;
insert into dating_private.referrals (user_id, code, claimed_at) values
  -- this week: a gets 11, 12 (count), 13 (no come-back), 14 (suspended), 15 (counts) = 3; b gets 16, 17 = 2
  ('00000000-0000-0000-0000-0000000d0011', 'lbcodea', pg_temp.this_week(2)), ('00000000-0000-0000-0000-0000000d0012', 'lbcodea', pg_temp.this_week(2)),
  ('00000000-0000-0000-0000-0000000d0013', 'lbcodea', pg_temp.this_week(2)), ('00000000-0000-0000-0000-0000000d0014', 'lbcodea', pg_temp.this_week(2)),
  ('00000000-0000-0000-0000-0000000d0015', 'lbcodea', pg_temp.this_week(2)),
  ('00000000-0000-0000-0000-0000000d0016', 'lbcodeb', pg_temp.this_week(2)), ('00000000-0000-0000-0000-0000000d0017', 'lbcodeb', pg_temp.this_week(2)),
  -- last week: c gets 21, 22, 24, 25 = 4 (23 didn't come back); d gets 26, 27, 28 = 3
  ('00000000-0000-0000-0000-0000000d0021', 'lbcodec', pg_temp.last_week(2)), ('00000000-0000-0000-0000-0000000d0022', 'lbcodec', pg_temp.last_week(2)),
  ('00000000-0000-0000-0000-0000000d0023', 'lbcodec', pg_temp.last_week(2)), ('00000000-0000-0000-0000-0000000d0024', 'lbcodec', pg_temp.last_week(2)),
  ('00000000-0000-0000-0000-0000000d0025', 'lbcodec', pg_temp.last_week(2)),
  ('00000000-0000-0000-0000-0000000d0026', 'lbcoded', pg_temp.last_week(2)), ('00000000-0000-0000-0000-0000000d0027', 'lbcoded', pg_temp.last_week(2)),
  ('00000000-0000-0000-0000-0000000d0028', 'lbcoded', pg_temp.last_week(2));

-- ---- Members see the board ----------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000d0002', 'aal1');
select is((invite_leaderboard() -> 'top' -> 0 ->> 'handle'), 'lbtest_a', 'this week''s #1 is a');
select is((invite_leaderboard() -> 'top' -> 0 ->> 'invites')::int, 3, 'only real invites count (no come-back, suspended don''t)');
select is((invite_leaderboard() -> 'me' ->> 'rank')::int, 2, 'members see their own place');
select ok(not (invite_leaderboard() -> 'top' -> 0 ? 'user_id'), 'the board shows handles only');
select pg_temp.login('00000000-0000-0000-0000-0000000d0003', 'aal1');
select is(jsonb_array_length(invite_leaderboard() -> 'top'), 2, 'last week''s invites aren''t on this week''s board');

-- ---- Staff --------------------------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000d0006');
select throws_ok($$ select staff_invite_exclude('lbtest_a', 0, true, 'fake accounts') $$, '42501', 'Your role doesn’t allow this.', 'moderators can''t disqualify');
select pg_temp.login('00000000-0000-0000-0000-0000000d0005');
select is((staff_invite_week(1) -> 'top' -> 0 ->> 'title'), 'Woman of the Week', 'staff see last week''s leader and the title she''d get');
select lives_ok($$ select staff_invite_exclude('lbtest_a', 0, true, 'fake accounts') $$, 'admin disqualifies someone for this week');
select pg_temp.login('00000000-0000-0000-0000-0000000d0002', 'aal1');
select is((invite_leaderboard() -> 'top' -> 0 ->> 'handle'), 'lbtest_b', 'they drop off the board');

-- ---- Monday noon announcement -----------------------------------------------------------------
select pg_temp.admin();
update dating_private.app_settings set value = '10' where key = 'invite_winner_min';
select is((dating_private.invite_winner_announce() ->> 'announced')::boolean, false, 'no announcement below the minimum');
update dating_private.app_settings set value = '3' where key = 'invite_winner_min';
select is(dating_private.invite_winner_announce() ->> 'title', 'Woman of the Week', 'last week''s #1 is announced as Woman of the Week');
select is((select status || ' ' || category || ' ' || (audience ->> 'base') from announcements where id = (select announcement_id from dating_private.invite_winners where handle = 'lbtest_c')),
  'scheduled community all', 'as a community announcement to all members');
select ok(dating_private.ann_link_ok('/home/invite'), 'its button opens the leaderboard');
select is((dating_private.invite_winner_announce() ->> 'announced')::boolean, false, 'only once per week');
select dating_private.ann_tick();
select ok((select delivered_count from announcements where id = (select announcement_id from dating_private.invite_winners where handle = 'lbtest_c')) > 0, 'the minute job delivers it');
select pg_temp.login('00000000-0000-0000-0000-0000000d0004', 'aal1');
select is((invite_leaderboard() -> 'last_winner' ->> 'handle'), 'lbtest_c', 'the board shows last week''s winner');

select pg_temp.admin();
select * from finish();
rollback;
