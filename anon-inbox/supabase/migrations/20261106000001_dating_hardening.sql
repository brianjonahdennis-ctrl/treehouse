-- Hardening from the Supabase security advisor.
--  1. Internal helpers and trigger functions move to a private schema the web API doesn't expose,
--     so they can't be called directly over /rest/v1/rpc. Policies keep working (they reference
--     functions by id) and the app-facing functions find them through their search_path.
--  2. Policies evaluate auth.uid() once per query instead of once per row.

create schema if not exists dating_private;
revoke all on schema dating_private from public, anon;
grant usage on schema dating_private to authenticated;   -- needed by the row-level policies

alter function public.dating_is_participant(uuid, uuid) set schema dating_private;
alter function public.dating_partner(uuid, uuid)        set schema dating_private;
alter function public.dating_is_blocked(uuid, uuid)     set schema dating_private;
alter function public.dating_both_revealed(uuid)        set schema dating_private;
alter function public.dating_new_handle()               set schema dating_private;
alter function public.dating_message_rate_limit()       set schema dating_private;
alter function public.touch_updated_at()                set schema dating_private;

alter function dating_private.touch_updated_at()          set search_path = '';
alter function dating_private.dating_message_rate_limit() set search_path = public;
revoke execute on function dating_private.dating_message_rate_limit(), dating_private.touch_updated_at(),
  dating_private.dating_new_handle() from public, anon, authenticated;

-- App-facing functions look helpers up by name, so add the private schema to their search path.
alter function public.create_my_profile(text, public.dating_gender, int, text, public.dating_intent) set search_path = public, dating_private;
alter function public.discover_profiles(int)                         set search_path = public, dating_private;
alter function public.start_conversation(text)                       set search_path = public, dating_private;
alter function public.my_conversations()                             set search_path = public, dating_private;
alter function public.revealed_details(uuid)                         set search_path = public, dating_private;
alter function public.block_conversation_partner(uuid)               set search_path = public, dating_private;
alter function public.report_conversation_partner(uuid, text, text)  set search_path = public, dating_private;
alter function dating_private.dating_both_revealed(uuid)             set search_path = public;
alter function dating_private.dating_is_participant(uuid, uuid)      set search_path = public;
alter function dating_private.dating_partner(uuid, uuid)             set search_path = public;
alter function dating_private.dating_is_blocked(uuid, uuid)          set search_path = public;
alter function dating_private.dating_new_handle()                    set search_path = public;

-- Policies: same rules, auth.uid() evaluated once per query.
drop policy "Owners read their own profile" on public.dating_profiles;
create policy "Owners read their own profile" on public.dating_profiles for select to authenticated
  using (user_id = (select auth.uid()));
drop policy "Owners update their own profile" on public.dating_profiles;
create policy "Owners update their own profile" on public.dating_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy "Owners delete their own profile" on public.dating_profiles;
create policy "Owners delete their own profile" on public.dating_profiles for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy "Participants read their conversations" on public.dating_conversations;
create policy "Participants read their conversations" on public.dating_conversations for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

drop policy "Participants read messages" on public.dating_messages;
create policy "Participants read messages" on public.dating_messages for select to authenticated
  using (dating_private.dating_is_participant(conversation_id, (select auth.uid())));
drop policy "Participants send messages unless blocked" on public.dating_messages;
create policy "Participants send messages unless blocked" on public.dating_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and dating_private.dating_is_participant(conversation_id, (select auth.uid()))
    and not dating_private.dating_is_blocked((select auth.uid()), dating_private.dating_partner(conversation_id, (select auth.uid())))
  );

drop policy "Participants see reveal requests" on public.dating_reveals;
create policy "Participants see reveal requests" on public.dating_reveals for select to authenticated
  using (dating_private.dating_is_participant(conversation_id, (select auth.uid())));
drop policy "Participants ask to reveal" on public.dating_reveals;
create policy "Participants ask to reveal" on public.dating_reveals for insert to authenticated
  with check (user_id = (select auth.uid()) and dating_private.dating_is_participant(conversation_id, (select auth.uid())));
drop policy "Cancel own reveal before it is mutual" on public.dating_reveals;
create policy "Cancel own reveal before it is mutual" on public.dating_reveals for delete to authenticated
  using (user_id = (select auth.uid()) and not dating_private.dating_both_revealed(conversation_id));

drop policy "Users see who they blocked" on public.dating_blocks;
create policy "Users see who they blocked" on public.dating_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));
drop policy "Users unblock" on public.dating_blocks;
create policy "Users unblock" on public.dating_blocks for delete to authenticated
  using (blocker_id = (select auth.uid()));

drop policy "Reporters see their own reports" on public.dating_reports;
create policy "Reporters see their own reports" on public.dating_reports for select to authenticated
  using (reporter_id = (select auth.uid()));
