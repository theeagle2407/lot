#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check src/portableBuyer.js
node --test test/lot-portable-buyer.test.js
printf '\nLOT Build 29 portable buyer export checks passed. No blockchain mutations.\n'
