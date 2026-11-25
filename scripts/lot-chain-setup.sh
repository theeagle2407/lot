#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f contracts/managed/lot/contract/index.js ]; then
  echo 'Missing compiled Compact contract. Run npm run compact:compile first.'
  exit 1
fi
node -e "import('@midnight-ntwrk/midnight-js-indexer-public-data-provider')" >/dev/null || {
  echo 'Missing Ledger 9 SDK dependencies. Run bash scripts/lot-network-setup.sh first.'
  exit 1
}
npm pkg set 'scripts.chain:serve=node scripts/lot-chain-server.mjs'
# The app and local state API should not be exposed to LAN devices during this pilot.
npm pkg set 'scripts.dev=vite --host 127.0.0.1'
echo 'Build 03 ready. Terminal 1: npm run chain:serve | Terminal 2: npm run dev'
