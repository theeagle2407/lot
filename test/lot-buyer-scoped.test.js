import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseBuyerQuery,findScopedBuyerReceipt,scopedBuyerAuditResult} from '../scripts/lot-buyer-scoped.mjs';
import {isCurrentLocalClearance} from '../src/v2Audit.js';

const tx=c=>'00'+c.repeat(64);
const contract='a'.repeat(64),inspectionTx=tx('b');
const base=(policyId,policyTx,clearanceTx,minStrength,maxDefectsBps)=>({
 network:'local',testData:true,result:'qualified',batchId:'LOT-3002',contractAddress:contract,
 inspectionTx,policyId,policy:{minStrength,maxDefectsBps},policyTx,clearanceTx,additional:[]
});
const entry=(id,r)=>({id,savedAt:'2026-11-21T15:00:00.000Z',receipt:r});
const a=entry('aaaaaaaaaaaaaaa1',base('B-01',tx('c'),tx('d'),530,100));
const b=entry('bbbbbbbbbbbbbbb2',base('B-02',tx('e'),tx('f'),550,90));
const target={batchId:'LOT-3002',policyId:'B-01',contractAddress:contract,clearanceTx:tx('d')};
const audit={status:'verified',network:'local',checkedAt:'2026-11-21T17:00:00.000Z',batchId:'LOT-3002',
 contractAddress:contract,inspectionTx,clearances:[
 {policyId:'B-01',policyTx:tx('c'),clearanceTx:tx('d'),minStrength:530,maxDefectsBps:100},
 {policyId:'B-02',policyTx:tx('e'),clearanceTx:tx('f'),minStrength:550,maxDefectsBps:90},
]};

