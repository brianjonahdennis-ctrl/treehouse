-- Staff console for admin.treehouse.ng.
-- Staff sign in with their treehouse account. Every staff_* function checks, in the database:
--   1. the person is in announcement_staff (roles: super_admin, admin, moderator, editor, analyst)
--   2. the session passed the authenticator-app step (Supabase MFA, aal2)
--   3. the role allows the action
-- and records every change, and every look at a private chat, in dating_private.staff_audit.
-- Additive only: new tables, new functions, two triggers, one column on room_reports.

-- ---- Roles ----------------------------------------------------------------------------------------
alter table public.announcement_staff drop constraint if exists announcement_staff_role_check;
alter table public.announcement_staff add constraint announcement_staff_role_check
  check (role in ('super_admin', 'admin', 'moderator', 'editor', 'analyst'));

create or replace function dating_private.ann_set_staff_by(p_actor uuid, p_handle text, p_role text, p_can_publish boolean)
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare uid uuid;
begin
  select user_id into uid from dating_profiles where lower(handle) = lower(btrim(p_handle));
  if uid is null then raise exception 'No treehouse account has that handle.' using errcode = 'P0002'; end if;
  if p_role is null then
    if uid = p_actor then raise exception 'You can’t remove yourself.' using errcode = '42501'; end if;
    delete from announcement_staff where user_id = uid;
  else
    if p_role not in ('super_admin', 'admin', 'moderator', 'editor', 'analyst') then raise exception 'Choose a valid role.' using errcode = '22023'; end if;
    if uid = p_actor and p_role <> 'super_admin' then raise exception 'You can’t lower your own role.' using errcode = '42501'; end if;
    insert into announcement_staff (user_id, role, can_publish, added_by)
    values (uid, p_role, coalesce(p_can_publish, false) and p_role in ('super_admin', 'admin', 'editor'), p_actor)
    on conflict (user_id) do update set role = excluded.role, can_publish = excluded.can_publish;
  end if;
  insert into announcement_audit (actor, action, announcement_id, meta)
  values (p_actor, case when p_role is null then 'staff_removed' else 'staff_set' end, null,
          jsonb_build_object('handle', (select handle from dating_profiles where user_id = uid), 'role', p_role, 'can_publish', p_can_publish));
end $$;

-- ---- Audit log, notes, settings ---------------------------------------------------------------------
create table dating_private.staff_audit (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       uuid references auth.users (id) on delete set null,
  actor_handle text,
  action      text not null,
  target_type text,
  target_id   text,
  meta        jsonb not null default '{}'::jsonb
);
create index staff_audit_at on dating_private.staff_audit (at desc);
create index staff_audit_target on dating_private.staff_audit (target_type, target_id, at desc);

