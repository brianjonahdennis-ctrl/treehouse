-- Take back a friend request or message request you sent, before they accept it. The request (and
-- the messages you sent with it) disappear for both of you, as if it was never sent.
-- Rules: only the person who sent it; only while it's still waiting; not once it's been reported
-- (the report keeps it as evidence); at most 20 cancels a day, so "send, cancel, send again" can't be
-- used to keep pinging someone.

set lock_timeout = '5s';

create table if not exists dating_private.request_cancels (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists request_cancels_user_at on dating_private.request_cancels (user_id, at);
alter table dating_private.request_cancels enable row level security;
revoke all on dating_private.request_cancels from public, anon, authenticated;

create or replace function public.cancel_request(p_conversation uuid) returns void
language plpgsql security definer set search_path = public, dating_private as $$
declare
  uid uuid := auth.uid();
  c dating_conversations%rowtype;
begin
  if uid is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select * into c from dating_conversations where id = p_conversation and started_by = uid for update;
  if not found then raise exception 'Request not found.' using errcode = 'P0002'; end if;
  if c.accepted_at is not null then
    raise exception 'They already accepted, so it''s a chat now. You can delete or block it from the chat menu.' using errcode = 'P0001';
  end if;
  if exists (select 1 from dating_reports r where r.conversation_id = c.id) then
    raise exception 'This request can''t be cancelled.' using errcode = 'P0001';
  end if;
  delete from request_cancels where user_id = uid and at < now() - interval '2 days';
  if (select count(*) from request_cancels where user_id = uid and at > now() - interval '1 day') >= 20 then
    raise exception 'You''ve cancelled a lot of requests today. Try again tomorrow.' using errcode = 'P0001';
  end if;
  delete from dating_conversations where id = c.id;
  insert into request_cancels (user_id) values (uid);
end $$;
revoke all on function public.cancel_request(uuid) from public, anon;
grant execute on function public.cancel_request(uuid) to authenticated;
