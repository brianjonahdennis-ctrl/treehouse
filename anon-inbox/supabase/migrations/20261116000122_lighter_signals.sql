-- Cost review 2 (Hydra, 16 Nov 2026). Same product, less work:
-- 1. New-message live signals only go to people who have been on treehouse in the last 15 minutes
--    (36% went to people who were away; each one is billed by Supabase). The app reports "I'm here"
--    every 4 minutes while it's on screen, so nobody looking at treehouse misses a signal; people who
--    come back catch up as before.
-- 2. "Reload your chat list" after a message request or an accept: only the other person is told (the
--    one who acted reloads anyway), and only if they've been on treehouse in the last 15 minutes.

set lock_timeout = '5s';

create or replace function dating_private.recently_here(p_user uuid) returns boolean
language sql stable security definer set search_path = public, dating_private as $$
  select exists (select 1 from dating_profiles p where p.user_id = p_user and p.last_seen_at > now() - interval '15 minutes')
      or exists (select 1 from bird_kingdom b where b.user_id = p_user and b.last_ping_at > now() - interval '15 minutes')
$$;
revoke all on function dating_private.recently_here(uuid) from public, anon, authenticated;

create or replace function dating_private.nudge_message(p_user uuid, p_message public.dating_messages) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if p_user is null or not recently_here(p_user) then return; end if;   -- away: they catch up when they're back
  begin
    perform realtime.send(
      jsonb_build_object('k', 'message', 'c', p_message.conversation_id, 'at', p_message.created_at, 'b', left(p_message.body, 200),
        'm', jsonb_strip_nulls(jsonb_build_object('id', p_message.id, 'sender_id', p_message.sender_id,
                                                  'body', p_message.body, 'reply_to', p_message.reply_to,
                                                  'photo', p_message.photo, 'photo_w', p_message.photo_w, 'photo_h', p_message.photo_h,
                                                  'voice', p_message.voice, 'voice_ms', p_message.voice_ms))),
      'inbox', 'user:' || p_user, true);
  exception when others then null;   -- a signal must never block a message
  end;
end $$;
revoke execute on function dating_private.nudge_message(uuid, public.dating_messages) from public, anon, authenticated;

create or replace function dating_private.nudge_on_conversation() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' or new.accepted_at is distinct from old.accepted_at then
    if new.user_a is distinct from actor and recently_here(new.user_a) then perform nudge(new.user_a); end if;
    if new.user_b is distinct from actor and recently_here(new.user_b) then perform nudge(new.user_b); end if;
  end if;
  return null;
end $$;
