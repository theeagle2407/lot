import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MAX_LOCAL_AUDIT_AGE_MS,freshLocalAudit,buyerVerificationPresentation} from '../src/buyerStatus.js';
const at=1_800_000_000_000;
test('valid fresh ledger read can be shown as verified',()=>{
 assert.equal(freshLocalAudit({status:'verified',receivedAtMs:at},at+45000),true);
 assert.equal(buyerVerificationPresentation({status:'verified'},true,true).heading,'Verified');
});
test('verification expires instead of staying green after service stops',()=>{
 assert.equal(freshLocalAudit({status:'verified',receivedAtMs:at},at+MAX_LOCAL_AUDIT_AGE_MS+1),false);
 assert.equal(buyerVerificationPresentation({status:'verified'},true,false).state,'stale');
});
test('missing, future-dated, invalid and unsuccessful reads cannot be fresh',()=>{
 for(const x of [{status:'unverified',receivedAtMs:at},{status:'verified'},
   {status:'verified',receivedAtMs:at+1},{status:'verified',receivedAtMs:'1'},
   {status:'unavailable',receivedAtMs:at}])assert.equal(freshLocalAudit(x,at),false);
});
test('saved receipt alone never displays a verified label',()=>{
 for(const status of ['unverified','unavailable','checking']){
   const view=buyerVerificationPresentation({status},false,false);
   assert.notEqual(view.label,'Verified · local');
   assert.notEqual(view.heading,'Qualified');
 }
});
test('a mismatched clearance cannot display verified even with a fresh response',()=>{
 const result=buyerVerificationPresentation({status:'verified',receivedAtMs:at},false,true);
 assert.equal(result.state,'unverified');
});
test('reader distinguishes ledger offline from recorded failure',()=>{
 assert.equal(buyerVerificationPresentation({status:'unavailable'},false,false).state,'unavailable');
 assert.equal(buyerVerificationPresentation({status:'checking'},false,false).state,'checking');
});
test('local and Preprod buyer views gate verification on fresh exact ledger results',()=>{
 const local=readFileSync(new URL('../src/LocalReceipts.jsx',import.meta.url),'utf8');
 const live=readFileSync(new URL('../src/PreprodBuyer.jsx',import.meta.url),'utf8');
 assert.match(local,/verified=exact&&freshLocalAudit\(state,now\)/);
 assert.match(local,/buyerVerificationPresentation\(state,exact,verified\)/);
 assert.match(local,/view.heading/);
 assert.match(local,/visibilitychange/);
 assert.match(live,/verified=validResult\(state,now,TARGET\)/);
 assert.match(live,/verified\?'Clearance verified'/);
 assert.match(live,/disabled=\{!verified\}/);
 assert.match(live,/visibilitychange/);
});
test('linked buyer remains checking until the exact receipt and audit respond',()=>{
 const src=readFileSync(new URL('../src/LocalReceipts.jsx',import.meta.url),'utf8');
 assert.match(src,/setState\(\{status:'checking'\}\);setReceipt\(null\)/);
 assert.match(src,/if\(active&&controller===current&&!current.signal.aborted\)/);
 assert.match(src,/setReceipt\(null\);setState\(\{status:'unavailable'\}\)/);
 assert.match(src,/controller\?\.abort\(\)/);
 assert.match(src,/if\(target.invalid\)return/);
});
