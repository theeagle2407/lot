/** Build 17: actual local V2 contract reuse across separate CLI invocations. */
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {writeFileSync} from 'node:fs';
import pino from 'pino';
import {deployContract,submitCallTx} from '@midnight-ntwrk/midnight-js-contracts';
import {CompiledContract} from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import {jubjubSchnorrVerify} from '@midnight-ntwrk/compact-runtime';
import type {EnvironmentConfiguration} from '@midnight-ntwrk/testkit-js';
import {MidnightWalletProvider,resolveWallet,syncWallet,waitForDust} from './lot-official/wallet.js';
import {buildProviders,ledgerState} from './lot-official/providers.js';
import {getConfig} from './lot-official/config.js';
import {Contract,ledger} from '../contracts/managed/lot-v2/contract/index.js';
import {v2Witnesses} from '../contracts/witnesses-v2.js';
import {reportSignatureFields,signatureMessageType} from '../scripts/lot-v2-signing.mjs';
import {receiveSessionBridge} from '../scripts/lot-v2-session-bridge.mjs';
import {verifySavedAttestation,loadInspectorPublicPem} from '../scripts/lot-inspector-attestation.mjs';
import {verifyV2Delegation} from '../scripts/lot-v2-delegation.mjs';
import {parseVaultProofArgs,checkPolicyForReport} from '../scripts/lot-vault-bridge.mjs';
import {waitForIndexedState} from '../scripts/lot-indexer-wait.mjs';
import {writeLocalPublicReceipt} from '../scripts/lot-public-receipt.mjs';
if(process.env.MIDNIGHT_NETWORK!=='local')throw new Error('Session test is local-only.');
const mode=process.env.LOT_V2_SESSION_MODE;
if(!['init','prove'].includes(String(mode))||!process.env.LOT_V2_SESSION_SOCKET||!process.env.LOT_V2_SESSION_RECEIPT)throw new Error('Start using npm run vault:session:v2.');
const batchLabel=process.env.LOT_V2_SESSION_BATCH!;
if(!/^LOT-[A-Z0-9-]{1,48}$/.test(batchLabel))throw new Error('Invalid session batch.');
const policy=mode==='prove'?parseVaultProofArgs([batchLabel,process.env.LOT_V2_SESSION_POLICY!,process.env.LOT_V2_SESSION_MIN!,process.env.LOT_V2_SESSION_MAX!]):null;
const storedAddress=mode==='prove'?process.env.LOT_V2_SESSION_ADDRESS!:'';
const inspectionTx=mode==='prove'?process.env.LOT_V2_SESSION_INSPECTION!:'';
if(mode==='prove'&&(!/^[0-9a-f]{64}$/.test(storedAddress)||!/^[0-9a-f]{66}$/.test(inspectionTx)))throw new Error('Invalid saved session chain identifiers.');
const assets=fileURLToPath(new URL('../contracts/managed/lot-v2',import.meta.url));
const compiled=CompiledContract.make('LotContractV2',Contract).pipe(CompiledContract.withWitnesses(v2Witnesses),CompiledContract.withCompiledFileAssets(assets));
const logger=pino({level:'silent'});
type Role='inspector'|'policyOperator'|'manufacturer';
type Person={wallet:MidnightWalletProvider;providers:ReturnType<typeof buildProviders>;stateId:string};
const participants=new Map<Role,Person>();
let address=storedAddress;
function person(role:Role){const p=participants.get(role);if(!p)throw new Error('Local wallet missing: '+role);return p;}
function digestId(domain:string,label:string){return new Uint8Array(createHash('sha256').update(domain).update(':').update(label).digest());}
const batchId=digestId('LOT_BATCH_V1',batchLabel);
async function setup(role:Role,alias:'ALICE'|'BOB'|'CHARLIE',env:EnvironmentConfiguration,config:ReturnType<typeof getConfig>){
 const wallet=await MidnightWalletProvider.build(logger,env,resolveWallet('local',alias).secret);
 const p:Person={wallet,providers:undefined as unknown as ReturnType<typeof buildProviders>,stateId:`LOT_V2_SESSION_${role.toUpperCase()}`};
 participants.set(role,p);await wallet.start();await syncWallet(logger,wallet.wallet,600000);
 await waitForDust(logger,wallet.wallet,1,180000,config.indexer);
 p.providers=buildProviders(wallet,assets,config);
}
function viewer(){return mode==='init'?person('inspector'):person('policyOperator');}
async function ledgerRead(){if(!address)return null;const raw=await viewer().providers.publicDataProvider.queryContractState(address);return raw===null?null:ledger(ledgerState(raw));}
async function indexed(check:(state:NonNullable<Awaited<ReturnType<typeof ledgerRead>>>)=>boolean,label:string){return waitForIndexedState(ledgerRead,check,{label,timeoutMs:90000,pollMs:750});}
async function submit(role:Role,circuitId:'registerInspectionSigned'|'registerPolicy'|'proveClearance',args:unknown[]){const p=person(role);return submitCallTx(p.providers,{compiledContract:compiled,contractAddress:address,privateStateId:p.stateId,circuitId,args} as never);}
describe('LOT V2: encrypted session and reusable contract',()=>{
 beforeAll(async()=>{
  const c=getConfig();const env:EnvironmentConfiguration={walletNetworkId:c.networkId,networkId:c.networkId,indexer:c.indexer,indexerWS:c.indexerWS,node:c.node,nodeWS:c.nodeWS,faucet:c.faucet,proofServer:c.proofServer};
  if(mode==='init')await setup('inspector','ALICE',env,c);
  else{await setup('policyOperator','BOB',env,c);await setup('manufacturer','CHARLIE',env,c);}
  console.log('LOT_V2_SESSION_PHASE:READY');
 },15*60_000);
 afterAll(async()=>{for(const p of participants.values())try{await p.wallet.stop();}catch{/* local cleanup */}});
 it(mode==='init'?'registers signed inspection on a persistent contract':'uses the existing V2 contract for a new buyer',async()=>{
  const data=await receiveSessionBridge(process.env.LOT_V2_SESSION_SOCKET!);
  expect(data.mode).toBe(mode);
  expect(data.report.batchId).toBe(batchLabel);
  const report=data.report,strength=BigInt(report.strengthMpa),defect=BigInt(report.defectBps);
  const salt=new Uint8Array(Buffer.from(report.openingSalt,'hex'));
  verifySavedAttestation(report);
  const policySecret=new Uint8Array(Buffer.from(data.adminSecret,'hex'));
  if(mode==='init'){
   const trusted=verifyV2Delegation(report,data.delegation,loadInspectorPublicPem());
   expect(jubjubSchnorrVerify(signatureMessageType,reportSignatureFields(batchId,strength,defect,salt),trusted.verifyingKey,data.signature)).toBe(true);
   const deployed=await deployContract(person('inspector').providers,{compiledContract:compiled,privateStateId:person('inspector').stateId,initialPrivateState:{},args:[trusted.verifyingKey,policySecret]});
   address=deployed.deployTxData.public.contractAddress;
   await indexed(()=>true,'V2 persistent contract');console.log('LOT_V2_SESSION_PHASE:DEPLOYED');
   const tx=await submit('inspector','registerInspectionSigned',[batchId,strength,defect,salt,data.signature]);
   await indexed(s=>s.inspections.member(batchId),'V2 persistent inspection');console.log('LOT_V2_SESSION_PHASE:INSPECTION');
   writeFileSync(process.env.LOT_V2_SESSION_RECEIPT!,JSON.stringify({contractAddress:address,inspectionTx:tx.public.txId}),{flag:'wx',mode:0o600});
   console.log('LOT_V2_SESSION_PHASE:RECEIPT');
  }else{
   if(!policy)throw new Error('Missing buyer policy.');
   checkPolicyForReport(report,policy);
   const existing=await indexed(s=>s.inspections.member(batchId),'Stored inspection on existing V2 contract');
   const policyId=digestId('LOT_BUYER_POLICY_V1',policy.policyId);
   if(existing.minimumStrength.member(policyId))throw new Error('Buyer policy already registered. Pick a different buyer ID.');
   const earlier=existing.clearances.size();
   await person('policyOperator').providers.privateStateProvider.forContract(address)
     .set(person('policyOperator').stateId,{policyAdminSecret:policySecret});
   await person('manufacturer').providers.privateStateProvider.forContract(address)
     .set(person('manufacturer').stateId,{});
   const ptx=await submit('policyOperator','registerPolicy',[policyId,BigInt(policy.minStrength),BigInt(policy.maxDefectsBps)]);
   await indexed(s=>s.minimumStrength.member(policyId),'V2 session policy');console.log('LOT_V2_SESSION_PHASE:POLICY');
   // Negative test: the manufacturer must not be able to claim clearance with fabricated readings.
   await expect(submit('manufacturer','proveClearance',[batchId,policyId,strength+1n,defect,salt])).rejects.toThrow();
   const ctx=await indexed(s=>s.clearances.size()===earlier,'No invalid clearance');
   expect(ctx.clearances.size()).toBe(earlier);
   const tx=await submit('manufacturer','proveClearance',[batchId,policyId,strength,defect,salt]);
   await indexed(s=>s.clearances.size()===earlier+1n,'V2 session buyer clearance');console.log('LOT_V2_SESSION_PHASE:CLEARANCE');
   writeLocalPublicReceipt(process.env.LOT_V2_SESSION_RECEIPT!,{contractAddress:address,inspectionTx,policyTx:ptx.public.txId,clearanceTx:tx.public.txId});
   console.log('LOT_V2_SESSION_PHASE:RECEIPT');
  }
 },15*60_000);
});
