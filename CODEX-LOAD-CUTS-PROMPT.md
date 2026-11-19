Reduce treehouse's database load. Repo `brianjonahdennis-ctrl/treehouse`: start from the `nextjs` branch. Open **five separate PRs into `nextjs`, one per section below**, each small and reviewable on its own.

## Why
Supabase (Large compute, 2 vCPUs, 8 GB) reaches 75–94% CPU every evening (8pm–midnight Lagos time). Hydra wants enough load removed to move down to Medium, which has 4 GB of shared CPU. Measured shares of database time (pg_stat_statements, 17–18 Nov):

| Function | Share | Speed |
|---|---|---|
| `dating_summary_changes_v2` (inbox refresh) | ~36% | avg 42 ms, should mostly be ~1 ms |
| `discover_cards` (already improved in #14) | ~9% | |
| `room_list` | ~6% | 12–28 ms |
| `invite_leaderboard` | ~6% | 27–60 ms per call |
| `photos_unlocked` | | 4.1M calls since 13 Nov |
| `rating_prompt` | | 2.5M calls |
| `realtime.authorize` checks | | 3.1M |
| `call_available`, `get_avatars` | | many small repeat calls |

The `realtime.messages` partitions hold ~1M broadcast signals a day (~600 MB/day of disk).

## Ground rules for every PR (must not break)
- **Do NOT apply migrations to the live database.** Write a **new** migration file, safe to run twice, and list it in the PR. Hydra and Claude review, test on live inside a rolled-back transaction, and apply it in quiet hours.
  - On 18 Nov an applied migration broke read receipts: a trigger referenced `new.sender_id` on tables without that column. Test every trigger against **every** table it is attached to, and every operation (INSERT/UPDATE/DELETE).
- **Live delivery stays instant:** new messages, requests, likes, matches and calls still reach the other person in about 0.1 s. Unread counts, previews and read receipts stay correct.
- **Older installed apps keep working:** keep old function names and parameters, adding new versions alongside where needed.
- **Privacy and safety unchanged:**
  - blocks hide people both ways
  - 18+ and date-of-birth rules apply
  - members never see hours, scores or ranking criteria
  - private tables live in `dating_private`
  - functions are `security definer` with `set search_path`, and only `authenticated` can execute them
- No new polling loops and no new realtime channels.
- `npm run typecheck` and `npx next build` must pass in `web-next`, and in `web-admin` if touched.
- **Each PR includes:**
  - a plain-English summary for Hydra
  - the migration to apply, if any
  - database tests (pgTAP, rolled back)
  - expected saving
  - what still needs a real-phone test
  - a short release note in `release-notes/`

---

## PR 1: Finish the inbox fast path
Read `anon-inbox/supabase/migrations/20261118001235_inbox_version_cache.sql`, the hotfix `20261118003000_fix_inbox_trigger_reads.sql`, `datingSummaryChanges()` in `web-next/lib/api.ts`, and `startLive()` / `loadDating()` in `web-next/components/App.tsx` and `web-next/lib/state.ts`.
1. **Likes must not bump the liker's own inbox.** In `inbox_likes_changed`, a one-way like (or pass) should bump only `to_user`, because their pending-likes count changes. Bump both members only when the like creates or changes something both see (a match or conversation is already covered by the conversation trigger). Check what `my_pending_likes()` and `incoming_requests()` actually show before deciding.
2. **Bring back a throttle on like/request/accept nudges.** Today it is 100 ms, so every like a popular member receives triggers a full rebuild. Coalesce nudges to at most **one refresh every 20 seconds**. Exception: a nudge for a brand-new conversation (a match or accepted request) refreshes immediately, so the new chat appears straight away.
3. **Fewer forced full rebuilds:**
   - `pVersion` is dropped after 180 s, forcing a full rebuild every 3 minutes per open phone. Raise this to 10 minutes.
   - Online dots and "active N hours ago" may need refreshing in between. Refresh them with a tiny separate call that returns only `conversation_id → online/active_hours` for the member's chats, and only while the inbox screen is visible.
4. **Check other triggers don't bump more members than needed**, e.g. profile edits bumping everyone who ever liked that person. Keep correctness first.
5. **Target:** most refreshes return `unchanged` (~1 ms), and the average `dating_summary_changes_v2` time falls below 15 ms at peak.

## PR 2: Fewer live-update signals
Read `20261116000122_lighter_signals.sql`, `20261116000121_calls.sql` and every trigger or function calling `realtime.send` (search the migrations), plus `api.onInboxNudge` and the "recently_here" / `touch_last_seen` logic.
1. **List every signal type** and how many are sent per day. Count from `realtime.messages` in a read-only query; no personal data in the PR.
2. **Don't send signals that no one will receive.** Only send to members seen in the last ~5 minutes, with the app open. A member who comes back catches up through the normal refresh, which already happens on returning to the app.
3. **One signal per burst:** no separate signals for each message, read receipt and typing event in the same conversation within a second or two. Read receipts and edits should go only to the other person, and only if they have that chat open, or should be skipped and picked up by the next refresh.
4. **Keep instant:** new messages, calls (ringing, answered, ended), new matches and requests.
5. **Fewer `realtime.authorize` checks:** check the channel and topic design isn't re-authorising on every message. Use Supabase's recommended private-channel setup with as few topics per member as possible.
6. **Target:** at least half fewer rows per day in `realtime.messages`, with no slower delivery.

## PR 3: Stop asking the same small questions repeatedly
Read `photosUnlocked`, `ratingPrompt`, `callAvailable` and `getAvatars` in `web-next/lib/api.ts` and their callers in `web-next/components` (Chat, call buttons, avatars), plus the migrations `20261115000095_photos_after_20.sql`, `20261115000113_rating_prompt.sql`, `20261116000121_calls.sql` and `20261108000011_custom_avatars.sql`.
1. **`photos_unlocked`:**
   - Cache the answer per conversation on the phone.
   - Once unlocked, it never relocks, so store it permanently for that chat.
   - While locked, re-ask only after new messages arrive, e.g. at most once per 10 new messages or per minute. The hidden 50-message / 20-message rules are unchanged and still enforced on the server when sending a photo.
2. **`rating_prompt`:** ask at most once per chat per app session, not on every render or screen visit.
3. **`call_available`:** cache per chat for a few minutes. Calls stay hidden in the iPhone app. The server still enforces the hidden rule when a call is actually started.
4. **`get_avatars`:**
   - Batch all handles on screen into one call.
   - Keep a memory cache for the session plus browser caching of the images.
   - Never fetch the same handle twice in a session unless it changed.
5. **Message history:** opening a chat that is already loaded shouldn't re-download all its messages. Fetch only newer ones (`after` the last message id/time).
6. Merge these into one combined "chat info" call when a chat opens (photos unlocked, call available, rating prompt) if that's simpler.
7. **Target:** these calls drop by at least 80%.

## PR 4: Prepared invite leaderboard
Read `20261115000098_invite_leaderboard.sql`, `web-next/components/InviteBoard.tsx` and the My Treehouse / Of-the-Week cards.
1. Calculate the leaderboard **once every 10 minutes** into a private table, e.g. `dating_private.invite_board_cache`, with a light `pg_cron` job. Or calculate on demand when the cache is older than 10 minutes, protected by an advisory lock so only one request rebuilds it.
2. `invite_leaderboard()` keeps its name and output, and reads the cache plus the member's own row. The member's own rank may be up to 10 minutes old; say so in the PR.
3. Staff corrections and audits from migration 112 must still show up, at most 10 minutes later.
4. **Target:** under 3 ms per call.

## PR 5: One shared room list
Read `20261112000054_age_rooms.sql`, `20261116000120_room_counts_cache.sql` (the `room-counts` cron every 20 s) and `room_list`'s callers.
1. Most of the room list is the same for everyone (rooms, counts, online numbers). Serve that part from the existing 20-second cache.
2. Compute per member only what is personal: their own room, unread count, and age-room blur and eligibility.
3. On the phone, don't call `room_list` more than once every 20 s, and never while the rooms screen and Home are hidden.
4. Age-room rules (blurred age rooms, 18+ block, 365-day DOB lock) are unchanged.
5. **Target:** under 5 ms per call and at least half the calls.

---

## When all five are done
Write a short summary in the last PR estimating the combined saving, using the numbers above. The goal is evening CPU under ~40% on the current Large plan, which is when moving down to Medium becomes safe.
