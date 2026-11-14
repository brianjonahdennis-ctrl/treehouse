-- Product Announcements (14 Nov 2026).
-- Official messages from treehouse that land in each member's Inbox → Announcements tab.
--
-- * announcements           one row per announcement (draft → scheduled → publishing → published → archived).
-- * announcement_deliveries one row per recipient (unique per person per announcement): delivered, read,
--                           archived (their own view only), button tapped, push queued.
-- * announcement_staff      who may use the admin screens: super_admin, admin, editor, analyst (+ can_publish).
-- * announcement_audit      who did what, when.
-- * announcement_prefs      a member's "treehouse updates" push switch (essential notices ignore it).
--
-- Delivery never runs in the admin's request: publishing marks the announcement "publishing" and a
-- pg_cron job adds recipients in batches of 5,000 in user-id order (insert … on conflict do nothing),
-- so retries never make duplicates and huge audiences never block anything. A push is queued only in
-- the same statement that creates the delivery row, so a person can never get the same push twice.
-- Read counts for the dashboard are recounted by the same job (no hot counter row).
-- Members only ever see their own deliveries; staff only ever see counts.

set lock_timeout = '5s';

-- ---- Tables -------------------------------------------------------------------------------------------
create table public.announcements (
  id              uuid primary key default gen_random_uuid(),
  title           text not null check (char_length(btrim(title)) between 1 and 100),
  preview         text not null check (char_length(btrim(preview)) between 1 and 160),
  body            text not null default '' check (char_length(body) <= 20000),
  category        text not null check (category in ('product_update', 'feature_launch', 'event', 'community', 'maintenance', 'important')),
  cover_url       text check (cover_url is null or (cover_url ~ '^https://[^\s<>"'']+$' and char_length(cover_url) <= 500)),
  cta_label       text check (cta_label is null or char_length(btrim(cta_label)) between 1 and 30),
  cta_url         text check (cta_url is null or char_length(cta_url) <= 500),
  status          text not null default 'draft' check (status in ('draft', 'scheduled', 'publishing', 'published', 'archived')),
  audience        jsonb not null default '{"base": "active"}'::jsonb,
  send_push       boolean not null default true,
  essential       boolean generated always as (category in ('maintenance', 'important')) stored,
  revises         uuid references public.announcements (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  updated_by      uuid references auth.users (id) on delete set null,
  scheduled_by    uuid references auth.users (id) on delete set null,
  published_by    uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  scheduled_for   timestamptz,
  published_at    timestamptz,
  delivered_at    timestamptz,               -- delivery to the whole audience finished
  expires_at      timestamptz,               -- after this, members no longer see it
  archived_at     timestamptz,
  was_published   boolean not null default false,
  eligible_count  integer,                   -- audience size when publishing started
  delivered_count integer not null default 0,
  push_count      integer not null default 0,
  read_count      integer not null default 0,
  click_count     integer not null default 0,
  delivery_cursor uuid,                      -- last user id handled by the batch job
  stats_at        timestamptz,
  check ((cta_label is null) = (cta_url is null)),
  check (expires_at is null or published_at is null or expires_at > published_at)
);
create index announcements_status on public.announcements (status, created_at desc);
create index announcements_due on public.announcements (scheduled_for) where status = 'scheduled';
create index announcements_revises on public.announcements (revises) where revises is not null;

create table public.announcement_deliveries (
  user_id         uuid not null references auth.users (id) on delete cascade,
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  delivered_at    timestamptz not null default now(),
  read_at         timestamptz,
  archived_at     timestamptz,
  cta_clicked_at  timestamptz,
  push_queued_at  timestamptz,
  primary key (user_id, announcement_id)    -- one delivery per person per announcement
);
create index announcement_deliveries_inbox on public.announcement_deliveries (user_id, delivered_at desc);
create index announcement_deliveries_unread on public.announcement_deliveries (user_id) where read_at is null and archived_at is null;
create index announcement_deliveries_by_announcement on public.announcement_deliveries (announcement_id);

create table public.announcement_staff (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  role        text not null check (role in ('super_admin', 'admin', 'editor', 'analyst')),
  can_publish boolean not null default false,
  added_by    uuid references auth.users (id) on delete set null,
  added_at    timestamptz not null default now()
);

create table public.announcement_audit (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  actor           uuid references auth.users (id) on delete set null,
  action          text not null,
  announcement_id uuid references public.announcements (id) on delete set null,
  meta            jsonb not null default '{}'::jsonb
);
create index announcement_audit_announcement on public.announcement_audit (announcement_id, at desc);
create index announcement_audit_at on public.announcement_audit (at desc);

create table public.announcement_prefs (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  push_updates boolean not null default true,
  updated_at   timestamptz not null default now()
);

-- Nobody reads these tables directly; everything goes through the functions below.
alter table public.announcements enable row level security;
alter table public.announcement_deliveries enable row level security;
alter table public.announcement_staff enable row level security;
alter table public.announcement_audit enable row level security;
alter table public.announcement_prefs enable row level security;
revoke all on public.announcements, public.announcement_deliveries, public.announcement_staff,
  public.announcement_audit, public.announcement_prefs from public, anon, authenticated;

-- Push: a new private kind. The phone shows fixed text ("Treehouse Update 🎉") and opens the announcement.
alter table dating_private.push_outbox drop constraint if exists push_outbox_kind_check;
alter table dating_private.push_outbox add constraint push_outbox_kind_check
  check (kind in ('message', 'chat', 'request', 'like', 'match', 'announcement')) not valid;
alter table dating_private.push_outbox validate constraint push_outbox_kind_check;

-- ---- Helpers ------------------------------------------------------------------------------------------
-- Approved places a button may open inside treehouse.
create function dating_private.ann_routes() returns text[]
language sql immutable as $$
  select array['/home', '/home/discover', '/home/discover/nearby', '/home/rooms', '/home/matches',
    '/home/matches/friends', '/home/matches/requests', '/home/matches/likes', '/home/matches/announcements',
    '/home/games', '/home/profile', '/home/notifications'];
$$;

create function dating_private.ann_link_ok(p_url text) returns boolean
language sql immutable as $$
  select p_url is not null and (
    p_url = any (dating_private.ann_routes())
    or (p_url ~ '^/home/games/[a-z0-9-]{1,40}$')
    or (p_url ~ '^/home/matches/announcements/[0-9a-f-]{36}$')
    or (p_url ~* '^https://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{2,5})?(/[^\s<>"''\\]*)?$'
        and char_length(p_url) <= 500));
$$;

-- The audience, as a plain SQL function so Postgres can fold it into the batch query (no SECURITY
-- DEFINER, no SET: callers are already definer functions). Rules that always apply:
--   * suspended accounts and accounts marked under 18 never receive announcements;
--   * everyone else with a treehouse profile can.
-- Audience settings (all optional, combined with AND):
--   base:      all | active (seen in 30 days) | new (joined in `days`) | recent (seen in `days`) | inactive (not seen in `days`)
--   days:      1–365 (default 30 for recent/inactive, 7 for new)
--   states:    Nigerian states (36 + FCT)
--   platforms: android-play | android-apk | android-app | ios-app | web  (used treehouse that way in the last 30 days)
create function dating_private.ann_targets(p_aud jsonb)
returns table (user_id uuid)
language sql stable as $$
  select p.user_id
  from public.dating_profiles p
  where not p.suspended
    and p.dob_underage_at is null
    and case coalesce(p_aud ->> 'base', 'active')
          when 'all' then true
          when 'active' then p.last_seen_at > now() - interval '30 days'
          when 'new' then p.created_at > now() - make_interval(days => least(greatest(coalesce((p_aud ->> 'days')::int, 7), 1), 365))
          when 'recent' then p.last_seen_at > now() - make_interval(days => least(greatest(coalesce((p_aud ->> 'days')::int, 30), 1), 365))
          when 'inactive' then p.last_seen_at is null or p.last_seen_at <= now() - make_interval(days => least(greatest(coalesce((p_aud ->> 'days')::int, 30), 1), 365))
          else false end
    and (jsonb_array_length(coalesce(p_aud -> 'states', '[]'::jsonb)) = 0
         or p.state in (select jsonb_array_elements_text(p_aud -> 'states')))
    and (jsonb_array_length(coalesce(p_aud -> 'platforms', '[]'::jsonb)) = 0
         or p.user_id in (select d.user_id from public.app_seen_days d
                          where d.day >= ((now() at time zone 'Africa/Lagos')::date - 30)
                            and d.platform in (select jsonb_array_elements_text(p_aud -> 'platforms'))));
$$;
revoke all on function dating_private.ann_targets(jsonb) from public, anon, authenticated;

-- Clean and check an audience before saving it.
create function dating_private.ann_clean_audience(p_aud jsonb) returns jsonb
language plpgsql immutable set search_path = dating_private as $$
declare
  base text := coalesce(p_aud ->> 'base', 'active');
  days int;
  states jsonb := coalesce(p_aud -> 'states', '[]'::jsonb);
  plats jsonb := coalesce(p_aud -> 'platforms', '[]'::jsonb);
begin
  if base not in ('all', 'active', 'new', 'recent', 'inactive') then raise exception 'Choose a valid audience.' using errcode = '22023'; end if;
  if jsonb_typeof(states) <> 'array' or jsonb_typeof(plats) <> 'array' then raise exception 'Choose a valid audience.' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements_text(states) s where s <> all (nigerian_states())) then
    raise exception 'Unknown state in the audience.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements_text(plats) s where s not in ('android-play', 'android-apk', 'android-app', 'ios-app', 'web')) then
    raise exception 'Unknown platform in the audience.' using errcode = '22023';
  end if;
  if base in ('new', 'recent', 'inactive') then
    begin days := coalesce((p_aud ->> 'days')::int, case base when 'new' then 7 else 30 end);
    exception when others then raise exception 'Days must be a number.' using errcode = '22023'; end;
    if days not between 1 and 365 then raise exception 'Days must be between 1 and 365.' using errcode = '22023'; end if;
  end if;
  return jsonb_strip_nulls(jsonb_build_object('base', base, 'days', days,
    'states', case when jsonb_array_length(states) > 0 then (select jsonb_agg(distinct s) from jsonb_array_elements_text(states) s) end,
    'platforms', case when jsonb_array_length(plats) > 0 then (select jsonb_agg(distinct s) from jsonb_array_elements_text(plats) s) end));
