/**
 * Build 14 actual generated-contract simulator security tests.
 * These MUST NOT be counted as passed until executed on the compiled V2 output.
 * All signing keys, records and salts are synthetic test fixtures.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as RT from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../contracts/managed/lot-v2/contract/index.js';
import {
  reportSignatureDigest,
  reportSignatureFields,
  signInspectionV2,
  signatureMessageType,
} from '../scripts/lot-v2-signing.mjs';

const COIN = '0'.repeat(64);
const INSPECTOR_SIGNING_KEY = 11n; // disposable fixture; NEVER reuse for real reports
const UNTRUSTED_SIGNING_KEY = 17n;
const ADMIN = new Uint8Array(32).fill(22);
const WRONG_ADMIN = new Uint8Array(32).fill(23);
const BATCH = new Uint8Array(32).fill(101);
const SECOND_BATCH = new Uint8Array(32).fill(102);
const POLICY = new Uint8Array(32).fill(201);
const SECOND_POLICY = new Uint8Array(32).fill(202);
const SALT = new Uint8Array(32).fill(33);
const WRONG_SALT = new Uint8Array(32).fill(34);
const STRENGTH = 570n;
const DEFECTS = 80n;
const READING = [STRENGTH, DEFECTS, SALT];
const inspectorKey = RT.jubjubSchnorrVerifyingKey(INSPECTOR_SIGNING_KEY);

function sign(batchId = BATCH, strength = STRENGTH, defects = DEFECTS, salt = SALT, secret = INSPECTOR_SIGNING_KEY) {
  return signInspectionV2(batchId, strength, defects, salt, secret).signature;
}

async function createSim() {
  const privateState = { policyAdminSecret: ADMIN };
  const contract = new Contract({
    localPolicyAdminSecret: ({ privateState: ps }) => [ps, ps.policyAdminSecret ?? new Uint8Array(32)],
  });
  const initial = await contract.initialState(
    RT.createConstructorContext(privateState, COIN),
    inspectorKey,
    ADMIN,
  );
  let state = initial.currentContractState;
  const address = RT.sampleContractAddress();
  return {
    ledger: () => ledger(state),
    async call(circuitId, args, privateStateOverride = privateState) {
      const context = RT.createCircuitContext({
        circuitId,
        contractAddress: address,
        coinPublicKeyOrZswapState: COIN,
        contractState: state,
        privateState: privateStateOverride,
      });
      const result = await contract.impureCircuits[circuitId](context, ...args);
      state = result.context.callContext.currentQueryContext.state;
      return result;
    },
  };
}

const register = (sim, batch = BATCH, strength = STRENGTH, defects = DEFECTS, salt = SALT, signature = sign(batch, strength, defects, salt)) =>
  sim.call('registerInspectionSigned', [batch, strength, defects, salt, signature]);

// Tests call the real generated Compact contract; no JS mock of signature checks.
test('V2 host signing uses the generated Compact digest and verifies correctly', () => {
  const digest = reportSignatureDigest(BATCH, ...READING);
  assert.equal(digest.length, 32);
  const signature = sign();
  const message = reportSignatureFields(BATCH, ...READING);
  assert.equal(message.length, 1);
  assert.equal(typeof message[0], 'bigint');
  assert.equal(message[0], RT.degradeToTransient(digest));
  assert.equal(RT.jubjubSchnorrVerify(signatureMessageType, message, inspectorKey, signature), true);
  assert.equal(RT.jubjubSchnorrVerify(signatureMessageType, message, inspectorKey,
    sign(BATCH, STRENGTH, DEFECTS, SALT, UNTRUSTED_SIGNING_KEY)), false);
});

test('V2 rejects old byte-typed signatures that do not match the circuit Field transcript', async () => {
  const sim = await createSim();
  const digest = reportSignatureDigest(BATCH, ...READING);
  const oldType = new RT.CompactTypeVector(1, new RT.CompactTypeBytes(32));
  const oldSignature = RT.jubjubSchnorrSign(oldType, [digest], INSPECTOR_SIGNING_KEY);
  assert.equal(RT.jubjubSchnorrVerify(oldType, [digest], inspectorKey, oldSignature), true);
  await assert.rejects(
    () => register(sim, BATCH, STRENGTH, DEFECTS, SALT, oldSignature),
    /Invalid inspector signature/
  );
  await register(sim);
});

test('V2 accepts inspector signature, registers only a commitment', async () => {
  const sim = await createSim();
  await register(sim);
  assert.equal(sim.ledger().inspections.member(BATCH), true);
  assert.equal('strength' in sim.ledger(), false);
  assert.equal('defectBps' in sim.ledger(), false);
  assert.equal('salt' in sim.ledger(), false);
});

test('V2 rejects signature by another inspector, then accepts authorized retry', async () => {
  const sim = await createSim();
  await assert.rejects(() => register(sim, BATCH, STRENGTH, DEFECTS, SALT,
    sign(BATCH, STRENGTH, DEFECTS, SALT, UNTRUSTED_SIGNING_KEY)));
  await register(sim);
  assert.equal(sim.ledger().inspections.member(BATCH), true);
});

test('V2 rejects changing measurements after inspector signature', async () => {
  const sim = await createSim();
  await assert.rejects(() => register(sim, BATCH, STRENGTH + 1n, DEFECTS, SALT,
    sign(BATCH, STRENGTH, DEFECTS, SALT)));
  await register(sim);
});

test('V2 rejects changing salt after inspector signature', async () => {
  const sim = await createSim();
  await assert.rejects(() => register(sim, BATCH, STRENGTH, DEFECTS, WRONG_SALT,
    sign(BATCH, STRENGTH, DEFECTS, SALT)));
  await register(sim);
});

test('V2 rejects replay of signature for a different batch', async () => {
  const sim = await createSim();
  await assert.rejects(() => register(sim, SECOND_BATCH, STRENGTH, DEFECTS, SALT,
    sign(BATCH, STRENGTH, DEFECTS, SALT)));
  await register(sim);
});

test('V2 rejects registering the same inspection twice', async () => {
  const sim = await createSim();
  await register(sim);
  await assert.rejects(() => register(sim));
});

test('V2 accepts authorized policy and rejects unauthorized policy operator', async () => {
  const sim = await createSim();
  await register(sim);
  await assert.rejects(() => sim.call('registerPolicy', [POLICY, 530n, 100n], { policyAdminSecret: WRONG_ADMIN }));
  await sim.call('registerPolicy', [POLICY, 530n, 100n]);
  assert.equal(sim.ledger().minimumStrength.member(POLICY), true);
});

test('V2 proves a compliant reading without exposing measurements in ledger', async () => {
  const sim = await createSim();
  await register(sim);
  await sim.call('registerPolicy', [POLICY, 530n, 100n]);
  await sim.call('registerPolicy', [SECOND_POLICY, 550n, 90n]);
  await sim.call('proveClearance', [BATCH, POLICY, ...READING], {});
  await sim.call('proveClearance', [BATCH, SECOND_POLICY, ...READING], {});
  assert.equal('strength' in sim.ledger(), false);
});

test('V2 rejects fake opening, failing policy and repeated clearance', async () => {
  const sim = await createSim();
  await register(sim);
  await sim.call('registerPolicy', [POLICY, 530n, 100n]);
  await sim.call('registerPolicy', [SECOND_POLICY, 600n, 50n]);
  await assert.rejects(() => sim.call('proveClearance', [BATCH, POLICY, 900n, 0n, SALT], {}));
  await assert.rejects(() => sim.call('proveClearance', [BATCH, SECOND_POLICY, ...READING], {}));
  await sim.call('proveClearance', [BATCH, POLICY, ...READING], {});
  await assert.rejects(() => sim.call('proveClearance', [BATCH, POLICY, ...READING], {}));
});
