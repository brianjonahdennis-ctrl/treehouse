-- Dating is requests-only: a chat opens when two people like each other (like_profile), not
-- whenever someone taps "Message". start_conversation() stays for older app versions, but it now
-- only reopens an existing chat, or accepts someone who has already liked you.
create or replace function public.start_conversation(p_handle text) returns uuid
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  other uuid;
  conv uuid;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not exists (select 1 from dating_profiles where user_id = uid) then
    raise exception 'Create your dating profile first.' using errcode = '28000';
  end if;
  if dating_is_suspended(uid) then raise exception 'Your dating profile is suspended.' using errcode = '42501'; end if;
  select user_id into other from dating_profiles where handle = p_handle and is_active and not suspended;
  if other is null or other = uid or dating_is_blocked(uid, other) then
    raise exception 'That profile is not available.' using errcode = 'P0002';
  end if;
  conv := dating_conversation_between(uid, other);
  if conv is not null then return conv; end if;
  if not exists (select 1 from dating_likes where from_user = other and to_user = uid and liked) then
    raise exception 'Send them a like first: a chat opens when you both like each other.' using errcode = 'P0001';
  end if;
  insert into dating_likes (from_user, to_user, liked) values (uid, other, true)
  on conflict (from_user, to_user) do update set liked = true, created_at = now();
  insert into dating_conversations (user_a, user_b) values (least(uid, other), greatest(uid, other))
  on conflict (user_a, user_b) do update set user_a = excluded.user_a
  returning id into conv;
  return conv;
end $$;
