# Security and privacy

LOT is a Preprod demonstration, not an accredited certification service or audited production financial/identity system. Use synthetic measurements only.

The operator manages inspector signing keys, encrypted inspection data and a funded test wallet. Confidentiality is against buyers and public observers, not the trusted operator. The public verifier does not establish physical truth, independent accreditation, buyer-authenticated policy provenance or independent consensus verification.

The hosted gateway uses an exact configured origin, restricted routes, secure session cookies and bounded request handling. Public accounts cannot grant themselves on-chain issuance; explicit authorization and persistent issuance reservations are required. Account, batch and session capacity are intentionally small; in-memory throttling resets at restart, shared networks may hit limits, and there is no email verification, CAPTCHA or independent security audit. Review dependencies and deployment configuration before real use.

Never publish recovery phrases, tokens, account stores, encrypted private reports, checkpoints, private state databases, issuance journals, secret environment files or private keys. The files in `contracts/managed/*/keys` are generated public proving/verification artifacts, not wallet signing keys. The bundled JSON receipts contain public metadata, not raw inspection readings.

For suspected vulnerabilities, contact the repository owner privately rather than posting exploit details, credentials or private report data in public issues. Do not test destructive or high-volume behavior against the shared demo.
