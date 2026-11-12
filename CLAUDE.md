# Building a community website — project memory

This folder holds several of Hydra's (Brian Jonah Dennis) apps. Most work here is on **treehouse**.

| Folder | What it is |
|---|---|
| `anon-inbox/` | **treehouse** — the live website and backend (see `anon-inbox/CLAUDE.md`) |
| `web-next/` | **Branch `nextjs` only:** the member app rebuilt in Next.js/React (not live yet; see `web-next/MIGRATION.md`) |
| `tell-hydra-app/` | treehouse's Android/iOS app: a Capacitor shell that opens https://treehouse.ng/home |
| `brand/` | treehouse logo and mark (SVG + PNG previews) |
| `hydra/` | Earlier Next.js site (launch config `hydra`, port 3000) |
| `hydra-earn/` | Hydra task-rewards app (pnpm/turbo monorepo; launch config `hydra-earn-api`, port 4100) |
| `harmony-profile/`, `main-site/` | Small static pages / leftovers |

Dev servers are defined in `.claude/launch.json`: `anon-inbox` (4000, real Supabase), `treehouse-preview`
(4010, mock data, no database), `hydra`, `hydra-earn-api`, and on the `nextjs` branch `treehouse-next`
(4020, the Next.js app with mock data).

## GitHub
- **treehouse** repo (private) = this whole folder: `anon-inbox`, `tell-hydra-app`, `avatars-site`, `brand`.
  Commit from this folder: `git add -A && git commit -m "…" && git push`. Each subfolder's .gitignore keeps
  secrets out (anon-inbox/data, tell-hydra-app/signing, .env, app builds); the root .gitignore skips the others.
- `hydra`, `hydra-earn`, `harmony-profile`, `main-site` are separate private repos (commit inside each folder).
- GitHub account: brianjonahdennis-ctrl; `gh` is at ~/.local/bin/gh and git logs in through it.

## How Hydra wants to work
- Explain things in plain words, not jargon. He is the owner, not a full-time developer.
- The audience is Nigeria: 36 states + FCT, Africa/Lagos time zone, NGN.
- Never print, commit or paste secrets: `anon-inbox/data/*` (passwords, admin token, VAPID keys),
  `tell-hydra-app/signing/*` (release key + passwords).
