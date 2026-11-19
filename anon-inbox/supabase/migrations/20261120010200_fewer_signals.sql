-- Fewer and smaller live signals (memory/CPU plan step 4, 19 Nov 2026).
-- In the last hour 76% of all live signals (realtime.messages rows) were new-message signals.
--
-- 1. "Recently here" was 15 minutes. The app says "I'm here" every 4 minutes while it's on screen and as
--    soon as it comes back (state.ts loadDating), so anyone not seen for 6 minutes has closed treehouse
--    and can't receive the signal anyway; they catch up when they return, as today. 15 → 6 minutes.
-- 2. Message signals carried the message text twice ('b' preview and 'm.body'). The app already uses
--    m.body when 'b' is missing (App.tsx), so 'b' is dropped.
-- Calls, new chats and everything else are unchanged. Safe to run twice.

set lock_timeout = '5s';

create or replace function dating_private.recently_here(p_user uuid) returns boolean
language sql stable security definer set search_path = public, dating_private as $$
  select exists (select 1 from dating_profiles p where p.user_id = p_user and p.last_seen_at > now() - interval '6 minutes')
      or exists (select 1 from bird_kingdom b where b.user_id = p_user and b.last_ping_at > now() - interval '6 minutes')
$$;
revoke all on function dating_private.recently_here(uuid) from public, anon, authenticated;

create or replace function dating_private.nudge_message(p_user uuid, p_message public.dating_messages) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if p_user is null or not recently_here(p_user) then return; end if;   -- away: they catch up when they're back
  begin
    perform realtime.send(
      jsonb_build_object('k', 'message', 'c', p_message.conversation_id, 'at', p_message.created_at,
        'm', jsonb_strip_nulls(jsonb_build_object('id', p_message.id, 'sender_id', p_message.sender_id,
                                                  'body', p_message.body, 'reply_to', p_message.reply_to,
                                                  'photo', p_message.photo, 'photo_w', p_message.photo_w, 'photo_h', p_message.photo_h,
                                                  'voice', p_message.voice, 'voice_ms', p_message.voice_ms))),
      'inbox', 'user:' || p_user, true);
  exception when others then null;   -- a signal must never block a message
  end;
end $$;
revoke execute on function dating_private.nudge_message(uuid, public.dating_messages) from public, anon, authenticated;

-- Likes used their own 15-minute check; same 6 minutes now.
create or replace function dating_private.nudge_on_like() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if new.liked and recently_here(new.to_user) then
    perform nudge(new.to_user);
  end if;
  return null;
end $$;
