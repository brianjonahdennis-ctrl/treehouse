-- Database memory cuts, step 1 and 2 (19 Nov 2026). Members see no difference.
--
-- 1. Two profile indexes from the old Discover search (migration 031) have never been used since the
--    database started (0 scans) but take 175 MB, and every "last seen" update has to rewrite them.
--    Discover now reads the prepared queue (migration 20261118001552), so they can go.
--
-- 2. Prepared Discover lists are rebuilt whenever they are older than 15 minutes and the member opens
--    Discover again, so a list kept for hours is never used. A job every 30 minutes now clears lists
--    not rebuilt in the last hour (about 90% of the 2 million rows today). A member who comes back gets
--    a fresh list on their next Discover open, exactly as after the 15-minute refresh.
--
-- Safe to run twice.

set lock_timeout = '5s';

-- 1. Unused indexes.
drop index if exists public.dating_profiles_discover;
drop index if exists public.dating_profiles_discover_state;

-- 2. Clear stale prepared lists (meta row first so the next Discover open rebuilds straight away).
create or replace function dating_private.discover_queue_sweep() returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  delete from dating_private.discover_queue q
  using dating_private.discover_queue_meta m
  where m.user_id = q.user_id and m.built_at < now() - interval '1 hour';
  delete from dating_private.discover_queue_meta where built_at < now() - interval '1 hour';
  -- Queue rows left without a meta row (should not happen) are cleared too.
  delete from dating_private.discover_queue q
  where q.built_at < now() - interval '1 hour'
    and not exists (select 1 from dating_private.discover_queue_meta m where m.user_id = q.user_id);
end $$;
revoke all on function dating_private.discover_queue_sweep() from public, anon, authenticated;

select dating_private.discover_queue_sweep();

-- The queue's indexes (441 MB for 190 MB of rows) are compacted separately, without blocking Discover:
--   reindex table concurrently dating_private.discover_queue;   (run on its own, outside a migration)

do $$
begin
  if exists (select 1 from cron.job where jobname = 'discover-queue-sweep') then
    perform cron.unschedule('discover-queue-sweep');
  end if;
end $$;
select cron.schedule('discover-queue-sweep', '*/30 * * * *', 'select dating_private.discover_queue_sweep()');
