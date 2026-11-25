# Operator setup and deployment

This checkout preserves the executable source exported from the live Azure server. Use synthetic data and a dedicated Preprod wallet; never use a production wallet or confidential industrial records. Run commands on a private development machine unless marked as Azure-specific.

## Wallet runtime and issuance

1. Install the project dependencies and the separate wallet runtime (`npm ci --include=dev` in the root and in `runtime/wallet`). The root lockfile and wallet lockfile are included.
2. Run the Ledger 9 compatible proof server. The deployed server used `midnightntwrk/proof-server:9.0.2`, bound only to `127.0.0.1:6300`. Check `curl -fsS http://127.0.0.1:6300/health`. Do not expose this port.
3. Provision a dedicated Preprod wallet with registered NIGHT and spendable DUST using Midnight's wallet tooling. The bundled bootstrap **only reads and synchronizes**, not registers or funds the wallet. Run from `runtime/wallet`:

   ```sh
   bash lot-ledger9-bootstrap.sh YOUR_PREPROD_UNSHIELDED_ADDRESS
   ```

   Enter the wallet phrase and Blockfrost token only in the hidden prompts. Verify the address matches and a synchronized checkpoint exists. Do not run the same wallet simultaneously on different machines.
4. **Current portability limitation:** the browser issuance module and older Preprod scripts pin the development wallet's public address in their source. A new operator must configure their own address consistently before live issuance. In a private local checkout replace the pinned address in `scripts/lot-browser-issuance.mjs`, `scripts/lot-onboard-preprod.ts`, `scripts/lot-onboard-preprod.sh`, `scripts/lot-preprod-deploy-v2.{ts,sh}`, `scripts/lot-preprod-register-v2.{ts,sh}` and `scripts/lot-preprod-clearance-v2.{ts,sh}`. The worker still checks the derived wallet address and checkpoint. Do not alter those identity checks or reuse someone else's checkpoint. The old helper package's `identity` and `register` npm aliases target an unbundled `src/index.ts`; use external wallet tooling for provisioning and the included bootstrap script for synchronization. These are known reproducibility limitations, not prerequisites for the local app, simulator or public verification.
5. Create the intended manufacturer account first. Stop the local account service when no issuance is active. From the project root, launch the explicitly authorized operator:

   ```sh
   LOT_ISSUER_RUNNER="$PWD/runtime/wallet/node_modules/.bin/tsx" \
     bash scripts/lot-browser-operator.sh YOUR_MANUFACTURER_USERNAME
   ```

   Use the hidden prompts. Do not expose port 4175. An issuance is subject to persistent budget, exact approved batch/policy binding and manufacturer password confirmation. The first clearance may deploy a contract, register inspection and policy, and prove qualification; additional policies reuse the original contract and inspection. If interrupted, inspect the journal and reconcile rather than blindly resubmitting.

## Azure deployment used for the demo

- Ubuntu VM with Node.js 22, Docker proof server, compiled V1/V2 artifacts and both dependency trees.
- `lot-operator`, `lot-verifier` and `lot-gateway` systemd services listen on 127.0.0.1:4175, 4176 and 4195. Caddy is the only public web entry point on ports 80 and 443. Keep SSH restricted and do not expose internal service ports.
- `scripts/lot-stage-cloud-services.sh` is specific to the existing `/home/lotadmin/lot` Azure deployment and Austria East DNS hostname convention. It stages root-only environment files and service units. It is not a generic cloud installer; adapt paths for other environments and never distribute the environment files. See the accompanying technical build notes for exact configuration.
- Build both frontends before activation: `npm run build` and `VITE_LOT_HOSTED=1 ./node_modules/.bin/vite build --config vite.preprod.config.mjs`. Enable `LOT_PUBLIC_SIGNUP=1` on the gateway. Caddy must overwrite `X-Lot-Client-IP` with `{remote_host}` when forwarding to the gateway; do not trust a caller-supplied header.
- Keep operator accounts, report store, wallet checkpoints, private journals and issuance budget outside the source tree. The static receipt directory is public-only; `LOT_PUBLIC_LIVE_RECEIPTS=1` allows exact-key reads from the live public receipt store.
- Do not restart during issuance. After a restart verify local service health, public access, unauthenticated rejection of private APIs, existing account login and existing receipts. Do not generate new transactions just to test availability.

The live cloud demo uses finite student credits and bounded issuance. This is not a promise of indefinite hosting or production availability.
