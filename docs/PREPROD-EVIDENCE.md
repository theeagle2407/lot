# Preprod evidence

Development records, confirmed in the user's November 24, 2026 logs. The following are recorded development results; use the live verifier to repeat the checks. Submission identifiers are preserved verbatim; they are not assumed to be the explorer's transaction hashes. Inspect contract state via the [Preprod explorer](https://preprod.midnightexplorer.com/) or LOT's read-only verifier.

| Batch / policy | Contract address | Clearance submission identifier |
|---|---|---|
| LOT-3002 / B-02 | `00840699a415c117c2470838f649179362871143f6d8a000ad42614940d9d7b8` | `00b1066ca395cff1cbd8a906f0218969c984c8fb059648f98de1ad895aa82ae04a` |
| LOT-0001 / B-02 | `c776e67c0d6784e377c421b5abc6bfa935c8c39ee0b521fe70c820a8ca647bcf` | `00e9c4439df7d1b6035e65070935d044ae5ea5312e520d669ff9adc0cb217d292f` |
| LOT-0002 / B-03 | `02129d89467c1e5c901d2ebc42bc2626995860bfb20a4ae1cd4ee5136cf872e0` | `00efb39fd71dc4b0a31e25a355c4f8fe31f502ded16afa2f486e0bb0605adf27d3` |
| LOT-0002 / B-04 | `02129d89467c1e5c901d2ebc42bc2626995860bfb20a4ae1cd4ee5136cf872e0` | `0005203bb4e2a62e353881c7ba921abd0fbb97ee20340f55717b23db744343e6b0` |

## Multi-buyer evidence

| Field | B-03 | B-04 |
|---|---|---|
| Batch key | `0cbf4ea97a25c0d98713534348de9bb31701052e41b3bdb0fb8049f7a3968123` | same |
| Inspection submission | `003fce9bf131549856508a0ea4bb829b02c25af5b741af60ff5e0e548b9f38d38a` | same |
| Policy submission | `0029cfe941b70feade3d2cb2bd8a4d4528e2aa68c2383591f1cf885dae01cb9019` | `00d5201bd90f05f128ffb7cd70d79a5b6cd380696c75c68a085d4515e832dfa584` |
| Clearance key | `2647ec8f8ab67ca310da60cd4c244f1826c4da97855dc7897fbf5a1a56d4bf87` | `8d981a56bdb39139af63644102ac8f06af8de0e44e822ea98523fcf8234e0f5c` |
| Read-only check time (UTC) | 2026-11-24 16:42:32.165 | 2026-11-24 16:42:32.611 |

Both live reads returned `status: verified`, `inspectionPresent: true`, `policyMatches: true`, `clearancePresent: true`, and matching enrolled inspector fingerprint `ecca72b3a5eaa8e969648dd0c07c03e0c235b4e72a88da89a70c3043f2cc1894`.

## Public release routes

Append these paths to the deployed HTTPS base URL `https://lot-clearance.austriaeast.cloudapp.azure.com`:

- `/verify-preprod?batch=LOT-3002`
- `/verify-preprod?key=eee890fa3380b60bf9f08a5c1904dea1ed239566b37bd56ba44db71aac65b7f9`
- `/verify-preprod?key=0cbf4ea97a25c0d98713534348de9bb31701052e41b3bdb0fb8049f7a3968123`
- `/verify-preprod?key=f86c4070ce4bc0a0e85368a45c017bc3ebcbb0dccdc455d47c45f1fd6e385d13`

## Engineering verification

November 24: full V2 compilation on the development machine: `proveClearance` (6,137 rows), `registerInspectionSigned` (9,311 rows), `registerPolicy` (4,076 rows). Development logs recorded 311 application checks and 20 Compact simulator checks passing at that point.

November 25: the Azure full test command exited 0; an independent rerun of the exported application suite passed 330/330 with no skipped checks. The cloud UI displayed a newly issued clearance, but its exact public receipt and independent ledger response have not yet been added to this document. Do not count it as a separately verified fifth receipt until that check is completed.

The three bundled receipt records passed the release's receipt-schema validation. Receipt metadata alone is not proof of current on-chain state. The hosted verifier performs the ledger read.
