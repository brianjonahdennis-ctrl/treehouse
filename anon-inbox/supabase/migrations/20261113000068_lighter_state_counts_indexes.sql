-- Lighter database (13 Nov 2026, from the Supabase performance review):
-- 1. "People per state" on Discover was counted live on every visit (~0.37 s each). It's now counted
--    once every 5 minutes into a small table and read from there (minus yourself, as before).
-- 2. Indexes for six foreign keys that had none (all small tables; speeds up account deletion).

set lock_timeout = '5s';

create table dating_private.state_counts_cache (
  state text primary key,
  people integer not null,
  refreshed_at timestamptz not null default now()
);
revoke all on dating_private.state_counts_cache from public, anon, authenticated;

create or replace function dating_private.refresh_state_counts() returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  delete from state_counts_cache;
  insert into state_counts_cache (state, people)
  select p.state, count(*)::int from dating_profiles p
  where p.state is not null and p.is_active and not p.suspended
  group by p.state;
end $$;
revoke all on function dating_private.refresh_state_counts() from public, anon, authenticated;
select dating_private.refresh_state_counts();
select cron.schedule('refresh-state-counts', '*/5 * * * *', 'select dating_private.refresh_state_counts()');

-- Same answer as before (you aren't counted in your own state), from the cache.
create or replace function public.dating_state_counts()
 RETURNS TABLE(state text, people integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'dating_private'
AS $function$
  select c.state,
         greatest(c.people - case when exists (select 1 from dating_profiles p where p.user_id = auth.uid()
                                                and p.state = c.state and p.is_active and not p.suspended) then 1 else 0 end, 0)
  from state_counts_cache c;
$function$;

create index if not exists push_outbox_user_id on dating_private.push_outbox (user_id);
create index if not exists rating_pairs_ratee on dating_private.rating_pairs (ratee);
create index if not exists link_reports_owner_id on public.link_reports (owner_id);
create index if not exists link_reports_message_id on public.link_reports (message_id);
create index if not exists speed_active_session_id on public.speed_active (session_id);
create index if not exists speed_sessions_conversation_id on public.speed_sessions (conversation_id);
