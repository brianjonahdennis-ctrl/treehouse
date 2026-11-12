-- Personal status ("Feeling productive today 🚀"), like the early 2go status.
--   * one active status per person: user_id is the primary key, so a new status replaces the old one
--   * only accepted friends can see it (and you)
--   * changing it nudges your friends' apps so their Home and bell update live

create table if not exists public.dating_statuses (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 80),
  updated_at timestamptz not null default now()
);
alter table public.dating_statuses enable row level security;
-- No direct table access: everything goes through the functions below.
revoke all on public.dating_statuses from anon, authenticated;

-- Accepted friends of a person (friend chats that were accepted, not blocked either way).
create or replace function dating_private.friend_ids(p_user uuid) returns setof uuid
language sql stable security definer set search_path = public, dating_private as $$
  select case when c.user_a = p_user then c.user_b else c.user_a end
  from dating_conversations c
  where c.kind = 'friend' and c.accepted_at is not null
    and (c.user_a = p_user or c.user_b = p_user)
    and not dating_is_blocked(c.user_a, c.user_b);
$$;

create or replace function public.set_my_status(p_body text) returns table(body text, updated_at timestamptz)
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  txt text := btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'));
  prev timestamptz;
  f uuid;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if char_length(txt) not between 1 and 80 then raise exception 'Your status can be 1 to 80 characters.' using errcode = '22023'; end if;
  select s.updated_at into prev from dating_statuses s where s.user_id = uid;
  if prev is not null and prev > now() - interval '5 seconds' then
    raise exception 'Slow down a little before changing your status again.' using errcode = 'P0001';
  end if;
  txt := clean_text(txt);
  insert into dating_statuses (user_id, body, updated_at) values (uid, txt, now())
  on conflict (user_id) do update set body = excluded.body, updated_at = excluded.updated_at;
  -- Tell friends' apps (live update for their Home and notifications). Never blocks the save.
  for f in select friend_ids(uid) loop
    begin
      perform realtime.send(jsonb_build_object('k', 'status'), 'inbox', 'user:' || f, true);
    exception when others then null;
    end;
  end loop;
  return query select s.body, s.updated_at from dating_statuses s where s.user_id = uid;
end $$;

create or replace function public.clear_my_status() returns void
language sql security definer set search_path = public as $$
  delete from dating_statuses where user_id = auth.uid();
$$;

-- Statuses for the Home screen: yours, and your accepted friends' (keyed by the friend chat).
create or replace function public.friend_statuses() returns table(conversation_id uuid, body text, updated_at timestamptz)
language sql stable security definer set search_path = public, dating_private as $$
  select c.id, s.body, s.updated_at
  from dating_conversations c
  join dating_statuses s on s.user_id = case when c.user_a = auth.uid() then c.user_b else c.user_a end
  where c.kind = 'friend' and c.accepted_at is not null
    and (c.user_a = auth.uid() or c.user_b = auth.uid())
    and not dating_is_blocked(c.user_a, c.user_b);
$$;

-- The one call the app makes on open/refresh now also carries statuses.
create or replace function public.dating_summary() returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select jsonb_build_object(
    'convos',   coalesce((select jsonb_agg(to_jsonb(c)) from my_conversations() c), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(to_jsonb(r)) from incoming_requests() r), '[]'::jsonb),
    'pending',  my_pending_likes(),
    'my_status', (select jsonb_build_object('body', s.body, 'updated_at', s.updated_at) from dating_statuses s where s.user_id = auth.uid()),
    'friend_statuses', coalesce((select jsonb_agg(to_jsonb(f)) from friend_statuses() f), '[]'::jsonb)
  );
$$;

revoke all on function public.set_my_status(text) from public, anon;
revoke all on function public.clear_my_status() from public, anon;
revoke all on function public.friend_statuses() from public, anon;
grant execute on function public.set_my_status(text) to authenticated;
grant execute on function public.clear_my_status() to authenticated;
grant execute on function public.friend_statuses() to authenticated;
revoke all on function dating_private.friend_ids(uuid) from public, anon, authenticated;
