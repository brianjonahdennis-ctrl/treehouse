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
with locked as (
  select user_id from dating_private.inbox_version where full_v < v or likes_v < v order by user_id for update
)
update dating_private.inbox_version iv set full_v = iv.v, likes_v = iv.v from locked where locked.user_id = iv.user_id;

-- A bump that started just before this commit can still finish with the OLD functions (no change
-- record). The follow-up 20261120010100 marks rows touched before this moment (+5 s) as full again.
create table if not exists dating_private.inbox_partial_switch (id int primary key, switched_at timestamptz not null);
revoke all on dating_private.inbox_partial_switch from public, anon, authenticated;
insert into dating_private.inbox_partial_switch values (1, clock_timestamp())
  on conflict (id) do update set switched_at = excluded.switched_at;

create table if not exists dating_private.inbox_conv_change (
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid not null references public.dating_conversations (id) on delete cascade,
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
select cron.schedule('inbox-conv-change-sweep', '17,47 * * * *', 'select dating_private.inbox_conv_change_sweep()');
