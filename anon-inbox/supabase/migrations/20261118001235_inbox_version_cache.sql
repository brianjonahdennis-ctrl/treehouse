-- Inbox refresh fast path: changed rows still use the migration-119 payload, while an unchanged
-- member returns after one indexed counter lookup. Counters are private and change only for affected
-- members. Presence fields are refreshed by occasional full rebuilds in the app, not by these triggers.

set lock_timeout = '5s';

create table if not exists dating_private.inbox_version (
  user_id uuid primary key references auth.users (id) on delete cascade,
  v bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table dating_private.inbox_version enable row level security;
revoke all on dating_private.inbox_version from public, anon, authenticated;

-- One statement for one or both members. DISTINCT avoids double increments if an input repeats.
create or replace function dating_private.bump_inbox_users(p_users uuid[]) returns void
language sql security definer set search_path = public, dating_private as $$
  insert into dating_private.inbox_version as iv (user_id, v, updated_at)
  select distinct u.user_id, 1, statement_timestamp()
  from unnest(coalesce(p_users, '{}'::uuid[])) as u(user_id)
  where u.user_id is not null and exists (select 1 from auth.users a where a.id = u.user_id)
  order by u.user_id
  on conflict (user_id) do update
    set v = iv.v + 1, updated_at = excluded.updated_at;
$$;
revoke all on function dating_private.bump_inbox_users(uuid[]) from public, anon, authenticated;

-- Messages, reads, and reveals point to one conversation. The conversation primary key lookup and
-- the multi-member upsert happen in one statement.
create or replace function dating_private.bump_inbox_conversation(p_conversation uuid) returns void
language sql security definer set search_path = public, dating_private as $$
  insert into dating_private.inbox_version as iv (user_id, v, updated_at)
  select distinct member.user_id, 1, statement_timestamp()
  from public.dating_conversations c
  cross join lateral (values (c.user_a), (c.user_b)) as member(user_id)
  where c.id = p_conversation
    and exists (select 1 from auth.users a where a.id = member.user_id)
  order by member.user_id
  on conflict (user_id) do update
    set v = iv.v + 1, updated_at = excluded.updated_at;
$$;
revoke all on function dating_private.bump_inbox_conversation(uuid) from public, anon, authenticated;

create or replace function dating_private.inbox_conversation_changed() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if tg_op = 'DELETE' then
    perform dating_private.bump_inbox_users(array[old.user_a, old.user_b]);
    return old;
  elsif tg_op = 'UPDATE' then
    if row(new.user_a, new.user_b, new.created_at, new.started_by, new.accepted_at, new.declined_at,
           new.friend_ask_by, new.kind, new.origin)
       is not distinct from
       row(old.user_a, old.user_b, old.created_at, old.started_by, old.accepted_at, old.declined_at,
           old.friend_ask_by, old.kind, old.origin) then
      return new;
    end if;
    perform dating_private.bump_inbox_users(array[old.user_a, old.user_b, new.user_a, new.user_b]);
    return new;
  end if;

  perform dating_private.bump_inbox_users(array[new.user_a, new.user_b]);
  return new;
end $$;
revoke all on function dating_private.inbox_conversation_changed() from public, anon, authenticated;

drop trigger if exists dating_conversations_inbox_insert_delete on public.dating_conversations;
create trigger dating_conversations_inbox_insert_delete
  after insert or delete on public.dating_conversations
  for each row execute function dating_private.inbox_conversation_changed();
drop trigger if exists dating_conversations_inbox_update on public.dating_conversations;
create trigger dating_conversations_inbox_update
  after update of user_a, user_b, created_at, started_by, accepted_at, declined_at, friend_ask_by, kind, origin
  on public.dating_conversations
  for each row execute function dating_private.inbox_conversation_changed();

create or replace function dating_private.inbox_conversation_child_changed() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'dating_messages'
       and row(new.conversation_id, new.sender_id, new.body, new.created_at, new.deleted_at)
           is not distinct from
           row(old.conversation_id, old.sender_id, old.body, old.created_at, old.deleted_at) then
      return new;
    elsif tg_table_name = 'dating_reads'
       and row(new.conversation_id, new.user_id, new.last_read_at)
           is not distinct from
           row(old.conversation_id, old.user_id, old.last_read_at) then
      return new;
    elsif tg_table_name = 'dating_cleared'
       and row(new.conversation_id, new.user_id, new.cleared_at)
           is not distinct from
           row(old.conversation_id, old.user_id, old.cleared_at) then
      return new;
    end if;
  end if;

  -- The conversation row itself bumps both members when its dependent rows are cascade-deleted.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;

  -- A member's local "delete chat" action only hides that chat for them.
  if tg_table_name = 'dating_cleared' then
    if tg_op = 'DELETE' then
      perform dating_private.bump_inbox_users(array[old.user_id]);
      return old;
    end if;
    perform dating_private.bump_inbox_users(array[new.user_id]);
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform dating_private.bump_inbox_conversation(old.conversation_id);
    return old;
  end if;
  perform dating_private.bump_inbox_conversation(new.conversation_id);
  return new;
end $$;
revoke all on function dating_private.inbox_conversation_child_changed() from public, anon, authenticated;

drop trigger if exists dating_messages_inbox_insert on public.dating_messages;
create trigger dating_messages_inbox_insert
  after insert on public.dating_messages
  for each row execute function dating_private.inbox_conversation_child_changed();
drop trigger if exists dating_messages_inbox_update on public.dating_messages;
create trigger dating_messages_inbox_update
  after update of conversation_id, sender_id, body, created_at, deleted_at on public.dating_messages
  for each row execute function dating_private.inbox_conversation_child_changed();
drop trigger if exists dating_messages_inbox_delete on public.dating_messages;
create trigger dating_messages_inbox_delete
  after delete on public.dating_messages
  for each row execute function dating_private.inbox_conversation_child_changed();

drop trigger if exists dating_reads_inbox_insert on public.dating_reads;
create trigger dating_reads_inbox_insert
  after insert on public.dating_reads
  for each row execute function dating_private.inbox_conversation_child_changed();
drop trigger if exists dating_reads_inbox_update on public.dating_reads;
create trigger dating_reads_inbox_update
  after update of conversation_id, user_id, last_read_at on public.dating_reads
  for each row execute function dating_private.inbox_conversation_child_changed();

drop trigger if exists dating_reveals_inbox_insert on public.dating_reveals;
create trigger dating_reveals_inbox_insert
  after insert on public.dating_reveals
  for each row execute function dating_private.inbox_conversation_child_changed();
drop trigger if exists dating_reveals_inbox_delete on public.dating_reveals;
create trigger dating_reveals_inbox_delete
  after delete on public.dating_reveals
  for each row execute function dating_private.inbox_conversation_child_changed();

drop trigger if exists dating_cleared_inbox_insert on public.dating_cleared;
create trigger dating_cleared_inbox_insert
  after insert on public.dating_cleared
  for each row execute function dating_private.inbox_conversation_child_changed();
drop trigger if exists dating_cleared_inbox_update on public.dating_cleared;
create trigger dating_cleared_inbox_update
  after update of conversation_id, user_id, cleared_at on public.dating_cleared
  for each row execute function dating_private.inbox_conversation_child_changed();
drop trigger if exists dating_cleared_inbox_delete on public.dating_cleared;
create trigger dating_cleared_inbox_delete
  after delete on public.dating_cleared
  for each row execute function dating_private.inbox_conversation_child_changed();

create or replace function dating_private.inbox_likes_changed() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if tg_op = 'DELETE' then
    perform dating_private.bump_inbox_users(array[old.from_user, old.to_user]);
    return old;
  elsif tg_op = 'UPDATE' then
    if row(new.from_user, new.to_user, new.liked, new.created_at)
       is not distinct from row(old.from_user, old.to_user, old.liked, old.created_at) then
      return new;
    end if;
    perform dating_private.bump_inbox_users(array[old.from_user, old.to_user, new.from_user, new.to_user]);
    return new;
  end if;
  perform dating_private.bump_inbox_users(array[new.from_user, new.to_user]);
  return new;
end $$;
revoke all on function dating_private.inbox_likes_changed() from public, anon, authenticated;
drop trigger if exists dating_likes_inbox_change on public.dating_likes;
create trigger dating_likes_inbox_change
  after insert or update or delete on public.dating_likes
  for each row execute function dating_private.inbox_likes_changed();

create or replace function dating_private.inbox_blocks_changed() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if tg_op = 'DELETE' then
    perform dating_private.bump_inbox_users(array[old.blocker_id, old.blocked_id]);
    return old;
  end if;
  perform dating_private.bump_inbox_users(array[new.blocker_id, new.blocked_id]);
  return new;
end $$;
revoke all on function dating_private.inbox_blocks_changed() from public, anon, authenticated;
drop trigger if exists dating_blocks_inbox_change on public.dating_blocks;
create trigger dating_blocks_inbox_change
  after insert or delete on public.dating_blocks
  for each row execute function dating_private.inbox_blocks_changed();

create or replace function dating_private.inbox_status_changed() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  if tg_op = 'UPDATE' and row(new.user_id, new.body, new.updated_at)
     is not distinct from row(old.user_id, old.body, old.updated_at) then
    return new;
  end if;

  insert into dating_private.inbox_version as iv (user_id, v, updated_at)
  with affected as (
    select uid as user_id
    union
    select case when c.user_a = uid then c.user_b else c.user_a end
    from public.dating_conversations c
    where c.kind = 'friend' and c.accepted_at is not null
      and (c.user_a = uid or c.user_b = uid)
      and not dating_is_blocked(c.user_a, c.user_b)
  )
  select affected.user_id, 1, statement_timestamp()
  from affected
  where affected.user_id is not null and exists (select 1 from auth.users a where a.id = affected.user_id)
  order by affected.user_id
  on conflict (user_id) do update
    set v = iv.v + 1, updated_at = excluded.updated_at;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function dating_private.inbox_status_changed() from public, anon, authenticated;
drop trigger if exists dating_statuses_inbox_change on public.dating_statuses;
create trigger dating_statuses_inbox_change
  after insert or update or delete on public.dating_statuses
  for each row execute function dating_private.inbox_status_changed();

-- last_seen_at is intentionally excluded: online / active-hours / delivered indicators are refreshed
-- by the existing light schedule. Profile fields displayed in chats or incoming likes do bump versions.
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

  insert into dating_private.inbox_version as iv (user_id, v, updated_at)
  with affected as (
    select case when c.user_a = uid then c.user_b else c.user_a end as user_id
    from public.dating_conversations c
    where c.user_a = uid or c.user_b = uid
    union
    select l.to_user as user_id
    from public.dating_likes l
    where l.from_user = uid and l.liked
    union
    select l.from_user as user_id
    from public.dating_likes l
    where l.to_user = uid and l.liked
  )
  select affected.user_id, 1, statement_timestamp()
  from affected
  where affected.user_id is not null and affected.user_id <> uid
    and exists (select 1 from auth.users a where a.id = affected.user_id)
  order by affected.user_id
  on conflict (user_id) do update
    set v = iv.v + 1, updated_at = excluded.updated_at;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function dating_private.inbox_profile_changed() from public, anon, authenticated;
drop trigger if exists dating_profiles_inbox_insert_delete on public.dating_profiles;
create trigger dating_profiles_inbox_insert_delete
  after insert or delete on public.dating_profiles
  for each row execute function dating_private.inbox_profile_changed();
drop trigger if exists dating_profiles_inbox_update on public.dating_profiles;
create trigger dating_profiles_inbox_update
  after update of handle, gender, age, location, intent, bio, interests, is_active, suspended
  on public.dating_profiles
  for each row execute function dating_private.inbox_profile_changed();

-- New app versions use v2. The original two-argument function stays available for installed apps.
create or replace function public.dating_summary_changes_v2(
  p_known jsonb default '{}'::jsonb,
  p_req text default '',
  p_version bigint default null
)
returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  known jsonb;
  req jsonb;
  req_fp text;
  current_version bigint;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;

  select coalesce((select iv.v from dating_private.inbox_version iv where iv.user_id = me), 0)
  into current_version;

  if p_version is not null and p_version = current_version then
    return jsonb_build_object('unchanged', true, 'version', current_version);
  end if;

  known := case when jsonb_typeof(p_known) = 'object' then p_known else '{}'::jsonb end;
  req := coalesce((select jsonb_agg(to_jsonb(r)) from incoming_requests() r), '[]'::jsonb);
  req_fp := left(md5(req::text), 12);
  return (
    with c as (select to_jsonb(x) as j from my_conversations() x),
    f as (select j, j ->> 'conversation_id' as id, left(md5(j::text), 12) as fp from c)
    select jsonb_build_object(
      'unchanged', false,
      'version', current_version,
      'changed', coalesce((select jsonb_agg(f.j || jsonb_build_object('_fp', f.fp)) from f where known ->> f.id is distinct from f.fp), '[]'::jsonb),
      'removed', coalesce((select jsonb_agg(k.key) from jsonb_object_keys(known) k(key) where not exists (select 1 from f where f.id = k.key)), '[]'::jsonb),
      'requests', case when req_fp = coalesce(p_req, '') then null else req end,
      'req_fp', req_fp,
      'pending', my_pending_likes(),
      'friend_asks', coalesce((select jsonb_agg(to_jsonb(a)) from my_friend_asks() a), '[]'::jsonb),
      'my_status', (select jsonb_build_object('body', s.body, 'updated_at', s.updated_at) from dating_statuses s where s.user_id = me),
      'friend_statuses', coalesce((select jsonb_agg(to_jsonb(fs)) from friend_statuses() fs), '[]'::jsonb),
      'origins', coalesce((select jsonb_object_agg(o.id, o.origin) from (
          select d.id, d.origin from dating_conversations d where d.user_a = me and d.origin is not null
          union all
          select d.id, d.origin from dating_conversations d where d.user_b = me and d.origin is not null) o), '{}'::jsonb))
  );
end $$;
revoke execute on function public.dating_summary_changes_v2(jsonb, text, bigint) from public, anon;
grant execute on function public.dating_summary_changes_v2(jsonb, text, bigint) to authenticated;
