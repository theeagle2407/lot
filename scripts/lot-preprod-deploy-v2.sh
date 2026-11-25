#!/usr/bin/env bash
# Build 31. Only the dedicated, registered Preprod wallet is accepted.
set -euo pipefail
set +x
umask 077
cd "$(dirname "$0")/.."
runner="$HOME/Downloads/lot-preprod-dust-helper/node_modules/.bin/tsx"
address='mn_addr_preprod1mu8kr96p9s8xvt7lx2cutk0ucelwmfrfvd0hs7ndlwlsuzj4y5wqxgm0vg'
checkpoint="$HOME/.lot/preprod/wallet-sync-ledger9/$address.json"
if [[ ! -x "$runner" || ! -s "$checkpoint" ]]; then
  echo 'Working helper runtime or registered-wallet checkpoint missing. No transaction made.'; exit 2
fi
for f in contracts/managed/lot-v2/contract/index.js contracts/witnesses-v2.js scripts/lot-private-vault.mjs scripts/lot-inspector-attestation.mjs scripts/lot-v2-delegation.mjs scripts/lot-v2-session-store.mjs scripts/lot-v2-signing.mjs; do
  [[ -f "$f" ]] || { echo "Missing local project file: $f. No transaction made."; exit 2; }
done
if [[ $# -ne 1 || ! "$1" =~ ^LOT-[A-Z0-9-]{1,48}$ ]]; then
  echo 'Usage: bash scripts/lot-preprod-deploy-v2.sh LOT-<batch>'; exit 2
fi
state="$HOME/.lot/preprod/deployments-v2/$1"
if [[ -e "$state" ]]; then
  echo 'A deployment record already exists for this batch. Do not retry; reconcile it first.'; exit 2
fi
curl --fail --silent --max-time 10 http://127.0.0.1:6300/health >/dev/null || { echo 'Local proof server health check failed. No transaction made.'; exit 2; }
trap 'unset WALLET_MNEMONIC BLOCKFROST_PROJECT_ID LOT_VAULT_PASSWORD LOT_INSPECTOR_PASSWORD' EXIT
read -r -s -p 'Registered TEST wallet recovery phrase (hidden): ' WALLET_MNEMONIC; echo
read -r -s -p 'Midnight Preprod Blockfrost token (hidden): ' BLOCKFROST_PROJECT_ID; echo
read -r -s -p 'Existing report vault passphrase (hidden): ' LOT_VAULT_PASSWORD; echo
read -r -s -p 'Existing inspector key passphrase (hidden): ' LOT_INSPECTOR_PASSWORD; echo
printf 'Network: PREPROD. Batch: %s. One contract deployment will spend test DUST; no inspection or policy yet.\n' "$1"
read -r -p 'Type DEPLOY to authorize one Preprod contract deployment: ' approval
[[ "$approval" == DEPLOY ]] || { echo 'Canceled. No transaction made.'; exit 0; }
WALLET_MNEMONIC="$WALLET_MNEMONIC" BLOCKFROST_PROJECT_ID="$BLOCKFROST_PROJECT_ID" LOT_VAULT_PASSWORD="$LOT_VAULT_PASSWORD" LOT_INSPECTOR_PASSWORD="$LOT_INSPECTOR_PASSWORD" \
  "$runner" scripts/lot-preprod-deploy-v2.ts "$address" "$1" DEPLOY 2>&1 \
  | sed -E 's/(project_id=)[A-Za-z0-9_-]+/\1[REDACTED]/g'
