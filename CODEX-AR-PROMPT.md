Redesign the Treasure Hunt camera view in treehouse (repo `brianjonahdennis-ctrl/treehouse`, start from the `nextjs` branch, open a PR into `nextjs`) into a **location-based AR view**: digital treasure items appear to sit at real places in the world. When a player points their phone toward a checkpoint, they see its item floating there in the camera picture, getting bigger as they walk closer, and they tap it to collect it once they are close enough.

This must be **our own original design**: treehouse's look, our own treasure chests and coins (the hunt's `coin_avatar` / `treasure_avatar`). Do not copy any existing game's characters, art, sounds, names or screens.

## Read first
- `web-next/components/TreasureHunt.tsx` (`LocalAR`, the hunt flow), `web-next/lib/api.ts` (Treasure Hunt section), `web-next/TREASURE_HUNT.md`, `web-next/dev/mock-supabase.js`.
- The Treasure Hunt database is in `anon-inbox/supabase/migrations/2026111620*_treasure_hunt*.sql`. Checkpoint, start and finish locations reach the phone only after a player joins. Coins are only ever awarded by the database (`treasure_hunt_claim_start`, `treasure_hunt_claim_checkpoint`, `treasure_hunt_finish`), which checks the player's distance. **Keep that: the AR view is only the visuals. Collecting an item must still call the same database function with a fresh location reading.**

## What to build
1. **Camera + world placement (phone-only maths, no server):**
   - Back camera picture, full screen, with a transparent 3D layer on top.
   - Live position from `navigator.geolocation.watchPosition` (high accuracy). Live true-north heading and tilt: `deviceorientationabsolute` on Android; `webkitCompassHeading` plus `DeviceOrientationEvent.requestPermission()` on iPhone browsers. Correct for the phone being held upright and for screen rotation.
   - Place each visible item in 3D using its distance and direction from the player (east/north metres from latitude and longitude). Size and height scale with distance. Smooth the movement so items don't jitter: low-pass filter the heading, and ignore GPS jumps worse than the reported accuracy.
   - A 3D library (e.g. three.js, loaded from npm and only on this screen) is fine if needed. Say why in the PR. No paid services and no map APIs that need keys.
2. **What appears:** only the player's current target (start point, then the next checkpoint, then the final treasure), plus an off-screen edge arrow when it's outside the camera view. Never show other players or their positions. The item gently bobs, spins and glows. Show its distance ("120 m").
3. **Collecting:** when the player is inside the checkpoint's radius, the item becomes tappable. Tap → call the existing claim function with a fresh location reading → coin burst animation, short vibration (`navigator.vibrate`), the new coin total. If the server says "not close enough", show its message and keep the item. Never award anything on the phone.
4. **Fallbacks:**
   - No camera permission, or the camera fails → show the same items on a simple compass/radar screen instead.
   - No true-north heading → hide the 3D arrow and say "Compass not available, use Google Maps", keeping the existing Maps button.
   - Location accuracy worse than about 30 m → show "Getting a better location…" and don't place items yet.
5. **Safety and comfort:**
   - A one-time reminder: "Look up and watch the road. Never play while driving."
   - Pause automatically above about 25 km/h (from GPS speed).
   - Stop the camera, motion sensors and location watching whenever the view closes or the app goes to the background.
6. **Battery and data:** camera frames never leave the phone (no uploads, no image recognition on a server). Limit animation to 30 fps. No polling. The server is contacted only for the existing join, progress and claim calls.

## Rules (must not break)
- **iPhone app:** the camera view stays hidden in the iPhone app, as now (`isIOSApp`). The radar fallback can be shown there.
- **Privacy:** no other player's location, handle or progress may appear in the AR view. Store no location history anywhere.
- **No database changes** unless they are truly needed. If one is, write a new migration file and list it in the PR. Do not apply it yourself.
- Keep cost low: no new servers or live channels, and no extra calls in the background.
- Match the existing treehouse style. Test it at phone width (360 px) in light and dark mode.

## Testing and the PR
- Mock mode (`NEXT_PUBLIC_TH_MOCK=1`): add a fake moving position and heading so the AR view and the radar can be shown without a real phone. `npm run typecheck` and `npx next build` must pass.
- In the PR, write:
  - a plain-English summary of what players will see
  - screenshots (mock mode)
  - what could only be tested on a real phone outdoors
  - any new dependency, and why it's needed
  - a short release note in `release-notes/`
