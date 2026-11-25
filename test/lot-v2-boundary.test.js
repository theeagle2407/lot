// These tests check the proposed V2 source's trust boundaries. They do not run
// generated Compact or establish that it compiles/produces actual ZK proofs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const source = readFileSync(new URL('../contracts/lot-v2.compact', import.meta.url), 'utf8');
const extract = (name) => {
  const start = source.indexOf(`export circuit ${name}(`);
  const next = source.indexOf('\nexport circuit ', start + 1);
  return source.slice(start, next < 0 ? undefined : next);
};

test('V2 experiment is isolated from the working V1 contract', () => {
  assert.ok(existsSync(new URL('../contracts/lot-v2.compact', import.meta.url)));
  assert.ok(!source.includes('localInspectorSecret'));
});
test('inspector key is selected at construction, not from user supplied witnesses', () => {
  assert.match(source, /sealed ledger inspectorVerificationKey: JubjubPoint/);
  assert.match(source, /inspectorVerificationKey = disclose\(inspectorKey\)/);
});
test('registration requires circuit-level signature verification', () => {
  const code = extract('registerInspectionSigned');
  assert.match(code, /assert\(jubjubSchnorrVerify<1>\(/);
  assert.match(code, /inspectorVerificationKey/);
  assert.ok(code.indexOf('jubjubSchnorrVerify') < code.indexOf('inspections.insert'));
});
test('signed message binds a private salted commitment and the batch', () => {
  assert.match(source, /pad\(32, "LOT_INSP_SIGN_V2"\), batchId, commitment/);
  assert.match(source, /persistentCommit<Vector<2, Uint<64>>>\(/);
});
test('ledger stores a salted commitment rather than raw values', () => {
  assert.match(source, /inspections: Map<Bytes<32>, Bytes<32>>/);
  assert.doesNotMatch(source, /ledger strength|ledger defectBps|ledger salt/);
});
test('clearance requires previously registered inspection and policy', () => {
  const code = extract('proveClearance');
  assert.match(code, /inspections\.member\(batch\)/);
  assert.match(code, /minimumStrength\.member\(policy\)/);
  assert.match(code, /inspections\.lookup\(batch\) == persistentCommit/);
});
