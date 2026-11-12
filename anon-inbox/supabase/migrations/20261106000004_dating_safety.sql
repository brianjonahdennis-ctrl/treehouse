-- Safety: suspensions, unblocking, and a moderation API for the site owner.

-- ---------------------------------------------------------------------------
-- Suspensions (set by the owner; users cannot change this column)
-- ---------------------------------------------------------------------------
alter table public.dating_profiles add column suspended boolean not null default false;

create function dating_private.dating_is_suspended(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select suspended from dating_profiles where user_id = uid), false);
$$;
revoke execute on function dating_private.dating_is_suspended(uuid) from public, anon;
grant execute on function dating_private.dating_is_suspended(uuid) to authenticated;

-- Suspended people can't send messages.
drop policy "Participants send messages unless blocked" on public.dating_messages;
create policy "Participants send messages unless blocked or suspended" on public.dating_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and dating_private.dating_is_participant(conversation_id, (select auth.uid()))
    and not dating_private.dating_is_blocked((select auth.uid()), dating_private.dating_partner(conversation_id, (select auth.uid())))
    and not dating_private.dating_is_suspended((select auth.uid()))
  );

-- Suspended profiles disappear from dating cards and can't start chats.
create or replace function public.discover_profiles(p_limit int default 30)
returns table (handle text, gender public.dating_gender, age int, location text, intent public.dating_intent)
language sql stable security definer set search_path = public, dating_private as $$
  select p.handle, p.gender, p.age, p.location, p.intent
  from dating_profiles p
  where p.is_active and not p.suspended
    and p.user_id is distinct from auth.uid()
    and (auth.uid() is null or not dating_is_blocked(auth.uid(), p.user_id))
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 30), 1), 100);
$$;

create or replace function public.start_conversation(p_handle text) returns uuid
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  other uuid;
  conv uuid;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from dating_profiles where user_id = uid) then
    raise exception 'Create your dating profile first.' using errcode = '28000';
  end if;
  if dating_is_suspended(uid) then raise exception 'Your dating profile is suspended.' using errcode = '42501'; end if;
  select user_id into other from dating_profiles where handle = p_handle and is_active and not suspended;
  if other is null or other = uid or dating_is_blocked(uid, other) then
    raise exception 'That profile is not available.' using errcode = 'P0002';
  end if;
  insert into dating_conversations (user_a, user_b)
  values (least(uid, other), greatest(uid, other))
  on conflict (user_a, user_b) do update set user_a = excluded.user_a
  returning id into conv;
  return conv;
end $$;

-- ---------------------------------------------------------------------------
-- Unblock (the blocked person's id isn't known to the app, so go via the chat)
-- ---------------------------------------------------------------------------
create function public.unblock_conversation_partner(p_conversation uuid) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  other uuid := dating_partner(p_conversation, auth.uid());
begin
  if other is null then raise exception 'Conversation not found.' using errcode = 'P0002'; end if;
  delete from dating_blocks where blocker_id = auth.uid() and blocked_id = other;
end $$;
revoke execute on function public.unblock_conversation_partner(uuid) from public, anon;
grant execute on function public.unblock_conversation_partner(uuid) to authenticated;

