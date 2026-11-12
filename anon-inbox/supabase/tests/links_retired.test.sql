-- Members' anonymous links are retired: nobody can claim one or send to one.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(3);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000aa', 'aa@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
select throws_ok($$ select claim_link('retired_test', 'Test') $$, '42501', null, 'Members can''t claim anonymous links any more');

select set_config('role', 'anon', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select send_link_message('anyone', 'hi') $$, '42501', null, 'Nobody can send to member links');
select throws_ok($$ select * from public_link('anyone') $$, '42501', null, 'Member link pages are closed');

select * from finish();
rollback;
