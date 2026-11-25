#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm pkg set 'scripts.users:reset=node scripts/lot-local-operator-cli.mjs reset'
node --check scripts/lot-operator-access.mjs
node --check scripts/lot-local-operator-cli.mjs
node --test test/lot-operator-access.test.js
printf '\nLOT Build 23A local password reset available.\n'
printf 'List operators with: npm run users:list\n'
printf 'Reset an existing operator with: npm run users:reset -- maker01\n'
