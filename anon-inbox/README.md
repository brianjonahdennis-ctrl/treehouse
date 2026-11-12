# Tell Hydra

Anonymous messages and anonymous dating, at **https://tell.brianjonahdennis.com**.

- **`/`** — the public page. Anyone can send an anonymous message (no account), and browse
  anonymous dating requests.
- **`/app`** — the owner's private app (password). Inbox, story images, stats, dating reports,
  share tools and settings. Installable to the home screen.
- **`/date`** — Date Anonymously: profile, verified email inbox, anonymous chat and mutual reveal.

---

## How it's built

| Part | What |
|---|---|
| Server | `server.js` — one Node.js file, **no npm dependencies** |
| Pages | Plain HTML/CSS/JS in `public/` (no framework, no build step) |
| Messaging data | JSON files in `DATA_DIR` (`messages.json`, `config.json`, `stats.json`) |
| Dating data | **Supabase**: Postgres + row-level security, email auth, Realtime |
| Hosting | **Railway** (Docker, persistent volume at `/data`), domain via Netlify DNS |
| Email | **Resend** SMTP from `noreply@brianjonahdennis.com` (used by Supabase Auth) |

Anonymous messaging never touches Supabase and never needs an account. Dating is separate and
requires a verified email, so both sides of a chat are accountable.

```
public/
  index.html  send.js  send.css      public page (messages, ad, dating cards)
  app.html    app.js   app.css       owner app (inbox, stats, reports, share, settings)
  date.html   date.js  date.css      Date Anonymously
  supabase.js                        supabase-js 2.119 (UMD), served locally — the CSP allows only own scripts
  config.js                          server address for phone-app builds (empty on the website)
  sw.js  manifest.webmanifest        installable owner app
supabase/
  migrations/                        database schema, policies and functions (apply in order)
  tests/                             pgTAP privacy/safety tests (70 checks)
  run-tests.mjs                      runs the tests against the linked project (no Docker needed)
  templates/                         branded verification and password-reset emails
  config.toml                        Supabase Auth settings (site URL, passwords, SMTP, templates)
```

---

## Run it locally

Requires Node 18+. No `npm install`.

```bash
cd anon-inbox
PORT=4000 node server.js
```

- Public page: http://localhost:4000 · Owner app: http://localhost:4000/app
- The owner password is generated on first run and saved in `data/config.json` (or set `ADMIN_PASSWORD`).

To include dating locally, add the Supabase settings (the publishable key is public by design):

```bash
SUPABASE_URL=https://ctyyxxermexmcknhfmtl.supabase.co \
SUPABASE_PUBLISHABLE_KEY=sb_publishable_... \
DATING_ENABLED=1 PORT=4000 node server.js
```

Email links redirect to `http://localhost:4000/date` locally (allowed in `supabase/config.toml`).
The moderation key is read from `data/DATING_ADMIN_TOKEN` locally.

`.claude/launch.json` in the parent folder already has an `anon-inbox` configuration with these.

---

## Settings (Railway variables)

| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Owner app password (live copy also in `data/LIVE-PASSWORD.txt` on this Mac) |
| `DATA_DIR=/data` | Where messages, settings and stats are stored (Railway volume) |
| `TRUST_PROXY=1` | Read the visitor IP from Railway's proxy headers (rate limiting only; never stored) |
| `MAX_MESSAGES` | Newest messages kept (default 100); older ones are deleted |
| `TIMEZONE` | Day boundaries for stats (default `Africa/Lagos`) |
| `ADSENSE_CLIENT`, `ADSENSE_SLOT` | Google AdSense on the "Sent!" screen (optional) |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Enable `/date` |
| `DATING_ENABLED=1` | Show the "Date Anonymously" button and dating cards on the public page |
| `DATING_ADMIN_TOKEN` | Moderation key for the Reports tab (secret; only its fingerprint is in the database) |

---

## Anonymous messaging

- No accounts, names, emails, cookies or trackers on the public page.
- IP addresses are never saved; rate limiting (5 messages / 10 minutes) uses a salted hash kept
  in memory. Send times are rounded to the hour. No request logging.
- Messages are capped at 250 characters (fits the inbox box at its smallest size).
- Only the newest 100 messages are kept.
- 30-second house ad (Kickrs) once per visit, when someone opens the link (not when they come back to the page while browsing); Skip appears after 10 seconds. Ad links go
  through `/go/<name>` so taps are counted. "Advertise here" links to WhatsApp.
- Optional AdSense ads only load after a message is sent.

Owner app: messages open as story images (press and hold to save), stats (visits, uniques,
sources, devices, hours, ad taps — plus a Dating section: accounts, verified, profiles, chats,
messages, people chatting, mutual reveals, reports, intent, gender, age, top locations, from
`admin_dating_stats()`, counts only), dating reports, share link and sticker, settings.

---

## Anonymous dating

