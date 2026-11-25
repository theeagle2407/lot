#!/usr/bin/env bash
set -euo pipefail
set +x
cd "$(dirname "$0")/.."
[[ -f contracts/managed/lot-v2/contract/index.js ]] || { echo 'Compiled V2 contract missing.'; exit 2; }
./node_modules/.bin/vite build --config vite.preprod.config.mjs
read -r -s -p 'Midnight Preprod Blockfrost token (hidden): ' BLOCKFROST_PROJECT_ID; echo
trap 'unset BLOCKFROST_PROJECT_ID' EXIT
LOT_PUBLIC_RECEIPTS_DIR="$HOME/.lot/preprod/onboarding-v1" BLOCKFROST_PROJECT_ID="$BLOCKFROST_PROJECT_ID" node scripts/lot-preprod-public-server.mjs
