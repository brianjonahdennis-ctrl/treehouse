-- Hydra, 15 Nov 2026.
-- 1. Friend requests no longer post a chat message. Instead the other person is told live (their chat
--    header shows "Accept friend") and gets a "friend" notification on their phone.
-- 2. Star ratings: everyone starts at 0.0 and the score is recalculated straight after every rating
--    (not once an hour). The score is the weighted average of the stars received; 0.0 with no ratings.
--    Hidden ordering bands still wait for 5 different raters, so one rating can't sink a newcomer.

set lock_timeout = '5s';

-- ---- 1. Friend request alert ------------------------------------------------------------------
alter table dating_private.push_outbox drop constraint if exists push_outbox_kind_check;
alter table dating_private.push_outbox add constraint push_outbox_kind_check
  check (kind in ('message', 'chat', 'request', 'like', 'match', 'announcement', 'friend')) not valid;

create or replace function public.ask_friend(p_conversation uuid, p_on boolean default true)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'dating_private'
as $function$
declare
  uid uuid := auth.uid();
  c dating_conversations%rowtype;
  other uuid;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into c from dating_conversations where id = p_conversation and uid in (user_a, user_b) for update;
  if not found then raise exception 'Chat not found.' using errcode = 'P0002'; end if;
  other := case when c.user_a = uid then c.user_b else c.user_a end;
  if c.kind = 'friend' then return 'friends'; end if;
  if not coalesce(p_on, true) then
    if c.friend_ask_by is not null then
      update dating_conversations set friend_ask_by = null where id = c.id;
      perform nudge(other);   -- their "Accept friend" disappears
    end if;
    return 'none';
  end if;
  if c.accepted_at is null then raise exception 'You can add friends once you''re chatting.' using errcode = 'P0001'; end if;
  if dating_is_suspended(uid) then raise exception 'Your profile is suspended.' using errcode = '42501'; end if;
  if dating_is_blocked(uid, other) then raise exception 'That person is not available.' using errcode = 'P0002'; end if;
  if c.friend_ask_by = other then
    update dating_conversations set kind = 'friend', friend_ask_by = null where id = c.id;
    perform nudge(other);
    return 'friends';
  end if;
  if c.friend_ask_by is distinct from uid then
    update dating_conversations set friend_ask_by = uid where id = c.id;
    perform nudge(other);
    perform queue_push(other, 'friend', '/home/matches/' || c.id);
  end if;
  return 'asked';
end $function$;

-- ---- 2. Ratings from 0.0, recalculated after every rating --------------------------------------
update dating_private.rating_config set value = 0, note = 'everyone starts at 0.0' where key = 'prior_mean';
update dating_private.rating_config set value = 0, note = 'no head start: the score is the average of the stars received' where key = 'prior_weight';
update dating_private.rating_config set note = 'different raters needed before the hidden ordering band and the star breakdown apply' where key = 'min_raters';

-- One person's score, worked out the same way as the hourly refresh (which still runs, for fading weights).
create or replace function dating_private.refresh_reputation_one(p_user uuid) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare wk date := date_trunc('week', (now() at time zone 'Africa/Lagos'))::date; nw record;
begin
  if p_user is null then return; end if;
  with cfg as (
    select rating_cfg('prior_mean') pm, rating_cfg('prior_weight') pw, rating_cfg('half_life_days') hl,
           rating_cfg('burst_threshold') bt, rating_cfg('burst_window_min') bwm, rating_cfg('burst_weight') bw,
           rating_cfg('exchange_weight') xw, rating_cfg('min_raters') mr, rating_cfg('high_band') hb, rating_cfg('review_band') rb
  ),
  w as (
    select s.rater, s.stars,
      power(0.5, extract(epoch from now() - s.created_at) / 86400.0 / cfg.hl)
      * case when (select count(*) from star_ratings b where b.ratee = s.ratee and b.valid
                     and b.created_at between s.created_at - make_interval(mins => cfg.bwm::int) and s.created_at) > cfg.bt
             then cfg.bw else 1 end
      * case when s.stars = 5 and exists (select 1 from star_ratings x where x.rater = s.ratee and x.ratee = s.rater and x.valid
                     and x.stars = 5 and x.created_at between s.created_at - interval '10 minutes' and s.created_at + interval '10 minutes')
             then cfg.xw else 1 end as wt
    from star_ratings s cross join cfg
    where s.valid and s.ratee = p_user
  ),
  per_rater as (
    select rater, sum(wt * stars) / nullif(sum(wt), 0) val, max(wt) wt, count(*) n from w group by 1
  ),
  agg as (
    select count(*) raters, sum(n) cnt, (cfg.pw * cfg.pm + sum(wt * val)) / nullif(cfg.pw + sum(wt), 0) score
    from per_rater cross join cfg group by cfg.pw, cfg.pm
  )
  select round(a.score, 2) score, a.raters::int raters, a.cnt::int valid_count, a.raters >= cfg.mr established,
         case when a.raters < cfg.mr or a.score >= cfg.hb then 'high' when a.score >= cfg.rb then 'lower' else 'review' end band
  into nw from agg a cross join cfg;

  if nw.raters is null or nw.raters = 0 or nw.score is null then
    delete from reputation where user_id = p_user;
    return;
  end if;
  insert into reputation (user_id, score, raters, valid_count, established, band, refreshed_at)
  values (p_user, nw.score, nw.raters, nw.valid_count, nw.established, nw.band, now())
  on conflict (user_id) do update set score = excluded.score, raters = excluded.raters, valid_count = excluded.valid_count,
    established = excluded.established, band = excluded.band, refreshed_at = excluded.refreshed_at;
  if nw.established then
    insert into reputation_weekly (user_id, week, score) values (p_user, wk, nw.score)
    on conflict (user_id, week) do update set score = excluded.score;
  end if;
