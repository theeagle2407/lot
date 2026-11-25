#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077
cd "$(dirname "$0")/.."
runner="$HOME/Downloads/lot-preprod-dust-helper/node_modules/.bin/tsx"
address='mn_addr_preprod1mu8kr96p9s8xvt7lx2cutk0ucelwmfrfvd0hs7ndlwlsuzj4y5wqxgm0vg'
checkpoint="$HOME/.lot/preprod/wallet-sync-ledger9/$address.json"
if [[ $# -lt 2 || ! "$2" =~ ^LOT-[A-Z0-9-]{1,48}$ ]]; then
 echo 'Usage: bash scripts/lot-preprod-register-v2.sh inspection LOT-3002 | policy LOT-3002 B-02 550 100'; exit 2
fi
mode="$1"; batch="$2"
case "$mode" in
 inspection) [[ $# -eq 2 ]] || exit 2 ;;
 policy) [[ $# -eq 5 && "$3" =~ ^[A-Z0-9][A-Z0-9-]{0,47}$ && "$4" =~ ^[0-9]{1,20}$ && "$5" =~ ^[0-9]{1,5}$ ]] || { echo 'Invalid policy parameters'; exit 2; } ;;
 *) echo 'Invalid action'; exit 2 ;;
esac
if [[ ! -x "$runner" || ! -s "$checkpoint" ]]; then echo 'Wallet runtime or checkpoint missing. No transaction made.'; exit 2; fi
for f in contracts/managed/lot-v2/contract/index.js contracts/witnesses-v2.js scripts/lot-private-vault.mjs scripts/lot-inspector-attestation.mjs scripts/lot-v2-session-store.mjs scripts/lot-v2-signing.mjs scripts/lot-indexer-wait.mjs scripts/lot-preprod-register-v2.ts; do
 [[ -f "$f" ]] || { echo "Missing local project file: $f. No transaction made."; exit 2; }
done
state="$HOME/.lot/preprod/deployments-v2/$batch"
for f in status.json enrollment.enc.json; do [[ -s "$state/$f" ]] || { echo 'Existing deployment or encrypted enrollment missing. No transaction made.'; exit 2; }; done
curl --fail --silent --max-time 10 http://127.0.0.1:6300/health >/dev/null || { echo 'Proof server health check failed. No transaction made.'; exit 2; }
trap 'unset WALLET_MNEMONIC BLOCKFROST_PROJECT_ID LOT_VAULT_PASSWORD' EXIT
read -r -s -p 'Registered TEST wallet recovery phrase (hidden): ' WALLET_MNEMONIC; echo
read -r -s -p 'Midnight Preprod Blockfrost token (hidden): ' BLOCKFROST_PROJECT_ID; echo
read -r -s -p 'Existing report vault passphrase (hidden): ' LOT_VAULT_PASSWORD; echo
printf 'Network: PREPROD. Batch: %s. Action: %s. One contract call will spend test DUST; no redeployment.\n' "$batch" "$mode"
if [[ "$mode" == policy ]]; then printf 'Public policy: %s; minimum strength: %s MPa; maximum defects: %s bps.\n' "$3" "$4" "$5"; fi
read -r -p 'Type REGISTER to authorize one Preprod contract call: ' approval
[[ "$approval" == REGISTER ]] || { echo 'Canceled. No transaction made.'; exit 0; }
shift 2
WALLET_MNEMONIC="$WALLET_MNEMONIC" BLOCKFROST_PROJECT_ID="$BLOCKFROST_PROJECT_ID" LOT_VAULT_PASSWORD="$LOT_VAULT_PASSWORD" \
 "$runner" scripts/lot-preprod-register-v2.ts "$address" "$batch" "$mode" REGISTER "$@" 2>&1 | sed -E 's/(project_id=)[A-Za-z0-9_-]+/\1[REDACTED]/g'
