#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Preserve all earlier npm scripts; only change the Vite network binding.
npm pkg set 'scripts.dev=vite --host 127.0.0.1' 'scripts.preview=vite preview --host 127.0.0.1'
node --check scripts/lot-proof-api.mjs
node --check scripts/lot-local-http-guard.mjs
node --test test/lot-local-http-guard.test.js test/lot-v2-browser-auth.test.js
printf '\nLOT Build 22 installed: UI and proof API now require local loopback / same-origin requests.\n'
printf 'Restart BOTH npm run dev and npm run proof:serve to apply the new binding.\n'
