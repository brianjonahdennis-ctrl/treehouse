-- Manual, rollback-only benchmark. Run after migrations with psql against a disposable test database.
-- It prints the measured mean for 20 legacy calls versus 20 cached no-change calls; no result is
-- claimed until someone runs it on the target database/compute size.
begin;

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at)
values ('00000000-0000-0000-0000-500000000000', 'discover-benchmark-member@test.invalid',
        'authenticated', 'authenticated', now(), now(), now());

insert into public.dating_profiles
  (user_id, name, gender, age, birth_date, location, intent, handle, state, interested_in,
   min_age, max_age, last_seen_at)
values
  ('00000000-0000-0000-0000-500000000000', 'Benchmark member', 'female', 30,
   (current_date - interval '30 years 1 month')::date, 'Lagos', 'love', 'discover_benchmark_member',
   'Lagos', array['male']::public.dating_gender[], 18, 60, now());

insert into auth.users (id, email, aud, role, email_confirmed_at, created_at, updated_at)
select ('00000000-0000-0000-0000-' || lpad((500000000000 + g)::text, 12, '0'))::uuid,
       'discover-benchmark-' || g || '@test.invalid', 'authenticated', 'authenticated', now(), now(), now()
from generate_series(1, 5000) g;

insert into public.dating_profiles
  (user_id, name, gender, age, birth_date, location, intent, handle, state, interested_in,
   min_age, max_age, last_seen_at)
select ('00000000-0000-0000-0000-' || lpad((500000000000 + g)::text, 12, '0'))::uuid,
       'Benchmark person', 'male', 28, (current_date - interval '28 years 1 month')::date,
       'Lagos', 'love', 'discover_bench_' || g, 'Lagos', array['female']::public.dating_gender[],
       18, 60, now() - make_interval(secs => g)
from generate_series(1, 5000) g;

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-500000000000","role":"authenticated"}', true);

-- Warm the private queue once so the next measurement is the no-change path.
select count(*) from public.discover_cards(40, '{}'::text[]);
select set_config('role', 'postgres', true);

do $$
declare
  started timestamptz;
  elapsed_ms numeric;
  i integer;
begin
  started := clock_timestamp();
  for i in 1..20 loop
    perform 1 from dating_private.discover_cards_inner(40, '{}'::text[]);
  end loop;
  elapsed_ms := extract(epoch from clock_timestamp() - started) * 1000 / 20;
  raise notice 'Legacy full-query mean: % ms/request', round(elapsed_ms, 3);

  started := clock_timestamp();
  for i in 1..20 loop
    perform 1 from public.discover_cards(40, '{}'::text[]);
  end loop;
  elapsed_ms := extract(epoch from clock_timestamp() - started) * 1000 / 20;
  raise notice 'Prepared no-change mean: % ms/request', round(elapsed_ms, 3);
end $$;

rollback;
