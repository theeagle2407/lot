#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for path in \
  contracts/managed/lot-v2/contract/index.js \
  contracts/managed/lot-v2/keys \
  contracts/managed/lot-v2/zkir \
  contracts/witnesses-v2.ts \
  scripts/lot-v2-signing.mjs \
  scripts/lot-indexer-wait.mjs \
  test/lot-official/wallet.ts \
  test/lot-official/providers.ts \
  test/lot.v2.network.test.ts
  do
  if [[ ! -e "$path" ]]; then
    printf 'Missing prerequisite: %s\n' "$path" >&2
    printf 'Do not run test:network:v2 before all V2 assets are compiled.\n' >&2
    exit 1
  fi
done
if [[ ! -d node_modules/vitest ]]; then
  echo 'Missing project dependencies. Install your existing project dependencies first.' >&2
  exit 1
fi
# Detect and reject the broken CompactTypeField constructor from Build 14A.
if grep -Fq 'new CompactTypeField()' scripts/lot-v2-signing.mjs; then
  echo 'Outdated V2 signing helper: apply the CompactTypeField correction first.' >&2
  exit 1
fi
node --check scripts/lot-v2-signing.mjs
node --test test/lot-v2.crypto.test.mjs
npm pkg set 'scripts.test:network:v2=MIDNIGHT_NETWORK=local vitest run test/lot.v2.network.test.ts'
printf '\nLOT V2 network harness ready. Next: npm run test:network:v2\n'
