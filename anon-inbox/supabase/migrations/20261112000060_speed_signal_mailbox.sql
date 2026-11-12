-- Speed Dating calls weren't connecting: the call-setup messages (offer, answer, network addresses)
-- were sent only through live broadcast, and under load most never reached the other phone.
-- Now every call-setup message is also kept in a small mailbox table, and each phone collects the
-- other's messages directly (every second or so, only while connecting). Live broadcast stays as a
-- faster extra path; the phones ignore duplicates by message number. Messages are deleted after an hour.

set lock_timeout = '5s';

create table if not exists public.speed_signals (
  id bigserial primary key,
  session_id uuid not null references public.speed_sessions (id) on delete cascade,
  from_role text not null check (from_role in ('a', 'b')),
  data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists speed_signals_session on public.speed_signals (session_id, id);
create index if not exists speed_signals_created on public.speed_signals (created_at);
alter table public.speed_signals enable row level security;
revoke all on public.speed_signals from public, anon, authenticated;

create or replace function public.speed_signal(p_session uuid, p_data jsonb) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); s speed_sessions%rowtype; sid bigint; role text;
begin
  select * into s from speed_sessions where id = p_session and me in (user_a, user_b) and ended_at is null;
  if not found then raise exception 'Date not found.' using errcode = 'P0002'; end if;
  if octet_length(p_data::text) > 20000 then raise exception 'Too big.' using errcode = '22023'; end if;
  if (select count(*) from speed_signals where session_id = s.id) >= 600 then return; end if;   -- runaway guard
  role := case when s.user_a = me then 'a' else 'b' end;
  insert into speed_signals (session_id, from_role, data) values (s.id, role, p_data) returning id into sid;
  delete from speed_signals where created_at < now() - interval '1 hour';
  begin
    perform realtime.send(jsonb_build_object('id', sid, 'from', role, 'data', p_data), 'signal', 'speed:' || s.id, true);
  exception when others then null;   -- the mailbox still has it
  end;
end $$;

-- The other person's call-setup messages after message number p_after (oldest first).
create or replace function public.speed_pull(p_session uuid, p_after bigint default 0) returns jsonb
language sql stable security definer set search_path = public, dating_private as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'from', g.from_role, 'data', g.data) order by g.id), '[]'::jsonb)
  from (
    select x.id, x.from_role, x.data
    from speed_signals x join speed_sessions s on s.id = x.session_id
    where x.session_id = p_session and auth.uid() in (s.user_a, s.user_b)
      and x.from_role <> case when s.user_a = auth.uid() then 'a' else 'b' end
      and x.id > coalesce(p_after, 0)
    order by x.id
    limit 200
  ) g;
$$;
revoke all on function public.speed_pull(uuid, bigint) from public, anon;
grant execute on function public.speed_pull(uuid, bigint) to authenticated;
