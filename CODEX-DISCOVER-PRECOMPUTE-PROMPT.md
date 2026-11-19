Make Discover cheaper for the treehouse database by **preparing each member's Discover cards in advance**, instead of searching all profiles every time someone opens or scrolls Discover. Repo `brianjonahdennis-ctrl/treehouse`: start from the `nextjs` branch and open a PR into `nextjs`.

## Why
Supabase (Large compute) reaches about 75% CPU every evening. Discover's `discover_cards` takes about 11% of all database time at peak:
- each call takes **120–170 ms on average**
- it runs about 65 times a minute in the evening

Every call searches the profiles table again, with likes, conversations and blocks checks for each candidate. We want the same cards, in the same order, at a fraction of the cost. The member should see no difference except that Discover opens faster.

## Read first
- `discover_cards`: the **latest** definition in `anon-inbox/supabase/migrations/`. Check `20261108000031_discover_scales.sql` and `20261115000074_dob_for_rooms_and_discover.sql`, plus any later migration that replaces it.
- `web-next/lib/api.ts` (`discover()`) and `web-next/components/Discover.tsx`. The app asks for 40 cards and sends handles it already has in `p_exclude`.
- The Nearby tab (`discover/nearby`) and any other caller of `discover_cards` / `discover_profiles`.

## What to build
1. **Cards prepared ahead (a per-member queue):**
   - New table, e.g. `dating_private.discover_queue(user_id, position, candidate_id, likes_me, built_at)`. It holds the next ~200 candidates for that member, in today's ranking order: online first, then people who like you, then most recently active.
   - Fill it with one function, `dating_private.discover_refill(p_user uuid)`, using **exactly the same rules** as `discover_cards` today:
     - gender and interested-in both ways
     - age range and preferred state
     - active in the last 30 days (60 days for people who like you)
     - not suspended and active
     - not already liked or passed
     - no existing conversation
     - no block in either direction
     - the date-of-birth and 18+ rules from migration 074 and any later ones
2. **Serving cards becomes cheap:**
   - `discover_cards(p_limit, p_exclude)` keeps its **name, inputs and output columns**, so phones already installed keep working.
   - It reads the next cards from the member's queue, re-checks only those few rows (still eligible, not blocked, not liked or passed since, not suspended), and fills in live details such as `online` and `active_hours` for just those rows.
   - Target: **under 10 ms** per call.
3. **When to refill:**
   - The queue is empty or nearly empty (for example, fewer than 40 left).
   - The queue is older than about **15 minutes**. Serve what's there and refill (in the same call is fine if fast enough, otherwise mark it stale for the next call).
   - The member changes their own preferences (gender wanted, age range, state).
   - Don't refill everyone on a timer. Only members who actually open Discover pay for a refill. If you want a background job, a light `pg_cron` job that only tops up members active in the last hour is acceptable; say why in the PR.
4. **Keep the queue correct:**
   - When someone is liked or passed, blocked, suspended, deletes their profile, or a conversation starts, they must not appear again. Either delete them from queues with a cheap trigger, or rely on the re-check in step 2; say which.
   - Use `on delete cascade` so deleted accounts disappear from all queues.
5. **"Likes you" stays fresh:** if someone new likes the member, they should still move to the front quickly. For example, check new incoming likes since `built_at` when serving, which is a small indexed lookup.

## Rules (must not break)
- **Same results:**
  - the same people a member would see today, in the same ranking
  - no one under 18, nobody blocked either way, nobody suspended
  - the 365-day date-of-birth lock and age rules unchanged
- **Privacy:**
  - members never see ranking criteria, hours or scores
  - the queue table is in `dating_private` and not readable by phones
  - all functions are `security definer` with `set search_path`, and only `authenticated` can execute them
- **Phones:** the app must keep working against the old function too, so no app change should be required. Small app tweaks are fine if they help, such as asking for fewer cards at once.
- **Database work:** write a **new** migration file, safe to run twice. **Do not apply it**; list it in the PR. Add the indexes the queue needs. No big locks on `dating_profiles`: use `create index concurrently` where possible, or note why not.
- No new realtime channels and no polling from phones.

## Tests and the PR
- **Database tests** (rolled back), each comparing the old and new `discover_cards` for the same member:
  - the same set of people
  - a blocked person disappears straight away
  - a newly liked or passed person disappears
  - a suspended profile disappears
  - a new incoming like moves to the front
  - an empty queue refills
  - a preference change refills
  - under-18 profiles never appear
- **Timing:** show the old function's average time versus the new one on realistic data (e.g. 5,000 fake profiles).
- `npm run typecheck` and `npx next build` must pass in `web-next`.
- **PR description:**
  - a plain-English summary for Hydra
  - the migration to apply first
  - expected database saving
  - what was tested and what wasn't
  - a short release note in `release-notes/`
