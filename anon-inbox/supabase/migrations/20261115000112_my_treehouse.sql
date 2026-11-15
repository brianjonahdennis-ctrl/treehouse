-- My Treehouse (Hydra, 15 Nov 2026): every member's referral network as a tree.
--
-- Builds on the invite links that already exist (treehouse.ng/r/<username>, dating_private.referrals):
-- * Each referral row now stores who invited the person (`referrer`) and how (`source`: link, qr, admin).
--   One row per person (primary key), so everyone has at most one inviter.
-- * Rules enforced here, not in the app: nobody can invite themselves; no loops (A → B → A); once
--   recorded, who invited whom can't be changed except by staff through staff_referral_fix(), which is
--   written to the staff audit log. A username change still moves the link code with its owner.
-- * Counting: a person counts in a tree when they have a profile that isn't suspended, isn't marked
--   under 18, and hasn't been disqualified by staff (referral_disqualified). Link clicks never count.
--   Someone who doesn't count still keeps their place, so the people THEY invited still count for
--   everyone above them; in the tree they show as "Member unavailable" with no nickname.
-- * Attribution window: the invite link is remembered on the phone for 30 days; the database only
--   credits accounts younger than `referral_account_days` (default 3, staff can change it).
-- * Members only ever see nicknames, join dates and counts for people in their own tree. No usernames,
--   contact details, photos or online status. A referral never creates a friendship or a chat.
-- * Rewards: none yet. The app shows "coming soon"; nothing here pays or promises anything.

set lock_timeout = '5s';

-- ---- Referral records: who invited whom -----------------------------------------------------------
alter table dating_private.referrals
  add column if not exists referrer uuid references auth.users (id) on delete set null,
  add column if not exists source text not null default 'link',
  add column if not exists corrected_at timestamptz;
alter table dating_private.referrals drop constraint if exists referrals_source_check;
alter table dating_private.referrals add constraint referrals_source_check check (source in ('link', 'qr', 'admin'));
alter table dating_private.referrals drop constraint if exists referrals_not_self;
alter table dating_private.referrals add constraint referrals_not_self check (referrer is distinct from user_id) not valid;

update dating_private.referrals rf set referrer = c.owner
from dating_private.referral_codes c
where c.code = rf.code and rf.referrer is null and c.owner is not null and c.owner <> rf.user_id;
alter table dating_private.referrals validate constraint referrals_not_self;
create index if not exists referrals_referrer on dating_private.referrals (referrer, claimed_at);

