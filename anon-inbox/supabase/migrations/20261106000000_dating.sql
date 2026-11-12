-- Tell Hydra: anonymous dating
--
-- Privacy model
--   * Names live only in dating_profiles, which nobody but the owner can read directly.
--   * Other people only ever see profiles through discover_profiles() / my_conversations(),
--     which return the anonymous handle, gender, age, location and intent - never the name.
--   * A name is released only by revealed_details(), and only when BOTH people in the chat
--     have an active reveal request.
--   * Emails stay in auth.users; nothing in the public schema reads or returns them.
--   * Writes that need checks (create profile, start chat, reveal, block, report) go through
--     security-definer functions; the tables themselves don't allow those inserts.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.dating_gender as enum ('male', 'female', 'other');
create type public.dating_intent as enum ('fun', 'love', 'marriage');

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.dating_profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  gender      public.dating_gender not null,
  age         int not null check (age between 18 and 120),          -- 18+ enforced by the database
  location    text not null default '' check (char_length(location) <= 80),
  intent      public.dating_intent not null,
  handle      text not null unique,
  is_active   boolean not null default true,                         -- false = paused (hidden from discovery)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.dating_profiles enable row level security;

create policy "Owners read their own profile"
  on public.dating_profiles for select to authenticated
  using (user_id = auth.uid());

create policy "Owners update their own profile"
  on public.dating_profiles for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Owners delete their own profile"
  on public.dating_profiles for delete to authenticated
  using (user_id = auth.uid());

-- No insert policy: profiles are created by create_my_profile() after email verification.
-- Owners may edit only these columns (not their handle or user id).
revoke all on public.dating_profiles from anon, authenticated;
grant select, delete on public.dating_profiles to authenticated;
grant update (name, gender, age, location, intent, is_active) on public.dating_profiles to authenticated;

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger dating_profiles_touch before update on public.dating_profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Conversations, messages, reveals, blocks, reports
-- ---------------------------------------------------------------------------
create table public.dating_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_a      uuid not null references auth.users (id) on delete cascade,
  user_b      uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  check (user_a < user_b),               -- one row per pair, stored in a fixed order
  unique (user_a, user_b)
);

create table public.dating_messages (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references public.dating_conversations (id) on delete cascade,
  sender_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body             text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at       timestamptz not null default now()
);
create index dating_messages_conversation on public.dating_messages (conversation_id, created_at);
create index dating_messages_sender_recent on public.dating_messages (sender_id, created_at);

