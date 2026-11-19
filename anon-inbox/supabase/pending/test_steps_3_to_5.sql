-- Run after midnight (low traffic), always rolled back.
begin;
-- Chat list: return only the chats that changed (memory/CPU plan step 3, 19 Nov 2026).
--
-- Today every message bumps both members' inbox version, so their next refresh rebuilds the whole chat
-- list (about 116 ms at peak, 43% of database time). Now each bump from a message, read receipt or
-- reveal also records WHICH conversation changed. dating_summary_changes_v3 then rebuilds only those
-- conversations when nothing else changed (a few ms), and falls back to the full rebuild otherwise.
--
--  * inbox_version.full_v: the version of the last change that can affect more than individual chats
--    (blocks, profile edits, statuses, conversations created/accepted/deleted/hidden, matches). Any
--    phone older than full_v gets a full rebuild, exactly as before.
--  * inbox_version.likes_v: the version of the last one-way like/pass; a partial answer then also
--    includes the likes/requests list and pending count.
--  * inbox_conv_change(user_id, conversation_id, v): latest version at which that chat changed for that
--    member. Rows at or below full_v are useless and are swept every 30 minutes.
--
-- Older app code keeps calling dating_summary_changes_v2 / dating_summary_changes, which are unchanged.
-- Safe to run twice.

set lock_timeout = '5s';

-- Columns full_v / likes_v were added by 20261119181500. Everything that happened before this migration
-- counts as a full change. Rows are locked in user_id order, the same order the bump functions use, so
-- this cannot deadlock with live messages (it may wait a moment).
-- (test) backfill happens per test member below

-- A bump that started just before this commit can still finish with the OLD functions (no change
-- record). The follow-up 20261120010100 marks rows touched before this moment (+5 s) as full again.
create table if not exists dating_private.inbox_partial_switch (id int primary key, switched_at timestamptz not null);
revoke all on dating_private.inbox_partial_switch from public, anon, authenticated;
insert into dating_private.inbox_partial_switch values (1, clock_timestamp())
  on conflict (id) do update set switched_at = excluded.switched_at;

-- No foreign keys on purpose: adding them would lock the chats and users tables while this runs.
-- Rows of deleted chats/accounts are harmless and are swept with the rest (deletions set full_v).
create table if not exists dating_private.inbox_conv_change (
  user_id uuid not null,
  conversation_id uuid not null,
  v bigint not null,
  primary key (user_id, conversation_id)
);
alter table dating_private.inbox_conv_change enable row level security;
revoke all on dating_private.inbox_conv_change from public, anon, authenticated;

-- Changes that can touch more than individual chats: full rebuild for these members.
create or replace function dating_private.bump_inbox_users(p_users uuid[]) returns void
language sql security definer set search_path = public, dating_private as $$
  insert into dating_private.inbox_version as iv (user_id, v, full_v, updated_at)
  select distinct u.user_id, 1, 1, statement_timestamp()
  from unnest(coalesce(p_users, '{}'::uuid[])) as u(user_id)
  where u.user_id is not null and exists (select 1 from auth.users a where a.id = u.user_id)
  order by u.user_id
  on conflict (user_id) do update
    set v = iv.v + 1, full_v = iv.v + 1, updated_at = excluded.updated_at;
$$;
revoke all on function dating_private.bump_inbox_users(uuid[]) from public, anon, authenticated;

-- One-way likes and passes: only the likes/requests part changes.
create or replace function dating_private.bump_inbox_likes(p_users uuid[]) returns void
language sql security definer set search_path = public, dating_private as $$
  insert into dating_private.inbox_version as iv (user_id, v, full_v, likes_v, updated_at)
  select distinct u.user_id, 1, 1, 1, statement_timestamp()
  from unnest(coalesce(p_users, '{}'::uuid[])) as u(user_id)
  where u.user_id is not null and exists (select 1 from auth.users a where a.id = u.user_id)
  order by u.user_id
  on conflict (user_id) do update
    set v = iv.v + 1, likes_v = iv.v + 1, updated_at = excluded.updated_at;
