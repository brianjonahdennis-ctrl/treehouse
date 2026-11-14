-- Weekly invite leaderboard and Man / Woman of the Week.
-- Weeks run Monday 00:00 to Sunday 24:00, Lagos time. An invite counts on the board when the new member
-- joined that week with someone's invite link, still has a profile, isn't suspended or marked under 18,
-- and came back at least 12 hours after joining (so a burst of throwaway accounts earns nothing).
-- Every Monday at 12:00 Lagos the top inviter of the week before (with at least the minimum number of
-- invites) is announced to all members through Product Announcements: "Man of the Week", "Woman of the
-- Week", or "Star of the Week". Staff can disqualify someone for a week before then.

alter table dating_private.app_settings drop constraint if exists app_settings_key_check;
alter table dating_private.app_settings add constraint app_settings_key_check
  check (key in ('signups_paused', 'signups_paused_reason', 'ads_enabled', 'referrals_enabled', 'invite_winner_enabled', 'invite_winner_min'));
insert into dating_private.app_settings (key, value) values ('invite_winner_enabled', 'true'), ('invite_winner_min', '3')
on conflict (key) do nothing;

create table dating_private.invite_exclusions (
  week       date not null,
  user_id    uuid not null references auth.users (id) on delete cascade,
  reason     text not null check (char_length(btrim(reason)) between 3 and 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (week, user_id)
);
create table dating_private.invite_winners (
  week            date primary key,
  user_id         uuid references auth.users (id) on delete set null,
  handle          text not null,
  title           text not null,
  invites         int not null,
  announcement_id uuid references public.announcements (id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table dating_private.invite_exclusions enable row level security;
alter table dating_private.invite_winners enable row level security;
revoke all on dating_private.invite_exclusions, dating_private.invite_winners from public, anon, authenticated;

-- Monday (Lagos) of the week containing p_at.
create function dating_private.lagos_week(p_at timestamptz default now()) returns date
language sql stable as $$
  select date_trunc('week', (p_at at time zone 'Africa/Lagos'))::date
$$;

create function dating_private.invite_title(p_gender text) returns text
language sql immutable as $$
  select case p_gender when 'male' then 'Man of the Week' when 'female' then 'Woman of the Week' else 'Star of the Week' end
$$;

-- The board for the week starting p_week (a Monday). Ties: whoever reached their count first.
create function dating_private.invite_board(p_week date, p_limit int default 50)
returns table (rank int, user_id uuid, handle text, gender text, invites int, reached_at timestamptz)
language sql stable security definer set search_path = public, dating_private as $$
  with counted as (
    select c.owner as user_id, count(*)::int as invites, max(rf.claimed_at) as reached_at
    from referrals rf
    join referral_codes c on c.code = rf.code and c.owner is not null and c.active
    join dating_profiles np on np.user_id = rf.user_id
    where rf.claimed_at >= (p_week::timestamp at time zone 'Africa/Lagos')
      and rf.claimed_at < ((p_week + 7)::timestamp at time zone 'Africa/Lagos')
      and not np.suspended and np.dob_underage_at is null
      and np.last_seen_at >= rf.claimed_at + interval '12 hours'
    group by c.owner
  )
  select (row_number() over (order by k.invites desc, k.reached_at, p.handle))::int, k.user_id, p.handle, p.gender::text, k.invites, k.reached_at
  from counted k
  join dating_profiles p on p.user_id = k.user_id
  where not p.suspended and p.dob_underage_at is null
    and not exists (select 1 from invite_exclusions x where x.week = p_week and x.user_id = k.user_id)
  order by k.invites desc, k.reached_at, p.handle
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
$$;

-- Members: this week's top 50, where I stand, and last week's winner.
create function public.invite_leaderboard() returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  wk date := lagos_week();
  mine record;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select b.rank, b.invites into mine from invite_board(wk, 200) b where b.user_id = me;
  return jsonb_build_object(
    'enabled', coalesce(setting('referrals_enabled'), 'true'::jsonb) = 'true'::jsonb,
    'week_start', wk, 'week_end', wk + 6,
    'ends_at', ((wk + 7)::timestamp at time zone 'Africa/Lagos'),
    'min', coalesce((setting('invite_winner_min') #>> '{}')::int, 3),
    'top', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'handle', b.handle, 'invites', b.invites, 'me', b.user_id = me) order by b.rank)
                     from invite_board(wk, 50) b), '[]'::jsonb),
    'me', jsonb_build_object('rank', mine.rank, 'invites', coalesce(mine.invites, 0)),
    'last_winner', (select jsonb_build_object('handle', w.handle, 'title', w.title, 'invites', w.invites, 'week', w.week)
                    from invite_winners w order by w.week desc limit 1));
end $$;

-- Every Monday 12:00 Lagos: announce last week's #1 (once per week).
create function dating_private.invite_winner_announce() returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare
  wk date := lagos_week() - 7;
  w record;
  t text;
  aid uuid;
  min_invites int := coalesce((setting('invite_winner_min') #>> '{}')::int, 3);
begin
  if coalesce(setting('invite_winner_enabled'), 'true'::jsonb) <> 'true'::jsonb
     or coalesce(setting('referrals_enabled'), 'true'::jsonb) <> 'true'::jsonb then
    return jsonb_build_object('announced', false, 'why', 'switched off');
  end if;
  if exists (select 1 from invite_winners where week = wk) then return jsonb_build_object('announced', false, 'why', 'already done'); end if;
  select * into w from invite_board(wk, 1) b;
  if w.user_id is null or w.invites < min_invites then
    return jsonb_build_object('announced', false, 'why', 'nobody reached the minimum', 'min', min_invites);
  end if;
  t := invite_title(w.gender);
  insert into announcements (title, preview, body, category, cta_label, cta_url, status, audience, send_push, scheduled_for, expires_at)
  values (
    left('🏆 ' || t || ': ' || w.handle, 100),
    left(w.handle || ' brought ' || w.invites || ' friends to treehouse last week. Invite yours and you could be next!', 160),
    'Congratulations to **' || w.handle || '**, our ' || t || '! 🎉' || chr(10) || chr(10) ||
    w.handle || ' invited ' || w.invites || ' friends who joined treehouse between ' ||
    to_char(wk, 'FMDD Mon') || ' and ' || to_char(wk + 6, 'FMDD Mon') || '.' || chr(10) || chr(10) ||
    'Want to be next week''s Man or Woman of the Week? Share your invite link from your Profile. ' ||
    'The leaderboard resets every Monday and only friends who really use treehouse count.',
    'community', 'See the leaderboard', '/home/invite', 'scheduled', '{"base": "all"}'::jsonb, true, now(), now() + interval '7 days')
  returning id into aid;
  insert into invite_winners (week, user_id, handle, title, invites, announcement_id) values (wk, w.user_id, w.handle, t, w.invites, aid);
  insert into announcement_audit (actor, action, announcement_id, meta) values (null, 'scheduled', aid, jsonb_build_object('by', 'invite of the week', 'week', wk));
  insert into staff_audit (actor, actor_handle, action, target_type, target_id, meta)
  values (null, 'system', 'invite_winner', 'member', w.handle, jsonb_build_object('week', wk, 'title', t, 'invites', w.invites));
  return jsonb_build_object('announced', true, 'handle', w.handle, 'title', t, 'invites', w.invites, 'announcement', aid);
end $$;

-- The announcement's button opens the leaderboard.
create or replace function dating_private.ann_routes() returns text[]
language sql immutable as $$
  select array['/home', '/home/discover', '/home/discover/nearby', '/home/rooms', '/home/matches',
    '/home/matches/friends', '/home/matches/requests', '/home/matches/likes', '/home/matches/announcements',
    '/home/games', '/home/profile', '/home/notifications', '/home/invite'];
$$;

-- ---- Staff ------------------------------------------------------------------------------------------
create function public.staff_invite_week(p_weeks_ago int default 0) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare wk date := lagos_week() - 7 * least(greatest(coalesce(p_weeks_ago, 0), 0), 52);
begin
  perform staff_need('view');
  return jsonb_build_object(
    'week_start', wk, 'week_end', wk + 6, 'current', wk = lagos_week(),
    'announce_at', ((wk + 7)::timestamp at time zone 'Africa/Lagos') + interval '12 hours',
    'enabled', coalesce(setting('invite_winner_enabled'), 'true'::jsonb) = 'true'::jsonb,
    'min', coalesce((setting('invite_winner_min') #>> '{}')::int, 3),
    'top', coalesce((select jsonb_agg(jsonb_build_object('rank', b.rank, 'handle', b.handle, 'gender', b.gender, 'invites', b.invites,
        'title', invite_title(b.gender), 'reached_at', b.reached_at,
        'joined_all', (select count(*) from referrals rf join referral_codes c on c.code = rf.code
                        where c.owner = b.user_id and rf.claimed_at >= (wk::timestamp at time zone 'Africa/Lagos')
                          and rf.claimed_at < ((wk + 7)::timestamp at time zone 'Africa/Lagos'))) order by b.rank)
      from invite_board(wk, 50) b), '[]'::jsonb),
    'excluded', coalesce((select jsonb_agg(jsonb_build_object('handle', p.handle, 'reason', x.reason, 'by', s.handle, 'at', x.created_at))
      from invite_exclusions x left join dating_profiles p on p.user_id = x.user_id left join dating_profiles s on s.user_id = x.created_by
      where x.week = wk), '[]'::jsonb),
    'winner', (select jsonb_build_object('handle', w.handle, 'title', w.title, 'invites', w.invites, 'announcement_id', w.announcement_id, 'at', w.created_at)
               from invite_winners w where w.week = wk),
    'winners', coalesce((select jsonb_agg(jsonb_build_object('week', w.week, 'handle', w.handle, 'title', w.title, 'invites', w.invites) order by w.week desc)
      from (select * from invite_winners order by week desc limit 12) w), '[]'::jsonb));
end $$;

create function public.staff_invite_exclude(p_handle text, p_weeks_ago int, p_exclude boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  wk date := lagos_week() - 7 * least(greatest(coalesce(p_weeks_ago, 0), 0), 1);
  uid uuid;
begin
  perform staff_need('manage');
  uid := staff_uid(p_handle);
  if exists (select 1 from invite_winners where week = wk) then raise exception 'That week’s winner was already announced.' using errcode = '42501'; end if;
  if p_exclude then
    if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason.' using errcode = '22023'; end if;
    insert into invite_exclusions (week, user_id, reason, created_by) values (wk, uid, btrim(p_reason), me)
    on conflict (week, user_id) do update set reason = excluded.reason, created_by = me, created_at = now();
  else
    delete from invite_exclusions where week = wk and user_id = uid;
  end if;
  perform staff_log(me, case when p_exclude then 'invite_disqualified' else 'invite_requalified' end, 'member', p_handle,
    jsonb_build_object('week', wk, 'reason', p_reason));
end $$;

-- Settings for the weekly winner (same switches page).
create or replace function public.staff_setting_set(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid();
begin
  perform staff_need('manage');
  if p_key in ('signups_paused', 'ads_enabled', 'referrals_enabled', 'invite_winner_enabled') and jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'Expected on or off.' using errcode = '22023';
  end if;
  if p_key = 'signups_paused_reason' and (jsonb_typeof(p_value) <> 'string' or char_length(p_value #>> '{}') > 200) then
    raise exception 'Keep the message under 200 characters.' using errcode = '22023';
  end if;
  if p_key = 'invite_winner_min' and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 1 and 1000) then
    raise exception 'Enter a number from 1 to 1000.' using errcode = '22023';
  end if;
  update app_settings set value = p_value, updated_by = me, updated_at = now() where key = p_key;
  if not found then raise exception 'Unknown setting.' using errcode = 'P0002'; end if;
  perform staff_log(me, 'setting', 'setting', p_key, jsonb_build_object('value', p_value));
end $$;

revoke all on function dating_private.lagos_week(timestamptz), dating_private.invite_title(text), dating_private.invite_board(date, int),
  dating_private.invite_winner_announce() from public, anon, authenticated;
revoke all on function public.invite_leaderboard(), public.staff_invite_week(int), public.staff_invite_exclude(text, int, boolean, text) from public, anon;
grant execute on function public.invite_leaderboard(), public.staff_invite_week(int), public.staff_invite_exclude(text, int, boolean, text) to authenticated;

select cron.schedule('invite-of-the-week', '0 11 * * 1', 'select dating_private.invite_winner_announce()');
