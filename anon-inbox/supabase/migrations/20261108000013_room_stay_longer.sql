-- Minimizing the app no longer drops you from a chatroom. Phones pause apps in the background, so
-- the app can't check in; you now stay in the room for 30 minutes without checking in (it was 3).
-- Leaving, or joining another room, still takes you out straight away.
create or replace function dating_private.room_active(seen timestamptz) returns boolean
language sql stable as $$ select seen > now() - interval '30 minutes' $$;
