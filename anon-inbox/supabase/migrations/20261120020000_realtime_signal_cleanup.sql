-- Live signals: empty each finished day's table every night (19 Nov 2026).
-- Supabase keeps live signals (realtime.messages, one table per UTC day) for about 4 days, ~2.4 GB.
-- They are only needed for the moment they are delivered; treehouse doesn't use replay. Every night at
-- 00:05 UTC (01:05 Lagos) the tables of earlier days are emptied. Today's table is never touched, so
-- delivery is unaffected (tested 19 Nov: emptying old days left the realtime feed active with no lag).
-- Supabase still drops the old (now empty) tables itself later. Safe to run twice.

create or replace function dating_private.realtime_signal_cleanup() returns void
language plpgsql security definer set search_path = pg_catalog as $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'realtime' and c.relkind = 'r'
      and c.relname ~ '^messages_\d{4}_\d{2}_\d{2}$'
      and to_date(substring(c.relname from 10), 'YYYY_MM_DD') < (now() at time zone 'UTC')::date
      and pg_relation_size(c.oid) > 8192
  loop
    begin
      execute 'set local lock_timeout = ''3s''';
      execute format('truncate table realtime.%I', t.relname);
    exception when others then
      raise notice 'skipped %: %', t.relname, sqlerrm;   -- try again tomorrow
    end;
  end loop;
end $$;
revoke all on function dating_private.realtime_signal_cleanup() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'realtime-signal-cleanup') then
    perform cron.unschedule('realtime-signal-cleanup');
  end if;
end $$;
select cron.schedule('realtime-signal-cleanup', '5 0 * * *', 'select dating_private.realtime_signal_cleanup()');
