-- Run a minute after 20261120010000. Any chat-list bump that began before the switch used the old
-- functions and left no change record; marking those rows as a full change makes the next refresh a
-- full rebuild (never a partial one that could miss something). Rows bumped later than switch+5 s are
-- left alone. Safe to run twice.
set lock_timeout = '5s';
with locked as (
  select iv.user_id from dating_private.inbox_version iv
  where iv.full_v < iv.v
    and iv.updated_at < (select switched_at + interval '5 seconds' from dating_private.inbox_partial_switch where id = 1)
  order by iv.user_id for update
)
update dating_private.inbox_version iv set full_v = iv.v from locked where locked.user_id = iv.user_id;
