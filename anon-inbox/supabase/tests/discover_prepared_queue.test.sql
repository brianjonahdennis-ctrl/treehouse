-- Prepared Discover results keep migration 31's cards/order while screening against live safety state.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

create function pg_temp.seed_discover_profile(
  p_id uuid, p_handle text, p_gender public.dating_gender, p_age integer,
  p_last_seen timestamptz, p_interested_in public.dating_gender[], p_state text default 'Lagos',
  p_birth_date date default null
) returns void language plpgsql as $$
begin
  insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at)
  values (p_id, p_handle || '@discover-queue.test.invalid', 'authenticated', 'authenticated', now(), now(), now());
  insert into public.dating_profiles
    (user_id, name, gender, age, birth_date, location, intent, handle, state, interested_in,
     min_age, max_age, last_seen_at)
  values
    (p_id, p_handle, p_gender, p_age, p_birth_date, p_state, 'love', p_handle, p_state,
     p_interested_in, 18, 60, p_last_seen);
end $$;

create function pg_temp.login(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $$;

select pg_temp.seed_discover_profile('00000000-0000-0000-0000-00000000d101', 'dq_member', 'female', 30,
  now(), array['male']::public.dating_gender[], 'Lagos', (current_date - interval '30 years 1 month')::date);
select pg_temp.seed_discover_profile('00000000-0000-0000-0000-00000000d102', 'dq_recent_1', 'male', 28,
  now() - interval '1 minute', array['female']::public.dating_gender[], 'Lagos', (current_date - interval '28 years 1 month')::date);
select pg_temp.seed_discover_profile('00000000-0000-0000-0000-00000000d103', 'dq_recent_2', 'male', 32,
  now() - interval '2 minutes', array['female']::public.dating_gender[], 'Lagos', (current_date - interval '32 years 1 month')::date);
select pg_temp.seed_discover_profile('00000000-0000-0000-0000-00000000d104', 'dq_liker_old', 'male', 35,
  now() - interval '45 days', array['female']::public.dating_gender[], 'Lagos', (current_date - interval '35 years 1 month')::date);
select pg_temp.seed_discover_profile('00000000-0000-0000-0000-00000000d105', 'dq_passed', 'male', 25,
  now() - interval '3 minutes', array['female']::public.dating_gender[], 'Lagos', (current_date - interval '25 years 1 month')::date);
select pg_temp.seed_discover_profile('00000000-0000-0000-0000-00000000d106', 'dq_blocked', 'male', 26,
  now() - interval '4 minutes', array['female']::public.dating_gender[], 'Lagos', (current_date - interval '26 years 1 month')::date);
select pg_temp.seed_discover_profile('00000000-0000-0000-0000-00000000d107', 'dq_suspended', 'male', 29,
  now() - interval '5 minutes', array['female']::public.dating_gender[], 'Lagos', (current_date - interval '29 years 1 month')::date);
select pg_temp.seed_discover_profile('00000000-0000-0000-0000-00000000d108', 'dq_conversation', 'male', 31,
  now() - interval '6 minutes', array['female']::public.dating_gender[], 'Lagos', (current_date - interval '31 years 1 month')::date);
select pg_temp.seed_discover_profile('00000000-0000-0000-0000-00000000d109', 'dq_underage', 'male', 24,
  now() - interval '7 minutes', array['female']::public.dating_gender[], 'Lagos', (current_date - interval '24 years 1 month')::date);
select pg_temp.seed_discover_profile('00000000-0000-0000-0000-00000000d110', 'dq_wrong_state', 'male', 27,
  now() - interval '8 minutes', array['female']::public.dating_gender[], 'Abuja', (current_date - interval '27 years 1 month')::date);
select pg_temp.seed_discover_profile('00000000-0000-0000-0000-00000000d111', 'dq_new_liker', 'male', 33,
  now() - interval '50 days', array['female']::public.dating_gender[], 'Lagos', (current_date - interval '33 years 1 month')::date);
select pg_temp.seed_discover_profile('00000000-0000-0000-0000-00000000d112', 'dq_no_dob', 'male', 30,
  now(), array['female']::public.dating_gender[], 'Lagos', null);

select pg_temp.login('00000000-0000-0000-0000-00000000d101');
select set_config('role', 'postgres', true);
select is(
  array(select q.handle from dating_private.discover_cards_inner(10, '{}'::text[])
    with ordinality as q(handle, gender, age, location, intent, bio, interests, online, active_hours, ord) order by q.ord),
  array(select q.handle from public.discover_cards(10, '{}'::text[])
    with ordinality as q(handle, gender, age, location, intent, bio, interests, online, active_hours, ord) order by q.ord),
  'First cached page matches the existing function''s people and order'
);
select is(
  array(select q.handle from dating_private.discover_cards_inner(2, '{}'::text[])
    with ordinality as q(handle, gender, age, location, intent, bio, interests, online, active_hours, ord) order by q.ord),
  array(select q.handle from public.discover_cards(2, '{}'::text[])
    with ordinality as q(handle, gender, age, location, intent, bio, interests, online, active_hours, ord) order by q.ord),
  'Small home-screen page sizes keep the old selection and order too'
);
select ok((select count(*) <= 200 from dating_private.discover_queue where user_id = auth.uid()),
  'Only about 200 source candidates are stored per member');
select ok(not has_table_privilege('authenticated', 'dating_private.discover_queue', 'SELECT'),
  'Members cannot read the private queue directly');

select pg_temp.admin();
insert into public.dating_likes (from_user, to_user, liked)
values ('00000000-0000-0000-0000-00000000d104', '00000000-0000-0000-0000-00000000d101', true);
insert into public.dating_likes (from_user, to_user, liked)
values ('00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-00000000d105', false);
insert into public.dating_blocks (blocker_id, blocked_id)
values ('00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-00000000d106');
insert into public.dating_conversations (user_a, user_b)
values ('00000000-0000-0000-0000-00000000d101', '00000000-0000-0000-0000-00000000d108');
update public.dating_profiles set suspended = true where user_id = '00000000-0000-0000-0000-00000000d107';
update public.dating_profiles set birth_date = (current_date - interval '17 years')::date
where user_id = '00000000-0000-0000-0000-00000000d109';
select pg_temp.login('00000000-0000-0000-0000-00000000d101');
select set_config('role', 'postgres', true);

select is((select count(*)::integer from public.discover_cards(50, '{}'::text[]) where handle = 'dq_passed'), 0,
  'A pass is rechecked and removed');
select is((select count(*)::integer from public.discover_cards(50, '{}'::text[]) where handle = 'dq_blocked'), 0,
  'A new block is rechecked and removed');
select is((select count(*)::integer from public.discover_cards(50, '{}'::text[]) where handle = 'dq_suspended'), 0,
  'A newly suspended profile is rechecked and removed');
select is((select count(*)::integer from public.discover_cards(50, '{}'::text[]) where handle = 'dq_conversation'), 0,
  'A new conversation is rechecked and removed');
select is((select count(*)::integer from public.discover_cards(50, '{}'::text[]) where handle = 'dq_underage'), 0,
  'An under-18 profile stays out of Discover');
select is((select count(*)::integer from public.discover_cards(50, '{}'::text[]) where handle = 'dq_wrong_state'), 0,
  'The member''s state preference is preserved');

select pg_temp.admin();
insert into public.dating_likes (from_user, to_user, liked)
values ('00000000-0000-0000-0000-00000000d111', '00000000-0000-0000-0000-00000000d101', true);
select pg_temp.login('00000000-0000-0000-0000-00000000d101');
select set_config('role', 'postgres', true);
select ok((select count(*) = 1 from public.discover_cards(10, '{}'::text[]) where handle = 'dq_new_liker'),
  'A new incoming like appears without waiting for a queue rebuild');
select is(
  array(select q.handle from dating_private.discover_cards_inner(10, '{}'::text[])
    with ordinality as q(handle, gender, age, location, intent, bio, interests, online, active_hours, ord) order by q.ord),
  array(select q.handle from public.discover_cards(10, '{}'::text[])
    with ordinality as q(handle, gender, age, location, intent, bio, interests, online, active_hours, ord) order by q.ord),
  'Fresh incoming-like result still matches the existing order'
);

select pg_temp.admin();
delete from dating_private.discover_queue where user_id = '00000000-0000-0000-0000-00000000d101';
select pg_temp.login('00000000-0000-0000-0000-00000000d101');
select set_config('role', 'postgres', true);
select count(*) from public.discover_cards(10, '{}'::text[]);
select ok((select count(*) > 0 from dating_private.discover_queue where user_id = auth.uid()),
  'An empty queue refills when Discover is opened');

select set_config('test.old_pref', (select preference_fingerprint from dating_private.discover_queue_meta where user_id = auth.uid()), true);
update public.dating_profiles set pref_state = 'Abuja' where user_id = auth.uid();
select * from public.discover_cards(10, '{}'::text[]);
select ok((select preference_fingerprint <> current_setting('test.old_pref')
  from dating_private.discover_queue_meta where user_id = auth.uid()), 'Changing preferences rebuilds the queue');
select is((select count(*)::integer from public.discover_cards(10, '{}'::text[])), 0,
  'The rebuilt queue uses the new state preference');

select pg_temp.login('00000000-0000-0000-0000-00000000d112');
select throws_ok('select * from public.discover_cards(10, array[]::text[])', '42501',
  'Add your date of birth first. It’s private, and keeps treehouse 18+.',
  'The existing date-of-birth lock still applies');

select pg_temp.admin();
select * from finish();
rollback;
