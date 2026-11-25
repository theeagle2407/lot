import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { sanitizeArchiveReceipt, readPublicEvidence, storeConfirmedEvidence, savedJobFromEntry } from '../scripts/lot-proof-archive.mjs';
import { hasExpectedPublicLedger } from '../scripts/lot-saved-chain-check.mjs';

const ids = { contractAddress:'a'.repeat(64), inspectionTx:'00'+'b'.repeat(64), policyTx:'00'+'c'.repeat(64), clearanceTx:'00'+'d'.repeat(64) };
const receipt = {
  network: 'local', batchId: 'LOT-2048', policyId: 'B-01',
  policy: { minStrength: 500, maxDefectsBps: 150 },
  ...ids, additional:[{ policyId:'B-02',policy:{minStrength:530,maxDefectsBps:100},policyTx:'00'+'e'.repeat(64),clearanceTx:'00'+'f'.repeat(64) }],
  result: 'qualified', testData: true,
};
const job = { status: 'confirmed', id: '0a1b2c3d4e5f6789', batchId:'LOT-2048', policyId:'B-01', receipt };
function withFile(fn) {
  const dir=mkdtempSync(path.join(tmpdir(), 'lot-archive-test-'));
  try { return fn(path.join(dir, 'nested', 'evidence.json')); }
  finally { rmSync(dir,{recursive:true,force:true}); }
}
const maps = (inspections, policies, clearances) => ({
  inspections:{size:()=>BigInt(inspections)}, minimumStrength:{size:()=>BigInt(policies)},
  maximumDefectsBps:{size:()=>BigInt(policies)}, clearances:{size:()=>BigInt(clearances)},
});

test('confirmed local evidence survives archive reload and remains public-only',()=>withFile(file=>{
  const original={...job,receipt:{...receipt,strength:541,salt:'VERY_PRIVATE',privateState:'NEVER_PERSIST'}};
  const written=storeConfirmedEvidence(file,original);
  const loaded=readPublicEvidence(file);
  assert.equal(loaded.length,1);
  assert.deepEqual(loaded[0].receipt,written.receipt);
  const raw=readFileSync(file,'utf8');
  for(const forbidden of ['VERY_PRIVATE','NEVER_PERSIST','"strength"','"salt"','"privateState"'])
    assert.equal(raw.includes(forbidden),false);
  assert.equal(loaded[0].receipt.additional.length,1);
  const restored=savedJobFromEntry(loaded[0]);
  assert.equal(restored.status,'saved');
  assert.equal(restored.receipt.batchId,'LOT-2048');
}));

test('unconfirmed and mismatched jobs are never saved',()=>withFile(file=>{
  assert.throws(()=>storeConfirmedEvidence(file,{...job,status:'running'}),/unconfirmed/);
  assert.throws(()=>storeConfirmedEvidence(file,{...job,batchId:'LOT-9999'}),/not bound/);
  assert.deepEqual(readPublicEvidence(file),[]);
}));

test('malformed or duplicate clearances cannot enter archive',()=>{
  assert.throws(()=>sanitizeArchiveReceipt({...receipt,inspectionTx:'bad'}),/Missing valid/);
  assert.throws(()=>sanitizeArchiveReceipt({...receipt,additional:[{...receipt.additional[0],clearanceTx:receipt.clearanceTx}]}),/Duplicate/);
  assert.throws(()=>sanitizeArchiveReceipt({...receipt,additional:[{...receipt.additional[0],policyId:'B-01'}]}),/Invalid buyer/);
  assert.throws(()=>sanitizeArchiveReceipt({...receipt,testData:false}),/Invalid public/);
});

test('different confirmed runs are retained; duplicate job IDs do not multiply entries',()=>withFile(file=>{
  storeConfirmedEvidence(file,job);
  storeConfirmedEvidence(file,job);
  storeConfirmedEvidence(file,{...job,id:'1122334455667788'});
  assert.equal(readPublicEvidence(file).length,2);
}));

test('restored receipt must not show current when contract has disappeared or counts are insufficient',()=>{
  assert.equal(hasExpectedPublicLedger(receipt,null),false);
  assert.equal(hasExpectedPublicLedger(receipt,maps(0,2,2)),false);
  assert.equal(hasExpectedPublicLedger(receipt,maps(1,1,2)),false);
  assert.equal(hasExpectedPublicLedger(receipt,maps(1,2,1)),false);
  assert.equal(hasExpectedPublicLedger(receipt,maps(1,2,2)),true);
});
