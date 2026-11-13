# treehouse — project memory

treehouse (formerly "Tell Hydra") is an anonymous social app for Nigeria: anonymous dating (18+),
chatrooms (per state, university, topic), friends, statuses, Nearby, and anonymous messages.
Members never show their real name until both people agree to reveal.

- Live: **https://app.treehouse.ng** (member app), **https://treehouse.ng** (landing; treehouse.ng/home still
  serves the app for installed phone apps and people signed in there) and **https://tell.brianjonahdennis.com** (owner's link)
- Member app: `/home` · public send page: `/` · owner's private app: `/app` · personal links: `/u/<name>`
- Full docs: `README.md` (architecture), `DOMAIN-MOVE.md` (treehouse.ng switch-over checklist),
  `REDESIGN-REPORT.md` (design system + backend gaps), `../tell-hydra-app/README.md` and
  `../tell-hydra-app/play/PLAY-STORE.md` (store builds and listing)

## Stack (keep it this way)
- `server.js`: one Node file, **no npm dependencies**. Don't add any.
- `public/`: plain HTML/CSS/JS, **no framework, no build step**. CSP allows only our own scripts, so
  vendor libraries are served locally (`supabase.js`, `vendor/leaflet`).
- Member app = `home.html` + `hy.css` (design system) + `hy-*.js` modules:
  `hy-app` (start-up, routing), `hy-state` (shared state, option lists), `hy-api` (**every** Supabase call),
  `hy-ui` (elements, icons, sheets, toasts), screens `hy-onboard`, `hy-home`, `hy-dating`, `hy-rooms`,
  `hy-nearby`, `hy-profile`, `hy-avatar(-ui)`, `hy-push`, `hy-install`, `hy-speed` (Speed Dating video dates; relay env CF_TURN_KEY_ID + CF_TURN_KEY_TOKEN, SPEED_DEV=1 for local).
- Data: Supabase project `tell-hydra-dating` (ref `ctyyxxermexmcknhfmtl`, Frankfurt): Postgres + RLS,
  email auth, Realtime. Anonymous owner-inbox messages stay in JSON files in `DATA_DIR`, never Supabase.
- Hosting: Railway service `tell-hydra` (Docker, volume `/data`). DNS: Cloudflare (treehouse.ng),
  Netlify (brianjonahdennis.com). Email: Resend SMTP.

## Rules that matter
- **Privacy lives in the database.** Names, emails and user ids are never returned to other users;
  only functions like `discover_profiles()` / `my_conversations()` expose safe fields. Internal helpers
  go in the `dating_private` schema. New tables: enable RLS, revoke direct access, go through functions.
- 18+ for dating is enforced by `create_my_profile()` and a table check. Don't weaken it.
- Every schema change is a **new** migration in `supabase/migrations/` named
  `YYYYMMDDNNNNNN_short_name.sql` (next number after the latest). Never edit an applied migration.
- Add pgTAP tests in `supabase/tests/` for new privacy/safety rules, then run them.
- Design: Midnight Navy base, Electric Pink = dating, Electric Blue = talking/chats. Fonts Bricolage
  Grotesque (display) and Plus Jakarta Sans (text). Light + dark themes; respect reduced motion.
- When `sw.js`/`home-sw.js` or owner-app files change, bump the `CACHE` name so installed apps update.
- The phone apps load the live site, so web changes ship without a new APK. Rebuild only for shell
  changes (name, icon, version, native plugins) and raise versionCode/versionName first.

## Commands
```bash
PORT=4000 node server.js                      # local (add SUPABASE_* + DATING_ENABLED=1 for dating)
PORT=4010 node dev/mock-server.mjs            # preview with fake data (?signedout=1, ?empty=1, ?reset=1)
~/.local/supabase/node_modules/.bin/supabase db push --remote --dry-run   # review, then without --dry-run
node supabase/run-tests.mjs                   # pgTAP tests, rolled back, no data left behind
./deploy.sh                                   # deploy (copies the site to a clean folder, then railway up)
```
Confirm with Hydra before `db push`, `config push` or `railway up`: they change the live app.

## Open items (as of 10 Nov 2026)
- treehouse.ng switch-over: follow `DOMAIN-MOVE.md` (CANONICAL_HOST not yet set; Supabase site_url and
  app rebuild to 1.4 pending once the domain is live).
- Backend gaps listed in `REDESIGN-REPORT.md` (photos/storage, per-type notification settings,
  chat image sharing, terms page, account-wide room blocks).
- Monetisation is being planned. Existing hooks: house video ads with `/go/<name>` tap counting
  (none running since 12 Nov 2026: `VIDEO_ADS` in send.js is empty and the #intro block is removed;
  videos would be served from img.treehouse.ng/ads/),
  "Advertise here" (WhatsApp), optional AdSense on the Sent screen only.