create table dating_private.staff_notes (
  id         bigserial primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  author     uuid references auth.users (id) on delete set null,
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index staff_notes_user on dating_private.staff_notes (user_id, created_at desc);

create table dating_private.app_settings (
  key        text primary key check (key in ('signups_paused', 'signups_paused_reason', 'ads_enabled', 'referrals_enabled')),
  value      jsonb not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into dating_private.app_settings (key, value) values
  ('signups_paused', 'false'), ('signups_paused_reason', '""'), ('ads_enabled', 'true'), ('referrals_enabled', 'true');

create table dating_private.room_settings (
  room       text primary key,
  closed     boolean not null default false,
  reason     text not null default '' check (char_length(reason) <= 200),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.room_reports add column if not exists status text not null default 'open'
  check (status in ('open', 'reviewed', 'actioned'));
create index if not exists room_reports_open on public.room_reports (status, message_id);

revoke all on dating_private.staff_audit, dating_private.staff_notes, dating_private.app_settings,
  dating_private.room_settings from public, anon, authenticated;

create function dating_private.setting(p_key text) returns jsonb
language sql stable security definer set search_path = dating_private as $$
  select value from app_settings where key = p_key
$$;

-- ---- The checks ------------------------------------------------------------------------------------
create function dating_private.staff_allows(p_role text, p_need text) returns boolean
language sql immutable as $$
  select case p_need
    when 'view'     then p_role is not null
    when 'moderate' then p_role in ('super_admin', 'admin', 'moderator')
    when 'content'  then p_role in ('super_admin', 'admin', 'editor')
    when 'manage'   then p_role in ('super_admin', 'admin')
    when 'super'    then p_role = 'super_admin'
    else false end
$$;

create function dating_private.staff_mfa() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

-- Raises unless the caller may do p_need right now; returns their role.
create function dating_private.staff_need(p_need text) returns text
language plpgsql stable security definer set search_path = public, dating_private as $$
declare r text;
begin
  select role into r from announcement_staff where user_id = auth.uid();
  if r is null then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if not staff_mfa() then raise exception 'Enter the code from your authenticator app first.' using errcode = '42501'; end if;
  if not staff_allows(r, p_need) then raise exception 'Your role doesn’t allow this.' using errcode = '42501'; end if;
  return r;
end $$;

-- Same check, as a yes/no (for storage rules).
create function dating_private.staff_can(p_need text) returns boolean
language sql stable security definer set search_path = public, dating_private as $$
  select coalesce((select staff_allows(role, p_need) from announcement_staff where user_id = auth.uid()), false) and staff_mfa()
$$;

create function dating_private.staff_log(p_actor uuid, p_action text, p_type text, p_id text, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public, dating_private as $$
  insert into staff_audit (actor, actor_handle, action, target_type, target_id, meta)
  values (p_actor, (select handle from dating_profiles where user_id = p_actor), p_action, p_type, p_id, coalesce(p_meta, '{}'::jsonb))
$$;

-- After the checks, staff changes run as the system: the profile guards treat any signed-in caller
-- as the member editing themselves (who can't lift a suspension, move the age clock, ...).
create function dating_private.staff_as_system() returns text
language plpgsql as $$
declare was text := coalesce(current_setting('request.jwt.claims', true), '') || chr(1) || coalesce(current_setting('request.jwt.claim.sub', true), '');
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return was;
end $$;
create function dating_private.staff_as_caller(p_was text) returns void
language sql as $$
  select set_config('request.jwt.claims', split_part(p_was, chr(1), 1), true),
         set_config('request.jwt.claim.sub', split_part(p_was, chr(1), 2), true)
$$;

-- Lets a staff_* function reuse the existing admin_* functions without the server's admin key.
-- Only staff_* functions set this, for the length of one call inside one request.
create or replace function dating_private.admin_ok(p_key text) returns boolean
language sql stable security definer set search_path = dating_private, extensions as $$
  select exists (select 1 from admin_key where fingerprint = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex'))
      or coalesce(current_setting('treehouse.staff_call', true), '') = '1'
$$;
create function dating_private.staff_admin_on() returns void language sql as $$ select set_config('treehouse.staff_call', '1', true) $$;
create function dating_private.staff_admin_off() returns void language sql as $$ select set_config('treehouse.staff_call', '', true) $$;

create function dating_private.staff_uid(p_handle text) returns uuid
language plpgsql stable security definer set search_path = public, dating_private as $$
declare uid uuid;
begin
  select user_id into uid from dating_profiles where lower(handle) = lower(btrim(coalesce(p_handle, '')));
  if uid is null then raise exception 'No member has that handle.' using errcode = 'P0002'; end if;
  return uid;
end $$;

create function dating_private.lagos_today() returns date language sql stable as $$ select (now() at time zone 'Africa/Lagos')::date $$;

revoke all on function dating_private.setting(text), dating_private.staff_allows(text, text), dating_private.staff_mfa(),
  dating_private.staff_need(text), dating_private.staff_log(uuid, text, text, text, jsonb), dating_private.staff_as_system(), dating_private.staff_as_caller(text),
  dating_private.staff_admin_on(), dating_private.staff_admin_off(), dating_private.staff_uid(text), dating_private.lagos_today()
  from public, anon, authenticated;
revoke all on function dating_private.staff_can(text) from public, anon;
grant execute on function dating_private.staff_can(text) to authenticated;

-- ---- Who am I ---------------------------------------------------------------------------------------
-- Any signed-in person may ask; null when they're not staff. Works before the authenticator step.
create function public.staff_me() returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select case when s.user_id is null then null else jsonb_build_object(
    'role', s.role,
    'can_publish', s.role = 'super_admin' or (s.role in ('admin', 'editor') and s.can_publish),
    'handle', p.handle,
    'mfa', staff_mfa()) end
  from (select auth.uid() as uid) me
  left join announcement_staff s on s.user_id = me.uid
  left join dating_profiles p on p.user_id = me.uid
$$;

create function public.staff_signed_in() returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  perform staff_need('view');
  perform staff_log(auth.uid(), 'signed_in', null, null);
end $$;

-- ---- Dashboard --------------------------------------------------------------------------------------
create function public.staff_dashboard(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  d int := least(greatest(coalesce(p_days, 7), 1), 90);
  today date := lagos_today();
  out jsonb;
  part jsonb;
begin
  perform staff_need('view');
  select jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'profiles', (select count(*) from dating_profiles),
    'online_now', (select count(*) from dating_profiles where last_seen_at > now() - interval '5 minutes'),
    'active_1d', (select count(*) from dating_profiles where last_seen_at > now() - interval '1 day'),
    'active_7d', (select count(*) from dating_profiles where last_seen_at > now() - interval '7 days'),
    'active_30d', (select count(*) from dating_profiles where last_seen_at > now() - interval '30 days'),
    'new_today', (select count(*) from dating_profiles where (created_at at time zone 'Africa/Lagos')::date = today),
    'suspended', (select count(*) from dating_profiles where suspended),
    'underage_marked', (select count(*) from dating_profiles where dob_underage_at is not null),
    'room_bans', (select count(*) from room_bans where until > now()),
    'chat_messages_today', (select count(*) from dating_messages where created_at >= (today::timestamp at time zone 'Africa/Lagos')),
    'room_messages_today', (select count(*) from room_messages where created_at >= (today::timestamp at time zone 'Africa/Lagos')),
    'in_rooms_now', (select count(*) from room_members where last_seen_at > now() - interval '2 minutes'),
    'open_reports', jsonb_build_object(
      'chat', (select count(*) from dating_reports where status = 'open'),
      'room', (select count(distinct message_id) from room_reports where status = 'open'),
      'link', (select count(*) from link_reports where status = 'open')),
    'signups', coalesce((select jsonb_agg(jsonb_build_object('day', g.day, 'profiles', coalesce(c.n, 0)) order by g.day)
      from generate_series(today - (d - 1), today, interval '1 day') as g(day)
      left join (select (created_at at time zone 'Africa/Lagos')::date as day, count(*) as n from dating_profiles
                 where created_at > now() - make_interval(days => d + 1) group by 1) c on c.day = g.day::date), '[]'::jsonb),
    'gender', (select coalesce(jsonb_object_agg(g, n), '{}'::jsonb) from (select gender::text as g, count(*) as n from dating_profiles group by 1) x),
    'top_states', (select coalesce(jsonb_agg(jsonb_build_object('state', state, 'people', n) order by n desc), '[]'::jsonb)
      from (select coalesce(nullif(state, ''), 'Unknown') as state, count(*) as n from dating_profiles group by 1 order by 2 desc limit 10) x),
    'ads', jsonb_build_object(
      'active', (select count(*) from ads where status = 'active' and (ends_at is null or ends_at > now())),
      'views_today', (select coalesce(sum(views), 0) from ad_daily where day = today),
      'taps_today', (select coalesce(sum(taps), 0) from ad_daily where day = today)),
    'referrals', jsonb_build_object(
      'joined_today', (select count(*) from referrals where (claimed_at at time zone 'Africa/Lagos')::date = today),
      'joined_period', (select count(*) from referrals where claimed_at > now() - make_interval(days => d)))
  ) into out;

  perform staff_admin_on();
  begin part := admin_dating_stats(null, d); out := out || jsonb_build_object('dating', part); exception when others then null; end;
  begin part := admin_platform_stats(null, d); out := out || jsonb_build_object('platforms', part); exception when others then null; end;
  begin part := admin_deletion_stats(null, d); out := out || jsonb_build_object('deletions', part); exception when others then null; end;
  begin part := admin_speed_stats(null, d); out := out || jsonb_build_object('speed', part); exception when others then null; end;
  begin part := admin_photo_stats(null); out := out || jsonb_build_object('photos', part); exception when others then null; end;
  begin part := admin_reputation_stats(null); out := out || jsonb_build_object('reputation', part); exception when others then null; end;
  perform staff_admin_off();
  return out || jsonb_build_object('days', d, 'at', now());
end $$;

-- ---- Members ----------------------------------------------------------------------------------------
create function public.staff_members(p_q text default '', p_filter text default 'all', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  r text := staff_need('moderate');
  q text := btrim(coalesce(p_q, ''));
  by_email boolean := q like '%@%' and staff_allows(r, 'manage');
begin
  return coalesce((select jsonb_agg(x order by x.sort_at desc nulls last) from (
    select p.handle, p.gender::text as gender, p.age, p.state, p.intent::text as intent, p.created_at, p.last_seen_at,
           p.suspended, p.is_active, p.dob_underage_at is not null as underage,
           (select b.until from room_bans b where b.user_id = p.user_id and b.until > now()) as room_ban_until,
           (select count(*) from dating_reports dr where dr.reported_id = p.user_id and dr.status = 'open') as open_reports,
           (select s.role from announcement_staff s where s.user_id = p.user_id) as staff_role,
           case when p_filter = 'new' then p.created_at else coalesce(p.last_seen_at, p.created_at) end as sort_at
    from dating_profiles p
    where (q = '' or (by_email and p.user_id in (select u.id from auth.users u where lower(u.email) = lower(q)))
                  or (not by_email and p.handle ilike '%' || replace(replace(q, '%', ''), '_', '\_') || '%'))
      and case coalesce(p_filter, 'all')
            when 'online' then p.last_seen_at > now() - interval '5 minutes'
            when 'new' then p.created_at > now() - interval '7 days'
            when 'suspended' then p.suspended
            when 'reported' then exists (select 1 from dating_reports dr where dr.reported_id = p.user_id and dr.status = 'open')
            when 'room_banned' then exists (select 1 from room_bans b where b.user_id = p.user_id and b.until > now())
            when 'underage' then p.dob_underage_at is not null
            when 'staff' then exists (select 1 from announcement_staff s where s.user_id = p.user_id)
            else true end
    order by case when p_filter = 'new' then p.created_at else coalesce(p.last_seen_at, p.created_at) end desc nulls last
    limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)
  ) x), '[]'::jsonb);
end $$;

create function public.staff_member(p_handle text) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  r text := staff_need('moderate');
  uid uuid := staff_uid(p_handle);
  p dating_profiles%rowtype;
  u record;
  out jsonb;
begin
  select * into p from dating_profiles where user_id = uid;
  select email, created_at, last_sign_in_at, banned_until into u from auth.users where id = uid;
  out := jsonb_build_object(
    'handle', p.handle, 'gender', p.gender, 'age', p.age, 'state', p.state, 'location', p.location, 'intent', p.intent,
    'bio', p.bio, 'interests', p.interests, 'created_at', p.created_at, 'updated_at', p.updated_at, 'last_seen_at', p.last_seen_at,
    'is_active', p.is_active, 'suspended', p.suspended, 'underage_at', p.dob_underage_at, 'birthday_public', p.birthday_public,
    'age_changed_at', p.age_changed_at,
    'signed_up_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
    'sign_in_blocked', u.banned_until is not null and u.banned_until > now(),
    'staff_role', (select role from announcement_staff where user_id = uid),
    'room_ban', (select jsonb_build_object('until', until, 'reason', reason) from room_bans where user_id = uid and until > now()),
    'counts', jsonb_build_object(
      'chats', (select count(*) from dating_conversations c where uid in (c.user_a, c.user_b) and c.accepted_at is not null),
      'requests', (select count(*) from dating_conversations c where uid in (c.user_a, c.user_b) and c.accepted_at is null and c.declined_at is null),
      'friends', (select count(*) from dating_conversations c where uid in (c.user_a, c.user_b) and c.kind = 'friend' and c.accepted_at is not null),
      'messages_sent', (select count(*) from dating_messages m where m.sender_id = uid),
      'room_messages', (select count(*) from room_messages m where m.user_id = uid),
      'blocked_others', (select count(*) from dating_blocks b where b.blocker_id = uid),
      'blocked_by', (select count(*) from dating_blocks b where b.blocked_id = uid),
      'reports_against', (select count(*) from dating_reports dr where dr.reported_id = uid),
      'reports_made', (select count(*) from dating_reports dr where dr.reporter_id = uid),
      'push_devices', (select count(*) from push_subscriptions s where s.user_id = uid)),
    'reputation', (select jsonb_build_object('score', round(score, 2), 'raters', raters, 'band', band, 'established', established) from reputation where user_id = uid),
    'bird_level', (select level from bird_kingdom where user_id = uid),
    'kickrs', exists (select 1 from kickrs_links k where k.user_id = uid and k.revoked_at is null),
    'platforms', (select coalesce(jsonb_agg(distinct platform), '[]'::jsonb) from app_seen_days a where a.user_id = uid and a.day > lagos_today() - 30),
    'referral', jsonb_build_object(
      'code', (select code from referral_codes where owner = uid),
      'joined', (select count(*) from referrals rf join referral_codes c on c.code = rf.code where c.owner = uid),
      'came_from', (select coalesce(dp.handle, rc.campaign, rf.code) from referrals rf join referral_codes rc on rc.code = rf.code
                      left join dating_profiles dp on dp.user_id = rc.owner where rf.user_id = uid)),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object('id', dr.id, 'created_at', dr.created_at, 'reason', dr.reason, 'details', dr.details,
                  'status', dr.status, 'by', rp.handle, 'conversation_id', dr.conversation_id) order by dr.created_at desc), '[]'::jsonb)
                from (select * from dating_reports where reported_id = uid order by created_at desc limit 20) dr
                left join dating_profiles rp on rp.user_id = dr.reporter_id),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('at', n.created_at, 'by', a.handle, 'body', n.body) order by n.created_at desc), '[]'::jsonb)
              from staff_notes n left join dating_profiles a on a.user_id = n.author where n.user_id = uid)
  );
  if staff_allows(r, 'manage') then
    out := out || jsonb_build_object('name', p.name, 'email', u.email, 'birth_date', p.birth_date,
      'providers', (select coalesce(jsonb_agg(distinct provider), '[]'::jsonb) from auth.identities where user_id = uid));
  end if;
  perform staff_log(me, 'view_member', 'member', p.handle);
  return out;
