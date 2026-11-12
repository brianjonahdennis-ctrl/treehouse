# Moving treehouse to treehouse.ng

Bought at Whogohost on 7 Nov 2026 (renews 7 Nov 2027). DNS is on Cloudflare (free plan).
The old address, **tell.brianjonahdennis.com**, keeps working throughout and afterwards.

## Already set up

- **Cloudflare (treehouse.ng):**
  - `CNAME @ → b4p7x67k.up.railway.app` (DNS only, grey cloud)
  - `TXT _railway-verify → railway-verify=65e7…c6e1`
  - `CNAME www → treehouse.ng` (proxied)
- **Railway:** custom domain `treehouse.ng` added to the `tell-hydra` service. The plan allows two custom domains, so `www` is handled by a Cloudflare redirect instead (step 3).
- **Server (`server.js`):** an optional redirect from the old address, switched on by the `CANONICAL_HOST` variable. Until it's set, nothing changes. Once it's set:
  - Page visits to tell.brianjonahdennis.com or www.treehouse.ng are forwarded to https://treehouse.ng, keeping the path.
  - `/api/*`, `/go/*`, `/sw.js` and `/home-sw.js` stay on the old address, so older app builds, existing notification devices and the database's notification ping keep working.
  - The redirect is temporary (302) by default. Set `DOMAIN_REDIRECT=301` once everything is confirmed.
- **Apps (`tell-hydra-app`):**
  - Capacitor `server.url` and the offline page now point to https://treehouse.ng/home.
  - Version bumped to 1.4 (Android versionCode 5, iOS build 5).
  - **Don't rebuild them until treehouse.ng loads.**
- **Play kit:** `play/PLAY-STORE.md` URLs now use treehouse.ng, and the bundle is now `treehouse-1.4.aab`.
- **Supabase (`supabase/config.toml`):** treehouse.ng is added to the allowed sign-in return links (it adds to the old links). Not pushed yet.

## Blocked

- **Nameservers:** Whogohost refused to set them ("Registrar Error") because the .ng registry hadn't activated the domain yet (RDAP: no record).
- **Check it's active:** `curl -s https://rdap.nic.net.ng/domain/treehouse.ng` should return details, not a 404.
- **Then set the nameservers** in Whogohost (Domains → treehouse.ng → Manage → Manage Nameservers → custom):
  - `ben.ns.cloudflare.com`
  - `bingo.ns.cloudflare.com`

## Switch-over, in order

1. **Wait for Cloudflare to say "Active"** for treehouse.ng. `dig NS treehouse.ng` should show the Cloudflare names.
2. **Wait for Railway's certificate:** `railway domain status treehouse.ng` should be active. `https://treehouse.ng/home` should load with a padlock.
3. **Forward www:** Cloudflare → Rules → Redirect Rules: `www.treehouse.ng/*` → `https://treehouse.ng/${1}`, 301.
4. **Supabase:** change `site_url` to `https://treehouse.ng/home` and push the config. The email templates link to `{{ .SiteURL }}`, so verify and reset emails then point at treehouse.ng automatically.
4b. **Send email from treehouse.ng** (helps with spam):
    - In Resend, add the domain `treehouse.ng` and copy its DNS records (DKIM `resend._domainkey`, and the `send` MX and SPF TXT) into Cloudflare.
    - Add DMARC in Cloudflare: `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:brianjonahdennis@gmail.com`. Move to `p=quarantine` after a few clean weeks.
    - In `supabase/config.toml` set `admin_email = "hello@treehouse.ng"` (sender name stays "treehouse"), then push the config.
    - Add treehouse.ng to Google Postmaster Tools to watch Gmail's spam rating.
5. **Website text:**
   - `public/link.html` ("Your own link: treehouse.ng/u/yourname")
   - `public/delete-account.html`
   - the README
6. **Railway variables:** set `CANONICAL_HOST=treehouse.ng`, then deploy.
7. **Check:**
   - sign-up and password-reset emails link to treehouse.ng
   - links like treehouse.ng/u/name work
   - old links forward
   - notifications still arrive
8. **Rebuild the apps:**
   - Android: `npx cap sync android && ./gradlew bundleRelease assembleRelease` → `treehouse-1.4.aab/.apk`
   - iOS: build 1.4 (5)
9. **Google:** add treehouse.ng in Search Console (DNS TXT in Cloudflare) and AdSense (`ads.txt` is served automatically).
10. **Later:** set `DOMAIN_REDIRECT=301`.
11. **Optional:**
    - change the notification wake-up URL in the database to treehouse.ng (the old one keeps working)

## What users notice

- **Links:** old links and shared profiles keep working; they forward to treehouse.ng.
- **Home-screen shortcuts:** shortcuts added on the old address still open, then forward. People can add treehouse again from treehouse.ng for a clean shortcut. The app's "Add to Home Screen" card offers this automatically.
- **Notifications:** devices that turned them on keep getting them through the old address's background worker. Turning them on again from treehouse.ng moves them across.
- **Sign-in:** saved sign-ins belong to each address, so people sign in once on treehouse.ng.
