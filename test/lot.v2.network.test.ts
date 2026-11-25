/**
 * LOT Build 15: genuine Ledger 9 transaction proof of V2 signature checks.
 * Uses disposable local devnet and synthetic inputs only. NOT public testnet,
 * not accredited inspector enrollment, and not production credential custody.
 *
 * Independent fee-paying devnet wallets: Alice relays the signed inspection,
 * Bob registers a policy, Charlie submits the private clearance proof.
 * Inspector authorization is the Jubjub signature checked by the contract,
 * not the identity of the wallet submitting the transaction.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import { jubjubSampleScalar, jubjubSchnorrVerifyingKey } from '@midnight-ntwrk/compact-runtime';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import {
  MidnightWalletProvider, resolveWallet, syncWallet, waitForDust,
} from './lot-official/wallet.js';
import { buildProviders, ledgerState } from './lot-official/providers.js';
import { getConfig } from './lot-official/config.js';
import { Contract, ledger } from '../contracts/managed/lot-v2/contract/index.js';
import { v2Witnesses } from '../contracts/witnesses-v2.js';
import { signInspectionV2 } from '../scripts/lot-v2-signing.mjs';
import { waitForIndexedState } from '../scripts/lot-indexer-wait.mjs';

if (process.env.MIDNIGHT_NETWORK !== 'local') {
  throw new Error('V2 transaction test is local-only. Set MIDNIGHT_NETWORK=local.');
}

const logger = pino({ level: process.env.LOG_LEVEL ?? 'warn' });
const zkAssets = fileURLToPath(new URL('../contracts/managed/lot-v2', import.meta.url));
const compiled = CompiledContract.make('LotContractV2', Contract).pipe(
  CompiledContract.withWitnesses(v2Witnesses),
  CompiledContract.withCompiledFileAssets(zkAssets),
);

// Synthetic disposable test fixtures; never display or archive the private data.
const inspectorSigningKey = (() => {
  let key = jubjubSampleScalar();
  while (key === 0n) key = jubjubSampleScalar();
  return key;
})();
const trustedInspectorKey = jubjubSchnorrVerifyingKey(inspectorSigningKey);
const wrongSigningKey = (() => {
  let key = jubjubSampleScalar();
  while (key === 0n || key === inspectorSigningKey) key = jubjubSampleScalar();
  return key;
})();
const policySecret = new Uint8Array(randomBytes(32));
const batchId = new Uint8Array(randomBytes(32));
const policyId = new Uint8Array(randomBytes(32));
const anotherPolicyId = new Uint8Array(randomBytes(32));
const salt = new Uint8Array(randomBytes(32));
const strength = 570n;
const defectBps = 80n;

const roles = ['inspector', 'policyOperator', 'manufacturer'] as const;
type Role = (typeof roles)[number];
type Participant = {
  wallet: MidnightWalletProvider;
  providers: ReturnType<typeof buildProviders>;
  privateStateId: string;
};
const people = new Map<Role, Participant>();
let contractAddress = '';

function participant(role: Role): Participant {
  const value = people.get(role);
  if (!value) throw new Error(`Missing local test participant: ${role}`);
  return value;
}

async function addParticipant(
  role: Role,
  alias: 'ALICE' | 'BOB' | 'CHARLIE',
  env: EnvironmentConfiguration,
  config: ReturnType<typeof getConfig>,
) {
  const wallet = await MidnightWalletProvider.build(logger, env, resolveWallet('local', alias).secret);
  // Store early so afterAll can still stop a wallet if startup throws.
  people.set(role, { wallet, providers: undefined as unknown as ReturnType<typeof buildProviders>, privateStateId: `LOT_V2_${role.toUpperCase()}` });
  await wallet.start();
  await syncWallet(logger, wallet.wallet, 10 * 60_000);
  await waitForDust(logger, wallet.wallet, 1, 180_000, config.indexer);
  people.get(role)!.providers = buildProviders(wallet, zkAssets, config);
  console.log(`LOT V2 WALLET READY: ${role}`);
}

async function queryLedger() {
  if (!contractAddress) return null;
  const state = await participant('inspector').providers.publicDataProvider.queryContractState(contractAddress);
  return state === null ? null : ledger(ledgerState(state));
}

async function indexed(
  check: (value: NonNullable<Awaited<ReturnType<typeof queryLedger>>>) => boolean,
  label: string,
) {
  return waitForIndexedState(queryLedger, check, { label, timeoutMs: 90_000, pollMs: 800 });
}

async function call(role: Role, circuitId: 'registerInspectionSigned' | 'registerPolicy' | 'proveClearance', args: unknown[]) {
  const person = participant(role);
  return submitCallTx(person.providers, {
    compiledContract: compiled,
    contractAddress,
    privateStateId: person.privateStateId,
    circuitId,
    args,
  } as never);
}

describe('LOT Build 15: on-chain Jubjub-inspector authorization', () => {
  beforeAll(async () => {
    const config = getConfig();
    const env: EnvironmentConfiguration = {
      walletNetworkId: config.networkId,
      networkId: config.networkId,
      indexer: config.indexer,
      indexerWS: config.indexerWS,
      node: config.node,
      nodeWS: config.nodeWS,
      faucet: config.faucet,
      proofServer: config.proofServer,
    };
    // Sequential startup is more reliable on small laptops.
    await addParticipant('inspector', 'ALICE', env, config);
    await addParticipant('policyOperator', 'BOB', env, config);
    await addParticipant('manufacturer', 'CHARLIE', env, config);
  }, 15 * 60_000);

  afterAll(async () => {
    for (const role of roles) {
      const p = people.get(role);
      if (p) {
        try { await p.wallet.stop(); }
        catch { console.warn('LOT V2 local wallet cleanup encountered an error.'); }
      }
    }
  });

  it('rejects forged inspector signatures and finalizes only properly signed inspections', async () => {
    const deployed = await deployContract(participant('inspector').providers, {
      compiledContract: compiled,
      privateStateId: participant('inspector').privateStateId,
      initialPrivateState: {},
      args: [trustedInspectorKey, policySecret],
    });
    contractAddress = deployed.deployTxData.public.contractAddress;
    await indexed(() => true, 'V2 deployment');
    console.log('LOT V2: contract deployed');

    // Bob alone receives the policy secret in his private witness state.
    await participant('policyOperator').providers.privateStateProvider.forContract(contractAddress)
      .set(participant('policyOperator').privateStateId, { policyAdminSecret: policySecret });
    await participant('manufacturer').providers.privateStateProvider.forContract(contractAddress)
      .set(participant('manufacturer').privateStateId, {});

    const valid = signInspectionV2(batchId, strength, defectBps, salt, inspectorSigningKey).signature;
    const forged = signInspectionV2(batchId, strength, defectBps, salt, wrongSigningKey).signature;

    // Unauthorized signature cannot register a public inspection commitment.
    await expect(call('manufacturer', 'registerInspectionSigned',
      [batchId, strength, defectBps, salt, forged])).rejects.toThrow();
    expect((await indexed(() => true, 'no invalid signature accepted')).inspections.size()).toBe(0n);

    // Altering signed measurements must also fail before valid registration.
    await expect(call('manufacturer', 'registerInspectionSigned',
      [batchId, strength + 1n, defectBps, salt, valid])).rejects.toThrow();
    expect((await indexed(() => true, 'no altered report accepted')).inspections.size()).toBe(0n);

    const inspection = await call('inspector', 'registerInspectionSigned',
      [batchId, strength, defectBps, salt, valid]);
    const inspected = await indexed(s => s.inspections.member(batchId), 'V2 signed inspection');
    expect(inspected.inspections.size()).toBe(1n);
    expect('strength' in inspected).toBe(false);
    expect('defectBps' in inspected).toBe(false);
    expect('salt' in inspected).toBe(false);
    console.log('LOT V2: inspector-signed commitment finalized');

    // Replay cannot create a second inspection for the same batch.
    await expect(call('inspector', 'registerInspectionSigned',
      [batchId, strength, defectBps, salt, valid])).rejects.toThrow();
    expect((await indexed(() => true, 'inspection replay blocked')).inspections.size()).toBe(1n);

    // Neither inspector nor manufacturer may create buyer policies.
    await expect(call('manufacturer', 'registerPolicy',
      [policyId, 530n, 100n])).rejects.toThrow();
    await expect(call('inspector', 'registerPolicy',
      [policyId, 530n, 100n])).rejects.toThrow();
    expect((await indexed(() => true, 'no unauthorized policy')).minimumStrength.size()).toBe(0n);

    const policy = await call('policyOperator', 'registerPolicy', [policyId, 530n, 100n]);
    await indexed(s => s.minimumStrength.member(policyId), 'V2 buyer policy');
    console.log('LOT V2: buyer policy finalized');

    // A second eligible policy demonstrates a single report can serve buyers.
    const policy2 = await call('policyOperator', 'registerPolicy', [anotherPolicyId, 550n, 90n]);
    await indexed(s => s.minimumStrength.member(anotherPolicyId), 'V2 second policy');

    // Charlie has measurements and opening salt, but no inspector signing key.
    await expect(call('manufacturer', 'proveClearance',
      [batchId, policyId, strength + 1n, defectBps, salt])).rejects.toThrow();
    expect((await indexed(() => true, 'no forged opening')).clearances.size()).toBe(0n);

    const clearance1 = await call('manufacturer', 'proveClearance',
      [batchId, policyId, strength, defectBps, salt]);
    await indexed(s => s.clearances.size() === 1n, 'V2 first clearance');
    const clearance2 = await call('manufacturer', 'proveClearance',
      [batchId, anotherPolicyId, strength, defectBps, salt]);
    const final = await indexed(s => s.clearances.size() === 2n, 'V2 second clearance');
    expect(final.inspections.size()).toBe(1n);
    expect(final.minimumStrength.size()).toBe(2n);
    expect(final.clearances.size()).toBe(2n);
    console.log('\nLOT V2 LOCAL NETWORK SUCCESS');
    console.log(`contractAddress=${contractAddress}`);
    console.log(`inspectionTx=${inspection.public.txId}`);
    console.log(`policyTx=${policy.public.txId}`);
    console.log(`secondPolicyTx=${policy2.public.txId}`);
    console.log(`clearanceTx1=${clearance1.public.txId}`);
    console.log(`clearanceTx2=${clearance2.public.txId}`);
  }, 15 * 60_000);
});
