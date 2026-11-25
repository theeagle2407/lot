import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { savedPublicClearances, exportSavedClearance } from '../src/evidence.js';
import {buyerVerificationPresentation} from '../src/buyerStatus.js';
import { readPublicEvidence, storeConfirmedEvidence } from '../scripts/lot-proof-archive.mjs';

const ids={contractAddress:'a'.repeat(64),inspectionTx:'00'+'b'.repeat(64),policyTx:'00'+'c'.repeat(64),clearanceTx:'00'+'d'.repeat(64)};
const receipt={network:'local',testData:true,result:'qualified',batchId:'LOT-3001',policyId:'B-01',policy:{minStrength:530,maxDefectsBps:100},...ids,additional:[{policyId:'B-02',policy:{minStrength:550,maxDefectsBps:90},policyTx:'00'+'e'.repeat(64),clearanceTx:'00'+'f'.repeat(64)}]};
const job={status:'confirmed',id:'0123456789abcdef',batchId:'LOT-3001',policyId:'B-01',receipt};
test('archive projection has one entry per finalized buyer clearance',()=>{
 const clearances=savedPublicClearances([{id:job.id,savedAt:new Date().toISOString(),receipt}]);
 assert.equal(clearances.length,2);
 assert.deepEqual(clearances.map(c=>c.policyId),['B-01','B-02']);
 assert.equal(clearances[0].batchId,'LOT-3001');
 assert.equal(clearances[1].maxDefectsBps,90);
});
test('saved public receipt export has no private measurements or secrets',()=>{
 const dirty={...receipt,strength:570,salt:'SECRET-SALT',privateSeed:'SECRET-SEED'};
 const entry={id:job.id,savedAt:new Date().toISOString(),receipt:dirty};
 const c=savedPublicClearances([entry])[0];
 const output=JSON.stringify(exportSavedClearance({...c,strength:570,salt:'SECRET-SALT'}));
 for(const forbidden of ['strength":570','SECRET-SALT','SECRET-SEED','privateSeed','salt','defectRate']) assert.equal(output.includes(forbidden),false);
 assert.equal(exportSavedClearance(c).transactions.clearance,ids.clearanceTx);
});
test('invalid receipts are never displayed as saved proofs',()=>{
 const valid={id:job.id,receipt};
 assert.equal(savedPublicClearances([{...valid,receipt:{...receipt,contractAddress:'bad'}}]).length,0);
 assert.equal(savedPublicClearances([{...valid,receipt:{...receipt,testData:false}}]).length,0);
 assert.equal(savedPublicClearances([{...valid,receipt:{...receipt,inspectionTx:'bad'}}]).length,0);
 assert.equal(savedPublicClearances([{...valid,receipt:{...receipt,policy:{...receipt.policy,maxDefectsBps:99999}}}]).length,0);
});
test('new vault receipt can be read from disk without API process restart',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'lot-ui-proof-'));
 try {
  const file=path.join(dir,'public.json');
  assert.equal(readPublicEvidence(file).length,0);
  storeConfirmedEvidence(file,job);
  const fresh=savedPublicClearances(readPublicEvidence(file));
  assert.equal(fresh.length,2);
  assert.equal(fresh[0].batchId,'LOT-3001');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('customer navigation remains minimal; archived proofs stay in local clearances',()=>{
 const ui=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
 const api=readFileSync(new URL('../scripts/lot-proof-api.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(ui,/id: ['"]chain['"]/);
 const receipts=readFileSync(new URL('../src/LocalReceipts.jsx',import.meta.url),'utf8');
 assert.match(ui,/!inspector&&page==='clearances'/);
 assert.match(receipts,/Local clearances/);
 assert.match(receipts,/buyerVerificationPresentation/);
 assert.equal(buyerVerificationPresentation({status:'unverified'},false,false).label,'Local receipt');
 assert.match(api,/archive = readPublicEvidence\(evidenceFile\)/);
});
