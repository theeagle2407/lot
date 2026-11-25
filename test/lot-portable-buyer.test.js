import test from 'node:test';
import assert from 'node:assert/strict';
import {makePortableBuyerPage,portableBuyerFilename} from '../src/portableBuyer.js';

const now=Date.parse('2026-11-22T16:00:00.000Z');
const receipt={batchId:'LOT-3002',policyId:'B-01',contractAddress:'a'.repeat(64),inspectionTx:'0'.repeat(66),
 policyTx:'1'.repeat(66),clearanceTx:'2'.repeat(66),minStrength:530,maxDefectsBps:100};
const audit={status:'verified',network:'local',checkedAt:'2026-11-22T15:59:50.000Z',receivedAtMs:now-10000,
 batchId:'LOT-3002',contractAddress:'a'.repeat(64),inspectionTx:'0'.repeat(66),
 clearances:[{policyId:'B-01',policyTx:'1'.repeat(66),clearanceTx:'2'.repeat(66),minStrength:530,maxDefectsBps:100}]};

test('portable page uses exactly one verified buyer clearance',()=>{
 const page=makePortableBuyerPage(receipt,audit,now);
 assert.match(page,/LOT-3002/);assert.match(page,/B-01/);
 assert.match(page,/530 MPa/);assert.match(page,/1\.00%/);
 assert.match(page,/Not independently verified/);
 assert.match(page,/default-src 'none'/);
 assert.equal(page.includes('<script'),false);
 assert.equal(page.includes('connect-src \'none\''),true);
 assert.equal((page.match(/<html /g)||[]).length,1);
 assert.equal(portableBuyerFilename(receipt),'lot-3002-b-01-local-evidence.html');
});
test('a saved receipt alone is insufficient to export an alleged verified snapshot',()=>{
 assert.throws(()=>makePortableBuyerPage(receipt,{status:'unverified'},now));
 assert.throws(()=>makePortableBuyerPage(receipt,{...audit,status:'unavailable'},now));
});
test('cannot export after verification has expired',()=>{
 assert.throws(()=>makePortableBuyerPage(receipt,{...audit,receivedAtMs:now-100000},now));
});
test('cannot export mismatched buyer, thresholds, transactions or network',()=>{
 for(const changed of [
  {...audit,network:'preprod'},
  {...audit,clearances:[{...audit.clearances[0],policyId:'B-02'}]},
  {...audit,clearances:[{...audit.clearances[0],maxDefectsBps:90}]},
  {...audit,clearances:[{...audit.clearances[0],clearanceTx:'f'.repeat(66)}]},
  {...audit,inspectionTx:'f'.repeat(66)},
 ]) assert.throws(()=>makePortableBuyerPage(receipt,changed,now));
});
test('reject future or malformed check timestamps',()=>{
 assert.throws(()=>makePortableBuyerPage(receipt,{...audit,checkedAt:'2026-11-23T00:00:00.000Z'},now));
 assert.throws(()=>makePortableBuyerPage(receipt,{...audit,checkedAt:'never'},now));
});
test('rejects injected receipt content instead of including HTML/script',()=>{
 for(const value of ['LOT-3002<script>alert(1)</script>', 'LOT-3002"><img src=x>']) {
  assert.throws(()=>makePortableBuyerPage({...receipt,batchId:value},audit,now));
 }
});
test('never exports private measurements or secret strings attached to receipt',()=>{
 const bad={...receipt,strengthMpa:987654321,defectBps:8765,openingSalt:'TOP-SECRET-OPENING',password:'TOP-SECRET-PASSWORD',privateKey:'PRIVATE-KEY-BYTES',material:'MY-LAB-PRIVATE'};
 const html=makePortableBuyerPage(bad,audit,now);
 for(const secret of ['987654321','8765','TOP-SECRET-OPENING','TOP-SECRET-PASSWORD','PRIVATE-KEY-BYTES','MY-LAB-PRIVATE']) assert.equal(html.includes(secret),false,secret);
});
test('only authorizes a single buyer even if archive contains other buyer clearances',()=>{
 const both={...audit,clearances:[...audit.clearances,{policyId:'B-02',policyTx:'3'.repeat(66),clearanceTx:'4'.repeat(66),minStrength:550,maxDefectsBps:90}]};
 const html=makePortableBuyerPage(receipt,both,now);
 assert.equal(html.includes('B-02'),false);
 assert.equal(html.includes('550 MPa'),false);
 assert.equal(html.includes('4'.repeat(66)),false);
});
