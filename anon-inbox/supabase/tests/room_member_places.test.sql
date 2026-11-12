-- Chatroom member list: place and message-request eligibility, never real names or emails.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(4);

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-0000000000a9', 'a9@test.invalid', 'authenticated', 'authenticated', now(), now(), now()),
  ('00000000-0000-0000-0000-0000000000b9', 'b9@test.invalid', 'authenticated', 'authenticated', now(), now(), now());

create function pg_temp.login(uid text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

select pg_temp.login('00000000-0000-0000-0000-0000000000a9');
select create_my_profile('Ada Placetest', 'female', 25, 'Port Harcourt', 'love');
select set_config('test.ha', (select handle from join_room('Gombe')), true);
select pg_temp.login('00000000-0000-0000-0000-0000000000b9');
select set_config('test.hb', (select handle from join_room('Gombe')), true);

select is((select place from room_people() where handle = current_setting('test.ha')), 'Port Harcourt', 'Members show the place on their dating card');
select is((select place from room_people() where handle = current_setting('test.hb')), 'Gombe', 'Without a card, the room''s state is shown');
select is((select dating from room_people() where handle = current_setting('test.ha')), true, 'Members with a dating card can get message requests');
select ok((select string_agg(row_to_json(x)::text, ',') from room_people() x) !~ '(Placetest|test\.invalid)', 'Member lists never show real names or emails');

select * from finish();
rollback;
