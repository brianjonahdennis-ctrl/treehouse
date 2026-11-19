Make the treehouse chat list (inbox) refresh much cheaper for the database. Repo `brianjonahdennis-ctrl/treehouse`: start from the `nextjs` branch and open a PR into `nextjs`.

## Why
Supabase (Large compute) reaches about 75% CPU every evening. The single biggest cost is `dating_summary_changes`, the chat-list refresh. At peak:
- it uses **about 44% of all database time**
- it runs about 540 times a minute, at about **80 ms per call**

Migration 119 made it send less **data**, but the database still rebuilds the member's **whole** chat list on every call: `my_conversations()`, `incoming_requests()`, `my_pending_likes()`, `friend_statuses()`, origins and md5 fingerprints. It does this even when nothing has changed, which is most of the time.

## Read first
- `anon-inbox/supabase/migrations/20261115000119_chat_list_changes_only.sql` (`dating_summary_changes`), and the definitions of:
  - `my_conversations()`
  - `incoming_requests()`
  - `my_pending_likes()`
  - `friend_statuses()`
- `web-next/lib/api.ts`: `datingSummary()` / `datingSummaryChanges()`, and **every place that calls `datingSummary()`** (search `web-next/components`), plus the realtime signals that trigger a refresh. Migrations 118–122 and the "recently_here" signal changes are relevant.

## What to build
1. **"Nothing changed" answers in about 1 ms:**
   - Keep a small per-member change counter, e.g. `dating_private.inbox_version(user_id primary key, v bigint, updated_at)`.
   - Bump it with cheap triggers whenever anything that appears in that member's chat list changes:
     - a new message in their conversation, or a read receipt or unread change
     - a conversation created, accepted, deleted or hidden
     - an incoming request or like (pending likes)
     - a friend's status posted or cleared, or their own status
     - a block
     - anything else `dating_summary_changes` returns (check them all)
   - Bump **only** the affected members (e.g. both people in a conversation), never everyone.
2. **Use the counter:**
   - Add an optional `p_version` input to `dating_summary_changes`, or create `dating_summary_changes_v2`, keeping the old one working for installed apps.
   - If the phone's version equals the stored one, return `{"unchanged": true, "version": v}` straight away, without building the list.
   - Otherwise do today's work and return the new `version` too.
   - The phone stores the version next to its cached list.
   - Online dots and "active N hours ago" may change without a version bump. Keep those working as they do now (e.g. a separate light presence source, or allow a full rebuild at most every few minutes). Say how in the PR.
3. **Fewer calls:**
   - Find why it runs about 540 times a minute and cut the duplicates.
   - Combine calls that happen at the same moment (e.g. a realtime signal plus a screen focus within 2 seconds) into one.
   - Never refresh while the app is in the background (keep `pauseLiveInBackground`).
   - Don't refresh on every screen change if the last refresh was under ~20 seconds ago and no signal arrived.
4. **Make the full rebuild cheaper too,** if easy: check `my_conversations()` uses the right indexes (look for sequential scans with `explain analyze`), and avoid the md5 over the whole row if a stored `updated_at` or version per conversation can serve as the fingerprint.

## Rules (must not break)
- **Instant delivery:**
  - new messages, requests, likes and statuses must appear as fast as today, about 0.1 s through realtime
  - unread counts and previews must stay correct
  - a missed counter bump would show up as a stale inbox, so test every change type
- **Older app versions** (Android APK 1.4–1.7 and iPhone 1.4 open the website, but the old function name must keep working) must not break.
- **Privacy and safety:** blocks hide conversations exactly as now. Functions stay `security definer` with `set search_path`; only `authenticated` executes them; the counter table is in `dating_private`.
- **Database work:** write a **new** migration file, safe to run twice. **Do not apply it**; list it in the PR. Triggers must be tiny (one upsert), with no full-table work, so sending a message doesn't get slower.
- No new realtime channels and no polling.

## Tests and the PR
- **Database tests** (rolled back) covering:
  - "unchanged" when nothing happened
  - the version changes on each type of change: a message, a read receipt, a request, a like, an accept, a status, a block, a deleted conversation
  - a third person's message doesn't bump an unrelated member
  - the old function still works
- **Timing:** average time for an "unchanged" call versus today's ~80 ms; the time to send a message before and after the triggers.
- **App:** show in mock mode that the inbox still updates when a mock message arrives.
- `npm run typecheck` and `npx next build` must pass in `web-next`.
- **PR description:**
  - a plain-English summary for Hydra
  - the migration to apply first
  - expected database saving
  - what was tested and what still needs a real-phone test
  - a short release note in `release-notes/`
