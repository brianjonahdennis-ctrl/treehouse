-- Smaller message storage (memory plan step 5, 19 Nov 2026).
-- The index dating_messages_sender_recent (sender_id, created_at) is 574 MB. Only two things used it:
--  * the "20 messages a minute" send limit, now a one-row-per-sender counter (dating_private.send_rate);
--  * the staff console's "messages sent" count, now counted through the member's chats (chat index).
-- Every other check (photo unlock, ratings, calls, message requests, Bird Kingdom) reads messages within
-- one chat and uses dating_messages_conv_recent. The index itself is dropped separately with
--   drop index concurrently if exists public.dating_messages_sender_recent;
-- (outside a transaction, so sending messages never waits). Safe to run twice.

set lock_timeout = '5s';

create table if not exists dating_private.send_rate (
  user_id uuid primary key,
  window_start timestamptz not null,
  n int not null
);
alter table dating_private.send_rate enable row level security;
revoke all on dating_private.send_rate from public, anon, authenticated;

CREATE OR REPLACE FUNCTION dating_private.dating_messages_before()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'dating_private'
AS $function$
declare
  c dating_conversations%rowtype;
  sent_now int;
begin
  -- Rate limit: at most 20 messages a minute, from a one-row-per-sender counter (no message index).
  -- A refused message rolls the count back with it, as before.
  insert into dating_private.send_rate as r (user_id, window_start, n) values (new.sender_id, now(), 1)
  on conflict (user_id) do update
    set n = case when r.window_start < now() - interval '1 minute' then 1 else r.n + 1 end,
        window_start = case when r.window_start < now() - interval '1 minute' then now() else r.window_start end
  returning n into sent_now;
  if sent_now > 20 then
    raise exception 'Slow down - too many messages. Try again in a minute.' using errcode = 'P0001';
  end if;
  select * into c from dating_conversations where id = new.conversation_id;
  -- Message requests: the recipient accepts first; the sender gets 3 messages until then.
  if found and c.accepted_at is null then
    if new.sender_id is distinct from c.started_by then
      raise exception 'Accept the message request first, then you can reply.' using errcode = '42501';
    elsif c.declined_at is not null then
      raise exception 'This person isn''t accepting messages from you.' using errcode = '42501';
    elsif (select count(*) from (select 1 from dating_messages
             where conversation_id = c.id and sender_id = new.sender_id limit 3) sent) >= 3 then
      raise exception 'Wait for them to accept: you can send up to 3 messages until then.' using errcode = 'P0001';
    end if;
  end if;
  -- Replies must quote a message in the same chat.
  if new.reply_to is not null and not exists (
    select 1 from dating_messages q where q.id = new.reply_to and q.conversation_id = new.conversation_id) then
    raise exception 'You can only reply to a message in this chat.' using errcode = '22023';
  end if;
  new.edited_at := null;
  new.deleted_at := null;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION dating_private.staff_member_base(p_handle text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'dating_private'
AS $function$
declare
  me uuid := auth.uid();
  r text := staff_need('moderate');
  uid uuid := staff_uid(p_handle);
  p dating_profiles%rowtype;
  u record;
  out jsonb;
begin
  select * into p from dating_profiles where user_id = uid;
  select email, created_at, last_sign_in_at, banned_until into u from auth.users where id = uid;
  out := jsonb_build_object(
    'handle', p.handle, 'gender', p.gender, 'age', p.age, 'state', p.state, 'location', p.location, 'intent', p.intent,
    'bio', p.bio, 'interests', p.interests, 'created_at', p.created_at, 'updated_at', p.updated_at, 'last_seen_at', p.last_seen_at,
    'is_active', p.is_active, 'suspended', p.suspended, 'underage_at', p.dob_underage_at, 'birthday_public', p.birthday_public,
    'age_changed_at', p.age_changed_at,
    'signed_up_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
    'sign_in_blocked', u.banned_until is not null and u.banned_until > now(),
    'staff_role', (select role from announcement_staff where user_id = uid),
    'room_ban', (select jsonb_build_object('until', until, 'reason', reason) from room_bans where user_id = uid and until > now()),
    'counts', jsonb_build_object(
      'chats', (select count(*) from dating_conversations c where uid in (c.user_a, c.user_b) and c.accepted_at is not null),
      'requests', (select count(*) from dating_conversations c where uid in (c.user_a, c.user_b) and c.accepted_at is null and c.declined_at is null),
      'friends', (select count(*) from dating_conversations c where uid in (c.user_a, c.user_b) and c.kind = 'friend' and c.accepted_at is not null),
      'messages_sent', (select count(*) from dating_conversations c join dating_messages m on m.conversation_id = c.id where (c.user_a = uid or c.user_b = uid) and m.sender_id = uid),
      'room_messages', (select count(*) from room_messages m where m.user_id = uid),
      'blocked_others', (select count(*) from dating_blocks b where b.blocker_id = uid),
      'blocked_by', (select count(*) from dating_blocks b where b.blocked_id = uid),
      'reports_against', (select count(*) from dating_reports dr where dr.reported_id = uid),
      'reports_made', (select count(*) from dating_reports dr where dr.reporter_id = uid),
      'push_devices', (select count(*) from push_subscriptions s where s.user_id = uid)),
    'reputation', (select jsonb_build_object('score', round(score, 2), 'raters', raters, 'band', band, 'established', established) from reputation where user_id = uid),
    'bird_level', (select level from bird_kingdom where user_id = uid),
    'kickrs', exists (select 1 from kickrs_links k where k.user_id = uid and k.revoked_at is null),
    'platforms', (select coalesce(jsonb_agg(distinct platform), '[]'::jsonb) from app_seen_days a where a.user_id = uid and a.day > lagos_today() - 30),
    'referral', jsonb_build_object(
      'code', (select code from referral_codes where owner = uid),
      'joined', (select count(*) from referrals rf join referral_codes c on c.code = rf.code where c.owner = uid),
      'came_from', (select coalesce(dp.handle, rc.campaign, rf.code) from referrals rf join referral_codes rc on rc.code = rf.code
                      left join dating_profiles dp on dp.user_id = rc.owner where rf.user_id = uid)),
    'reports', (select coalesce(jsonb_agg(jsonb_build_object('id', dr.id, 'created_at', dr.created_at, 'reason', dr.reason, 'details', dr.details,
                  'status', dr.status, 'by', rp.handle, 'conversation_id', dr.conversation_id) order by dr.created_at desc), '[]'::jsonb)
                from (select * from dating_reports where reported_id = uid order by created_at desc limit 20) dr
                left join dating_profiles rp on rp.user_id = dr.reporter_id),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('at', n.created_at, 'by', a.handle, 'body', n.body) order by n.created_at desc), '[]'::jsonb)
              from staff_notes n left join dating_profiles a on a.user_id = n.author where n.user_id = uid)
  );
  if staff_allows(r, 'manage') then
    out := out || jsonb_build_object('name', p.name, 'email', u.email, 'birth_date', p.birth_date,
      'providers', (select coalesce(jsonb_agg(distinct provider), '[]'::jsonb) from auth.identities where user_id = uid));
  end if;
  perform staff_log(me, 'view_member', 'member', p.handle);
  return out;
end $function$;

-- Old counters are useless after a minute; clear them every night.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-rate-sweep') then perform cron.unschedule('send-rate-sweep'); end if;
end $$;
select cron.schedule('send-rate-sweep', '40 3 * * *', $c$delete from dating_private.send_rate where window_start < now() - interval '1 hour'$c$);
