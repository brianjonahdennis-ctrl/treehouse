-- Let people delete their whole dating account: their sign-in (email), profile, chats, messages,
-- reveal requests, blocks and reports all go, via the ON DELETE CASCADE references.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  -- Chats are shared, so remove the whole conversation (both sides) when either person leaves.
  delete from dating_conversations where uid in (user_a, user_b);
  delete from auth.users where id = uid;
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
