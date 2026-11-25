#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check scripts/lot-buyer-scoped.mjs
node --check scripts/lot-proof-api.mjs
node --check src/evidence.js
node --check src/v2Audit.js
node --test test/lot-buyer-scoped.test.js
printf '\nLOT Build 28 scoped-buyer checks passed. No blockchain mutations.\n'
