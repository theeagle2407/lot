/**
 * Actual generated-Compact in-memory execution tests. They MUST be run only
 * AFTER `npm run compact:compile`; these are NOT mock business-logic tests.
 * Node's test runner will fail if compiled artifacts or runtime are absent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../contracts/managed/lot/contract/index.js';
import { witnesses } from '../contracts/witnesses.mjs';

const COIN = '0'.repeat(64);
const INSPECTOR = new Uint8Array(32).fill(11); // TEST ONLY, not production keys
const ADMIN = new Uint8Array(32).fill(22); // TEST ONLY
const BATCH = new Uint8Array(32).fill(101);
const UNKNOWN_BATCH = new Uint8Array(32).fill(102);
const POLICY_A = new Uint8Array(32).fill(201);
const POLICY_B = new Uint8Array(32).fill(202);
const SALT = new Uint8Array(32).fill(33); // TEST ONLY; production uses cryptographic RNG
const WRONG_SALT = new Uint8Array(32).fill(34);
const READING = [480n, 180n, SALT]; // 480 MPa and 1.80% defects

async function createSim() {
  const privateState = { inspectorSecret: INSPECTOR, policyAdminSecret: ADMIN };
  const contract = new Contract(witnesses);
  const initial = await contract.initialState(
    RT.createConstructorContext(privateState, COIN),
    INSPECTOR,
    ADMIN,
  );
  let state = initial.currentContractState;
  const address = RT.sampleContractAddress();
  return {
    ledger: () => ledger(state),
    async call(circuitId, argumentsArray, privateStateOverride = privateState) {
      const context = RT.createCircuitContext({
        circuitId,
        contractAddress: address,
        coinPublicKeyOrZswapState: COIN,
        contractState: state,
        privateState: privateStateOverride,
      });
      const result = await contract.impureCircuits[circuitId](context, ...argumentsArray);
      state = result.context.callContext.currentQueryContext.state;
      return result;
    },
  };
}

async function withInspectionAndPolicies() {
  const sim = await createSim();
  await sim.call('registerInspection', [BATCH, ...READING]);
  await sim.call('registerPolicy', [POLICY_A, 450n, 250n]);
  await sim.call('registerPolicy', [POLICY_B, 500n, 150n]);
  return sim;
}

test('LOT Compact: authorized inspector can anchor a private inspection', async () => {
  const sim = await createSim();
  await sim.call('registerInspection', [BATCH, ...READING]);
  assert.equal(sim.ledger().inspections.member(BATCH), true);
  // Ledger contains the commitment, not fields named strength or defectBps.
  assert.equal('strength' in sim.ledger(), false);
  assert.equal('defectBps' in sim.ledger(), false);
});

test('LOT Compact: an unauthorized inspector cannot register a report', async () => {
  const sim = await createSim();
  await assert.rejects(() => sim.call('registerInspection', [BATCH, ...READING], {
    inspectorSecret: new Uint8Array(32).fill(99), policyAdminSecret: ADMIN,
  }));
  await sim.call('registerInspection', [BATCH, ...READING]);
  assert.equal(sim.ledger().inspections.member(BATCH), true);
});

test('LOT Compact: an unauthorized policy operator cannot register thresholds', async () => {
  const sim = await createSim();
  await assert.rejects(() => sim.call('registerPolicy', [POLICY_A, 450n, 250n], {
    inspectorSecret: INSPECTOR, policyAdminSecret: new Uint8Array(32).fill(99),
  }));
  await sim.call('registerPolicy', [POLICY_A, 450n, 250n]);
  assert.equal(sim.ledger().minimumStrength.member(POLICY_A), true);
});

test('LOT Compact: one private inspection qualifies against a buyer policy', async () => {
  const sim = await withInspectionAndPolicies();
  // A manufacturer does not need either privileged role key for the proof.
  await sim.call('proveClearance', [BATCH, POLICY_A, ...READING], {});
  // A valid second proof would be permitted for ANOTHER qualifying policy;
  // this stricter second policy does not pass these measurements.
  await assert.rejects(() => sim.call('proveClearance', [BATCH, POLICY_B, ...READING], {}));
});

test('LOT Compact: forged measurements cannot open inspector commitment', async () => {
  const sim = await withInspectionAndPolicies();
  await assert.rejects(() => sim.call('proveClearance', [BATCH, POLICY_A, 800n, 0n, SALT], {}));
});

test('LOT Compact: wrong report salt cannot open inspector commitment', async () => {
  const sim = await withInspectionAndPolicies();
  await assert.rejects(() => sim.call('proveClearance', [BATCH, POLICY_A, 480n, 180n, WRONG_SALT], {}));
});

test('LOT Compact: cannot prove unknown batch or register duplicate batch', async () => {
  const sim = await withInspectionAndPolicies();
  await assert.rejects(() => sim.call('proveClearance', [UNKNOWN_BATCH, POLICY_A, ...READING], {}));
  await assert.rejects(() => sim.call('registerInspection', [BATCH, ...READING]));
});

test('LOT Compact: replaying the same clearance is rejected', async () => {
  const sim = await withInspectionAndPolicies();
  await sim.call('proveClearance', [BATCH, POLICY_A, ...READING], {});
  await assert.rejects(() => sim.call('proveClearance', [BATCH, POLICY_A, ...READING], {}));
});

test('LOT Compact: the same report can qualify for a second, less restrictive buyer', async () => {
  const sim = await withInspectionAndPolicies();
  const POLICY_C = new Uint8Array(32).fill(203);
  await sim.call('registerPolicy', [POLICY_C, 400n, 300n]);
  await sim.call('proveClearance', [BATCH, POLICY_A, ...READING], {});
  await sim.call('proveClearance', [BATCH, POLICY_C, ...READING], {});
});
