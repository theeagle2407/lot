import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { validateLocalProofInput,validateNormalizedProofInput } from '../scripts/lot-proof-utils.mjs';
import { writeLocalPublicReceipt,readLocalPublicReceipt } from '../scripts/lot-public-receipt.mjs';
import { confirmedClearance,verifiedFor,buyerSafeReceipt } from '../src/liveProof.js';
const params={batchId:'LOT-2048',policyId:'B-01',strength:541,defectRate:0.8,minStrength:500,maxDefects:1.5,otherPolicies:[{policyId:'B-02',minStrength:530,maxDefects:1.0},{policyId:'B-03',minStrength:550,maxDefects:0.6}]};
const ids={contractAddress:'a'.repeat(64),inspectionTx:'00'+'b'.repeat(64),policyTx:'00'+'c'.repeat(64),clearanceTx:'00'+'d'.repeat(64)};
const goodExtra={policyLabel:'B-02',minStrength:530,maxDefectsBps:100,policyTx:'00'+'e'.repeat(64),clearanceTx:'00'+'f'.repeat(64)};
const expectExtra=[{policyLabel:'B-02',minStrength:530,maxDefectsBps:100}];
const primary={minStrength:500,maxDefectsBps:150};
function withTemp(cb){const dir=mkdtempSync(path.join(tmpdir(),'lot-multibuyer-'));try{return cb(path.join(dir,'receipt.json'));}finally{rmSync(dir,{recursive:true,force:true});}}
test('one inspection selects only qualifying policies; strict buyer remains unproven',()=>{
  const normalized=validateLocalProofInput(params);
  assert.deepEqual(normalized.extraPolicies,expectExtra);
  assert.deepEqual(validateNormalizedProofInput(JSON.parse(JSON.stringify(normalized))),normalized);
  assert.equal(normalized.batchLabel,'LOT-2048');
});
test('duplicate and malformed policies are rejected before network',()=>{
  assert.throws(()=>validateLocalProofInput({...params,otherPolicies:[{policyId:'B-01',minStrength:400,maxDefects:2}]}),/unique/);
  assert.throws(()=>validateLocalProofInput({...params,otherPolicies:[null]}),/Invalid additional/);
  assert.throws(()=>validateNormalizedProofInput({...validateLocalProofInput(params),extraPolicies:[{policyLabel:'B-02',minStrength:530,maxDefectsBps:1.6}]}),/whole number/);
});
test('one receipt contains two public clearances and no private measurements',()=>withTemp(file=>{
  writeLocalPublicReceipt(file,{...ids,additional:[{...goodExtra,salt:'private',strength:541} ],salt:'private',strength:541});
  const stored=JSON.parse(readFileSync(file,'utf8'));
  assert.equal(stored.additional.length,1);
  const serialized=JSON.stringify(stored);
  for (const forbidden of ['private','salt','strength','541']) assert.equal(serialized.includes(forbidden),false);
  const publicRecord=readLocalPublicReceipt(file,'LOT-2048','B-01',primary,expectExtra);
  assert.equal(publicRecord.additional[0].clearanceTx,goodExtra.clearanceTx);
  const job={status:'confirmed',receipt:publicRecord};
  const policyA={id:'B-01',minimumStrength:500,maximumDefects:1.5};
  const policyB={id:'B-02',minimumStrength:530,maximumDefects:1};
  const policyC={id:'B-03',minimumStrength:550,maximumDefects:0.6};
  assert.equal(verifiedFor(job,'LOT-2048',policyA),true);
  assert.equal(verifiedFor(job,'LOT-2048',policyB),true);
  assert.equal(verifiedFor(job,'LOT-2048',policyC),false);
  assert.equal(verifiedFor(job,'LOT-2047',policyB),false);
  assert.equal(confirmedClearance(job,'LOT-2048',policyB).clearanceTx,goodExtra.clearanceTx);
  assert.equal(buyerSafeReceipt(job,policyB).transactions.clearance,goodExtra.clearanceTx);
  assert.equal(buyerSafeReceipt(job,policyA).transactions.clearance,ids.clearanceTx);
  assert.throws(()=>buyerSafeReceipt(job,policyC),/No matching/);
  assert.equal(verifiedFor(job,'LOT-2048',{...policyB,minimumStrength:540}),false);
}));
test('missing, changed, or forged secondary clearance cannot be confirmed',()=>withTemp(file=>{
  writeLocalPublicReceipt(file,{...ids,additional:[goodExtra]});
  assert.throws(()=>readLocalPublicReceipt(file,'LOT-2048','B-01',primary,[]),/Unexpected number/);
  assert.throws(()=>readLocalPublicReceipt(file,'LOT-2048','B-01',primary,[{...expectExtra[0],minStrength:800}]),/Invalid additional/);
  writeFileSync(file,JSON.stringify({...ids,additional:[{...goodExtra,clearanceTx:'broken'}]}));
  assert.throws(()=>readLocalPublicReceipt(file,'LOT-2048','B-01',primary,expectExtra),/Invalid additional/);
}));
