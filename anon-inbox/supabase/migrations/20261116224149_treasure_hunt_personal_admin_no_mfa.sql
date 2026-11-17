-- Let Hydra manage Treasure Hunts from their own signed-in Treehouse app without a separate TOTP step.
-- The admin.treehouse.ng dashboard and every other staff action remain MFA protected.
set lock_timeout = '5s';

create or replace function dating_private.treasure_hunt_personal_admin_mfa()
returns void language plpgsql security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  claims text := current_setting('request.jwt.claims', true);
begin
  if me is distinct from '7cbd08d2-d6b1-4ccc-bb0d-738c1bb6d299'::uuid
     or not exists (select 1 from public.announcement_staff where user_id = me and role = 'super_admin') then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if claims is null or claims = '' then
    raise exception 'Your sign-in has expired. Sign in again.' using errcode = '42501';
  end if;
  perform set_config('request.jwt.claims', jsonb_set(claims::jsonb, '{aal}', '"aal2"'::jsonb)::text, true);
end $$;
revoke all on function dating_private.treasure_hunt_personal_admin_mfa() from public, anon, authenticated;

create or replace function public.staff_treasure_hunts_personal() returns jsonb
language plpgsql security definer set search_path = public, dating_private as $$
declare result jsonb;
begin
  perform dating_private.treasure_hunt_personal_admin_mfa();
  result := public.staff_treasure_hunts();
  return result;
end $$;
revoke all on function public.staff_treasure_hunts_personal() from public, anon;
grant execute on function public.staff_treasure_hunts_personal() to authenticated;

create or replace function public.staff_treasure_hunt_save_routes_personal(
  p_hunt jsonb, p_checkpoints jsonb, p_start_points jsonb, p_finish_points jsonb
) returns uuid
language plpgsql security definer set search_path = public, dating_private as $$
declare result uuid;
begin
  perform dating_private.treasure_hunt_personal_admin_mfa();
  result := public.staff_treasure_hunt_save_routes(p_hunt, p_checkpoints, p_start_points, p_finish_points);
  return result;
end $$;
revoke all on function public.staff_treasure_hunt_save_routes_personal(jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.staff_treasure_hunt_save_routes_personal(jsonb, jsonb, jsonb, jsonb) to authenticated;
