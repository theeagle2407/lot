import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEvidenceSessions } from '../scripts/lot-evidence-summary.mjs';
import { readPublicEvidence, storeConfirmedEvidence } from '../scripts/lot-proof-archive.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const contract='a'.repeat(64), inspectionTx='00'+'b'.repeat(64);
const txn=(char)=>'00'+char.repeat(64);
const base=(policyId, policyTx, clearanceTx, minStrength=530, maxDefectsBps=100)=>({
 network:'local', testData:true, result:'qualified',batchId:'LOT-3001',
 contractAddress:contract,inspectionTx,policyId,policy:{minStrength,maxDefectsBps},policyTx,clearanceTx,
 additional:[],
});
function wrap(id, receipt){return {id,savedAt:'2026-11-21T15:00:00.000Z',receipt};}
const a=wrap('1111111111111111',base('B-01',txn('c'),txn('d')));
const b=wrap('2222222222222222',base('B-02',txn('e'),txn('f'),550,90));

test('separate buyer receipts under one contract and inspection count as two clearances',()=>{
 const sessions=summarizeEvidenceSessions([a,b]);
 assert.equal(sessions.length,1);
 assert.equal(sessions[0].clearanceCount,2);
 assert.equal(sessions[0].archiveEntries,2);
 assert.deepEqual(sessions[0].clearances.map(c=>c.policyId),['B-01','B-02']);
 assert.equal(sessions[0].contractAddress,contract);
});

test('old deployments for same batch remain separate sessions',()=>{
 const previous=wrap('3333333333333333',{...a.receipt,contractAddress:'1'.repeat(64)});
 const sessions=summarizeEvidenceSessions([previous,a,b]);
 assert.equal(sessions.length,2);
 assert.deepEqual(sessions.map(s=>s.clearanceCount),[1,2]);
});

test('re-import of the exact same clearance does not inflate counts',()=>{
 const duplicate=wrap('4444444444444444',a.receipt);
 const sessions=summarizeEvidenceSessions([a,duplicate,b]);
 assert.equal(sessions[0].archiveEntries,3);
 assert.equal(sessions[0].clearanceCount,2);
});

test('conflicting buyer policy or reused tx ID fails closed',()=>{
 const conflict=wrap('5555555555555555',base('B-01',txn('e'),txn('f')));
 assert.throws(()=>summarizeEvidenceSessions([a,conflict]),/Conflicting archived buyer policy/);
 const stolenTx=wrap('5555555555555555',base('B-02',txn('e'),txn('d')));
 assert.throws(()=>summarizeEvidenceSessions([a,stolenTx]),/Conflicting archived clearance transaction/);
});

test('one receipt containing multiple buyers also counts both and never exposes report secrets',()=>{
 const multi=wrap('1111111111111111',{
   ...a.receipt,
   strengthMpa:570,openingSalt:'PRIVATE',walletSeed:'SECRET',
   additional:[{policyId:'B-02',policy:{minStrength:550,maxDefectsBps:90},policyTx:txn('e'),clearanceTx:txn('f')}],
 });
 const data=JSON.stringify(summarizeEvidenceSessions([multi]));
 assert.equal(JSON.parse(data)[0].clearanceCount,2);
 for(const forbidden of ['PRIVATE','SECRET','strengthMpa','openingSalt','walletSeed'])assert.equal(data.includes(forbidden),false);
});

test('summary reads real public-only archive serialization',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'lot-evidence18-'));
 try{
  const file=path.join(dir,'archive.json');
  storeConfirmedEvidence(file,{status:'confirmed',id:a.id,batchId:'LOT-3001',policyId:'B-01',receipt:a.receipt});
  storeConfirmedEvidence(file,{status:'confirmed',id:b.id,batchId:'LOT-3001',policyId:'B-02',receipt:b.receipt});
  const summary=summarizeEvidenceSessions(readPublicEvidence(file));
  assert.equal(summary[0].clearanceCount,2);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
