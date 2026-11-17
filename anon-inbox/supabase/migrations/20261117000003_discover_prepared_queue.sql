-- Discover prepares a private, ordered set only when a member opens Discover. Normal card requests
-- read a bounded queue and re-check current privacy/eligibility rules; there is no global refill job.
set lock_timeout = '5s';

create table if not exists dating_private.discover_queue_meta (
  user_id uuid primary key references auth.users (id) on delete cascade,
  preference_fingerprint text not null,
  exclusion_fingerprint text not null,
  candidate_count integer not null default 0,
  built_at timestamptz not null default now()
);
alter table dating_private.discover_queue_meta enable row level security;
revoke all on dating_private.discover_queue_meta from public, anon, authenticated;

create table if not exists dating_private.discover_queue (
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('liker', 'recent')),
  position integer not null,
  candidate_id uuid not null references public.dating_profiles (user_id) on delete cascade,
  built_at timestamptz not null default now(),
  primary key (user_id, source, candidate_id),
  unique (user_id, source, position)
);
alter table dating_private.discover_queue enable row level security;
revoke all on dating_private.discover_queue from public, anon, authenticated;
create index if not exists discover_queue_candidate on dating_private.discover_queue (candidate_id);

create or replace function dating_private.discover_preference_fingerprint(p_user uuid) returns text
language sql stable security definer set search_path = public, dating_private as $$
  select md5(concat_ws('|', p.gender::text, array_to_string(p.interested_in::text[], ','),
                       p.min_age::text, p.max_age::text, coalesce(p.pref_state, '')))
  from public.dating_profiles p where p.user_id = p_user
$$;
revoke all on function dating_private.discover_preference_fingerprint(uuid) from public, anon, authenticated;

create or replace function dating_private.discover_exclusion_fingerprint(p_exclude text[]) returns text
language sql immutable security definer set search_path = public, dating_private as $$
  select md5(to_jsonb(coalesce(p_exclude[1:300], '{}'::text[]))::text)
$$;
revoke all on function dating_private.discover_exclusion_fingerprint(text[]) from public, anon, authenticated;

create or replace function dating_private.discover_refill(p_user uuid, p_exclude text[] default null) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  pref text;
  prepared integer := 0;
  exclusions text[] := coalesce(p_exclude[1:300], '{}'::text[]);
  built timestamptz := statement_timestamp();
begin
  if p_user is null or p_user is distinct from auth.uid() then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('dating_private.discover_queue'), hashtext(p_user::text));
  pref := dating_private.discover_preference_fingerprint(p_user);
  if pref is null then raise exception 'Create your dating profile first.' using errcode = '28000'; end if;

  delete from dating_private.discover_queue where user_id = p_user;
  insert into dating_private.discover_queue (user_id, source, position, candidate_id, built_at)
  with me as (
    select p.user_id, p.gender, p.interested_in, p.min_age, p.max_age, p.pref_state
    from public.dating_profiles p where p.user_id = p_user
  ),
  liker_top as (
    select p.user_id, p.last_seen_at
    from me
    join public.dating_likes l on l.to_user = me.user_id and l.liked
    join public.dating_profiles p on p.user_id = l.from_user
    where p.is_active and not p.suspended and p.dob_underage_at is null
      and p.last_seen_at > now() - interval '60 days'
      and p.gender = any (me.interested_in) and me.gender = any (p.interested_in)
      and p.age between me.min_age and me.max_age
      and (me.pref_state is null or p.state = me.pref_state)
      and p.handle <> all (exclusions)
      and not exists (select 1 from public.dating_likes x where x.from_user = me.user_id and x.to_user = p.user_id)
      and not exists (select 1 from public.dating_conversations c where c.user_a = least(me.user_id, p.user_id) and c.user_b = greatest(me.user_id, p.user_id))
      and not exists (select 1 from public.dating_blocks b where b.blocker_id = me.user_id and b.blocked_id = p.user_id)
      and not exists (select 1 from public.dating_blocks b where b.blocker_id = p.user_id and b.blocked_id = me.user_id)
    order by p.last_seen_at desc nulls last
    limit 100
  ),
  liker_ranked as (
    select t.user_id, row_number() over (order by t.last_seen_at desc nulls last)::integer as position
    from liker_top t
  ),
  recent_top as (
    select p.user_id, p.last_seen_at
    from me
    join public.dating_profiles p on p.user_id <> me.user_id
    where p.is_active and not p.suspended and p.dob_underage_at is null
      and p.gender = any (me.interested_in)
      and (me.pref_state is null or p.state = me.pref_state)
      and p.last_seen_at > now() - interval '30 days'
      and me.gender = any (p.interested_in)
      and p.age between me.min_age and me.max_age
      and p.handle <> all (exclusions)
      and not exists (select 1 from public.dating_likes x where x.from_user = me.user_id and x.to_user = p.user_id)
      and not exists (select 1 from public.dating_conversations c where c.user_a = least(me.user_id, p.user_id) and c.user_b = greatest(me.user_id, p.user_id))
      and not exists (select 1 from public.dating_blocks b where b.blocker_id = me.user_id and b.blocked_id = p.user_id)
      and not exists (select 1 from public.dating_blocks b where b.blocker_id = p.user_id and b.blocked_id = me.user_id)
    order by p.last_seen_at desc nulls last
    limit 100
  ),
  recent_ranked as (
    select t.user_id, row_number() over (order by t.last_seen_at desc nulls last)::integer as position
    from recent_top t
  ),
  selected as (
    select 'liker'::text as source, r.position, r.user_id from liker_ranked r
    union all
    select 'recent'::text as source, r.position, r.user_id from recent_ranked r
  )
  select p_user, s.source, s.position, s.user_id, built from selected s;
  get diagnostics prepared = row_count;

  insert into dating_private.discover_queue_meta (user_id, preference_fingerprint, exclusion_fingerprint, candidate_count, built_at)
  values (p_user, pref, dating_private.discover_exclusion_fingerprint(exclusions), prepared, built)
  on conflict (user_id) do update
    set preference_fingerprint = excluded.preference_fingerprint,
        exclusion_fingerprint = excluded.exclusion_fingerprint,
        candidate_count = excluded.candidate_count,
        built_at = excluded.built_at;
