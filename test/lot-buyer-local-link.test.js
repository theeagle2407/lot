import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buyerTargetFromReceipt,localBuyerHash,parseLocalBuyerHash,matchesLocalBuyerTarget,localBuyerLink} from '../src/buyerLink.js';
import {isCurrentLocalClearance} from '../src/v2Audit.js';

const receipt=Object.freeze({
  key:'receipt123:B-01', batchId:'LOT-3002',policyId:'B-01',contractAddress:'a'.repeat(64),
  inspectionTx:'00'+'b'.repeat(64),policyTx:'00'+'c'.repeat(64),clearanceTx:'00'+'d'.repeat(64),
  minStrength:530,maxDefectsBps:100,
  privateData:'THIS MUST NOT ENTER LINK',vaultPassphrase:'VERY_PRIVATE',openingSalt:'PRIVATE_SALT'
});
const verified={ok:true,status:'verified',network:'local',batchId:receipt.batchId,contractAddress:receipt.contractAddress,
 inspectionTx:receipt.inspectionTx,clearances:[{policyId:receipt.policyId,policyTx:receipt.policyTx,
 clearanceTx:receipt.clearanceTx,minStrength:receipt.minStrength,maxDefectsBps:receipt.maxDefectsBps}]};
const goodHash=localBuyerHash(receipt);

// Payload is deliberately narrower than a public receipt, let alone a private report.
test('link payload consists of four allowlisted PUBLIC selectors only',()=>{
 const target=buyerTargetFromReceipt(receipt);
 assert.deepEqual(Object.keys(target).sort(),['batchId','clearanceTx','contractAddress','policyId']);
 assert.equal(Object.isFrozen(target),true);
 assert.equal(JSON.stringify(target).includes('PRIVATE'),false);
});
test('new local link has no search parameters, no username and no private data',()=>{
 const link=localBuyerLink('http://127.0.0.1:5173/?unused=true',receipt);
 assert.equal(link,'http://127.0.0.1:5173/'+goodHash);
 assert.equal(link.includes('PRIVATE'),false);
 assert.equal(link.includes('unused'),false);
});
test('existing URL credentials are removed before a link is copied',()=>{
 const link=localBuyerLink('http://user:secret@localhost:5173/?password=secret',receipt);
 assert.equal(link.includes('user'),false);
 assert.equal(link.includes('secret'),false);
 assert.equal(link,'http://localhost:5173/'+goodHash);
});
test('same localhost URL retains only public hash and explicit port',()=>{
 assert.equal(localBuyerLink('http://localhost:5174/some/path?x=2',receipt),'http://localhost:5174/some/path'+goodHash);
});
test('link cannot point to a network-exposed or remote site',()=>{
 for(const bad of ['https://lot.example/','http://192.168.1.5:5173/','http://127.0.0.1.evil.com/','ftp://localhost/'])
  assert.throws(()=>localBuyerLink(bad,receipt),/local LOT website/);
});
test('round trip matches the exact saved buyer clearance',()=>{
 const parsed=parseLocalBuyerHash(goodHash);
 assert.ok(matchesLocalBuyerTarget(receipt,parsed));
 assert.equal(parsed.batchId,'LOT-3002');
});
test('a different buyer on the same batch does not match',()=>{
 assert.equal(matchesLocalBuyerTarget({...receipt,policyId:'B-02'},parseLocalBuyerHash(goodHash)),false);
});
test('a different clearance transaction cannot impersonate the linked one',()=>{
 assert.equal(matchesLocalBuyerTarget({...receipt,clearanceTx:'00'+'f'.repeat(64)},parseLocalBuyerHash(goodHash)),false);
});
test('a different contract cannot impersonate the linked deployment',()=>{
 assert.equal(matchesLocalBuyerTarget({...receipt,contractAddress:'f'.repeat(64)},parseLocalBuyerHash(goodHash)),false);
});
test('malformed links fail closed rather than select an unrelated proof',()=>{
 const bad=[
  goodHash+'/', '#/buyer/LOT-3002/B-01',
  goodHash.replace('LOT-3002','LOT-3002<script>'),
  goodHash.replace('LOT-3002','LOT-3002%2FLOT-3003'),
  goodHash.replace(receipt.contractAddress,'0'.repeat(63)),
  goodHash.replace(receipt.clearanceTx,'1'.repeat(65)),
  '#/buyer/LOT-3002/B-01/'+receipt.contractAddress+'/'+receipt.clearanceTx+'?evil=1',
 ];
 for(const hash of bad) assert.deepEqual(parseLocalBuyerHash(hash),{invalid:true});
 assert.equal(parseLocalBuyerHash('#/other'),null);
});
test('malformed public receipt is never turned into a link',()=>{
 assert.throws(()=>localBuyerHash({...receipt,policyId:'B 01'}),/Invalid public/);
 assert.throws(()=>localBuyerHash({...receipt,contractAddress:''}),/Invalid public/);
});
test('link does not assert verification: only exact fresh ledger data can qualify',()=>{
 const parsed=parseLocalBuyerHash(goodHash);
 assert.equal(matchesLocalBuyerTarget(receipt,parsed),true);
 assert.equal(isCurrentLocalClearance({status:'unverified'},receipt),false);
 assert.equal(isCurrentLocalClearance(verified,receipt),true);
 assert.equal(isCurrentLocalClearance({...verified,clearances:[]},receipt),false);
});
test('buyer page requires exact fresh audit before enabling copy or export',()=>{
 const ui=readFileSync(new URL('../src/LocalReceipts.jsx',import.meta.url),'utf8');
 assert.match(ui,/disabled=\{!verified\}/);
 assert.match(ui,/checkScopedBuyerClearance\(r,\{signal:current.signal\}\)/);
 assert.match(ui,/isCurrentLocalClearance\(state,receipt\)/);
 assert.match(ui,/freshLocalAudit\(state,Date.now\(\)\)/);
 assert.match(ui,/loadScopedBuyerClearance\(target,\{signal:current.signal\}\)/);
 assert.match(ui,/setState\(\{status:'checking'\}\)/);
});
test('hash-route opens only scoped Buyer view and removes listener on exit',()=>{
 const ui=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
 assert.match(ui,/window\.addEventListener\('hashchange',update\)/);
 assert.match(ui,/window\.removeEventListener\('hashchange',update\)/);
 assert.match(ui,/return target\?<LocalReceipts key=\{JSON.stringify\(target\)\} target=\{target\}\/>:<OperatorApp\/>/);
 const main=readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');
 assert.match(main,/path==='\/verify-preprod'\?import\('\.\/PreprodBuyer\.jsx'\):import\('\.\/App\.jsx'\)/);
});
