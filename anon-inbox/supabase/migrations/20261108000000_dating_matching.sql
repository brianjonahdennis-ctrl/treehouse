-- Dating v2: profile details, likes / requests / mutual matches, unmatch, and reactions on
-- anonymous messages. Used by the new app (/home). The current /date page keeps working.
--
--   * A like is an anonymous request. It becomes a match (a conversation) when the other person
--     likes back or accepts the request. A pass or decline is remembered so the card doesn't return.
--   * Nobody can read the likes table directly: only these functions, for the signed-in person.
--   * Requests show the same anonymous card as discovery (handle, gender, age, location, intent,
--     bio, interests) and never the name, email or account id.
--   * Unmatch = pass + block, so the chat closes for both and the history stays for reports.

-- ---- Profile details -----------------------------------------------------------------
alter table public.dating_profiles
  add column bio           text not null default '' check (char_length(bio) <= 300),
  add column interests     text[] not null default '{}'
    check (cardinality(interests) <= 8 and char_length(array_to_string(interests, '')) <= 200),
  add column interested_in public.dating_gender[] not null default '{male,female,other}'
    check (cardinality(interested_in) between 1 and 3),
  add column min_age       int not null default 18 check (min_age between 18 and 120),
  add column max_age       int not null default 120 check (max_age between 18 and 120),
  add constraint dating_profiles_age_range check (min_age <= max_age);

grant update (bio, interests, interested_in, min_age, max_age) on public.dating_profiles to authenticated;

-- ---- Likes ---------------------------------------------------------------------------
create table public.dating_likes (
  from_user   uuid not null references auth.users (id) on delete cascade,
  to_user     uuid not null references auth.users (id) on delete cascade,
  liked       boolean not null,                 -- true = like / request / accept, false = pass / decline
  created_at  timestamptz not null default now(),
  primary key (from_user, to_user),
  check (from_user <> to_user)
);
create index dating_likes_incoming on public.dating_likes (to_user, created_at desc) where liked;
alter table public.dating_likes enable row level security;
revoke all on public.dating_likes from public, anon, authenticated;

-- The conversation between two people, if they have one.
create function dating_private.dating_conversation_between(a uuid, b uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from dating_conversations where user_a = least(a, b) and user_b = greatest(a, b);
$$;
revoke execute on function dating_private.dating_conversation_between(uuid, uuid) from public, anon, authenticated;

-- Like (or pass on) a card. Liking someone who already liked you is a match: the chat opens.
-- Accepting a request is a like; declining is a pass.
create function public.like_profile(p_handle text, p_like boolean)
returns table (matched boolean, conversation_id uuid)
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  other uuid;
  conv uuid;
  theirs boolean;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from dating_profiles where user_id = uid and not suspended) then
    raise exception 'Create your dating profile first.' using errcode = '28000';
  end if;
  select user_id into other from dating_profiles where handle = p_handle and is_active and not suspended;
  if other is null or other = uid or dating_is_blocked(uid, other) then
    raise exception 'That profile is not available.' using errcode = 'P0002';
  end if;
  if p_like and (select count(*) from dating_likes
                 where from_user = uid and liked and created_at > now() - interval '1 day') >= 200 then
    raise exception 'You''ve sent a lot of likes today. Try again tomorrow.' using errcode = 'P0001';
  end if;

  insert into dating_likes (from_user, to_user, liked) values (uid, other, coalesce(p_like, false))
  on conflict (from_user, to_user) do update set liked = excluded.liked, created_at = now();

  conv := dating_conversation_between(uid, other);
  if p_like and conv is null then
    select l.liked into theirs from dating_likes l where l.from_user = other and l.to_user = uid;
    if theirs then
      insert into dating_conversations (user_a, user_b) values (least(uid, other), greatest(uid, other))
      on conflict (user_a, user_b) do update set user_a = excluded.user_a
      returning id into conv;
    end if;
  end if;
  return query select (p_like and conv is not null), case when p_like then conv end;
end $$;

-- Requests waiting for me: people who liked me, that I haven't answered and don't have a chat with.
create function public.incoming_requests()
returns table (handle text, gender public.dating_gender, age int, location text, intent public.dating_intent,
               bio text, interests text[], requested_at timestamptz)
language sql stable security definer set search_path = public, dating_private as $$
  select p.handle, p.gender, p.age, p.location, p.intent, p.bio, p.interests, l.created_at
  from dating_likes l
  join dating_profiles p on p.user_id = l.from_user
  where l.to_user = auth.uid() and l.liked
    and p.is_active and not p.suspended
    and not exists (select 1 from dating_likes m where m.from_user = auth.uid() and m.to_user = l.from_user)
    and dating_conversation_between(auth.uid(), l.from_user) is null
    and not dating_is_blocked(auth.uid(), l.from_user)
  order by l.created_at desc
  limit 100;
$$;

-- Cards for a signed-in dater: matches both people's preferences, hides anyone already liked,
-- passed, chatting or blocked. People who already liked me come first.
create function public.discover_cards(p_limit int default 20)
returns table (handle text, gender public.dating_gender, age int, location text, intent public.dating_intent,
               bio text, interests text[])
language sql stable security definer set search_path = public, dating_private as $$
  select p.handle, p.gender, p.age, p.location, p.intent, p.bio, p.interests
  from dating_profiles me
  join dating_profiles p on p.user_id <> me.user_id
  where me.user_id = auth.uid()
    and p.is_active and not p.suspended
    and p.gender = any (me.interested_in) and me.gender = any (p.interested_in)
    and p.age between me.min_age and me.max_age
    and not exists (select 1 from dating_likes l where l.from_user = me.user_id and l.to_user = p.user_id)
    and dating_conversation_between(me.user_id, p.user_id) is null
    and not dating_is_blocked(me.user_id, p.user_id)
  order by exists (select 1 from dating_likes l where l.from_user = p.user_id and l.to_user = me.user_id and l.liked) desc,
           p.created_at desc, p.handle
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- How many people I've liked who haven't answered yet (for the Home screen).
create function public.my_pending_likes() returns int
language sql stable security definer set search_path = public, dating_private as $$
  select count(*)::int from dating_likes l
  where l.from_user = auth.uid() and l.liked
    and not exists (select 1 from dating_likes m where m.from_user = l.to_user and m.to_user = auth.uid())
    and dating_conversation_between(auth.uid(), l.to_user) is null;
$$;

-- Unmatch: the chat closes for both people (a block plus a pass). Messages are kept so reports
-- can still be reviewed.
create function public.unmatch_conversation(p_conversation uuid) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  other uuid := dating_partner(p_conversation, auth.uid());
begin
  if other is null then raise exception 'Conversation not found.' using errcode = 'P0002'; end if;
  insert into dating_likes (from_user, to_user, liked) values (auth.uid(), other, false)
  on conflict (from_user, to_user) do update set liked = false, created_at = now();
  insert into dating_blocks (blocker_id, blocked_id) values (auth.uid(), other) on conflict do nothing;
end $$;

revoke execute on function public.like_profile(text, boolean), public.incoming_requests(),
  public.discover_cards(int), public.my_pending_likes(), public.unmatch_conversation(uuid)
from public, anon;
grant execute on function public.like_profile(text, boolean), public.incoming_requests(),
  public.discover_cards(int), public.my_pending_likes(), public.unmatch_conversation(uuid)
to authenticated;

-- ---- Reactions on anonymous messages ----------------------------------------------------
alter table public.link_messages
  add column reaction text check (reaction in ('❤️', '😂', '😮', '😢', '🔥', '👏'));
grant update (reaction) on public.link_messages to authenticated;
