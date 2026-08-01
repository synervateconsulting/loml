#!/usr/bin/env bash
# Pull down (or refresh) a local copy of loml and get it ready to run.
#
#   ./setup.sh [target-dir] [branch]
#
# Defaults: target-dir = ~/loml, branch = main
#
# Safe to re-run: clones if the folder is new, otherwise fetches and fast-
# forwards. It never throws away local work — if the target has uncommitted
# changes it stops and tells you.
set -euo pipefail

REPO="https://github.com/synervateconsulting/loml.git"
TARGET="${1:-$HOME/loml}"
BRANCH="${2:-main}"

say() { printf '\n\033[1;33m›\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v git >/dev/null || die "git is not installed."
command -v node >/dev/null || die "node is not installed (need Node 20+)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20+ required (found $(node -v))."

# --- get the code --------------------------------------------------------
if [ -d "$TARGET/.git" ]; then
  say "Refreshing existing checkout at $TARGET"
  cd "$TARGET"
  if [ -n "$(git status --porcelain)" ]; then
    die "$TARGET has uncommitted changes. Commit or stash them first — I won't overwrite your work."
  fi
  git fetch origin --prune
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
elif [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then
  die "$TARGET already exists and is not a git checkout. Pick an empty folder."
else
  say "Cloning loml into $TARGET (branch: $BRANCH)"
  git clone --branch "$BRANCH" "$REPO" "$TARGET"
  cd "$TARGET"
fi

# --- dependencies --------------------------------------------------------
say "Installing dependencies"
if [ -f package-lock.json ]; then npm ci; else npm install; fi

# --- local .env ----------------------------------------------------------
if [ ! -f .env ]; then
  say "Creating a starter .env (fill in the blanks)"
  cat > .env <<'ENV'
# Local Postgres created by ./dev.sh (Docker). Change if you use your own.
DATABASE_URL=postgresql://loml:loml@localhost:5433/loml

# Any long random string.
SESSION_SECRET=change-me

# The two profiles and their access keys (pick your own keys).
USER_A_NAME=Zak
USER_A_ACCESS_KEY=change-me-a
USER_B_NAME=Freddie
USER_B_ACCESS_KEY=change-me-b

MAX_UPLOAD_MB=60

# Web push (notifications). Auto-filled below if left blank; the app also runs
# fine without them (push just stays off).
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
ENV
  chmod 600 .env
else
  say ".env already present — leaving it untouched"
fi

# --- generate VAPID keys if they're empty --------------------------------
if ! grep -q '^VAPID_PUBLIC_KEY=.\+' .env; then
  say "Generating VAPID keys for local web push"
  KEYS="$(node -e 'const k=require("web-push").generateVAPIDKeys();console.log(k.publicKey+"\n"+k.privateKey)')"
  PUB="$(printf '%s' "$KEYS" | sed -n 1p)"
  PRIV="$(printf '%s' "$KEYS" | sed -n 2p)"
  # portable in-place edit (macOS + Linux)
  perl -pi -e "s#^VAPID_PUBLIC_KEY=.*#VAPID_PUBLIC_KEY=$PUB#" .env
  perl -pi -e "s#^VAPID_PRIVATE_KEY=.*#VAPID_PRIVATE_KEY=$PRIV#" .env
fi

cat <<DONE

✓ loml is ready at $TARGET

Next steps:
  1. Edit .env — set your access keys (USER_A/B_ACCESS_KEY) and SESSION_SECRET.
  2. Start it. Easiest (needs Docker Desktop running):
         ./dev.sh
     …which starts a local Postgres and opens the app at http://localhost:5173

     Or, with your own Postgres already in DATABASE_URL:
         node --env-file=.env server/index.js   # API on :3000
         npm run dev:client                     # UI on :5173

DONE
