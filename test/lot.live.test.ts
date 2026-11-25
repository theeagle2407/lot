/**
 * LOT Build 02 — Local Ledger 9 e2e test.
 * Real transactions on the local dev chain. Never run against public network.
 * Requires successful full Compact compilation (keys/ and zkir/ must exist).
 * Wallet / provider helper files are fetched from midnightntwrk/midnight-examples
 * by scripts/lot-network-setup.sh and remain attributed Apache-2.0 source.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { writeLocalPublicReceipt } from '../scripts/lot-public-receipt.mjs';
import { waitForIndexedState } from '../scripts/lot-indexer-wait.mjs';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import {
  deployContract,
  submitCallTx,
  type DeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import {
  MidnightWalletProvider,
  resolveWallet,
  syncWallet,
  waitForDust,
} from './lot-official/wallet.js';
import { buildProviders, ledgerState } from './lot-official/providers.js';
import { getConfig } from './lot-official/config.js';
import { Contract, ledger } from '../contracts/managed/lot/contract/index.js';
import { witnesses } from '../contracts/witnesses.js';
import { validateNormalizedProofInput } from '../scripts/lot-proof-utils.mjs';

// Explicitly local: the genesis seed is intentionally public on this devnet.
if ((process.env.MIDNIGHT_NETWORK ?? 'local') !== 'local') {
  throw new Error('LOT Build 05 only supports the disposable local devnet.');
}

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const zkConfigPath = fileURLToPath(new URL('../contracts/managed/lot', import.meta.url));
const compiled = CompiledContract.make('LotContract', Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
const privateStateId = 'LOT_LOCAL_PRIVATE_STATE';
const batch = new Uint8Array(randomBytes(32));
const policy = new Uint8Array(randomBytes(32));
const salt = new Uint8Array(randomBytes(32));
const inspectorSecret = new Uint8Array(randomBytes(32));
const policyAdminSecret = new Uint8Array(randomBytes(32));
const privateState = { inspectorSecret, policyAdminSecret };
// This test is started ONLY by the loopback development API.
// Do not use this path against Preview, Preprod or Mainnet.
if (!process.env.LOT_LOCAL_PROOF_PAYLOAD) throw new Error('Local proof request missing. Use npm run proof:serve.');
const demoInput = validateNormalizedProofInput(JSON.parse(process.env.LOT_LOCAL_PROOF_PAYLOAD));
const strength = BigInt(demoInput.strength);
const defectsBps = BigInt(demoInput.defectsBps);
const minStrength = BigInt(demoInput.minStrength);
const maxDefectsBps = BigInt(demoInput.maxDefectsBps);

function equalsUint8(x: Uint8Array, y: Uint8Array) {
  return Buffer.from(x).equals(Buffer.from(y));
}

describe('LOT Build 05: browser-triggered local proof', () => {
  let wallet: MidnightWalletProvider | undefined;
  let providers: ReturnType<typeof buildProviders>;
  let contractAddress: string;

  beforeAll(async () => {
    const config = getConfig();
    const envConfig: EnvironmentConfiguration = {
      walletNetworkId: config.networkId,
      networkId: config.networkId,
      indexer: config.indexer,
      indexerWS: config.indexerWS,
      node: config.node,
      nodeWS: config.nodeWS,
      faucet: config.faucet,
      proofServer: config.proofServer,
    };
    wallet = await MidnightWalletProvider.build(
      logger,
      envConfig,
      resolveWallet('local', 'ALICE').secret,
    );
    await wallet.start();
    await syncWallet(logger, wallet.wallet, 10 * 60_000);
    await waitForDust(logger, wallet.wallet, 1, 180_000, config.indexer);
    providers = buildProviders(wallet, zkConfigPath, config);
  }, 15 * 60_000);

  afterAll(async () => {
    if (wallet) await wallet.stop();
  });

  async function readLedger() {
    const read = await providers.publicDataProvider.queryContractState(contractAddress);
    return read ? ledger(ledgerState(read)) : null;
  }
  // On a finalized transaction, the indexer can still be a few blocks behind.
  // Require the EXPECTED state instead of reading once and treating stale data
  // as a contract failure. This never changes contract rules or weakens assertions.
  const indexed = (predicate: (state: NonNullable<Awaited<ReturnType<typeof readLedger>>>) => boolean, label: string) =>
    waitForIndexedState(readLedger, predicate, { label, timeoutMs: 90_000, pollMs: 750 });

  it('deploys, anchors an inspection, registers a policy, and proves clearance', async () => {
    logger.info('Deploying LOT on the local Midnight network...');
    const deployed: DeployedContract<Contract> = await deployContract(providers, {
      compiledContract: compiled,
      privateStateId,
      initialPrivateState: privateState,
      args: [inspectorSecret, policyAdminSecret],
    });
    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info({ contractAddress }, 'LOT contract deployed and finalized');
    expect(contractAddress.length).toBeGreaterThan(10);

    const before = await indexed(() => true, 'new deployed contract');
    expect(before.inspections.member(batch)).toBe(false);

    const reportTx = await submitCallTx(providers, {
      compiledContract: compiled,
      contractAddress,
      privateStateId,
      circuitId: 'registerInspection',
      args: [batch, strength, defectsBps, salt],
    });
    logger.info({ txId: reportTx.public.txId }, 'Inspector commitment finalized');
    const inspection = await indexed(state => state.inspections.member(batch), 'registered inspection');
    expect(inspection.inspections.member(batch)).toBe(true);
    // The public ledger has the commitment, not raw measurements or a salt field.
    expect('strength' in inspection).toBe(false);
    expect('defectBps' in inspection).toBe(false);
    expect('salt' in inspection).toBe(false);

    const policyTx = await submitCallTx(providers, {
      compiledContract: compiled,
      contractAddress,
      privateStateId,
      circuitId: 'registerPolicy',
      args: [policy, minStrength, maxDefectsBps],
    });
    logger.info({ txId: policyTx.public.txId }, 'Buyer policy finalized');
    const withPolicy = await indexed(state => state.minimumStrength.member(policy), 'buyer policy');
    expect(withPolicy.minimumStrength.member(policy)).toBe(true);
    expect(withPolicy.minimumStrength.lookup(policy)).toBe(minStrength);

    // Invalid opening MUST NOT post a clearance.
    await expect(submitCallTx(providers, {
      compiledContract: compiled,
      contractAddress,
      privateStateId,
      circuitId: 'proveClearance',
      args: [batch, policy, strength + 1n, defectsBps, salt],
    })).rejects.toThrow();
    const afterForgery = await indexed(state => state.clearances.size() === 0n, 'no forged clearance');
    expect(afterForgery.clearances.size()).toBe(0n);

    const clearanceTx = await submitCallTx(providers, {
      compiledContract: compiled,
      contractAddress,
      privateStateId,
      circuitId: 'proveClearance',
      args: [batch, policy, strength, defectsBps, salt],
    });
    logger.info({ txId: clearanceTx.public.txId }, 'Private compliance proof finalized');
    const finalLedger = await indexed(state => state.clearances.size() === 1n, 'finalized clearance');
    expect(finalLedger.clearances.size()).toBe(1n);
    // Reuse the SAME inspector report and deployed contract for each additional
    // qualifying buyer. No new inspection or deployment is created here.
    const additional: Array<{policyLabel:string,minStrength:number,maxDefectsBps:number,policyTx:string,clearanceTx:string}> = [];
    for (const [i, extra] of (demoInput.extraPolicies ?? []).entries()) {
      const nextPolicy = new Uint8Array(randomBytes(32));
      const nextPolicyTx = await submitCallTx(providers, {
        compiledContract: compiled,
        contractAddress,
        privateStateId,
        circuitId: 'registerPolicy',
        args: [nextPolicy, BigInt(extra.minStrength), BigInt(extra.maxDefectsBps)],
      });
      await indexed(state => state.minimumStrength.member(nextPolicy), `buyer ${i+2} policy`);
      const nextClearanceTx = await submitCallTx(providers, {
        compiledContract: compiled,
        contractAddress,
        privateStateId,
        circuitId: 'proveClearance',
        args: [batch, nextPolicy, strength, defectsBps, salt],
      });
      await indexed(state => state.clearances.size() === BigInt(i+2), `buyer ${i+2} clearance`);
      additional.push({
        policyLabel:extra.policyLabel,
        minStrength:extra.minStrength,
        maxDefectsBps:extra.maxDefectsBps,
        policyTx:nextPolicyTx.public.txId,
        clearanceTx:nextClearanceTx.public.txId,
      });
      logger.info({buyer:extra.policyLabel}, 'Additional buyer clearance finalized');
    }
    const completed=await indexed(state => state.clearances.size()===BigInt(1+additional.length), 'final buyer clearances');
    expect(completed.inspections.size()).toBe(1n);
    expect(completed.clearances.size()).toBe(BigInt(1+additional.length));
    // Output ONLY public chain identifiers to an API-owned temporary file.
    // We do not rely on chunked or decorated Vitest stdout for verification.
    const publicFile=process.env.LOT_PUBLIC_RECEIPT_FILE;
    if(!publicFile)throw new Error('Local receipt file path missing. Use npm run proof:serve.');
    writeLocalPublicReceipt(publicFile, {
      contractAddress,
      inspectionTx: reportTx.public.txId,
      policyTx: policyTx.public.txId,
      clearanceTx: clearanceTx.public.txId,
      additional,
    });
    logger.info('Public-only local transaction receipt saved');
    // Input values are synthetic; this test verifies transactions, not the real inspection process.
  }, 15 * 60_000);
});
