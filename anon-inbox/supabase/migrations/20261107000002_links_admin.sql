-- Owner moderation for personal links: reported messages and link suspensions.
-- Needs the admin key; shows the username, prompt and reported text - never emails or names.
create function public.admin_link_reports(p_key text, p_status text default 'open')
returns table (
  id bigint, created_at timestamptz, status text, reason text, body text,
  username text, prompt text, link_suspended boolean, reports_for_link int
)
language plpgsql stable security definer set search_path = public, dating_private as $$
begin
  if not dating_private.admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query
  select r.id, r.created_at, r.status, r.reason, r.body,
         l.username, l.prompt, l.suspended,
         (select count(*)::int from link_reports x where x.owner_id = r.owner_id)
  from link_reports r join links l on l.user_id = r.owner_id
  where p_status = 'all' or r.status = p_status
  order by r.created_at desc
  limit 200;
end $$;

create function public.admin_set_link_report_status(p_key text, p_id bigint, p_status text) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if not dating_private.admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  update link_reports set status = p_status where id = p_id;
end $$;

-- Suspend (or restore) the link a report came from, e.g. for an abusive username or prompt.
create function public.admin_suspend_link(p_key text, p_report bigint, p_suspend boolean) returns void
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if not dating_private.admin_ok(p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  update links set suspended = p_suspend where user_id = (select owner_id from link_reports where id = p_report);
  if p_suspend then update link_reports set status = 'actioned' where id = p_report; end if;
end $$;

revoke execute on function public.admin_link_reports(text, text), public.admin_set_link_report_status(text, bigint, text),
  public.admin_suspend_link(text, bigint, boolean) from public;
grant execute on function public.admin_link_reports(text, text), public.admin_set_link_report_status(text, bigint, text),
  public.admin_suspend_link(text, bigint, boolean) to anon, authenticated;