create table if not exists dating_private.referral_disqualified (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  reason     text not null check (char_length(btrim(reason)) between 3 and 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table dating_private.referral_disqualified enable row level security;
revoke all on dating_private.referral_disqualified from public, anon, authenticated;

-- Fills in the inviter, blocks loops, and keeps records fixed unless staff are correcting one.
create or replace function dating_private.referrals_guard() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare fixing boolean := coalesce(current_setting('treehouse.referral_fix', true), '') = 'on';
begin
  if tg_op = 'INSERT' and new.referrer is null then
    select owner into new.referrer from referral_codes where code = new.code;
  end if;
  if tg_op = 'UPDATE' and not fixing
     and (new.user_id <> old.user_id or new.referrer is distinct from old.referrer or new.claimed_at <> old.claimed_at or new.source <> old.source) then
    raise exception 'Referral records can''t be changed.' using errcode = '42501';
  end if;
  if new.referrer is not null then
    if new.referrer = new.user_id then raise exception 'You can''t invite yourself.' using errcode = '22023'; end if;
    -- Would the inviter end up below the person they invited? Then it's a loop.
    if exists (
      with recursive up as (
        select r.referrer as id, 1 as n from referrals r where r.user_id = new.referrer
        union all
        select r.referrer, up.n + 1 from referrals r join up on r.user_id = up.id where up.id is not null and up.n < 200)
      select 1 from up where up.id = new.user_id) then
      raise exception 'That invite would make a loop.' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
revoke all on function dating_private.referrals_guard() from public, anon, authenticated;
drop trigger if exists referrals_guard on dating_private.referrals;
create trigger referrals_guard before insert or update on dating_private.referrals
  for each row execute function dating_private.referrals_guard();

-- ---- Settings ----------------------------------------------------------------------------------------
alter table dating_private.app_settings drop constraint if exists app_settings_key_check;
alter table dating_private.app_settings add constraint app_settings_key_check
  check (key in ('signups_paused', 'signups_paused_reason', 'ads_enabled', 'referrals_enabled', 'invite_winner_enabled',
                 'invite_winner_min', 'referral_account_days'));
insert into dating_private.app_settings (key, value) values ('referral_account_days', '3') on conflict (key) do nothing;

create or replace function public.staff_setting_set(p_key text, p_value jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public', 'dating_private'
as $function$
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
  if p_key = 'referral_account_days' and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric not between 1 and 30) then
    raise exception 'Enter a number of days from 1 to 30.' using errcode = '22023';
  end if;
  update app_settings set value = p_value, updated_by = me, updated_at = now() where key = p_key;
  if not found then raise exception 'Unknown setting.' using errcode = 'P0002'; end if;
  perform staff_log(me, 'setting', 'setting', p_key, jsonb_build_object('value', p_value));
end $function$;

-- ---- Claiming an invite (called once by the new member's app) --------------------------------------
drop function if exists public.claim_referral(text);
create or replace function public.claim_referral(p_code text, p_source text default 'link') returns boolean
language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  rc referral_codes%rowtype;
  days int := coalesce((setting('referral_account_days') #>> '{}')::int, 3);
begin
  if me is null then return false; end if;
  if coalesce(setting('referrals_enabled'), 'true'::jsonb) <> 'true'::jsonb then return false; end if;
  select * into rc from referral_codes where code = lower(btrim(coalesce(p_code, ''))) and active;
  if not found or rc.owner = me then return false; end if;
  if not exists (select 1 from auth.users where id = me and created_at > now() - make_interval(days => days)) then return false; end if;
  if not exists (select 1 from dating_profiles where user_id = me) then return false; end if;
  begin
    insert into referrals (user_id, code, source)
    values (me, rc.code, case when p_source = 'qr' then 'qr' else 'link' end)
    on conflict (user_id) do nothing;
    return found;
  exception when sqlstate '22023' then return false;   -- a loop: quietly not credited
  end;
end $$;
revoke all on function public.claim_referral(text, text) from public, anon;
grant execute on function public.claim_referral(text, text) to authenticated;

-- ---- The tree ----------------------------------------------------------------------------------------
create or replace function dating_private.referral_counts(p_user uuid) returns boolean
language sql stable security definer set search_path = public, dating_private as $$
  select exists (select 1 from dating_profiles p where p.user_id = p_user and not p.suspended and p.dob_underage_at is null)
     and not exists (select 1 from referral_disqualified d where d.user_id = p_user) $$;

-- Everyone below p_root: their inviter, level (1 = invited by p_root), join time, the chain above them
-- (inside the tree) and whether they count. Capped at 50 levels and 5,000 people.
create or replace function dating_private.treehouse_tree(p_root uuid)
returns table (user_id uuid, parent uuid, level int, joined_at timestamptz, path uuid[], counts boolean)
language sql stable security definer set search_path = public, dating_private as $$
  with recursive t as (
    select r.user_id, r.referrer as parent, 1 as level, r.claimed_at as joined_at, array[]::uuid[] as path
    from referrals r where r.referrer = p_root
    union all
    select r.user_id, r.referrer, t.level + 1, r.claimed_at, t.path || t.user_id
    from referrals r join t on r.referrer = t.user_id
    where t.level < 50)
  select t.user_id, t.parent, t.level, t.joined_at, t.path, referral_counts(t.user_id)
  from (select * from t limit 5000) t $$;

-- One person's row as a member sees it. Nicknames only; blocked or non-counting people are hidden.
create or replace function dating_private.treehouse_key(p_me uuid, p_user uuid) returns text
language sql immutable as $$ select left(md5(p_me::text || ':treehouse:' || p_user::text), 16) $$;

-- My Treehouse: link, counts per level, settings.
create or replace function public.my_treehouse() returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); r jsonb; direct int; network int; levels jsonb; deepest int;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  r := my_referral();
  if r is null then return null; end if;
  select count(*) filter (where level = 1 and counts), count(*) filter (where level > 1 and counts), coalesce(max(level) filter (where counts), 0)
  into direct, network, deepest from treehouse_tree(me);
  select coalesce(jsonb_agg(jsonb_build_object('level', level, 'people', n) order by level), '[]'::jsonb) into levels
  from (select level, count(*) n from treehouse_tree(me) where counts group by level) x;
  return r || jsonb_build_object(
    'direct', direct, 'network', network, 'total', direct + network, 'levels', levels, 'deepest', deepest,
    'window_days', coalesce((setting('referral_account_days') #>> '{}')::int, 3),
    'rewards', jsonb_build_object('enabled', false));
end $$;

-- The people one step below a node in my tree (p_parent: a key from an earlier call; null = me).
-- Sorted by 'joined' (newest first), 'direct' or 'total'; paged.
create or replace function public.treehouse_nodes(p_parent text default null, p_sort text default 'joined', p_offset int default 0, p_limit int default 30)
returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); pid uuid; plevel int := 0; lim int := least(greatest(coalesce(p_limit, 30), 1), 100); off int := greatest(coalesce(p_offset, 0), 0);
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  create temp table if not exists th_t (user_id uuid, parent uuid, level int, joined_at timestamptz, path uuid[], counts boolean) on commit drop;
  truncate th_t;
  insert into th_t select * from treehouse_tree(me);
  if p_parent is null then pid := me;
  else
    select t.user_id, t.level into pid, plevel from th_t t where treehouse_key(me, t.user_id) = p_parent;
    if pid is null then raise exception 'That person isn''t in your tree.' using errcode = 'P0002'; end if;
  end if;
  return jsonb_build_object(
    'parent', p_parent, 'level', plevel + 1,
    'count', (select count(*) from th_t where parent = pid),
    'items', coalesce((select jsonb_agg(x.j order by x.ord) from (
      select row_number() over (order by
          case when p_sort = 'direct' then s.direct when p_sort = 'total' then s.total end desc nulls last,
          s.joined_at desc) as ord,
        jsonb_build_object('key', treehouse_key(me, s.user_id), 'level', s.level, 'joined_at', s.joined_at,
          'hidden', s.hidden, 'handle', case when s.hidden then null else s.handle end,
          'direct', s.direct, 'total', s.total, 'has_children', s.kids > 0) as j
      from (
        select c.user_id, c.level, c.joined_at, p.handle,
               (not c.counts or p.handle is null or dating_is_blocked(me, c.user_id)) as hidden,
               (select count(*) from th_t k where k.parent = c.user_id and k.counts)::int as direct,
               (select count(*) from th_t k where c.user_id = any (k.path) and k.counts)::int as total,
               (select count(*) from th_t k where k.parent = c.user_id)::int as kids
        from th_t c left join dating_profiles p on p.user_id = c.user_id
        where c.parent = pid) s
      order by 1 offset off limit lim) x), '[]'::jsonb));
end $$;

-- Search / filter my whole tree as one list (List view). p_level null = every level.
create or replace function public.treehouse_search(p_query text default '', p_level int default null, p_sort text default 'joined', p_offset int default 0, p_limit int default 40)
returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); q text := lower(btrim(coalesce(p_query, ''))); lim int := least(greatest(coalesce(p_limit, 40), 1), 100); off int := greatest(coalesce(p_offset, 0), 0);
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  create temp table if not exists th_s (user_id uuid, parent uuid, level int, joined_at timestamptz, path uuid[], counts boolean) on commit drop;
  truncate th_s;
  insert into th_s select * from treehouse_tree(me);
  return (with v as (
      select c.user_id, c.level, c.joined_at, p.handle, pp.handle as parent_handle,
             (select count(*) from th_s k where k.parent = c.user_id and k.counts)::int as direct,
             (select count(*) from th_s k where c.user_id = any (k.path) and k.counts)::int as total,
             (select count(*) from th_s k where k.parent = c.user_id)::int as kids
      from th_s c
      join dating_profiles p on p.user_id = c.user_id
      left join dating_profiles pp on pp.user_id = c.parent and c.parent <> me and referral_counts(c.parent) and not dating_is_blocked(me, c.parent)
      where c.counts and not dating_is_blocked(me, c.user_id)
        and (q = '' or lower(p.handle) like '%' || replace(replace(q, '%', ''), '_', '\_') || '%')
        and (p_level is null or c.level = p_level))
    select jsonb_build_object('count', (select count(*) from v),
      'items', coalesce((select jsonb_agg(jsonb_build_object('key', treehouse_key(me, z.user_id), 'level', z.level, 'joined_at', z.joined_at,
          'hidden', false, 'handle', z.handle, 'parent_handle', z.parent_handle, 'direct', z.direct, 'total', z.total, 'has_children', z.kids > 0) order by z.ord)
        from (select v.*, row_number() over (order by
                case when p_sort = 'direct' then v.direct when p_sort = 'total' then v.total end desc nulls last, v.joined_at desc) ord
              from v order by ord offset off limit lim) z), '[]'::jsonb)));
end $$;

revoke all on function dating_private.referral_counts(uuid), dating_private.treehouse_tree(uuid) from public, anon, authenticated;
revoke all on function public.my_treehouse(), public.treehouse_nodes(text, text, int, int), public.treehouse_search(text, int, text, int, int) from public, anon;
grant execute on function public.my_treehouse(), public.treehouse_nodes(text, text, int, int), public.treehouse_search(text, int, text, int, int) to authenticated;

-- ---- Staff: numbers, suspicious activity, disqualify, audited corrections ----------------------------
create or replace function public.staff_treehouse(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare d int := least(greatest(coalesce(p_days, 30), 1), 180);
begin
  perform staff_need('view');
  return jsonb_build_object(
    'window_days', coalesce((setting('referral_account_days') #>> '{}')::int, 3),
    'referred', (select count(*) from referrals where referrer is not null),
    'counting', (select count(*) from referrals where referrer is not null and referral_counts(user_id)),
    'network', (select count(*) from referrals r where r.referrer is not null and referral_counts(r.user_id)
                  and exists (select 1 from referrals up where up.user_id = r.referrer and up.referrer is not null)),
    'campaign', (select count(*) from referrals where referrer is null),
    'by_source', coalesce((select jsonb_object_agg(source, n) from (select source, count(*) n from referrals group by source) s), '{}'::jsonb),
    'clicks', (select coalesce(sum(clicks), 0) from referral_codes where owner is not null),
    'disqualified', coalesce((select jsonb_agg(jsonb_build_object('handle', p.handle, 'reason', q.reason, 'by', s.handle, 'at', q.created_at) order by q.created_at desc)
      from referral_disqualified q left join dating_profiles p on p.user_id = q.user_id left join dating_profiles s on s.user_id = q.created_by), '[]'::jsonb),
    'top_networks', coalesce((select jsonb_agg(x order by x.total desc, x.direct desc) from (
      select p.handle,
             (select count(*) from referrals c where c.referrer = u.referrer and referral_counts(c.user_id)) as direct,
             (select count(*) from treehouse_tree(u.referrer) t where t.counts) as total
      from (select distinct referrer from referrals where referrer is not null) u
      join dating_profiles p on p.user_id = u.referrer
      order by 3 desc limit 20) x), '[]'::jsonb),
    'suspicious', coalesce((select jsonb_agg(x order by x.max_in_an_hour desc) from (
      select p.handle, count(*) as joined,
             count(*) filter (where jp.user_id is null or jp.last_seen_at < r.claimed_at + interval '12 hours') as never_came_back,
             (select max(n) from (select count(*) n from referrals z where z.referrer = r.referrer group by date_trunc('hour', z.claimed_at)) h) as max_in_an_hour
      from referrals r join dating_profiles p on p.user_id = r.referrer left join dating_profiles jp on jp.user_id = r.user_id
      where r.claimed_at > now() - make_interval(days => d)
      group by r.referrer, p.handle
      having (select max(n) from (select count(*) n from referrals z where z.referrer = r.referrer group by date_trunc('hour', z.claimed_at)) h) >= 5
          or (count(*) >= 5 and count(*) filter (where jp.user_id is null or jp.last_seen_at < r.claimed_at + interval '12 hours') * 2 > count(*))
      limit 30) x), '[]'::jsonb));
end $$;

create or replace function public.staff_referral_disqualify(p_handle text, p_on boolean, p_reason text default '') returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); uid uuid;
begin
  perform staff_need('manage');
  uid := staff_uid(p_handle);
  if p_on then
    if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason.' using errcode = '22023'; end if;
    insert into referral_disqualified (user_id, reason, created_by) values (uid, btrim(p_reason), me)
    on conflict (user_id) do update set reason = excluded.reason, created_by = me, created_at = now();
  else
    delete from referral_disqualified where user_id = uid;
  end if;
  perform staff_log(me, case when p_on then 'referral_disqualified' else 'referral_requalified' end, 'member', p_handle, jsonb_build_object('reason', p_reason));
end $$;

-- Move someone to a different inviter (p_parent) or remove their inviter (p_parent null). Audited.
create or replace function public.staff_referral_fix(p_handle text, p_parent text, p_reason text) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); uid uuid; pid uuid; pcode text; old_parent text;
begin
  perform staff_need('manage');
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason.' using errcode = '22023'; end if;
  uid := staff_uid(p_handle);
  select coalesce(p.handle, r.code) into old_parent from referrals r left join dating_profiles p on p.user_id = r.referrer where r.user_id = uid;
  perform set_config('treehouse.referral_fix', 'on', true);
  if nullif(btrim(coalesce(p_parent, '')), '') is null then
    delete from referrals where user_id = uid;
  else
    pid := staff_uid(p_parent);
    select code into pcode from referral_codes where owner = pid;
    if pcode is null then raise exception 'That member has no invite link yet.' using errcode = 'P0002'; end if;
    insert into referrals (user_id, code, referrer, source, claimed_at, corrected_at) values (uid, pcode, pid, 'admin', now(), now())
    on conflict (user_id) do update set code = excluded.code, referrer = excluded.referrer, source = 'admin', corrected_at = now();
  end if;
  perform set_config('treehouse.referral_fix', '', true);
  perform staff_log(me, 'referral_fix', 'member', p_handle, jsonb_build_object('from', old_parent, 'to', nullif(btrim(coalesce(p_parent, '')), ''), 'reason', p_reason));
end $$;

revoke all on function public.staff_treehouse(int), public.staff_referral_disqualify(text, boolean, text), public.staff_referral_fix(text, text, text) from public, anon;
grant execute on function public.staff_treehouse(int), public.staff_referral_disqualify(text, boolean, text), public.staff_referral_fix(text, text, text) to authenticated;
