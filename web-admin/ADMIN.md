# treehouse admin (admin.treehouse.ng)

The staff console for the whole app: reports, members, private chats (with rules), chatrooms,
announcements, ads, referrals, Treasure Hunts, settings, staff and the audit log.

It is a small Next.js app in its own folder, deployed as its own Railway service, on its own address.
It uses the same Supabase project and the same public key as the member app. It holds no secret keys:
every permission is checked inside the database.

## How staff get in

1. Sign in with their treehouse account (Google, or email and password).
2. The first time, scan a QR code with Google Authenticator (or any authenticator app) and type the 6-digit code.
   After that, every sign-in asks for a fresh code.
3. Only people on the staff list get past this point. The database also refuses staff actions
   from a session that hasn't passed the authenticator step, even if someone calls it directly.
   Exception: Hydra can manage Treasure Hunts from the signed-in Treehouse app without a code; the
   admin website and all other staff actions still require the authenticator step.

## Roles

| Role | Can do |
|---|---|
| Super Admin | Everything. Add or remove staff, delete accounts, change rating rules, open **any** private chat (must write a reason). |
| Admin | Moderation, members (sees emails and real names), close/reopen rooms, ads, referrals, settings, audit log. |
| Moderator | Reports, members (no emails or real names), suspend, room bans, read rooms, open **reported** chats only. |
| Editor | Announcements and ads. |
| Analyst | Dashboard and results only. |

Roles live in the existing `announcement_staff` table (the announcements roles, plus the new Moderator).

## Treasure Hunts

Admins and Super Admins can create and manage Treasure Hunts from **Grow → Treasure Hunts**. The same setup is available in the Treehouse app under **Profile → Product Announcements → Treasure Hunt setup**. Every new hunt starts with one required public checkpoint, one start and one grand-prize location. Add as many extra checkpoints as the route needs; any checkpoint can be removed as long as one remains. Set each pin, clue, check radius and in-game coin reward. Staff can open an area in Google Maps and paste a shared link or coordinate pair to fill a pin; no Maps API key is needed. Choose the coin and treasure designs, then set hunt dates and status. Double-check every location for safety before opening a route. When a player joins, the nearest start and grand-prize locations are assigned from that one location reading; the member follows the route in Google Maps and checks in at each stop. After a player joins, locations, dates and rewards are locked; staff can still cancel the hunt. The staff page shows player counts, not member location history. Coins are game points and are not cash.

**Sign-up and location (18 Nov 2026).** Every new hunt must have a **state** (36 states + FCT). Members anywhere see it, but only members whose profile is in that state can register; others see why. Registering is required before playing. When the hunt starts, a player must also be within the **start area** (km from a checkpoint, default 60) to begin. Registered members only see how many people registered, never who. A scheduled hunt goes live by itself at its start time. Once anyone registers, the state is locked. Older hunts with no state keep working as before.

**Hunt live** shows everyone registered for an upcoming or running hunt with their profile and progress (checkpoints, coins, last check-in). **Hunt results** shows a finished hunt's top 20 by finish time and every competitor. Both have **Message competitors**: it sends an announcement only to that hunt's registrants (or only those who started), to their Inbox and as a notification. Opening these pages and sending messages are saved in the audit log. **Prizes**: in hunt setup, add pictures (under 1.5 MB) or videos (under 20 MB) with a name and place (1st–20th, or everyone who finishes). They are stored in the `hunt-prizes` bucket, which only Admins can upload to.

## What's private and what's logged

- Moderators and Admins can only read a private chat if someone **reported** it. Super Admins can open any
  chat, but must type why, and the reason is saved.
- Every change (suspend, ban, delete, settings, ads, staff…) and every look at a member, a reported chat or
  any chat is saved in the audit log with who, when and why.
- Real names, emails and dates of birth are only shown to Admins and Super Admins.

## Setting it up (Brian)

Everything below is a one-time job. Nothing here changes the member app until step 1 is done, and step 1
only **adds** things (new tables, new functions, two safety triggers, one column on `room_reports`).

1. **Database.** Apply `anon-inbox/supabase/migrations/20261115000097_staff_console.sql` and `20261115000098_invite_leaderboard.sql`
   (`supabase db push --remote --dry-run`, check, then without `--dry-run`). Tests:
   `anon-inbox/supabase/tests/staff_console.test.sql` (68 checks).
