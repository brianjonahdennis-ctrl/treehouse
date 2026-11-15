-- Voice notes were slow and heavy on the database (15 Nov 2026): every send, play and file clean-up
-- looked up dating_messages.voice, which had no index, so each one read all ~4.7 million messages
-- (1-2 seconds of database work each; about 9% of all database time from ~2,000 voice notes).
-- A small partial index (only rows that have a voice note) makes those lookups instant.
-- On live it was created first with CREATE INDEX CONCURRENTLY (no locking); here it's a no-op then.
create index if not exists dating_messages_voice on public.dating_messages (voice) where voice is not null;
