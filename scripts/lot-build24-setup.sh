#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check scripts/lot-v2-report-create.mjs
node --check scripts/lot-proof-api.mjs
node --check src/signedReport.js
node --test test/lot-v2-report-create.test.js test/lot-v2-report-ui.test.js
printf '\nLOT Build 24 installed. Restart proof:serve and dev, then sign in as inspector.\n'
