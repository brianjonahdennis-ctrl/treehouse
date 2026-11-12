-- The owner's dating stats: key required, counts only.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

insert into dating_private.admin_key values (encode(extensions.digest('test-admin-key', 'sha256'), 'hex'));
insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a5', 's1@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}', true);
select create_my_profile('Stella Secretname', 'female', 27, 'Port Harcourt', 'marriage');
select set_config('role', 'postgres', true);
select set_config('test.h', (select handle from dating_profiles where user_id = '00000000-0000-0000-0000-0000000000a5'), true);

select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select admin_dating_stats('wrong-key') $$, '42501', null, 'Dating stats need the admin key');
select ok((admin_dating_stats('test-admin-key', 7) -> 'totals' ->> 'profiles')::int >= 1, 'Stats count profiles');
select is(jsonb_array_length(admin_dating_stats('test-admin-key', 7) -> 'daily'), 7, 'Daily rows cover the chosen range');
select ok(admin_dating_stats('test-admin-key', 30)::text !~ 'Secretname', 'Stats never include names');
select ok(admin_dating_stats('test-admin-key', 30)::text !~ 'test\.invalid', 'Stats never include emails');
select ok(position(current_setting('test.h') in admin_dating_stats('test-admin-key', 30)::text) = 0, 'Stats never include handles');

select * from finish();
rollback;
