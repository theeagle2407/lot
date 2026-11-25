#!/usr/bin/env bash
# LOT disposable test-wallet inspection. No registration or transactions.
set -euo pipefail
set +x
if [[ $# -ne 1 ]]; then
  echo 'Usage: bash lot-ledger9-bootstrap.sh mn_addr_preprod1...'
  exit 2
fi
if [[ ! -x ./node_modules/.bin/tsx || ! -f src/lot-preprod-ledger9-bootstrap.ts ]]; then
  echo 'Run from ~/Downloads/lot-preprod-dust-helper after npm install and add-on extraction.'
  exit 2
fi
trap 'unset WALLET_MNEMONIC BLOCKFROST_PROJECT_ID' EXIT
read -r -s -p 'Dedicated 24-word TEST wallet recovery phrase (hidden): ' WALLET_MNEMONIC
echo
read -r -s -p 'Midnight Preprod Blockfrost project token (hidden): ' BLOCKFROST_PROJECT_ID
echo
# Mask query-bearing project_id values in both stdout and stderr, including
# transient WebSocket diagnostics from upstream dependencies.
WALLET_MNEMONIC="$WALLET_MNEMONIC" BLOCKFROST_PROJECT_ID="$BLOCKFROST_PROJECT_ID" \
  ./node_modules/.bin/tsx src/lot-preprod-ledger9-bootstrap.ts "$1" 2>&1 \
  | sed -E 's/(project_id=)[A-Za-z0-9_-]+/\1[REDACTED]/g'
