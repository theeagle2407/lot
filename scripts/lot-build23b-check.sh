#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --test test/lot-login-empty.test.js
printf '\nLOT Build 23B installed. Restart the web dev server and refresh LOT.\n'