end $$;

-- The signed-in person's staff role (null = not staff).
create function dating_private.ann_role() returns text
language sql stable security definer set search_path = public as $$
  select role from announcement_staff where user_id = auth.uid();
$$;
create function dating_private.ann_require(p_need text) returns text
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  r record;
begin
  select role, can_publish into r from announcement_staff where user_id = auth.uid();
  if r.role is null then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_need = 'view' then return r.role; end if;
  if p_need = 'edit' and r.role in ('super_admin', 'admin', 'editor') then return r.role; end if;
  if p_need = 'publish' and (r.role = 'super_admin' or (r.role in ('admin', 'editor') and r.can_publish)) then return r.role; end if;
  if p_need = 'staff' and r.role = 'super_admin' then return r.role; end if;
  raise exception 'Your role doesn’t allow this.' using errcode = '42501';
end $$;

create function dating_private.ann_log(p_action text, p_id uuid, p_meta jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  insert into announcement_audit (actor, action, announcement_id, meta) values (auth.uid(), p_action, p_id, coalesce(p_meta, '{}'::jsonb));
$$;

revoke all on function dating_private.ann_routes(), dating_private.ann_link_ok(text), dating_private.ann_clean_audience(jsonb),
  dating_private.ann_role(), dating_private.ann_require(text), dating_private.ann_log(text, uuid, jsonb) from public, anon, authenticated;

-- ---- Delivery (background) ------------------------------------------------------------------------------
-- One batch for one announcement. Returns how many people it handled (0 = done).
create function dating_private.ann_deliver_batch(p_id uuid, p_size int default 5000) returns int
language plpgsql security definer set search_path = public, dating_private as $$
declare
  a record;
  n int;
  last uuid;
  added int;
  pushed int;
begin
  select * into a from announcements where id = p_id and status = 'publishing' for update skip locked;
  if a.id is null then return 0; end if;

  with batch as materialized (
    select t.user_id from ann_targets(a.audience) t
    where t.user_id > coalesce(a.delivery_cursor, '00000000-0000-0000-0000-000000000000'::uuid)
    order by t.user_id limit p_size
  ), ins as (
    insert into announcement_deliveries (user_id, announcement_id, push_queued_at)
    select b.user_id, a.id,
           case when a.send_push
                 and exists (select 1 from push_subscriptions s where s.user_id = b.user_id)
                 and (a.essential or coalesce((select pr.push_updates from announcement_prefs pr where pr.user_id = b.user_id), true))
                then now() end
    from batch b
    on conflict do nothing
    returning user_id, push_queued_at
  ), q as (
    insert into push_outbox (user_id, kind, url)
    select i.user_id, 'announcement', '/home/matches/announcements/' || a.id from ins i where i.push_queued_at is not null
    returning 1
  )
  select (select count(*) from batch), (select b.user_id from batch b order by b.user_id desc limit 1),
         (select count(*) from ins), (select count(*) from q)
    into n, last, added, pushed;

  update announcements
  set delivery_cursor = coalesce(last, delivery_cursor),
      delivered_count = delivered_count + added, push_count = push_count + pushed,
      status = case when n < p_size then 'published' else status end,
      delivered_at = case when n < p_size then now() else delivered_at end
  where id = a.id;
  return n;
end $$;

-- Every minute: start scheduled announcements that are due, deliver up to 20,000 recipients, and
-- refresh dashboard counts for announcements published in the last 60 days.
create function dating_private.ann_tick() returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  a record;
  budget int := 4;     -- batches of 5,000 per minute
  started timestamptz := clock_timestamp();
begin
  for a in select id, audience from announcements where status = 'scheduled' and scheduled_for <= now() order by scheduled_for for update skip locked loop
    update announcements set status = 'publishing', published_at = now(), was_published = true,
           eligible_count = (select count(*) from ann_targets(a.audience))
    where id = a.id;
    insert into announcement_audit (actor, action, announcement_id, meta)
      values (null, 'published', a.id, jsonb_build_object('by', 'schedule'));
  end loop;

  while budget > 0 and clock_timestamp() - started < interval '40 seconds' loop
    select id into a from announcements where status = 'publishing' order by published_at limit 1;
    exit when a.id is null;
    perform ann_deliver_batch(a.id);
    budget := budget - 1;
  end loop;

  update announcements x set
    read_count = s.reads, click_count = s.clicks, stats_at = now()
  from (select d.announcement_id, count(d.read_at)::int as reads, count(d.cta_clicked_at)::int as clicks
        from announcement_deliveries d
        where d.announcement_id in (select id from announcements where was_published and published_at > now() - interval '60 days')
        group by d.announcement_id) s
  where x.id = s.announcement_id and (x.read_count, x.click_count) is distinct from (s.reads, s.clicks);
end $$;
revoke all on function dating_private.ann_deliver_batch(uuid, int), dating_private.ann_tick() from public, anon, authenticated;
select cron.schedule('announcements-tick', '* * * * *', 'select dating_private.ann_tick()');

-- ---- Members ----------------------------------------------------------------------------------------------
-- My announcements, newest first, 20 at a time. p_filter: all | unread | read | archived.
create function public.my_announcements(p_filter text default 'all', p_before timestamptz default null, p_limit int default 20)
returns table (id uuid, title text, preview text, category text, cover_url text, cta_label text, cta_url text,
               published_at timestamptz, delivered_at timestamptz, read_at timestamptz, archived_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.title, a.preview, a.category, a.cover_url, a.cta_label, a.cta_url,
         a.published_at, d.delivered_at, d.read_at, d.archived_at
  from announcement_deliveries d join announcements a on a.id = d.announcement_id
  where d.user_id = auth.uid()
    and (a.expires_at is null or a.expires_at > now())
    and (p_before is null or d.delivered_at < p_before)
    and case coalesce(p_filter, 'all')
          when 'unread' then d.read_at is null and d.archived_at is null
          when 'read' then d.read_at is not null and d.archived_at is null
          when 'archived' then d.archived_at is not null
          else d.archived_at is null end
  order by d.delivered_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

create function public.my_announcements_unread() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from announcement_deliveries d join announcements a on a.id = d.announcement_id
  where d.user_id = auth.uid() and d.read_at is null and d.archived_at is null
    and (a.expires_at is null or a.expires_at > now());
$$;

-- One announcement (only if it was delivered to me). Opening it marks it read.
create function public.open_announcement(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  d record;
  a record;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into d from announcement_deliveries where user_id = me and announcement_id = p_id;
  if d.user_id is null then raise exception 'Announcement not found.' using errcode = 'P0002'; end if;
  select * into a from announcements where id = p_id;
  if d.read_at is null then update announcement_deliveries set read_at = now() where user_id = me and announcement_id = p_id; end if;
  return jsonb_build_object('id', a.id, 'title', a.title, 'preview', a.preview, 'body', a.body, 'category', a.category,
    'cover_url', a.cover_url, 'cta_label', a.cta_label, 'cta_url', a.cta_url, 'published_at', a.published_at,
    'read_at', coalesce(d.read_at, now()), 'archived_at', d.archived_at,
    'expired', a.expires_at is not null and a.expires_at <= now(),
    'revises', (select r.id from announcements r join announcement_deliveries rd on rd.announcement_id = r.id and rd.user_id = me where r.id = a.revises),
    'revised_by', (select r.id from announcements r join announcement_deliveries rd on rd.announcement_id = r.id and rd.user_id = me
                   where r.revises = a.id order by r.published_at desc limit 1));
end $$;

-- read | unread | archive | unarchive | click (the button was tapped)
create function public.mark_announcement(p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  update announcement_deliveries set
    read_at = case when p_action in ('read', 'click') then coalesce(read_at, now()) when p_action = 'unread' then null else read_at end,
    archived_at = case when p_action = 'archive' then coalesce(archived_at, now()) when p_action = 'unarchive' then null else archived_at end,
    cta_clicked_at = case when p_action = 'click' then coalesce(cta_clicked_at, now()) else cta_clicked_at end
  where user_id = auth.uid() and announcement_id = p_id
    and p_action in ('read', 'unread', 'archive', 'unarchive', 'click');
end $$;

create function public.mark_all_announcements_read() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update announcement_deliveries set read_at = now() where user_id = auth.uid() and read_at is null and archived_at is null;
  get diagnostics n = row_count;
  return n;
end $$;

create function public.my_announcement_prefs() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('push_updates', coalesce((select push_updates from announcement_prefs where user_id = auth.uid()), true));
$$;
create function public.set_announcement_push(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  insert into announcement_prefs (user_id, push_updates) values (auth.uid(), coalesce(p_on, true))
  on conflict (user_id) do update set push_updates = excluded.push_updates, updated_at = now();
end $$;

revoke all on function public.my_announcements(text, timestamptz, int), public.my_announcements_unread(), public.open_announcement(uuid),
  public.mark_announcement(uuid, text), public.mark_all_announcements_read(), public.my_announcement_prefs(), public.set_announcement_push(boolean)
  from public, anon;
grant execute on function public.my_announcements(text, timestamptz, int), public.my_announcements_unread(), public.open_announcement(uuid),
  public.mark_announcement(uuid, text), public.mark_all_announcements_read(), public.my_announcement_prefs(), public.set_announcement_push(boolean)
  to authenticated;

-- ---- Staff ------------------------------------------------------------------------------------------------
-- My staff role (null when I'm not staff). The app uses it to show the admin screens.
create function public.ann_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when s.user_id is null then null else jsonb_build_object('role', s.role,
    'can_publish', s.role = 'super_admin' or (s.role in ('admin', 'editor') and s.can_publish)) end
  from (select 1) x left join announcement_staff s on s.user_id = auth.uid();
$$;

create function public.ann_overview() returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  delivered bigint; reads bigint;
begin
  perform ann_require('view');
  select coalesce(sum(delivered_count), 0), coalesce(sum(read_count), 0) into delivered, reads from announcements where was_published;
  return jsonb_build_object(
    'total', (select count(*) from announcements),
    'published', (select count(*) from announcements where status in ('publishing', 'published')),
    'scheduled', (select count(*) from announcements where status = 'scheduled'),
    'drafts', (select count(*) from announcements where status = 'draft'),
    'archived', (select count(*) from announcements where status = 'archived'),
    'delivered', delivered,
    'recipients', (select count(distinct user_id) from announcement_deliveries),
    'reads', reads,
    'read_rate', case when delivered > 0 then round(reads * 100.0 / delivered, 1) else 0 end,
    'clicks', (select coalesce(sum(click_count), 0) from announcements where was_published));
end $$;

-- The management list. p_status: all | published | scheduled | draft | archived.
create function public.ann_list(p_status text default 'all', p_category text default null, p_query text default null,
                                p_from timestamptz default null, p_to timestamptz default null,
                                p_offset int default 0, p_limit int default 20)
returns table (id uuid, title text, category text, status text, audience jsonb, cover_url text, created_at timestamptz,
               scheduled_for timestamptz, published_at timestamptz, delivered_at timestamptz, eligible_count int,
               delivered_count int, read_count int, click_count int, push_count int, revises uuid, created_by_handle text, total bigint)
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  perform ann_require('view');
  return query
    select a.id, a.title, a.category, a.status, a.audience, a.cover_url, a.created_at, a.scheduled_for, a.published_at, a.delivered_at,
           a.eligible_count, a.delivered_count, a.read_count, a.click_count, a.push_count, a.revises,
           (select p.handle from dating_profiles p where p.user_id = a.created_by), count(*) over ()
    from announcements a
    where (coalesce(p_status, 'all') = 'all'
           or (p_status = 'published' and a.status in ('publishing', 'published'))
           or a.status = p_status)
      and (p_category is null or a.category = p_category)
      and (p_query is null or btrim(p_query) = '' or a.title ilike '%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%')
      and (p_from is null or coalesce(a.published_at, a.scheduled_for, a.created_at) >= p_from)
      and (p_to is null or coalesce(a.published_at, a.scheduled_for, a.created_at) < p_to)
    order by coalesce(a.published_at, a.scheduled_for, a.created_at) desc
    offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 20), 1), 100);
end $$;

create function public.ann_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare a record;
begin
  perform ann_require('view');
  select * into a from announcements where id = p_id;
  if a.id is null then raise exception 'Announcement not found.' using errcode = 'P0002'; end if;
  return to_jsonb(a) - 'delivery_cursor' || jsonb_build_object(
    'created_by_handle', (select handle from dating_profiles where user_id = a.created_by),
    'published_by_handle', (select handle from dating_profiles where user_id = a.published_by),
    'revised_by', (select r.id from announcements r where r.revises = a.id order by r.created_at desc limit 1));
end $$;

-- How many people this audience reaches right now (real accounts, counted in the database).
create function public.ann_estimate(p_audience jsonb) returns int
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  perform ann_require('view');
  return (select count(*) from ann_targets(ann_clean_audience(p_audience)));
end $$;

-- Create (p_id null) or edit a draft or scheduled announcement. Published ones can't be edited:
-- use ann_correction() to start a revised copy.
create function public.ann_save(p_id uuid, p_fields jsonb) returns uuid
language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  cur record;
  v_title text := btrim(coalesce(p_fields ->> 'title', ''));
  v_preview text := btrim(coalesce(p_fields ->> 'preview', ''));
  v_body text := coalesce(p_fields ->> 'body', '');
  v_category text := p_fields ->> 'category';
  v_cover text := nullif(btrim(coalesce(p_fields ->> 'cover_url', '')), '');
  v_label text := nullif(btrim(coalesce(p_fields ->> 'cta_label', '')), '');
  v_url text := nullif(btrim(coalesce(p_fields ->> 'cta_url', '')), '');
  v_aud jsonb := ann_clean_audience(coalesce(p_fields -> 'audience', '{"base": "active"}'::jsonb));
  v_push boolean := coalesce((p_fields ->> 'send_push')::boolean, true);
  v_expires timestamptz := nullif(p_fields ->> 'expires_at', '')::timestamptz;
  v_id uuid;
begin
  perform ann_require('edit');
  if char_length(v_title) not between 1 and 100 then raise exception 'Add a title (up to 100 characters).' using errcode = '22023'; end if;
  if char_length(v_preview) not between 1 and 160 then raise exception 'Add preview text (up to 160 characters).' using errcode = '22023'; end if;
  if v_category is null or v_category not in ('product_update', 'feature_launch', 'event', 'community', 'maintenance', 'important') then
    raise exception 'Choose a category.' using errcode = '22023';
  end if;
  if v_body ~* '<\s*(script|iframe|object|embed|style)|javascript:|data:text' then
    raise exception 'The content can’t contain scripts or embedded code.' using errcode = '22023';
  end if;
  if (v_label is null) <> (v_url is null) then raise exception 'A button needs both a label and a destination.' using errcode = '22023'; end if;
  if v_url is not null and not ann_link_ok(v_url) then
    raise exception 'The button must open an approved treehouse page or an https:// link.' using errcode = '22023';
  end if;
  if v_cover is not null and v_cover !~ '^https://[^\s<>"'']+$' then raise exception 'The cover image must be an https:// link.' using errcode = '22023'; end if;

  if p_id is null then
    insert into announcements (title, preview, body, category, cover_url, cta_label, cta_url, audience, send_push, expires_at,
                               revises, created_by, updated_by)
    values (v_title, v_preview, v_body, v_category, v_cover, v_label, v_url, v_aud, v_push, v_expires,
            nullif(p_fields ->> 'revises', '')::uuid, me, me)
    returning id into v_id;
    perform ann_log('created', v_id, jsonb_build_object('title', v_title, 'category', v_category));
    return v_id;
  end if;

  select * into cur from announcements where id = p_id for update;
  if cur.id is null then raise exception 'Announcement not found.' using errcode = 'P0002'; end if;
  if cur.status not in ('draft', 'scheduled') then
    raise exception 'Published announcements can’t be changed. Send a correction instead.' using errcode = '42501';
  end if;
  update announcements set title = v_title, preview = v_preview, body = v_body, category = v_category, cover_url = v_cover,
    cta_label = v_label, cta_url = v_url, audience = v_aud, send_push = v_push, expires_at = v_expires,
    updated_by = me, updated_at = now()
  where id = p_id;
  perform ann_log('edited', p_id, jsonb_build_object('changed', (
    select coalesce(jsonb_agg(k), '[]'::jsonb) from (values
      ('title', cur.title is distinct from v_title), ('preview', cur.preview is distinct from v_preview),
      ('body', cur.body is distinct from v_body), ('category', cur.category is distinct from v_category),
      ('cover', cur.cover_url is distinct from v_cover), ('button', (cur.cta_label, cur.cta_url) is distinct from (v_label, v_url)),
      ('audience', cur.audience is distinct from v_aud), ('push', cur.send_push is distinct from v_push),
      ('expiry', cur.expires_at is distinct from v_expires)) c(k, changed) where changed)));
  return p_id;
end $$;

-- Publish now (p_when null or in the past) or schedule for later.
create function public.ann_publish(p_id uuid, p_when timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  a record;
  n int;
begin
  perform ann_require('publish');
  select * into a from announcements where id = p_id for update;
  if a.id is null then raise exception 'Announcement not found.' using errcode = 'P0002'; end if;
  if a.status not in ('draft', 'scheduled') then raise exception 'This announcement was already published.' using errcode = '42501'; end if;
  if a.expires_at is not null and a.expires_at <= coalesce(p_when, now()) then raise exception 'The end date is before the publish time.' using errcode = '22023'; end if;

  if p_when is not null and p_when > now() + interval '1 minute' then
    if p_when > now() + interval '366 days' then raise exception 'Schedule within the next year.' using errcode = '22023'; end if;
    update announcements set status = 'scheduled', scheduled_for = p_when, scheduled_by = me, updated_at = now() where id = p_id;
    perform ann_log('scheduled', p_id, jsonb_build_object('for', p_when));
    return jsonb_build_object('status', 'scheduled', 'scheduled_for', p_when);
  end if;

  n := (select count(*) from ann_targets(a.audience));
  update announcements set status = 'publishing', published_at = now(), published_by = me, was_published = true,
         eligible_count = n, updated_at = now()
  where id = p_id;
  perform ann_log('published', p_id, jsonb_build_object('eligible', n));
  perform ann_deliver_batch(p_id);    -- the first 5,000 straight away; the minute job does the rest
  return jsonb_build_object('status', (select status from announcements where id = p_id), 'eligible', n);
end $$;

-- Stop a scheduled announcement before it goes out (it goes back to Drafts).
create function public.ann_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  perform ann_require('publish');
  update announcements set status = 'draft', scheduled_for = null, updated_by = auth.uid(), updated_at = now()
  where id = p_id and status = 'scheduled';
  if not found then raise exception 'Only scheduled announcements can be cancelled.' using errcode = '42501'; end if;
  perform ann_log('cancelled', p_id);
end $$;

-- Archive (hide from the active list). Published copies stay in members' Inboxes unchanged.
create function public.ann_archive(p_id uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare a record;
begin
  perform ann_require('edit');
  select * into a from announcements where id = p_id for update;
  if a.id is null then raise exception 'Announcement not found.' using errcode = 'P0002'; end if;
  if p_on then
    if a.status in ('scheduled', 'publishing') then raise exception 'Cancel it or wait for delivery to finish first.' using errcode = '42501'; end if;
    update announcements set status = 'archived', archived_at = now(), updated_by = auth.uid() where id = p_id;
    perform ann_log('archived', p_id);
  else
    if a.status <> 'archived' then return; end if;
    update announcements set status = case when a.was_published then 'published' else 'draft' end, archived_at = null, updated_by = auth.uid() where id = p_id;
    perform ann_log('unarchived', p_id);
  end if;
end $$;

-- A correction: a new draft copied from a published announcement, linked to it. The original and its
-- delivery records are never changed.
create function public.ann_correction(p_id uuid) returns uuid
language plpgsql security definer set search_path = public, dating_private as $$
declare a record; v_id uuid;
begin
  perform ann_require('edit');
  select * into a from announcements where id = p_id;
  if a.id is null or not a.was_published then raise exception 'Only published announcements can be corrected.' using errcode = '42501'; end if;
  insert into announcements (title, preview, body, category, cover_url, cta_label, cta_url, audience, send_push, revises, created_by, updated_by)
  values (left('Update: ' || a.title, 100), a.preview, a.body, a.category, a.cover_url, a.cta_label, a.cta_url, a.audience, false, a.id, auth.uid(), auth.uid())
  returning id into v_id;
  perform ann_log('correction_started', v_id, jsonb_build_object('revises', a.id));
  return v_id;
end $$;

-- Delete a draft that was never published.
create function public.ann_delete_draft(p_id uuid) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  perform ann_require('edit');
  perform ann_log('deleted_draft', p_id, (select jsonb_build_object('title', title) from announcements where id = p_id));
  delete from announcements where id = p_id and status = 'draft' and not was_published;
  if not found then raise exception 'Only unpublished drafts can be deleted.' using errcode = '42501'; end if;
end $$;

-- Numbers for one announcement. Counts only: no names, no handles of recipients.
create function public.ann_analytics(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  a record;
  s record;
begin
  perform ann_require('view');
  select * into a from announcements where id = p_id;
  if a.id is null then raise exception 'Announcement not found.' using errcode = 'P0002'; end if;
  select count(*) as delivered, count(read_at) as reads, count(cta_clicked_at) as clicks, count(archived_at) as archived,
         count(push_queued_at) as pushes
    into s from announcement_deliveries where announcement_id = p_id;
  return jsonb_build_object(
    'status', a.status,
    'targeted', coalesce(a.eligible_count, case when a.status in ('draft', 'scheduled') then (select count(*) from ann_targets(a.audience)) end),
    'eligible_now', case when a.status in ('draft', 'scheduled') then (select count(*) from ann_targets(a.audience)) end,
    'delivered', s.delivered,
    'pending', case when a.status = 'publishing' then greatest(coalesce(a.eligible_count, 0) - s.delivered, 0) else 0 end,
    'failed', 0,
    'push_queued', s.pushes,
    'reads', s.reads,
    'unread', s.delivered - s.reads,
    'read_rate', case when s.delivered > 0 then round(s.reads * 100.0 / s.delivered, 1) else 0 end,
    'clicks', s.clicks,
    'click_rate', case when s.delivered > 0 then round(s.clicks * 100.0 / s.delivered, 1) else 0 end,
    'archived', s.archived,
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'reads', reads, 'clicks', clicks) order by day), '[]'::jsonb) from (
       select (x.t_at at time zone 'Africa/Lagos')::date as day, count(*) filter (where x.kind = 'r') as reads, count(*) filter (where x.kind = 'c') as clicks
       from (select read_at as t_at, 'r' as kind from announcement_deliveries where announcement_id = p_id and read_at is not null
             union all
             select cta_clicked_at, 'c' from announcement_deliveries where announcement_id = p_id and cta_clicked_at is not null) x
       group by 1 order by 1 desc limit 30) t));
end $$;

create function public.ann_audit_log(p_id uuid default null, p_limit int default 50)
returns table (at timestamptz, action text, actor_handle text, announcement_id uuid, title text, meta jsonb)
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  perform ann_require('view');
  return query
    select l.at, l.action, (select p.handle from dating_profiles p where p.user_id = l.actor), l.announcement_id,
           (select a.title from announcements a where a.id = l.announcement_id), l.meta
    from announcement_audit l
    where p_id is null or l.announcement_id = p_id
    order by l.at desc limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

-- Staff management (Super Admin only). Staff are named by their treehouse handle.
create function public.ann_staff() returns table (handle text, role text, can_publish boolean, added_at timestamptz)
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  perform ann_require('view');
  return query select p.handle, s.role, s.can_publish, s.added_at
    from announcement_staff s left join dating_profiles p on p.user_id = s.user_id order by s.added_at;
end $$;

create function dating_private.ann_set_staff_by(p_actor uuid, p_handle text, p_role text, p_can_publish boolean) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare uid uuid;
begin
  select user_id into uid from dating_profiles where lower(handle) = lower(btrim(p_handle));
  if uid is null then raise exception 'No treehouse account has that handle.' using errcode = 'P0002'; end if;
  if p_role is null then
    if uid = p_actor then raise exception 'You can’t remove yourself.' using errcode = '42501'; end if;
    delete from announcement_staff where user_id = uid;
  else
    if p_role not in ('super_admin', 'admin', 'editor', 'analyst') then raise exception 'Choose a valid role.' using errcode = '22023'; end if;
    insert into announcement_staff (user_id, role, can_publish, added_by)
    values (uid, p_role, coalesce(p_can_publish, false) and p_role <> 'analyst', p_actor)
    on conflict (user_id) do update set role = excluded.role, can_publish = excluded.can_publish;
  end if;
  insert into announcement_audit (actor, action, announcement_id, meta)
  values (p_actor, case when p_role is null then 'staff_removed' else 'staff_set' end, null,
          jsonb_build_object('handle', (select handle from dating_profiles where user_id = uid), 'role', p_role, 'can_publish', p_can_publish));
end $$;
revoke all on function dating_private.ann_set_staff_by(uuid, text, text, boolean) from public, anon, authenticated;

create function public.ann_set_staff(p_handle text, p_role text, p_can_publish boolean default false) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  perform ann_require('staff');
  perform ann_set_staff_by(auth.uid(), p_handle, p_role, p_can_publish);
end $$;

-- The owner key can name staff too (used once to make the owner Super Admin).
create function public.admin_ann_set_staff(p_key text, p_handle text, p_role text, p_can_publish boolean default true) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if not admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  perform ann_set_staff_by(null, p_handle, p_role, p_can_publish);
end $$;

revoke all on function public.ann_me(), public.ann_overview(), public.ann_list(text, text, text, timestamptz, timestamptz, int, int),
  public.ann_get(uuid), public.ann_estimate(jsonb), public.ann_save(uuid, jsonb), public.ann_publish(uuid, timestamptz),
  public.ann_cancel(uuid), public.ann_archive(uuid, boolean), public.ann_correction(uuid), public.ann_delete_draft(uuid),
  public.ann_analytics(uuid), public.ann_audit_log(uuid, int), public.ann_staff(), public.ann_set_staff(text, text, boolean),
  public.admin_ann_set_staff(text, text, text, boolean) from public, anon;
grant execute on function public.ann_me(), public.ann_overview(), public.ann_list(text, text, text, timestamptz, timestamptz, int, int),
  public.ann_get(uuid), public.ann_estimate(jsonb), public.ann_save(uuid, jsonb), public.ann_publish(uuid, timestamptz),
  public.ann_cancel(uuid), public.ann_archive(uuid, boolean), public.ann_correction(uuid), public.ann_delete_draft(uuid),
  public.ann_analytics(uuid), public.ann_audit_log(uuid, int), public.ann_staff(), public.ann_set_staff(text, text, boolean)
  to authenticated;
grant execute on function public.admin_ann_set_staff(text, text, text, boolean) to anon, authenticated;

-- ---- Cover and inline images ------------------------------------------------------------------------------
-- Public bucket (announcements are public to their audience). Only staff who can edit may upload,
-- JPEG/PNG/WebP up to 2 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('announcement-images', 'announcement-images', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

create function dating_private.ann_can_upload() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from announcement_staff where user_id = auth.uid() and role in ('super_admin', 'admin', 'editor'));
$$;
revoke all on function dating_private.ann_can_upload() from public, anon;
grant execute on function dating_private.ann_can_upload() to authenticated;

drop policy if exists "announcement images: staff upload" on storage.objects;
create policy "announcement images: staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'announcement-images' and dating_private.ann_can_upload()
              and name ~ '^[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}\.(jpg|png|webp)$');
