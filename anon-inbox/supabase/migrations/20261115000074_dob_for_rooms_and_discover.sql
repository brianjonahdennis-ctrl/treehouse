-- 18+ gate for older accounts (15 Nov 2026): accounts made before sign-up required a date of birth (about
-- 16,000) must add one before they join or post in chatrooms, like people, join Speed Dating, or browse
-- Discover / Nearby.
-- The date of birth is private and decides the age (under 18 → suspended, as before).
--
-- Rooms and likes are checked with table triggers (so every way in is covered, whichever function does
-- the insert). Discover and Nearby get a small check in front: the existing functions are moved to
-- dating_private unchanged (…_inner) and the public name now checks first, then returns their result.
-- NOTE for later migrations: to change discover_cards / discover_profiles / nearby_people, edit the
-- dating_private.*_inner function, or keep the dating_private.require_dob() call in a new public version.
-- The app shows a "Add your date of birth" card instead of these screens; errors carry hint 'needs_dob'.

set lock_timeout = '5s';

create function dating_private.has_dob(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from dating_profiles where user_id = p_user and birth_date is not null and dob_underage_at is null);
$$;

create function dating_private.require_dob() returns void
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  if auth.uid() is not null and not has_dob(auth.uid()) then
    raise exception 'Add your date of birth first. It’s private, and keeps treehouse 18+.' using errcode = '42501', hint = 'needs_dob';
  end if;
end $$;
revoke all on function dating_private.has_dob(uuid), dating_private.require_dob() from public, anon;
grant execute on function dating_private.require_dob() to authenticated;

-- Signed-out visitors (auth.uid() is null) are not affected, so public card browsing stays as it was.
-- Only the person acting is checked (auth.uid()); the server, owner tools and cron jobs aren't affected.
create function dating_private.dob_guard() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
declare who uuid := (to_jsonb(new) ->> case when tg_table_name = 'dating_likes' then 'from_user' else 'user_id' end)::uuid;
begin
  if auth.uid() is not null and who = auth.uid() and not has_dob(who) then
    raise exception 'Add your date of birth first. It’s private, and keeps treehouse 18+.' using errcode = '42501', hint = 'needs_dob';
  end if;
  return new;
end $$;
revoke all on function dating_private.dob_guard() from public, anon, authenticated;

create trigger room_members_need_dob before insert on public.room_members for each row execute function dating_private.dob_guard();
create trigger room_messages_need_dob before insert on public.room_messages for each row execute function dating_private.dob_guard();
create trigger dating_likes_need_dob before insert or update on public.dating_likes for each row execute function dating_private.dob_guard();
create trigger speed_queue_need_dob before insert on public.speed_queue for each row execute function dating_private.dob_guard();

-- Discover and Nearby: same functions, with the check in front.
do $do$
declare
  f record;
  inner_name text;
  call_args text;
  anon_ok boolean;
begin
  for f in
    select p.oid, p.proname, pg_get_function_arguments(p.oid) args, pg_get_function_identity_arguments(p.oid) iargs,
           pg_get_function_result(p.oid) res,
           (select string_agg(quote_ident(n), ', ' order by o)
              from unnest(p.proargnames, coalesce(p.proargmodes, array_fill('i'::"char", array[cardinality(p.proargnames)]))) with ordinality a(n, m, o)
             where m in ('i', 'b')) names
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('discover_cards', 'discover_profiles', 'nearby_people')
  loop
    inner_name := f.proname || '_inner';
    anon_ok := has_function_privilege('anon', f.oid, 'execute');   -- keep who may call it exactly as before
    call_args := coalesce(f.names, '');
    execute format('alter function public.%I(%s) rename to %I', f.proname, f.iargs, inner_name);
    execute format('alter function public.%I(%s) set schema dating_private', inner_name, f.iargs);
    execute format('revoke all on function dating_private.%I(%s) from public, anon, authenticated', inner_name, f.iargs);
    execute format($w$create function public.%I(%s) returns %s
      language plpgsql security definer set search_path = public, dating_private as $b$
      begin
        perform dating_private.require_dob();
        return query select * from dating_private.%I(%s);
      end $b$$w$, f.proname, f.args, f.res, inner_name, call_args);
    execute format('revoke all on function public.%I(%s) from public, anon', f.proname, f.iargs);
    execute format('grant execute on function public.%I(%s) to authenticated', f.proname, f.iargs);
    if anon_ok then execute format('grant execute on function public.%I(%s) to anon', f.proname, f.iargs); end if;
  end loop;
end $do$;