create table public.dating_reveals (
  conversation_id  uuid not null references public.dating_conversations (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table public.dating_blocks (
  blocker_id  uuid not null references auth.users (id) on delete cascade,
  blocked_id  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.dating_reports (
  id               bigint generated always as identity primary key,
  reporter_id      uuid not null references auth.users (id) on delete cascade,
  reported_id      uuid not null references auth.users (id) on delete cascade,
  conversation_id  uuid references public.dating_conversations (id) on delete set null,
  reason           text not null check (reason in ('harassment', 'spam', 'fake', 'underage', 'inappropriate', 'other')),
  details          text not null default '' check (char_length(details) <= 1000),
  status           text not null default 'open' check (status in ('open', 'reviewed', 'actioned')),
  created_at       timestamptz not null default now()
);

alter table public.dating_conversations enable row level security;
alter table public.dating_messages      enable row level security;
alter table public.dating_reveals       enable row level security;
alter table public.dating_blocks        enable row level security;
alter table public.dating_reports       enable row level security;

revoke all on public.dating_conversations, public.dating_messages, public.dating_reveals,
              public.dating_blocks, public.dating_reports from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (security definer so policies can use them without recursion)
-- ---------------------------------------------------------------------------
create function public.dating_is_participant(conv uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from dating_conversations c where c.id = conv and uid in (c.user_a, c.user_b));
$$;

create function public.dating_partner(conv uuid, uid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case when c.user_a = uid then c.user_b when c.user_b = uid then c.user_a end
  from dating_conversations c where c.id = conv;
$$;

create function public.dating_is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from dating_blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;

create function public.dating_both_revealed(conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select count(*) = 2 from dating_reveals r
  join dating_conversations c on c.id = r.conversation_id
  where r.conversation_id = conv and r.user_id in (c.user_a, c.user_b);
$$;

revoke execute on function public.dating_is_participant(uuid, uuid), public.dating_partner(uuid, uuid),
  public.dating_is_blocked(uuid, uuid), public.dating_both_revealed(uuid) from public, anon;
grant execute on function public.dating_is_participant(uuid, uuid), public.dating_partner(uuid, uuid),
  public.dating_is_blocked(uuid, uuid), public.dating_both_revealed(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security for chat tables
-- ---------------------------------------------------------------------------
create policy "Participants read their conversations"
  on public.dating_conversations for select to authenticated
  using (auth.uid() in (user_a, user_b));
grant select on public.dating_conversations to authenticated;

create policy "Participants read messages"
  on public.dating_messages for select to authenticated
  using (public.dating_is_participant(conversation_id, auth.uid()));

create policy "Participants send messages unless blocked"
  on public.dating_messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.dating_is_participant(conversation_id, auth.uid())
    and not public.dating_is_blocked(auth.uid(), public.dating_partner(conversation_id, auth.uid()))
  );
grant select, insert (conversation_id, body) on public.dating_messages to authenticated;
grant usage on all sequences in schema public to authenticated;

create policy "Participants see reveal requests"
  on public.dating_reveals for select to authenticated
  using (public.dating_is_participant(conversation_id, auth.uid()));

create policy "Participants ask to reveal"
  on public.dating_reveals for insert to authenticated
  with check (user_id = auth.uid() and public.dating_is_participant(conversation_id, auth.uid()));

-- A reveal can be cancelled only until the other person has also agreed.
create policy "Cancel own reveal before it is mutual"
  on public.dating_reveals for delete to authenticated
  using (user_id = auth.uid() and not public.dating_both_revealed(conversation_id));
grant select, insert (conversation_id), delete on public.dating_reveals to authenticated;
alter table public.dating_reveals alter column user_id set default auth.uid();

create policy "Users see who they blocked"
  on public.dating_blocks for select to authenticated
  using (blocker_id = auth.uid());
create policy "Users unblock"
  on public.dating_blocks for delete to authenticated
  using (blocker_id = auth.uid());
grant select, delete on public.dating_blocks to authenticated;

create policy "Reporters see their own reports"
  on public.dating_reports for select to authenticated
  using (reporter_id = auth.uid());
grant select on public.dating_reports to authenticated;

-- ---------------------------------------------------------------------------
-- Rate limits
-- ---------------------------------------------------------------------------
create function public.dating_message_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from dating_messages
      where sender_id = new.sender_id and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Slow down - too many messages. Try again in a minute.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger dating_messages_rate_limit before insert on public.dating_messages
  for each row execute function public.dating_message_rate_limit();

-- ---------------------------------------------------------------------------
-- Handles like "Quiet Falcon 214"
-- ---------------------------------------------------------------------------
create function public.dating_new_handle() returns text
language plpgsql volatile set search_path = public as $$
declare
  adjectives text[] := array['Quiet','Bold','Golden','Silver','Gentle','Brave','Calm','Bright','Lucky','Swift',
    'Clever','Kind','Wild','Sunny','Misty','Velvet','Cosmic','Hidden','Secret','Mellow','Rosy','Noble','Witty','Dreamy'];
  animals text[] := array['Falcon','Panther','Dove','Lion','Fox','Owl','Tiger','Swan','Leopard','Eagle','Dolphin',
    'Gazelle','Hawk','Wolf','Robin','Lynx','Heron','Otter','Raven','Zebra','Cheetah','Sparrow','Koi','Jaguar'];
  candidate text;
begin
  loop
    candidate := adjectives[1 + floor(random() * array_length(adjectives, 1))::int] || ' ' ||
                 animals[1 + floor(random() * array_length(animals, 1))::int] || ' ' ||
                 (100 + floor(random() * 900))::int;
    exit when not exists (select 1 from dating_profiles where handle = candidate);
  end loop;
  return candidate;
end $$;
revoke execute on function public.dating_new_handle() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Actions (called from the app)
-- ---------------------------------------------------------------------------

-- Create the caller's profile. Requires a verified email; 18+ is checked here and by the table.
create function public.create_my_profile(
  p_name text, p_gender public.dating_gender, p_age int, p_location text, p_intent public.dating_intent
) returns table (handle text)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  new_handle text;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from auth.users u where u.id = uid and u.email_confirmed_at is not null) then
    raise exception 'Verify your email first.' using errcode = '28000';
  end if;
  if p_age is null or p_age < 18 then
    raise exception 'You must be 18 or older to use dating.' using errcode = '22023';
  end if;
  if exists (select 1 from dating_profiles where user_id = uid) then
    raise exception 'You already have a dating profile.' using errcode = '23505';
  end if;
  new_handle := dating_new_handle();
  insert into dating_profiles (user_id, name, gender, age, location, intent, handle)
  values (uid, btrim(p_name), p_gender, p_age, btrim(coalesce(p_location, '')), p_intent, new_handle);
  return query select new_handle;
end $$;

-- Public dating cards. Never returns name, email or user id.
create function public.discover_profiles(p_limit int default 30)
returns table (handle text, gender public.dating_gender, age int, location text, intent public.dating_intent)
language sql stable security definer set search_path = public as $$
  select p.handle, p.gender, p.age, p.location, p.intent
  from dating_profiles p
  where p.is_active
    and p.user_id is distinct from auth.uid()
    and (auth.uid() is null or not dating_is_blocked(auth.uid(), p.user_id))
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

-- Start (or reopen) a chat with the person behind a handle. Both sides need a profile.
create function public.start_conversation(p_handle text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  other uuid;
  conv uuid;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from dating_profiles where user_id = uid) then
    raise exception 'Create your dating profile first.' using errcode = '28000';
  end if;
  select user_id into other from dating_profiles where handle = p_handle and is_active;
  if other is null or other = uid then raise exception 'That profile is not available.' using errcode = 'P0002'; end if;
  if dating_is_blocked(uid, other) then raise exception 'That profile is not available.' using errcode = 'P0002'; end if;
  insert into dating_conversations (user_a, user_b)
  values (least(uid, other), greatest(uid, other))
  on conflict (user_a, user_b) do update set user_a = excluded.user_a
  returning id into conv;
  return conv;
end $$;

-- The caller's chats with the other person's anonymous card, last message and reveal state.
create function public.my_conversations()
returns table (
  conversation_id uuid, other_handle text, other_gender public.dating_gender, other_age int,
  other_location text, other_intent public.dating_intent, last_message text, last_at timestamptz,
  i_revealed boolean, they_revealed boolean, blocked boolean
)
language sql stable security definer set search_path = public as $$
  select c.id,
         p.handle, p.gender, p.age, p.location, p.intent,
         m.body, coalesce(m.created_at, c.created_at),
         exists (select 1 from dating_reveals r where r.conversation_id = c.id and r.user_id = auth.uid()),
         exists (select 1 from dating_reveals r where r.conversation_id = c.id and r.user_id = o.uid),
         dating_is_blocked(auth.uid(), o.uid)
  from dating_conversations c
  cross join lateral (select case when c.user_a = auth.uid() then c.user_b else c.user_a end as uid) o
  left join dating_profiles p on p.user_id = o.uid
  left join lateral (
    select body, created_at from dating_messages where conversation_id = c.id order by created_at desc limit 1
  ) m on true
  where auth.uid() in (c.user_a, c.user_b)
  order by coalesce(m.created_at, c.created_at) desc;
$$;

-- The other person's name, only once BOTH have agreed to reveal. Otherwise returns no rows.
create function public.revealed_details(p_conversation uuid)
returns table (name text, handle text)
language sql stable security definer set search_path = public as $$
  select p.name, p.handle
  from dating_profiles p
  where dating_is_participant(p_conversation, auth.uid())
    and dating_both_revealed(p_conversation)
    and p.user_id = dating_partner(p_conversation, auth.uid());
$$;

-- Block the other person in a chat: they can no longer message you or see your card.
create function public.block_conversation_partner(p_conversation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  other uuid := dating_partner(p_conversation, auth.uid());
begin
  if other is null then raise exception 'Conversation not found.' using errcode = 'P0002'; end if;
  insert into dating_blocks (blocker_id, blocked_id) values (auth.uid(), other) on conflict do nothing;
end $$;

-- Report the other person in a chat.
create function public.report_conversation_partner(p_conversation uuid, p_reason text, p_details text default '')
returns void
language plpgsql security definer set search_path = public as $$
declare
  other uuid := dating_partner(p_conversation, auth.uid());
begin
  if other is null then raise exception 'Conversation not found.' using errcode = 'P0002'; end if;
  if (select count(*) from dating_reports where reporter_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many reports. Try again later.' using errcode = 'P0001';
  end if;
  insert into dating_reports (reporter_id, reported_id, conversation_id, reason, details)
  values (auth.uid(), other, p_conversation, p_reason, left(coalesce(p_details, ''), 1000));
end $$;

revoke execute on function
  public.create_my_profile(text, public.dating_gender, int, text, public.dating_intent),
  public.discover_profiles(int), public.start_conversation(text), public.my_conversations(),
  public.revealed_details(uuid), public.block_conversation_partner(uuid),
  public.report_conversation_partner(uuid, text, text)
from public, anon;

grant execute on function
  public.create_my_profile(text, public.dating_gender, int, text, public.dating_intent),
  public.discover_profiles(int), public.start_conversation(text), public.my_conversations(),
  public.revealed_details(uuid), public.block_conversation_partner(uuid),
  public.report_conversation_partner(uuid, text, text)
to authenticated;

-- Visitors who aren't signed in can browse cards too.
grant execute on function public.discover_profiles(int) to anon;

-- ---------------------------------------------------------------------------
-- Realtime: chat messages and reveal requests (realtime respects the policies above)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.dating_messages, public.dating_reveals;
