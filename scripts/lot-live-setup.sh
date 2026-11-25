#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f node_modules/vitest/vitest.mjs ]]; then
  echo 'Vitest is missing; run bash scripts/lot-network-setup.sh first.'
  exit 1
fi
if [[ ! -f test/lot-official/wallet.ts ]]; then
  echo 'Ledger 9 helpers are missing; run bash scripts/lot-network-setup.sh first.'
  exit 1
fi
npm pkg set 'scripts.proof:serve=node scripts/lot-proof-api.mjs'
printf '\nAdded proof:serve. Your existing network and test scripts remain unchanged.\n'
echo 'Use: npm run proof:serve'