end $$;
revoke all on function dating_private.refresh_reputation_one(uuid) from public, anon, authenticated;

create or replace function dating_private.rating_submit(p_rater uuid, p_ratee uuid, p_stars integer, p_basis text, p_conversation uuid, p_room text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'dating_private'
as $function$
declare r text; ok int;
begin
  if p_stars is null or p_stars < 1 or p_stars > 5 then raise exception 'Choose 1 to 5 stars.' using errcode = '22023'; end if;
  r := rating_block_reason(p_rater, p_ratee);
  if r is not null and r <> 'cooldown' then raise exception '%', r using errcode = 'P0001'; end if;
  -- Atomic cooldown: only one of two simultaneous submissions can claim the pair.
  insert into rating_pairs (rater, ratee, last_rated_at) values (p_rater, p_ratee, now())
  on conflict (rater, ratee) do update set last_rated_at = now()
    where rating_pairs.last_rated_at <= now() - make_interval(days => rating_cfg('cooldown_days')::int)
  returning 1 into ok;
  if ok is null then raise exception 'You’ve already rated this person this week.' using errcode = 'P0001'; end if;
  insert into star_ratings (rater, ratee, stars, basis, conversation_id, room)
  values (p_rater, p_ratee, p_stars, p_basis, p_conversation, p_room);
  perform refresh_reputation_one(p_ratee);   -- their score updates straight away
  return rating_status_for(p_rater, p_ratee, null);
end $function$;

-- Badges show the score from the first rating; 0.0 for people nobody has rated yet.
create or replace function dating_private.badge_for(p_user uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'dating_private'
as $function$
  select jsonb_build_object(
    'level', coalesce((select level from bird_kingdom where user_id = p_user), 1),
    'rating', coalesce((select round(score, 1) from reputation where user_id = p_user), 0.0),
    'ratings', coalesce((select valid_count from reputation where user_id = p_user), 0),
    'birthday', birthday_today(p_user)) $function$;

create or replace function public.my_reputation()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'dating_private'
as $function$
declare me uuid := auth.uid(); r reputation%rowtype; dist jsonb; trend jsonb;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into r from reputation where user_id = me;
  if found and r.established then
    select jsonb_object_agg(s, n) into dist from (
      select x.stars s, count(*) n from (
        select distinct on (rater) stars from star_ratings where ratee = me and valid order by rater, created_at desc) x
      group by 1) d;
    select jsonb_agg(jsonb_build_object('week', week, 'score', score) order by week) into trend
    from (select week, score from reputation_weekly where user_id = me order by week desc limit 8) w;
  end if;
  return jsonb_build_object(
    'score', coalesce(round(r.score, 1), 0.0),
    'established', coalesce(r.established, false),
    'raters', coalesce(r.raters, 0),
    'ratings', coalesce(r.valid_count, 0),
    'band', coalesce(r.band, 'high'),
    'distribution', dist, 'trend', trend,
    'refreshed_at', coalesce(r.refreshed_at, (select at from reputation_refresh where id = 1)),
    'min_raters', rating_cfg('min_raters'),
    'high_band', rating_cfg('high_band'), 'cooldown_days', rating_cfg('cooldown_days'));
end $function$;

-- Everyone's score recalculated now with the new rule (no 5.0 head start).
select dating_private.refresh_reputation();
