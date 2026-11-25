#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm pkg set 'scripts.users:create=node scripts/lot-local-operator-cli.mjs create' \
 'scripts.users:list=node scripts/lot-local-operator-cli.mjs list'
node --check scripts/lot-operator-access.mjs
node --check scripts/lot-local-operator-cli.mjs
node --check scripts/lot-proof-api.mjs
node --test test/lot-operator-access.test.js
printf '\nLOT Build 23 local operator access installed.\n'
printf 'Create inspector and manufacturer operators before using proof writes in LOT.\n'
