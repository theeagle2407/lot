/**
 * LOT V2: compact-runtime signing adapter.
 * Requires a separately compiled contracts/managed/lot-v2 contract.
 * Never logs signing keys, measurements, report salts, or signature bytes.
 * Signing keys in the test suite are disposable, synthetic fixtures only.
 */
import {
  CompactTypeField,
  CompactTypeVector,
  degradeToTransient,
  jubjubSchnorrSign,
  jubjubSchnorrVerifyingKey,
  jubjubSchnorrVerify,
} from '@midnight-ntwrk/compact-runtime';
import { pureCircuits } from '../contracts/managed/lot-v2/contract/index.js';

// V2 Compact verifies a Vector<1, Field>, NOT a Vector<1, Bytes<32>>.
// Its single element is degradeToTransient(reportSignatureMessage(...)).
// The signed transcript MUST use precisely the verifier's type and value.
export const signatureMessageType = new CompactTypeVector(1, CompactTypeField);

export function reportSignatureDigest(batchId, strength, defectBps, salt) {
  const digest = pureCircuits.reportSignatureMessage(batchId, strength, defectBps, salt);
  if (!(digest instanceof Uint8Array) || digest.length !== 32) {
    throw new Error('V2 digest has unexpected encoding; do not sign or submit');
  }
  return digest;
}

export function reportSignatureFields(batchId, strength, defectBps, salt) {
  return [degradeToTransient(reportSignatureDigest(batchId, strength, defectBps, salt))];
}

export function signInspectionV2(batchId, strength, defectBps, salt, signingKey) {
  if (typeof signingKey !== 'bigint' || signingKey <= 0n) {
    throw new Error('Inspector Jubjub signing key must be a positive scalar');
  }
  const message = reportSignatureFields(batchId, strength, defectBps, salt);
  const signature = jubjubSchnorrSign(signatureMessageType, message, signingKey);
  const inspectorPublicKey = jubjubSchnorrVerifyingKey(signingKey);
  if (!jubjubSchnorrVerify(signatureMessageType, message, inspectorPublicKey, signature)) {
    throw new Error('Local V2 signature self-check failed; refusing submission');
  }
  return { signature, inspectorPublicKey };
}
