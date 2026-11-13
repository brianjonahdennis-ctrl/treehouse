-- Community Star Ratings: anonymous 1–5 stars from a profile, refreshed hourly, used as one factor in
-- Nearby and Speed Dating order. Fully separate from blocks, reports and moderation: nothing here reads
-- dating_blocks / dating_reports / room_reports for the score (blocks only stop NEW ratings being given).
-- Model and weights: web-next/REPUTATION.md. Undo: drop the dating_private tables/functions below and
-- restore nearby_people / speed_join from migration 058 / 20261108000023 (+ later edits).

set lock_timeout = '5s';

-- ---- Settings (change values here, not code) --------------------------------------------------
create table dating_private.rating_config (key text primary key, value numeric not null, note text);
revoke all on dating_private.rating_config from public, anon, authenticated;
insert into dating_private.rating_config (key, value, note) values
  ('prior_mean', 5.0, 'everyone starts here'),
  ('prior_weight', 5, 'the starting 5.0 counts as this many ratings'),
  ('half_life_days', 90, 'a rating''s weight halves every N days'),
  ('min_raters', 5, 'different raters needed before a score is "established"'),
  ('burst_threshold', 8, 'more than N ratings for one person within burst_window_min ...'),
  ('burst_window_min', 60, '... count at burst_weight'),
  ('burst_weight', 0.5, null),
  ('exchange_weight', 0.5, 'mutual 5-star swaps within 10 minutes count at this weight'),
  ('high_band', 4.0, 'score >= this: high priority'),
  ('review_band', 3.0, 'score below this: lower priority + flagged for human review'),
  ('cooldown_days', 7, 'one rating per person per rolling N days'),
  ('max_per_day', 20, 'ratings a person can give per 24 hours'),
  ('min_account_days', 2, 'accounts younger than this can''t rate'),
  ('room_window_days', 14, 'chatroom ratings: messages in the last N days count'),
  ('room_min_messages', 3, 'chatroom ratings: messages each person needs in that room'),
  ('chat_min_messages', 2, 'friend/match ratings: messages each person needs in the chat'),
  ('speed_head_start_s', 60, 'Speed Dating: high band waits this much less');

create or replace function dating_private.rating_cfg(p_key text) returns numeric
language sql stable security definer set search_path = public, dating_private as $$
  select value from rating_config where key = p_key $$;

-- ---- Raw submissions (never readable by members) ----------------------------------------------
create table dating_private.star_ratings (
  id bigserial primary key,
  rater uuid not null references auth.users(id) on delete cascade,
  ratee uuid not null references auth.users(id) on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  basis text not null check (basis in ('friend', 'match', 'room')),
  conversation_id uuid,
  room text,
  created_at timestamptz not null default now(),
  valid boolean not null default true,
  invalid_reason text,
  check (rater <> ratee)
);
create index star_ratings_ratee on dating_private.star_ratings (ratee, created_at);
create index star_ratings_rater on dating_private.star_ratings (rater, created_at);
revoke all on dating_private.star_ratings from public, anon, authenticated;

-- One row per (rater, ratee) direction: the atomic 7-day cooldown.
create table dating_private.rating_pairs (
  rater uuid not null references auth.users(id) on delete cascade,
  ratee uuid not null references auth.users(id) on delete cascade,
  last_rated_at timestamptz not null,
  primary key (rater, ratee)
);
revoke all on dating_private.rating_pairs from public, anon, authenticated;

-- ---- Aggregates (written only by the hourly refresh) ------------------------------------------
create table dating_private.reputation (
  user_id uuid primary key references auth.users(id) on delete cascade,
  score numeric(4, 2) not null,
  raters integer not null,
  valid_count integer not null,
  established boolean not null,
  band text not null check (band in ('high', 'lower', 'review')),
  refreshed_at timestamptz not null
);
create table dating_private.reputation_weekly (
  user_id uuid not null references auth.users(id) on delete cascade,
  week date not null,
  score numeric(4, 2) not null,
  primary key (user_id, week)
);
create table dating_private.reputation_refresh (id int primary key default 1 check (id = 1), at timestamptz, users integer);
insert into dating_private.reputation_refresh (id) values (1);
revoke all on dating_private.reputation, dating_private.reputation_weekly, dating_private.reputation_refresh
  from public, anon, authenticated;