$$;
revoke all on function dating_private.bump_inbox_likes(uuid[]) from public, anon, authenticated;

-- Messages, read receipts and reveals: one chat changed for both members.
create or replace function dating_private.bump_inbox_conversation(p_conversation uuid) returns void
language sql security definer set search_path = public, dating_private as $$
  with bumped as (
    insert into dating_private.inbox_version as iv (user_id, v, full_v, updated_at)
    select distinct member.user_id, 1, 1, statement_timestamp()
    from public.dating_conversations c
    cross join lateral (values (c.user_a), (c.user_b)) as member(user_id)
    where c.id = p_conversation
      and exists (select 1 from auth.users a where a.id = member.user_id)
    order by member.user_id
    on conflict (user_id) do update
      set v = iv.v + 1, updated_at = excluded.updated_at
    returning iv.user_id, iv.v
  )
  insert into dating_private.inbox_conv_change as cc (user_id, conversation_id, v)
  select b.user_id, p_conversation, b.v from bumped b
  on conflict (user_id, conversation_id) do update set v = excluded.v;
$$;
revoke all on function dating_private.bump_inbox_conversation(uuid) from public, anon, authenticated;

-- Likes: answered likes can create a match or change "matched" on an existing chat, so they stay full.
create or replace function dating_private.inbox_likes_changed() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare
  r public.dating_likes;
  answered boolean;
begin
  if tg_op = 'UPDATE' then
    if row(new.from_user, new.to_user, new.liked, new.created_at)
       is not distinct from row(old.from_user, old.to_user, old.liked, old.created_at) then
      return new;
    end if;
    perform dating_private.bump_inbox_users(array[old.from_user, old.to_user, new.from_user, new.to_user]);
    return new;
  end if;

  r := case when tg_op = 'DELETE' then old else new end;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;

  answered := exists (select 1 from public.dating_likes x where x.from_user = r.to_user and x.to_user = r.from_user);

  if answered then
    perform dating_private.bump_inbox_users(array[r.from_user, r.to_user]);
  elsif r.liked then
    perform dating_private.bump_inbox_likes(array[r.to_user]);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function dating_private.inbox_likes_changed() from public, anon, authenticated;

-- Statuses and profile edits: same members as before, now through bump_inbox_users (sets full_v).
create or replace function dating_private.inbox_status_changed() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  if tg_op = 'UPDATE' and row(new.user_id, new.body, new.updated_at)
     is not distinct from row(old.user_id, old.body, old.updated_at) then
    return new;
  end if;
  perform dating_private.bump_inbox_users(array(
    select uid
    union
    select case when c.user_a = uid then c.user_b else c.user_a end
    from public.dating_conversations c
    where c.kind = 'friend' and c.accepted_at is not null
      and (c.user_a = uid or c.user_b = uid)
      and not dating_is_blocked(c.user_a, c.user_b)));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function dating_private.inbox_status_changed() from public, anon, authenticated;

create or replace function dating_private.inbox_profile_changed() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  if tg_op = 'UPDATE'
     and row(new.handle, new.gender, new.age, new.location, new.intent, new.bio, new.interests, new.is_active, new.suspended)
         is not distinct from
         row(old.handle, old.gender, old.age, old.location, old.intent, old.bio, old.interests, old.is_active, old.suspended) then
    return new;
  end if;
  perform dating_private.bump_inbox_users(array(
    select x.user_id from (
      select case when c.user_a = uid then c.user_b else c.user_a end as user_id
      from public.dating_conversations c
      where c.user_a = uid or c.user_b = uid
      union
      select l.to_user from public.dating_likes l where l.from_user = uid and l.liked
    ) x where x.user_id is distinct from uid));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function dating_private.inbox_profile_changed() from public, anon, authenticated;