end $$;

create function public.staff_member_suspend(p_handle text, p_suspend boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); uid uuid; h text; was text;
begin
  perform staff_need('moderate');
  uid := staff_uid(p_handle);
  if p_suspend and char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason.' using errcode = '22023'; end if;
  if p_suspend and exists (select 1 from announcement_staff where user_id = uid) and not staff_allows(staff_need('view'), 'super') then
    raise exception 'Only a Super Admin can suspend a staff member.' using errcode = '42501';
  end if;
  select handle into h from dating_profiles where user_id = uid;
  perform staff_log(me, case when p_suspend then 'suspend' else 'unsuspend' end, 'member', h, jsonb_build_object('reason', p_reason));
  was := staff_as_system();
  update dating_profiles set suspended = p_suspend where user_id = uid;
  perform staff_as_caller(was);
  if p_suspend then
    delete from room_members where user_id = uid;
    update dating_reports set status = 'actioned' where reported_id = uid and status = 'open';
  end if;
end $$;

create function public.staff_member_block_sign_in(p_handle text, p_block boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); uid uuid; h text;
begin
  perform staff_need('manage');
  uid := staff_uid(p_handle);
  if uid = me then raise exception 'You can’t block yourself.' using errcode = '42501'; end if;
  if p_block and char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason.' using errcode = '22023'; end if;
  if exists (select 1 from announcement_staff where user_id = uid) and not staff_allows(staff_need('view'), 'super') then
    raise exception 'Only a Super Admin can do this to a staff member.' using errcode = '42501';
  end if;
  select handle into h from dating_profiles where user_id = uid;
  update auth.users set banned_until = case when p_block then 'infinity'::timestamptz else null end where id = uid;
  perform staff_log(me, case when p_block then 'block_sign_in' else 'unblock_sign_in' end, 'member', h, jsonb_build_object('reason', p_reason));
end $$;

create function public.staff_room_ban(p_handle text, p_hours int, p_reason text default '')
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); uid uuid; h text;
begin
  perform staff_need('moderate');
  uid := staff_uid(p_handle);
  select handle into h from dating_profiles where user_id = uid;
  if coalesce(p_hours, 0) <= 0 then
    delete from room_bans where user_id = uid;
    perform staff_log(me, 'room_ban_lifted', 'member', h);
    return;
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason.' using errcode = '22023'; end if;
  insert into room_bans (user_id, until, reason) values (uid, now() + make_interval(hours => least(p_hours, 24 * 365)), left(btrim(p_reason), 200))
  on conflict (user_id) do update set until = excluded.until, reason = excluded.reason, created_at = now();
  delete from room_members where user_id = uid;
  perform staff_log(me, 'room_ban', 'member', h, jsonb_build_object('hours', p_hours, 'reason', p_reason));
end $$;

create function public.staff_member_reset_dob_clock(p_handle text)
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); uid uuid; h text; was text;
begin
  perform staff_need('moderate');
  uid := staff_uid(p_handle);
  select handle into h from dating_profiles where user_id = uid;
  perform staff_log(me, 'reset_dob_clock', 'member', h);
  was := staff_as_system();
  update dating_profiles set age_changed_at = null where user_id = uid;
  perform staff_as_caller(was);
end $$;

create function public.staff_member_note(p_handle text, p_body text)
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); uid uuid; h text;
begin
  perform staff_need('moderate');
  uid := staff_uid(p_handle);
  select handle into h from dating_profiles where user_id = uid;
  insert into staff_notes (user_id, author, body) values (uid, me, left(btrim(p_body), 1000));
  perform staff_log(me, 'note', 'member', h);
end $$;

create function public.staff_member_delete(p_handle text, p_reason text)
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); uid uuid; h text;
begin
  perform staff_need('super');
  uid := staff_uid(p_handle);
  if uid = me then raise exception 'Delete your own account from the app.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Give a reason.' using errcode = '22023'; end if;
  select handle into h from dating_profiles where user_id = uid;
  perform staff_log(me, 'delete_account', 'member', h, jsonb_build_object('reason', p_reason));
  insert into account_deletions (had_profile) values (true);
  delete from dating_conversations where user_a = uid or user_b = uid;
  delete from auth.users where id = uid;
end $$;

-- ---- Reports ----------------------------------------------------------------------------------------
create function public.staff_report_counts() returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  perform staff_need('view');
  return jsonb_build_object(
    'chat', (select count(*) from dating_reports where status = 'open'),
    'room', (select count(distinct message_id) from room_reports where status = 'open'),
    'link', (select count(*) from link_reports where status = 'open'));
end $$;

