-- treehouse usernames (Hydra, 15 Nov 2026).
-- * Every member can choose a username: 3 to 14 letters, or letters and numbers (at least one letter),
--   unique, stored in lower case. Set once; after that it can be changed once every 365 days.
-- * A changed username stays held for its old owner for 30 days, so nobody can grab it straight away
--   and pretend to be them.
-- * Usernames are private: you see your own in Profile; other people only see it after you have both
--   revealed in a chat (revealed_details). Nicknames stay everywhere else (chatrooms, Discover, Nearby).
-- * Add a friend by username: sends the usual friend request (they accept to chat).
-- * Invite links are treehouse.ng/r/<username>: the referral code IS the username, so you need a
--   username before you can invite anyone. Changing it changes the link (old links stop crediting).

set lock_timeout = '5s';

create table dating_private.usernames (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  username   text not null unique check (username ~ '^[a-z0-9]{3,14}$' and username ~ '[a-z]'),
  set_at     timestamptz not null default now(),
  first_set_at timestamptz not null default now()
);
create table dating_private.username_holds (
  username    text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  released_at timestamptz not null default now()
);
create table dating_private.username_lookups (
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);
create index username_lookups_user_at on dating_private.username_lookups (user_id, at);
alter table dating_private.usernames enable row level security;
alter table dating_private.username_holds enable row level security;
alter table dating_private.username_lookups enable row level security;
revoke all on dating_private.usernames, dating_private.username_holds, dating_private.username_lookups from public, anon, authenticated;

-- Referral codes can now be 3 characters (short usernames), and follow a username change.
alter table dating_private.referral_codes drop constraint if exists referral_codes_code_check;
alter table dating_private.referral_codes add constraint referral_codes_code_check check (code ~ '^[a-z0-9]{3,24}$');
alter table dating_private.referrals drop constraint if exists referrals_code_fkey;
alter table dating_private.referrals add constraint referrals_code_fkey
  foreign key (code) references dating_private.referral_codes (code) on update cascade on delete cascade;

-- Why a username can't be used: null = fine, otherwise a short reason code.
create function dating_private.username_problem(p_name text, p_me uuid) returns text
language sql stable security definer set search_path = public, dating_private as $$
  select case
    when p_name !~ '^[a-z0-9]{3,14}$' or p_name !~ '[a-z]' then 'format'
    when p_name in ('admin', 'administrator', 'support', 'staff', 'moderator', 'mod', 'help', 'helpdesk', 'official',
                    'hydra', 'system', 'root', 'team', 'info', 'security', 'null', 'undefined', 'api', 'app', 'www',
                    'home', 'owner', 'contact', 'abuse', 'report', 'reports', 'invite', 'invites', 'settings', 'login',
                    'signup', 'account', 'profile', 'everyone', 'anonymous', 'naija', 'nigeria')
      or p_name like '%treehouse%' or p_name like '%admin%' then 'reserved'
    when exists (select 1 from usernames u where u.username = p_name and u.user_id is distinct from p_me) then 'taken'
    when exists (select 1 from username_holds h where h.username = p_name and h.user_id is distinct from p_me
                   and h.released_at > now() - interval '30 days') then 'taken'
    when exists (select 1 from referral_codes r where r.code = p_name and r.owner is distinct from p_me) then 'taken'
    else null end
$$;

-- Live check while typing (any signed-in member).
create function public.check_username(p_username text) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare n text := lower(btrim(coalesce(p_username, ''))); why text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  why := username_problem(n, auth.uid());
  return jsonb_build_object('username', n, 'ok', why is null, 'reason', why);
end $$;

-- My username and when I can change it next.
create function public.my_username() returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select case when u.user_id is null then null else jsonb_build_object(
    'username', u.username, 'set_at', u.set_at,
    'next_change_at', u.set_at + interval '365 days',
    'can_change', u.set_at <= now() - interval '365 days') end
  from (select auth.uid() as me) m left join usernames u on u.user_id = m.me
$$;

-- Choose (or, once a year, change) my username. Also makes it my invite code.
create function public.set_username(p_username text) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  n text := lower(btrim(coalesce(p_username, '')));
  cur usernames%rowtype;
  had boolean;
  why text;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from dating_profiles where user_id = me) then raise exception 'Create your profile first.' using errcode = '28000'; end if;
  if dating_is_suspended(me) then raise exception 'Your profile is suspended.' using errcode = '42501'; end if;
  select * into cur from usernames where user_id = me for update;
  had := found;
  if had and cur.username = n then return my_username(); end if;
  if had and cur.set_at > now() - interval '365 days' then
    raise exception 'You can change your username again on %.',
      to_char((cur.set_at + interval '365 days') at time zone 'Africa/Lagos', 'FMDD FMMonth YYYY') using errcode = 'P0001';
  end if;
  why := username_problem(n, me);
  if why = 'format' then raise exception 'Usernames are 3 to 14 letters, or letters and numbers, with at least one letter.' using errcode = '22023'; end if;
  if why = 'reserved' then raise exception 'That username isn’t available. Try another.' using errcode = '22023'; end if;
  if why = 'taken' then raise exception 'That username is taken. Try another.' using errcode = '23505'; end if;
  begin
    if had then
      insert into username_holds (username, user_id, released_at) values (cur.username, me, now())
      on conflict (username) do update set user_id = excluded.user_id, released_at = excluded.released_at;
      update usernames set username = n, set_at = now() where user_id = me;
    else
      insert into usernames (user_id, username) values (me, n);
    end if;
    delete from username_holds where username = n and user_id = me;
    -- The invite code follows the username (referrals already credited keep pointing at it).
    if exists (select 1 from referral_codes where owner = me) then
      update referral_codes set code = n where owner = me;
    else
      insert into referral_codes (code, owner) values (n, me);
    end if;
  exception when unique_violation then
    raise exception 'That username is taken. Try another.' using errcode = '23505';
  end;
  return my_username();
