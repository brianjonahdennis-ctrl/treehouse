# treehouse — Google Play submission kit

Everything to paste into Play Console. Files in this folder:

| File | Where it goes |
|---|---|
| `treehouse-1.4.aab` | Testing → Closed testing → Create release → upload (later Production) |
| `icon-512.png` | Main store listing → App icon |
| `feature-graphic.png` | Main store listing → Feature graphic (1024 × 500) |
| `screenshots/*.png` | Main store listing → Phone screenshots (upload in number order) |

App ID (package name): **com.brianjonahdennis.treehouse** — permanent once uploaded.
Signing: the upload key is `../signing/tell-hydra-release.jks`. Let Google manage the app signing key ("Play App Signing"), and keep the upload key backed up.

---

## Create app

- **App name:** treehouse
- **Default language:** English (United Kingdom) — or English (United States)
- **App or game:** App
- **Free or paid:** Free
- Declarations: tick both (Developer Program Policies, US export laws)

## Main store listing

**App name** (30 max)
```
treehouse: Anonymous Dating
```

**Short description** (80 max)
```
Anonymous dating, friends and chatrooms for your state, university and more.
```

**Full description** (4,000 max)
```
treehouse: anonymous users, real connections. Meet new people across Nigeria without showing who you are.

🔥 ANONYMOUS DATING (18+)
• Create a dating card with an app-given nickname, your age, state, what you're looking for, a bio and your interests
• Your name stays hidden. Matches see your nickname until you BOTH choose to reveal
• Swipe through people in your state, or anywhere in Nigeria
• Like someone: if they like you back, it's a match and a chat opens
• Or send a message: it arrives as a request and moves to their Inbox when they reply

💬 CHATROOMS
• Your state's chatroom and its universities' rooms (only people in your state can join)
• Rooms for everyone: Nigeria, Lover's Lounge, Football Banter, Christian Room, Muslim Room
• Ladies' Room for women and Men's Room for men
• Chat, react and meet people under your nickname

👋 FRIENDS
• treehouse is for making friends too: add people from chatrooms as friends
• Friends get their own list and can reveal first names when you both agree

📍 NEARBY (OPTIONAL)
• Turn on Nearby to see people around you, as a list or on a map
• Only an approximate area and a rounded distance are ever shown, never your exact location
• Off by default: switch it off any time and your location is deleted

🛡️ SAFETY & PRIVACY
• Block, unmatch or report anyone from any chat
• Report messages in chats and chatrooms
• Hide your dating card from Discover any time
• Delete your account and everything in it from Profile

treehouse is for adults 18 and over.

Privacy policy: https://treehouse.ng/privacy
```

- **App category:** Social (alternative: Dating)
- **Tags:** Social networking, Dating, Messaging
- **Contact email:** support@treehouse.ng
- **Website:** https://treehouse.ng/home
- **Privacy policy URL:** https://treehouse.ng/privacy

## App content (Policy → App content)

**Privacy policy:** https://treehouse.ng/privacy

**App access:** "All or some functionality is restricted" → add instructions + a demo login:
- Create a test account in the app yourself (any email you control), create a dating card (age 18+), and give Google that email + password here.
- Instructions: "Sign in with the details below. Discover is anonymous dating (18+), Chatrooms are per-state group chats, and Inbox holds chats and message requests."

**Ads:** No. The treehouse app itself shows no ads (ads only appear on the owner's separate personal message page, which the app doesn't show).

**Content rating (IARC questionnaire)**
- Category: Social networking / communication (not a game)
- Violence, sexuality, gambling, drugs, language in the app's own content: No
- Users can interact or communicate with each other: **Yes**
- Users can share user-generated content (text): **Yes**
- Shares the user's location with other users: **Yes, approximate** (state, and with Nearby switched on an approximate area and rounded distance; never the exact location)
- Allows purchases of digital goods: No
- The app is for meeting/dating: answer **Yes** where asked
- Expect a mature/18+ rating because of dating.

**Target audience and content:** select **18 and over only**. treehouse requires users to confirm they're 18+ at sign-up, and the privacy policy says it's for adults only.

**News app:** No · **COVID-19 contact tracing:** No · **Government app:** No · **Financial features:** No · **Health:** No

**Data safety** (answer exactly like this)
- Does your app collect or share any of the required user data types? **Yes**
- Is all user data encrypted in transit? **Yes**
- Do you provide a way for users to request that their data is deleted? **Yes** — deletion URL: https://treehouse.ng/delete-account

Data types collected (none are *shared* with third parties for their own purposes; processors like Supabase/Railway/Resend don't count as sharing):

| Data type | Collected | Purpose | Optional? |
|---|---|---|---|
| Personal info → Email address | Yes | Account management | Required |
| Personal info → Name | Yes (first name, hidden until both reveal) | App functionality | Optional (dating only) |
| Personal info → User IDs | Yes (username, anonymous nickname) | App functionality, Account management | Required |
| Personal info → Other info | Yes (age, gender, bio, interests) | App functionality | Optional (dating only) |
| Location → Approximate location | Yes (state, chosen by the user; Nearby area when switched on) | App functionality | Optional |
| Location → Precise location | Yes, only when the user turns on Nearby (the phone's position is sent once, turned into a protected ~1 km area on the server, and never shown to anyone) | App functionality | Optional |
| Messages → Other in-app messages | Yes (chats, chatroom messages) | App functionality | Required for messaging |
| App activity → Other user-generated content | Yes (reactions, reports) | App functionality, Fraud prevention/security | Optional |
| App activity → Other actions | Yes (likes/passes, blocks) | App functionality | Optional |
| Device or other IDs | **No** | | |
| Photos/videos | **No** (images are saved to the phone, never uploaded) | | |

- Is data processed ephemerally? No.
- Ads: the app shows no ads, so no advertising data is collected.

**Account deletion:** in-app (Profile → Delete my account) + web: https://treehouse.ng/delete-account

## Testing (required for new personal developer accounts)

1. Testing → **Closed testing** → create a track, upload `treehouse-1.4.aab`.
2. Add **at least 12 testers** (Google accounts / an email list) who opt in via the link Play gives you.
3. Keep at least 12 testers opted in for **14 days in a row**.
4. Then apply for **Production access** in the Dashboard and publish.

## Updating later

Raise `versionCode` (and `versionName`) in `android/app/build.gradle`, then:
```
export JAVA_HOME=$(ls -d ~/.local/jdk/jdk-21*/Contents/Home) ANDROID_HOME=~/.local/android-sdk
npx cap sync android && cd android && ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```
Website changes appear in the app without an update, because the app opens the live site.
