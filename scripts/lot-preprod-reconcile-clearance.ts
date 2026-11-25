/** Read-only clearance reconciliation. No wallet, proving, signing, or submission. */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { CompactTypeBytes, CompactTypeVector, persistentHash } from '@midnight-ntwrk/compact-runtime';
import { ledger } from '../contracts/managed/lot-v2/contract/index.js';
(globalThis as any).WebSocket=WebSocket;
const batch='LOT-3002', policy='B-02', contract='00840699a415c117c2470838f649179362871143f6d8a000ad42614940d9d7b8';
const key=(d:string,l:string)=>new Uint8Array(createHash('sha256').update(d).update(':').update(l).digest());
const batchKey=key('LOT_BATCH_V1',batch), policyKey=key('LOT_BUYER_POLICY_V1',policy);
const clearanceKey=persistentHash(new CompactTypeVector(2,new CompactTypeBytes(32)),[batchKey,policyKey]);
const token=(process.env.BLOCKFROST_PROJECT_ID??'').trim(); delete process.env.BLOCKFROST_PROJECT_ID;
const path=join(homedir(),'.lot','preprod','deployments-v2',batch,'actions','clearance-'+Buffer.from(policyKey).toString('hex'),'status.json');
async function main(){
 if(!/^[A-Za-z0-9_-]{16,256}$/.test(token))throw new Error('TOKEN_INVALID');
 console.log('LOT PREPROD CLEARANCE RECONCILIATION — READ ONLY');
 console.log('Clearance key:',Buffer.from(clearanceKey).toString('hex'));
 console.log('Contract:',contract); console.log('Policy:',policy); console.log('Policy key:',Buffer.from(policyKey).toString('hex'));
 try {const j=JSON.parse(await readFile(path,'utf8')); console.log('Local journal:', JSON.stringify({status:j.status,updatedAt:j.updatedAt,submittedIdentifier:j.submittedIdentifier,txId:j.txId,phase:j.phase,policyId:j.policyId,minStrength:j.minStrength,maxDefectsBps:j.maxDefectsBps}));} catch {console.log('Local journal unavailable; do not retry submission.');}
 const url=(s:string)=>s+'?project_id='+encodeURIComponent(token);
 const http=url('https://midnight-preprod.blockfrost.io/api/v0');
 const ws=url('wss://midnight-preprod.blockfrost.io/api/v0/ws');
 const provider=indexerPublicDataProvider(http,ws);
 const r=await Promise.race([provider.queryContractState(contract),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('READ_TIMEOUT')),45000))]);
 if(!r||r.contractState.era!=='v9')throw new Error('CONTRACT_STATE_UNAVAILABLE');
 const state=ledger(r.contractState.deserialize({v9:ContractState}).data);
 const inspection=state.inspections.member(batchKey), min=state.minimumStrength.member(policyKey), max=state.maximumDefectsBps.member(policyKey);
 console.log('Signed inspection present:',inspection?'YES':'NO');
 console.log('Policy minimum present:',min?'YES':'NO'); console.log('Policy maximum present:',max?'YES':'NO');
 const present=state.clearances.member(clearanceKey);
 const issued=present&&state.clearances.lookup(clearanceKey)===true;
 const policyMatches=min&&max&&state.minimumStrength.lookup(policyKey)===550n&&state.maximumDefectsBps.lookup(policyKey)===100n;
 console.log('Expected public policy matches:',policyMatches?'YES':'NO');
 console.log('Exact batch-policy clearance present:',issued?'YES':'NO');
 console.log('RESULT:',inspection&&policyMatches&&issued?'CLEARANCE_CONFIRMED_ON_PUBLIC_LEDGER':inspection&&policyMatches&&!present?'CLEARANCE_NOT_VISIBLE_DO_NOT_RETRY':'UNEXPECTED_STATE_DO_NOT_RETRY');
 console.log('READ ONLY: No transaction submitted. No journal or wallet state modified.');
}
main().then(()=>process.exit(0)).catch(e=>{const m=e instanceof Error?e.message:''; console.error('READ FAILED:',m==='READ_TIMEOUT'||m==='TOKEN_INVALID'||m==='CONTRACT_STATE_UNAVAILABLE'?m:'Indexer or contract decoding error');console.error('No transaction submitted. Do not retry registration.');process.exit(1);});
