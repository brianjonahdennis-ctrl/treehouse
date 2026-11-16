-- Audio and video calls in private chats (Hydra, 16 Nov 2026).
-- * Who can call: the two people in an accepted private chat, once they have exchanged at least 20
--   genuine messages between them (combined; deleted messages and repeats of the same text by the same
--   person don't count; call records are never messages). This rule is internal: the app only learns
--   "calls available: yes/no" and errors never mention it.
-- * Blocks, suspensions and closed chats stop calls. One call at a time per person ("busy").
-- * Calls go phone to phone (WebRTC), through Cloudflare's relay when needed. Nothing is recorded.
--   The database only keeps who called whom, when, how long, and the outcome.
-- * Call setup messages go through call_signal() (kept 1 hour, then deleted) and are forwarded on the
--   private live channel call:<id>, readable only by the two people in that call.
-- * Ringing that isn't answered in 40 s becomes a missed call; a live call whose phones stop checking in
--   for 45 s is ended. Both run every 15 s.

set lock_timeout = '5s';

create table if not exists public.dating_calls (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dating_conversations (id) on delete cascade,
  caller          uuid not null references auth.users (id) on delete cascade,
  callee          uuid not null references auth.users (id) on delete cascade,
  kind            text not null check (kind in ('audio', 'video')),
  status          text not null default 'ringing'
                  check (status in ('ringing', 'active', 'ended', 'missed', 'declined', 'cancelled', 'busy', 'failed')),
  created_at      timestamptz not null default now(),
  answered_at     timestamptz,
  ended_at        timestamptz,
  end_reason      text,
  caller_beat     timestamptz not null default now(),
  callee_beat     timestamptz,
  check (caller <> callee)
);
create index if not exists dating_calls_conv on public.dating_calls (conversation_id, created_at desc);
create index if not exists dating_calls_open on public.dating_calls (status) where status in ('ringing', 'active');
create index if not exists dating_calls_caller on public.dating_calls (caller, created_at desc);
create index if not exists dating_calls_callee on public.dating_calls (callee, created_at desc);
alter table public.dating_calls enable row level security;
revoke all on public.dating_calls from public, anon, authenticated;

create table if not exists dating_private.call_signals (
  id         bigserial primary key,
  call_id    uuid not null references public.dating_calls (id) on delete cascade,
  sender     uuid not null,
  data       jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists call_signals_call on dating_private.call_signals (call_id, id);
revoke all on dating_private.call_signals from public, anon, authenticated;

-- Push kinds for calls.
alter table dating_private.push_outbox drop constraint if exists push_outbox_kind_check;
alter table dating_private.push_outbox add constraint push_outbox_kind_check
  check (kind in ('message', 'chat', 'request', 'like', 'match', 'announcement', 'friend', 'call', 'missed_call')) not valid;

-- ---- Eligibility (internal) ---------------------------------------------------------------------------
create or replace function dating_private.call_eligible(p_conversation uuid, p_me uuid) returns boolean
language sql stable security definer set search_path = public, dating_private as $$
  select exists (
    select 1 from dating_conversations c
    where c.id = p_conversation and p_me in (c.user_a, c.user_b)
      and c.accepted_at is not null and c.declined_at is null
      and not dating_is_blocked(c.user_a, c.user_b)
      and not dating_is_suspended(c.user_a) and not dating_is_suspended(c.user_b)
      and (select count(*) from (
             select distinct m.sender_id, coalesce(m.voice, m.photo, lower(btrim(m.body)))
             from dating_messages m
             where m.conversation_id = c.id and m.deleted_at is null and m.sender_id in (c.user_a, c.user_b)
               and m.created_at > coalesce((select d.cleared_at from dating_cleared d where d.conversation_id = c.id and d.user_id = p_me), '-infinity'::timestamptz)
               and coalesce(m.voice, m.photo, nullif(btrim(m.body), '')) is not null
             limit 20) x) >= 20)
$$;
revoke all on function dating_private.call_eligible(uuid, uuid) from public, anon, authenticated;

-- What the app asks: can I call in this chat? (yes/no only)
create or replace function public.call_available(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public, dating_private as $$
  select auth.uid() is not null and call_eligible(p_conversation, auth.uid())
$$;

-- ---- Helpers ----------------------------------------------------------------------------------------
create or replace function dating_private.call_busy(p_user uuid) returns boolean
language sql stable security definer set search_path = public, dating_private as $$
  select exists (select 1 from dating_calls k where k.status in ('ringing', 'active') and p_user in (k.caller, k.callee)
                   and (k.status = 'ringing' and k.created_at > now() - interval '45 seconds'
                        or k.status = 'active' and greatest(k.caller_beat, coalesce(k.callee_beat, k.caller_beat)) > now() - interval '45 seconds'))
$$;

create or replace function dating_private.call_view(k public.dating_calls, p_me uuid) returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select jsonb_build_object('id', k.id, 'conversation_id', k.conversation_id, 'kind', k.kind, 'status', k.status,
    'outgoing', k.caller = p_me, 'created_at', k.created_at, 'answered_at', k.answered_at, 'ended_at', k.ended_at,
    'end_reason', k.end_reason, 'now', now(),
    'other_handle', (select p.handle from dating_profiles p where p.user_id = case when k.caller = p_me then k.callee else k.caller end))
$$;

-- Tell both phones the call changed (live channel) and, for the person called, their inbox too.
create or replace function dating_private.call_announce(k public.dating_calls) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  begin
    perform realtime.send(jsonb_build_object('id', k.id, 'status', k.status, 'answered_at', k.answered_at, 'ended_at', k.ended_at, 'end_reason', k.end_reason),
      'state', 'call:' || k.id, true);
    perform realtime.send(jsonb_build_object('k', 'call', 'id', k.id, 'c', k.conversation_id, 'kind', k.kind, 'status', k.status,
      'from', (select p.handle from dating_profiles p where p.user_id = k.caller), 'at', k.created_at),
      'inbox', 'user:' || k.callee, true);
    perform realtime.send(jsonb_build_object('k', 'call', 'id', k.id, 'c', k.conversation_id, 'kind', k.kind, 'status', k.status, 'mine', true),
      'inbox', 'user:' || k.caller, true);
  exception when others then null;   -- a signal must never block the call record
  end;
end $$;

revoke all on function dating_private.call_busy(uuid), dating_private.call_view(public.dating_calls, uuid),
  dating_private.call_announce(public.dating_calls) from public, anon, authenticated;

-- ---- Starting, answering, ending ---------------------------------------------------------------------
create or replace function public.call_start(p_conversation uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); c dating_conversations%rowtype; other uuid; k dating_calls%rowtype;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if p_kind not in ('audio', 'video') then raise exception 'Choose audio or video.' using errcode = '22023'; end if;
  if not call_eligible(p_conversation, me) then raise exception 'Calling isn''t available in this chat.' using errcode = '42501'; end if;
  select * into c from dating_conversations where id = p_conversation;
  other := case when c.user_a = me then c.user_b else c.user_a end;
  if (select count(*) from dating_calls where caller = me and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'You''ve made a lot of calls. Try again a bit later.' using errcode = 'P0001';
  end if;
  -- A call already ringing in this chat (both tapped at once): join it instead of starting a second.
  select * into k from dating_calls where conversation_id = p_conversation and status = 'ringing' and created_at > now() - interval '40 seconds'
  order by created_at desc limit 1;
  if found then return call_view(k, me); end if;
  if call_busy(me) then raise exception 'You''re already in a call.' using errcode = 'P0001'; end if;
  if call_busy(other) then
    insert into dating_calls (conversation_id, caller, callee, kind, status, ended_at, end_reason)
    values (p_conversation, me, other, p_kind, 'busy', now(), 'busy') returning * into k;
    return call_view(k, me);
  end if;
  insert into dating_calls (conversation_id, caller, callee, kind) values (p_conversation, me, other, p_kind) returning * into k;
  perform call_announce(k);
  perform queue_push(other, 'call', '/home/matches/' || p_conversation);
  return call_view(k, me);
end $$;

create or replace function public.call_get(p_call uuid) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); k dating_calls%rowtype;
begin
  select * into k from dating_calls where id = p_call and me in (caller, callee);
  if not found then raise exception 'Call not found.' using errcode = 'P0002'; end if;
  return call_view(k, me);
end $$;

-- The person called: accept or decline. The caller: cancel while ringing. Either: end, or report a failure.
create or replace function public.call_answer(p_call uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); k dating_calls%rowtype;
begin
  select * into k from dating_calls where id = p_call and callee = me for update;
  if not found then raise exception 'Call not found.' using errcode = 'P0002'; end if;
  if k.status <> 'ringing' then return call_view(k, me); end if;
  if p_accept then
    if not call_eligible(k.conversation_id, me) then raise exception 'This call can''t be answered.' using errcode = '42501'; end if;
    update dating_calls set status = 'active', answered_at = now(), callee_beat = now(), caller_beat = greatest(caller_beat, now() - interval '5 seconds')
    where id = k.id returning * into k;
  else
    update dating_calls set status = 'declined', ended_at = now(), end_reason = 'declined' where id = k.id returning * into k;
  end if;
  perform call_announce(k);
  return call_view(k, me);
end $$;

create or replace function public.call_end(p_call uuid, p_reason text default 'hangup') returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); k dating_calls%rowtype; r text := case when p_reason in ('hangup', 'failed', 'permission') then p_reason else 'hangup' end;
begin
  select * into k from dating_calls where id = p_call and me in (caller, callee) for update;
  if not found then raise exception 'Call not found.' using errcode = 'P0002'; end if;
  if k.status = 'ringing' then
    update dating_calls set status = case when r = 'failed' then 'failed' when me = k.caller then 'cancelled' else 'declined' end,
      ended_at = now(), end_reason = r where id = k.id returning * into k;
  elsif k.status = 'active' then
    update dating_calls set status = case when r = 'failed' and k.answered_at > now() - interval '5 seconds' then 'failed' else 'ended' end,
      ended_at = now(), end_reason = r where id = k.id returning * into k;
  else
    return call_view(k, me);
  end if;
  perform call_announce(k);
  return call_view(k, me);
end $$;

-- Each phone checks in every 10 s while ringing or connected.
create or replace function public.call_beat(p_call uuid) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); k dating_calls%rowtype;
begin
  update dating_calls set caller_beat = case when caller = me then now() else caller_beat end,
                          callee_beat = case when callee = me then now() else callee_beat end
  where id = p_call and me in (caller, callee) and status in ('ringing', 'active') returning * into k;
  if not found then select * into k from dating_calls where id = p_call and me in (caller, callee); end if;
  if k.id is null then raise exception 'Call not found.' using errcode = 'P0002'; end if;
  return call_view(k, me);
end $$;

-- Call setup messages (offer, answer, network routes). Kept one hour.
create or replace function public.call_signal(p_call uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); k dating_calls%rowtype; sid bigint;
begin
  select * into k from dating_calls where id = p_call and me in (caller, callee) and status in ('ringing', 'active');
  if not found then raise exception 'Call not found.' using errcode = 'P0002'; end if;
  if octet_length(p_data::text) > 20000 then raise exception 'Too big.' using errcode = '22023'; end if;
  if (select count(*) from call_signals where call_id = k.id) >= 600 then return; end if;   -- runaway guard
  insert into call_signals (call_id, sender, data) values (k.id, me, p_data) returning id into sid;
  begin
    perform realtime.send(jsonb_build_object('id', sid, 'from', case when me = k.caller then 'caller' else 'callee' end, 'data', p_data),
      'signal', 'call:' || k.id, true);
  exception when others then null;   -- the mailbox still has it
  end;
end $$;

-- Backup for the live channel: setup messages from the other phone after a given id.
create or replace function public.call_signals_since(p_call uuid, p_after bigint default 0) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); k dating_calls%rowtype;
begin
  select * into k from dating_calls where id = p_call and me in (caller, callee);
  if not found then raise exception 'Call not found.' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'from', case when s.sender = k.caller then 'caller' else 'callee' end, 'data', s.data) order by s.id)
    from call_signals s where s.call_id = k.id and s.id > coalesce(p_after, 0) and s.sender <> me), '[]'::jsonb);
