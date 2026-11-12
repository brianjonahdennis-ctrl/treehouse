-- Chatrooms, second pass (the new design): emoji reactions on messages, and a small profile card for
-- people in your room. Profile cards only work for people in the same room as you, and only show
-- what their anonymous dating card already shows (nickname, age, gender, bio, interests).

create table public.room_reactions (
  message_id  bigint not null references public.room_messages (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  emoji       text not null check (emoji in ('❤️', '👍', '🔥', '😂', '😮', '😢')),
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
alter table public.room_reactions enable row level security;
revoke all on public.room_reactions from anon, authenticated;

-- {"❤️": 12, "🔥": 3} for one message
create function dating_private.room_reaction_counts(p_message bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(emoji, n), '{}'::jsonb)
  from (select emoji, count(*)::int as n from room_reactions where message_id = p_message group by emoji) c;
$$;

-- History now includes reactions (counts, and which ones are yours).
drop function public.room_history(int);
create function public.room_history(p_limit int default 60)
returns table (id bigint, handle text, body text, created_at timestamptz, mine boolean, reactions jsonb, my_reactions text[])
language sql stable security definer set search_path = public, dating_private as $$
  select r.id, r.handle, r.body, r.created_at, r.mine,
         room_reaction_counts(r.id),
         coalesce((select array_agg(x.emoji) from room_reactions x where x.message_id = r.id and x.user_id = auth.uid()), '{}')
  from (
    select x.id, x.handle, x.body, x.created_at, x.user_id = auth.uid() as mine
    from room_members m
    join room_messages x on x.state = m.state
    where m.user_id = auth.uid() and room_active(m.last_seen_at)
    order by x.id desc
    limit least(greatest(coalesce(p_limit, 60), 1), 200)
  ) r order by r.id;
$$;

-- Add or remove one of your reactions; everyone in the room sees the new counts live.
create function public.toggle_room_reaction(p_message bigint, p_emoji text)
returns table (reactions jsonb, mine boolean)
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  room text;
  added boolean;
  counts jsonb;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select x.state into room from room_messages x
    join room_members m on m.state = x.state and m.user_id = uid and room_active(m.last_seen_at)
    where x.id = p_message;
  if room is null then raise exception 'Message not found.' using errcode = 'P0002'; end if;
  if (select count(*) from room_reactions r where r.user_id = uid and r.created_at > now() - interval '10 seconds') >= 10 then
    raise exception 'Slow down a little.' using errcode = 'P0001';
  end if;
  delete from room_reactions r where r.message_id = p_message and r.user_id = uid and r.emoji = p_emoji;
  added := not found;
  if added then insert into room_reactions (message_id, user_id, emoji) values (p_message, uid, p_emoji); end if;
  counts := room_reaction_counts(p_message);
  perform realtime.send(jsonb_build_object('id', p_message, 'reactions', counts), 'reaction', 'room:' || room, true);
  return query select counts, added;
end $$;

-- People in your room, with whether they have a dating card (so the app can offer "Message").
drop function public.room_people();
create function public.room_people()
returns table (handle text, me boolean, dating boolean)
language sql stable security definer set search_path = public, dating_private as $$
  select o.handle, o.user_id = auth.uid(),
         exists (select 1 from dating_profiles p where p.user_id = o.user_id and p.is_active and not p.suspended)
  from room_members m
  join room_members o on o.state = m.state and room_active(o.last_seen_at)
  where m.user_id = auth.uid() and room_active(m.last_seen_at)
  order by o.user_id = auth.uid() desc, o.joined_at
  limit 100;
$$;

-- Profile card for someone in your room.
create function public.room_profile(p_handle text)
returns table (handle text, room text, online boolean, age int, gender public.dating_gender, bio text,
               interests text[], dating boolean, me boolean)
language sql stable security definer set search_path = public, dating_private as $$
  select o.handle, o.state, room_active(o.last_seen_at),
         p.age, p.gender, p.bio, p.interests,
         coalesce(p.is_active and not p.suspended, false),
         o.user_id = auth.uid()
  from room_members m
  join room_members o on o.state = m.state and o.handle = p_handle
  left join dating_profiles p on p.user_id = o.user_id
  where m.user_id = auth.uid() and room_active(m.last_seen_at)
  limit 1;
$$;

revoke execute on function public.room_history(int), public.toggle_room_reaction(bigint, text), public.room_people(),
  public.room_profile(text) from public, anon;
grant execute on function public.room_history(int), public.toggle_room_reaction(bigint, text), public.room_people(),
  public.room_profile(text) to authenticated;