end $$;

-- Add a friend by their username: sends the usual friend request. Limited to 30 tries an hour, and an
-- unknown, blocked or suspended username all give the same answer.
create function public.add_friend_by_username(p_username text) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  n text := lower(btrim(regexp_replace(coalesce(p_username, ''), '^\s*@', '')));
  other uuid;
  h text;
  conv uuid;
  c dating_conversations%rowtype;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from dating_profiles where user_id = me) then raise exception 'Create your profile first.' using errcode = '28000'; end if;
  if dating_is_suspended(me) then raise exception 'Your profile is suspended.' using errcode = '42501'; end if;
  if (select count(*) from username_lookups where user_id = me and at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many tries. Please wait a while and try again.' using errcode = 'P0001';
  end if;
  insert into username_lookups (user_id) values (me);
  delete from username_lookups where user_id = me and at < now() - interval '1 day';
  select u.user_id, p.handle into other, h from usernames u join dating_profiles p on p.user_id = u.user_id
  where u.username = n and not p.suspended;
  if other = me then raise exception 'That’s your own username.' using errcode = '22023'; end if;
  if other is null or dating_is_blocked(me, other) then
    raise exception 'No one on treehouse has that username.' using errcode = 'P0002';
  end if;
  conv := start_friend_request(h);
  select * into c from dating_conversations where id = conv;
  return jsonb_build_object('conversation_id', conv, 'handle', h,
    'status', case when c.kind = 'friend' and c.accepted_at is not null then 'friends'
                   when c.kind = 'friend' and c.started_by = me then 'sent'
                   when c.kind = 'friend' then 'they_asked'
                   else 'chatting' end);
end $$;

-- Once both have revealed in a chat, they also see each other's username.
drop function public.revealed_details(uuid);
create function public.revealed_details(p_conversation uuid)
returns table (name text, handle text, username text)
language sql stable security definer set search_path = public, dating_private as $$
  select p.name, p.handle, u.username
  from dating_profiles p
  left join usernames u on u.user_id = p.user_id
  where dating_is_participant(p_conversation, auth.uid())
    and dating_both_revealed(p_conversation)
    and p.user_id = dating_partner(p_conversation, auth.uid());
$$;

-- My invite link: needs a username first (the code is the username).
create or replace function public.my_referral() returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); n text; c text;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from dating_profiles where user_id = me and not suspended) then return null; end if;
  select username into n from usernames where user_id = me;
  if n is null then
    return jsonb_build_object('code', null, 'needs_username', true,
      'enabled', coalesce(setting('referrals_enabled'), 'true'::jsonb) = 'true'::jsonb, 'active', true, 'joined', 0);
  end if;
  select code into c from referral_codes where owner = me;
  if c is null then
    insert into referral_codes (code, owner) values (n, me) on conflict do nothing;
  elsif c <> n then
    update referral_codes set code = n where owner = me;
  end if;
  return jsonb_build_object('code', n, 'needs_username', false,
    'enabled', coalesce(setting('referrals_enabled'), 'true'::jsonb) = 'true'::jsonb,
    'active', (select active from referral_codes where code = n),
    'joined', (select count(*) from referrals where code = n));
end $$;

-- Campaign codes can't take a member's username (or one being held after a change).
create or replace function public.staff_referral_campaign(p_code text, p_campaign text, p_note text default '', p_active boolean default true)
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); c text := lower(btrim(coalesce(p_code, '')));
begin
  perform staff_need('manage');
  if c !~ '^[a-z0-9]{4,24}$' then raise exception 'Codes are 4 to 24 letters or numbers.' using errcode = '22023'; end if;
  if exists (select 1 from referral_codes where code = c and owner is not null)
     or exists (select 1 from usernames where username = c)
     or exists (select 1 from username_holds where username = c and released_at > now() - interval '30 days') then
    raise exception 'A member already uses that code.' using errcode = '23505';
  end if;
  insert into referral_codes (code, campaign, note, active, created_by) values (c, btrim(p_campaign), btrim(coalesce(p_note, '')), coalesce(p_active, true), me)
  on conflict (code) do update set campaign = excluded.campaign, note = excluded.note, active = excluded.active;
  perform staff_log(me, 'referral_campaign_saved', 'referral_code', c, jsonb_build_object('campaign', p_campaign, 'active', p_active));
end $$;

revoke all on function dating_private.username_problem(text, uuid) from public, anon, authenticated;
revoke all on function public.check_username(text), public.my_username(), public.set_username(text),
  public.add_friend_by_username(text), public.revealed_details(uuid), public.my_referral() from public, anon;
grant execute on function public.check_username(text), public.my_username(), public.set_username(text),
  public.add_friend_by_username(text), public.revealed_details(uuid), public.my_referral() to authenticated;
