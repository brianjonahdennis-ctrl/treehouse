-- Fewer chat-list rebuilds (18 Nov 2026 evening check: dating_summary_changes_v2 was 43% of database
-- time at ~217 ms a call, and ~1,400 members' chat-list counters were bumped every minute).
--
-- 1. Likes and passes only bump the members whose chat list actually changes:
--    - the person liked (a new entry in their likes/requests list), and
--    - both people when the like answers an earlier like or pass (the earlier liker's
--      pending count and the answerer's requests list both change).
--    A plain pass of someone who never liked you bumps nobody. The liker's own "pending likes"
--    number is not shown anywhere; the app adds 1 locally and the next full refresh corrects it.
--    Matches still bump both people through the conversation trigger.
-- 2. Profile edits no longer bump everyone the edited person liked: those members only see a
--    count of their own pending likes, which does not depend on the other person's profile.
-- 3. New conversations (a match or an accepted request) send a "convo" signal instead of an empty
--    one, so the app can refresh straight away while grouping other signals into one refresh
--    every 20 seconds. Older apps treat it like the empty signal (a refresh), so they keep working.
-- 4. inbox_presence(): a tiny call returning only online / active-hours for the member's chats, so
--    the app can keep online dots fresh without rebuilding the whole chat list.
--
-- Safe to run twice. Nothing here changes who can see whom.

set lock_timeout = '5s';

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
    -- Rare (a like changed to a pass or back): keep the old, safe behaviour.
    perform dating_private.bump_inbox_users(array[old.from_user, old.to_user, new.from_user, new.to_user]);
    return new;
  end if;

  r := case when tg_op = 'DELETE' then old else new end;
  -- Account deletions cascade through here; the profile/conversation triggers handle those.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;

  -- Did the other person like or pass this member first? (primary-key lookup)
  answered := exists (select 1 from public.dating_likes x where x.from_user = r.to_user and x.to_user = r.from_user);

  if answered then
    perform dating_private.bump_inbox_users(array[r.from_user, r.to_user]);
  elsif r.liked then
    perform dating_private.bump_inbox_users(array[r.to_user]);
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function dating_private.inbox_likes_changed() from public, anon, authenticated;

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
    -- Chats show the other person's profile.
    select case when c.user_a = uid then c.user_b else c.user_a end as user_id
    from public.dating_conversations c
    where c.user_a = uid or c.user_b = uid
    union
    -- The likes/requests list shows the profile of whoever liked you.
    select l.to_user as user_id
    from public.dating_likes l
    where l.from_user = uid and l.liked
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

-- A signal that says "a new chat appeared": the app refreshes at once for these.
create or replace function dating_private.nudge_convo(p_user uuid, p_conversation uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  begin
    perform realtime.send(jsonb_build_object('k', 'convo', 'c', p_conversation), 'inbox', 'user:' || p_user, true);
  exception when others then null;   -- a signal must never block anything
  end;
end $$;
revoke all on function dating_private.nudge_convo(uuid, uuid) from public, anon, authenticated;

create or replace function dating_private.nudge_on_conversation() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' or new.accepted_at is distinct from old.accepted_at then
    if new.user_a is distinct from actor and recently_here(new.user_a) then perform nudge_convo(new.user_a, new.id); end if;
    if new.user_b is distinct from actor and recently_here(new.user_b) then perform nudge_convo(new.user_b, new.id); end if;
  end if;
  return null;
end $$;

-- Online dots and "active N hours ago" for the member's own chats only. Same rules as
-- my_conversations(): blocked or suspended people show as offline with no hours.
create or replace function public.inbox_presence()
returns table (conversation_id uuid, other_online boolean, other_active_hours integer)
language sql stable security definer set search_path = public, dating_private as $$
  with me as (select auth.uid() as uid),
  convs as (
    select c.id, c.user_b as other from dating_conversations c, me where c.user_a = me.uid
    union all
    select c.id, c.user_a from dating_conversations c, me where c.user_b = me.uid
  )
  select c.id,
         case when bl.blocked then false else is_online(p.last_seen_at) end,
         case when bl.blocked then null else hours_since(p.last_seen_at) end
  from convs c
  cross join me
  left join dating_profiles p on p.user_id = c.other
  cross join lateral (select dating_is_blocked(me.uid, c.other) or coalesce(p.suspended, false) as blocked) bl
  where me.uid is not null;
$$;
revoke all on function public.inbox_presence() from public, anon;
grant execute on function public.inbox_presence() to authenticated;
