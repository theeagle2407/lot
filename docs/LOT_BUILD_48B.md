# Build 48B — Public onboarding

The full app can now be opened without shared Basic authentication. Public mode is **opt-in** (`LOT_PUBLIC_SIGNUP=1` on the gateway only); the existing reviewer hash is retained for rollback. The gateway continues to listen on loopback and accepts only the exact configured HTTPS Host, approved routes and origin checks. Backend account authentication, organization boundaries, invitation validation, CSRF validation, Secure/HttpOnly/SameSite cookies, issuance approval/password and persistent budget are unchanged.

Public mode requires Caddy to overwrite `X-Lot-Client-IP` using `{remote_host}`. Never use a client-supplied value. The gateway applies bounded per-IP counters in addition to existing global counters. Account storage has an existing global 100-account and 512 KiB limit; writes now refuse overflow before replacing the database. Each manufacturer organization is limited to 12 batches. Session count is bounded at eight per account and 1024 global. Registration cannot reserve a configured issuance-allowlisted username. Existing approved manufacturers retain issuance within their existing budget. Public visitors cannot self-authorize issuance. These limits are deliberately conservative for a student-credit demo; in-memory request limits reset on service restart, shared network clients may encounter limits, and a determined distributed attacker could still exhaust global capacity or temporarily lock out login (existing backend throttling). There is no email verification, CAPTCHA, enterprise security audit or general production-scale availability guarantee. Use synthetic demo measurements only.

## Installation on Azure

Install patch from `/home/lotadmin/lot`, run `npm run test:all`, `npm run build`, `VITE_LOT_HOSTED=1 ./node_modules/.bin/vite build --config vite.preprod.config.mjs`. Do not restart during active issuance. Preserve `/etc/lot/*.env`, wallet, receipts, account data, and budget. Configure Caddy with the existing site block and the following reverse_proxy directive:

```
reverse_proxy 127.0.0.1:4195 {
    header_up X-Lot-Client-IP {remote_host}
}
```

Validate and reload Caddy first. Then add `/etc/systemd/system/lot-gateway.service.d/48b-public.conf` containing `[Service]` and `Environment=LOT_PUBLIC_SIGNUP=1` on separate lines. `systemctl daemon-reload`, restart `lot-operator` (all sessions will need to sign in again), then `lot-gateway`. No verifier/proof-server restart required. Test GET /app (200, no Basic challenge), GET /api/proof/onboarding/catalog with no cookie (401), GET /api/proof/session (200), and public clearance links. Test from private browser and second device with a new normal account. Do not generate new transactions just to validate signup.

Rollback: remove only the 48b-public.conf drop-in, reload systemd and restart the gateway. The old reviewer hash remains in place. New public accounts and existing data are not deleted. This restores the prior shared access gate; the new protective bounds remain. Restore landing copy if staying in protected mode.

Tests: gateway mock upstream tests plus actual operator subprocess integration with temporary data and synthetic credentials; no chain transactions. Full SDK compilation and live HTTPS deployment must be validated on Azure.