end $$;

-- Who may receive a call's live channel.
create or replace function public.call_can_listen(p_topic text) returns boolean
language sql stable security definer set search_path = public, dating_private as $$
  select p_topic ~ '^call:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and exists (select 1 from dating_calls k where k.id = substr(p_topic, 6)::uuid and auth.uid() in (k.caller, k.callee))
$$;
drop policy if exists "Callers receive their call's signals" on realtime.messages;
create policy "Callers receive their call's signals" on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and (select realtime.topic()) like 'call:%' and (select public.call_can_listen((select realtime.topic()))));

-- Call records for a chat (newest first), shown between messages. Never counted as messages.
create or replace function public.call_history(p_conversation uuid, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid();
begin
  if me is null or not dating_is_participant(p_conversation, me) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(call_view(k, me) order by k.created_at desc) from (
      select * from dating_calls k
      where k.conversation_id = p_conversation
        and k.created_at > coalesce((select d.cleared_at from dating_cleared d where d.conversation_id = p_conversation and d.user_id = me), '-infinity'::timestamptz)
      order by k.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) k), '[]'::jsonb);
end $$;

-- Any call ringing for me right now (opening the app while someone is calling).
create or replace function public.call_ringing() returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select (select call_view(k, auth.uid()) from dating_calls k
          where k.callee = auth.uid() and k.status = 'ringing' and k.created_at > now() - interval '40 seconds'
          order by k.created_at desc limit 1)
