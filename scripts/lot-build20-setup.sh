#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check scripts/lot-proof-api.mjs
node --check scripts/lot-v2-ui-core.mjs
node --check scripts/lot-v2-ui-runner.mjs
node --check src/v2Session.js
node --test test/lot-v2-ui-handoff.test.js
printf '\nLOT Build 20 installed. Restart npm run proof:serve, then use Inspections → Midnight V2.\n'
