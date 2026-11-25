#!/usr/bin/env bash
set -euo pipefail
set +x
cd "$(dirname "$0")/.."
runner="$HOME/Downloads/lot-preprod-dust-helper/node_modules/.bin/tsx"
[[ -x "$runner" ]] || { echo 'Existing TypeScript runner missing.'; exit 2; }
trap 'unset BLOCKFROST_PROJECT_ID' EXIT
read -r -s -p 'Midnight Preprod Blockfrost token (hidden): ' BLOCKFROST_PROJECT_ID; echo
BLOCKFROST_PROJECT_ID="$BLOCKFROST_PROJECT_ID" "$runner" scripts/lot-preprod-reconcile-policy.ts 2>&1 | sed -E 's/(project_id=)[A-Za-z0-9_-]+/\1[REDACTED]/g'