create function public.staff_reports(p_kind text, p_status text default 'open', p_limit int default 50, p_before bigint default null)
returns jsonb language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  st text := case when p_status in ('open', 'reviewed', 'actioned') then p_status else 'open' end;
  lim int := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  perform staff_need('moderate');
  if p_kind = 'chat' then
    return coalesce((select jsonb_agg(x order by x.id desc) from (
      select dr.id, dr.created_at, dr.status, dr.reason, dr.details, dr.conversation_id,
             rp.handle as reporter, rd.handle as reported, rd.suspended as reported_suspended,
             exists (select 1 from room_bans b where b.user_id = dr.reported_id and b.until > now()) as reported_room_banned,
             (select count(*) from dating_reports z where z.reported_id = dr.reported_id) as reports_against,
             dr.details like '[Speed Dating%' as speed,
             exists (select 1 from dating_conversations c where c.id = dr.conversation_id) as has_chat
      from dating_reports dr
      left join dating_profiles rp on rp.user_id = dr.reporter_id
      left join dating_profiles rd on rd.user_id = dr.reported_id
      where dr.status = st and (p_before is null or dr.id < p_before)
      order by dr.id desc limit lim) x), '[]'::jsonb);
  elsif p_kind = 'room' then
    return coalesce((select jsonb_agg(x order by x.id desc) from (
      select m.id, m.state as room, m.body, m.handle as room_name, a.handle as author, a.suspended as author_suspended,
             m.created_at, count(rr.*) as reports, jsonb_agg(distinct rr.reason) as reasons, min(rr.created_at) as first_reported_at,
             exists (select 1 from room_bans b where b.user_id = m.user_id and b.until > now()) as author_room_banned
      from room_reports rr
      join room_messages m on m.id = rr.message_id
      left join dating_profiles a on a.user_id = m.user_id
      where rr.status = st and (p_before is null or m.id < p_before)
      group by m.id, a.handle, a.suspended
      order by m.id desc limit lim) x), '[]'::jsonb);
  elsif p_kind = 'link' then
    return coalesce((select jsonb_agg(x order by x.id desc) from (
      select lr.id, lr.created_at, lr.status, lr.reason, lr.body, l.username, l.suspended as link_suspended,
             (select count(*) from link_reports z where z.owner_id = lr.owner_id) as reports_for_link
      from link_reports lr left join links l on l.user_id = lr.owner_id
      where lr.status = st and (p_before is null or lr.id < p_before)
      order by lr.id desc limit lim) x), '[]'::jsonb);
  end if;
  raise exception 'Unknown report type.' using errcode = '22023';
end $$;

create function public.staff_report_set(p_kind text, p_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid();
begin
  perform staff_need('moderate');
  if p_status not in ('open', 'reviewed', 'actioned') then raise exception 'Choose a valid status.' using errcode = '22023'; end if;
  if p_kind = 'chat' then update dating_reports set status = p_status where id = p_id;
  elsif p_kind = 'room' then update room_reports set status = p_status where message_id = p_id;
  elsif p_kind = 'link' then update link_reports set status = p_status where id = p_id;
  else raise exception 'Unknown report type.' using errcode = '22023'; end if;
  if not found then raise exception 'Report not found.' using errcode = 'P0002'; end if;
  perform staff_log(me, 'report_' || p_status, p_kind || '_report', p_id::text);
end $$;

create function public.staff_link_suspend(p_report bigint, p_suspend boolean)
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid();
begin
  perform staff_need('moderate');
  perform staff_admin_on();
  perform admin_suspend_link(null, p_report, p_suspend);
  perform staff_admin_off();
  perform staff_log(me, case when p_suspend then 'link_suspend' else 'link_unsuspend' end, 'link_report', p_report::text);
end $$;

-- Messages around a report. Opening a reported chat is logged.
create function public.staff_report_context(p_kind text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  rep dating_reports%rowtype;
  msg room_messages%rowtype;
  c dating_conversations%rowtype;
begin
  perform staff_need('moderate');
  if p_kind = 'chat' then
    select * into rep from dating_reports where id = p_id;
    if not found then raise exception 'Report not found.' using errcode = 'P0002'; end if;
    select * into c from dating_conversations where id = rep.conversation_id;
    if not found then return jsonb_build_object('messages', '[]'::jsonb, 'note', 'This report wasn’t made from a chat, or the chat was deleted.'); end if;
    perform staff_log(me, 'view_reported_chat', 'conversation', c.id::text, jsonb_build_object('report', p_id));
    return jsonb_build_object(
      'conversation_id', c.id, 'kind', c.kind,
      'reported', (select handle from dating_profiles where user_id = rep.reported_id),
      'reporter', (select handle from dating_profiles where user_id = rep.reporter_id),
      'messages', coalesce((select jsonb_agg(x order by x.created_at) from (
        select m.id, s.handle as sender, m.sender_id = rep.reported_id as from_reported, m.body, m.photo, m.created_at, m.edited_at, m.deleted_at, false as unsent
        from dating_messages m left join dating_profiles s on s.user_id = m.sender_id
        where m.conversation_id = c.id and m.created_at <= rep.created_at + interval '1 hour'
        order by m.created_at desc limit 80) x), '[]'::jsonb),
      'unsent', coalesce((select jsonb_agg(jsonb_build_object('sender', s.handle, 'body', u.body, 'sent_at', u.sent_at, 'unsent_at', u.unsent_at) order by u.sent_at)
        from unsent_messages u left join dating_profiles s on s.user_id = u.sender_id where u.conversation_id = c.id), '[]'::jsonb));
  elsif p_kind = 'room' then
    select * into msg from room_messages where id = p_id;
    if not found then raise exception 'That message is gone.' using errcode = 'P0002'; end if;
    perform staff_log(me, 'view_room_report', 'room', msg.state, jsonb_build_object('message', p_id));
    return jsonb_build_object('room', msg.state, 'message_id', msg.id,
      'messages', coalesce((select jsonb_agg(x order by x.id) from (
        (select m.id, m.handle as room_name, a.handle as author, m.body, m.created_at, m.id = p_id as reported
           from room_messages m left join dating_profiles a on a.user_id = m.user_id where m.state = msg.state and m.id <= p_id order by m.id desc limit 15)
        union all
        (select m.id, m.handle, a.handle, m.body, m.created_at, false
           from room_messages m left join dating_profiles a on a.user_id = m.user_id where m.state = msg.state and m.id > p_id order by m.id limit 10)) x), '[]'::jsonb),
      'reports', (select coalesce(jsonb_agg(jsonb_build_object('by', p.handle, 'reason', rr.reason, 'at', rr.created_at)), '[]'::jsonb)
                  from room_reports rr left join dating_profiles p on p.user_id = rr.reporter where rr.message_id = p_id));
  end if;
  raise exception 'Unknown report type.' using errcode = '22023';
end $$;

-- ---- Private chats ----------------------------------------------------------------------------------
-- Moderators and Admins: only chats someone reported. Super Admin: any chat, with a written reason.
create function public.staff_member_chats(p_handle text) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); uid uuid; h text;
begin
  perform staff_need('super');
  uid := staff_uid(p_handle);
  select handle into h from dating_profiles where user_id = uid;
  perform staff_log(me, 'list_member_chats', 'member', h);
  return coalesce((select jsonb_agg(x order by x.last_at desc nulls last) from (
    select c.id, c.kind, c.created_at, c.accepted_at, c.declined_at,
           o.handle as partner,
           (select count(*) from dating_messages m where m.conversation_id = c.id) as messages,
           (select max(m.created_at) from dating_messages m where m.conversation_id = c.id) as last_at,
           exists (select 1 from dating_reports dr where dr.conversation_id = c.id) as reported
    from dating_conversations c
    left join dating_profiles o on o.user_id = case when c.user_a = uid then c.user_b else c.user_a end
    where uid in (c.user_a, c.user_b)) x), '[]'::jsonb);
end $$;

create function public.staff_chat(p_conversation uuid, p_reason text default '', p_before timestamptz default null, p_limit int default 80)
returns jsonb language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  r text := staff_need('view');
  c dating_conversations%rowtype;
  reported boolean;
begin
  select * into c from dating_conversations where id = p_conversation;
  if not found then raise exception 'Chat not found.' using errcode = 'P0002'; end if;
  reported := exists (select 1 from dating_reports dr where dr.conversation_id = c.id);
  if reported then
    perform staff_need('moderate');
  else
    perform staff_need('super');
    if char_length(btrim(coalesce(p_reason, ''))) < 5 then
      raise exception 'Nobody reported this chat. Write why you need to open it.' using errcode = '22023';
    end if;
  end if;
  if p_before is null then
    perform staff_log(me, 'view_chat', 'conversation', c.id::text,
      jsonb_build_object('basis', case when reported then 'reported' else 'super_admin' end, 'reason', p_reason,
        'between', jsonb_build_array((select handle from dating_profiles where user_id = c.user_a), (select handle from dating_profiles where user_id = c.user_b))));
  end if;
  return jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'created_at', c.created_at, 'accepted_at', c.accepted_at, 'reported', reported,
    'people', jsonb_build_array((select handle from dating_profiles where user_id = c.user_a), (select handle from dating_profiles where user_id = c.user_b)),
    'messages', coalesce((select jsonb_agg(x order by x.created_at) from (
      select m.id, s.handle as sender, m.body, m.photo, m.reply_to, m.created_at, m.edited_at, m.deleted_at
      from dating_messages m left join dating_profiles s on s.user_id = m.sender_id
      where m.conversation_id = c.id and (p_before is null or m.created_at < p_before)
      order by m.created_at desc limit least(greatest(coalesce(p_limit, 80), 1), 200)) x), '[]'::jsonb),
    'unsent', coalesce((select jsonb_agg(jsonb_build_object('sender', s.handle, 'body', u.body, 'sent_at', u.sent_at, 'unsent_at', u.unsent_at) order by u.sent_at)
      from unsent_messages u left join dating_profiles s on s.user_id = u.sender_id where u.conversation_id = c.id), '[]'::jsonb));
