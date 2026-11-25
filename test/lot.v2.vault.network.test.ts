/** Build 16: actual V2 on-chain proof using an encrypted report and Ed25519-authorized Jubjub key. */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import { jubjubSchnorrVerify } from '@midnight-ntwrk/compact-runtime';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import { MidnightWalletProvider, resolveWallet, syncWallet, waitForDust } from './lot-official/wallet.js';
import { buildProviders, ledgerState } from './lot-official/providers.js';
import { getConfig } from './lot-official/config.js';
import { Contract, ledger } from '../contracts/managed/lot-v2/contract/index.js';
import { v2Witnesses } from '../contracts/witnesses-v2.js';
import { reportSignatureFields, signatureMessageType } from '../scripts/lot-v2-signing.mjs';
import { receiveOneUseV2SignedReport } from '../scripts/lot-v2-vault-bridge.mjs';
import { verifySavedAttestation, loadInspectorPublicPem } from '../scripts/lot-inspector-attestation.mjs';
import { verifyV2Delegation } from '../scripts/lot-v2-delegation.mjs';
import { parseVaultProofArgs, checkPolicyForReport } from '../scripts/lot-vault-bridge.mjs';
import { waitForIndexedState } from '../scripts/lot-indexer-wait.mjs';
import { writeLocalPublicReceipt } from '../scripts/lot-public-receipt.mjs';
if(process.env.MIDNIGHT_NETWORK!=='local')throw new Error('Local devnet only.');
if(!process.env.LOT_V2_VAULT_SOCKET||!process.env.LOT_V2_VAULT_RECEIPT)
  throw new Error('Start this test with npm run vault:prove:v2.');
