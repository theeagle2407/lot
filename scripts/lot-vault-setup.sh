#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm pkg set 'scripts.vault:save=node scripts/lot-vault-cli.mjs save'
npm pkg set 'scripts.vault:list=node scripts/lot-vault-cli.mjs list'
npm pkg set 'scripts.vault:check=node scripts/lot-vault-cli.mjs check'
node --test test/lot-private-vault.test.js
printf '\nLOT private vault commands added. No React or contract files changed.\n'