-- The chat list for just these conversations (generated from the live my_conversations()).
CREATE OR REPLACE FUNCTION dating_private.my_conversations_for(p_ids uuid[])
 RETURNS TABLE(conversation_id uuid, other_handle text, other_gender dating_gender, other_age integer, other_location text, other_intent dating_intent, last_message text, last_from_me boolean, last_at timestamp with time zone, unread integer, i_revealed boolean, they_revealed boolean, blocked boolean, i_blocked boolean, status text, other_online boolean, other_active_hours integer, matched boolean, accepted_at timestamp with time zone, started_by_me boolean, other_read_at timestamp with time zone, other_delivered_at timestamp with time zone, kind text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'dating_private'
AS $function$
  with me as (select auth.uid() as uid),
  convs as (
    select c.* from dating_conversations c, me where c.user_a = me.uid and c.id = any(p_ids)
    union all
    select c.* from dating_conversations c, me where c.user_b = me.uid and c.id = any(p_ids)
  )
  select c.id,
         p.handle, p.gender, p.age, p.location, p.intent,
         m.body, m.sender_id = me.uid, coalesce(m.created_at, c.created_at),
         -- Unread (counted up to 99; the app shows 99+ anyway).
         (select count(*)::int from (
            select 1 from dating_messages x
            where x.conversation_id = c.id and x.sender_id = o.uid
              and x.created_at > greatest(coalesce(r.last_read_at, '-infinity'::timestamptz), cl.at)
            limit 99) u),
         exists (select 1 from dating_reveals v where v.conversation_id = c.id and v.user_id = me.uid),
         exists (select 1 from dating_reveals v where v.conversation_id = c.id and v.user_id = o.uid),
         bl.blocked,
         exists (select 1 from dating_blocks b where b.blocker_id = me.uid and b.blocked_id = o.uid),
         case when c.accepted_at is not null then 'chat'
              when c.started_by = me.uid then 'sent'
              else 'request' end,
         case when bl.blocked then false else is_online(p.last_seen_at) end,
         case when bl.blocked then null else hours_since(p.last_seen_at) end,
         exists (select 1 from dating_likes l1 join dating_likes l2 on l2.from_user = l1.to_user and l2.to_user = l1.from_user
                 where l1.from_user = me.uid and l1.to_user = o.uid and l1.liked and l2.liked),
         c.accepted_at,
         c.started_by = me.uid,
         case when bl.blocked then null else rt.last_read_at end,
         -- Delivered: your newest message sent before they last opened treehouse (or read the chat).
         case when bl.blocked or not coalesce(m.sender_id = me.uid, false) then null else (
           select x.created_at from dating_messages x
           where x.conversation_id = c.id and x.created_at <= greatest(p.last_seen_at, rt.last_read_at) and x.sender_id = me.uid
           order by x.created_at desc limit 1) end,
         c.kind
  from convs c
  cross join me
  cross join lateral (select case when c.user_a = me.uid then c.user_b else c.user_a end as uid) o
  cross join lateral (select dating_cleared_at(c.id, me.uid) as at) cl
  left join dating_profiles p on p.user_id = o.uid
  cross join lateral (select dating_is_blocked(me.uid, o.uid) or coalesce(p.suspended, false) as blocked) bl
  left join dating_reads r on r.conversation_id = c.id and r.user_id = me.uid
  left join dating_reads rt on rt.conversation_id = c.id and rt.user_id = o.uid
  left join lateral (
    select body, sender_id, created_at from dating_messages
    where conversation_id = c.id and created_at > cl.at
    order by created_at desc, id desc limit 1
  ) m on true
  where not (c.accepted_at is null and c.declined_at is not null and c.started_by is distinct from me.uid)
    and (cl.at = '-infinity'::timestamptz or m.created_at is not null)
  order by coalesce(m.created_at, c.created_at) desc;
$function$;
revoke all on function dating_private.my_conversations_for(uuid[]) from public, anon, authenticated;

create or replace function public.dating_summary_changes_v3(
  p_known jsonb default '{}'::jsonb,
  p_req text default '',
  p_version bigint default null
)
returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  cur record;
  known jsonb;
  ids uuid[];
  req jsonb;
  req_fp text;
  result jsonb;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;

  select coalesce(iv.v, 0) as v, coalesce(iv.full_v, 0) as full_v, coalesce(iv.likes_v, 0) as likes_v
  into cur
  from (select 1) one left join dating_private.inbox_version iv on iv.user_id = me;

  if p_version is not null and p_version = cur.v then
    return jsonb_build_object('unchanged', true, 'version', cur.v);
  end if;

  -- Something beyond individual chats changed (or the phone has no usable version): full answer.
  if p_version is null or p_version < cur.full_v or p_version > cur.v then
    return dating_summary_changes_v2(p_known, p_req, null) || jsonb_build_object('version', cur.v, 'partial', false);
  end if;

  known := case when jsonb_typeof(p_known) = 'object' then p_known else '{}'::jsonb end;
  select coalesce(array_agg(cc.conversation_id), '{}'::uuid[]) into ids
  from dating_private.inbox_conv_change cc
  where cc.user_id = me and cc.v > p_version;

  with c as (select to_jsonb(x) as j from dating_private.my_conversations_for(ids) x),
  f as (select j, j ->> 'conversation_id' as id, left(md5(j::text), 12) as fp from c)
  select jsonb_build_object(
    'unchanged', false,
    'partial', true,
    'version', cur.v,
    'changed', coalesce((select jsonb_agg(f.j || jsonb_build_object('_fp', f.fp)) from f where known ->> f.id is distinct from f.fp), '[]'::jsonb),
    -- A changed chat that no longer appears (cleared, declined) is removed from the phone's list.
    'removed', coalesce((select jsonb_agg(i::text) from unnest(ids) i where known ? i::text and not exists (select 1 from f where f.id = i::text)), '[]'::jsonb))
  into result;

  if cur.likes_v > p_version then
    req := coalesce((select jsonb_agg(to_jsonb(r)) from incoming_requests() r), '[]'::jsonb);
    req_fp := left(md5(req::text), 12);
    result := result || jsonb_build_object(
      'requests', case when req_fp = coalesce(p_req, '') then null else req end,
      'req_fp', req_fp,
      'pending', my_pending_likes());
  end if;
  return result;
end $$;
revoke execute on function public.dating_summary_changes_v3(jsonb, text, bigint) from public, anon;
grant execute on function public.dating_summary_changes_v3(jsonb, text, bigint) to authenticated;

-- Keep the change list small: rows at or below the member's full_v can never be used again.
create or replace function dating_private.inbox_conv_change_sweep() returns void
language sql security definer set search_path = public, dating_private as $$
  delete from dating_private.inbox_conv_change cc
  using dating_private.inbox_version iv
  where iv.user_id = cc.user_id and cc.v <= iv.full_v;
$$;
revoke all on function dating_private.inbox_conv_change_sweep() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'inbox-conv-change-sweep') then
    perform cron.unschedule('inbox-conv-change-sweep');
  end if;