end $$;
revoke all on function dating_private.discover_refill(uuid, text[]) from public, anon, authenticated;

-- Re-check at most 200 cached rows and the newest 100 incoming likes. Source ranks are kept
-- separately so p_limit keeps migration 31's exact per-source selection and final ranking.
create or replace function dating_private.discover_queue_page(
  p_user uuid, p_exclude text[], p_built_at timestamptz, p_limit int
)
returns table (
  queue_position integer, candidate_id uuid, likes_me boolean, handle text,
  gender public.dating_gender, age integer, location text, intent public.dating_intent,
  bio text, interests text[], online boolean, active_hours integer,
  last_seen_at timestamptz, created_at timestamptz
)
language sql stable security definer set search_path = public, dating_private as $$
  with me as (
    select p.user_id, p.gender, p.interested_in, p.min_age, p.max_age, p.pref_state
    from public.dating_profiles p where p.user_id = p_user and p_user = auth.uid()
  ),
  eligible_queue as (
    select q.source, q.position, p.user_id, p.handle, p.gender, p.age,
           coalesce(nullif(p.location, ''), p.state, '') as location, p.intent, p.bio, p.interests,
           p.last_seen_at, p.created_at
    from dating_private.discover_queue q
    join public.dating_profiles p on p.user_id = q.candidate_id
    cross join me
    where q.user_id = p_user
      and p.handle <> all (coalesce(p_exclude, '{}'::text[]))
      and p.is_active and not p.suspended and p.dob_underage_at is null
      and p.gender = any (me.interested_in) and me.gender = any (p.interested_in)
      and p.age between me.min_age and me.max_age
      and (me.pref_state is null or p.state = me.pref_state)
      and ((q.source = 'liker' and p.last_seen_at > now() - interval '60 days'
            and exists (select 1 from public.dating_likes l where l.from_user = p.user_id and l.to_user = me.user_id and l.liked))
        or (q.source = 'recent' and p.last_seen_at > now() - interval '30 days'))
      and not exists (select 1 from public.dating_likes l where l.from_user = me.user_id and l.to_user = p.user_id)
      and not exists (select 1 from public.dating_conversations c where c.user_a = least(me.user_id, p.user_id) and c.user_b = greatest(me.user_id, p.user_id))
      and not exists (select 1 from public.dating_blocks b where b.blocker_id = me.user_id and b.blocked_id = p.user_id)
      and not exists (select 1 from public.dating_blocks b where b.blocker_id = p.user_id and b.blocked_id = me.user_id)
  ),
  fresh_likes as (
    select p.user_id, p.handle, p.gender, p.age,
           coalesce(nullif(p.location, ''), p.state, '') as location, p.intent, p.bio, p.interests,
           p.last_seen_at, p.created_at
    from me
    join public.dating_likes l on l.to_user = me.user_id and l.liked and l.created_at > p_built_at - interval '1 minute'
    join public.dating_profiles p on p.user_id = l.from_user
    where p.handle <> all (coalesce(p_exclude, '{}'::text[]))
      and p.is_active and not p.suspended and p.dob_underage_at is null
      and p.last_seen_at > now() - interval '60 days'
      and p.gender = any (me.interested_in) and me.gender = any (p.interested_in)
      and p.age between me.min_age and me.max_age
      and (me.pref_state is null or p.state = me.pref_state)
      and not exists (select 1 from public.dating_likes x where x.from_user = me.user_id and x.to_user = p.user_id)
      and not exists (select 1 from public.dating_conversations c where c.user_a = least(me.user_id, p.user_id) and c.user_b = greatest(me.user_id, p.user_id))
      and not exists (select 1 from public.dating_blocks b where b.blocker_id = me.user_id and b.blocked_id = p.user_id)
      and not exists (select 1 from public.dating_blocks b where b.blocker_id = p.user_id and b.blocked_id = me.user_id)
      and not exists (select 1 from dating_private.discover_queue q where q.user_id = p_user and q.source = 'liker' and q.candidate_id = p.user_id)
    order by p.last_seen_at desc nulls last
    limit 100
  ),
  liker_pool as (
    select q.position, q.user_id, q.handle, q.gender, q.age, q.location, q.intent, q.bio, q.interests,
           q.last_seen_at, q.created_at
    from eligible_queue q where q.source = 'liker'
    union all
    select null::integer, n.user_id, n.handle, n.gender, n.age, n.location, n.intent, n.bio, n.interests,
           n.last_seen_at, n.created_at
    from fresh_likes n
  ),
  ranked_likers as (
    select l.*, row_number() over (order by l.last_seen_at desc nulls last)::integer as live_position
    from liker_pool l
  ),
  top_likers as (
    select * from ranked_likers order by live_position limit least(greatest(p_limit, 1), 50)
  ),
  ranked_recent as (
    select r.*, row_number() over (order by r.last_seen_at desc nulls last)::integer as live_position
    from eligible_queue r where r.source = 'recent'
  ),
  top_recent as (
    select * from ranked_recent r
    where r.live_position <= least(greatest(p_limit, 1), 50)
      and not exists (select 1 from top_likers l where l.user_id = r.user_id)
  ),
  combined as (
    select l.position, l.user_id, true as likes_me, l.handle, l.gender, l.age, l.location, l.intent,
           l.bio, l.interests, l.last_seen_at, l.created_at from top_likers l
    union all
    select r.position, r.user_id, false, r.handle, r.gender, r.age, r.location, r.intent,
           r.bio, r.interests, r.last_seen_at, r.created_at from top_recent r
  )
  select c.position, c.user_id, c.likes_me, c.handle, c.gender, c.age, c.location, c.intent,
         c.bio, c.interests, is_online(c.last_seen_at), hours_since(c.last_seen_at), c.last_seen_at, c.created_at
  from combined c
  order by is_online(c.last_seen_at) desc, c.likes_me desc, c.last_seen_at desc nulls last, c.created_at desc, c.handle
  limit least(greatest(p_limit, 1), 50);
