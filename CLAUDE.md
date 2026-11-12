# Building a community website — project memory

This folder holds several of Hydra's (Brian Jonah Dennis) apps. Most work here is on **treehouse**.

| Folder | What it is |
|---|---|
| `anon-inbox/` | **treehouse** — the live website and backend (see `anon-inbox/CLAUDE.md`) |
| `tell-hydra-app/` | treehouse's Android/iOS app: a Capacitor shell that opens https://treehouse.ng/home |
| `brand/` | treehouse logo and mark (SVG + PNG previews) |
| `hydra/` | Earlier Next.js site (launch config `hydra`, port 3000) |
| `hydra-earn/` | Hydra task-rewards app (pnpm/turbo monorepo; launch config `hydra-earn-api`, port 4100) |
| `harmony-profile/`, `main-site/` | Small static pages / leftovers |

Dev servers are defined in `.claude/launch.json`: `anon-inbox` (4000, real Supabase), `treehouse-preview`
(4010, mock data, no database), `hydra`, `hydra-earn-api`.

## How Hydra wants to work
- Explain things in plain words, not jargon. He is the owner, not a full-time developer.
- The audience is Nigeria: 36 states + FCT, Africa/Lagos time zone, NGN.
- Never print, commit or paste secrets: `anon-inbox/data/*` (passwords, admin token, VAPID keys),
  `tell-hydra-app/signing/*` (release key + passwords).