test('link lookup matches only one exact buyer from a multi-buyer archive',()=>{
 const selected=findScopedBuyerReceipt([a,b],target);
 assert.equal(selected.policyId,'B-01');
 assert.equal(selected.minStrength,530);
 assert.equal(selected.contractAddress,contract);
 assert.equal('additional' in selected,false);
 assert.equal(JSON.stringify(selected).includes('B-02'),false);
 assert.equal(Object.isFrozen(selected),true);
});
test('unknown buyer or altered transaction returns no substitute',()=>{
 for(const change of [{policyId:'B-03'},{clearanceTx:tx('1')},{contractAddress:'f'.repeat(64)},{batchId:'LOT-3001'}])
   assert.equal(findScopedBuyerReceipt([a,b],{...target,...change}),null);
});
test('private extra fields never enter the public buyer response',()=>{
 const dirty={...a,receipt:{...a.receipt,strengthMpa:570,vaultPassphrase:'PRIVATE_VALUE',openingSalt:'PRIVATE_SALT',
    additional:[{policyId:'B-03',policy:{minStrength:500,maxDefectsBps:100},policyTx:tx('1'),clearanceTx:tx('2')}]}};
 const out=JSON.stringify(findScopedBuyerReceipt([dirty],target));
 for(const forbidden of ['PRIVATE_VALUE','PRIVATE_SALT','570','B-03','strengthMpa','openingSalt','additional'])assert.equal(out.includes(forbidden),false);
});
test('conflicting archived receipts for the same buyer fail closed',()=>{
 const conflict=entry('bbbbbbbbbbbbbbb2',{...a.receipt,policy:{minStrength:600,maxDefectsBps:90}});
 assert.equal(findScopedBuyerReceipt([a,conflict],target),null);
});
test('duplicate identical archived proof does not create an ambiguous buyer response',()=>{
 assert.equal(findScopedBuyerReceipt([a,{...a,id:'aaaaaaaaaaaaaaa2'}],target).clearanceTx,tx('d'));
});
test('reject malformed and extra query keys',()=>{
 const qs=new URLSearchParams({batch:'LOT-3002',policy:'B-01',contract,clearance:tx('d')});
 assert.deepEqual(parseBuyerQuery(qs),target);
 for(const invalid of [
  new URLSearchParams({batch:'LOT-3002',policy:'B-01',contract}),
  new URLSearchParams({batch:'LOT-3002',policy:'B-01',contract,clearance:tx('d'),other:'1'}),
  new URLSearchParams([['batch','LOT-3002'],['policy','B-01'],['contract',contract],['clearance',tx('d')],['batch','LOT-3001']]),
  new URLSearchParams({batch:'LOT-3002',policy:'B-01%2Fnot',contract,clearance:tx('d')})])
  assert.equal(parseBuyerQuery(invalid),null);
});
test('scoped ledger response includes only requested policy, not other buyers',()=>{
 const receipt=findScopedBuyerReceipt([a,b],target);
 const result=scopedBuyerAuditResult(audit,receipt);
 assert.equal(result.status,'verified');
 assert.equal(result.clearances.length,1);
 assert.equal(result.clearances[0].policyId,'B-01');
 assert.equal(JSON.stringify(result).includes('B-02'),false);
 assert.equal(isCurrentLocalClearance(result,receipt),true);
});
test('missing, changed or unverified audit cannot verify a linked clearance',()=>{
 const receipt=findScopedBuyerReceipt([a,b],target);
 for(const changed of [
  {...audit,status:'unverified'},
  {...audit,network:'preview'},
  {...audit,clearances:[audit.clearances[1]]},
  {...audit,clearances:[{...audit.clearances[0],minStrength:999},audit.clearances[1]]},
  {...audit,contractAddress:'f'.repeat(64)},
 ]){
  const result=scopedBuyerAuditResult(changed,receipt);
  assert.notEqual(result.status,'verified');
  assert.equal(isCurrentLocalClearance(result,receipt),false);
 }
 assert.deepEqual(scopedBuyerAuditResult({status:'unavailable'},receipt),{status:'unavailable'});
});
test('buyer audit rejects conflicting duplicate policy in a malformed internal result',()=>{
 const receipt=findScopedBuyerReceipt([a,b],target);
 assert.equal(scopedBuyerAuditResult({...audit,clearances:[...audit.clearances,audit.clearances[0]]},receipt).status,'unverified');
});
test('public enumeration routes require a signed-in operator while link routes stay public',()=>{
 const src=readFileSync(new URL('../scripts/lot-proof-api.mjs',import.meta.url),'utf8');
 assert.match(src,/requestPath==='\/api\/proof\/history'[\s\S]{0,300}operatorSessions\.fromCookie/);
 assert.match(src,/requestPath==='\/api\/proof\/v2-audit'[\s\S]{0,250}operatorSessions\.fromCookie/);
 assert.match(src,/requestPath==='\/api\/proof\/buyer-receipt'/);
 assert.match(src,/requestPath==='\/api\/proof\/buyer-audit'/);
 assert.match(src,/findScopedBuyerReceipt\(readPublicEvidence\(evidenceFile\),target\)/);
});
test('linked browser view is isolated from archive and operator navigation',()=>{
 const src=readFileSync(new URL('../src/LocalReceipts.jsx',import.meta.url),'utf8');
 const certificate=src.split('function LocalCertificate')[1].split('function Archive')[0];
 assert.doesNotMatch(certificate,/loadSavedPublicClearances|<Sidebar|<OperatorApp/);
 assert.match(certificate,/loadScopedBuyerClearance\(target,/);
 assert.match(certificate,/checkScopedBuyerClearance\(r,/);
 assert.match(src,/return target\?<LocalCertificate target=\{target\}\/>:<Archive\/>/);
});

test('browser link fetch asks only for its exact receipt without a session cookie',async()=>{
 const {loadScopedBuyerClearance}=await import('../src/evidence.js');
 const original=globalThis.fetch;
 let url, options;
 const fixture=findScopedBuyerReceipt([a,b],target);
 globalThis.fetch=async(u,o)=>{url=u;options=o;return {ok:true,json:async()=>({ok:true,receipt:fixture})};};
 try{
  const result=await loadScopedBuyerClearance(target);
  assert.equal(result.policyId,'B-01');
  assert.match(url,/^\/api\/proof\/buyer-receipt\?/);
  assert.equal(url.includes('/history'),false);
  assert.equal(options.credentials,'omit');
  assert.equal(options.referrerPolicy,'no-referrer');
 }finally{globalThis.fetch=original;}
});
test('browser link never accepts mismatched receipt from the API',async()=>{
 const {loadScopedBuyerClearance}=await import('../src/evidence.js');
 const original=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,json:async()=>({ok:true,receipt:findScopedBuyerReceipt([a,b],{...target,policyId:'B-02',clearanceTx:tx('f')})})});
 try{await assert.rejects(()=>loadScopedBuyerClearance(target),/does not match/);}
 finally{globalThis.fetch=original;}
});
test('scoped buyer ledger request omits cookies and uses selected proof only',async()=>{
 const {checkScopedBuyerClearance}=await import('../src/v2Audit.js');
 const original=globalThis.fetch;
 let url,options;
 globalThis.fetch=async(u,o)=>{url=u;options=o;return {ok:true,json:async()=>({ok:true,...scopedBuyerAuditResult(audit,findScopedBuyerReceipt([a,b],target))})};};
 try{
  const result=await checkScopedBuyerClearance(findScopedBuyerReceipt([a,b],target));
  assert.equal(result.status,'verified');
  assert.deepEqual(result.clearances.map(c=>c.policyId),['B-01']);
  assert.match(url,/^\/api\/proof\/buyer-audit\?/);
  assert.equal(url.includes('B-02'),false);
  assert.equal(options.credentials,'omit');
 }finally{globalThis.fetch=original;}
});

test('sign-out removes privileged state and archive is only mounted for authenticated legacy manufacturers',()=>{
 const src=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
 assert.match(src,/await logoutOperator\(\);clearLogin\(\);closeCreate\(\);closeAuthorization\(\);setOperator\(null\)/);
 assert.match(src,/setSignedBatches\(\[\]\)/);
 assert.match(src,/!authenticated\?<div/);
 assert.match(src,/!inspector&&page==='clearances'\?<><LiveOverview\/><LocalReceipts\/>/);
 assert.match(src,/operator\?\.scope==='onboarding'\)return <OnboardedHome/);
});

test('scoped receipt and audit requests propagate cancellation without sending credentials',async()=>{
 const {loadScopedBuyerClearance}=await import('../src/evidence.js');
 const {checkScopedBuyerClearance}=await import('../src/v2Audit.js');
 const receipt=findScopedBuyerReceipt([a,b],target);
 const abort=new AbortController();const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(u,o)=>{calls.push(o);if(o.signal?.aborted)throw new DOMException('Aborted','AbortError');return {ok:true,json:async()=>({ok:true,receipt})};};
 try{await loadScopedBuyerClearance(target,{signal:abort.signal});abort.abort();await assert.rejects(checkScopedBuyerClearance(receipt,{signal:abort.signal}),{name:'AbortError'});assert.equal(calls.length,2);for(const o of calls){assert.equal(o.signal,abort.signal);assert.equal(o.credentials,'omit');assert.equal(o.referrerPolicy,'no-referrer');}}
 finally{globalThis.fetch=original;}
});
