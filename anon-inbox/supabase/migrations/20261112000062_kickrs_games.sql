-- Games on treehouse: members play Kickrs (kickrs.app) as their treehouse self, no second sign-up.
--
-- How it works:
--   * A member taps Allow once ("Kickrs will see your nickname and avatar and that you're 18+").
--     kickrs_connect() records that and gives the member a Kickrs id: a random id that only means
--     something to treehouse and Kickrs. Their user id, name, email and date of birth never leave treehouse.
--   * Each time they open a game, the treehouse server calls kickrs_identity() and signs a one-minute pass
--     with it for Kickrs. Kickrs never gets a treehouse sign-in token.
--   * Every member with a dating profile can connect (profiles are 18+ by the table check);
--     suspended members and anyone marked under 18 by their date of birth cannot.
--   * "Add friend" after a game: Kickrs hands back the other player's Kickrs id and
--     kickrs_friend_request() sends a normal treehouse friend request (same limits, blocks and checks).
--   * Disconnect stops new passes and friend requests. Reconnecting gives back the same Kickrs id,
--     so the member keeps their Kickrs account. Deleting the treehouse account deletes the link.

set lock_timeout = '5s';

create table dating_private.kickrs_links (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  kickrs_id    uuid not null unique default gen_random_uuid(),
  connected_at timestamptz not null default now(),
  revoked_at   timestamptz
);
alter table dating_private.kickrs_links enable row level security;
revoke all on dating_private.kickrs_links from public, anon, authenticated;

-- Why a member can't play yet: 'profile' or 'suspended' (null when they can).
create or replace function dating_private.kickrs_blocker(uid uuid) returns text
language sql stable security definer set search_path = public, dating_private as $$
  select case
    when p.user_id is null then 'profile'
    when p.suspended or p.dob_underage_at is not null or p.age < 18 then 'suspended'
  end
  from (select 1) one
  left join dating_profiles p on p.user_id = uid
$$;
revoke all on function dating_private.kickrs_blocker(uuid) from public, anon, authenticated;

create or replace function dating_private.kickrs_check(uid uuid) returns void
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  case kickrs_blocker(uid)
    when 'profile' then raise exception 'Create your profile first.' using errcode = '28000';
    when 'suspended' then raise exception 'Your profile is suspended.' using errcode = '42501';
    else return;
  end case;
end $$;
revoke all on function dating_private.kickrs_check(uuid) from public, anon, authenticated;

-- For the Games screen: can I play, and have I already tapped Allow?
create or replace function public.kickrs_status() returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select jsonb_build_object(
    'ready', kickrs_blocker(auth.uid()) is null,
    'blocker', kickrs_blocker(auth.uid()),
    'connected', exists (select 1 from kickrs_links where user_id = auth.uid() and revoked_at is null))
  where auth.uid() is not null
$$;
revoke all on function public.kickrs_status() from public, anon;
grant execute on function public.kickrs_status() to authenticated;

-- The member taps Allow (or comes back after disconnecting).
create or replace function public.kickrs_connect() returns table (kickrs_id uuid, handle text, avatar jsonb)
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
begin
  perform kickrs_check(uid);
  insert into kickrs_links (user_id) values (uid)
  on conflict (user_id) do update set revoked_at = null,
    connected_at = case when kickrs_links.revoked_at is null then kickrs_links.connected_at else now() end;
  return query select * from public.kickrs_identity();
end $$;
revoke all on function public.kickrs_connect() from public, anon;
grant execute on function public.kickrs_connect() to authenticated;

-- What the treehouse server puts in a Kickrs pass. Only for connected members who can still play.
create or replace function public.kickrs_identity() returns table (kickrs_id uuid, handle text, avatar jsonb)
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
begin
  perform kickrs_check(uid);
  if not exists (select 1 from kickrs_links l where l.user_id = uid and l.revoked_at is null) then
    raise exception 'Allow Kickrs first.' using errcode = 'P0001';
  end if;
  return query
    select l.kickrs_id, p.handle, a.config
    from kickrs_links l
    join dating_profiles p on p.user_id = l.user_id
    left join user_avatars a on a.user_id = l.user_id
    where l.user_id = uid;
end $$;
revoke all on function public.kickrs_identity() from public, anon;
grant execute on function public.kickrs_identity() to authenticated;

create or replace function public.kickrs_disconnect() returns void
language sql security definer set search_path = public, dating_private as $$
  update kickrs_links set revoked_at = now() where user_id = auth.uid() and revoked_at is null;
$$;
revoke all on function public.kickrs_disconnect() from public, anon;
grant execute on function public.kickrs_disconnect() to authenticated;

-- "Add friend" on a player you just played on Kickrs.
create or replace function public.kickrs_friend_request(p_kickrs_id uuid) returns uuid
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  other_handle text;
begin
  perform kickrs_check(uid);
  if not exists (select 1 from kickrs_links where user_id = uid and revoked_at is null) then
    raise exception 'Allow Kickrs first.' using errcode = 'P0001';
  end if;
  select p.handle into other_handle
  from kickrs_links l join dating_profiles p on p.user_id = l.user_id
  where l.kickrs_id = p_kickrs_id and l.revoked_at is null and l.user_id <> uid;
  if other_handle is null then
    raise exception 'That person is not available.' using errcode = 'P0002';
  end if;
  return start_friend_request(other_handle);
end $$;
revoke all on function public.kickrs_friend_request(uuid) from public, anon;
grant execute on function public.kickrs_friend_request(uuid) to authenticated;
