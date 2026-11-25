import test from 'node:test';
import assert from 'node:assert/strict';
import { checkV2PublicLedger } from '../scripts/lot-v2-public-audit-core.mjs';
const session={batchId:'LOT-3001',contractAddress:'a'.repeat(64),clearances:[
 {policyId:'B-01',minStrength:530,maxDefectsBps:100},
 {policyId:'B-02',minStrength:550,maxDefectsBps:90},
]};
const hash={batchKey:b=>`batch:${b}`,policyKey:p=>`policy:${p}`,clearanceKey:(b,p)=>`clear:${b}:${p}`};
function map(m){return {member:k=>m.has(k),lookup:k=>m.get(k)};}
function fixture(){return {
 inspections:map(new Map([['batch:LOT-3001','commitment']])),
 minimumStrength:map(new Map([['policy:B-01',530n],['policy:B-02',550n]])),
 maximumDefectsBps:map(new Map([['policy:B-01',100n],['policy:B-02',90n]])),
 clearances:map(new Map([['clear:LOT-3001:B-01',true],['clear:LOT-3001:B-02',true]])),
};}
test('exact two-buyer public map membership passes',()=>{
 const got=checkV2PublicLedger(session,fixture(),hash);
 assert.equal(got.ok,true);
 assert.equal(got.clearanceCount,2);
});
test('empty state, missing batch, or missing specific policy fails closed',()=>{
 assert.equal(checkV2PublicLedger(session,null,hash).ok,false);
 const s=fixture();s.inspections=map(new Map());
 assert.equal(checkV2PublicLedger(session,s,hash).ok,false);
 const t=fixture();t.minimumStrength=map(new Map([['policy:B-01',530n]]));
 assert.equal(checkV2PublicLedger(session,t,hash).ok,false);
});
test('policy thresholds are checked, not just ledger count',()=>{
 const state=fixture();state.maximumDefectsBps=map(new Map([['policy:B-01',100n],['policy:B-02',100n]]));
 const outcome=checkV2PublicLedger(session,state,hash);
 assert.equal(outcome.ok,false);
 assert.match(outcome.reason,/thresholds/);
});
test('a missing buyer-specific clearance fails even if another clearance exists',()=>{
 const state=fixture();state.clearances=map(new Map([['clear:LOT-3001:B-01',true],['clear:OTHER:OTHER',true]]));
 const outcome=checkV2PublicLedger(session,state,hash);
 assert.equal(outcome.ok,false);
 assert.match(outcome.reason,/Clearance absent: B-02/);
});
test('exceptions in undecodable ledger fail closed',()=>{
 assert.equal(checkV2PublicLedger(session,{inspections:{member(){throw Error('bad')}}},hash).ok,false);
});
