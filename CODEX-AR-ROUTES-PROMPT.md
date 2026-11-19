Improve the Treasure Hunt AR camera in treehouse (repo `brianjonahdennis-ctrl/treehouse`, start from the `nextjs` branch, open a PR into `nextjs`). The hunt works on real phones. Hydra tested it outdoors and wants three changes. Read `web-next/components/TreasureHunt.tsx` (the AR / compass views), the Treasure Hunt section of `web-next/lib/api.ts` and `web-next/TREASURE_HUNT.md` first.

## 1. Follow real roads instead of pointing in a straight line
**Now:** the AR view shows a small arrow pointing straight at the next checkpoint, with "822 m to The Market". A straight-line arrow sends players across fences, buildings and private property.

**Wanted:** guidance along **real roads and public paths**, like turn-by-turn navigation:
- **The route:** get a real route from the player's position to their current target (start point, next checkpoint or final treasure) from **Google's Routes API** (Directions). Use walking mode by default, plus a "On a bus / in a car" switch that uses driving mode.
- **Arrows on the ground:** draw the route **on the ground in the camera picture**, as large glowing teal arrows that lie flat on the road and follow the path ahead. Show a curved turn arrow as the next turn gets close.
  - Do this by placing the route's points in 3D: east/north metres from the player, on a ground plane about 1.4 m below the phone. Use live true-north heading and tilt (`deviceorientationabsolute` on Android, `webkitCompassHeading` on iPhone browsers), corrected for the phone's tilt and screen rotation.
- **Instruction banner:** a top banner with the next instruction from the route ("Turn right in 40 m onto Apo Road"), plus total distance and time left.
- **Bottom bar:** a small row with "Destination" (opens the route in Google Maps), a recenter button and a close button.
- **Keeping it steady:**
  - snap the player's position to the route line
  - smooth the heading so arrows don't jump
  - when GPS or compass accuracy is poor, fade the ground arrows and keep the banner and a simple direction chevron
- **Arriving:** when the player is within about 60 m of the target, show the treasure item floating at the spot. Tap it to collect, using the existing server claim, which checks distance. Coins are still only awarded by the database.
- **Re-routing:** request a new route only when the player strays more than about 40 m from the route, or when the target changes. Don't fetch routes in a loop.

**Google key and cost:**
- Call the Routes API **from the server**, through a new route such as `web-next/app/api/hunt-route/route.ts`. Use a key in an environment variable (`GOOGLE_ROUTES_KEY`), so the key is never in the phone's code.
- The route must:
  - require a signed-in member
  - accept only origin, destination and travel mode
  - rate-limit each member (for example, at most 1 request per 20 seconds and 60 per hour)
  - ask Google only for the fields needed (polyline, steps, distance, duration) using a field mask
  - cache identical requests briefly
- Send Google nothing but the two locations: no names, IDs or handles.
- If the key is missing, or Google fails or hits its limit, fall back to the current arrow and the "Follow the blue line in Google Maps" button, with a short notice.
- Document in the PR how Hydra creates and restricts the key in Google Cloud. Hydra creates the key himself; never commit keys.

## 2. Remove the driving safety pause
**Now:** the camera turns itself off and on while moving in a vehicle, because the code assumes the player is driving.

**Wanted:** remove the speed-based pause. The AR camera stays on at any speed, because players may be passengers in a bus, keke or car.
- Replace the pause with a one-time notice when the AR view first opens: "Passengers only: never play while driving. Watch out for traffic." The player taps OK to continue.
- Keep stopping the camera, sensors and location watching when the AR view is closed or the app goes to the background (battery and privacy).

## 3. Don't show "Camera picture is unavailable" when the camera works
On an iPhone in Safari, the hunt screen showed "Camera picture is unavailable. Showing the compass view instead." even though the camera then worked. Show that message only when opening the camera has actually failed, and clear it once the camera picture is running.

## Rules (must not break)
- **iPhone app:** the camera view stays hidden in the iPhone app (`isIOSApp`), as now. Safari on iPhone and the Android app keep it.
- **Privacy:**
  - only the current target is used
  - no other players appear
  - no location history is stored (not on our server and not in logs)
  - the server route must not log coordinates
- **No database changes** are expected. If one is truly needed, write a new migration file and list it in the PR. Don't apply it.
- No new background polling or live channels. Railway and Supabase load must stay tiny: one route request per target, plus re-routes.
- Match the treehouse style. Check it at 360 px wide, in light and dark mode.

## Testing and the PR
- Mock mode (`NEXT_PUBLIC_TH_MOCK=1`): a fake route (a few turns), a fake moving position and a fake heading, so the ground arrows, banner and arrival can be shown without a phone. A mock answer for `/api/hunt-route`.
- `npm run typecheck` and `npx next build` must pass.
- In the PR, include:
  - a plain-English summary for Hydra
  - screenshots
  - the new environment variable and the Google Cloud setup steps
  - an estimate of Google requests per player per hunt
  - what still needs a real outdoor phone test
  - a short release note in `release-notes/`
