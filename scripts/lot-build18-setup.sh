#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for file in scripts/lot-proof-archive.mjs scripts/lot-v2-session-store.mjs contracts/managed/lot-v2/contract/index.js; do
  if [[ ! -f "$file" ]]; then echo "Missing Build 17 prerequisite: $file" >&2;exit 1;fi
done
node --check scripts/lot-evidence-summary.mjs
node --check scripts/lot-evidence-status.mjs
node --check scripts/lot-v2-public-audit-core.mjs
node --check scripts/lot-v2-public-audit.mjs
node --check scripts/lot-v2-session-audit.mjs
node --test test/lot-evidence-summary.test.js test/lot-v2-public-audit.test.js
npm pkg set 'scripts.audit:session:v2=node scripts/lot-v2-session-audit.mjs'
echo 'LOT Build 18 installed. Run: npm run audit:session:v2 -- LOT-3001'
