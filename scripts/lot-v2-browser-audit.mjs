/** Fresh local public-ledger audit for the current saved V2 session only. */
import {defaultEvidenceFile,readPublicEvidence} from './lot-proof-archive.mjs';
import {sessionPublic} from './lot-v2-session-store.mjs';
import {findAuditableSession,publicAuditResult} from './lot-v2-browser-audit-core.mjs';
import {auditV2PublicState} from './lot-v2-public-audit.mjs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const rxBatch=/^LOT-[A-Z0-9-]{1,48}$/;
const rxAddress=/^[0-9a-f]{64}$/;
const rxTx=/^[0-9a-f]{66}$/;
export async function runLocalV2BrowserAudit(request) {
  if(process.env.MIDNIGHT_NETWORK && process.env.MIDNIGHT_NETWORK!=='local')return {status:'unverified'};
  if(!rxBatch.test(request.batchId)||!rxAddress.test(request.contractAddress)||!rxTx.test(request.inspectionTx))return {status:'unverified'};
  let session;
  try{
    session=findAuditableSession(readPublicEvidence(defaultEvidenceFile(root)),sessionPublic(request.batchId),request);
    if(!session)return {status:'unverified'};
  }catch{return {status:'unverified'};}
  try{
    const {indexerPublicDataProvider}=await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
    const {ContractState}=await import('@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime');
    const {ledger}=await import('../contracts/managed/lot-v2/contract/index.js');
    const indexer=indexerPublicDataProvider('http://127.0.0.1:8088/api/v4/graphql','ws://127.0.0.1:8088/api/v4/graphql/ws');
    const query=indexer.queryContractState(session.contractAddress);
    let timer;
    const raw=await Promise.race([query,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Indexer timeout')),8000);})]).finally(()=>clearTimeout(timer));
    if(!raw || raw.contractState?.era!=='v9')return {status:'unverified'};
    const decoded=raw.contractState.deserialize({v9:ContractState});
    return publicAuditResult(session,auditV2PublicState(session,ledger(decoded.data)));
  } catch {return {status:'unavailable'};}
}
