-- Lighter chatroom list (Hydra, 16 Nov 2026, cost review). room_list() counted every room's members
-- (people and online) on each call, ~640,000 calls in two days, about 9% of all database time. The
-- counts are the same for everyone, so they're now worked out once every 20 seconds into room_counts
-- and room_list() reads them. Your own room, your unread count and room rules are unchanged.
-- Undo: restore room_list from 20261108000017_room_30min_200_places.sql (or later) and
-- select cron.unschedule('room-counts').

set lock_timeout = '5s';

create table if not exists dating_private.room_counts (
  state  text primary key,
  people integer not null default 0,
  online integer not null default 0,
  at     timestamptz not null default now()
);
alter table dating_private.room_counts enable row level security;
revoke all on dating_private.room_counts from public, anon, authenticated;

create or replace function dating_private.refresh_room_counts() returns void
language sql security definer set search_path = public, dating_private as $$
  insert into room_counts (state, people, online, at)
  select m.state,
         count(*) filter (where room_active(m.last_seen_at))::int,
         count(*) filter (where room_online(m.last_seen_at))::int,
         now()
  from room_members m
  group by m.state
  on conflict (state) do update set people = excluded.people, online = excluded.online, at = excluded.at;
  update room_counts c set people = 0, online = 0, at = now()
  where (c.people <> 0 or c.online <> 0) and not exists (select 1 from room_members m where m.state = c.state);
$$;
revoke all on function dating_private.refresh_room_counts() from public, anon, authenticated;

create or replace function public.room_list()
 returns table(state text, people integer, mine boolean, online integer, unread integer, capacity integer)
 language sql
 stable security definer
 set search_path to 'public', 'dating_private'
as $function$
  select s.state,
         coalesce(rc.people, 0),
         me.user_id is not null,
         coalesce(rc.online, 0),
         case when me.user_id is null then 0 else
           (select count(*)::int from (
              select 1 from room_messages x
              where x.state = s.state and x.id > me.last_read_id and x.created_at >= me.joined_at and x.user_id <> me.user_id
              limit 1000) c)
         end,
         room_capacity(s.state)
  from unnest(visible_rooms(auth.uid())) with ordinality as s(state, ord)
  left join room_counts rc on rc.state = s.state
  left join room_members me on me.state = s.state and me.user_id = auth.uid() and room_active(me.last_seen_at)
  order by s.ord;
$function$;

select dating_private.refresh_room_counts();
select cron.unschedule('room-counts') where exists (select 1 from cron.job where jobname = 'room-counts');
select cron.schedule('room-counts', '20 seconds', 'select dating_private.refresh_room_counts()');
