Redesign the treehouse home screen cards (repo `brianjonahdennis-ctrl/treehouse`). Start from the `nextjs` branch and open a PR into `nextjs`. This is a **looks-only change**: no database changes, no new data, no new server calls.

## Read first
- `web-next/components/Home.tsx`:
  - `FeatureCard` and the `.hm-features` block (Discover + Chatrooms)
  - the order `<GamesCard />`, `<TreehouseCard />`, `<InviteCard />`
- `web-next/components/Games.tsx` (`GamesCard`), `web-next/components/MyTreehouse.tsx` and `web-next/components/InviteBoard.tsx` (the "Man & Woman of the Week" card)
- `web-next/app/hy.css`: the `.hm-feature`, `.hf-*`, `.hg-*` styles

## What Hydra wants
**Now:** Discover and Chatrooms are two square boxes side by side. Games, My Treehouse and Man & Woman of the Week are wide banners underneath, each with its own big button and emoji picture.

**Wanted:** every one of them becomes a box exactly like Discover and Chatrooms, plus a new "Events" box. That makes **six boxes in a 2-column grid** (3 rows):

| Left | Right |
|---|---|
| Discover (pink, flame) | Chatrooms (blue, people) |
| Games (purple, gamepad) | My Treehouse (teal/green, network/tree icon) |
| Man & Woman of the Week (gold/orange, trophy or sparkle) | Events: **Coming soon** (violet or indigo, calendar) |

Each box uses the same layout as the current `FeatureCard`:
- a rounded coloured icon square at the top left
- an optional small badge at the top right
- a bold title
- one or two lines of text
- a coloured "action ›" line at the bottom
- the faint corner circle in the box's colour

Make `FeatureCard` reusable for all six, taking the colour (kind), icon, title, text, badge, action text and click as inputs, rather than writing six copies. Each box gets its own colour. The new colours must work in light and dark mode.

## Text for each new box (keep it short so it fits a half-width box)
- **Games**
  - Text: "Play, compete and meet new people."
  - Action: "Play games ›" (opens the games screen, as now)
- **My Treehouse**
  - Text: "1,589 people in your network". Keep the live count it shows today, and the same wording when the count is 0.
  - Action: "View ›" (opens My Treehouse, as now)
- **Man & Woman of the Week**
  - Title: "Of the Week", or "Man & Woman of the Week" if it fits on two lines at 360 px.
  - Text: "Lucky Dolphin 414 won last week. Your turn?" Keep the live winner text and the same fallback when there is no winner.
  - Badge: the member's rank, e.g. "You're #1", when they have one.
  - Action: "See the board ›"
- **Events (new)**
  - Title: "Events"
  - Text: "treehouse meetups and parties near you."
  - Badge: "Coming soon"
  - Action: "Coming soon". Tapping it shows a short toast/notice: "Events are coming soon. Watch this space!" It does not open a new page.
  - The box looks slightly quieter (no hover lift) so it's clearly not open yet.
  - **Do not build any events feature, table or page**: it is only a placeholder box.

## Keep exactly as now
- Discover and Chatrooms keep their text, badges ("6 likes", "12 new", "You're in Lagos · 40 online") and where they go.
- Whatever each card does now when tapped, and any condition for showing or hiding it (e.g. if the Games or Of-the-Week card is hidden for some members or in the iPhone app, keep that rule). When a box is hidden, the grid closes the gap with no empty hole. An odd box at the end can stay half-width.
- The rest of the home screen (hero, friends strip, ad slot, "Your connections", app card) is unchanged and stays in the same order.
- Remove the old wide-banner styles only if nothing else uses them (`GamesCard` may also be used on the Games screen: check before deleting).

## Design checks
- At 360 px wide, all six boxes are the same height in each row, no text is cut off or overflows, and long numbers (e.g. "12,345 people") still fit.
- Light and dark mode both look right.
- Tap targets: the whole box is one button. Use accessible labels (e.g. "Events, coming soon").
- Match the existing treehouse style and spacing. No new images; use the existing `Icon` set (add an icon only if one is missing, such as a calendar or trophy).

## Testing and the PR
- Check it in mock mode (`NEXT_PUBLIC_TH_MOCK=1`).
- `npm run typecheck` and `npx next build` must pass in `web-next`.
- The PR must include:
  - a plain-English summary for Hydra
  - screenshots at 360 px in light and dark mode
  - a short release note in `release-notes/`
