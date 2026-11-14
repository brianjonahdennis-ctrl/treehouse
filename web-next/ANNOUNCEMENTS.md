# Product Announcements: audit and plan (14 Nov 2026)

Branch `announcements` (worktree `../treehouse-announcements`), based on `origin/nextjs` at 4e19017 (Birthdays included).
Migrations start at `20261114000071`.

## What exists today (audit)
- **Inbox** (`components/Inbox.tsx`) has four tabs, Chats, Requests, Friends and Matches, using the address `/home/matches/<tab>`. Everything comes from one `dating_summary` call, which waits at least 30 s between reloads.
- **Inbox badge**: `inboxBadge()` in `lib/state.ts`.
- **Push**: the database queues `{user, kind, url}` in `dating_private.push_outbox`, and its allowed kinds are message, chat, request, like and match. The old server (`tell-hydra`) wakes, takes 200 at a time (10 rounds per wake, plus a 1-minute backup check), and sends. The service worker `home-sw.js` turns each kind into fixed private text and deep-links to `/home/...`.
- **Admin**: there is one owner password on the old owner app (`app.html`). The server holds an admin key, and the database checks it with `admin_ok(p_key)`. **There are no staff accounts or roles today.**
- **People data**: `dating_profiles` has `created_at`, `last_seen_at`, `state` (36 + FCT), `suspended` and `is_active`, plus a date-of-birth lock. `app_seen_days` records the platform (android-play, android-apk, ios-app, web). **There is no country column**: everyone is in Nigeria.
- **Scheduling**: pg_cron is on.
- **Notification preferences**: none exist yet, apart from the device's own push permission.

## Plan
1. **Database** (one migration, `…071_announcements.sql`)
   - Tables:
     - `announcements`: the fields in the brief, plus `revises` to point at the original when a correction is sent.
     - `announcement_deliveries`: unique (announcement, user), with delivered, read, archived, CTA-click and push timestamps.
     - `announcement_staff`: user and role, where the role is super_admin, admin, editor or analyst, plus a `can_publish` flag.
     - `announcement_audit`.
   - Indexes, including a partial index on unread deliveries, so the unread count stays cheap.
   - Staff permissions are checked inside every function. A staff member is a normal treehouse account. Hydra's account becomes Super Admin, set once through the owner key.
   - **Audience**: all active, all registered, new in the last N days, active in the last N days, inactive for N days, Nigerian state(s), and platform. These can be combined (AND). The estimate is a real count from the database.
   - **Who is always left out**: suspended accounts, under-18 accounts and paused accounts (paused only for non-essential announcements).
   - **Country**: shown as "Nigeria" only, because there is no country data to pick from.
   - **Delivery**: a pg_cron job runs every minute and adds 5,000 recipients per run in user-id order (`on conflict do nothing`). Retries never make duplicates, the admin screen never waits, and cancelling a scheduled announcement stops it before the job picks it up.
   - **Scheduling**: a scheduled announcement goes out on the first cron run after its time.
   - **Push**: adds a new kind, `announcement`. A delivery queues a push only the first time it is marked. Push is optional for each announcement. People who turn off "treehouse updates" don't get a push, but Important and Maintenance notices still appear in their Inbox. The push is sent in batches, so the server is never hit all at once.
   - **Read sync**: read, mark-all-read, archive and CTA clicks are saved in the database, so they match on every device.
2. **Admin dashboard**: `treehouse.ng/admin/announcements` in the same Next.js app, with the same login, and shown only to staff.
   - Overview numbers.
   - A list with filters: Published, Scheduled, Drafts, Archived.
   - A 3-step composer: Content, Audience, Schedule. It includes cover image upload and a phone/desktop preview.
   - Final confirmation before publishing.
   - Analytics for each announcement, from real records and as counts only.
   - **Content format**: a safe "Markdown-lite" (headings, paragraphs, lists, links, images and buttons), drawn by React and never treated as HTML.
   - **Buttons (CTAs)**: these may only point to treehouse pages on a fixed list, or to `https://` links.
   - **Images**: go in a new Supabase storage bucket that only accepts JPEG, PNG or WebP files up to 2 MB, and only staff can upload.
3. **Inbox**:
   - A fifth tab, **Announcements**, with a badge.
   - All / Unread / Read filters, plus Archived.
   - Official "treehouse Official" cards and a detail screen at `/home/matches/announcements/<id>`.
   - Mark all read.
   - The unread count is loaded alongside the existing Inbox load (one small extra call, at most every 30 s) and when a push arrives. There is no polling.
