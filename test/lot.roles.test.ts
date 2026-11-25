/**
 * LOT Build 08 — three real, distinct local wallets using the already tested
 * Ledger 9 contract. This tests role-secret isolation with on-chain calls.
 * It does NOT bind roles to public wallet addresses or authenticate an actual
 * industrial testing laboratory. Not a production credential system.
 *
 * Only for disposable local devnet. No secrets or measurements are logged.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import {
  MidnightWalletProvider, resolveWallet, syncWallet, waitForDust,
} from './lot-official/wallet.js';
import { buildProviders, ledgerState } from './lot-official/providers.js';
import { getConfig } from './lot-official/config.js';
import { Contract, ledger } from '../contracts/managed/lot/contract/index.js';
import { witnesses } from '../contracts/witnesses.js';
import { splitRoleState, LOT_ROLE_STATE_IDS } from '../scripts/lot-role-state.mjs';
import { waitForIndexedState } from '../scripts/lot-indexer-wait.mjs';

if (process.env.MIDNIGHT_NETWORK !== 'local') {
  throw new Error('LOT role integration is local-only: MIDNIGHT_NETWORK=local is required.');
}

const logger = pino({ level: process.env.LOG_LEVEL ?? 'warn' });
const zkAssets = fileURLToPath(new URL('../contracts/managed/lot', import.meta.url));
const compiled = CompiledContract.make('LotContract', Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkAssets),
);
const inspectorSecret = new Uint8Array(randomBytes(32));
const policySecret = new Uint8Array(randomBytes(32));
const separated = splitRoleState(inspectorSecret, policySecret);

const batchId = new Uint8Array(randomBytes(32));
const policyId = new Uint8Array(randomBytes(32));
const reportSalt = new Uint8Array(randomBytes(32));
const strength = 570n;
const defectBps = 80n;
const minimumStrength = 530n;
const maximumDefectsBps = 100n;

type Participant = {
  wallet: MidnightWalletProvider;
  providers: ReturnType<typeof buildProviders>;
  privateStateId: string;
};

// Three independent seed-derived wallets. Alice anchors inspections;
// Bob records public buyer requirements; Charlie proves the report opening.
const participants = new Map<'inspector' | 'policyOperator' | 'manufacturer', Participant>();
let contractAddress = '';

async function registerParticipant(
  role: 'inspector' | 'policyOperator' | 'manufacturer',
  walletAlias: 'ALICE' | 'BOB' | 'CHARLIE',
  env: EnvironmentConfiguration,
  config: ReturnType<typeof getConfig>,
): Promise<void> {
  const wallet = await MidnightWalletProvider.build(
    logger,
    env,
    resolveWallet('local', walletAlias).secret,
  );
  participants.set(role, {
    wallet,
    // Build providers after the wallet is started to keep each account's
    // private-state storage and fee-paying wallet separate.
    providers: undefined as unknown as ReturnType<typeof buildProviders>,
    privateStateId: LOT_ROLE_STATE_IDS[role],
  });
  await wallet.start();
  await syncWallet(logger, wallet.wallet, 10 * 60_000);
  await waitForDust(logger, wallet.wallet, 1, 180_000, config.indexer);
  participants.get(role)!.providers = buildProviders(wallet, zkAssets, config);
  console.log(`LOT ROLE READY: ${role}`);
}

async function readLedger() {
  const provider = participants.get('inspector')!.providers.publicDataProvider;
  if (!contractAddress) return null;
  const state = await provider.queryContractState(contractAddress);
  return state === null ? null : ledger(ledgerState(state));
}

const indexed = (check: (state: NonNullable<Awaited<ReturnType<typeof readLedger>>>) => boolean, name: string) =>
  waitForIndexedState(readLedger, check, { label: name, timeoutMs: 90_000, pollMs: 800 });

function person(role: 'inspector' | 'policyOperator' | 'manufacturer') {
  const p = participants.get(role);
  if (!p) throw new Error(`Missing ${role} provider`);
  return p;
}

async function submit(
  role: 'inspector' | 'policyOperator' | 'manufacturer',
  circuitId: 'registerInspection' | 'registerPolicy' | 'proveClearance',
  args: unknown[],
) {
  const p = person(role);
  // Cast only the argument union here: generated Compact signatures are
  // enforced by the corresponding simulator tests and by the real circuit.
  return submitCallTx(p.providers, {
    compiledContract: compiled,
    contractAddress,
    privateStateId: p.privateStateId,
    circuitId,
    args,
  } as never);
}

describe('LOT Build 08: independent-wallet role separation on local Midnight', () => {
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
    // Avoid running three syncing wallets simultaneously on small laptops.
    await registerParticipant('inspector', 'ALICE', env, config);
    await registerParticipant('policyOperator', 'BOB', env, config);
    await registerParticipant('manufacturer', 'CHARLIE', env, config);
  }, 15 * 60_000);

  afterAll(async () => {
    // Always close every wallet even if the network test fails halfway.
    const failures: unknown[] = [];
    for (const p of participants.values()) {
      try { await p.wallet.stop(); } catch (err) { failures.push(err); }
    }
    if (failures.length) console.warn('LOT: a local wallet did not close normally.');
  });

  it('enforces isolated inspector/operator secrets while a separate manufacturer proves compliance', async () => {
    const deployed = await deployContract(person('inspector').providers, {
      compiledContract: compiled,
      privateStateId: person('inspector').privateStateId,
      // The local setup process bootstraps both role commitments in the
      // constructor. Only the inspector secret is stored in Alice's state.
      initialPrivateState: separated.inspector,
      args: [inspectorSecret, policySecret],
    });
    contractAddress = deployed.deployTxData.public.contractAddress;
    await indexed(() => true, 'three-wallet deployment');

    // The other wallets load only their own role-specific state.
    await person('policyOperator').providers.privateStateProvider.forContract(contractAddress)
      .set(person('policyOperator').privateStateId, separated.policyOperator);
    await person('manufacturer').providers.privateStateProvider.forContract(contractAddress)
      .set(person('manufacturer').privateStateId, separated.manufacturer);

    // Missing inspector secret must prevent manufacturer and policy operator
    // from anchoring measurements. Neither failed call changes public state.
    await expect(submit('manufacturer', 'registerInspection', [batchId, strength, defectBps, reportSalt]))
      .rejects.toThrow();
    await expect(submit('policyOperator', 'registerInspection', [batchId, strength, defectBps, reportSalt]))
      .rejects.toThrow();
    expect((await indexed(() => true, 'no unauthorized inspection')).inspections.size()).toBe(0n);

    const inspection = await submit('inspector', 'registerInspection', [batchId, strength, defectBps, reportSalt]);
    await indexed(state => state.inspections.member(batchId), 'authorized inspection');
    console.log('LOT ROLE: inspector commitment finalized');

    // Missing policy secret must prevent the other two wallets from setting
    // requirements, including the very inspector who recorded the report.
    await expect(submit('manufacturer', 'registerPolicy', [policyId, minimumStrength, maximumDefectsBps]))
      .rejects.toThrow();
    await expect(submit('inspector', 'registerPolicy', [policyId, minimumStrength, maximumDefectsBps]))
      .rejects.toThrow();
    expect((await indexed(() => true, 'no unauthorized policy')).minimumStrength.size()).toBe(0n);

    const policy = await submit('policyOperator', 'registerPolicy', [policyId, minimumStrength, maximumDefectsBps]);
    await indexed(state => state.minimumStrength.member(policyId), 'authorized buyer policy');
    console.log('LOT ROLE: policy operator finalized');

    // Manufacturer knows the report measurements and opening salt, but NOT
    // the inspector or policy-admin secret. A forged opening cannot pass.
    await expect(submit('manufacturer', 'proveClearance', [batchId, policyId, strength + 1n, defectBps, reportSalt]))
      .rejects.toThrow();
    expect((await indexed(() => true, 'no forged manufacturer proof')).clearances.size()).toBe(0n);

    const clearance = await submit('manufacturer', 'proveClearance', [batchId, policyId, strength, defectBps, reportSalt]);
    const final = await indexed(state => state.clearances.size() === 1n, 'manufacturer clearance');
    expect(final.inspections.size()).toBe(1n);
    expect(final.minimumStrength.size()).toBe(1n);
    expect(final.clearances.size()).toBe(1n);

    // Only public IDs printed; report values, salt and role secrets stay out.
    console.log('LOT THREE-WALLET LOCAL SUCCESS');
    console.log(`contractAddress=${contractAddress}`);
    console.log(`inspectorTx=${inspection.public.txId}`);
    console.log(`policyTx=${policy.public.txId}`);
    console.log(`manufacturerClearanceTx=${clearance.public.txId}`);
  }, 15 * 60_000);
});
