-- Fix for 20261118210000: Postgres patterns allow at most 255 repeats, so '{20,600}' was an invalid
-- pattern. Check the token's characters with '+' and its length with char_length instead.

set lock_timeout = '5s';

alter table public.push_subscriptions drop constraint if exists push_subscriptions_endpoint_check;
alter table public.push_subscriptions add constraint push_subscriptions_endpoint_check
  check ((endpoint ~ '^https://' or (endpoint ~ '^fcm:[A-Za-z0-9_:-]+$' and char_length(endpoint) >= 24)) and char_length(endpoint) <= 1000);

create or replace function public.save_native_push(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare
  ep text := 'fcm:' || coalesce(p_token, '');
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if ep !~ '^fcm:[A-Za-z0-9_:-]+$' or char_length(p_token) not between 20 and 600 then
    raise exception 'That device code isn’t valid.' using errcode = '22023';
  end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (ep, auth.uid(), null, null)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = null, auth = null, created_at = now();
  delete from push_subscriptions where user_id = auth.uid() and endpoint in (
    select endpoint from push_subscriptions where user_id = auth.uid() order by created_at desc offset 10);
end $$;