$$;

-- Every 15 s: unanswered → missed; silent live calls → ended; old setup messages → deleted.
create or replace function dating_private.call_sweep() returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare k dating_calls%rowtype;
begin
  for k in update dating_calls set status = 'missed', ended_at = now(), end_reason = 'no_answer'
           where status = 'ringing' and created_at < now() - interval '40 seconds' returning * loop
    perform call_announce(k);
    perform queue_push(k.callee, 'missed_call', '/home/matches/' || k.conversation_id);
  end loop;
  for k in update dating_calls set status = 'ended', ended_at = now(), end_reason = 'lost'
           where status = 'active' and greatest(caller_beat, coalesce(callee_beat, caller_beat)) < now() - interval '45 seconds' returning * loop
    perform call_announce(k);
  end loop;
  delete from call_signals where created_at < now() - interval '1 hour';
end $$;
revoke all on function dating_private.call_sweep() from public, anon, authenticated;

revoke all on function public.call_available(uuid), public.call_start(uuid, text), public.call_get(uuid), public.call_answer(uuid, boolean),
  public.call_end(uuid, text), public.call_beat(uuid), public.call_signal(uuid, jsonb), public.call_signals_since(uuid, bigint),
  public.call_history(uuid, int), public.call_ringing() from public, anon;
grant execute on function public.call_available(uuid), public.call_start(uuid, text), public.call_get(uuid), public.call_answer(uuid, boolean),
  public.call_end(uuid, text), public.call_beat(uuid), public.call_signal(uuid, jsonb), public.call_signals_since(uuid, bigint),
  public.call_history(uuid, int), public.call_ringing() to authenticated;
grant execute on function public.call_can_listen(text) to authenticated;

select cron.unschedule('call-sweep') where exists (select 1 from cron.job where jobname = 'call-sweep');
select cron.schedule('call-sweep', '15 seconds', 'select dating_private.call_sweep()');
