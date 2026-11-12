-- Chatroom replies, like WhatsApp: a message can quote an earlier message in the same room.
-- Only the quoted person's room name and a short preview (up to 140 characters) travel with the reply.

alter table public.room_messages add column if not exists reply_to bigint references public.room_messages (id) on delete set null;

-- Send a message, optionally as a reply to a message in your room.
drop function public.send_room_message(text);
create function public.send_room_message(p_body text, p_reply_to bigint default null)
returns table (id bigint, handle text, body text, created_at timestamptz, reply_to bigint, reply_handle text, reply_body text)
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  m record;
  text_in text := btrim(coalesce(p_body, ''));
  q_handle text;
  q_body text;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into m from room_members r where r.user_id = uid and room_active(r.last_seen_at);
  if not found then raise exception 'Join a room first.' using errcode = 'P0002'; end if;
  if char_length(text_in) not between 1 and 500 then
    raise exception 'Messages can be 1 to 500 characters.' using errcode = '22023';
  end if;
  if (select count(*) from room_messages x where x.user_id = uid and x.created_at > now() - interval '10 seconds') >= 5 then
    raise exception 'Slow down a little: you can send 5 messages every 10 seconds.' using errcode = 'P0001';
  end if;
  if p_reply_to is not null then
    select x.handle, x.body into q_handle, q_body from room_messages x where x.id = p_reply_to and x.state = m.state;
    if not found then raise exception 'That message isn''t in this room anymore.' using errcode = 'P0002'; end if;
  end if;
  update room_members set last_seen_at = now() where user_id = uid;
  -- Keep rooms light: messages older than a week are cleared now and then.
  if random() < 0.02 then delete from room_messages x where x.state = m.state and x.created_at < now() - interval '7 days'; end if;
  return query
    with ins as (
      insert into room_messages (state, user_id, handle, body, reply_to)
      values (m.state, uid, m.handle, text_in, p_reply_to)
      returning room_messages.id, room_messages.handle, room_messages.body, room_messages.created_at, room_messages.reply_to
    )
    select ins.id, ins.handle, ins.body, ins.created_at, ins.reply_to,
           q_handle, left(q_body, 140)
    from ins;
end $$;
revoke execute on function public.send_room_message(text, bigint) from public, anon;
grant execute on function public.send_room_message(text, bigint) to authenticated;

-- History (live-only, as before) now includes what each message replies to.
drop function public.room_history(int);
create function public.room_history(p_limit int default 60)
returns table (id bigint, handle text, body text, created_at timestamptz, mine boolean, reactions jsonb, my_reactions text[],
               reply_to bigint, reply_handle text, reply_body text)
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
    order by x.id desc
    limit least(greatest(coalesce(p_limit, 60), 1), 200)
  ) r
  left join room_messages q on q.id = r.reply_to
  order by r.id;
$$;
revoke execute on function public.room_history(int) from public, anon;
grant execute on function public.room_history(int) to authenticated;

-- Live delivery carries the quote too.
create or replace function dating_private.room_broadcast() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  q_handle text;
  q_body text;
begin
  if new.reply_to is not null then select handle, body into q_handle, q_body from room_messages where id = new.reply_to; end if;
  perform realtime.send(
    jsonb_build_object('id', new.id, 'handle', new.handle, 'body', new.body, 'created_at', new.created_at,
                       'reply_to', new.reply_to, 'reply_handle', q_handle, 'reply_body', left(q_body, 140)),
    'message', 'room:' || new.state, true);
  return null;
end $$;
