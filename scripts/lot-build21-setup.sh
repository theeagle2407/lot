#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check scripts/lot-v2-browser-auth.mjs
node --check scripts/lot-v2-ui-runner.mjs
node --check scripts/lot-v2-session.mjs
node --check scripts/lot-proof-api.mjs
node --check src/v2Session.js
node --test test/lot-v2-ui-handoff.test.js test/lot-v2-browser-auth.test.js
npm run build
printf '\nLOT Build 21 ready. Restart npm run proof:serve; in Inspections > Midnight V2, authorize buyer B-04 directly in LOT.\n'
