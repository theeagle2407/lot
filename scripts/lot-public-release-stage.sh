#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="$HOME/Downloads/lot-public-release"
[[ ! -e "$DEST" && ! -L "$DEST" ]] || { echo "Destination exists: $DEST (nothing overwritten)"; exit 2; }
files=(package.json package-lock.json lot-public.html vite.preprod.config.mjs src/preprod-main.jsx src/PublicClearanceIndex.jsx src/preprod-base.css src/PreprodBuyer.jsx src/preprod.css src/preprod-clearance.js src/receipt-target.js scripts/lot-preprod-public-server.mjs scripts/lot-preprod-public-read.mjs scripts/lot-preprod-public-core.mjs scripts/lot-public-receipt-store.mjs scripts/lot-multi-policy.mjs scripts/lot-public-release-receipts.mjs test/preprod-public.test.mjs test/public-release.test.mjs docs/LOT_BUILD_46_HOSTING.md)
for f in "${files[@]}" contracts/managed/lot-v2/contract/index.js; do [[ -f "$f" && ! -L "$f" ]] || { echo "Missing or unsafe file: $f"; exit 2; }; done
GENERATED=contracts/managed/lot-v2/contract
[[ -z "$(find "$GENERATED" -type l -print -quit)" ]] || { echo 'Unexpected generated contract symlink'; exit 2; }
[[ -z "$(find "$GENERATED" -type f ! -name '*.js' ! -name '*.ts' ! -name '*.json' ! -name '*.map' -print -quit)" ]] || { echo 'Unexpected file in generated decoder; review manually'; exit 2; }
TMP="$(mktemp -d "$HOME/Downloads/.lot-public-release.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
for f in "${files[@]}"; do mkdir -p "$TMP/$(dirname "$f")"; cp "$f" "$TMP/$f"; done
mkdir -p "$TMP/contracts/managed/lot-v2"
cp -R "$GENERATED" "$TMP/contracts/managed/lot-v2/contract"
node scripts/lot-public-release-receipts.mjs "$TMP/public-receipts"
node --input-type=module - "$TMP" <<'NODE'
import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
const p=join(process.argv[2],'package.json'),j=JSON.parse(readFileSync(p,'utf8'));
j.scripts={build:'vite build --config vite.preprod.config.mjs',start:'LOT_PUBLIC_RECEIPTS_DIR=./public-receipts node scripts/lot-preprod-public-server.mjs',test:'node --test test/preprod-public.test.mjs test/public-release.test.mjs'};
writeFileSync(p,JSON.stringify(j,null,2)+'\n');
NODE
cp docs/LOT_BUILD_46_HOSTING.md "$TMP/README.md"
cat > "$TMP/.gitignore" <<'IGNORE'
node_modules/
dist-preprod/
.env
.env.*
*.log
.DS_Store
IGNORE
printf '22.23.1\n' > "$TMP/.node-version"
(cd "$TMP" && npm test)
# No user credentials, journals, proof keys, operator endpoints or private state exported.
mv "$TMP" "$DEST"
trap - EXIT
printf '\nPublic release ready: %s\n' "$DEST"
echo 'Four public clearances: one fixed legacy target and three exported receipts. No transaction submitted.'
