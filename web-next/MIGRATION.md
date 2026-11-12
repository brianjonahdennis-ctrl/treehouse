# treehouse → Next.js (React): migration plan and progress

This folder is a **new version of the treehouse member app** (`/home`) built with Next.js and React.
It lives on the `nextjs` branch only. The live site (`anon-inbox/`, deployed from `main`) is untouched
and keeps running exactly as before. Nothing here talks to Railway, Cloudflare or changes the database.

## In plain words

- **Same database, same rules.** The new app uses the same Supabase project, the same public
  ("publishable") key and the exact same database functions as the live app. Privacy still lives in
  the database: nobody gets anyone else's name, email or id. No database changes were made.
- **Same look.** The design system file (`hy.css`) is copied over unchanged, and the React screens
  use the same class names, so the new app looks the same as the live one.
- **Same security.** Every page gets a strict Content Security Policy (only our own scripts run,
  each page view gets a fresh random "nonce"). No secret keys exist in this app.
- **Not finished.** The everyday screens are ported (below). A few big ones still open the current
  app instead (chatroom conversations, Nearby, Speed Dating, avatar editor, push notifications).

## How to run it

```bash
cd web-next
npm install
cp .env.example .env.local       # then fill in the two public Supabase values, or set NEXT_PUBLIC_TH_MOCK=1
npm run dev                      # http://localhost:4020/home
```

- `NEXT_PUBLIC_TH_MOCK=1` uses the sample-data preview (the same fake client as `anon-inbox/dev`),
  so you can click through everything with no database. `?signedout=1` shows the landing page,
  `?empty=1` a brand-new account, `?reset=1` resets the preview.
- In the Claude app there's a launch config `treehouse-next` (port 4020, sample data).
- `npm run build && npm start` runs the production version.

## Inventory of the current app → where it went

| Live app (`anon-inbox/public`) | What it does | Next.js (`web-next`) | Status |
|---|---|---|---|
| `home.html` | page shell, fonts, theme-before-paint | `app/layout.tsx`, `public/hy-theme.js` | ✅ |
| `hy.css` (1,678 lines) | design system, light/dark | `app/hy.css` (copied as-is) | ✅ |
| `hy-api.js` | **every** Supabase call | `lib/api.ts` (same function names, same RPCs) | ✅ all calls except Nearby/Speed details |
| `hy-state.js` | shared state, option lists, notifications | `lib/state.ts` (+ `useAppState()` hook), `lib/options.ts` | ✅ |
| `hy-ui.js` | element builder, icons, sheets, toasts, pickers | `components/ui.tsx`, `components/overlay.tsx`, `lib/icons.ts`, `lib/util.ts` | ✅ |
| `hy-app.js` | start-up, routing, nav, live nudges, Terms check | `components/App.tsx` + Next.js routes | ✅ (see "left to do") |
| `hy-onboard.js` | landing, sign up/in (email + Google), verify, reset, onboarding, under-18 | `components/Auth.tsx`, `components/Onboarding.tsx` | ✅ |
| `hy-home.js` | Home hub, status, friends strip, activity, people | `components/Home.tsx` | ✅ (no install/push/beta cards yet) |
| `hy-dating.js` → Inbox | chats, requests, friends, matches, likes | `components/Inbox.tsx`, `components/convo.tsx` | ✅ |
| `hy-dating.js` → chat | private chat | `components/Chat.tsx` | ✅ text, reply, edit, unsend, delete, receipts, typing, online, accept/decline/block, reveal, add friend, report, view and send photos (+ menu), Kickrs challenges. ⏳ swipe-to-reply |
| `hy-dating.js` → Discover | card deck, filters, match moment, message request | `components/Discover.tsx` | ✅ buttons + ← → keys. ⏳ drag-to-swipe, Speed Dating banner |
| `hy-profile.js` | profile, edit card, preferences, theme, blocked, account | `components/Profile.tsx` | ✅ (avatar editor, Nearby settings and push open the current app) |
| (in `hy-app.js`) | Notifications screen | `components/Notifications.tsx` | ✅ |
| `hy-rooms.js` | chatroom list | `components/Rooms.tsx` | ✅ list, kicked-out notice, age-room lock |
| `hy-rooms.js` | inside a chatroom (live messages, reactions, members, profile cards) | `app/home/rooms/[room]` | ⏳ shows "open in current app" |
| `hy-nearby.js` | Nearby list + map (Leaflet) | `app/home/discover/nearby` | ⏳ |
| `hy-speed.js` | Speed Dating video dates (WebRTC) | – | ⏳ |
| `hy-avatar.js` | custom avatars on nicknames | `lib/avatars.ts`, `lib/avatar-core.js` | ✅ showing avatars |
| `hy-avatar-ui.js` | avatar picker/editor | – | ⏳ |
| `hy-photos.js` | pick, shrink, send chat photos; viewer | `lib/photos.ts`, `PhotoBox` and the + menu in `Chat.tsx` | ✅ |
| `hy-push.js`, `home-sw.js` | push notifications + service worker | – | ⏳ |
| `hy-install.js`, `home.webmanifest` | "Add to Home Screen" | – | ⏳ |
| (new) | Games tab, Home games card, Kickrs games, Profile avatar top left | `components/Games.tsx`, `lib/kickrs.ts`, `app/api/kickrs/ticket`, `app/home/games`, `app/home/connect/kickrs` | ✅ new feature, see `KICKRS.md` |
| `server.js` routes | `/api/*`, `/terms`, `/privacy`, `/u/<name>`, landing `/` | passed through to the existing server (`next.config.ts` fallback rewrite, `LEGACY_ORIGIN`) | ✅ no change needed |

