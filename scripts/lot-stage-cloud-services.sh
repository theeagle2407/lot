#!/usr/bin/env bash
# Stage credentials + systemd units. Does not stop, start or expose any service.
set -euo pipefail
set +x
umask 077
cd "$(dirname "$0")/.."
[[ $(id -un) == lotadmin && "$PWD" == /home/lotadmin/lot ]] || { echo 'Run as lotadmin in /home/lotadmin/lot on Azure.'; exit 2; }
[[ -f dist/index.html && -f dist-preprod/lot-public.html && -x runtime/wallet/node_modules/.bin/tsx ]] || { echo 'Build both frontends and install wallet runtime first.'; exit 2; }
read -rp 'Public Azure DNS hostname (no https://): ' HOSTNAME_LOT
[[ "$HOSTNAME_LOT" =~ ^[a-z0-9][a-z0-9.-]*\.austriaeast\.cloudapp\.azure\.com$ ]] || { echo 'Expected Austria East Azure public IP DNS name.'; exit 2; }
read -rp 'Existing authorized manufacturer username(s), comma-separated: ' ACCOUNT
[[ "$ACCOUNT" =~ ^[a-z][a-z0-9_-]{2,31}(,[a-z][a-z0-9_-]{2,31})*$ ]] || { echo 'Invalid account list.'; exit 2; }
read -rsp 'Dedicated TEST wallet recovery phrase (hidden): ' MNEMONIC; echo
[[ "$MNEMONIC" =~ ^[a-z]+(\ [a-z]+){23}$ ]] || { echo 'Expected 24 lowercase words separated by spaces.'; exit 2; }
read -rsp 'Midnight Preprod Blockfrost token (hidden): ' TOKEN; echo
[[ "$TOKEN" =~ ^[A-Za-z0-9_-]{16,256}$ ]] || { echo 'Invalid token format.'; exit 2; }
read -rsp 'Reviewer access password (48 lowercase hex characters, separate from LOT login): ' REVIEWER; echo
[[ "$REVIEWER" =~ ^[a-f0-9]{48}$ ]] || { echo 'Generate with openssl rand -hex 24.'; exit 2; }
HASH=$(printf '%s' "reviewer:$REVIEWER" | sha256sum | cut -d' ' -f1)
sudo -n true
if sudo test -e /etc/lot/operator.env || sudo test -e /etc/lot/verifier.env || sudo test -e /etc/lot/gateway.env; then echo 'Existing service credentials found; refusing overwrite.'; exit 2; fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"; unset MNEMONIC TOKEN REVIEWER HASH' EXIT
printf 'LOT_ISSUER_RUNNER=/home/lotadmin/lot/runtime/wallet/node_modules/.bin/tsx\nLOT_ISSUER_ACCOUNT=%s\nLOT_ISSUER_MNEMONIC="%s"\nLOT_ISSUER_TOKEN=%s\nLOT_ISSUER_TOTAL=3\nLOT_ISSUER_PER_ACCOUNT=3\n' "$ACCOUNT" "$MNEMONIC" "$TOKEN" > "$TMP/operator.env"
printf 'HOST=127.0.0.1\nPORT=4176\nLOT_PUBLIC_LIVE_RECEIPTS=1\nLOT_PUBLIC_RECEIPTS_DIR=/home/lotadmin/lot/public-receipts\nBLOCKFROST_PROJECT_ID=%s\n' "$TOKEN" > "$TMP/verifier.env"
printf 'LOT_PUBLIC_ORIGIN=https://%s\nLOT_REVIEWER_HASH=%s\n' "$HOSTNAME_LOT" "$HASH" > "$TMP/gateway.env"
sudo install -d -m 0700 -o root -g root /etc/lot
for service in operator verifier gateway; do sudo install -m 0600 -o root -g root "$TMP/$service.env" "/etc/lot/$service.env"; done
for service in operator verifier gateway; do
 case "$service" in operator) entry=lot-proof-api.mjs;; verifier) entry=lot-preprod-public-server.mjs;; gateway) entry=lot-hosted-gateway.mjs;; esac
 cat > "$TMP/lot-$service.service" <<UNIT
[Unit]
Description=LOT $service (loopback only)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=lotadmin
Group=lotadmin
WorkingDirectory=/home/lotadmin/lot
Environment=HOME=/home/lotadmin
Environment=PATH=/usr/local/bin:/usr/bin:/bin
EnvironmentFile=/etc/lot/$service.env
ExecStart=/usr/local/bin/node /home/lotadmin/lot/scripts/$entry
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=yes
KillMode=control-group
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
UNIT
 sudo install -m 0644 -o root -g root "$TMP/lot-$service.service" /etc/systemd/system/
done
sudo systemctl daemon-reload
printf '%s\n' 'Staged only. Existing operator/verifier unchanged. No ports opened. No transactions submitted.'
