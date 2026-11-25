import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFailedRun } from '../scripts/lot-test-diagnostics.mjs';

test('reports actual exception rather than Vitest FAIL headline', () => {
  const logs = ' FAIL test/lot.live.test.ts > proof \nError: Indexer did not show inspection before the deadline.';
  const result = summarizeFailedRun(logs, 'Inspection committed');
  assert.match(result.cause, /Indexer did not show inspection/);
  assert.equal(result.phase, 'Inspection committed');
});
test('redacts private content and long hexadecimal input', () => {
  const secret = '0x' + 'a'.repeat(128);
  const logs = `Error: invalid input ${secret}`;
  const result = summarizeFailedRun(logs, 'Proof finalized');
  assert.doesNotMatch(result.cause, /a{32}/);
  assert.match(result.cause, /redacted/);
  assert.equal(
    summarizeFailedRun('Error: privateState inspectorSecret 99', 'test').cause,
    'Vitest exited nonzero; no safe exception line was found in its output.'
  );
});
