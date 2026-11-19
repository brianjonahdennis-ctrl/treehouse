Change how Treasure Hunt routes work in treehouse (repo `brianjonahdennis-ctrl/treehouse`, start from the `nextjs` branch, open a PR into `nextjs`). Read the current design first: `web-next/components/TreasureHunt.tsx`, the Treasure Hunt section of `web-next/lib/api.ts`, `web-next/components/AnnTreasureHunts.tsx`, `web-admin/components/TreasureHunts.tsx`, and the migrations `anon-inbox/supabase/migrations/2026111620*_treasure_hunt*.sql` (plus any later Treasure Hunt migrations).

## Why
Today every player follows the same checkpoint order (1, 2, 3…). Players who start in the same area end up walking together in a crowd, and some must travel far to reach their start. We want:
1. **No long trips to start:** each player starts at the checkpoint closest to them.
2. **No crowds:** players who start at the same checkpoint get different routes after it.
3. **Everyone does the whole hunt:** every player must visit every checkpoint, in their own order, before the grand prize appears.

## The new rules
1. **Starting point = nearest checkpoint.** When a player joins a public hunt, use one location reading to pick the checkpoint nearest to them as their start. The grand prize (final treasure location) can never be a starting point. Assign it once; it never changes after that.
2. **Personal route.** Each player gets their own order of all the checkpoints: the nearest one first, then every other checkpoint exactly once.
3. **Spread players out.** Assign the rest of a player's route when they **check in at their starting checkpoint**. Don't wait for every player to arrive; that could take hours. At that moment, look at the other players who started from the same checkpoint and choose a route whose **next checkpoint** (and, where possible, the one after) differs from theirs. Keep the number of players heading to each checkpoint balanced. Example: player 1 starts at checkpoint A and is sent to C next; player 2 also starts at A and is sent to D next.
4. **Sensible walking.** Routes must still be reasonable to walk: for example, build each route by picking among the nearer unvisited checkpoints, not random zig-zags across the city. When spreading players out would make a route much longer (more than about 30% longer than that player's shortest route), choose the shorter route instead.
5. **The player only sees "Next checkpoint".** Never show checkpoint numbers, names that reveal the order, or other players' routes. The phone should only receive the **current target's** location, name and clue, plus "3 of 7 checkpoints found". **Stop sending all checkpoint coordinates to the phone after joining**, as the current `treasure_hunt_progress` does. Send only the next target, which also makes cheating harder.
6. **Grand prize last.** The grand prize location appears on the player's map only after they have checked in at every checkpoint. If a hunt has several final treasure locations, keep giving each player the one nearest to their last checkpoint.
7. **Starting points chosen by staff.** The new rule replaces the hunt's separate "start points" for new hunts: the nearest checkpoint is the start. Tidy the staff screens to match. Keep old data readable, and don't break a hunt that already has players.

## Database (all rules enforced on the server, never on the phone)
- Add a per-player route table (e.g. `treasure_hunt_routes(participant_id, position, checkpoint_id)`) with unique `(participant_id, position)` and `(participant_id, checkpoint_id)`.
- `treasure_hunt_join_with_routes`: picks and saves the nearest checkpoint as position 1, once, safe to retry.
- On checking in at the starting checkpoint, assign the rest of the route in the same transaction. Lock the hunt row so two players checking in at the same moment are balanced correctly. Make it safe to retry.
- `treasure_hunt_claim_checkpoint`: accept only the checkpoint at the player's current route position, with the same distance, accuracy and rate-limit checks as today. Coins are awarded only by the database.
- `treasure_hunt_finish`: allowed only when every checkpoint on the player's route is claimed.
- Progress function: return the hunt details, the player's coins, found/total counts and the **current target only**, plus the grand prize only once it has been unlocked.
- Players who already joined under the old numbered order must keep working: give them a route equal to the old order.
- Keep all existing protections: 18+ eligible profiles only, `auth.uid()` checks, `security definer`, `set search_path = public`, execute rights for `authenticated` only, no location history stored, and leaderboard privacy unchanged.
- Write a **new** migration file, safe to run twice. **Do not apply it yourself**; list it in the PR for Hydra.

## App
- The hunt screen shows "Starting point", then "Next checkpoint", then "Final treasure", with "X of Y found", the clue, distance, the Google Maps button and the camera view, all aimed at the current target.
- Mock mode (`NEXT_PUBLIC_TH_MOCK=1`): update the mock so two fake players starting at the same checkpoint visibly get different next checkpoints.
- No new polling or live channels. Load the next target after each check-in, as now.

## Tests and the PR
- Add database tests covering:
  - the nearest-start choice (the grand prize is never chosen)
  - two players from the same start getting different next checkpoints
  - every player having to visit every checkpoint
  - the grand prize staying hidden until every checkpoint is done
  - checkpoints claimed out of route order being refused
  - retries not giving double coins
  - old-order players still working
- `npm run typecheck` and `npx next build` must pass in `web-next` and `web-admin`.
- In the PR: a plain-English summary for Hydra, the migration to apply first, what was tested, and anything not tested.
