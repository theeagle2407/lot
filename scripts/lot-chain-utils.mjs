// Minimal, public-only ledger projection. This function intentionally never
// serializes the full contract ledger, private state, report openings, or salts.
export function publicLedgerSummary(address, publicLedger, at = new Date()) {
  if (!/^[a-fA-F0-9]{64}$/.test(address)) throw new Error('Invalid 64-character contract address');
  const count = (map, name) => {
    if (!map || typeof map.size !== 'function') throw new Error(`Missing ${name} ledger map`);
    const value = Number(map.size());
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${name} count`);
    return value;
  };
  return {
    ok: true,
    network: 'local',
    contractAddress: address.toLowerCase(),
    inspections: count(publicLedger.inspections, 'inspections'),
    policies: count(publicLedger.minimumStrength, 'minimumStrength'),
    clearances: count(publicLedger.clearances, 'clearances'),
    checkedAt: at.toISOString(),
  };
}
