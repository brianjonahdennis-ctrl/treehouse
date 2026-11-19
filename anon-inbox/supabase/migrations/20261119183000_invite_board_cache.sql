-- Invite leaderboard from a cache (memory/CPU plan step 6, 19 Nov 2026).
-- invite_leaderboard() computed the week's board twice on every call (top 200 for "my rank", top 50
-- for the list): ~90 ms, ~7.6% of database time. The board for the current week is now computed once
-- every 10 minutes into a private table, and invite_leaderboard() reads it (same name, same output).
-- Ranks, invites and staff corrections (migration 112) show up at most 10 minutes later.
-- Safe to run twice.

set lock_timeout = '5s';

create table if not exists dating_private.invite_board_cache (
  week date not null,
  rank int not null,
  user_id uuid not null,
  handle text,
  invites int not null,
  built_at timestamptz not null default now(),
  primary key (week, rank)
);
create index if not exists invite_board_cache_user on dating_private.invite_board_cache (week, user_id);
alter table dating_private.invite_board_cache enable row level security;
revoke all on dating_private.invite_board_cache from public, anon, authenticated;

create or replace function dating_private.invite_board_refresh() returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare wk date := lagos_week();
begin
  -- One refresh at a time.
  if not pg_try_advisory_xact_lock(hashtext('invite_board_refresh')) then return; end if;
  delete from dating_private.invite_board_cache;
  insert into dating_private.invite_board_cache (week, rank, user_id, handle, invites)
  select wk, b.rank, b.user_id, b.handle, b.invites from dating_private.invite_board(wk, 200) b;
end $$;
revoke all on function dating_private.invite_board_refresh() from public, anon, authenticated;

create or replace function public.invite_leaderboard() returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  wk date := lagos_week();
  mine record;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select c.rank, c.invites into mine from dating_private.invite_board_cache c where c.week = wk and c.user_id = me;
  return jsonb_build_object(
    'enabled', coalesce(setting('referrals_enabled'), 'true'::jsonb) = 'true'::jsonb,
    'week_start', wk, 'week_end', wk + 6,
    'ends_at', ((wk + 7)::timestamp at time zone 'Africa/Lagos'),
    'min', coalesce((setting('invite_winner_min') #>> '{}')::int, 3),
    'top', coalesce((select jsonb_agg(jsonb_build_object('rank', c.rank, 'handle', c.handle, 'invites', c.invites, 'me', c.user_id = me) order by c.rank)
                     from dating_private.invite_board_cache c where c.week = wk and c.rank <= 50), '[]'::jsonb),
    'me', jsonb_build_object('rank', mine.rank, 'invites', coalesce(mine.invites, 0)),
    'last_winner', (select jsonb_build_object('handle', w.handle, 'title', w.title, 'invites', w.invites, 'week', w.week)
                    from invite_winners w order by w.week desc limit 1));
end $$;
revoke all on function public.invite_leaderboard() from public, anon;
grant execute on function public.invite_leaderboard() to authenticated;

select dating_private.invite_board_refresh();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'invite-board-refresh') then
    perform cron.unschedule('invite-board-refresh');
  end if;
end $$;
select cron.schedule('invite-board-refresh', '*/10 * * * *', 'select dating_private.invite_board_refresh()');
