#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for item in \
 contracts/managed/lot-v2/contract/index.js \
 contracts/managed/lot-v2/keys \
 contracts/managed/lot-v2/zkir \
 contracts/witnesses-v2.ts \
 scripts/lot-v2-vault-prove.mjs \
 scripts/lot-v2-signing.mjs \
 scripts/lot-v2-delegation.mjs \
 scripts/lot-private-vault.mjs \
 scripts/lot-proof-archive.mjs \
 test/lot-official/wallet.ts; do
 if [[ ! -e "$item" ]]; then echo "Missing Build 16 prerequisite: $item" >&2;exit 1;fi
done
node --check scripts/lot-v2-session-store.mjs
node --check scripts/lot-v2-session-bridge.mjs
node --check scripts/lot-v2-session.mjs
node --test test/lot-v2-session-store.test.mjs
npm pkg set 'scripts.vault:session:v2=node scripts/lot-v2-session.mjs'
printf '\nLOT V2 persistent local session installed.\nRun: npm run vault:session:v2 -- init LOT-3001\n'
