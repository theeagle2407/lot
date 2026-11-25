import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForIndexedState } from '../scripts/lot-indexer-wait.mjs';

test('polls delayed indexer state instead of rejecting a finalized transaction', async () => {
  const states = [null, { inspections: 0 }, { inspections: 1 }];
  const state = await waitForIndexedState(async () => states.shift(), x => x.inspections === 1,
    { timeoutMs: 400, pollMs: 5, label: 'inspection' });
  assert.equal(state.inspections, 1);
});
test('does not falsely confirm a clearance if it never appears', async () => {
  await assert.rejects(() => waitForIndexedState(async () => ({ clearances: 0 }), x => x.clearances === 1,
    { timeoutMs: 25, pollMs: 5, label: 'clearance' }), /did not show clearance/);
});
test('transient indexer query failure can recover', async () => {
  let count = 0;
  const state = await waitForIndexedState(async () => {
    if (++count < 3) throw new Error('temporary indexing outage');
    return { exists: true };
  }, x => x.exists, { timeoutMs: 300, pollMs: 5 });
  assert.equal(state.exists, true);
});
