/**
 * Poll a finalized public ledger view until the indexer has indexed a receipt.
 * RPC transaction finality is not the same as indexer visibility.
 * Never treats missing/stale state as proof of success.
 */
export async function waitForIndexedState(getState, predicate, {
  label = 'finalized transaction', timeoutMs = 90_000, pollMs = 750,
} = {}) {
  if (typeof getState !== 'function' || typeof predicate !== 'function') {
    throw new TypeError('State reader and predicate are required.');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 ||
      !Number.isFinite(pollMs) || pollMs < 1) {
    throw new RangeError('Invalid indexer polling interval.');
  }
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const state = await getState();
      if (state !== null && state !== undefined && predicate(state)) return state;
    } catch {
      // The indexer can briefly be unavailable while catching up.
      // Retry and fail closed at the deadline; never report confirmed without state.
    }
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, deadline - Date.now())));
  } while (Date.now() <= deadline);
  throw new Error(`Indexer did not show ${label} before the deadline. Check indexer health or network finality.`);
}
