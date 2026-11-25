/**
 * LOT Build 10 — real inspector, buyer-policy and manufacturer wallet calls
 * using ONE encrypted report opened through the local, one-use vault bridge.
 * NEVER deploy to public networks. Synthetic local development only.
 * Passphrase and witness material are never written to this test's logs/files.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
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
import { receiveOneUsePrivateReport, parseVaultProofArgs, checkPolicyForReport } from '../scripts/lot-vault-bridge.mjs';
import { writeLocalPublicReceipt } from '../scripts/lot-public-receipt.mjs';

if (process.env.MIDNIGHT_NETWORK !== 'local') throw new Error('LOT vault proof: local network only.');
const socket=process.env.LOT_VAULT_PRIVATE_SOCKET;
const receiptFile=process.env.LOT_VAULT_RECEIPT_PATH;
if (!socket || !receiptFile) throw new Error('LOT vault proof: start with npm run vault:prove.');
const policy=parseVaultProofArgs([
  process.env.LOT_VAULT_BATCH_ID,
  process.env.LOT_VAULT_POLICY_ID,
  process.env.LOT_VAULT_MIN_STRENGTH,
  process.env.LOT_VAULT_MAX_DEFECTS_BPS,
]);

const logger=pino({level: 'silent'});
const assets=fileURLToPath(new URL('../contracts/managed/lot',import.meta.url));
const compiled=CompiledContract.make('LotContract',Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(assets),
);
// These are disposable devnet credentials, NEVER real institutional identities.
const inspectorSecret=new Uint8Array(randomBytes(32));
const policySecret=new Uint8Array(randomBytes(32));
const roleState=splitRoleState(inspectorSecret,policySecret);

type Role='inspector'|'policyOperator'|'manufacturer';
type Participant={
  wallet:MidnightWalletProvider;
  providers:ReturnType<typeof buildProviders>;
  stateId:string;
};
const participants=new Map<Role,Participant>();
let contractAddress='';

function member(role:Role) {
  const found=participants.get(role);
  if(!found) throw new Error(`Missing local role ${role}`);
  return found;
}
const hashPublicId=(domain:string,label:string)=>new Uint8Array(
  createHash('sha256').update(domain,'utf8').update(':').update(label,'utf8').digest(),
);
const batchId=hashPublicId('LOT_BATCH_V1',policy.batchId);
const buyerId=hashPublicId('LOT_BUYER_POLICY_V1',policy.policyId);
async function state() {
  if(!contractAddress)return null;
  const read=await member('inspector').providers.publicDataProvider.queryContractState(contractAddress);
  return read ? ledger(ledgerState(read)) : null;
}
const indexed=(predicate:(s:NonNullable<Awaited<ReturnType<typeof state>>>)=>boolean,label:string)=>
  waitForIndexedState(state,predicate,{label,timeoutMs:90000,pollMs:750});

async function register(role:Role,alias:'ALICE'|'BOB'|'CHARLIE',env:EnvironmentConfiguration, config:ReturnType<typeof getConfig>) {
  const wallet=await MidnightWalletProvider.build(logger,env,resolveWallet('local',alias).secret);
  participants.set(role,{wallet,providers:undefined as unknown as ReturnType<typeof buildProviders>,stateId:LOT_ROLE_STATE_IDS[role]});
  await wallet.start();
  await syncWallet(logger,wallet.wallet,600_000);
  await waitForDust(logger,wallet.wallet,1,180_000,config.indexer);
  member(role).providers=buildProviders(wallet,assets,config);
}
async function call(role:Role, circuitId:'registerInspection'|'registerPolicy'|'proveClearance', args:unknown[]){
  const p=member(role);
  return submitCallTx(p.providers,{
    compiledContract:compiled,contractAddress,privateStateId:p.stateId,circuitId,args,
  } as never);
}

describe('LOT Build 10: encrypted report to genuine local chain proof',()=>{
  beforeAll(async()=>{
    const config=getConfig();
    const env:EnvironmentConfiguration={
      walletNetworkId:config.networkId,networkId:config.networkId,
      indexer:config.indexer,indexerWS:config.indexerWS,
      node:config.node,nodeWS:config.nodeWS,
      faucet:config.faucet,proofServer:config.proofServer,
    };
    for(const [role,alias] of [
      ['inspector','ALICE'],['policyOperator','BOB'],['manufacturer','CHARLIE'],
    ] as const)await register(role,alias,env,config);
    console.log('LOT_VAULT_PHASE:WALLETS_READY');
  },15*60_000);
  afterAll(async()=>{
    for(const p of participants.values()){
      try{await p.wallet.stop();}catch{/* local cleanup only */}
    }
  });
  it('uses saved private measurements for inspector commitment and manufacturer clearance',async()=>{
    const report=await receiveOneUsePrivateReport(socket);
    checkPolicyForReport(report,policy);
    const strength=BigInt(report.strengthMpa);
    const defectBps=BigInt(report.defectBps);
    const salt=new Uint8Array(Buffer.from(report.openingSalt,'hex'));

    const deployed=await deployContract(member('inspector').providers,{
      compiledContract:compiled,
      privateStateId:member('inspector').stateId,
      initialPrivateState:roleState.inspector,
      args:[inspectorSecret,policySecret],
    });
    contractAddress=deployed.deployTxData.public.contractAddress;
    await indexed(()=>true,'deployed LOT contract');
    console.log('LOT_VAULT_PHASE:CONTRACT_DEPLOYED');

    await member('policyOperator').providers.privateStateProvider.forContract(contractAddress)
      .set(member('policyOperator').stateId,roleState.policyOperator);
    await member('manufacturer').providers.privateStateProvider.forContract(contractAddress)
      .set(member('manufacturer').stateId,roleState.manufacturer);

    const inspection=await call('inspector','registerInspection',[batchId,strength,defectBps,salt]);
    await indexed(s=>s.inspections.member(batchId),'vault inspection commitment');
    console.log('LOT_VAULT_PHASE:INSPECTION_FINALIZED');

    const buyerPolicy=await call('policyOperator','registerPolicy',[
      buyerId,BigInt(policy.minStrength),BigInt(policy.maxDefectsBps),
    ]);
    await indexed(s=>s.minimumStrength.member(buyerId),'vault buyer policy');
    console.log('LOT_VAULT_PHASE:POLICY_FINALIZED');

    // The manufacturer's attempt to open the inspector commitment with
    // different measurements MUST fail, and must not record clearance.
    await expect(call('manufacturer','proveClearance',[
      batchId,buyerId,strength+1n,defectBps,salt,
    ])).rejects.toThrow();
    const before=await indexed(s=>s.clearances.size()===0n,'no forged vault clearance');
    expect(before.clearances.size()).toBe(0n);

    const cleared=await call('manufacturer','proveClearance',[
      batchId,buyerId,strength,defectBps,salt,
    ]);
    const final=await indexed(s=>s.inspections.member(batchId) && s.minimumStrength.member(buyerId) && s.clearances.size()===1n,'vault-backed clearance');
    expect(final.inspections.size()).toBe(1n);
    expect(final.minimumStrength.size()).toBe(1n);
    expect(final.clearances.size()).toBe(1n);
    console.log('LOT_VAULT_PHASE:CLEARANCE_FINALIZED');

    writeLocalPublicReceipt(receiptFile,{
      contractAddress,
      inspectionTx:inspection.public.txId,
      policyTx:buyerPolicy.public.txId,
      clearanceTx:cleared.public.txId,
    });
    console.log('LOT_VAULT_PHASE:PUBLIC_RECEIPT_SAVED');
    // Never log the report body, salt, private keys or proof data.
  },15*60_000);
});
