-- Treehouse chats (Hydra, 15 Nov 2026): members can send a message request to people in their
-- My Treehouse network, and those chats get their own Inbox column.
-- * Same as any message request: the other person accepts or declines in Requests. No friendship,
--   no match, nothing automatic.
-- * Allowed only between two people in the same referral line: the person is somewhere below me in my
--   tree, or I am somewhere below them. Checked here, not in the app.
-- * A brand-new request from My Treehouse is tagged origin = 'treehouse' (like 'nearby'). An existing chat
--   between the two (friend, match, older request) is returned as it is and keeps its own tag.

set lock_timeout = '5s';

alter table public.dating_conversations drop constraint if exists dating_conversations_origin_ok;
alter table public.dating_conversations add constraint dating_conversations_origin_ok
  check (origin is null or origin in ('nearby', 'treehouse')) not valid;   -- not valid: no full-table check

-- Are these two people in the same referral line (either one below the other)?
create or replace function dating_private.same_treehouse(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public, dating_private as $$
  select p_a is not null and p_b is not null and p_a <> p_b and (
    exists (
      with recursive up as (
        select r.referrer as id, 1 as n from referrals r where r.user_id = p_b
        union all
        select r.referrer, up.n + 1 from referrals r join up on r.user_id = up.id where up.id is not null and up.n < 60)
      select 1 from up where up.id = p_a)
    or exists (
      with recursive up as (
        select r.referrer as id, 1 as n from referrals r where r.user_id = p_a
        union all
        select r.referrer, up.n + 1 from referrals r join up on r.user_id = up.id where up.id is not null and up.n < 60)
      select 1 from up where up.id = p_b)) $$;
revoke all on function dating_private.same_treehouse(uuid, uuid) from public, anon, authenticated;

create or replace function public.start_conversation_from(p_handle text, p_origin text)
returns uuid
language plpgsql security definer set search_path = public, dating_private as $$
declare conv uuid; me uuid := auth.uid(); other uuid;
begin
  if p_origin = 'treehouse' then
    select user_id into other from dating_profiles where handle = p_handle;
    if not same_treehouse(me, other) then
      raise exception 'You can only send Treehouse message requests to people in your Treehouse.' using errcode = '42501';
    end if;
  end if;
  conv := public.start_conversation(p_handle);
  if p_origin in ('nearby', 'treehouse') then
    update dating_conversations set origin = p_origin
    where id = conv and origin is null and started_by = me and kind = 'dating'
      and created_at > now() - interval '1 minute';
  end if;
  return conv;
end $$;
revoke execute on function public.start_conversation_from(text, text) from public, anon;
grant execute on function public.start_conversation_from(text, text) to authenticated;

-- Announcements can link to My Treehouse, Your Tree and the Treehouse chats column.
create or replace function dating_private.ann_routes() returns text[]
language sql immutable as $$
  select array['/home', '/home/discover', '/home/discover/nearby', '/home/rooms', '/home/matches',
    '/home/matches/friends', '/home/matches/requests', '/home/matches/likes', '/home/matches/announcements',
    '/home/games', '/home/profile', '/home/notifications', '/home/invite',
    '/home/treehouse', '/home/treehouse/tree', '/home/matches/treehouse', '/home/matches/nearby', '/home/matches/chats'];
$$;
