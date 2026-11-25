#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check src/buyerStatus.js
node --test test/lot-buyer-verification-state.test.js test/lot-buyer-local-link.test.js
printf '\nLOT Build 27 buyer-verification checks passed. No chain mutation.\n'
