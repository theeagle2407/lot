#!/usr/bin/env bash
set -euo pipefail
set +x
cd "$(dirname "$0")/.."
[[ $# == 1 && "$1" =~ ^[a-z][a-z0-9_-]{2,31}(,[a-z][a-z0-9_-]{2,31})*$ ]] || { echo 'Usage: bash scripts/lot-browser-operator.sh MANUFACTURER[,REVIEWER]'; exit 2; }
if lsof -nP -iTCP:4175 -sTCP:LISTEN >/dev/null 2>&1; then echo 'Port 4175 already occupied; stop the existing LOT proof API first.'; exit 2; fi
runner="${LOT_ISSUER_RUNNER:-$HOME/Downloads/lot-preprod-dust-helper/node_modules/.bin/tsx}"
[[ -x "$runner" ]] || { echo 'Helper runtime missing'; exit 2; }
curl -fsS --max-time 10 http://127.0.0.1:6300/health >/dev/null || { echo 'Proof server unavailable'; exit 2; }
echo "Local Preprod issuance enabled only for $1, with a persistent issuance budget (default three total new attempts). Each requires browser password confirmation. Never expose this service publicly."
read -r -s -p 'Registered TEST wallet recovery phrase (hidden): ' LOT_ISSUER_MNEMONIC; echo
read -r -s -p 'Midnight Preprod Blockfrost token (hidden): ' LOT_ISSUER_TOKEN; echo
trap 'unset LOT_ISSUER_MNEMONIC LOT_ISSUER_TOKEN' EXIT
LOT_ISSUER_RUNNER="$runner" LOT_ISSUER_ACCOUNT="$1" LOT_ISSUER_MNEMONIC="$LOT_ISSUER_MNEMONIC" LOT_ISSUER_TOKEN="$LOT_ISSUER_TOKEN" node scripts/lot-proof-api.mjs
