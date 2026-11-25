#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f test/lot-official/wallet.ts || ! -f test/lot-official/providers.ts ]]; then
  echo 'Missing Ledger 9 helpers: run bash scripts/lot-network-setup.sh first.'
  exit 1
fi
if [[ ! -f contracts/managed/lot/contract/index.js ]]; then
  echo 'Missing compiled contract: run npm run compact:compile first.'
  exit 1
fi
if [[ ! -d node_modules/vitest ]]; then
  echo 'Missing Vitest from Build 02: run bash scripts/lot-network-setup.sh first.'
  exit 1
fi
node --check scripts/lot-vault-bridge.mjs
node --check scripts/lot-vault-prove.mjs
node --test test/lot-vault-bridge.test.js
npm pkg set 'scripts.vault:prove=node scripts/lot-vault-prove.mjs'
echo 'LOT Build 10 ready. Run: npm run vault:prove -- LOT-3001 B-01 530 100'