$$;
revoke all on function dating_private.discover_queue_page(uuid, text[], timestamptz, integer) from public, anon, authenticated;

-- Same public name, parameters, result columns, 18+ check, and authenticated-only access as before.
create or replace function public.discover_cards(p_limit int default 20, p_exclude text[] default null)
returns table (handle text, gender public.dating_gender, age int, location text, intent public.dating_intent,
               bio text, interests text[], online boolean, active_hours int)
language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  exclusions text[] := coalesce(p_exclude[1:300], '{}'::text[]);
  exclusion_fp text;
  prefs text;
  built timestamptz;
  saved_prefs text;
  saved_exclusion_fp text;
  saved_count integer;
  queued_count integer;
  remaining integer;
  available integer;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  perform dating_private.require_dob();
  prefs := dating_private.discover_preference_fingerprint(me);
  exclusion_fp := dating_private.discover_exclusion_fingerprint(exclusions);
  if prefs is null then raise exception 'Create your dating profile first.' using errcode = '28000'; end if;

  select m.built_at, m.preference_fingerprint, m.exclusion_fingerprint, m.candidate_count
    into built, saved_prefs, saved_exclusion_fp, saved_count
  from dating_private.discover_queue_meta m where m.user_id = me;
  if not found or saved_prefs is distinct from prefs or built < now() - interval '15 minutes' then
    perform dating_private.discover_refill(me, exclusions);
    select m.built_at, m.exclusion_fingerprint, m.candidate_count into built, saved_exclusion_fp, saved_count
    from dating_private.discover_queue_meta m where m.user_id = me;
  end if;

  select count(*)::integer into queued_count
  from dating_private.discover_queue q where q.user_id = me;
  select count(*)::integer into remaining
  from dating_private.discover_queue q
  join public.dating_profiles p on p.user_id = q.candidate_id
  where q.user_id = me and p.handle <> all (exclusions);
  select count(*)::integer into available
  from dating_private.discover_queue_page(me, exclusions, built, lim);
  -- Refill immediately when the seen list changed, or retry a persistently thin pool at most every
  -- two minutes. This avoids rebuilding the same small result set on every request.
  if (queued_count = 0 and (saved_count > 0 or built < now() - interval '2 minutes'))
     or ((remaining < 40 or available < lim)
         and (saved_exclusion_fp is distinct from exclusion_fp or built < now() - interval '2 minutes')) then
    perform dating_private.discover_refill(me, exclusions);
    select m.built_at, m.exclusion_fingerprint, m.candidate_count into built, saved_exclusion_fp, saved_count
    from dating_private.discover_queue_meta m where m.user_id = me;
  end if;

  return query
  select d.handle, d.gender, d.age, d.location, d.intent, d.bio, d.interests, d.online, d.active_hours
  from dating_private.discover_queue_page(me, exclusions, built, lim) d
  order by d.online desc, d.likes_me desc, d.last_seen_at desc nulls last, d.created_at desc, d.handle
  limit lim;
end $$;
revoke all on function public.discover_cards(int, text[]) from public, anon;
grant execute on function public.discover_cards(int, text[]) to authenticated;