end $$;

-- Photos in chats staff may open (signed links from the chat-photos bucket).
create function dating_private.staff_photo_ok(p_name text) returns boolean
language plpgsql stable security definer set search_path = public, dating_private as $$
declare r text; convo uuid;
begin
  if p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' then return false; end if;
  select role into r from announcement_staff where user_id = auth.uid();
  if r is null or not staff_mfa() then return false; end if;
  convo := split_part(p_name, '/', 1)::uuid;
  return staff_allows(r, 'super')
      or (staff_allows(r, 'moderate') and exists (select 1 from dating_reports dr where dr.conversation_id = convo));
end $$;
revoke all on function dating_private.staff_photo_ok(text) from public, anon;
grant execute on function dating_private.staff_photo_ok(text) to authenticated;

drop policy if exists "chat photos: staff can open photos in chats they may read" on storage.objects;
create policy "chat photos: staff can open photos in chats they may read" on storage.objects for select to authenticated
  using (bucket_id = 'chat-photos' and dating_private.staff_photo_ok(name));

-- ---- Chatrooms --------------------------------------------------------------------------------------
create function dating_private.room_closed_guard() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare why text;
begin
  select reason into why from room_settings where room = new.state and closed;
  if found then
    raise exception '%', coalesce(nullif(why, ''), 'This chatroom is closed for now.') using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger room_closed_guard before insert on public.room_messages for each row execute function dating_private.room_closed_guard();
create trigger room_closed_guard before insert on public.room_members for each row execute function dating_private.room_closed_guard();

create function public.staff_rooms() returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  perform staff_need('view');
  return (select jsonb_agg(jsonb_build_object(
      'room', r.room, 'group', case when r.room = any (nigerian_states()) then 'state' when r.room = any (uni_room_codes()) then 'university' else 'general' end,
      'online', (select count(*) from room_members m where m.state = r.room and m.last_seen_at > now() - interval '2 minutes'),
      'members', (select count(*) from room_members m where m.state = r.room),
      'messages_24h', (select count(*) from room_messages m where m.state = r.room and m.created_at > now() - interval '24 hours'),
      'open_reports', (select count(distinct rr.message_id) from room_reports rr join room_messages m on m.id = rr.message_id where m.state = r.room and rr.status = 'open'),
      'closed', coalesce(s.closed, false), 'reason', coalesce(s.reason, '')) order by r.ord)
    from unnest(room_names()) with ordinality as r(room, ord) left join room_settings s on s.room = r.room);
end $$;

create function public.staff_room_messages(p_room text, p_before bigint default null, p_limit int default 80)
returns jsonb language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  perform staff_need('moderate');
  return coalesce((select jsonb_agg(x order by x.id) from (
    select m.id, m.handle as room_name, a.handle as author, a.suspended as author_suspended, m.body, m.reply_to, m.created_at,
           (select count(*) from room_reports rr where rr.message_id = m.id) as reports
    from room_messages m left join dating_profiles a on a.user_id = m.user_id
    where m.state = p_room and (p_before is null or m.id < p_before)
    order by m.id desc limit least(greatest(coalesce(p_limit, 80), 1), 200)) x), '[]'::jsonb);
end $$;

create function public.staff_room_delete_message(p_id bigint, p_reason text default '')
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); m room_messages%rowtype; author text;
begin
  perform staff_need('moderate');
  select * into m from room_messages where id = p_id;
  if not found then raise exception 'That message is gone.' using errcode = 'P0002'; end if;
  select handle into author from dating_profiles where user_id = m.user_id;
  perform staff_log(me, 'room_message_removed', 'room', m.state,
    jsonb_build_object('message', p_id, 'author', author, 'body', left(m.body, 500), 'reason', p_reason,
      'reports', (select count(*) from room_reports where message_id = p_id)));
  delete from room_messages where id = p_id;
  perform realtime.send(jsonb_build_object('id', p_id), 'remove', 'room:' || m.state, true);
end $$;

