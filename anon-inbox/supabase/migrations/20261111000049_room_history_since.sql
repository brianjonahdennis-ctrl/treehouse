-- Group chats: the app's background "did I miss anything?" check now asks only for messages newer
-- than the last one it already has, instead of re-downloading the last 200 messages (and all their
-- reactions) every 20–60 seconds for everyone in a room. Same rules as room_history: your own room,
-- only messages since you joined, nothing from people you blocked.

set lock_timeout = '5s';

create or replace function public.room_history_since(p_after bigint, p_limit integer default 100)
returns table(id bigint, handle text, body text, created_at timestamptz, mine boolean, reactions jsonb, my_reactions text[], reply_to bigint, reply_handle text, reply_body text)
language sql stable security definer set search_path = public, dating_private as $$
  select r.id, r.handle, r.body, r.created_at, r.mine,
         room_reaction_counts(r.id),
         coalesce((select array_agg(x.emoji) from room_reactions x where x.message_id = r.id and x.user_id = auth.uid()), '{}'),
         r.reply_to, q.handle, left(q.body, 140)
  from (
    select x.id, x.handle, x.body, x.created_at, x.user_id = auth.uid() as mine, x.reply_to
    from room_members m
    join room_messages x on x.state = m.state and x.created_at >= m.joined_at and x.id > coalesce(p_after, 0)
    where m.user_id = auth.uid() and room_active(m.last_seen_at)
      and not exists (select 1 from dating_blocks b where b.blocker_id = auth.uid() and b.blocked_id = x.user_id)
    order by x.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 200)
  ) r
  left join room_messages q on q.id = r.reply_to
  order by r.id;
$$;
revoke all on function public.room_history_since(bigint, integer) from public, anon;
grant execute on function public.room_history_since(bigint, integer) to authenticated;

-- Right away, for app versions already on people's phones: room history returns at most the last 60
-- messages (was 200). Opening a room shows plenty, and each background check costs about a third.
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
    limit least(greatest(coalesce(p_limit, 60), 1), 60)
  ) r
  left join room_messages q on q.id = r.reply_to
  order by r.id;
$$;