end $$;
-- Fewer and smaller live signals (memory/CPU plan step 4, 19 Nov 2026).
-- In the last hour 76% of all live signals (realtime.messages rows) were new-message signals.
--
-- 1. "Recently here" was 15 minutes. The app says "I'm here" every 4 minutes while it's on screen and as
--    soon as it comes back (state.ts loadDating), so anyone not seen for 6 minutes has closed treehouse
--    and can't receive the signal anyway; they catch up when they return, as today. 15 → 6 minutes.
-- 2. Message signals carried the message text twice ('b' preview and 'm.body'). The app already uses
--    m.body when 'b' is missing (App.tsx), so 'b' is dropped.
-- Calls, new chats and everything else are unchanged. Safe to run twice.

set lock_timeout = '5s';

create or replace function dating_private.recently_here(p_user uuid) returns boolean
language sql stable security definer set search_path = public, dating_private as $$
  select exists (select 1 from dating_profiles p where p.user_id = p_user and p.last_seen_at > now() - interval '6 minutes')
      or exists (select 1 from bird_kingdom b where b.user_id = p_user and b.last_ping_at > now() - interval '6 minutes')
$$;
revoke all on function dating_private.recently_here(uuid) from public, anon, authenticated;

create or replace function dating_private.nudge_message(p_user uuid, p_message public.dating_messages) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if p_user is null or not recently_here(p_user) then return; end if;   -- away: they catch up when they're back
  begin
    perform realtime.send(
      jsonb_build_object('k', 'message', 'c', p_message.conversation_id, 'at', p_message.created_at,
        'm', jsonb_strip_nulls(jsonb_build_object('id', p_message.id, 'sender_id', p_message.sender_id,
                                                  'body', p_message.body, 'reply_to', p_message.reply_to,
                                                  'photo', p_message.photo, 'photo_w', p_message.photo_w, 'photo_h', p_message.photo_h,
                                                  'voice', p_message.voice, 'voice_ms', p_message.voice_ms))),
      'inbox', 'user:' || p_user, true);
  exception when others then null;   -- a signal must never block a message
  end;
