-- Photos in private chats.
--  * Only in accepted chats (matches and accepted requests/friends), never in requests or rooms.
--  * Unlocked once the two people have exchanged 50 text messages, at least 10 from each of them,
--    so nobody can spam a new match with pictures or ads. There's no counter or timer in the app.
--  * Files live in a private bucket ("chat-photos"), one folder per chat. Only the two people in the
--    chat can open them, through short-lived links. The phone shrinks each photo and removes its
--    location data before upload.
--  * Photos expire after 30 days; unsent photos and leftovers are removed by the server's cleanup.

set lock_timeout = '5s';

-- ---- The message that carries a photo ------------------------------------------------------------
alter table public.dating_messages
  add column if not exists photo   text,
  add column if not exists photo_w smallint,
  add column if not exists photo_h smallint;
alter table public.dating_messages drop constraint if exists dating_messages_photo_shape;
alter table public.dating_messages add constraint dating_messages_photo_shape check (
  photo is null or (photo ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
                    and photo_w between 1 and 4096 and photo_h between 1 and 4096));
grant insert (photo, photo_w, photo_h) on public.dating_messages to authenticated;
create index if not exists dating_messages_photo on public.dating_messages (photo) where photo is not null;

-- ---- Have these two chatted enough? ------------------------------------------------------------------
create or replace function dating_private.photos_unlocked(p_conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.accepted_at is not null
       and (select count(*) from (select 1 from dating_messages m where m.conversation_id = c.id and m.sender_id = c.user_a
                                   and m.photo is null and m.deleted_at is null limit 10) a) >= 10
       and (select count(*) from (select 1 from dating_messages m where m.conversation_id = c.id and m.sender_id = c.user_b
                                   and m.photo is null and m.deleted_at is null limit 10) b) >= 10
       and (select count(*) from (select 1 from dating_messages m where m.conversation_id = c.id
                                   and m.photo is null and m.deleted_at is null limit 50) t) >= 50
    from dating_conversations c where c.id = p_conv), false);
$$;
revoke execute on function dating_private.photos_unlocked(uuid) from public, anon, authenticated;

-- For the app: is the photo button open in this chat? (Only the two people in it can ask.)
create or replace function public.photos_unlocked(p_conversation uuid) returns boolean
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  if auth.uid() is null or not dating_is_participant(p_conversation, auth.uid()) then return false; end if;
  return dating_private.photos_unlocked(p_conversation)
     and not dating_is_blocked(auth.uid(), dating_partner(p_conversation, auth.uid()));
end $$;
revoke execute on function public.photos_unlocked(uuid) from public, anon;
grant execute on function public.photos_unlocked(uuid) to authenticated;

-- Can the signed-in person upload this file name? "<chat id>/<random id>.jpg", own unlocked chat only.
create or replace function dating_private.photo_upload_ok(p_name text) returns boolean
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  conv uuid;
  me uuid := auth.uid();
begin
  if me is null or p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' then return false; end if;
  conv := split_part(p_name, '/', 1)::uuid;
  return dating_is_participant(conv, me)
     and not dating_is_blocked(me, dating_partner(conv, me))
     and not dating_is_suspended(me)
     and dating_private.photos_unlocked(conv)
     -- at most 30 photos an hour per person
     and (select count(*) from storage.objects o where o.bucket_id = 'chat-photos' and o.owner_id = me::text
            and o.created_at > now() - interval '1 hour') < 30;
end $$;
revoke execute on function dating_private.photo_upload_ok(text) from public, anon;
grant execute on function dating_private.photo_upload_ok(text) to authenticated;

-- Can the signed-in person open this photo? Both people in the chat, while it's sent, not unsent and
-- not older than 30 days.
create or replace function dating_private.photo_read_ok(p_name text) returns boolean
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
begin
  if me is null or p_name !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' then return false; end if;
  if not dating_is_participant(split_part(p_name, '/', 1)::uuid, me) then return false; end if;
  -- The sender can see their own upload straight away (before the message row exists).
  return exists (select 1 from storage.objects o where o.bucket_id = 'chat-photos' and o.name = p_name and o.owner_id = me::text
                   and o.created_at > now() - interval '30 days')
      or exists (select 1 from dating_messages m where m.photo = p_name and m.deleted_at is null
                   and m.created_at > now() - interval '30 days');
end $$;
revoke execute on function dating_private.photo_read_ok(text) from public, anon;
grant execute on function dating_private.photo_read_ok(text) to authenticated;