const policy=parseVaultProofArgs([
  process.env.LOT_V2_VAULT_BATCH,process.env.LOT_V2_VAULT_POLICY,
  process.env.LOT_V2_MIN_STRENGTH,process.env.LOT_V2_MAX_DEFECTS,
]);
const assets=fileURLToPath(new URL('../contracts/managed/lot-v2',import.meta.url));
const compiled=CompiledContract.make('LotContractV2',Contract).pipe(
  CompiledContract.withWitnesses(v2Witnesses),CompiledContract.withCompiledFileAssets(assets),
);
const logger=pino({level:'silent'});
const roles=['inspector','policyOperator','manufacturer'] as const;
type Role=typeof roles[number];
type Person={wallet:MidnightWalletProvider;providers:ReturnType<typeof buildProviders>;stateId:string};
const people=new Map<Role,Person>();
let contractAddress='';
function person(role:Role){const p=people.get(role);if(!p)throw new Error(`Missing wallet: ${role}`);return p;}
function publicId(domain:string,label:string){return new Uint8Array(createHash('sha256').update(domain).update(':').update(label).digest());}
const batchId=publicId('LOT_BATCH_V1',policy.batchId);
const policyId=publicId('LOT_BUYER_POLICY_V1',policy.policyId);
const policySecret=new Uint8Array(randomBytes(32));
async function add(role:Role,alias:'ALICE'|'BOB'|'CHARLIE',env:EnvironmentConfiguration,config:ReturnType<typeof getConfig>){
  const wallet=await MidnightWalletProvider.build(logger,env,resolveWallet('local',alias).secret);
  people.set(role,{wallet,providers:undefined as unknown as ReturnType<typeof buildProviders>,stateId:`LOT_V2_VAULT_${role.toUpperCase()}`});
  await wallet.start();await syncWallet(logger,wallet.wallet,600000);
  await waitForDust(logger,wallet.wallet,1,180000,config.indexer);
  person(role).providers=buildProviders(wallet,assets,config);
}
async function readState(){
  if(!contractAddress)return null;
  const state=await person('inspector').providers.publicDataProvider.queryContractState(contractAddress);
  return state===null?null:ledger(ledgerState(state));
}
async function indexed(check:(s:NonNullable<Awaited<ReturnType<typeof readState>>>)=>boolean,label:string){
  return waitForIndexedState(readState,check,{label,timeoutMs:90000,pollMs:750});
}
async function call(role:Role,circuitId:'registerInspectionSigned'|'registerPolicy'|'proveClearance',args:unknown[]){
  const p=person(role);
  return submitCallTx(p.providers,{compiledContract:compiled,contractAddress,
    privateStateId:p.stateId,circuitId,args} as never);
}
describe('LOT V2 Build 16: signed encrypted-vault report to private clearance',()=>{
  beforeAll(async()=>{
    const c=getConfig();
    const env:EnvironmentConfiguration={walletNetworkId:c.networkId,networkId:c.networkId,indexer:c.indexer,
      indexerWS:c.indexerWS,node:c.node,nodeWS:c.nodeWS,faucet:c.faucet,proofServer:c.proofServer};
    await add('inspector','ALICE',env,c);
    await add('policyOperator','BOB',env,c);
    await add('manufacturer','CHARLIE',env,c);
    console.log('LOT_V2_VAULT_PHASE:WALLETS_READY');
  },15*60_000);
  afterAll(async()=>{for(const p of people.values())try{await p.wallet.stop();}catch{/* cleanup only */}});
  it('checks both inspector authorizations, submits private clearance, archives public IDs only',async()=>{
    const {report,delegation,signature}=await receiveOneUseV2SignedReport(process.env.LOT_V2_VAULT_SOCKET!);
    checkPolicyForReport(report,policy);
    const att=verifySavedAttestation(report);
    const verified=verifyV2Delegation(report,delegation,loadInspectorPublicPem());
    expect(att.inspector).toBe(verified.inspector);
    const strength=BigInt(report.strengthMpa),defects=BigInt(report.defectBps);
    const salt=new Uint8Array(Buffer.from(report.openingSalt,'hex'));
    expect(jubjubSchnorrVerify(signatureMessageType,reportSignatureFields(batchId,strength,defects,salt),
      verified.verifyingKey,signature)).toBe(true);
    const deployed=await deployContract(person('inspector').providers,{
      compiledContract:compiled,privateStateId:person('inspector').stateId,
      initialPrivateState:{},args:[verified.verifyingKey,policySecret],
    });
    contractAddress=deployed.deployTxData.public.contractAddress;
    await indexed(()=>true,'V2 vault deployment');console.log('LOT_V2_VAULT_PHASE:CONTRACT_DEPLOYED');
    await person('policyOperator').providers.privateStateProvider.forContract(contractAddress)
      .set(person('policyOperator').stateId,{policyAdminSecret:policySecret});
    await person('manufacturer').providers.privateStateProvider.forContract(contractAddress)
      .set(person('manufacturer').stateId,{});
    // Attempt to reuse valid signed report with changed readings must fail on chain.
    await expect(call('manufacturer','registerInspectionSigned',[
      batchId,strength+1n,defects,salt,signature,
    ])).rejects.toThrow();
    expect((await indexed(()=>true,'invalid signed report not registered')).inspections.size()).toBe(0n);
    const inspection=await call('inspector','registerInspectionSigned',[
      batchId,strength,defects,salt,signature,
    ]);
    await indexed(s=>s.inspections.member(batchId),'V2 signed vault inspection');
    console.log('LOT_V2_VAULT_PHASE:INSPECTION_FINALIZED');
    const buyer=await call('policyOperator','registerPolicy',[
      policyId,BigInt(policy.minStrength),BigInt(policy.maxDefectsBps),
    ]);
    await indexed(s=>s.minimumStrength.member(policyId),'V2 vault buyer policy');
    console.log('LOT_V2_VAULT_PHASE:POLICY_FINALIZED');
    await expect(call('manufacturer','proveClearance',[
      batchId,policyId,strength+1n,defects,salt,
    ])).rejects.toThrow();
    expect((await indexed(()=>true,'no forged clearance')).clearances.size()).toBe(0n);
    const clearance=await call('manufacturer','proveClearance',[
      batchId,policyId,strength,defects,salt,
    ]);
    const state=await indexed(s=>s.clearances.size()===1n,'V2 signed-vault clearance');
    expect(state.inspections.size()).toBe(1n);
    expect(state.minimumStrength.size()).toBe(1n);
    expect('strength' in state).toBe(false);
    expect('defectBps' in state).toBe(false);
    console.log('LOT_V2_VAULT_PHASE:CLEARANCE_FINALIZED');
    writeLocalPublicReceipt(process.env.LOT_V2_VAULT_RECEIPT!,{
      contractAddress,inspectionTx:inspection.public.txId,policyTx:buyer.public.txId,
      clearanceTx:clearance.public.txId,
    });
    console.log('LOT_V2_VAULT_PHASE:PUBLIC_RECEIPT_SAVED');
  },15*60_000);
});
