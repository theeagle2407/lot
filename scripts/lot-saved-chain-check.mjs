/**
 * Conservative devnet check: look up the SAME contract and ensure its public
 * ledger still contains enough inspections, policies and clearances. This is
 * NOT a transaction-by-transaction independent audit or Mainnet verification.
 */
export function hasExpectedPublicLedger(receipt, ledger) {
  if (!receipt || !ledger) return false;
  const expected = 1 + (receipt.additional?.length ?? 0);
  try {
    const count = name => {
      const n = Number(ledger[name].size());
      if (!Number.isSafeInteger(n) || n < 0) throw new Error('Invalid ledger map');
      return n;
    };
    return count('inspections') >= 1 &&
      count('minimumStrength') >= expected &&
      count('maximumDefectsBps') >= expected &&
      count('clearances') >= expected;
  } catch { return false; }
}

export async function checkSavedLocalContract(receipt) {
  const [{ indexerPublicDataProvider }, { ContractState }, { ledger }] = await Promise.all([
    import('@midnight-ntwrk/midnight-js-indexer-public-data-provider'),
    import('@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime'),
    import('../contracts/managed/lot/contract/index.js'),
  ]);
  const indexer = indexerPublicDataProvider(
    'http://127.0.0.1:8088/api/v4/graphql',
    'ws://127.0.0.1:8088/api/v4/graphql/ws',
  );
  const read = await indexer.queryContractState(receipt.contractAddress);
  if (!read || read.contractState.era !== 'v9') return false;
  const state = read.contractState.deserialize({ v9: ContractState });
  return hasExpectedPublicLedger(receipt, ledger(state.data));
}
