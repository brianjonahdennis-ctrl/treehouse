# treehouse admin (admin.treehouse.ng)

The staff console for the whole app: reports, members, private chats (with rules), chatrooms,
announcements, ads, referrals, settings, staff and the audit log.

It is a small Next.js app in its own folder, deployed as its own Railway service, on its own address.
It uses the same Supabase project and the same public key as the member app. It holds no secret keys:
every permission is checked inside the database.

## How staff get in

1. Sign in with their treehouse account (Google, or email and password).
2. The first time, scan a QR code with Google Authenticator (or any authenticator app) and type the 6-digit code.
   After that, every sign-in asks for a fresh code.
3. Only people on the staff list get past this point. The database also refuses every staff action
   from a session that hasn't passed the authenticator step, even if someone calls it directly.

## Roles

| Role | Can do |
|---|---|
| Super Admin | Everything. Add or remove staff, delete accounts, change rating rules, open **any** private chat (must write a reason). |
| Admin | Moderation, members (sees emails and real names), close/reopen rooms, ads, referrals, settings, audit log. |
| Moderator | Reports, members (no emails or real names), suspend, room bans, read rooms, open **reported** chats only. |
| Editor | Announcements and ads. |
| Analyst | Dashboard and results only. |

Roles live in the existing `announcement_staff` table (the announcements roles, plus the new Moderator).

## What's private and what's logged

- Moderators and Admins can only read a private chat if someone **reported** it. Super Admins can open any
  chat, but must type why, and the reason is saved.
- Every change (suspend, ban, delete, settings, ads, staff…) and every look at a member, a reported chat or
  any chat is saved in the audit log with who, when and why.
- Real names, emails and dates of birth are only shown to Admins and Super Admins.

## Setting it up (Brian)

Everything below is a one-time job. Nothing here changes the member app until step 1 is done, and step 1
only **adds** things (new tables, new functions, two safety triggers, one column on `room_reports`).

1. **Database.** Apply `anon-inbox/supabase/migrations/20261114000091_staff_console.sql`
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
