You are taking over feature work on **treehouse** (treehouse.ng), an anonymous dating and chat-rooms community app for Nigeria. The owner, Hydra (Brian Jonah Dennis), is not a full-time developer: explain what you did in plain words, no jargon.

## The repository
- GitHub: `brianjonahdennis-ctrl/treehouse` (private).
- **The `nextjs` branch is the live site.** Every push to `nextjs` deploys treehouse.ng automatically (Railway). `main` is older and not the deploy source.
- Never push straight to `nextjs`. Work on a new branch made from `nextjs`, named `codex/<feature>`, and open a pull request into `nextjs`. Hydra merges it to publish.

## Where things live
| Folder | What it is |
|---|---|
| `web-next/` | **The member app**: Next.js 16 + React 19 + TypeScript, talking to Supabase. Almost all features go here. |
| `web-next/components/` | Screens: `App.tsx` (shell, routing, live updates), `Inbox.tsx`, `Chat.tsx`, `Home.tsx`, `Call.tsx`, `MyTreehouse.tsx`, `Reputation.tsx`, etc. |
| `web-next/lib/api.ts` | Every call to the database goes through here. Add new functions here, following the existing pattern. |
| `web-next/lib/supabase.ts` + `web-next/dev/mock-supabase.js` | Mock mode: with `NEXT_PUBLIC_TH_MOCK=1` the app runs on fake data, no database. Add mock answers for any new database function you call. |
| `web-next/public/home-sw.js` | Service worker: push notification texts. |
| `web-next/*.md` | Notes on earlier features (MIGRATION, REPUTATION, ANNOUNCEMENTS, KICKRS). Read the relevant one first. |
| `web-admin/` | Staff console at admin.treehouse.ng (Next.js). See `web-admin/ADMIN.md`. Staff pages call `staff_*` database functions. |
| `anon-inbox/supabase/migrations/` | **Every database change**: tables, Postgres functions (RPCs), row-level security, cron jobs. Files are numbered `2026MMDD000NNN_name.sql`; the newest is `20261116000122_lighter_signals.sql`, so start at `…000123`. |
| `anon-inbox/` | The old Node server. Still runs push sending, scheduled jobs and the call relay key. Leave it alone unless the feature needs it. |
| `tell-hydra-app/` | Android/iOS app shell (Capacitor) that opens https://treehouse.ng/home. You rarely need to touch it. |

## Running and checking your work
```
cd web-next && npm install
NEXT_PUBLIC_TH_MOCK=1 npx next dev -p 4030   # mock data, no secrets needed
npm run typecheck                            # must pass
npx next build                               # must pass before you open the PR
```
Don't run `next dev` and `next build` in the same folder at the same time. Check every screen you change at phone width (about 375px) in both light and dark mode.

## Database changes
- You have no access to the live database. Write the new migration file and the app code that uses it, but **do not try to apply it**.
- In the pull request, say clearly which migration files must be applied **before** the app code is merged. Hydra applies them.
- Database work is done as Postgres functions called through `supabase.rpc(...)`: `security definer`, `set search_path = public`, check `auth.uid()`, and `grant execute` only to `authenticated`. Copy the style of recent migrations (`…000121_calls.sql` is a good example).
- New tables get row-level security switched on. Members read through functions, not direct table access.
- Make migrations safe to run twice (`create or replace`, `if not exists`).

## Rules that must not be broken
- **Secrets:** never add, print or commit secrets: keys, tokens, passwords, `.env` files, `anon-inbox/data/*`, `tell-hydra-app/signing/*`. Use the existing environment variables.
- **Members never see** hours spent, ranking criteria, or other members' personal data. Staff pages show counts, not private content.
- **18+ only.** Keep the under-18 block and the 365-day date-of-birth lock. Never add a forced date-of-birth screen.
- **Speed Dating and calls stay hidden in the iPhone app** (App Store review). Follow how `Call.tsx` and the Speed Dating screens hide themselves there, and do the same for anything similar.
- **Audience:** Nigeria. 36 states + FCT, Africa/Lagos time zone, naira (NGN). Public contact is support@treehouse.ng.
- **Cost matters.** Hydra just spent two rounds cutting server and database cost. Don't add polling loops, new always-on live channels, or queries that run on every screen load. Reuse the caches in `lib/api.ts`. Keep `prefetch={false}` on links. Shrink images with `lib/shrinkImage.ts` before upload.
- **Look and feel:** match the existing components and CSS. No new UI libraries.
- Keep dependencies as they are unless a feature truly needs a new one. Say why in the PR.

## Every pull request
1. A one-paragraph plain-English summary of what members will see.
2. Any migration files to apply first, in order.
3. How you tested it (mock mode, typecheck, build), with screenshots if you can.
4. Anything not finished or not tested.
5. A short release note Hydra can post to members, in `release-notes/YYYY-MM-DD-<feature>.md`: a friendly headline, then 3–5 short lines on what's new and how to use it. No technical words.

## The feature to build now
<Hydra: describe the feature here: what members should be able to do, where it appears, and anything staff need to see.>
