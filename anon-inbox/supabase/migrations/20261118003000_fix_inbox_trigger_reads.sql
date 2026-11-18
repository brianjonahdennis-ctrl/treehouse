-- Hotfix (18 Nov 2026): migration 20261118001235's shared trigger function compared new.sender_id in
-- one IF condition together with tg_table_name. PL/pgSQL resolves every field in that expression, so
-- an UPDATE on dating_reads or dating_cleared (which have no sender_id) failed with
-- 'record "new" has no field "sender_id"': marking chats as read and re-clearing a chat broke.
-- Each table's comparison now sits in its own branch, so only that table's fields are read.

set lock_timeout = '5s';

create or replace function dating_private.inbox_conversation_child_changed() returns trigger
language plpgsql security definer set search_path = public, dating_private as $$
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'dating_messages' then
      if row(new.conversation_id, new.sender_id, new.body, new.created_at, new.deleted_at)
         is not distinct from
         row(old.conversation_id, old.sender_id, old.body, old.created_at, old.deleted_at) then
        return new;
      end if;
    elsif tg_table_name = 'dating_reads' then
      if row(new.conversation_id, new.user_id, new.last_read_at)
         is not distinct from
         row(old.conversation_id, old.user_id, old.last_read_at) then
        return new;
      end if;
    elsif tg_table_name = 'dating_cleared' then
      if row(new.conversation_id, new.user_id, new.cleared_at)
         is not distinct from
         row(old.conversation_id, old.user_id, old.cleared_at) then
        return new;
      end if;
    end if;
  end if;

  -- The conversation row itself bumps both members when its dependent rows are cascade-deleted.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;

  -- A member's local "delete chat" action only hides that chat for them.
  if tg_table_name = 'dating_cleared' then
    if tg_op = 'DELETE' then
      perform dating_private.bump_inbox_users(array[old.user_id]);
      return old;
    end if;
    perform dating_private.bump_inbox_users(array[new.user_id]);
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform dating_private.bump_inbox_conversation(old.conversation_id);
    return old;
  end if;
  perform dating_private.bump_inbox_conversation(new.conversation_id);
  return new;
end $$;
revoke all on function dating_private.inbox_conversation_child_changed() from public, anon, authenticated;
