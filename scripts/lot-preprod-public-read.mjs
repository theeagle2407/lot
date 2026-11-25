import {createHash} from 'node:crypto';
import {WebSocket} from 'ws';
import {indexerPublicDataProvider} from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {ContractState} from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import {CompactTypeBytes,CompactTypeVector,persistentHash} from '@midnight-ntwrk/compact-runtime';
import {ledger} from '../contracts/managed/lot-v2/contract/index.js';
import {TARGET} from '../src/preprod-clearance.js';
import {inspectorFingerprint} from './lot-multi-policy.mjs';
import {evaluatePublicLedger} from './lot-preprod-public-core.mjs';
globalThis.WebSocket=WebSocket;
const key=(domain,label)=>new Uint8Array(createHash('sha256').update(domain).update(':').update(label).digest());
export function createLedgerReader(token,target=TARGET){
 const batchKey=target.batchKey?new Uint8Array(Buffer.from(target.batchKey,'hex')):key('LOT_BATCH_V1',target.batchId),policyKey=key('LOT_BUYER_POLICY_V1',target.policyId);
 const clearanceKey=persistentHash(new CompactTypeVector(2,new CompactTypeBytes(32)),[batchKey,policyKey]);
 if(Buffer.from(policyKey).toString('hex')!==target.policyKey||Buffer.from(clearanceKey).toString('hex')!==target.clearanceKey)throw new Error('Public target derivation mismatch');
 if(!/^[A-Za-z0-9_-]{16,256}$/.test(token))throw new Error('A valid Preprod Blockfrost token is required.');
 const withToken=url=>url+'?project_id='+encodeURIComponent(token);
 const provider=indexerPublicDataProvider(withToken('https://midnight-preprod.blockfrost.io/api/v0'),withToken('wss://midnight-preprod.blockfrost.io/api/v0/ws'));
 return async()=>{
  let timer;
  try{
   const r=await Promise.race([provider.queryContractState(target.contractAddress),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Read timeout')),40000);})]);
   if(!r||r.contractState.era!=='v9')throw new Error('Contract state unavailable');
   const state=ledger(r.contractState.deserialize({v9:ContractState}).data);
   const enrolledInspectorFingerprint=inspectorFingerprint(state.inspectorVerificationKey);
   const result=evaluatePublicLedger(state,batchKey,policyKey,clearanceKey,new Date(),target);
   return {...result,enrolledInspectorFingerprint,...(target.inspectorFingerprint&&target.inspectorFingerprint!==enrolledInspectorFingerprint?{status:'not_verified'}:{})};
  }finally{clearTimeout(timer);}
 };
}
