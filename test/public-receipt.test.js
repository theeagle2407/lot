import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeLocalPublicReceipt, readLocalPublicReceipt } from '../scripts/lot-public-receipt.mjs';
const ids={contractAddress:'a'.repeat(64),inspectionTx:'00'+'b'.repeat(64),policyTx:'00'+'c'.repeat(64),clearanceTx:'00'+'d'.repeat(64)};
const policy={minStrength:500,maxDefectsBps:150};
function tempFile(callback){
 const dir=mkdtempSync(path.join(tmpdir(),'lot-public-test-'));
 try{return callback(path.join(dir,'public.json'));}finally{rmSync(dir,{recursive:true,force:true});}
}
test('file-based proof receipt contains only public identifiers',()=>tempFile(file=>{
 writeLocalPublicReceipt(file,{...ids,strength:541,defectsBps:80,salt:'private'});
 assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),ids);
 const receipt=readLocalPublicReceipt(file,'LOT-2048','B-01',policy);
 assert.equal(receipt.result,'qualified');
 assert.equal(receipt.clearanceTx,ids.clearanceTx);
 for(const secret of ['strength','defectsBps','salt','private'])assert.equal(JSON.stringify(receipt).includes(secret),false);
 assert.throws(()=>writeLocalPublicReceipt(file,ids),/EEXIST/);
}));
test('missing and malformed proof receipts cannot be confirmed',()=>tempFile(file=>{
 assert.throws(()=>readLocalPublicReceipt(file,'LOT-2048','B-01',policy),/ENOENT/);
 writeFileSync(file,'{ invalid', {mode:0o600});
 assert.throws(()=>readLocalPublicReceipt(file,'LOT-2048','B-01',policy),SyntaxError);
 writeFileSync(file,JSON.stringify({...ids,clearanceTx:'bad'}));
 assert.throws(()=>readLocalPublicReceipt(file,'LOT-2048','B-01',policy),/Missing valid clearanceTx/);
}));
test('invalid chain identifiers are rejected before being written',()=>tempFile(file=>{
 assert.throws(()=>writeLocalPublicReceipt(file,{...ids,inspectionTx:'not-a-hash'}),/Invalid public inspectionTx/);
 assert.throws(()=>readFileSync(file,'utf8'),/ENOENT/);
}));

test('Ledger 9 transaction IDs retain all 66 hex characters',()=>tempFile(file=>{
  writeLocalPublicReceipt(file,ids);
  const stored=JSON.parse(readFileSync(file,'utf8'));
  for(const name of ['inspectionTx','policyTx','clearanceTx']) {
    assert.equal(stored[name].length,66);
    assert.equal(stored[name],ids[name]);
  }
  const exposed=readLocalPublicReceipt(file,'LOT-2048','B-01',policy);
  assert.equal(exposed.inspectionTx,ids.inspectionTx);
}));
test('reject 64-character tx IDs, 66-character addresses, prefixes and nonhex',()=>tempFile(file=>{
  for(const invalid of [
    {...ids,inspectionTx:'b'.repeat(64)},
    {...ids,contractAddress:'a'.repeat(66)},
    {...ids,policyTx:'0x'+'c'.repeat(64)},
    {...ids,clearanceTx:'z'.repeat(66)},
  ]) {
    assert.throws(()=>writeLocalPublicReceipt(file,invalid),/Invalid public/);
  }
  assert.throws(()=>readFileSync(file,'utf8'),/ENOENT/);
}));
