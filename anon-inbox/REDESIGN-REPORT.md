# treehouse redesign: backend integration report

## What changed (front end, `public/`)
- **Design system** (`hy.css` tokens): Midnight Navy base, Electric Pink = dating (likes, matches, hearts),
  Electric Blue = talking (chats, rooms, requests). Display font Bricolage Grotesque, text Plus Jakarta Sans.
  Flat navy screen headers with a pink→blue "branch line". Light + dark themes, reduced-motion respected.
- **Navigation**: 5 tabs, Discover is the raised centre button; desktop sidebar.
- **Home** (`hy-home.js`): greeting + avatar, Discover / Chatrooms cards, connection stats (likes received,
  matches, message requests, unread), recent activity (matches, requests, chats, your room), people to discover.
- **Chatrooms** (`hy-rooms.js`): search in header, your room + unread, recently visited (this device),
  your state, Popular now, all 37 states A–Z with state badges and online/member counts. Room screen keeps the
  agreed header member dropdown (now blue, shows "N members · M online"); member rows offer "Request".
- **Discover** (`hy-dating.js`): filter chips (location, ages, who), cards with View profile, labelled
  Undo / Pass / Like / Request actions, heart burst, new match celebration.
- **Inbox**: Chats / Requests / Matches tabs. Requests have Accept, Decline and ⋯ (View profile, Block, Report).
  Incoming request chats show Accept / Decline / Block instead of the message box. Sent / Seen receipts.
  Matches tab: new connections, Likes you, your matches.
- **Profile** (`hy-profile.js`): header with avatar, facts, intent, visibility, bio; completion; profile
  management; privacy & safety (incl. blocked people with Unblock); notifications; appearance; account
  (change password by email link, help, privacy, sign out, delete).
- Removed leftover anonymous-link code from the app data layer (`hy-api.js`). The owner's personal link
  (server pages) is untouched.

## Backend added (migration `20261108000019_requests_accept_matches_seen.sql`)
| Change | Why |
|---|---|
| `accept_message_request(conversation)` | Requests are accepted explicitly (brief: never silently) |
| Recipient can't reply before accepting (trigger) | Same rule enforced by the database |
| `my_conversations()` adds `matched`, `accepted_at`, `started_by_me`, `other_read_at` | Matches vs accepted requests, "X accepted your request" notification, Sent/Seen receipts |

Tests: `dating_message_requests.test.sql` updated for explicit accept (20 checks); all 224 pass.

## Needs backend work before it can ship (not simulated in the UI)
| Feature from the brief | What's needed |
|---|---|
| Discovery filters by interests / intentions / distance | Parameters on `discover_cards()`; distance needs location data we don't collect |
| "Who can send me message requests" setting | Column on `dating_profiles` + check in `start_conversation()` |
| Emoji reactions in private chats | Reactions table + realtime, like room reactions |
| Image sharing in chats, profile photos | Storage bucket, upload limits, moderation/review |
| Save multiple avatar designs | Table of saved configs per user (today: one active avatar) |
| Notification preferences per type | Preferences table + filter in the push sender |
| Typing/delivery "delivered" state | Today: typing + Sent/Seen; "delivered" needs per-device receipts |
| Terms of service page | Only the privacy policy exists today |
| Blocked people from chatrooms (account-wide) | Today room blocks are kept on the device |

## Local preview
`dev/mock-server.mjs` + `dev/mock-supabase.js` serve the app with sample data (no real database).
Launch config: `treehouse-preview` (port 4010). `?signedout=1` shows the landing page, `?empty=1` a new account,
`?reset=1` clears both. Not deployed (the Dockerfile only copies `server.js`, `push.js`, `public/`).
