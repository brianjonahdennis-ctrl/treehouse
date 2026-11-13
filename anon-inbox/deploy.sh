#!/bin/sh
# Deploy the treehouse website/server to Railway (service tell-hydra).
#
# Since the whole "Building a community website" folder became one git repository, a plain
# `railway up` from here gets stuck. This copies only what the server needs into a clean temporary
# folder (no secrets in data/, no avatars or videos: those live on Cloudflare) and deploys that.
#
#   ./deploy.sh
set -e
cd "$(dirname "$0")"
node --check server.js
TMP="$(mktemp -d)/treehouse-web"
mkdir -p "$TMP"
rsync -a --exclude '.git' --exclude 'data/' --exclude 'public/avatars/' --exclude 'public/*.mp4' \
  --exclude 'supabase/' --exclude 'node_modules/' --exclude '.DS_Store' ./ "$TMP/"
echo "Deploying $(du -sh "$TMP" | cut -f1) from a clean copy…"
RAILWAY="${RAILWAY:-$HOME/.local/railway/node_modules/.bin/railway}"
"$RAILWAY" up "$TMP" --path-as-root --service tell-hydra --detach
rm -rf "$(dirname "$TMP")"
echo "Uploaded. It's live in about a minute: check https://app.treehouse.ng"
