-- Tell Hydra for everyone: personal anonymous-message links (NGL style).
--
-- Privacy model
--   * Senders are anonymous: no account, nothing about them is stored, times rounded to the hour.
--   * Only the owner can read, mark or delete their messages (row-level security).
--   * A link (public @username + display name) and a dating profile (anonymous handle + private
--     name) may belong to the same account, but nothing returns both, so they can't be connected.
--   * Sending goes through send_link_message(), which checks the link, the length and a per-link
--     rate limit, and keeps only the newest 100 messages per inbox.

-- ---------------------------------------------------------------------------
-- Links
-- ---------------------------------------------------------------------------
create table public.links (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  username      text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name  text not null check (char_length(btrim(display_name)) between 1 and 40),
  prompt        text not null default 'send me anonymous messages!' check (char_length(btrim(prompt)) between 1 and 120),
  is_active     boolean not null default true,     -- false = paused (link stops accepting messages)
  suspended     boolean not null default false,    -- set by the site owner only
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.links enable row level security;
revoke all on public.links from anon, authenticated;

create policy "Owners read their own link" on public.links for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners update their own link" on public.links for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on public.links to authenticated;
grant update (display_name, prompt, is_active) on public.links to authenticated;   -- not username/suspended

create trigger links_touch before update on public.links
  for each row execute function dating_private.touch_updated_at();

-- Words that can't be usernames (site paths, staff-sounding names, the owner's names).
create table dating_private.reserved_usernames (username text primary key);
insert into dating_private.reserved_usernames (username) values
  ('app'), ('api'), ('admin'), ('administrator'), ('date'), ('dating'), ('go'), ('u'), ('www'), ('mail'),
  ('support'), ('help'), ('about'), ('privacy'), ('terms'), ('login'), ('signup'), ('settings'), ('inbox'),
  ('stats'), ('reports'), ('official'), ('staff'), ('moderator'), ('mod'), ('team'), ('root'), ('null'),
  ('brian'), ('brianjonahdennis'), ('hydra'), ('tellhydra'), ('tell_hydra'), ('tell');
revoke all on dating_private.reserved_usernames from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
create table public.link_messages (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null references public.links (user_id) on delete cascade,
  prompt      text not null default '',
  body        text not null check (char_length(btrim(body)) between 1 and 250),
  created_at  timestamptz not null default date_trunc('hour', now()),   -- rounded: protects senders
  is_read     boolean not null default false
);
create index link_messages_owner on public.link_messages (owner_id, id desc);
alter table public.link_messages enable row level security;
revoke all on public.link_messages from anon, authenticated;

create policy "Owners read their messages" on public.link_messages for select to authenticated
  using (owner_id = (select auth.uid()));
create policy "Owners mark their messages" on public.link_messages for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "Owners delete their messages" on public.link_messages for delete to authenticated
  using (owner_id = (select auth.uid()));
grant select, delete on public.link_messages to authenticated;
grant update (is_read) on public.link_messages to authenticated;

-- Live updates for the owner's inbox (row-level security applies).
alter publication supabase_realtime add table public.link_messages;

-- Reports: the owner flags an abusive message for the site owner to review.
-- The text is copied so the report survives if the message is deleted.
create table public.link_reports (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null references public.links (user_id) on delete cascade,
  message_id  bigint references public.link_messages (id) on delete set null,
  body        text not null,
  reason      text not null check (reason in ('harassment', 'threat', 'hate', 'sexual', 'spam', 'self_harm', 'other')),
  status      text not null default 'open' check (status in ('open', 'reviewed', 'actioned')),
  created_at  timestamptz not null default now()
);
alter table public.link_reports enable row level security;
revoke all on public.link_reports from anon, authenticated;
create policy "Owners see their reports" on public.link_reports for select to authenticated
  using (owner_id = (select auth.uid()));
grant select on public.link_reports to authenticated;

-- Per-link send log for rate limiting: only a counter per link per minute, nothing about senders.
create table dating_private.link_send_counts (
  owner_id  uuid not null references public.links (user_id) on delete cascade,
  minute    timestamptz not null,
  n         int not null default 0,
  primary key (owner_id, minute)
);
revoke all on dating_private.link_send_counts from public, anon, authenticated;

-- Owners can delete their own link (and with it, all its messages).
create policy "Owners delete their own link" on public.links for delete to authenticated
  using (user_id = (select auth.uid()));
