#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f test/lot-official/wallet.ts || ! -f test/lot-official/providers.ts ]]; then
  echo "Missing official Ledger 9 wallet helpers. Run: bash scripts/lot-network-setup.sh"
  exit 1
fi
if [[ ! -f contracts/managed/lot/contract/index.js ]]; then
  echo "Missing compiled LOT contract. Run: npm run compact:compile"
  exit 1
fi
node --test test/lot-role-state.test.js
npm pkg set 'scripts.test:roles=MIDNIGHT_NETWORK=local vitest run test/lot.roles.test.ts'
echo 'Build 08 roles ready. Next: npm run test:roles'
