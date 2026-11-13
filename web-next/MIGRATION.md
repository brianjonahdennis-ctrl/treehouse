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
- **Everything is ported** (13 Nov 2026): every screen of the member app now exists here, including
  chatrooms, Nearby, Speed Dating, the avatar editor and push notifications. What's left is testing
  with real accounts on real phones before any switch-over (see the end of this file).

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
| `hy-api.js` | **every** Supabase call | `lib/api.ts` (same function names, same RPCs) | ✅ |
| `hy-state.js` | shared state, option lists, notifications | `lib/state.ts` (+ `useAppState()` hook), `lib/options.ts` | ✅ |
| `hy-ui.js` | element builder, icons, sheets, toasts, pickers | `components/ui.tsx`, `components/overlay.tsx`, `lib/icons.ts`, `lib/util.ts` | ✅ |
| `hy-app.js` | start-up, routing, nav, live nudges, Terms check, "new version" reload | `components/App.tsx` + Next.js routes, `app/home-build/route.ts` | ✅ |
| `hy-onboard.js` | landing, sign up/in (email + Google), verify, reset, onboarding, under-18 | `components/Auth.tsx`, `components/Onboarding.tsx` | ✅ |
| `hy-home.js` | Home hub, status, friends strip, activity, people, install/push card | `components/Home.tsx`, `components/PushInstall.tsx` | ✅ (the Android beta card is switched off in the live app too) |
| `hy-dating.js` → Inbox | chats, requests, friends, matches, likes | `components/Inbox.tsx`, `components/convo.tsx` | ✅ |
| `hy-dating.js` → chat | private chat | `components/Chat.tsx`, `components/photos.tsx`, `components/swipe.ts` | ✅ text, reply, edit, unsend, delete, receipts, typing, online, accept/decline/block, reveal, add friend, report, photos (+ menu: blur until tapped, viewer, report photo), Kickrs challenges, swipe-to-reply |
| `hy-dating.js` → Discover | card deck, filters, match moment, message request, Speed Dating banner | `components/Discover.tsx`, `components/SpeedBanner.tsx` | ✅ buttons + ← → keys (the live app has no drag-to-swipe either) |
| `hy-profile.js` | profile, edit card, preferences, theme, notifications, Nearby settings, blocked, account | `components/Profile.tsx` | ✅ |
| (in `hy-app.js`) | Notifications screen | `components/Notifications.tsx` | ✅ |
| `hy-rooms.js` | chatroom list | `components/Rooms.tsx` | ✅ list, kicked-out notice, age-room lock |
| `hy-rooms.js` | inside a chatroom (live messages, reactions, replies, members, profile cards, kicks) | `components/Room.tsx` | ✅ |
| `hy-nearby.js` | Nearby list + map (Leaflet), filters, location privacy | `components/Nearby.tsx` | ✅ (Leaflet files come from the existing server at `/vendor/leaflet/`) |
| `hy-speed.js` | Speed Dating video dates (WebRTC) | `components/speed.js` (+ `SpeedReport.tsx`, `lib/dom.js`) | ✅ kept as plain browser code, almost line for line, because the call setup is timing-sensitive |
| `hy-avatar.js` | custom avatars on nicknames | `lib/avatars.ts`, `lib/avatar-core.js` | ✅ showing avatars |
| `hy-avatar-ui.js` | avatar picker/editor | `components/AvatarEditor.tsx` | ✅ |
| `hy-photos.js` | pick, shrink, send chat photos; viewer | `lib/photos.ts`, `components/photos.tsx` | ✅ |
| `hy-push.js`, `home-sw.js` | push notifications + service worker | `lib/push.ts`, `public/home-sw.js` (copy), Profile row, Home card | ✅ |
| `hy-install.js`, `home.webmanifest` | "Add to Home Screen" | `lib/install.ts`, `components/PushInstall.tsx`, `public/home.webmanifest` (copy) | ✅ |
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

## Before switching: test on real phones

Nothing below has been tried with real accounts yet (the preview uses sample data). Test each on the
preview address from step 1 of the switch-over, with two real accounts and two phones (Android app,
iPhone home-screen app, a computer browser):

1. Sign up, verify email, sign in with Google (including the Android app's Chrome hand-off), reset password.
2. Push notifications: turn on in Profile, then get a message from the other account with the app closed.
3. Private chat both ways: messages, replies, edits, unsend, receipts, typing, photos (after unlocking).
4. Chatroom: join, chat, react, reply, members, block/report, inactivity kick.
5. Nearby: turn on (location permission), list, map, turn off.
6. Speed Dating: a full date between the two phones (camera, call, timer, like/like → match).
7. Games: Kickrs from the Games tab and a penalty challenge from a chat.
8. Leave a phone on the app for an hour, deploy a change, come back: it should reload by itself.

## Switching over later, with no downtime

The Next.js app already passes every address it doesn't own (`/api/*` except its own
`/api/kickrs/ticket`, `/terms`, `/privacy`, `/u/…`, `/vendor/…`, the landing page) to the existing
server, so the simplest switch is to put it **in front** of the existing server rather than splitting
addresses between the two.

1. **Run it separately first.** Deploy `web-next` as a *second* Railway service (e.g. `treehouse-next`)
   from the `nextjs` branch. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `LEGACY_ORIGIN=https://treehouse.ng` (plus the Kickrs settings in `KICKRS.md`). Give it a preview
   address (e.g. `next.treehouse.ng`). The live service is not touched. *(A deploy: confirm with Hydra first.)*
2. **Allow the preview address in Supabase** (Auth → URL configuration → redirect URLs) so email links
   and Google sign-in can return there. *(A config change: confirm with Hydra first.)*
3. **Test with real accounts** on the preview address (the list above). Both apps share the database,
   so chats show up in both. Fix what's different.
4. **Switch:** give the old service its own address (its Railway URL) and set `LEGACY_ORIGIN` on the
   new service to that address. **Never** leave `LEGACY_ORIGIN` as `https://treehouse.ng` once
   treehouse.ng points at the new service: it would send requests to itself. Then point `treehouse.ng`
   at the new service (Railway custom domain or the Cloudflare DNS record). Switching back = point the
   domain at the old service again; nothing else changes.
5. **Phone apps need no rebuild:** they load `https://treehouse.ng/home`, so they follow the switch.
   Push subscriptions keep working: the worker lives at the same address (`/home-sw.js`) and the
   existing server still sends the notifications.
6. **Later:** decide whether to move the rest of `/api/*` into Next.js too, or keep `server.js` behind it.

## Notes for developers

- Keep `lib/options.ts`, `lib/icons.ts`, `lib/avatar-core.js`, `app/hy.css`, `public/home-sw.js` and
  `components/speed.js` in step with the live files while both apps run (they're copies). `dev/mock-supabase.js` is a copy of `anon-inbox/dev/mock-supabase.js`.
- Screens keep their data in module-level caches (like the live app) so leaving and coming back is instant.
- Sheets: `openSheet((close) => <Form close={close} />)`. Put form state inside a component, not in the closure.
