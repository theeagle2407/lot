/**
 * LOT Build 02 — Local Ledger 9 e2e test.
 * Real transactions on the local dev chain. Never run against public network.
 * Requires successful full Compact compilation (keys/ and zkir/ must exist).
 * Wallet / provider helper files are fetched from midnightntwrk/midnight-examples
 * by scripts/lot-network-setup.sh and remain attributed Apache-2.0 source.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
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

// Explicitly local: the genesis seed is intentionally public on this devnet.
if ((process.env.MIDNIGHT_NETWORK ?? 'local') !== 'local') {
  throw new Error('LOT Build 02 only supports the disposable local devnet.');
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
const strength = 480n;
const defectsBps = 180n;

function equalsUint8(x: Uint8Array, y: Uint8Array) {
  return Buffer.from(x).equals(Buffer.from(y));
}

describe('LOT Ledger 9: actual local deployment and proof transactions', () => {
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
    if (!read) throw new Error(`Contract ${contractAddress} was not found by the indexer`);
    return ledger(ledgerState(read));
  }

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

    const before = await readLedger();
    expect(before.inspections.member(batch)).toBe(false);

    const reportTx = await submitCallTx(providers, {
      compiledContract: compiled,
      contractAddress,
      privateStateId,
      circuitId: 'registerInspection',
      args: [batch, strength, defectsBps, salt],
    });
    logger.info({ txId: reportTx.public.txId }, 'Inspector commitment finalized');
    const inspection = await readLedger();
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
      args: [policy, 450n, 250n],
    });
    logger.info({ txId: policyTx.public.txId }, 'Buyer policy finalized');
    const withPolicy = await readLedger();
    expect(withPolicy.minimumStrength.member(policy)).toBe(true);
    expect(withPolicy.minimumStrength.lookup(policy)).toBe(450n);

    // Invalid opening MUST NOT post a clearance.
    await expect(submitCallTx(providers, {
      compiledContract: compiled,
      contractAddress,
      privateStateId,
      circuitId: 'proveClearance',
      args: [batch, policy, 999n, 0n, salt],
    })).rejects.toThrow();
    expect((await readLedger()).clearances.size()).toBe(0n);

    const clearanceTx = await submitCallTx(providers, {
      compiledContract: compiled,
      contractAddress,
      privateStateId,
      circuitId: 'proveClearance',
      args: [batch, policy, strength, defectsBps, salt],
    });
    logger.info({ txId: clearanceTx.public.txId }, 'Private compliance proof finalized');
    const finalLedger = await readLedger();
    expect(finalLedger.clearances.size()).toBe(1n);
    console.log(`\nLOT LOCAL NETWORK SUCCESS\ncontractAddress=${contractAddress}\ninspection=confirmed\npolicy=confirmed\nclearance=confirmed\n`);
    // Input values are synthetic; this test verifies transactions, not the real inspection process.
  }, 15 * 60_000);
});
