/** Buyer-view status is derived from a FRESH, exact ledger match, never a saved receipt. */
export const MAX_LOCAL_AUDIT_AGE_MS = 90_000;

export function freshLocalAudit(audit, now = Date.now()) {
  const checkedAt = audit?.receivedAtMs;
  return audit?.status === 'verified' && Number.isSafeInteger(checkedAt) &&
    Number.isFinite(now) && checkedAt <= now && now - checkedAt <= MAX_LOCAL_AUDIT_AGE_MS;
}

export function buyerVerificationPresentation(audit, exactMatch, fresh) {
  if (exactMatch && fresh) return {
    label: 'Verified · local', heading: 'Verified',
    description: 'Confirmed on the current local ledger.', state: 'verified',
  };
  if (audit?.status === 'checking') return {
    label: 'Checking…', heading: 'Checking ledger',
    description: 'Reading current local ledger state.', state: 'checking',
  };
  if (exactMatch && !fresh) return {
    label: 'Local receipt', heading: 'Check expired',
    description: 'The last ledger check is too old. Recheck to verify.', state: 'stale',
  };
  if (audit?.status === 'unavailable') return {
    label: 'Local receipt', heading: 'Ledger unavailable',
    description: 'The receipt is saved, but ledger verification is unavailable.', state: 'unavailable',
  };
  return {
    label: 'Local receipt', heading: 'Not verified',
    description: 'No matching current local clearance was confirmed.', state: 'unverified',
  };
}