create function public.staff_room_set(p_room text, p_closed boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid();
begin
  perform staff_need('manage');
  if not p_room = any (room_names()) then raise exception 'Unknown chatroom.' using errcode = 'P0002'; end if;
  insert into room_settings (room, closed, reason, updated_by, updated_at)
  values (p_room, coalesce(p_closed, false), left(btrim(coalesce(p_reason, '')), 200), me, now())
  on conflict (room) do update set closed = excluded.closed, reason = excluded.reason, updated_by = me, updated_at = now();
  if p_closed then delete from room_members where state = p_room; end if;
  perform staff_log(me, case when p_closed then 'room_closed' else 'room_opened' end, 'room', p_room, jsonb_build_object('reason', p_reason));
end $$;

-- ---- Ads --------------------------------------------------------------------------------------------
create table dating_private.ads (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  advertiser  text not null default '' check (char_length(advertiser) <= 80),
  status      text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended')),
  placements  text[] not null default array['home'] check (placements <@ array['home', 'rooms', 'discover', 'inbox'] and cardinality(placements) > 0),
  title       text not null check (char_length(btrim(title)) between 1 and 60),
  body        text not null default '' check (char_length(body) <= 140),
  image_url   text check (image_url is null or image_url ~ '^https://(img\.treehouse\.ng/|[a-z0-9]+\.supabase\.co/storage/v1/object/public/ads/)[A-Za-z0-9._/-]+$'),
  cta_label   text not null default 'Learn more' check (char_length(btrim(cta_label)) between 1 and 24),
  cta_url     text not null check (cta_url ~ '^https://\S{4,}$' and char_length(cta_url) <= 500),
  starts_at   timestamptz,
  ends_at     timestamptz,
  audience    jsonb not null default '{}'::jsonb,
  weight      int not null default 10 check (weight between 1 and 100),
  created_by  uuid references auth.users (id) on delete set null,
  updated_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create table dating_private.ad_daily (
  ad_id     uuid not null references dating_private.ads (id) on delete cascade,
  day       date not null,
  placement text not null,
  views     int not null default 0,
  taps      int not null default 0,
  primary key (ad_id, day, placement)
);
create table dating_private.ad_seen (
  ad_id   uuid not null references dating_private.ads (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  tapped  boolean not null default false,
  primary key (ad_id, user_id, day)
);
create index ad_seen_day on dating_private.ad_seen (day);
revoke all on dating_private.ads, dating_private.ad_daily, dating_private.ad_seen from public, anon, authenticated;

-- One ad for this member and place, or null. Targeting uses state, gender and age only.
create function public.ad_for(p_placement text) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare p dating_profiles%rowtype;
begin
  if coalesce(setting('ads_enabled'), 'true'::jsonb) <> 'true'::jsonb then return null; end if;
  select * into p from dating_profiles where user_id = auth.uid();
  if not found or p.suspended then return null; end if;
  return (select jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'image_url', a.image_url,
                                    'cta_label', a.cta_label, 'cta_url', a.cta_url, 'advertiser', a.advertiser)
    from ads a
    where a.status = 'active' and p_placement = any (a.placements)
      and (a.starts_at is null or a.starts_at <= now()) and (a.ends_at is null or a.ends_at > now())
      and (coalesce(jsonb_array_length(a.audience -> 'states'), 0) = 0 or a.audience -> 'states' ? p.state)
      and (coalesce(jsonb_array_length(a.audience -> 'genders'), 0) = 0 or a.audience -> 'genders' ? p.gender::text)
      and (a.audience ->> 'min_age' is null or p.age >= (a.audience ->> 'min_age')::int)
      and (a.audience ->> 'max_age' is null or p.age <= (a.audience ->> 'max_age')::int)
    order by -ln(1 - random()) / a.weight limit 1);
end $$;

-- Counts one view and at most one tap per member, ad and day.
create function public.ad_event(p_ad uuid, p_placement text, p_kind text) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  today date := lagos_today();
  first_view boolean := false;
  first_tap boolean := false;
begin
  if me is null or p_kind not in ('view', 'tap') or p_placement not in ('home', 'rooms', 'discover', 'inbox') then return; end if;
  if not exists (select 1 from ads where id = p_ad and status = 'active') then return; end if;
  insert into ad_seen (ad_id, user_id, day, tapped) values (p_ad, me, today, p_kind = 'tap')
  on conflict do nothing;
  first_view := found;
  if p_kind = 'tap' then
    update ad_seen set tapped = true where ad_id = p_ad and user_id = me and day = today and not tapped;
    first_tap := found or first_view;
  end if;
  if first_view or first_tap then
    insert into ad_daily (ad_id, day, placement, views, taps)
    values (p_ad, today, p_placement, case when first_view then 1 else 0 end, case when first_tap then 1 else 0 end)
    on conflict (ad_id, day, placement) do update
      set views = ad_daily.views + excluded.views, taps = ad_daily.taps + excluded.taps;
  end if;
end $$;

create function public.staff_ads() returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  perform staff_need('view');
  return coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object(
      'views', coalesce((select sum(views) from ad_daily d where d.ad_id = a.id), 0),
      'taps', coalesce((select sum(taps) from ad_daily d where d.ad_id = a.id), 0),
      'reach', (select count(distinct user_id) from ad_seen s where s.ad_id = a.id),
      'live', a.status = 'active' and (a.starts_at is null or a.starts_at <= now()) and (a.ends_at is null or a.ends_at > now()))
    order by a.created_at desc) from ads a), '[]'::jsonb);
end $$;

create function public.staff_ad_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  aid uuid := nullif(p ->> 'id', '')::uuid;
  aud jsonb := coalesce(p -> 'audience', '{}'::jsonb);
  places text[] := array(select jsonb_array_elements_text(coalesce(p -> 'placements', '["home"]'::jsonb)));
begin
  perform staff_need('content');
  aud := jsonb_strip_nulls(jsonb_build_object(
    'states', case when jsonb_typeof(aud -> 'states') = 'array' and jsonb_array_length(aud -> 'states') > 0 then aud -> 'states' end,
    'genders', case when jsonb_typeof(aud -> 'genders') = 'array' and jsonb_array_length(aud -> 'genders') > 0 then aud -> 'genders' end,
    'min_age', case when (aud ->> 'min_age') ~ '^\d{2,3}$' then greatest((aud ->> 'min_age')::int, 18) end,
    'max_age', case when (aud ->> 'max_age') ~ '^\d{2,3}$' then (aud ->> 'max_age')::int end));
  if aid is null then
    insert into ads (name, advertiser, placements, title, body, image_url, cta_label, cta_url, starts_at, ends_at, audience, weight, created_by, updated_by)
    values (btrim(p ->> 'name'), btrim(coalesce(p ->> 'advertiser', '')), places, btrim(p ->> 'title'), btrim(coalesce(p ->> 'body', '')),
            nullif(btrim(coalesce(p ->> 'image_url', '')), ''), btrim(coalesce(nullif(p ->> 'cta_label', ''), 'Learn more')), btrim(p ->> 'cta_url'),
            nullif(p ->> 'starts_at', '')::timestamptz, nullif(p ->> 'ends_at', '')::timestamptz, aud,
            coalesce(nullif(p ->> 'weight', '')::int, 10), me, me)
    returning id into aid;
    perform staff_log(me, 'ad_created', 'ad', aid::text, jsonb_build_object('name', p ->> 'name'));
  else
    update ads set name = btrim(p ->> 'name'), advertiser = btrim(coalesce(p ->> 'advertiser', '')), placements = places,
      title = btrim(p ->> 'title'), body = btrim(coalesce(p ->> 'body', '')), image_url = nullif(btrim(coalesce(p ->> 'image_url', '')), ''),
      cta_label = btrim(coalesce(nullif(p ->> 'cta_label', ''), 'Learn more')), cta_url = btrim(p ->> 'cta_url'),
      starts_at = nullif(p ->> 'starts_at', '')::timestamptz, ends_at = nullif(p ->> 'ends_at', '')::timestamptz,
      audience = aud, weight = coalesce(nullif(p ->> 'weight', '')::int, 10), updated_by = me, updated_at = now()
    where id = aid;
    if not found then raise exception 'Ad not found.' using errcode = 'P0002'; end if;
    perform staff_log(me, 'ad_edited', 'ad', aid::text, jsonb_build_object('name', p ->> 'name'));
  end if;
  return aid;
end $$;

create function public.staff_ad_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid();
begin
  perform staff_need('content');
  if p_status = 'deleted' then
    if exists (select 1 from ad_daily where ad_id = p_id) then raise exception 'This ad has results. End it instead of deleting.' using errcode = '22023'; end if;
    delete from ads where id = p_id;
  else
    update ads set status = p_status, updated_by = me, updated_at = now() where id = p_id;
  end if;
  if not found then raise exception 'Ad not found.' using errcode = 'P0002'; end if;
  perform staff_log(me, 'ad_' || p_status, 'ad', p_id::text);
end $$;

create function public.staff_ad_stats(p_id uuid, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare d int := least(greatest(coalesce(p_days, 30), 1), 180); today date := lagos_today();
begin
  perform staff_need('view');
  return jsonb_build_object(
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', g.day::date,
        'views', coalesce((select sum(views) from ad_daily x where x.ad_id = p_id and x.day = g.day::date), 0),
        'taps', coalesce((select sum(taps) from ad_daily x where x.ad_id = p_id and x.day = g.day::date), 0)) order by g.day)
      from generate_series(today - (d - 1), today, interval '1 day') g(day)), '[]'::jsonb),
    'placements', coalesce((select jsonb_object_agg(placement, jsonb_build_object('views', v, 'taps', t))
      from (select placement, sum(views) as v, sum(taps) as t from ad_daily where ad_id = p_id group by 1) x), '{}'::jsonb));
end $$;

-- Ad pictures: a public "ads" bucket that only content staff can write to.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ads', 'ads', true, 1500000, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1500000, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
drop policy if exists "ads: content staff upload" on storage.objects;
create policy "ads: content staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'ads' and dating_private.staff_can('content'));
drop policy if exists "ads: content staff replace" on storage.objects;
create policy "ads: content staff replace" on storage.objects for update to authenticated
  using (bucket_id = 'ads' and dating_private.staff_can('content'));
drop policy if exists "ads: content staff remove" on storage.objects;
create policy "ads: content staff remove" on storage.objects for delete to authenticated
  using (bucket_id = 'ads' and dating_private.staff_can('content'));