### Flow
1. **Date Anonymously** → profile (name, gender, age 18+, location, 18+ checkbox) → intent
   (Fun / Love / Marriage) → create inbox (email + password) → verification email.
2. The verification link returns to `/date`; `create_my_profile()` makes the profile live with an
   anonymous handle like "Quiet Falcon 214". The draft profile is kept in localStorage and the
   account's private metadata until then, so verifying on another device works.
3. **Dating requests** on the public page show only handle, gender, age, location and intent
   (served by `/api/dating-cards`, so the public page still loads only its own files).
4. **Message** opens an anonymous, live chat. **My chats** lists conversations with unread counts.
5. **Reveal**: either person asks; the other sees "They want to reveal. Reveal too?". Names show
   to both only when both agree. A request can be cancelled until then, not after.
6. **Block / Unblock** and **Report** in every chat. Pause, delete profile or delete the whole
   account from the profile screen. Forgot-password flow with a branded reset email.

### Privacy model (enforced in the database)
- Names live only in `dating_profiles`, readable by the owner alone (row-level security).
- Others see profiles only through `discover_profiles()` / `my_conversations()`, which never
  return a name, email or user id. `revealed_details()` returns a name only when both have revealed.
- Emails stay in Supabase Auth. No public table or function returns them.
- 18+ is enforced by `create_my_profile()` and a table check. Only verified emails get profiles.
- Messages: participants only, not blocked, not suspended, sender is you; 20 per minute.
- Internal helpers live in the `dating_private` schema, which the web API doesn't expose.

### App-facing database functions
`create_my_profile`, `discover_profiles`, `start_conversation`, `my_conversations`,
`mark_conversation_read`, `revealed_details`, `block_conversation_partner`,
`unblock_conversation_partner`, `report_conversation_partner`, `delete_my_account`.
Messages and reveals are plain inserts/deletes guarded by row-level security.

### Moderation
`/app` → **Reports**: reason, details, handles, report count, last 30 messages of the chat;
Mark reviewed / Reopen / Suspend / Restore. The server calls `admin_dating_reports`,
`admin_set_report_status` and `admin_suspend_reported` with `DATING_ADMIN_TOKEN`.
To rotate the key: generate a new `tha_…` token, add its SHA-256 fingerprint to
`dating_private.admin_key` in a migration, update the variable, then remove the old fingerprint.

---

## Personal links (multi-user, in progress)

Anyone can get their own anonymous link, NGL style, with the same account as dating.

- **Database** (`20261107000000_links.sql`): `links` (username, display name, prompt, paused,
  suspended), `link_messages` (owner-only; times rounded to the hour; newest 100 kept),
  `link_reports`. Functions: `claim_link`, `username_available`, `public_link`,
  `send_link_message` (anonymous; 250 chars; 30/min and 300/hour per link), `report_link_message`.
  A link and a dating profile on the same account are never returned together.
- **`/link`** (`link.html`, `link.js`, `link.css`): welcome → sign up / sign in (13+) → choose
  username (live availability check) → your link (copy, share, preview, edit, pause).
- Tests: `supabase/tests/links.test.sql` (24). All suites: 101 checks.
- **`/u/<username>`** serves the same send page (`index.html`, all asset paths absolute). `send.js`
  detects the username, loads `/api/u/<username>` (server → `public_link`) and sends to
  `/api/u/<username>/messages` (server → per-visitor in-memory limit → `send_link_message`).
  Members show an initial instead of a photo. Unknown/paused links show "Link not found".
- "🔗 Get your own anonymous link" (→ `/link`) on every send page and the Sent screen.
- **Members' inbox** on `/link` (signed in): live list (Realtime + 20s fallback), messages open as
  story images (`story.js`, shared with the owner app) with the member's own link in the footer;
  Share / Save / press-and-hold; Delete; Report (7 reasons); story sticker; link settings.
- **Moderation**: `/app` → Reports → **Links** (`admin_link_reports`, `admin_set_link_report_status`,
  `admin_suspend_link`, via `/api/link-reports`). Tests: `links_admin.test.sql` (6). All suites: 107.
- **Tab bar** for signed-in members on `/link` and `/date` (`nav.js`): 💌 Inbox (`/link`) · 🔍 Browse
  (`/date?view=browse`, dating cards inside the app, no ad) · 💘 Dating (`/date?view=chats`), with
  unread badges. Hidden for visitors and inside a chat.
- The owner's homepage (`/`) and private app (`/app`) stay as they are; the owner's member link is @shadow.

---

## The member app (/home)

A redesigned, single-page app for members at **/home** (Home · Messages · Discover · Matches · Profile,
bottom bar on phones, sidebar on desktop, light and dark). It replaced the classic member pages: /link and /date now redirect to /home (the redirect keeps the #fragment of
email links, so confirmations and password resets still sign people in). link.html and date.html are kept in
public/ but no longer served. Same accounts and Supabase rules; no build step.