-- Files that should go: older than 30 days, belonging to an unsent message, or uploaded but never sent.
create or replace function dating_private.photo_gone(p_name text, p_created timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select p_created < now() - interval '30 days'
      or exists (select 1 from dating_messages m where m.photo = p_name and m.deleted_at is not null)
      or (p_created < now() - interval '1 hour' and not exists (select 1 from dating_messages m where m.photo = p_name));
$$;
revoke execute on function dating_private.photo_gone(text, timestamptz) from public;
grant execute on function dating_private.photo_gone(text, timestamptz) to anon, authenticated;

-- ---- The private bucket and who can do what in it --------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-photos', 'chat-photos', false, 1500000, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 1500000, allowed_mime_types = array['image/jpeg'];

drop policy if exists "chat photos: upload in unlocked chats" on storage.objects;
create policy "chat photos: upload in unlocked chats" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-photos' and dating_private.photo_upload_ok(name));

drop policy if exists "chat photos: the two people in the chat can open them" on storage.objects;
create policy "chat photos: the two people in the chat can open them" on storage.objects for select to authenticated
  using (bucket_id = 'chat-photos' and dating_private.photo_read_ok(name));

-- Cleanup: expired, unsent and never-sent files may be removed (by the server's hourly job or the sender).
drop policy if exists "chat photos: expired files can be removed" on storage.objects;
create policy "chat photos: expired files can be removed" on storage.objects for delete to anon, authenticated
  using (bucket_id = 'chat-photos' and dating_private.photo_gone(name, created_at));

-- ---- Sending: a photo message needs an unlocked chat and your own uploaded file ------------------
create or replace function dating_private.dating_photo_check() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if new.photo is null then
    new.photo_w := null; new.photo_h := null;
    return new;
  end if;
  if split_part(new.photo, '/', 1) <> new.conversation_id::text then
    raise exception 'That photo doesn''t belong to this chat.' using errcode = '22023';
  end if;
  if not dating_private.photos_unlocked(new.conversation_id) then
    raise exception 'You two haven''t chatted enough to exchange pictures yet. Keep the conversation going!' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'chat-photos' and o.name = new.photo and o.owner_id = new.sender_id::text) then
    raise exception 'That photo didn''t upload. Try again.' using errcode = '22023';
  end if;
  if exists (select 1 from dating_messages m where m.photo = new.photo) then
    raise exception 'That photo was already sent.' using errcode = '22023';
  end if;
  new.body := '📷 Photo';   -- what chat lists and notifications show
  return new;
end $$;
revoke execute on function dating_private.dating_photo_check() from public, anon, authenticated;
drop trigger if exists dating_messages_photo_check on public.dating_messages;
create trigger dating_messages_photo_check before insert on public.dating_messages
  for each row execute function dating_private.dating_photo_check();

-- A photo message can't be edited into text (unsend still works).
create or replace function dating_private.dating_photo_no_edit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.photo is not null and new.deleted_at is null and (new.body is distinct from old.body or new.photo is distinct from old.photo) then
    raise exception 'Photos can''t be edited.' using errcode = '22023';
  end if;
  return new;
end $$;
revoke execute on function dating_private.dating_photo_no_edit() from public, anon, authenticated;
drop trigger if exists dating_messages_photo_no_edit on public.dating_messages;
create trigger dating_messages_photo_no_edit before update on public.dating_messages
  for each row execute function dating_private.dating_photo_no_edit();

-- The live "new message" signal carries the photo too.
create or replace function dating_private.nudge_message(p_user uuid, p_message public.dating_messages) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  begin
    perform realtime.send(
      jsonb_build_object('k', 'message', 'c', p_message.conversation_id, 'at', p_message.created_at, 'b', left(p_message.body, 200),
        'm', jsonb_strip_nulls(jsonb_build_object('id', p_message.id, 'sender_id', p_message.sender_id,
                                                  'body', p_message.body, 'reply_to', p_message.reply_to,
                                                  'photo', p_message.photo, 'photo_w', p_message.photo_w, 'photo_h', p_message.photo_h))),
      'inbox', 'user:' || p_user, true);
  exception when others then null;   -- a signal must never block a message
  end;
end $$;
revoke execute on function dating_private.nudge_message(uuid, public.dating_messages) from public, anon, authenticated;

-- ---- Owner: photo files due for removal (the server deletes them every hour) ----------------------
create or replace function public.admin_expired_photos(p_key text, p_limit int default 500) returns setof text
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  if not dating_private.admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query
    select o.name from storage.objects o
    where o.bucket_id = 'chat-photos' and dating_private.photo_gone(o.name, o.created_at)
    order by o.created_at
    limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end $$;
revoke all on function public.admin_expired_photos(text, int) from public;
grant execute on function public.admin_expired_photos(text, int) to anon, service_role;

-- Owner stats: photos sent in total and today.
create or replace function public.admin_photo_stats(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  if not dating_private.admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'stored', (select count(*) from storage.objects where bucket_id = 'chat-photos'),
    'storedMB', (select round(coalesce(sum((metadata ->> 'size')::bigint), 0) / 1048576.0, 1) from storage.objects where bucket_id = 'chat-photos'),
    'sentToday', (select count(*) from dating_messages where photo is not null
                    and created_at >= ((now() at time zone 'Africa/Lagos')::date::timestamp at time zone 'Africa/Lagos')));
end $$;
revoke all on function public.admin_photo_stats(text) from public;
grant execute on function public.admin_photo_stats(text) to anon, service_role;
