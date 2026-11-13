# Games on treehouse (Kickrs)

The **Games** tab (bottom bar, next to Discover in the raised centre) shows games made by Kickrs (kickrs.app). Kickrs is
the only game provider: Penalties and Trivia are live, and Ludo, Chess, Quick Dice and Crosswords
show as "Coming soon". When Kickrs opens a new game it appears here on its own, no treehouse change.
Profile moved from the bottom bar to your avatar at the top right of each screen (it replaces the
Settings gear, which opened the same page) and stays in the desktop sidebar.

## What members see

1. **Home:** a "Games on treehouse" card → **Play Games**.
2. **Games tab** (`/home/games`): banner, filters (All Games · Multiplayer · Quick Play), and the grid
   "Popular on treehouse" with how many are playing now.
3. **First time only:** "Play Kickrs games as {nickname}?" with **Allow** / **Not now**. Kickrs sees the
   nickname, painted avatar and that they're 18+. Name, email, photos and chats stay on treehouse.
4. **The game** (`/home/games/penalties`): treehouse bar on top (back, ⋯ → Disconnect Kickrs), the
   game below, already signed in, and the bottom bar stays for moving around treehouse. At full time against another member: **Add {name} on
   treehouse** sends a normal treehouse friend request (same limits, blocks and checks).
5. **On kickrs.app:** Sign in › **Continue with treehouse** opens `/home/connect/kickrs`, which signs the
   member in if needed (Google or email, as usual), shows the same Allow step, then goes back to Kickrs.

6. **Challenge from a chat:** in any accepted chat (matches, friends), the **+** next to the message box →
   **Penalty challenge**. The game opens, Kickrs makes a 10-minute challenge, and treehouse sends a chat
   message with the link. The other person sees it as a card with **Play**, which opens Penalties and
   starts the match. After 10 minutes the card says it expired and offers **Challenge back** / **Send
   again**. Back in the game returns to the chat. (In the old app the message shows as text with a link.)
   **Trivia challenge** works the same way: a 7-question duel (10 seconds each) in Mixed categories,
   with a 🧠 Trivia duel card. Kickrs tells treehouse where each game's invite links live (`join` in
   `/games`), so new games' challenges need no treehouse change beyond the + menu entry.

7. **Trivia** (`/home/games/trivia`): 1v1 duels by category (Naija Music, Nollywood, Football, History,
   Nigeria & Africa, Food & Culture, Science, World, or Mixed), a daily quiz (10 questions, one try,
   same for everyone, new at midnight Lagos time) and Trivia leaderboards. Questions are managed in the
   Kickrs admin (Trivia section).

Who can play: anyone with a dating profile (all 18+). Suspended profiles and anyone marked under 18
can't. Kickrs never gets a treehouse sign-in token.

## How it works

- Database: `anon-inbox/supabase/migrations/20261112000063_kickrs_games.sql` adds one private table
  (`dating_private.kickrs_links`) and five functions: `kickrs_status`, `kickrs_connect`,
  `kickrs_identity`, `kickrs_disconnect`, `kickrs_friend_request`. Each member gets a random Kickrs id
  (never their user id). Tests: `anon-inbox/supabase/tests/kickrs_games.test.sql` (19 checks).
- `app/api/kickrs/ticket/route.ts`: the page sends the member's access token and a one-time code from
  the Kickrs frame; the route asks `kickrs_identity()` as that member and signs a pass that lasts
  60 seconds (`lib/server/kickrs-ticket.ts`, Ed25519, no packages). 30 a minute per member.
- `lib/kickrs.ts`: the games list (`GET https://play.kickrs.app/games`), passes, and the messages with
  the Kickrs frame (checked by origin both ways).
- `components/Games.tsx`: Home card, Games tab, Allow, game screen, connect page.
- `proxy.ts`: page security policy now allows the Kickrs frame (`frame-src https://kickrs.app`) and the
  games list (`connect-src https://play.kickrs.app`).

## Settings

| Where | Name | Value |
|---|---|---|
| treehouse-next (Railway) | `KICKRS_SIGNING_KEY` | Secret. From `node scripts/kickrs-keys.mjs` |
| Kickrs (Railway) | `TREEHOUSE_PUBLIC_KEY` | The public key that script prints (Boma sets it) |
| Kickrs (Railway) | `TREEHOUSE_CONNECT_URL` | `https://app.treehouse.ng/home/connect/kickrs` (default) |
| Kickrs (Vercel) | `NEXT_PUBLIC_TREEHOUSE_ORIGINS` | Only for a preview address, e.g. `https://next.treehouse.ng` |

## Going live with no downtime

Nothing here changes how the live site works today, and each step can be undone on its own.

1. **Database** (any time): `supabase db push --dry-run`, then for real. It only adds a new table and new
   functions; nothing existing is changed, and it waits at most 5 seconds for a lock, so members don't
   notice. Run `node supabase/run-tests.mjs`.
2. **Keys**: run `node scripts/kickrs-keys.mjs`, put the private key on the treehouse-next service,
   send the public key to Boma. Kickrs stays switched off until that key is set on Kickrs.
3. **Preview** (MIGRATION.md step 1): on the preview address, Boma adds that address to Kickrs'
   `NEXT_PUBLIC_TREEHOUSE_ORIGINS` so Kickrs will load there. Test: Allow, play a friend match between
   two members, Add friend, and Continue with treehouse from kickrs.app.
4. **Switch-over** follows MIGRATION.md (only `/home` moves to the new app; one setting to switch back).
   Games go live with it; the old app never had a Games tab, so switching back just hides Games.

## Preview with sample data

`NEXT_PUBLIC_TH_MOCK=1` shows Games with sample data. To open a game in the preview, also run Kickrs
locally and set `NEXT_PUBLIC_KICKRS_ORIGIN=http://localhost:3000`, `NEXT_PUBLIC_KICKRS_API=http://localhost:8787`,
`KICKRS_MOCK_TICKETS=1` and a `KICKRS_SIGNING_KEY` whose public key Kickrs has. Each browser tab plays
as a different fake member.
