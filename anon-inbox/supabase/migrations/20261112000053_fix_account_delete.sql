-- "Delete my account" was timing out for anyone with a real chat history.
-- Deleting an account deletes its chats; for every deleted message the database must clear replies
-- that point at it (reply_to → null), and with no index on reply_to that meant reading all
-- ~2 million dating messages once per message. Same for room replies and a few other links.
-- These indexes make each of those lookups instant, so deleting an account takes well under a second.
--
-- Also: every account deletion is now counted (day and whether they had a dating profile; nothing
-- that identifies the person) for the owner's Stats → Dating.

set lock_timeout = '5s';

-- ---- Indexes for the links that are cleared when an account goes -----------------------------------
create index if not exists dating_messages_reply_to on public.dating_messages (reply_to) where reply_to is not null;
create index if not exists room_messages_reply_to on public.room_messages (reply_to) where reply_to is not null;
create index if not exists dating_reads_user on public.dating_reads (user_id);
create index if not exists dating_conversations_started_by on public.dating_conversations (started_by);
create index if not exists dating_conversations_friend_ask_by on public.dating_conversations (friend_ask_by) where friend_ask_by is not null;
create index if not exists dating_reveals_user on public.dating_reveals (user_id);
create index if not exists dating_blocks_blocked on public.dating_blocks (blocked_id);
create index if not exists dating_cleared_user on public.dating_cleared (user_id);
create index if not exists room_reactions_user on public.room_reactions (user_id);
create index if not exists app_seen_days_user on public.app_seen_days (user_id);
create index if not exists room_reports_reporter on public.room_reports (reporter);
create index if not exists dating_reports_reporter on public.dating_reports (reporter_id);
create index if not exists dating_reports_reported on public.dating_reports (reported_id);
create index if not exists dating_reports_conversation on public.dating_reports (conversation_id);
create index if not exists dating_hidden_messages_message on public.dating_hidden_messages (message_id);

-- ---- Count deletions (no names, emails or ids) -----------------------------------------------------------
create table if not exists dating_private.account_deletions (
  at timestamptz not null default now(),
  had_profile boolean not null
);
create index if not exists account_deletions_at on dating_private.account_deletions (at);
alter table dating_private.account_deletions enable row level security;
revoke all on dating_private.account_deletions from public, anon, authenticated;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  insert into dating_private.account_deletions (had_profile)
  values (exists (select 1 from dating_profiles where user_id = uid));
  -- Chats are shared, so remove the whole conversation (both sides) when either person leaves.
  delete from dating_conversations where user_a = uid or user_b = uid;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Owner's Stats → Dating: deletions all time, in the chosen period, and per day.
create or replace function public.admin_deletion_stats(p_key text, p_days integer default 7) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  days int := least(greatest(coalesce(p_days, 7), 1), 400);
  tz text := 'Africa/Lagos';
  since date := (now() at time zone tz)::date - (days - 1);
begin
  if not admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'total', (select count(*) from account_deletions),
    'inRange', (select count(*) from account_deletions where (at at time zone tz)::date >= since),
    'withProfile', (select count(*) from account_deletions where had_profile and (at at time zone tz)::date >= since),
    'since', (select min(at) from account_deletions),
    'daily', (
      select jsonb_agg(jsonb_build_object('date', d.day, 'deleted', coalesce(x.n, 0)) order by d.day)
      from generate_series(since, (now() at time zone tz)::date, interval '1 day') as d(day)
      left join (select (at at time zone tz)::date as day, count(*) n from account_deletions group by 1) x on x.day = d.day::date));
end $$;
revoke all on function public.admin_deletion_stats(text, integer) from public, authenticated;
grant execute on function public.admin_deletion_stats(text, integer) to anon;
