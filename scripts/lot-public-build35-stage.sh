#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Export only the public frontend and reader, never the local operator workspace.
DEST="$HOME/Downloads/lot-public-deploy"
if [[ -e "$DEST" ]]; then echo "Destination already exists: $DEST. No files overwritten."; exit 2; fi
files=(package.json package-lock.json lot-public.html vite.preprod.config.mjs src/preprod-main.jsx src/PreprodBuyer.jsx src/preprod-base.css src/preprod.css src/preprod-clearance.js src/receipt-target.js scripts/lot-public-receipt-store.mjs scripts/lot-multi-policy.mjs scripts/lot-preprod-public-core.mjs scripts/lot-preprod-public-read.mjs scripts/lot-preprod-public-server.mjs test/preprod-public.test.mjs contracts/lot-v2.compact docs/LOT_PUBLIC_HOSTING.md)
for f in "${files[@]}" contracts/managed/lot-v2/contract/index.js; do [[ -f "$f" ]] || { echo "Missing: $f"; exit 2; }; done
if [[ -n "$(find contracts/managed/lot-v2 -type l -print -quit)" ]]; then echo 'Unexpected symlink in generated contract. Stopping.'; exit 2; fi
if [[ -n "$(find contracts/managed/lot-v2 -type f \( -iname '.env*' -o -iname '*secret*' -o -iname '*seed*' -o -iname '*mnemonic*' -o -iname '*.pem' \) -print -quit)" ]]; then echo 'Unexpected potentially sensitive file in generated contract. Review before exporting.'; exit 2; fi
mkdir "$DEST"
for f in "${files[@]}"; do mkdir -p "$DEST/$(dirname "$f")"; cp "$f" "$DEST/$f"; done
mkdir -p "$DEST/contracts/managed"
cp -R contracts/managed/lot-v2 "$DEST/contracts/managed/"
cp docs/LOT_PUBLIC_HOSTING.md "$DEST/README.md"
cat > "$DEST/.gitignore" <<'IGNORE'
node_modules/
dist-preprod/
.env
.env.*
*.log
.DS_Store
IGNORE
printf '22.23.1\n' > "$DEST/.node-version"
echo "Public hosting source staged: $DEST"
echo 'Review these files before committing. No wallet, vault, local API or local configuration was copied.'
