#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check scripts/lot-v2-session-store.mjs
node --check scripts/lot-proof-api.mjs
node --check src/v2Session.js
node --test test/lot-v2-signed-catalog.test.js
printf '\nLOT Build 25 file checks passed. No blockchain state was changed.\n'
