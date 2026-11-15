-- Voice notes in private chats (Hydra, 15 Nov 2026).
-- * Same unlock rule as photos: 20 messages exchanged, at least 5 from each person (photos_unlocked).
-- * Up to 60 seconds. Files live in a private bucket ("chat-voice"), one folder per chat.
-- * Played once: when the recipient plays it, it's marked played and the file is deleted straight away
--   (the app deletes it; the server's hourly cleanup is the backup). Unplayed notes go after 7 days.

set lock_timeout = '5s';

alter table public.dating_messages
  add column if not exists voice text,
  add column if not exists voice_ms integer,
  add column if not exists voice_played_at timestamptz;
alter table public.dating_messages drop constraint if exists dating_messages_voice_shape;
alter table public.dating_messages add constraint dating_messages_voice_shape check (
  voice is null or (voice ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webm|m4a|ogg)$' and voice_ms between 300 and 61000 and photo is null));
grant insert (voice, voice_ms) on public.dating_messages to authenticated;

-- ---- Who can upload / play / delete a voice file -------------------------------------------------
create or replace function dating_private.voice_upload_ok(p_name text) returns boolean
language plpgsql stable security definer set search_path = public, dating_private as $$
declare conv uuid; me uuid := auth.uid();
begin
  if me is null or p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webm|m4a|ogg)$' then return false; end if;
  conv := split_part(p_name, '/', 1)::uuid;
  return dating_is_participant(conv, me)
     and not dating_is_blocked(me, dating_partner(conv, me))
     and not dating_is_suspended(me)
     and dating_private.photos_unlocked(conv)
     and (select count(*) from storage.objects o where o.bucket_id = 'chat-voice' and o.owner_id = me::text
            and o.created_at > now() - interval '1 hour') < 40;
end $$;

-- Readable by the sender (their own upload), and by the recipient until it has been played.
create or replace function dating_private.voice_read_ok(p_name text) returns boolean
language plpgsql stable security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid();
begin
  if me is null or p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webm|m4a|ogg)$' then return false; end if;
  if not dating_is_participant(split_part(p_name, '/', 1)::uuid, me) then return false; end if;
  return exists (select 1 from storage.objects o where o.bucket_id = 'chat-voice' and o.name = p_name and o.owner_id = me::text)
      or exists (select 1 from dating_messages m where m.voice = p_name and m.deleted_at is null and m.voice_played_at is null
                   and m.sender_id <> me and m.created_at > now() - interval '7 days');
end $$;

-- Files that should go: played, unsent, older than 7 days, or uploaded but never sent.
create or replace function dating_private.voice_gone(p_name text, p_created timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select p_created < now() - interval '7 days'
      or exists (select 1 from dating_messages m where m.voice = p_name and (m.voice_played_at is not null or m.deleted_at is not null))
      or (p_created < now() - interval '1 hour' and not exists (select 1 from dating_messages m where m.voice = p_name));
$$;
revoke execute on function dating_private.voice_upload_ok(text), dating_private.voice_read_ok(text) from public, anon;
grant execute on function dating_private.voice_upload_ok(text), dating_private.voice_read_ok(text) to authenticated;
revoke execute on function dating_private.voice_gone(text, timestamptz) from public;
grant execute on function dating_private.voice_gone(text, timestamptz) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-voice', 'chat-voice', false, 1500000, array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/x-m4a', 'audio/aac'])
on conflict (id) do update set public = false, file_size_limit = 1500000,
  allowed_mime_types = array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/x-m4a', 'audio/aac'];

drop policy if exists "chat voice: upload in unlocked chats" on storage.objects;
create policy "chat voice: upload in unlocked chats" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-voice' and dating_private.voice_upload_ok(name));
drop policy if exists "chat voice: sender, and recipient until played" on storage.objects;
create policy "chat voice: sender, and recipient until played" on storage.objects for select to authenticated
  using (bucket_id = 'chat-voice' and dating_private.voice_read_ok(name));
drop policy if exists "chat voice: played or old files can be removed" on storage.objects;
create policy "chat voice: played or old files can be removed" on storage.objects for delete to anon, authenticated
  using (bucket_id = 'chat-voice' and dating_private.voice_gone(name, created_at));

-- ---- Sending: needs an unlocked chat and your own uploaded file ------------------------------------
create or replace function dating_private.dating_voice_check() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if new.voice is null then new.voice_ms := null; new.voice_played_at := null; return new; end if;
  if split_part(new.voice, '/', 1) <> new.conversation_id::text then
    raise exception 'That voice note doesn''t belong to this chat.' using errcode = '22023';
  end if;
  if not dating_private.photos_unlocked(new.conversation_id) then
    raise exception 'You two haven''t chatted enough to send voice notes yet. Keep the conversation going!' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'chat-voice' and o.name = new.voice and o.owner_id = new.sender_id::text) then
    raise exception 'That voice note didn''t upload. Try again.' using errcode = '22023';
  end if;
  if exists (select 1 from dating_messages m where m.voice = new.voice) then
    raise exception 'That voice note was already sent.' using errcode = '22023';
  end if;
  new.voice_played_at := null;
  new.body := '🎤 Voice note';   -- what chat lists and notifications show
  return new;
end $$;
revoke execute on function dating_private.dating_voice_check() from public, anon, authenticated;
drop trigger if exists dating_messages_voice_check on public.dating_messages;
create trigger dating_messages_voice_check before insert on public.dating_messages
  for each row execute function dating_private.dating_voice_check();

-- A voice note can't be edited (unsend still works; "played" is set only by voice_played()).
create or replace function dating_private.dating_voice_no_edit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.voice is not null and new.deleted_at is null and (new.body is distinct from old.body or new.voice is distinct from old.voice) then
    raise exception 'Voice notes can''t be edited.' using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function dating_private.dating_voice_no_edit() from public, anon, authenticated;
drop trigger if exists dating_messages_voice_no_edit on public.dating_messages;
create trigger dating_messages_voice_no_edit before update on public.dating_messages
  for each row execute function dating_private.dating_voice_no_edit();

-- The recipient played it: mark it played (the app then deletes the file).
create or replace function public.voice_played(p_message bigint) returns text
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); m dating_messages%rowtype;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into m from dating_messages where id = p_message;
  if not found or m.voice is null or m.sender_id = me or not dating_is_participant(m.conversation_id, me) then
    raise exception 'Voice note not found.' using errcode = 'P0002';
  end if;
  if m.voice_played_at is null then update dating_messages set voice_played_at = now() where id = p_message; end if;
  return m.voice;
end $$;
revoke execute on function public.voice_played(bigint) from public, anon;
grant execute on function public.voice_played(bigint) to authenticated;

-- The live "new message" signal carries the voice note too.
create or replace function dating_private.nudge_message(p_user uuid, p_message public.dating_messages) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
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

-- Owner: voice files due for removal (the server's hourly cleanup deletes them).
create or replace function public.admin_expired_voice(p_key text, p_limit int default 500) returns setof text
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  if not dating_private.admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query
    select o.name from storage.objects o
    where o.bucket_id = 'chat-voice' and dating_private.voice_gone(o.name, o.created_at)
    order by o.created_at
    limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end $$;
revoke all on function public.admin_expired_voice(text, int) from public;
grant execute on function public.admin_expired_voice(text, int) to anon, service_role;
