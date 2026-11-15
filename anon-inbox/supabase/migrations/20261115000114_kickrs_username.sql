-- Kickrs shows the member's treehouse username when they have chosen one (Hydra, 15 Nov 2026).
-- Members without a username still go to Kickrs with their nickname, exactly as before.
-- Only the name in the Kickrs pass changes; the checks, Kickrs id and avatar stay the same.

set lock_timeout = '5s';

create or replace function public.kickrs_identity() returns table (kickrs_id uuid, handle text, avatar jsonb)
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
begin
  perform kickrs_check(uid);
  if not exists (select 1 from kickrs_links l where l.user_id = uid and l.revoked_at is null) then
    raise exception 'Allow Kickrs first.' using errcode = 'P0001';
  end if;
  return query
    select l.kickrs_id, coalesce(u.username, p.handle), a.config
    from kickrs_links l
    join dating_profiles p on p.user_id = l.user_id
    left join usernames u on u.user_id = l.user_id
    left join user_avatars a on a.user_id = l.user_id
    where l.user_id = uid;
end $$;
revoke all on function public.kickrs_identity() from public, anon;
grant execute on function public.kickrs_identity() to authenticated;