-- Chat list: also say whether *I* blocked them (to offer Unblock) and whether they're suspended.
drop function public.my_conversations();
create function public.my_conversations()
returns table (
  conversation_id uuid, other_handle text, other_gender public.dating_gender, other_age int,
  other_location text, other_intent public.dating_intent, last_message text, last_from_me boolean,
  last_at timestamptz, unread int, i_revealed boolean, they_revealed boolean, blocked boolean, i_blocked boolean
)
language sql stable security definer set search_path = public, dating_private as $$
  select c.id,
         p.handle, p.gender, p.age, p.location, p.intent,
         m.body, m.sender_id = auth.uid(), coalesce(m.created_at, c.created_at),
         (select count(*)::int from dating_messages x
           where x.conversation_id = c.id and x.sender_id = o.uid
             and x.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)),
         exists (select 1 from dating_reveals v where v.conversation_id = c.id and v.user_id = auth.uid()),
         exists (select 1 from dating_reveals v where v.conversation_id = c.id and v.user_id = o.uid),
         dating_is_blocked(auth.uid(), o.uid) or coalesce(p.suspended, false),
         exists (select 1 from dating_blocks b where b.blocker_id = auth.uid() and b.blocked_id = o.uid)
  from dating_conversations c
  cross join lateral (select case when c.user_a = auth.uid() then c.user_b else c.user_a end as uid) o
  left join dating_profiles p on p.user_id = o.uid
  left join dating_reads r on r.conversation_id = c.id and r.user_id = auth.uid()
  left join lateral (
    select body, sender_id, created_at from dating_messages where conversation_id = c.id order by created_at desc, id desc limit 1
  ) m on true
  where auth.uid() in (c.user_a, c.user_b)
  order by coalesce(m.created_at, c.created_at) desc;
$$;
revoke execute on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

-- ---------------------------------------------------------------------------
-- Moderation API for the site owner.
-- The Tell Hydra server holds an admin key; only its SHA-256 fingerprint is stored here.
-- These functions show handles and the reported chat - never names or emails.
-- ---------------------------------------------------------------------------
create table dating_private.admin_key (fingerprint text primary key);
insert into dating_private.admin_key values ('7b804684d707b314ed2997bd593ea26cdf3e8dc4a7bb7a0314aa91628fa79370');
revoke all on dating_private.admin_key from public, anon, authenticated;

create function dating_private.admin_ok(p_key text) returns boolean
language sql stable security definer set search_path = dating_private, extensions as $$
  select exists (select 1 from admin_key where fingerprint = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex'));
$$;

create function public.admin_dating_reports(p_key text, p_status text default 'open')
returns table (
  id bigint, created_at timestamptz, status text, reason text, details text,
  reporter_handle text, reported_handle text, reported_suspended boolean, reports_against int, recent_messages jsonb
)
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  if not dating_private.admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query
  select r.id, r.created_at, r.status, r.reason, r.details,
         coalesce(rp.handle, 'Deleted profile'), coalesce(dp.handle, 'Deleted profile'), coalesce(dp.suspended, false),
         (select count(*)::int from dating_reports x where x.reported_id = r.reported_id),
         coalesce((
           select jsonb_agg(jsonb_build_object('from', case when m.sender_id = r.reported_id then 'reported' else 'reporter' end,
                                               'body', m.body, 'at', m.created_at) order by m.created_at)
           from (select * from dating_messages where conversation_id = r.conversation_id order by created_at desc limit 30) m
         ), '[]'::jsonb)
  from dating_reports r
  left join dating_profiles rp on rp.user_id = r.reporter_id
  left join dating_profiles dp on dp.user_id = r.reported_id
  where p_status = 'all' or r.status = p_status
  order by r.created_at desc
  limit 200;
end $$;

create function public.admin_set_report_status(p_key text, p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if not dating_private.admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  update dating_reports set status = p_status where id = p_id;
end $$;

-- Suspend (or restore) the person a report is about.
create function public.admin_suspend_reported(p_key text, p_report bigint, p_suspend boolean) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if not dating_private.admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  update dating_profiles set suspended = p_suspend
  where user_id = (select reported_id from dating_reports where id = p_report);
  if p_suspend then update dating_reports set status = 'actioned' where id = p_report; end if;
end $$;

revoke execute on function public.admin_dating_reports(text, text), public.admin_set_report_status(text, bigint, text),
  public.admin_suspend_reported(text, bigint, boolean), dating_private.admin_ok(text) from public;
-- The server calls these with the public key, so anon may call them; the admin key is what authorises.
grant execute on function public.admin_dating_reports(text, text), public.admin_set_report_status(text, bigint, text),
  public.admin_suspend_reported(text, bigint, boolean) to anon, authenticated;
