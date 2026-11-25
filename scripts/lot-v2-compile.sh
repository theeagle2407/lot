#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v compact >/dev/null; then
  echo 'Compact compiler not on PATH. Try: export PATH="$HOME/.local/bin:$PATH"' >&2
  exit 1
fi
printf 'Compiling separate LOT V2 experiment. The working V1 contract remains untouched.\n'
compact compile --skip-zk contracts/lot-v2.compact contracts/managed/lot-v2
printf '\nLOT V2 syntax and typecheck completed. Full proof compilation and tests still required.\n'