- `public/home.html` – the page; `hy.css` – design system (tokens, components, screens)
- `hy-app.js` – start-up, routing (/home/messages …), navigation, notifications, live updates
- `hy-state.js` – shared state and the option lists; `hy-api.js` – every Supabase call
- `hy-ui.js` – element builder, icons, avatars, sheets, toasts
- Screens: `hy-onboard.js`, `hy-home.js`, `hy-messages.js`, `hy-dating.js`, `hy-profile.js`

Likes, requests, matches, bio/interests/preferences and message reactions need the migration
`20261108000000_dating_matching.sql`. The app detects it at start-up; until it's applied those parts
show as "coming soon" and Discover falls back to the classic "message anyone" flow.

Location: `20261108000003_dating_states.sql` adds a Nigerian state to every dating profile (picked
from a dropdown of the 36 states + FCT; existing typed-in areas were matched to a state where it was
clear) and a Discover filter (`pref_state`, starts as their own state; empty = anywhere in Nigeria).
The state list lives in the database (`dating_private.nigerian_states()`) and in `hy-state.js`.

Message requests: `20261108000002_dating_message_requests.sql` lets anyone message anyone; the first
message is a request until the other person replies (3 messages max until then), and they can decline.

Requests-only dating (superseded by message requests): `20261108000001_dating_requests_only.sql` makes start_conversation() open a chat only
for an existing match or someone who already liked you. Still to build: profile photos (storage +
moderation) and push notifications. Optional: push `site_url`/`additional_redirect_urls` (config.toml now
includes /home) so emails link to /home directly instead of via the /date redirect.

## Supabase

Project `tell-hydra-dating` (ref `ctyyxxermexmcknhfmtl`, Frankfurt). CLI installed at
`~/.local/supabase/node_modules/.bin/supabase` and linked in `anon-inbox/`.

```bash
# apply new migrations (review with --dry-run first)
supabase db push --remote
# run the 70 privacy/safety tests (rolled back; leaves no data)
node supabase/run-tests.mjs
# push Auth settings from config.toml (shows a diff; review it — it pushes every declared setting)
supabase config push
```

- **Email (SMTP):** Resend, domain `brianjonahdennis.com` (EU), DNS records in Netlify:
  TXT `resend._domainkey`, CNAME `send` and `rsend`, TXT `_dmarc`. Limit 100 emails/hour.
  The Resend key is saved only in Supabase (Dashboard → Authentication → SMTP). To replace it,
  create a key in Resend **in your own browser** and paste it into that Password field.
- **Sign-up limits:** Supabase Auth's built-in rate limits apply (sign-ups/sign-ins per IP,
  emails per hour); one profile per account; reports limited to 10/hour per person.
- **Later:** turn on *Leaked password protection* (Supabase paid plans) to block breached passwords.

---

## Deploy

```bash
cd anon-inbox
~/.local/railway/node_modules/.bin/railway up --service tell-hydra
```

When `public/sw.js` or owner-app files change, bump the `CACHE` name in `sw.js` so installed apps
pick up the update.

---

## Shipping to Google Play and the App Store (Capacitor)

The pages are plain HTML/JS, which Capacitor can wrap as Android and iOS apps. What's already
prepared, and what to do at build time:

1. **Server address** — pages call the server through `window.TH_CONFIG.apiBase`
   (`public/config.js`, empty on the website). In the app build, set it to
   `https://tell.brianjonahdennis.com`, and set `siteUrl` to the same so email links open the website.
2. **CORS** — the app's pages load from `capacitor://localhost` / `https://localhost`, so the server
   must allow those origins on `/api/*` (add `Access-Control-Allow-Origin` for them before shipping).
3. **Email links into the app** — verification and reset links go to `https://tell.brianjonahdennis.com/date`.
   To open them in the app, set up Android App Links (`/.well-known/assetlinks.json`) and iOS
   Universal Links (`/.well-known/apple-app-site-association`), served by `server.js`, and add the
   app's URL to Supabase's redirect URLs. Consider PKCE (`flowType: 'pkce'`) for the app build.
4. **Storage** — sessions and drafts use localStorage/sessionStorage with try/catch fallbacks; for
   long-lived sign-ins in the app, back supabase-js `auth.storage` with `@capacitor/preferences`.
5. **Native features** — Share (`navigator.share`) → `@capacitor/share`; clipboard →
   `@capacitor/clipboard`; saving story images → `@capacitor/filesystem`; new-message alerts →
   `@capacitor/push-notifications` (needs a small server/Supabase function to send pushes).
6. **Store requirements** — both stores require in-app account deletion (done: Delete my whole
   account), reporting and blocking (done), an 18+ age rating, and a privacy policy URL.
7. **Not used inside the app** — the service worker (`sw.js`) is for the installable website only.
