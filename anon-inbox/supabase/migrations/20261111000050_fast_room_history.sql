-- Group chats open fast again. room_history used to read EVERY message in the room from the past
-- week (~27,000 in the busiest room), check each one against the block list, sort them all, and only
-- then keep the newest 60: ~440 ms per call, run by everyone in a room every minute.
-- Now: an index on (room, time) lets it read just the newest messages since you joined, newest first,
-- and stop as soon as it has enough. Blocked people's messages are filtered from that short list.
-- Same rules as before: your own room, only messages since you joined, nothing from people you blocked.

set lock_timeout = '5s';

create index if not exists room_messages_state_time on public.room_messages (state, created_at desc, id desc);

create or replace function public.room_history(p_limit integer default 60)
returns table(id bigint, handle text, body text, created_at timestamptz, mine boolean, reactions jsonb, my_reactions text[], reply_to bigint, reply_handle text, reply_body text)
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  s text;
  since timestamptz;
  n int := least(greatest(coalesce(p_limit, 60), 1), 60);
begin
  select m.state, m.joined_at into s, since from room_members m where m.user_id = me and room_active(m.last_seen_at);
  if s is null then return; end if;
  return query
    select r.id, r.handle, r.body, r.created_at, r.user_id = me,
           room_reaction_counts(r.id),
           coalesce((select array_agg(x.emoji) from room_reactions x where x.message_id = r.id and x.user_id = me), '{}'),
           r.reply_to, q.handle, left(q.body, 140)
    from (
      select c.* from (
        select x.id, x.handle, x.body, x.created_at, x.user_id, x.reply_to
        from room_messages x
        where x.state = s and x.created_at >= since
        order by x.created_at desc, x.id desc
        limit n * 2
      ) c
      where not exists (select 1 from dating_blocks b where b.blocker_id = me and b.blocked_id = c.user_id)
      order by c.created_at desc, c.id desc
      limit n
    ) r
    left join room_messages q on q.id = r.reply_to
    order by r.id;
end $$;

create or replace function public.room_history_since(p_after bigint, p_limit integer default 100)
returns table(id bigint, handle text, body text, created_at timestamptz, mine boolean, reactions jsonb, my_reactions text[], reply_to bigint, reply_handle text, reply_body text)
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  s text;
  since timestamptz;
  n int := least(greatest(coalesce(p_limit, 100), 1), 200);
  after_at timestamptz;
begin
  select m.state, m.joined_at into s, since from room_members m where m.user_id = me and room_active(m.last_seen_at);
  if s is null then return; end if;
  -- Start from the time of the last message the phone already has (so the index range stays tiny).
  select greatest(since, x.created_at) into after_at from room_messages x where x.id = p_after;
  return query
    select r.id, r.handle, r.body, r.created_at, r.user_id = me,
           room_reaction_counts(r.id),
           coalesce((select array_agg(x.emoji) from room_reactions x where x.message_id = r.id and x.user_id = me), '{}'),
           r.reply_to, q.handle, left(q.body, 140)
    from (
      select c.* from (
        select x.id, x.handle, x.body, x.created_at, x.user_id, x.reply_to
        from room_messages x
        where x.state = s and x.created_at >= coalesce(after_at, since) and x.id > coalesce(p_after, 0)
        order by x.created_at desc, x.id desc
        limit n * 2
      ) c
      where not exists (select 1 from dating_blocks b where b.blocker_id = me and b.blocked_id = c.user_id)
      order by c.created_at desc, c.id desc
      limit n
    ) r
    left join room_messages q on q.id = r.reply_to
    order by r.id;
end $$;
revoke all on function public.room_history_since(bigint, integer) from public, anon;
grant execute on function public.room_history_since(bigint, integer) to authenticated;
