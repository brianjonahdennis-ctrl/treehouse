-- Chatroom rules, part 2 (Hydra, 14 Nov 2026):
-- * Link bans now say: "Your account was banned from chatrooms for posting links in the group."
-- * Posting the same text repeatedly (the 3rd identical message within 30 minutes; capitals and extra
--   spaces ignored; messages under 10 characters don't count) = instant 48-hour ban from every room.
--   Like the link ban: no warning, the message isn't posted, the reason + countdown show straight away.

set lock_timeout = '5s';

create or replace function dating_private.norm_text(p_text text) returns text
language sql immutable as $$ select lower(regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g')) $$;

-- Ban someone from every chatroom (a longer ban already in place is never shortened).
create or replace function dating_private.room_ban(p_user uuid, p_for interval, p_reason text) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  insert into room_bans (user_id, until, reason) values (p_user, now() + p_for, p_reason)
  on conflict (user_id) do update
    set until = greatest(room_bans.until, excluded.until),
        reason = case when excluded.until >= room_bans.until then excluded.reason else room_bans.reason end,
        created_at = now();
  delete from room_members where user_id = p_user;
end $$;
revoke all on function dating_private.norm_text(text), dating_private.room_ban(uuid, interval, text) from public, anon, authenticated;

-- Bans already running get the new wording.
update dating_private.room_bans set reason = 'Your account was banned from chatrooms for posting links in the group.'
where until > now() and reason like 'You posted a link%';

CREATE OR REPLACE FUNCTION public.send_room_message(p_body text, p_reply_to bigint DEFAULT NULL::bigint)
 RETURNS TABLE(id bigint, handle text, body text, created_at timestamp with time zone, reply_to bigint, reply_handle text, reply_body text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'dating_private'
AS $function$
declare
  uid uuid := auth.uid();
  m record;
  text_in text := btrim(coalesce(p_body, ''));
  q_handle text;
  q_body text;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if dating_private.room_block(uid) is not null then
    delete from room_members where user_id = uid;
    raise exception 'Chatroom ban: %', dating_private.room_block(uid) ->> 'reason' using errcode = '42501';
  end if;
  -- Links aren't allowed in chatrooms: no warning, the message isn't posted, and the sender is banned
  -- from every chatroom for 24 hours. (No error is raised, so the ban is kept; the app then shows it.)
  if dating_private.has_link(p_body) then
    perform dating_private.room_ban(uid, interval '24 hours', 'Your account was banned from chatrooms for posting links in the group.');
    return;
  end if;
  -- The same text over and over (3rd time within 30 minutes, 10+ characters): 48 hours out of every room.
  if char_length(dating_private.norm_text(p_body)) >= 10
     and (select count(*) from room_messages x
          where x.user_id = uid and x.created_at > now() - interval '30 minutes'
            and dating_private.norm_text(x.body) = dating_private.norm_text(p_body)) >= 2 then
    perform dating_private.room_ban(uid, interval '48 hours', 'Your account was banned from chatrooms for 48 hours for posting the same message repeatedly in the group.');
    return;
  end if;
  select * into m from room_members r where r.user_id = uid and room_active(r.last_seen_at);
  if not found then raise exception 'Join a room first.' using errcode = 'P0002'; end if;
  if char_length(text_in) not between 1 and 500 then
    raise exception 'Messages can be 1 to 500 characters.' using errcode = '22023';
  end if;
  if (select count(*) from room_messages x where x.user_id = uid and x.created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'Slow down a little: you can send 5 messages every 10 seconds.' using errcode = 'P0001';
  end if;
  if p_reply_to is not null then
    select x.handle, x.body into q_handle, q_body from room_messages x where x.id = p_reply_to and x.state = m.state;
    if not found then raise exception 'That message isn''t in this room anymore.' using errcode = 'P0002'; end if;
  end if;
  update room_members set last_seen_at = now() where user_id = uid;
  -- Keep rooms light: messages older than a week are cleared now and then.
  if random() < 0.02 then delete from room_messages x where x.state = m.state and x.created_at < now() - interval '7 days'; end if;
  return query
    with ins as (
      insert into room_messages (state, user_id, handle, body, reply_to)
      values (m.state, uid, m.handle, text_in, p_reply_to)
      returning room_messages.id, room_messages.handle, room_messages.body, room_messages.created_at, room_messages.reply_to
    )
    select ins.id, ins.handle, ins.body, ins.created_at, ins.reply_to,
           q_handle, left(q_body, 140)
    from ins;
end $function$;;