create or replace function dating_private.rep_band(p_user uuid) returns text
language sql stable security definer set search_path = public, dating_private as $$
  select coalesce((select band from reputation where user_id = p_user), 'high') $$;

-- ---- Eligibility -----------------------------------------------------------------------------
-- Returns null when p_rater may rate p_ratee on this basis right now, else a plain-words reason.
create or replace function dating_private.rating_block_reason(p_rater uuid, p_ratee uuid) returns text
language plpgsql stable security definer set search_path = public, dating_private as $$
declare nxt timestamptz;
begin
  if p_rater = p_ratee then return 'You can’t rate yourself.'; end if;
  if (select created_at from auth.users where id = p_rater) > now() - make_interval(days => rating_cfg('min_account_days')::int) then
    return 'New accounts can rate others after their first 2 days.';
  end if;
  select last_rated_at + make_interval(days => rating_cfg('cooldown_days')::int) into nxt
  from rating_pairs where rater = p_rater and ratee = p_ratee;
  if nxt is not null and nxt > now() then return 'cooldown'; end if;
  if (select count(*) from star_ratings where rater = p_rater and created_at > now() - interval '24 hours') >= rating_cfg('max_per_day') then
    return 'You’ve rated a lot of people today. Try again tomorrow.';
  end if;
  return null;
end $$;

-- A friend / match chat: accepted, not closed or deleted by the rater, no block, both took part.
create or replace function dating_private.rating_convo(p_rater uuid, p_conversation uuid, out ratee uuid, out basis text, out reason text)
language plpgsql stable security definer set search_path = public, dating_private as $$
declare c dating_conversations%rowtype; need int := rating_cfg('chat_min_messages')::int;
begin
  select * into c from dating_conversations where id = p_conversation and p_rater in (user_a, user_b);
  if not found then reason := 'Chat not found.'; return; end if;
  ratee := case when c.user_a = p_rater then c.user_b else c.user_a end;
  basis := case when c.kind = 'friend' then 'friend' else 'match' end;
  if c.accepted_at is null or c.declined_at is not null then reason := 'You can rate friends and matches once your chat is accepted.'; return; end if;
  if exists (select 1 from dating_cleared where conversation_id = c.id and user_id = p_rater) then reason := 'This chat was deleted, so it can’t be used to rate.'; return; end if;
  if dating_is_blocked(p_rater, ratee) then reason := 'This chat is closed.'; return; end if;
  if (select count(*) from (select 1 from dating_messages where conversation_id = c.id and sender_id = p_rater and deleted_at is null limit need) x) < need
     or (select count(*) from (select 1 from dating_messages where conversation_id = c.id and sender_id = ratee and deleted_at is null limit need) x) < need then
    reason := 'Chat a little more first: you can rate once you’ve both sent a few messages.'; return;
  end if;
end $$;

-- A chatroom member: both in the same room now, both really took part, at overlapping times.
create or replace function dating_private.rating_room(p_rater uuid, p_handle text, out ratee uuid, out room text, out reason text)
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  since timestamptz := now() - make_interval(days => rating_cfg('room_window_days')::int);
  need int := rating_cfg('room_min_messages')::int;
begin
  select o.user_id, o.state into ratee, room
  from room_members m join room_members o on o.state = m.state and o.handle = p_handle
  where m.user_id = p_rater and room_active(m.last_seen_at) limit 1;
  if ratee is null then reason := 'You can only rate people in your chatroom.'; return; end if;
  if ratee = p_rater then return; end if;
  if dating_is_blocked(p_rater, ratee) then reason := 'You can’t rate this person.'; return; end if;
  if (select count(*) from (select 1 from room_messages where user_id = p_rater and state = room and created_at > since limit need) x) < need
     or (select count(*) from (select 1 from room_messages where user_id = ratee and state = room and created_at > since limit need) x) < need
     or not exists (select 1 from room_messages a where a.user_id = p_rater and a.state = room and a.created_at > since
                      and exists (select 1 from room_messages b where b.user_id = ratee and b.state = room
                                    and b.created_at between a.created_at - interval '30 minutes' and a.created_at + interval '30 minutes')) then
    reason := 'Chat with them in the room a little more first.'; return;
  end if;
