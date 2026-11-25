/**
 * Public chain identifier formats observed in Midnight Ledger 9 local testnet:
 * - Contract addresses: 32 bytes encoded as 64 plain hex characters.
 * - Submitted tx IDs: 33 bytes encoded as 66 plain hex characters.
 *
 * In particular, a 66-character transaction ID is NOT a 64-character digest
 * with an extra prefix that should be removed. Preserve it exactly as returned
 * by submitCallTx(...).public.txId. No coercion, truncation, or prefix stripping.
 */
const contractAddressPattern = /^[0-9a-f]{64}$/i;
const transactionIdPattern = /^[0-9a-f]{66}$/i;

export const publicIdFields = Object.freeze([
  'contractAddress', 'inspectionTx', 'policyTx', 'clearanceTx',
]);

export function isValidPublicChainId(field, value) {
  if (typeof value !== 'string') return false;
  if (field === 'contractAddress') return contractAddressPattern.test(value);
  if (field === 'inspectionTx' || field === 'policyTx' || field === 'clearanceTx') {
    return transactionIdPattern.test(value);
  }
  return false;
}
