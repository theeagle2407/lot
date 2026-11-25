/** Public-only, local-development receipt grouping. No chain queries or private state. */
import { sanitizeArchiveReceipt } from './lot-proof-archive.mjs';

/**
 * Group receipts by the same contract + same inspection transaction + same batch.
 * Distinct archived buyer proofs in later CLI runs become one inspection session.
 * An archived receipt is NOT itself independent proof of current chain state.
 */
export function summarizeEvidenceSessions(records) {
  if (!Array.isArray(records) || records.length > 40) throw new Error('Invalid archive input.');
  const sessions = new Map();
  for (const entry of records) {
    if (!entry || !/^[0-9a-f]{16}$/.test(entry.id) ||
        typeof entry.savedAt !== 'string' || !Number.isFinite(Date.parse(entry.savedAt))) {
      throw new Error('Invalid archive entry metadata.');
    }
    const receipt = sanitizeArchiveReceipt(entry.receipt);
    const key = `${receipt.contractAddress}:${receipt.inspectionTx}:${receipt.batchId}`;
    let session = sessions.get(key);
    if (!session) {
      session = {
        batchId: receipt.batchId,
        contractAddress: receipt.contractAddress,
        inspectionTx: receipt.inspectionTx,
        latestSavedAt: entry.savedAt,
        archiveEntries: 0,
        clearances: [],
        // Internal maps are NOT serialized or returned.
        _transactions: new Map(),
        _policies: new Map(),
      };
    } else {
      sessions.delete(key); // Most recently appended session becomes last.
    }
    session.latestSavedAt = entry.savedAt;
    session.archiveEntries += 1;
    const buyers = [{policyId: receipt.policyId, policy: receipt.policy,
      policyTx: receipt.policyTx, clearanceTx: receipt.clearanceTx}, ...receipt.additional];
    for (const item of buyers) {
      const existing = session._transactions.get(item.clearanceTx);
      if (existing) {
        if (existing.policyId !== item.policyId || existing.policyTx !== item.policyTx ||
            existing.minStrength !== item.policy.minStrength ||
            existing.maxDefectsBps !== item.policy.maxDefectsBps)
          throw new Error('Conflicting archived clearance transaction.');
        continue; // Exactly repeated receipt: do not count it again.
      }
      if (session._policies.has(item.policyId)) {
        throw new Error('Conflicting archived buyer policy for one contract.');
      }
      const buyer = {
        policyId: item.policyId,
        minStrength: item.policy.minStrength,
        maxDefectsBps: item.policy.maxDefectsBps,
        policyTx: item.policyTx,
        clearanceTx: item.clearanceTx,
      };
      session._transactions.set(item.clearanceTx, buyer);
      session._policies.set(item.policyId, buyer);
      session.clearances.push(buyer);
    }
    sessions.set(key, session);
  }
  return [...sessions.values()].map(s => Object.freeze({
    batchId: s.batchId,
    contractAddress: s.contractAddress,
    inspectionTx: s.inspectionTx,
    archiveEntries: s.archiveEntries,
    latestSavedAt: s.latestSavedAt,
    clearanceCount: s.clearances.length,
    clearances: Object.freeze(s.clearances.map(c => Object.freeze({...c}))),
  }));
}
