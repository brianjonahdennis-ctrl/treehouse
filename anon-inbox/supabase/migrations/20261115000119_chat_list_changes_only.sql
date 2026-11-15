-- Less data to phones (Hydra, 15 Nov 2026): the chat list was sent in full on every refresh (~29 KB on
-- average, up to 160 KB, ~470,000 times a day), about half of all data Supabase sent to phones.
-- dating_summary_changes(p_known, p_req) works out the same list as dating_summary(), but the phone
-- says what it already has (conversation id → a short fingerprint of that row, plus a fingerprint of
-- its likes list) and gets back only rows that changed, ids it should drop, and the likes list only when
-- it changed. What a phone sends up isn't billed; what comes down is. Same data, same rules.

set lock_timeout = '5s';

create or replace function public.dating_summary_changes(p_known jsonb default '{}'::jsonb, p_req text default '')
returns jsonb
language plpgsql stable security definer set search_path = public, dating_private as $$
declare
  me uuid := auth.uid();
  known jsonb := case when jsonb_typeof(p_known) = 'object' then p_known else '{}'::jsonb end;
  req jsonb; req_fp text;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  req := coalesce((select jsonb_agg(to_jsonb(r)) from incoming_requests() r), '[]'::jsonb);
  req_fp := left(md5(req::text), 12);
  return (
    with c as (select to_jsonb(x) as j from my_conversations() x),
    f as (select j, j ->> 'conversation_id' as id, left(md5(j::text), 12) as fp from c)
    select jsonb_build_object(
      'changed', coalesce((select jsonb_agg(f.j || jsonb_build_object('_fp', f.fp)) from f where known ->> f.id is distinct from f.fp), '[]'::jsonb),
      'removed', coalesce((select jsonb_agg(k.key) from jsonb_object_keys(known) k(key) where not exists (select 1 from f where f.id = k.key)), '[]'::jsonb),
      'requests', case when req_fp = coalesce(p_req, '') then null else req end,
      'req_fp', req_fp,
      'pending', my_pending_likes(),
      'my_status', (select jsonb_build_object('body', s.body, 'updated_at', s.updated_at) from dating_statuses s where s.user_id = me),
      'friend_statuses', coalesce((select jsonb_agg(to_jsonb(fs)) from friend_statuses() fs), '[]'::jsonb),
      'origins', coalesce((select jsonb_object_agg(o.id, o.origin) from (
          select d.id, d.origin from dating_conversations d where d.user_a = me and d.origin is not null
          union all
          select d.id, d.origin from dating_conversations d where d.user_b = me and d.origin is not null) o), '{}'::jsonb))
  );
end $$;
revoke execute on function public.dating_summary_changes(jsonb, text) from public, anon;
grant execute on function public.dating_summary_changes(jsonb, text) to authenticated;