end $$;

create or replace function dating_private.rating_status_for(p_rater uuid, p_ratee uuid, p_reason text) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare r text := coalesce(p_reason, rating_block_reason(p_rater, p_ratee)); nxt timestamptz;
begin
  if r = 'cooldown' then
    select last_rated_at + make_interval(days => rating_cfg('cooldown_days')::int) into nxt from rating_pairs where rater = p_rater and ratee = p_ratee;
    return jsonb_build_object('eligible', false, 'cooldown', true, 'next_at', nxt, 'now', now());
  end if;
  return jsonb_build_object('eligible', r is null, 'reason', r, 'now', now());
end $$;

create or replace function dating_private.rating_submit(p_rater uuid, p_ratee uuid, p_stars int, p_basis text, p_conversation uuid, p_room text) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
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
  return rating_status_for(p_rater, p_ratee, null);
end $$;

-- ---- Member-facing functions -----------------------------------------------------------------
create or replace function public.rating_status_convo(p_conversation uuid) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare e record;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into e from rating_convo(auth.uid(), p_conversation);
  if e.ratee is null then return jsonb_build_object('eligible', false, 'reason', e.reason); end if;
  return rating_status_for(auth.uid(), e.ratee, e.reason);
end $$;

create or replace function public.rating_status_room(p_handle text) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare e record;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into e from rating_room(auth.uid(), p_handle);
  if e.ratee is null then return jsonb_build_object('eligible', false, 'reason', e.reason); end if;
  if e.ratee = auth.uid() then return jsonb_build_object('eligible', false, 'self', true); end if;
  return rating_status_for(auth.uid(), e.ratee, e.reason);
end $$;

create or replace function public.rate_convo(p_conversation uuid, p_stars int) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare e record;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into e from rating_convo(auth.uid(), p_conversation);
  if e.ratee is null or e.reason is not null then raise exception '%', coalesce(e.reason, 'You can’t rate this person.') using errcode = 'P0001'; end if;
  return rating_submit(auth.uid(), e.ratee, p_stars, e.basis, p_conversation, null);
end $$;

create or replace function public.rate_room_member(p_handle text, p_stars int) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare e record;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into e from rating_room(auth.uid(), p_handle);
  if e.ratee is null or e.ratee = auth.uid() or e.reason is not null then
    raise exception '%', coalesce(e.reason, 'You can’t rate this person.') using errcode = 'P0001';
  end if;
  return rating_submit(auth.uid(), e.ratee, p_stars, 'room', null, e.room);
end $$;

-- Badges for other people: Bird level + public rating (score only once established). Never who rated.
create or replace function dating_private.badge_for(p_user uuid) returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select jsonb_build_object(
    'level', coalesce((select level from bird_kingdom where user_id = p_user), 1),
    'rating', (select case when established then round(score, 1) end from reputation where user_id = p_user),
    'ratings', (select case when established then valid_count end from reputation where user_id = p_user)) $$;

create or replace function public.badges_for_convos(p_ids uuid[]) returns table (conversation_id uuid, badge jsonb)
language sql stable security definer set search_path = public, dating_private as $$
  select c.id, badge_for(case when c.user_a = auth.uid() then c.user_b else c.user_a end)
  from dating_conversations c
  where c.id = any (p_ids[1:200]) and auth.uid() in (c.user_a, c.user_b) $$;

create or replace function public.badges_for_room(p_handles text[]) returns table (handle text, badge jsonb)
language sql stable security definer set search_path = public, dating_private as $$
  select o.handle, badge_for(o.user_id)
  from room_members m
  join room_members o on o.state = m.state and o.handle = any (p_handles[1:200])
  where m.user_id = auth.uid() and room_active(m.last_seen_at) $$;

