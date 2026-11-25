#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077
cd "$(dirname "$0")/.."
if [[ $# -lt 2 || $# -gt 3 || ! "$1" =~ ^[a-z][a-z0-9_-]{2,31}$ || ! "$2" =~ ^LOT-[A-Z0-9-]{1,48}$ ]]; then
  echo 'Usage: bash scripts/lot-onboard-preprod.sh USER LOT-ID [check]'; exit 2
fi
mode="${3:-issue}"
[[ "$mode" == check || "$mode" == issue ]] || { echo 'Invalid mode'; exit 2; }
runner="$HOME/Downloads/lot-preprod-dust-helper/node_modules/.bin/tsx"
address='mn_addr_preprod1mu8kr96p9s8xvt7lx2cutk0ucelwmfrfvd0hs7ndlwlsuzj4y5wqxgm0vg'
[[ -x "$runner" ]] || { echo 'Working helper runtime missing. No transaction made.'; exit 2; }
for f in contracts/managed/lot-v2/contract/index.js contracts/witnesses-v2.js scripts/lot-onboarding.mjs scripts/lot-operator-access.mjs scripts/lot-v2-signing.mjs scripts/lot-indexer-wait.mjs; do
 [[ -f "$f" ]] || { echo "Missing local project file: $f. No transaction made."; exit 2; }
done
trap 'unset LOT_ACCOUNT_PASSWORD WALLET_MNEMONIC BLOCKFROST_PROJECT_ID' EXIT
read -r -s -p 'Manufacturer account login password (hidden): ' LOT_ACCOUNT_PASSWORD; echo
if [[ "$mode" == check ]]; then
 LOT_ACCOUNT_PASSWORD="$LOT_ACCOUNT_PASSWORD" "$runner" scripts/lot-onboard-preprod.ts "$address" "$1" "$2" CHECK
 exit
fi
[[ -s "$HOME/.lot/preprod/wallet-sync-ledger9/$address.json" ]] || { echo 'Wallet checkpoint missing. No transaction made.'; exit 2; }
curl --fail --silent --max-time 10 http://127.0.0.1:6300/health >/dev/null || { echo 'Local proof server unavailable. No transaction made.'; exit 2; }
# Verify the original stored report before requesting wallet credentials.
LOT_ACCOUNT_PASSWORD="$LOT_ACCOUNT_PASSWORD" "$runner" scripts/lot-onboard-preprod.ts "$address" "$1" "$2" CHECK
printf 'Preprod: %s / %s; B-02, 550 MPa, 100 bps. Up to four transactions (new contract, inspection, policy, clearance), paid with test DUST. Previously confirmed stages will be skipped. Existing LOT-3002 contract is untouched.\n' "$1" "$2"
read -r -p 'Type ISSUE to authorize these transactions: ' approval
[[ "$approval" == ISSUE ]] || { echo 'Canceled. No transaction made.'; exit 0; }
read -r -s -p 'Registered TEST wallet recovery phrase (hidden): ' WALLET_MNEMONIC; echo
read -r -s -p 'Midnight Preprod Blockfrost token (hidden): ' BLOCKFROST_PROJECT_ID; echo
LOT_ACCOUNT_PASSWORD="$LOT_ACCOUNT_PASSWORD" WALLET_MNEMONIC="$WALLET_MNEMONIC" BLOCKFROST_PROJECT_ID="$BLOCKFROST_PROJECT_ID" \
 "$runner" scripts/lot-onboard-preprod.ts "$address" "$1" "$2" ISSUE 2>&1 | sed -E 's/(project_id=)[A-Za-z0-9_-]+/\1[REDACTED]/g'
