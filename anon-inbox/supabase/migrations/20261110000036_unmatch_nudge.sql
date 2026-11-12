-- Unmatch / block: tell the other person's app straight away, so the chat closes on their side
-- without waiting for the next refresh. The nudge carries only the chat id.
create or replace function public.unmatch_conversation(p_conversation uuid) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  other uuid := dating_partner(p_conversation, auth.uid());
begin
  if other is null then raise exception 'Conversation not found.' using errcode = 'P0002'; end if;
  insert into dating_likes (from_user, to_user, liked) values (auth.uid(), other, false)
  on conflict (from_user, to_user) do update set liked = false, created_at = now();
  insert into dating_blocks (blocker_id, blocked_id) values (auth.uid(), other) on conflict do nothing;
  begin
    perform realtime.send(jsonb_build_object('k', 'closed', 'c', p_conversation), 'inbox', 'user:' || other, true);
  exception when others then null;
  end;
end $$;

create or replace function public.block_conversation_partner(p_conversation uuid) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  other uuid := dating_partner(p_conversation, auth.uid());
begin
  if other is null then raise exception 'Conversation not found.' using errcode = 'P0002'; end if;
  insert into dating_blocks (blocker_id, blocked_id) values (auth.uid(), other) on conflict do nothing;
  begin
    perform realtime.send(jsonb_build_object('k', 'closed', 'c', p_conversation), 'inbox', 'user:' || other, true);
  exception when others then null;
  end;
end $$;
