#!/usr/bin/env bash
set -euo pipefail
set +x
cd "$(dirname "$0")/.."
[[ $# == 1 && "$1" =~ ^[a-f0-9]{64}$ ]] || { echo 'Usage: bash scripts/lot-recover-public-receipt.sh BATCH_KEY'; exit 2; }
read -rsp 'Midnight Preprod Blockfrost token (hidden): ' TOKEN; echo
trap 'unset TOKEN' EXIT
BLOCKFROST_PROJECT_ID="$TOKEN" node scripts/lot-recover-public-receipt.mjs "$1"
