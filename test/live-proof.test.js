import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLocalProofInput,validateNormalizedProofInput,publicReceipt} from '../scripts/lot-proof-utils.mjs';
const input={batchId:'LOT-2048',policyId:'B-01',strength:541,minStrength:500,defectRate:0.8,maxDefects:1.5};
test('valid synthetic policy yields integer basis points',()=>{
  assert.deepEqual(validateLocalProofInput(input),{batchLabel:'LOT-2048',policyLabel:'B-01',strength:541,minStrength:500,defectsBps:80,maxDefectsBps:150});
});
test('rejects nonpassing policies instead of pretending to record a failure',()=>{
  assert.throws(()=>validateLocalProofInput({...input,minStrength:600}),/No valid clearance/);
  assert.throws(()=>validateLocalProofInput({...input,maxDefects:0.2}),/No valid clearance/);
});
test('rejects invalid precision and dangerous or malformed input',()=>{
  assert.throws(()=>validateLocalProofInput({...input,defectRate:0.123}),/two decimal/);
  assert.throws(()=>validateLocalProofInput({...input,strength:1.5}),/whole number/);
  assert.throws(()=>validateLocalProofInput({...input,batchId:'../secret'}),/Batch ID/);
  assert.throws(()=>validateLocalProofInput({...input,defectRate:120}),/between/);
});
test('public receipts cannot accidentally return inspection measurements or salts',()=>{
  const h=(v)=>v.repeat(64);
  const receipt={contractAddress:h('a'),inspectionTx:'00'+h('b'),policyTx:'00'+h('c'),clearanceTx:'00'+h('d'),strength:541,defectsBps:80,salt:'secret'};
  const json=JSON.stringify(publicReceipt(receipt,'LOT-2048','B-01',{minStrength:500,maxDefectsBps:150}));
  for (const forbidden of ['541','defectsBps','strength','salt','secret']) assert.equal(json.includes(forbidden),false,`Leaked ${forbidden}`);
  assert.match(json,/"testData":true/);
});

test('local API normalized data is accepted by the network runner',()=>{
  const normalized=validateLocalProofInput(input);
  assert.deepEqual(validateNormalizedProofInput(JSON.parse(JSON.stringify(normalized))), normalized);
});
test('the network runner rejects malformed and nonpassing normalized inputs',()=>{
  const normalized=validateLocalProofInput(input);
  assert.throws(()=>validateNormalizedProofInput({...normalized,defectsBps:1.5}),/whole number/);
  assert.throws(()=>validateNormalizedProofInput({...normalized,minStrength:900}),/No valid clearance/);
  assert.throws(()=>validateNormalizedProofInput({...normalized,batchLabel:'../bad'}),/Batch ID/);
});

test('public projection preserves Ledger 9 IDs without leaking extra properties',()=>{
  const ids={contractAddress:'a'.repeat(64),inspectionTx:'00'+'b'.repeat(64),policyTx:'00'+'c'.repeat(64),clearanceTx:'00'+'d'.repeat(64)};
  const result=publicReceipt({...ids,strength:600,salt:'private'},'LOT-2048','Northline',{minStrength:500,maxDefectsBps:150});
  assert.equal(result.inspectionTx,ids.inspectionTx);
  assert.equal(result.policyTx,ids.policyTx);
  assert.equal(result.clearanceTx,ids.clearanceTx);
  assert.equal(Object.hasOwn(result,'salt'),false);
  assert.equal(Object.hasOwn(result,'strength'),false);
});
test('public projection rejects wrong-length transaction IDs',()=>{
  const ids={contractAddress:'a'.repeat(64),inspectionTx:'b'.repeat(64),policyTx:'00'+'c'.repeat(64),clearanceTx:'00'+'d'.repeat(64)};
  assert.throws(()=>publicReceipt(ids,'LOT-2048','Northline',{minStrength:500,maxDefectsBps:150}),/Missing valid inspectionTx/);
});