end $$;
revoke execute on function dating_private.nudge_message(uuid, public.dating_messages) from public, anon, authenticated;

-- Likes used their own 15-minute check; same 6 minutes now.
create or replace function dating_private.nudge_on_like() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if new.liked and recently_here(new.to_user) then
    perform nudge(new.to_user);
  end if;
  return null;
end $$;

-- Smaller message storage (memory plan step 5, 19 Nov 2026).
-- The index dating_messages_sender_recent (sender_id, created_at) is 574 MB. Only two things used it:
--  * the "20 messages a minute" send limit, now a one-row-per-sender counter (dating_private.send_rate);
--  * the staff console's "messages sent" count, now counted through the member's chats (chat index).
-- Every other check (photo unlock, ratings, calls, message requests, Bird Kingdom) reads messages within
-- one chat and uses dating_messages_conv_recent. The index itself is dropped separately with
--   drop index concurrently if exists public.dating_messages_sender_recent;
-- (outside a transaction, so sending messages never waits). Safe to run twice.

set lock_timeout = '5s';

create table if not exists dating_private.send_rate (
  user_id uuid primary key,
  window_start timestamptz not null,
  n int not null
);
alter table dating_private.send_rate enable row level security;
revoke all on dating_private.send_rate from public, anon, authenticated;

CREATE OR REPLACE FUNCTION dating_private.dating_messages_before()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'dating_private'
AS $function$
declare
  c dating_conversations%rowtype;
  sent_now int;
begin
  -- Rate limit: at most 20 messages a minute, from a one-row-per-sender counter (no message index).
  -- A refused message rolls the count back with it, as before.
  insert into dating_private.send_rate as r (user_id, window_start, n) values (new.sender_id, now(), 1)
  on conflict (user_id) do update
    set n = case when r.window_start < now() - interval '1 minute' then 1 else r.n + 1 end,
        window_start = case when r.window_start < now() - interval '1 minute' then now() else r.window_start end
  returning n into sent_now;
  if sent_now > 20 then
    raise exception 'Slow down - too many messages. Try again in a minute.' using errcode = 'P0001';
  end if;
  select * into c from dating_conversations where id = new.conversation_id;
  -- Message requests: the recipient accepts first; the sender gets 3 messages until then.
  if found and c.accepted_at is null then
    if new.sender_id is distinct from c.started_by then
      raise exception 'Accept the message request first, then you can reply.' using errcode = '42501';
    elsif c.declined_at is not null then
      raise exception 'This person isn''t accepting messages from you.' using errcode = '42501';
    elsif (select count(*) from (select 1 from dating_messages
             where conversation_id = c.id and sender_id = new.sender_id limit 3) sent) >= 3 then
      raise exception 'Wait for them to accept: you can send up to 3 messages until then.' using errcode = 'P0001';
    end if;
  end if;
  -- Replies must quote a message in the same chat.
  if new.reply_to is not null and not exists (
    select 1 from dating_messages q where q.id = new.reply_to and q.conversation_id = new.conversation_id) then
    raise exception 'You can only reply to a message in this chat.' using errcode = '22023';
  end if;
  new.edited_at := null;
  new.deleted_at := null;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION dating_private.staff_member_base(p_handle text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'dating_private'
AS $function$
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
      'messages_sent', (select count(*) from dating_conversations c join dating_messages m on m.conversation_id = c.id where (c.user_a = uid or c.user_b = uid) and m.sender_id = uid),
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
end $function$;

-- Old counters are useless after a minute; clear them every night.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-rate-sweep') then perform cron.unschedule('send-rate-sweep'); end if;
end $$;
set local search_path = public, dating_private;
-- (test only) no message-count bookkeeping, so test messages never touch rows live senders use
create or replace function dating_private.dating_messages_after() returns trigger language plpgsql as $x$ begin return null; end $x$;
create temp table _t(n serial, step text, val text) on commit drop;
grant all on _t to authenticated; grant all on _t_n_seq to authenticated;
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true); end $$;
create or replace function pg_temp.as_admin() returns void language plpgsql as $$ begin
  perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true); end $$;
