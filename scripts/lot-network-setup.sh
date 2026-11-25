#!/usr/bin/env bash
set -euo pipefail

# Run from lot-clean-v3 root. Intentionally never starts or resets the devnet.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f contracts/managed/lot/contract/index.js || ! -d contracts/managed/lot/zkir || ! -d contracts/managed/lot/keys ]]; then
  echo "Full Compact artifacts not present. Running npm run compact:compile ..."
  npm run compact:compile
fi

echo 'Checking local endpoints...'
if ! curl --noproxy '*' -fsS --max-time 10 'http://127.0.0.1:6300/health' >/dev/null; then
  echo 'LOT proof server is not healthy on port 6300.'
  exit 1
fi
if ! curl --noproxy '*' -fsS --max-time 10 \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ block { height hash } }"}' \
  'http://127.0.0.1:8088/api/v4/graphql' >/dev/null; then
  echo 'LOT indexer is not responding on port 8088.'
  exit 1
fi

mkdir -p test/lot-official
# Resolve the current examples commit once. Fetch all three helpers at the same revision.
COMMIT="$(git ls-remote https://github.com/midnightntwrk/midnight-examples.git refs/heads/main | awk '{ print $1 }')"
if [[ ! "$COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo 'Could not resolve the official Midnight examples commit.'
  exit 1
fi
printf '%s\n' "$COMMIT" > test/lot-official/UPSTREAM_COMMIT.txt
BASE="https://raw.githubusercontent.com/midnightntwrk/midnight-examples/${COMMIT}/examples/private-party/src"
for file in wallet.ts config.ts providers.ts; do
  echo "Fetching official Ledger 9 helper: $file"
  curl -fsSL --retry 3 "$BASE/$file" -o "test/lot-official/$file"
done

# Keep all packages compatible with the 17 Nov 2026 Ledger 9.1 patch.
npm pkg set 'scripts.test:network=MIDNIGHT_NETWORK=local vitest run test/lot.network.test.ts --maxWorkers=1 --minWorkers=1'
npm pkg set 'overrides.@midnightntwrk/onchain-runtime-v4=4.0.2'
npm pkg set 'overrides.@midnightntwrk/ledger-v9=1.0.2'
npm pkg set 'overrides.@midnightntwrk/zkir-v3=3.2.1'

npm install \
  @midnight-ntwrk/midnight-js-contracts@5.0.1 \
  @midnight-ntwrk/midnight-js-http-client-proof-provider@5.0.1 \
  @midnight-ntwrk/midnight-js-indexer-public-data-provider@5.0.1 \
  @midnight-ntwrk/midnight-js-level-private-state-provider@5.0.1 \
  @midnight-ntwrk/midnight-js-node-zk-config-provider@5.0.1 \
  @midnight-ntwrk/midnight-js-protocol@5.0.1 \
  @midnight-ntwrk/midnight-js-types@5.0.1 \
  @midnight-ntwrk/midnight-js-utils@5.0.1 \
  @midnight-ntwrk/testkit-js@5.0.1 \
  @midnightntwrk/wallet-sdk@2.0.1 \
  'pino@^9.0.0' 'pino-pretty@^13.0.0' 'rxjs@^7.8.2' 'ws@^8.14.2'
npm install -D 'vitest@^5.0.4' '@types/node@^22.0.0' '@types/ws@^8.5.9' 'typescript@^5.7.0'

echo
printf 'Installed Ledger 9 helpers from midnight-examples commit %s\n' "$COMMIT"
echo 'Next: npm run test:network'
