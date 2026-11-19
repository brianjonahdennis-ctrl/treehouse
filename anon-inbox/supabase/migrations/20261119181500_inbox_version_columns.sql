-- Two new counters for the chat list's partial refresh (step 3, 20261120010000). Adding columns with a
-- constant default only changes the table's description (instant); current code ignores them.
set lock_timeout = '3s';
alter table dating_private.inbox_version add column if not exists full_v bigint not null default 0;
alter table dating_private.inbox_version add column if not exists likes_v bigint not null default 0;