do $$
declare ids uuid[]; a uuid; b uuid; c uuid; conv uuid; r jsonb; full_row jsonb; part_row jsonb; va bigint; vb bigint; known jsonb; reqfp text; busy uuid; bconv uuid; bv bigint; t0 timestamptz; i int; tp numeric := 0; tf numeric := 0;
begin
  select array_agg(user_id) into ids from (
    select p.user_id from dating_profiles p where p.is_active and not p.suspended and p.last_seen_at < now() - interval '3 days'
      and not exists (select 1 from dating_likes l where l.from_user=p.user_id or l.to_user=p.user_id)
      and not exists (select 1 from dating_conversations d where d.user_a=p.user_id or d.user_b=p.user_id) limit 3) s;
  a := ids[1]; b := ids[2]; c := ids[3];
  update dating_private.inbox_version set full_v = v, likes_v = v where user_id = any(ids);
  insert into dating_conversations(user_a, user_b, started_by, accepted_at) values (least(a,b), greatest(a,b), a, now()) returning id into conv;

  perform pg_temp.as_user(a);
  r := dating_summary_changes_v3('{}'::jsonb, '', null); va := (r->>'version')::bigint; reqfp := r->>'req_fp';
  select coalesce(jsonb_object_agg(x->>'conversation_id', x->>'_fp'), '{}'::jsonb) into known from jsonb_array_elements(r->'changed') x;
  insert into _t(step,val) values ('A first call is full', (r->>'partial'));
  r := dating_summary_changes_v3(known, reqfp, va);
  insert into _t(step,val) values ('A again: unchanged', r->>'unchanged');

  -- B sends a message
  perform pg_temp.as_admin();
  insert into dating_messages(conversation_id, sender_id, body) values (conv, b, 'hello from B');
  perform pg_temp.as_user(a);
  r := dating_summary_changes_v3(known, reqfp, va);
  part_row := (select x - '_fp' from jsonb_array_elements(r->'changed') x where x->>'conversation_id' = conv::text);
  full_row := (select to_jsonb(m) from my_conversations() m where m.conversation_id = conv);
  insert into _t(step,val) values ('after message: partial answer', r->>'partial');
  insert into _t(step,val) values ('partial row = full rebuild row', (part_row = full_row)::text || ' (unread ' || coalesce(part_row->>'unread','?') || ', last "' || coalesce(part_row->>'last_message','?') || '")');
  insert into _t(step,val) values ('partial has no requests part', (not (r ? 'requests'))::text);
  va := (r->>'version')::bigint;
  known := known || jsonb_build_object(conv::text, (select x->>'_fp' from jsonb_array_elements(r->'changed') x where x->>'conversation_id' = conv::text));

  -- A reads the chat -> B sees the read receipt
  perform pg_temp.as_user(b);
  r := dating_summary_changes_v3('{}'::jsonb, '', null); vb := (r->>'version')::bigint;
  perform pg_temp.as_admin();
  insert into dating_reads(conversation_id, user_id, last_read_at) values (conv, a, now())
    on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  perform pg_temp.as_user(b);
  r := dating_summary_changes_v3('{}'::jsonb, '', vb);
  part_row := (select x - '_fp' from jsonb_array_elements(r->'changed') x where x->>'conversation_id' = conv::text);
  full_row := (select to_jsonb(m) from my_conversations() m where m.conversation_id = conv);
  insert into _t(step,val) values ('read receipt: partial, row matches full', (r->>'partial') || ', ' || (part_row = full_row)::text || ' (other_read_at set: ' || (part_row->>'other_read_at' is not null)::text || ')');

  -- C likes A (one-way) -> partial with requests
  perform pg_temp.as_admin();
  insert into dating_likes(from_user, to_user, liked) values (c, a, true);
  perform pg_temp.as_user(a);
  r := dating_summary_changes_v3(known, reqfp, va);
  insert into _t(step,val) values ('one-way like: partial + requests', (r->>'partial') || ', requests=' || coalesce(jsonb_array_length(r->'requests')::text, 'same') || ', pending=' || coalesce(r->>'pending','-'));
  va := (r->>'version')::bigint;

  -- A blocks B -> full
  perform pg_temp.as_admin();
  insert into dating_blocks(blocker_id, blocked_id) values (a, b);
  perform pg_temp.as_user(a);
  r := dating_summary_changes_v3(known, reqfp, va);
  insert into _t(step,val) values ('block: full answer', ((r->>'partial') = 'false')::text);

  -- old v2 still fine
  insert into _t(step,val) values ('v2 still works', (dating_summary_changes_v2('{}'::jsonb,'',null) ? 'changed')::text);
  perform pg_temp.as_admin();

