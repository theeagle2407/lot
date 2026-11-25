#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for p in \
  contracts/managed/lot-v2/contract/index.js \
  contracts/managed/lot-v2/keys \
  contracts/managed/lot-v2/zkir \
  scripts/lot-inspector-attestation.mjs \
  scripts/lot-v2-signing.mjs \
  scripts/lot-v2-delegation.mjs \
  scripts/lot-v2-vault-bridge.mjs \
  scripts/lot-private-vault.mjs \
  scripts/lot-public-receipt.mjs \
  test/lot-official/wallet.ts; do
  if [[ ! -e "$p" ]]; then echo "Missing prerequisite: $p" >&2; exit 1; fi
done
if grep -q 'new CompactTypeField()' scripts/lot-v2-signing.mjs; then
  echo 'The old V2 signing helper is still installed. Fix CompactTypeField first.' >&2
  exit 1
fi
node --check scripts/lot-v2-delegation.mjs
node --check scripts/lot-v2-vault-bridge.mjs
node --check scripts/lot-v2-vault-prove.mjs
node --test test/lot-v2-vault-isolation.test.mjs
npm pkg set 'scripts.vault:prove:v2=node scripts/lot-v2-vault-prove.mjs'
printf '\nLOT V2 signed-vault local command installed.\n'
printf 'Run: npm run vault:prove:v2 -- LOT-3001 B-01 530 100\n'
