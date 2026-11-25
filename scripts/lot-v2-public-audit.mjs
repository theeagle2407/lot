/** Derive exactly the public keys used by the LOT V2 Compact contract. */
import { createHash } from 'node:crypto';
import { CompactTypeVector, CompactTypeBytes, persistentHash } from '@midnight-ntwrk/compact-runtime';
import { checkV2PublicLedger } from './lot-v2-public-audit-core.mjs';
const pairType = new CompactTypeVector(2, new CompactTypeBytes(32));
export function publicKey(domain, label) {
  return new Uint8Array(createHash('sha256').update(domain).update(':').update(label).digest());
}
export function clearanceMapKey(batchId, policyId) {
  return persistentHash(pairType, [publicKey('LOT_BATCH_V1',batchId), publicKey('LOT_BUYER_POLICY_V1',policyId)]);
}
export function auditV2PublicState(session, ledger) {
  return checkV2PublicLedger(session, ledger, {
    batchKey: b => publicKey('LOT_BATCH_V1',b),
    policyKey: p => publicKey('LOT_BUYER_POLICY_V1',p),
    clearanceKey: clearanceMapKey,
  });
}