end $$;

do $$
declare ids uuid[]; a uuid; b uuid; conv uuid; i int; refused boolean := false; busy uuid; old_c bigint; new_c bigint; pl jsonb;
begin
  select array_agg(user_id) into ids from (
    select p.user_id from dating_profiles p where p.is_active and not p.suspended and p.last_seen_at < now() - interval '3 days'
      and not exists (select 1 from dating_conversations d where d.user_a=p.user_id or d.user_b=p.user_id) limit 2) s;
  a := ids[1]; b := ids[2];
  insert into dating_conversations(user_a, user_b, started_by, accepted_at) values (least(a,b), greatest(a,b), a, now()) returning id into conv;
  -- step 4: away member gets no signal, present member gets one without the duplicate text
  update dating_profiles set last_seen_at = now() - interval '10 minutes' where user_id = a;
  insert into _t(step,val) values ('seen 10 min ago counts as away', (not dating_private.recently_here(a))::text);
  update dating_profiles set last_seen_at = now() where user_id = a;
  insert into dating_messages(conversation_id, sender_id, body) values (conv, b, 'signal test');
  perform dating_private.nudge_message(a, (select m from dating_messages m where m.conversation_id = conv order by created_at desc limit 1));
  select payload into pl from realtime.messages where topic = 'user:' || a and payload->>'k' = 'message' order by inserted_at desc limit 1;
  insert into _t(step,val) values ('signal sent, no duplicate text, body kept', (pl is not null)::text || ', ' || (not (pl ? 'b'))::text || ', ' || coalesce(pl->'m'->>'body','-'));
  -- step 5: 20 messages a minute allowed, the 21st refused
  for i in 2..20 loop insert into dating_messages(conversation_id, sender_id, body) values (conv, b, 'rate ' || i); end loop;
  begin insert into dating_messages(conversation_id, sender_id, body) values (conv, b, 'rate 21');
  exception when others then refused := sqlerrm like 'Slow down%'; end;
  insert into _t(step,val) values ('20 a minute ok, 21st refused', refused::text);
  -- staff count: old way vs new way, for a busy member
  select d.user_a into busy from dating_conversations d
    where d.id = (select (r.payload->>'c')::uuid from realtime.messages r where r.inserted_at > now() - interval '2 minutes' and r.payload->>'k' = 'message' order by r.inserted_at desc limit 1);
  select count(*) into old_c from dating_messages m where m.sender_id = busy;
  select count(*) into new_c from dating_conversations c join dating_messages m on m.conversation_id = c.id where (c.user_a = busy or c.user_b = busy) and m.sender_id = busy;
  insert into _t(step,val) values ('staff messages_sent old = new', (old_c = new_c)::text || ' (' || old_c || ')');
end $$;
select step, val from _t order by n;
rollback;
