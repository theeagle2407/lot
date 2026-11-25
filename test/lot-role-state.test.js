import test from 'node:test';
import assert from 'node:assert/strict';
import { splitRoleState, LOT_ROLE_STATE_IDS } from '../scripts/lot-role-state.mjs';

const a = new Uint8Array(32).fill(31);
const b = new Uint8Array(32).fill(67);

test('role secrets are restricted to their own private state', () => {
  const states = splitRoleState(a, b);
  assert.deepEqual(Object.keys(states.inspector), ['inspectorSecret']);
  assert.deepEqual(Object.keys(states.policyOperator), ['policyAdminSecret']);
  assert.deepEqual(Object.keys(states.manufacturer), []);
  assert.deepEqual([...states.inspector.inspectorSecret], [...a]);
  assert.deepEqual([...states.policyOperator.policyAdminSecret], [...b]);
});

test('role secrets are cloned and are not the input buffer', () => {
  const states = splitRoleState(a, b);
  assert.notStrictEqual(states.inspector.inspectorSecret, a);
  assert.notStrictEqual(states.policyOperator.policyAdminSecret, b);
  states.inspector.inspectorSecret[0] = 99;
  assert.equal(a[0], 31);
});

test('same secret cannot authorize both privileged roles', () => {
  assert.throws(() => splitRoleState(a, new Uint8Array(a)), /different secrets/);
});

test('rejects incorrectly sized or encoded credentials', () => {
  assert.throws(() => splitRoleState(new Uint8Array(31), b), /32 bytes/);
  assert.throws(() => splitRoleState(a, 'not-a-secret'), /32 bytes/);
  assert.throws(() => splitRoleState(null, b), /32 bytes/);
});

test('role-specific private-state identifiers remain distinct', () => {
  assert.equal(new Set(Object.values(LOT_ROLE_STATE_IDS)).size, 3);
});