4. **Push**: the push says "Treehouse Update 🎉" and links to the announcement. This needs the `announcement` kind added to the service worker. The old server's sending loop works unchanged.
5. **Tests**:
   - Database tests run inside a transaction that ends in ROLLBACK, and cover publishing to everyone and to a chosen group, scheduling, cancelling, duplicate prevention, read sync, permissions, and a 100k-recipient dry run.
   - Mock-mode screens at phone and desktop sizes.
   - `tsc` and `next build`.

## Approval gates
- Hydra approves the database push (dry run shown first).
- Hydra approves the push to `nextjs`, which is the live site.
- No real announcement is published without Hydra's OK for that specific send.

## Status: built, not live yet (14 Nov 2026)
Nothing is pushed: the migration is not applied and no announcement has been sent.

**Files**
- New: `anon-inbox/supabase/migrations/20261114000071_announcements.sql`, `anon-inbox/supabase/tests/announcements.test.sql`,
  `web-next/lib/announcements.ts`, `web-next/components/Announcements.tsx`, `web-next/components/AnnAdmin.tsx`,
  `web-next/app/home/admin/[[...sub]]/page.tsx`
- Changed: `web-next/lib/api.ts`, `lib/state.ts` (unread count with the Inbox load, added to the Inbox badge),
  `lib/icons.ts`, `components/Inbox.tsx` (5th tab + detail route), `app/home/matches/[[...sub]]/page.tsx`,
  `components/Profile.tsx` (“treehouse updates” switch, Staff link), `components/App.tsx` (push-open refresh, title),
  `public/home-sw.js` (push text), `app/hy.css`, `dev/mock-supabase.js` (preview data only)

**Database (all through functions; tables closed to direct access)**
- Members: `my_announcements`, `my_announcements_unread`, `open_announcement`, `mark_announcement`,
  `mark_all_announcements_read`, `my_announcement_prefs`, `set_announcement_push`
- Staff: `ann_me`, `ann_overview`, `ann_list`, `ann_get`, `ann_estimate`, `ann_save`, `ann_publish`, `ann_cancel`,
  `ann_archive`, `ann_correction`, `ann_delete_draft`, `ann_analytics`, `ann_audit_log`, `ann_staff`, `ann_set_staff`
- Owner key: `admin_ann_set_staff` (used once to make Hydra Super Admin)
- Background: pg_cron `announcements-tick` every minute → `dating_private.ann_tick()` (scheduled → publishing,
  delivery of 4 × 5,000 per minute, dashboard counts)
- Push: kind `announcement` added to `push_outbox`. The existing tell-hydra sender is unchanged and sends it.
- Storage: public bucket `announcement-images`, which only staff can upload to (JPEG/PNG/WebP, 2 MB max).

**Tests**
- 45/45 database checks pass on the live database, in a transaction that was rolled back.
  The run included a real-size delivery: about 23,500 active members in 5 batches, with no duplicates, in about 5 s.
  The pre-apply run left out the two statements that lock live tables (push_outbox constraint, storage policy).
- The phone and desktop preview in mock mode works: tab, filters, detail, mark read/badge, composer (3 steps,
  live preview, unsafe link shown as text), estimate, confirm, publish, and analytics. There were no console errors.
- `tsc` is clean and `next build` passes.

**Not done / limits**
- Push “failed” is always 0, because the old server doesn't report failures back. Gone devices are still removed.
- Push sending trails delivery: the server sends about 2,000 per wake-up plus 200 a minute.
- Country is fixed to Nigeria, because there is no country data.
- People who join after an announcement is published don't receive it.
- Not tested with real accounts on the live site.

**To go live (each needs Hydra's OK)**
1. Apply 071. The live database already has 090–092 from other branches, so use `db push --include-all`
   from a folder holding only the needed files, as the Kickrs session did. Check with a dry run first.
2. Make Hydra's account Super Admin: `admin_ann_set_staff(<owner key>, '<Hydra’s handle>', 'super_admin')`.
3. Merge `origin/nextjs`, then push to `nextjs`, which deploys live.
4. Send a first real test announcement to a tiny audience (e.g. staff only via a state + inactive filter, or just
   check with a draft preview), then do a phone test of the push.