-- My own reputation dashboard: aggregates only, distribution/trend only once 5+ people rated.
create or replace function public.my_reputation() returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
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
    'score', case when r.established then round(r.score, 1) else 5.0 end,
    'established', coalesce(r.established, false),
    'raters', coalesce(r.raters, 0),
    'ratings', coalesce(r.valid_count, 0),
    'band', coalesce(r.band, 'high'),
    'distribution', dist, 'trend', trend,
    'refreshed_at', (select at from reputation_refresh where id = 1),
    'min_raters', rating_cfg('min_raters'),
    'high_band', rating_cfg('high_band'), 'cooldown_days', rating_cfg('cooldown_days'));
end $$;

revoke execute on function public.rating_status_convo(uuid), public.rating_status_room(text), public.rate_convo(uuid, int),
  public.rate_room_member(text, int), public.badges_for_convos(uuid[]), public.badges_for_room(text[]), public.my_reputation()
  from public, anon;
grant execute on function public.rating_status_convo(uuid), public.rating_status_room(text), public.rate_convo(uuid, int),
  public.rate_room_member(text, int), public.badges_for_convos(uuid[]), public.badges_for_room(text[]), public.my_reputation()
  to authenticated;
revoke all on function dating_private.rating_cfg(text), dating_private.rep_band(uuid), dating_private.rating_block_reason(uuid, uuid),
  dating_private.rating_convo(uuid, uuid), dating_private.rating_room(uuid, text), dating_private.rating_status_for(uuid, uuid, text),
  dating_private.rating_submit(uuid, uuid, int, text, uuid, text), dating_private.badge_for(uuid) from public, anon, authenticated;

-- ---- Hourly refresh ---------------------------------------------------------------------------
-- Reads ONLY star_ratings + rating_config. Never blocks, reports or moderation records.
create or replace function dating_private.refresh_reputation() returns integer
language plpgsql security definer set search_path = public, dating_private as $$
declare v_rows integer; wk date := date_trunc('week', (now() at time zone 'Africa/Lagos'))::date;
begin
  drop table if exists rep_new;
  create temp table rep_new on commit drop as
  with cfg as (
    select rating_cfg('prior_mean') pm, rating_cfg('prior_weight') pw, rating_cfg('half_life_days') hl,
           rating_cfg('burst_threshold') bt, rating_cfg('burst_window_min') bwm, rating_cfg('burst_weight') bw,
           rating_cfg('exchange_weight') xw, rating_cfg('min_raters') mr, rating_cfg('high_band') hb, rating_cfg('review_band') rb
  ),
  w as (
    select s.ratee, s.rater, s.stars,
      power(0.5, extract(epoch from now() - s.created_at) / 86400.0 / cfg.hl)
      * case when (select count(*) from star_ratings b where b.ratee = s.ratee and b.valid
                     and b.created_at between s.created_at - make_interval(mins => cfg.bwm::int) and s.created_at) > cfg.bt
             then cfg.bw else 1 end
      * case when s.stars = 5 and exists (select 1 from star_ratings x where x.rater = s.ratee and x.ratee = s.rater and x.valid
                     and x.stars = 5 and x.created_at between s.created_at - interval '10 minutes' and s.created_at + interval '10 minutes')
             then cfg.xw else 1 end as wt
    from star_ratings s cross join cfg
    where s.valid
  ),
  per_rater as (
    select ratee, rater, sum(wt * stars) / nullif(sum(wt), 0) val, max(wt) wt, count(*) n from w group by 1, 2
  ),
  agg as (
    select ratee, count(*) raters, sum(n) cnt,
           (cfg.pw * cfg.pm + sum(wt * val)) / (cfg.pw + sum(wt)) score
    from per_rater cross join cfg group by ratee, cfg.pw, cfg.pm
  )
  select a.ratee user_id, round(a.score, 2) score, a.raters::int raters, a.cnt::int valid_count,
         a.raters >= cfg.mr established,
         case when a.raters < cfg.mr or a.score >= cfg.hb then 'high' when a.score >= cfg.rb then 'lower' else 'review' end band
  from agg a cross join cfg;

  insert into reputation (user_id, score, raters, valid_count, established, band, refreshed_at)
  select user_id, score, raters, valid_count, established, band, now() from rep_new
  on conflict (user_id) do update set score = excluded.score, raters = excluded.raters, valid_count = excluded.valid_count,
    established = excluded.established, band = excluded.band, refreshed_at = excluded.refreshed_at;
  -- People whose ratings all disappeared (deleted accounts) drop back to new.
  delete from reputation r where not exists (select 1 from rep_new n where n.user_id = r.user_id);
  insert into reputation_weekly (user_id, week, score)
  select user_id, wk, score from rep_new where established
  on conflict (user_id, week) do update set score = excluded.score;
  get diagnostics v_rows = row_count;
  update reputation_refresh set at = now(), users = (select count(*) from rep_new) where id = 1;
  return v_rows;