grant delete on public.links to authenticated;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- Claim a username. Needs a verified email; one link per account.
create function public.claim_link(p_username text, p_display_name text, p_prompt text default null)
returns text
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  name text := lower(btrim(coalesce(p_username, '')));
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from auth.users u where u.id = uid and u.email_confirmed_at is not null) then
    raise exception 'Verify your email first.' using errcode = '28000';
  end if;
  if exists (select 1 from links where user_id = uid) then
    raise exception 'You already have a link.' using errcode = '23505';
  end if;
  if name !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Usernames are 3-20 characters: letters, numbers and underscores.' using errcode = '22023';
  end if;
  if exists (select 1 from reserved_usernames r where r.username = name) or exists (select 1 from links where username = name) then
    raise exception 'That username is taken.' using errcode = '23505';
  end if;
  insert into links (user_id, username, display_name, prompt)
  values (uid, name, btrim(p_display_name), coalesce(nullif(btrim(coalesce(p_prompt, '')), ''), 'send me anonymous messages!'));
  return name;
end $$;

-- Is a username free? (For the sign-up form; doesn't reveal anything else.)
create function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = public, dating_private as $$
  select lower(btrim(coalesce(p_username, ''))) ~ '^[a-z0-9_]{3,20}$'
     and not exists (select 1 from reserved_usernames r where r.username = lower(btrim(p_username)))
     and not exists (select 1 from links l where l.username = lower(btrim(p_username)));
$$;

-- What a public link page shows: username, display name and prompt. Nothing else.
create function public.public_link(p_username text)
returns table (username text, display_name text, prompt text)
language sql stable security definer set search_path = public as $$
  select l.username, l.display_name, l.prompt from links l
  where l.username = lower(btrim(coalesce(p_username, ''))) and l.is_active and not l.suspended;
$$;

-- Send an anonymous message to a link. No account needed; nothing about the sender is stored.
create function public.send_link_message(p_username text, p_body text) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  target links%rowtype;
  body text := btrim(coalesce(p_body, ''));
  this_minute timestamptz := date_trunc('minute', now());
  sent int;
begin
  select * into target from links where username = lower(btrim(coalesce(p_username, ''))) and is_active and not suspended;
  if target.user_id is null then raise exception 'This link isn''t taking messages.' using errcode = 'P0002'; end if;
  if char_length(body) < 1 or char_length(body) > 250 then
    raise exception 'Messages can be 1 to 250 characters.' using errcode = '22023';
  end if;
  -- Per-link limit: 30 messages a minute, 300 an hour (protects inboxes from floods).
  insert into link_send_counts (owner_id, minute, n) values (target.user_id, this_minute, 1)
  on conflict (owner_id, minute) do update set n = link_send_counts.n + 1
  returning n into sent;
  if sent > 30 or (select coalesce(sum(n), 0) from link_send_counts
                   where owner_id = target.user_id and minute > now() - interval '1 hour') > 300 then
    raise exception 'This inbox is getting too many messages. Try again in a few minutes.' using errcode = 'P0001';
  end if;
  delete from link_send_counts where owner_id = target.user_id and minute < now() - interval '2 hours';

  insert into link_messages (owner_id, prompt, body) values (target.user_id, target.prompt, body);
  -- Keep only the newest 100 messages in each inbox.
  delete from link_messages where owner_id = target.user_id
    and id < (select min(id) from (select id from link_messages where owner_id = target.user_id order by id desc limit 100) newest);
end $$;

-- The owner reports a message they received.
create function public.report_link_message(p_message bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  m link_messages%rowtype;
begin
  select * into m from link_messages where id = p_message and owner_id = auth.uid();
  if m.id is null then raise exception 'Message not found.' using errcode = 'P0002'; end if;
  if (select count(*) from link_reports where owner_id = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many reports. Try again later.' using errcode = 'P0001';
  end if;
  insert into link_reports (owner_id, message_id, body, reason) values (auth.uid(), m.id, m.body, p_reason);
end $$;

revoke execute on function public.claim_link(text, text, text), public.username_available(text), public.public_link(text),
  public.send_link_message(text, text), public.report_link_message(bigint, text) from public;
grant execute on function public.claim_link(text, text, text), public.report_link_message(bigint, text) to authenticated;
grant execute on function public.username_available(text), public.public_link(text), public.send_link_message(text, text)
  to anon, authenticated;