-- ---- Referrals --------------------------------------------------------------------------------------
create table dating_private.referral_codes (
  code       text primary key check (code ~ '^[a-z0-9]{4,24}$'),
  owner      uuid unique references auth.users (id) on delete cascade,
  campaign   text check (campaign is null or char_length(btrim(campaign)) between 1 and 80),
  note       text not null default '' check (char_length(note) <= 300),
  active     boolean not null default true,
  clicks     int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((owner is null) <> (campaign is null))
);
create table dating_private.referrals (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  code       text not null references dating_private.referral_codes (code) on delete cascade,
  claimed_at timestamptz not null default now()
);
create index referrals_code on dating_private.referrals (code, claimed_at desc);
create index referrals_claimed on dating_private.referrals (claimed_at desc);
revoke all on dating_private.referral_codes, dating_private.referrals from public, anon, authenticated;

create function dating_private.new_referral_code() returns text
language plpgsql volatile as $$
declare
  alphabet text := 'abcdefghjkmnpqrstuvwxyz23456789';
  c text;
begin
  loop
    c := (select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '') from generate_series(1, 7));
    exit when not exists (select 1 from dating_private.referral_codes where code = c);
  end loop;
  return c;
end $$;
revoke all on function dating_private.new_referral_code() from public, anon, authenticated;

-- My invite code (made the first time I ask) and how many people joined with it.
create function public.my_referral() returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); c text;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from dating_profiles where user_id = me and not suspended) then return null; end if;
  select code into c from referral_codes where owner = me;
  if c is null then
    insert into referral_codes (code, owner) values (new_referral_code(), me) on conflict (owner) do nothing;
    select code into c from referral_codes where owner = me;
  end if;
  return jsonb_build_object('code', c,
    'enabled', coalesce(setting('referrals_enabled'), 'true'::jsonb) = 'true'::jsonb,
    'active', (select active from referral_codes where code = c),
    'joined', (select count(*) from referrals where code = c));
end $$;

-- Called once by a new member's app after sign-up. Only accounts under 3 days old can be referred.
create function public.claim_referral(p_code text) returns boolean
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); rc referral_codes%rowtype;
begin
  if me is null then return false; end if;
  if coalesce(setting('referrals_enabled'), 'true'::jsonb) <> 'true'::jsonb then return false; end if;
  select * into rc from referral_codes where code = lower(btrim(coalesce(p_code, ''))) and active;
  if not found or rc.owner = me then return false; end if;
  if not exists (select 1 from auth.users where id = me and created_at > now() - interval '3 days') then return false; end if;
  if not exists (select 1 from dating_profiles where user_id = me) then return false; end if;
  insert into referrals (user_id, code) values (me, rc.code) on conflict do nothing;
  return found;
end $$;

-- Counts a visit to treehouse.ng/r/<code> (called by the website's server, no sign-in).
create function public.referral_click(p_code text) returns void
language sql security definer set search_path = public, dating_private as $$
  update referral_codes set clicks = clicks + 1 where code = lower(btrim(coalesce(p_code, ''))) and active
$$;

create function public.staff_referrals(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare d int := least(greatest(coalesce(p_days, 30), 1), 180); today date := lagos_today();
begin
  perform staff_need('view');
  return jsonb_build_object(
    'enabled', coalesce(setting('referrals_enabled'), 'true'::jsonb) = 'true'::jsonb,
    'total_joined', (select count(*) from referrals),
    'joined_period', (select count(*) from referrals where claimed_at > now() - make_interval(days => d)),
    'came_back', (select count(*) from referrals rf join dating_profiles p on p.user_id = rf.user_id where p.last_seen_at > rf.claimed_at + interval '2 days'),
    'codes', (select count(*) from referral_codes where owner is not null),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', g.day::date,
        'joined', (select count(*) from referrals rf where (rf.claimed_at at time zone 'Africa/Lagos')::date = g.day::date)) order by g.day)
      from generate_series(today - (d - 1), today, interval '1 day') g(day)), '[]'::jsonb),
    'top', coalesce((select jsonb_agg(x order by x.joined desc) from (
      select c.code, p.handle, c.active, c.clicks, count(rf.*) as joined,
             count(rf.*) filter (where jp.last_seen_at > rf.claimed_at + interval '2 days') as came_back,
             count(rf.*) filter (where jp.suspended) as suspended,
             max(rf.claimed_at) as last_joined,
             (select max(n) from (select count(*) as n from referrals z where z.code = c.code group by date_trunc('hour', z.claimed_at)) h) as max_in_an_hour
      from referral_codes c join referrals rf on rf.code = c.code
      left join dating_profiles p on p.user_id = c.owner
      left join dating_profiles jp on jp.user_id = rf.user_id
      where c.owner is not null and rf.claimed_at > now() - make_interval(days => d)
      group by c.code, p.handle, c.active, c.clicks
      order by joined desc limit 50) x), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(x order by x.created_at desc) from (
      select c.code, c.campaign, c.note, c.active, c.clicks, c.created_at,
             (select count(*) from referrals rf where rf.code = c.code) as joined,
             (select count(*) from referrals rf join dating_profiles jp on jp.user_id = rf.user_id
               where rf.code = c.code and jp.last_seen_at > rf.claimed_at + interval '2 days') as came_back
      from referral_codes c where c.owner is null) x), '[]'::jsonb));
end $$;

create function public.staff_referral_joined(p_code text) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid();
begin
  perform staff_need('moderate');
  perform staff_log(me, 'view_referrals', 'referral_code', p_code);
  return coalesce((select jsonb_agg(jsonb_build_object('handle', p.handle, 'joined_at', rf.claimed_at, 'last_seen_at', p.last_seen_at,
      'suspended', p.suspended, 'state', p.state) order by rf.claimed_at desc)
    from referrals rf left join dating_profiles p on p.user_id = rf.user_id where rf.code = lower(p_code)), '[]'::jsonb);
end $$;

create function public.staff_referral_campaign(p_code text, p_campaign text, p_note text default '', p_active boolean default true)
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); c text := lower(btrim(coalesce(p_code, '')));
begin
  perform staff_need('manage');
  if c !~ '^[a-z0-9]{4,24}$' then raise exception 'Codes are 4 to 24 letters or numbers.' using errcode = '22023'; end if;
  if exists (select 1 from referral_codes where code = c and owner is not null) then raise exception 'A member already uses that code.' using errcode = '23505'; end if;
  insert into referral_codes (code, campaign, note, active, created_by) values (c, btrim(p_campaign), btrim(coalesce(p_note, '')), coalesce(p_active, true), me)
  on conflict (code) do update set campaign = excluded.campaign, note = excluded.note, active = excluded.active;
  perform staff_log(me, 'referral_campaign_saved', 'referral_code', c, jsonb_build_object('campaign', p_campaign, 'active', p_active));
end $$;

create function public.staff_referral_code_active(p_code text, p_active boolean)
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid();
begin
  perform staff_need('manage');
  update referral_codes set active = p_active where code = lower(p_code);
  if not found then raise exception 'Code not found.' using errcode = 'P0002'; end if;
  perform staff_log(me, case when p_active then 'referral_code_on' else 'referral_code_off' end, 'referral_code', lower(p_code));
end $$;

-- ---- Settings ---------------------------------------------------------------------------------------
create function dating_private.signup_pause_guard() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if coalesce(setting('signups_paused'), 'false'::jsonb) = 'true'::jsonb then
    raise exception '%', coalesce(nullif(setting('signups_paused_reason') #>> '{}', ''), 'New sign-ups are paused for a short while. Please try again later.')
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger signup_pause_guard before insert on public.dating_profiles for each row execute function dating_private.signup_pause_guard();

create function public.staff_settings() returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  perform staff_need('view');
  return jsonb_build_object(
    'settings', (select jsonb_object_agg(key, value) from app_settings),
    'filter_words', (select coalesce(jsonb_agg(word order by word), '[]'::jsonb) from filter_words),
    'rating', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'value', value, 'note', note) order by key), '[]'::jsonb) from rating_config));
end $$;