## How the important parts work

**Routes.** Real Next.js routes instead of the hand-made router: `/home`, `/home/discover`,
`/home/matches/[likes|chats|requests|matches|friends|<chat id>]`, `/home/profile`,
`/home/notifications`, `/home/rooms`, `/home/rooms/<room>`. Same addresses as the live app, so
links in emails and push notifications keep working.

**Auth.** Supabase auth in the browser, exactly as now: email + password, "Continue with Google"
(including the Android app's Chrome hand-off), email links with `token_hash`, password reset, the
Terms of Use check. The session stays on the device; the server only sends the loading screen.

**Realtime.** Same private channels: `user:<id>` inbox nudges (new message / closed chat),
`chat:<id>` messages + edits, `hy-chat-<id>` typing / read / presence. Same polling limits
(chat list at most every 30 s, 10-minute safety poll, room heartbeat every 3 minutes, back-off when
the server struggles).

**State.** `lib/state.ts` is the same shared state object as `hy-state.js`; components call
`useAppState()` and re-render when anything calls `emit()`. Keys saved on the device (theme,
notification "seen" time, revealed names, people cache) are the same, so switching between the two
apps keeps them.

**Security.** `proxy.ts` sets the CSP (same allow-list as the live server's `DATING_CSP`, plus
a per-request nonce for Next.js's own scripts). Production builds use no inline styles on first load.
`next.config.ts` adds `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`. Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
are needed, both already public.

## Order to port the rest

1. **Push notifications + service worker** (`hy-push.js`, `home-sw.js`): needed before any switch-over,
   or people stop getting notified. Serve `home-sw.js` from the Next app at the same address.
2. **Chatroom conversations** (`hy-rooms.js` `openRoom`): the biggest screen (live messages, reactions,
   replies, members, kicks, block/report).
3. Swipe-to-reply.
4. **Avatar picker/editor**, **Install card**, **Android beta card**.
5. **Nearby** (list + Leaflet map, served locally for the CSP).
6. **Speed Dating** (WebRTC, `/api/speed-ice` stays on the existing server).
7. "New version? reload" check (`/api/app-build`) and the app badge polish.
8. Side-by-side testing on real phones (Android app, iPhone web app) against the real database.

## Switching over later, with no downtime

1. **Run it separately first.** Deploy `web-next` as a *second* Railway service (e.g. `treehouse-next`)
   from the `nextjs` branch, with its own preview address (e.g. `next.treehouse.ng` or the Railway URL).
   Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
   `LEGACY_ORIGIN=https://treehouse.ng`. The live service is not touched.
2. **Add the preview address to Supabase's allowed redirect URLs** (Auth settings) so email links and
   Google sign-in can return there. This is a config change: confirm with Hydra first.
3. **Test with real accounts** on the preview address (both apps share the database, so chats show up
   in both). Fix what's different.
4. **Switch traffic gradually:** point only `/home` at the new service (Cloudflare rule or the existing
   server proxying `/home` to it) while everything else (`/`, `/api/*`, `/u/…`) stays on `server.js`.
   Switching back is one setting.
5. **Phone apps need no rebuild:** they load `https://treehouse.ng/home`, so they follow the switch.
6. Once everything is ported and stable, decide whether to move `/api/*` into Next.js too or keep
   `server.js` for them.

## Notes for developers

- Keep `lib/options.ts`, `lib/icons.ts`, `lib/avatar-core.js` and `app/hy.css` in step with the live
  files while both apps run (they're copies). `dev/mock-supabase.js` is a copy of `anon-inbox/dev/mock-supabase.js`.
- Screens keep their data in module-level caches (like the live app) so leaving and coming back is instant.
- Sheets: `openSheet((close) => <Form close={close} />)`. Put form state inside a component, not in the closure.
