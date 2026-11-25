#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --input-type=module <<'JS'
import { execFileSync } from 'node:child_process';
const set=(key,value)=>execFileSync('npm',['pkg','set',`scripts.${key}=${value}`],{stdio:'inherit'});
set('inspector:init','node scripts/lot-inspector-cli.mjs init');
set('inspector:trust-local','node scripts/lot-inspector-cli.mjs trust-local');
set('inspector:trusted','node scripts/lot-inspector-cli.mjs trusted');
set('inspector:attest','node scripts/lot-inspector-cli.mjs attest');
set('inspector:check','node scripts/lot-inspector-cli.mjs check');
set('vault:prove:attested','LOT_REQUIRE_ATTESTATION=1 node scripts/lot-vault-prove.mjs');
JS
printf '%s\n' 'LOT Build 12 installed. No packages or Compact contract changes.' 'Run: npm test; then inspector:init, inspector:trust-local, inspector:attest -- LOT-3001'