create function public.staff_setting_set(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid();
begin
  perform staff_need('manage');
  if p_key in ('signups_paused', 'ads_enabled', 'referrals_enabled') and jsonb_typeof(p_value) <> 'boolean' then
    raise exception 'Expected on or off.' using errcode = '22023';
  end if;
  if p_key = 'signups_paused_reason' and (jsonb_typeof(p_value) <> 'string' or char_length(p_value #>> '{}') > 200) then
    raise exception 'Keep the message under 200 characters.' using errcode = '22023';
  end if;
  update app_settings set value = p_value, updated_by = me, updated_at = now() where key = p_key;
  if not found then raise exception 'Unknown setting.' using errcode = 'P0002'; end if;
  perform staff_log(me, 'setting', 'setting', p_key, jsonb_build_object('value', p_value));
end $$;

create function public.staff_filter_word(p_word text, p_add boolean) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); w text := lower(btrim(coalesce(p_word, '')));
begin
  perform staff_need('manage');
  if w !~ '^[a-z0-9]{2,30}$' then raise exception 'One word, 2 to 30 letters or numbers.' using errcode = '22023'; end if;
  if p_add then insert into filter_words (word) values (w) on conflict do nothing;
  else delete from filter_words where word = w; end if;
  perform staff_log(me, case when p_add then 'filter_word_added' else 'filter_word_removed' end, 'setting', 'filter_words', jsonb_build_object('word', w));
end $$;

create function public.staff_rating_set(p_key text, p_value numeric) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); old numeric;
begin
  perform staff_need('super');
  select value into old from rating_config where key = p_key;
  if not found then raise exception 'Unknown rating setting.' using errcode = 'P0002'; end if;
  if p_value is null or p_value < 0 or p_value > 100000 then raise exception 'Enter a number between 0 and 100000.' using errcode = '22023'; end if;
  update rating_config set value = p_value where key = p_key;
  perform staff_log(me, 'rating_setting', 'setting', p_key, jsonb_build_object('from', old, 'to', p_value));
end $$;

-- ---- Staff and audit --------------------------------------------------------------------------------
create function public.staff_team() returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare r text := staff_need('view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'handle', p.handle, 'role', s.role, 'can_publish', s.can_publish, 'added_at', s.added_at,
      'added_by', (select handle from dating_profiles where user_id = s.added_by),
      'authenticator', exists (select 1 from auth.mfa_factors f where f.user_id = s.user_id and f.factor_type = 'totp' and f.status = 'verified'),
      'last_action_at', (select max(at) from staff_audit a where a.actor = s.user_id),
      'email', case when r = 'super_admin' then (select email from auth.users where id = s.user_id) end) order by s.added_at)
    from announcement_staff s left join dating_profiles p on p.user_id = s.user_id), '[]'::jsonb);
end $$;

create function public.staff_team_set(p_handle text, p_role text, p_can_publish boolean default false)
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid();
begin
  perform staff_need('super');
  perform ann_set_staff_by(me, p_handle, nullif(p_role, ''), p_can_publish);
  perform staff_log(me, case when nullif(p_role, '') is null then 'staff_removed' else 'staff_set' end, 'member', p_handle,
    jsonb_build_object('role', p_role, 'can_publish', p_can_publish));
end $$;

create function public.staff_audit_log(p_actor text default null, p_action text default null, p_before timestamptz default null, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  perform staff_need('manage');
  return coalesce((select jsonb_agg(x order by x.at desc) from (
    select * from (
      select a.at, coalesce(p.handle, a.actor_handle) as actor, a.action, a.target_type, a.target_id, a.meta, 'console' as source
      from staff_audit a left join dating_profiles p on p.user_id = a.actor
      union all
      select a.at, p.handle, a.action, case when a.announcement_id is null then null else 'announcement' end,
             a.announcement_id::text, a.meta, 'announcements'
      from announcement_audit a left join dating_profiles p on p.user_id = a.actor) u
    where (p_actor is null or u.actor ilike p_actor) and (p_action is null or u.action = p_action)
      and (p_before is null or u.at < p_before)
    order by u.at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) x), '[]'::jsonb);
end $$;

-- ---- Who may call what ------------------------------------------------------------------------------
revoke all on function
  public.staff_me(), public.staff_signed_in(), public.staff_dashboard(int),
  public.staff_members(text, text, int, int), public.staff_member(text), public.staff_member_suspend(text, boolean, text),
  public.staff_member_block_sign_in(text, boolean, text), public.staff_room_ban(text, int, text),
  public.staff_member_reset_dob_clock(text), public.staff_member_note(text, text), public.staff_member_delete(text, text),
  public.staff_report_counts(), public.staff_reports(text, text, int, bigint), public.staff_report_set(text, bigint, text),
  public.staff_link_suspend(bigint, boolean), public.staff_report_context(text, bigint),
  public.staff_member_chats(text), public.staff_chat(uuid, text, timestamptz, int),
  public.staff_rooms(), public.staff_room_messages(text, bigint, int), public.staff_room_delete_message(bigint, text), public.staff_room_set(text, boolean, text),
  public.staff_ads(), public.staff_ad_save(jsonb), public.staff_ad_status(uuid, text), public.staff_ad_stats(uuid, int),
  public.staff_referrals(int), public.staff_referral_joined(text), public.staff_referral_campaign(text, text, text, boolean), public.staff_referral_code_active(text, boolean),
  public.staff_settings(), public.staff_setting_set(text, jsonb), public.staff_filter_word(text, boolean), public.staff_rating_set(text, numeric),
  public.staff_team(), public.staff_team_set(text, text, boolean), public.staff_audit_log(text, text, timestamptz, int),
  public.ad_for(text), public.ad_event(uuid, text, text), public.my_referral(), public.claim_referral(text)
from public, anon;
grant execute on function
  public.staff_me(), public.staff_signed_in(), public.staff_dashboard(int),
  public.staff_members(text, text, int, int), public.staff_member(text), public.staff_member_suspend(text, boolean, text),
  public.staff_member_block_sign_in(text, boolean, text), public.staff_room_ban(text, int, text),
  public.staff_member_reset_dob_clock(text), public.staff_member_note(text, text), public.staff_member_delete(text, text),
  public.staff_report_counts(), public.staff_reports(text, text, int, bigint), public.staff_report_set(text, bigint, text),
  public.staff_link_suspend(bigint, boolean), public.staff_report_context(text, bigint),
  public.staff_member_chats(text), public.staff_chat(uuid, text, timestamptz, int),
  public.staff_rooms(), public.staff_room_messages(text, bigint, int), public.staff_room_delete_message(bigint, text), public.staff_room_set(text, boolean, text),
  public.staff_ads(), public.staff_ad_save(jsonb), public.staff_ad_status(uuid, text), public.staff_ad_stats(uuid, int),
  public.staff_referrals(int), public.staff_referral_joined(text), public.staff_referral_campaign(text, text, text, boolean), public.staff_referral_code_active(text, boolean),
  public.staff_settings(), public.staff_setting_set(text, jsonb), public.staff_filter_word(text, boolean), public.staff_rating_set(text, numeric),
  public.staff_team(), public.staff_team_set(text, text, boolean), public.staff_audit_log(text, text, timestamptz, int),
  public.ad_for(text), public.ad_event(uuid, text, text), public.my_referral(), public.claim_referral(text)
to authenticated;
revoke all on function public.referral_click(text) from public;
grant execute on function public.referral_click(text) to anon, authenticated;
revoke all on function dating_private.room_closed_guard(), dating_private.signup_pause_guard() from public, anon, authenticated;

alter table dating_private.staff_audit enable row level security;
alter table dating_private.staff_notes enable row level security;
alter table dating_private.app_settings enable row level security;
alter table dating_private.room_settings enable row level security;
alter table dating_private.ads enable row level security;
alter table dating_private.ad_daily enable row level security;
alter table dating_private.ad_seen enable row level security;
alter table dating_private.referral_codes enable row level security;
alter table dating_private.referrals enable row level security;
