-- Push notifications in the Android app (Hydra, 16 Nov 2026).
-- The app gets a Firebase device token and saves it with save_native_push. It is stored in the same
-- push_subscriptions table as web push devices, as endpoint 'fcm:<token>' with no web keys, so every
-- existing notification (messages, requests, likes, matches, friends, calls, announcements) reaches the
-- app with no other change. The server sends 'fcm:' devices through Firebase (anon-inbox/fcm.js).
-- Only loosens two table checks and adds one function.

set lock_timeout = '5s';

alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_check;
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_check
  check ((endpoint ~ '^https://' or endpoint ~ '^fcm:[A-Za-z0-9_:-]{20,600}$') and char_length(endpoint) <= 1000);
alter table public.push_subscriptions alter column p256dh drop not null, alter column auth drop not null;
-- Web push devices still need both keys; app devices have none.
alter table public.push_subscriptions add constraint push_subscriptions_keys_check
  check (endpoint ~ '^fcm:' or (p256dh is not null and auth is not null)) not valid;
alter table public.push_subscriptions validate constraint push_subscriptions_keys_check;

create function public.save_native_push(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare
  ep text := 'fcm:' || coalesce(p_token, '');
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if ep !~ '^fcm:[A-Za-z0-9_:-]{20,600}$' then raise exception 'That device code isn’t valid.' using errcode = '22023'; end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (ep, auth.uid(), null, null)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = null, auth = null, created_at = now();
  -- Same limit as web push: the 10 newest devices per account.
  delete from push_subscriptions where user_id = auth.uid() and endpoint in (
    select endpoint from push_subscriptions where user_id = auth.uid() order by created_at desc offset 10);
end $$;
revoke execute on function public.save_native_push(text) from public, anon;
grant execute on function public.save_native_push(text) to authenticated;
-- Turning off / signing out uses the existing delete_push_subscription('fcm:<token>').
