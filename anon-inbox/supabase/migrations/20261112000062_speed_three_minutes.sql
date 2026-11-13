-- Speed Dating dates are now 3 minutes long (were 5). Hydra's decision, 12 Nov 2026.
-- The length lives in one place: dating_private.speed_date_length().

set lock_timeout = '5s';

create or replace function dating_private.speed_date_length() returns interval
language sql immutable as $$ select interval '3 minutes' $$;

create or replace function public.speed_ready(p_session uuid) returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare me uuid := auth.uid(); s speed_sessions%rowtype;
begin
  select * into s from speed_sessions where id = p_session and me in (user_a, user_b) for update;
  if not found then raise exception 'Date not found.' using errcode = 'P0002'; end if;
  if s.ended_at is null then
    if s.user_a = me then update speed_sessions set a_ready = coalesce(a_ready, now()), a_seen = now() where id = s.id;
    else update speed_sessions set b_ready = coalesce(b_ready, now()), b_seen = now() where id = s.id; end if;
    update speed_sessions set started_at = now(), ends_at = now() + dating_private.speed_date_length()
    where id = s.id and started_at is null and a_ready is not null and b_ready is not null;
  end if;
  perform speed_tick(p_session);
  return speed_view(p_session, me);
end $$;