2. **Make yourself Super Admin.** In Supabase → SQL editor, with your treehouse handle (and Boma's):
   ```sql
   insert into public.announcement_staff (user_id, role, can_publish)
   select user_id, 'super_admin', true from public.dating_profiles where handle in ('YOUR_HANDLE')
   on conflict (user_id) do update set role = 'super_admin', can_publish = true;
   ```
   After that, add everyone else from the console's **Staff** page.
3. **Supabase → Authentication:**
   - URL Configuration → Redirect URLs: add `https://admin.treehouse.ng/**`
   - Multi-Factor: make sure **TOTP (authenticator app)** is enabled (it is by default).
4. **Railway:** New service from this repo, branch `nextjs` (once merged), **Root directory `web-admin`**.
   Build `npm run build`, start `npm start`. Variables:
   `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the same values as treehouse-next).
5. **Domain:** in the new service → Settings → Networking → custom domain `admin.treehouse.ng`, then add the
   CNAME Railway shows in Cloudflare (DNS for treehouse.ng).
6. Open https://admin.treehouse.ng, sign in, set up the authenticator.

**Lost phone?** In Supabase → Authentication → Users → that person → remove their MFA factor. Next sign-in
they set up a new one.

## Ads

Staff make sponsored cards (headline, short text, optional picture, button, link) and choose where they show:
Home, Chatrooms list, Discover, Inbox. Targeting by state, gender and age; start/end dates; a "share of slots"
number when several ads fit. Pictures upload to a public `ads` storage bucket (only content staff can write to it).
Views and taps are counted once per member per day, so the numbers are people, not refreshes.
Settings → **Show ads** turns them all off at once.

Member app: `components/AdSlot.tsx` (shows nothing if there's no ad, or before the migration is applied).

## Referrals

Every member gets an invite link, `treehouse.ng/r/<code>` (Profile → Invite friends). The link remembers the code
for 30 days and opens the app. When the new person finishes sign-up, the database credits the inviter
(only accounts less than 3 days old can be credited, once, and never with your own code). Staff can make
campaign codes (flyers, influencers, partners), see top inviters, who joined with each code, how many came back
after 2 days, and bursts (many sign-ups in one hour) that suggest fake accounts. Any code can be switched off.
There are no rewards yet; the numbers are there when you decide on one.

Member app: `app/r/[code]/route.ts`, `lib/referral.ts`, the Invite friends row in `components/Profile.tsx`.

## Man & Woman of the Week

Members see a weekly leaderboard of the top 50 inviters (`/home/invite`, also from a Home card and Profile → Invite friends).
Weeks run Monday to Sunday, Lagos time. Every Monday at 12:00 the #1 of the week before is announced to **all members**
through Product Announcements (with a push to people who allow treehouse updates) as **Man of the Week**,
**Woman of the Week**, or **Star of the Week** for non-binary members, using their nickname only.

- Only real invites count: the friend joined with the link that week, came back at least 12 hours after joining,
  and isn't suspended or marked under 18. Ties go to whoever got there first.
- Nobody is announced if the leader has fewer than the minimum (Settings → Invites needed to win, default 3).
- Staff (Admins) can disqualify someone for the current or last week before the announcement (Referrals page),
  with a reason that goes in the audit log. The panel shows "all joins" next to "counts" to make fake accounts easy to spot.
- Settings → Announce Man & Woman of the Week turns the Monday announcement off.
- Database: `20261115000098_invite_leaderboard.sql` (job `invite-of-the-week`, Mondays 11:00 UTC). Tests:
  `invite_leaderboard.test.sql` (16 checks).

## Settings that act straight away

- **Pause new sign-ups** (with the message people see) for spam waves or outages.
- **Show ads**, **Credit referrals**.
- **Blocked words** (the existing chat/room word filter).
- **Star rating rules** (Super Admin only).
- **Close a chatroom** (Chatrooms → room → Close room): everyone is moved out and nobody can join or post
  until it's reopened.

## Run it locally

```bash
cd web-admin && npm install
NEXT_PUBLIC_ADMIN_MOCK=1 npm run dev        # http://localhost:4030, sample data, authenticator code 123456
                                            # ?role=moderator (or admin, editor, analyst) to see other roles
```

## Notes

- The existing announcements screen inside the member app (`/home/admin/announcements`) still works and doesn't
  ask for the authenticator code. Once everyone uses admin.treehouse.ng, consider removing it.
- Security headers: strict content security policy with a per-request nonce, no framing, no indexing, no caching.
