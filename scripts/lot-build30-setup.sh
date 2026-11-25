#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --check scripts/lot-preprod-core.mjs
node --check scripts/lot-preprod-credentials.mjs
node --check scripts/lot-preprod-doctor.mjs
node --check scripts/lot-preprod-configure.mjs
node --check scripts/lot-preprod-audit.mjs
node --test test/lot-preprod-readiness.test.js
npm pkg set \
 'scripts.preprod:doctor=node scripts/lot-preprod-doctor.mjs' \
 'scripts.preprod:configure=node scripts/lot-preprod-configure.mjs' \
 'scripts.preprod:audit=node scripts/lot-preprod-audit.mjs'
# Block accidental check-in of credentials used by other Midnight examples.
if ! grep -qxF '.env.preprod' .gitignore 2>/dev/null; then printf '\n.env.preprod\n' >> .gitignore; fi
if ! grep -qxF '.env.preprod.*' .gitignore 2>/dev/null; then printf '.env.preprod.*\n' >> .gitignore; fi
printf '\nBuild 30 installed. Run: npm run preprod:doctor\n'
