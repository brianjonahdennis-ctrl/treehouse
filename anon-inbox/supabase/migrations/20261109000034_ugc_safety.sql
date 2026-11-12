-- App Store guideline 1.2 (user-generated content):
--   * filter objectionable words in chatroom messages, private chats and dating bios
--   * let people delete their own chatroom posts (removed live for everyone)
--   * let people block someone straight from a chatroom message, and hide blocked people's posts

-- 1. Word filter -------------------------------------------------------------------------------
-- Masks whole words only (so "class" or "Scunthorpe" are untouched): keeps the first letter, stars
-- the rest. One compiled pattern, so it costs microseconds per message.
create table if not exists dating_private.filter_words (word text primary key);

insert into dating_private.filter_words (word) values
  ('fuck'),('fucker'),('fuckers'),('fucking'),('fucked'),('fucks'),('motherfucker'),('motherfuckers'),
  ('shit'),('shitty'),('bullshit'),('bitch'),('bitches'),('bastard'),('bastards'),('asshole'),('assholes'),
  ('cunt'),('cunts'),('dick'),('dicks'),('dickhead'),('cock'),('cocks'),('pussy'),('pussies'),
  ('whore'),('whores'),('slut'),('sluts'),('prick'),('wanker'),('twat'),('nigger'),('niggers'),('nigga'),('niggas'),
  ('faggot'),('faggots'),('fag'),('fags'),('retard'),('retards'),('tranny'),('chink'),('spic'),('kike'),
  ('porn'),('porno'),('nudes'),('blowjob'),('handjob'),('cum'),('cumshot'),('dildo'),('rape'),('rapist'),
  ('ashawo'),('olosho'),('ashewo'),('oloshi')
on conflict do nothing;

create or replace function dating_private.filter_pattern() returns text
language sql stable set search_path = dating_private as $$
  select '\m(' || string_agg(word, '|' order by length(word) desc) || ')\M' from dating_private.filter_words;
$$;

create or replace function dating_private.clean_text(t text) returns text
language plpgsql stable set search_path = dating_private as $$
declare
  pat text := dating_private.filter_pattern();
  out text := '';
  rest text := t;
  m text[];
  pos int;
begin
  if t is null or t = '' or pat is null or t !~* pat then return t; end if;
  -- Replace each match with its first letter + stars, preserving the rest of the text.
  loop
    m := regexp_match(rest, pat, 'i');
    exit when m is null;
    pos := regexp_instr(rest, pat, 1, 1, 0, 'i');
    out := out || substr(rest, 1, pos - 1) || left(m[1], 1) || repeat('*', char_length(m[1]) - 1);
    rest := substr(rest, pos + char_length(m[1]));
  end loop;
  return out || rest;
end $$;

create or replace function dating_private.clean_body() returns trigger
language plpgsql set search_path = dating_private as $$
begin
  new.body := dating_private.clean_text(new.body);
  return new;
end $$;

create or replace function dating_private.clean_bio() returns trigger
language plpgsql set search_path = dating_private as $$
begin
  new.bio := dating_private.clean_text(new.bio);
  return new;
end $$;

drop trigger if exists room_messages_clean on public.room_messages;
create trigger room_messages_clean before insert or update of body on public.room_messages
  for each row execute function dating_private.clean_body();

drop trigger if exists dating_messages_clean on public.dating_messages;
create trigger dating_messages_clean before insert or update of body on public.dating_messages
  for each row execute function dating_private.clean_body();

drop trigger if exists dating_profiles_clean on public.dating_profiles;
create trigger dating_profiles_clean before insert or update of bio on public.dating_profiles
  for each row execute function dating_private.clean_bio();

-- 2. Delete your own chatroom post ------------------------------------------------------------
create or replace function public.delete_room_message(p_message bigint) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  st text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  delete from room_messages where id = p_message and user_id = auth.uid() returning state into st;
  if st is null then raise exception 'You can only delete your own messages.' using errcode = 'P0002'; end if;
  perform realtime.send(jsonb_build_object('id', p_message), 'remove', 'room:' || st, true);
end $$;
revoke all on function public.delete_room_message(bigint) from public, anon;
grant execute on function public.delete_room_message(bigint) to authenticated;

-- 3. Block someone from a chatroom message ----------------------------------------------------
create or replace function public.block_room_sender(p_message bigint) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  other uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select user_id into other from room_messages where id = p_message;
  if other is null or other = auth.uid() then raise exception 'That person is not available.' using errcode = 'P0002'; end if;
  insert into dating_blocks (blocker_id, blocked_id) values (auth.uid(), other) on conflict do nothing;
end $$;
revoke all on function public.block_room_sender(bigint) from public, anon;
grant execute on function public.block_room_sender(bigint) to authenticated;

-- 4. Chatroom history leaves out people you've blocked ------------------------------------------
create or replace function public.room_history(p_limit integer default 60)
returns table(id bigint, handle text, body text, created_at timestamptz, mine boolean, reactions jsonb, my_reactions text[], reply_to bigint, reply_handle text, reply_body text)
language sql stable security definer set search_path = public, dating_private as $$
  select r.id, r.handle, r.body, r.created_at, r.mine,
         room_reaction_counts(r.id),
         coalesce((select array_agg(x.emoji) from room_reactions x where x.message_id = r.id and x.user_id = auth.uid()), '{}'),
         r.reply_to, q.handle, left(q.body, 140)
  from (
    select x.id, x.handle, x.body, x.created_at, x.user_id = auth.uid() as mine, x.reply_to
    from room_members m
    join room_messages x on x.state = m.state and x.created_at >= m.joined_at
    where m.user_id = auth.uid() and room_active(m.last_seen_at)
      and not exists (select 1 from dating_blocks b where b.blocker_id = auth.uid() and b.blocked_id = x.user_id)
    order by x.id desc
    limit least(greatest(coalesce(p_limit, 60), 1), 200)
  ) r
  left join room_messages q on q.id = r.reply_to
  order by r.id;
$$;
