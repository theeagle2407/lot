#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check scripts/lot-v2-ui-runner.mjs
node --check scripts/lot-v2-session.mjs
node --test test/lot-v2-ui-handoff.test.js
printf '\nLOT Build 20A handoff corrected. Restart npm run proof:serve, then retry B-03 in Inspections -> Midnight V2.\n'
