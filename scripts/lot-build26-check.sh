#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check src/buyerLink.js
node --test test/lot-buyer-local-link.test.js
printf '\nLOT Build 26 local-link tests passed. No blockchain state was modified.\n'