end $$;
revoke all on function dating_private.refresh_reputation() from public, anon, authenticated;

-- Owner's Stats: counts only.
create or replace function public.admin_reputation_stats(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  if not admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'ratings', (select count(*) from star_ratings where valid),
    'ratings_24h', (select count(*) from star_ratings where created_at > now() - interval '24 hours'),
    'rated_people', (select count(*) from reputation),
    'established', (select count(*) from reputation where established),
    'bands', (select jsonb_object_agg(band, n) from (select band, count(*) n from reputation group by band) b),
    'needs_review', (select count(*) from reputation where band = 'review'),
    'refreshed_at', (select at from reputation_refresh where id = 1));
end $$;
revoke all on function public.admin_reputation_stats(text) from public, authenticated;
grant execute on function public.admin_reputation_stats(text) to anon;

-- ---- Discovery priority -----------------------------------------------------------------------
-- Nearby: same filters as before; the high band is listed first, then the chosen sort.
create or replace function public.nearby_people(p_radius_km integer DEFAULT 10, p_min_age integer DEFAULT NULL::integer, p_max_age integer DEFAULT NULL::integer, p_genders text[] DEFAULT NULL::text[], p_interests text[] DEFAULT NULL::text[], p_sort text DEFAULT 'distance'::text, p_limit integer DEFAULT 100)
 RETURNS TABLE(handle text, gender dating_gender, age integer, location text, intent dating_intent, bio text, interests text[], online boolean, active_hours integer, distance_km double precision, map_lat double precision, map_lng double precision, liked_me boolean, i_liked boolean, conversation_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'dating_private'
AS $function$
declare
  uid uuid := auth.uid();
  me_n nearby%rowtype;
  me_p dating_profiles%rowtype;
  r double precision := least(greatest(coalesce(p_radius_km, 10), 1), 50);
  dlat double precision;
  dlng double precision;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into me_p from dating_profiles where user_id = uid;
  if not found or me_p.suspended then raise exception 'Create your dating card first.' using errcode = '28000'; end if;
  select * into me_n from nearby where user_id = uid and updated_at > now() - interval '7 days';
  if not found then raise exception 'Turn on Nearby to see people around you.' using errcode = 'P0002'; end if;
  if me_n.paused then raise exception 'Nearby is paused. Resume it to see people around you.' using errcode = 'P0001'; end if;
  dlat := r / 111.0;
  dlng := r / (111.0 * greatest(cos(radians(me_n.plat)), 0.2));
  return query
    select p.handle, p.gender, p.age, coalesce(nullif(p.location, ''), p.state, ''), p.intent, p.bio, p.interests,
           is_online(p.last_seen_at), hours_since(p.last_seen_at),
           case when n.hide_distance then null
                else round(greatest(km_between(me_n.plat, me_n.plng, n.plat, n.plng), 0.5)::numeric, 1)::double precision end,
           case when n.hide_distance or n.hide_on_map then null else round(n.plat::numeric, 4)::double precision end,
           case when n.hide_distance or n.hide_on_map then null else round(n.plng::numeric, 4)::double precision end,
           exists (select 1 from dating_likes l where l.from_user = p.user_id and l.to_user = uid and l.liked),
           exists (select 1 from dating_likes l where l.from_user = uid and l.to_user = p.user_id and l.liked),
           dating_conversation_between(uid, p.user_id)
    from nearby n
    join dating_profiles p on p.user_id = n.user_id
    left join reputation rp on rp.user_id = p.user_id
    where n.user_id <> uid
      and not n.paused and n.updated_at > now() - interval '7 days'
      and n.plat between me_n.plat - dlat and me_n.plat + dlat
      and n.plng between me_n.plng - dlng and me_n.plng + dlng
      and km_between(me_n.plat, me_n.plng, n.plat, n.plng) <= r
      and p.is_active and not p.suspended
      and not dating_is_blocked(uid, p.user_id)
      and p.age between coalesce(p_min_age, me_p.min_age, 18) and coalesce(p_max_age, me_p.max_age, 120)
      and (coalesce(cardinality(p_genders), 0) = 0 or p.gender::text = any (p_genders))
      and (coalesce(cardinality(p_interests), 0) = 0 or p.interests && p_interests)
    order by case when coalesce(rp.band, 'high') = 'high' then 0 else 1 end,
             case when p_sort = 'active' then is_online(p.last_seen_at) end desc nulls last,
             case when p_sort = 'active' then p.last_seen_at end desc nulls last,
             km_between(me_n.plat, me_n.plng, n.plat, n.plng),
             p.handle
    limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $function$;

-- Speed Dating: the high band gets a short head start in the waiting order; longer waits still win.
CREATE OR REPLACE FUNCTION public.speed_join()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'dating_private'
AS $function$
declare
  me uuid := auth.uid();
  live uuid;
  other uuid;
  sid uuid;
  head interval := make_interval(secs => rating_cfg('speed_head_start_s')::int);
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from dating_profiles where user_id = me and is_active and not suspended) then
    raise exception 'You need an active dating profile for Speed Dating.' using errcode = '42501';
  end if;
  select session_id into live from speed_active where user_id = me;
  if live is not null then
    perform speed_tick(live);
    if exists (select 1 from speed_active where user_id = me) then return speed_view(live, me); end if;
  end if;

  -- On a break (daily limit or a recent match)? Leave the queue and say until when.
  if speed_quota_for(me) ->> 'available_at' is not null then
    delete from speed_queue where user_id = me;
    return jsonb_build_object('status', 'limit', 'quota', speed_quota_for(me), 'now', now());
  end if;

  insert into speed_queue (user_id) values (me)
  on conflict (user_id) do update set seen_at = now();

  select q.user_id into other
  from speed_queue q
  left join reputation rp on rp.user_id = q.user_id
  where q.user_id <> me and q.seen_at > now() - interval '20 seconds'
    and not exists (select 1 from speed_active a where a.user_id = q.user_id)
    and speed_quota_for(q.user_id) ->> 'available_at' is null
    and speed_can_date(me, q.user_id)
  order by q.joined_at - case when coalesce(rp.band, 'high') = 'high' then head else interval '0' end
  limit 1
  for update of q skip locked;

  if other is null then
    return jsonb_build_object('status', 'waiting', 'now', now());
  end if;

  insert into speed_sessions (user_a, user_b) values (other, me) returning id into sid;
  insert into speed_active (user_id, session_id) values (me, sid), (other, sid);
  delete from speed_queue where user_id in (me, other);
  begin perform realtime.send(jsonb_build_object('session', sid), 'paired', 'speedq:' || other, true);
  exception when others then null; end;
  return speed_view(sid, me);
end $function$;

-- ---- Every hour, at :07 ------------------------------------------------------------------------
create extension if not exists pg_cron;
select cron.schedule('refresh-reputation', '7 * * * *', 'select dating_private.refresh_reputation()');
