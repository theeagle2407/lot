import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {onboardingPath,registerOnboarded,createInspectorInvitation,createBatchRequest,accountCatalog,decideInspection,signAssignedInspection,prepareClearance} from '../scripts/lot-onboarding.mjs';
test('categories and private clearance preparation',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'lot39-')),legacyFile=join(dir,'users.json'),file=onboardingPath(legacyFile);
 const reg=(name,role='manufacturer',invite='')=>registerOnboarded({file,legacyFile,input:{name,role,invite,password:'test-password-long-enough',company:name,fullName:name,email:name+'@example.invalid'}});
 try{
 const a=reg('maker01'),b=reg('maker02'),i=reg('inspect01','inspector',createInspectorInvitation(file,a,{}).code);
 const base={id:'LOT-0001',material:'Aluminium',inspector:i.name};
 await t.test('category validated and legacy records remain readable',()=>{assert.throws(()=>createBatchRequest(file,a,{...base,category:'food'}),/Check batch fields/);createBatchRequest(file,a,{...base,category:'metals'});createBatchRequest(file,a,{id:'LOT-0002',material:'Glass',inspector:''});assert.equal(accountCatalog(file,a).batches[0].category,'metals');assert.equal(accountCatalog(file,a).batches[1].category,null);assert.equal(accountCatalog(file,i).batches[0].category,'metals');});
 const requestId=accountCatalog(file,a).batches[0].requestId;
 const policy={requestId,policyId:'B-02',minStrength:550,maxDefectsBps:100};
 await t.test('signed report required and unauthorized actors rejected',()=>{for(const actor of [null,b,i,a])assert.throws(()=>prepareClearance(file,actor,policy));decideInspection(file,i,{requestId,decision:'accepted'});signAssignedInspection(file,i,{requestId,strength:620,defectBps:75},()=>({signature:{testOnly:1n},inspectorPublicKey:{testOnly:2n}}));for(const actor of [null,b,i])assert.throws(()=>prepareClearance(file,actor,policy));});
 await t.test('policy validated, inclusive boundaries and failing conditions',()=>{for(const p of [{minStrength:0},{minStrength:550.5},{maxDefectsBps:10001},{policyId:'<bad>'}])assert.throws(()=>prepareClearance(file,a,{...policy,...p}),/Check policy fields/);assert.equal(prepareClearance(file,a,{...policy,minStrength:620,maxDefectsBps:75}).policy.eligible,true);assert.equal(prepareClearance(file,a,{...policy,minStrength:621}).policy.eligible,false);assert.equal(prepareClearance(file,a,{...policy,maxDefectsBps:74}).policy.eligible,false);});
 await t.test('local result persists only for owning manufacturer; no report opening returned',()=>{const r=prepareClearance(file,a,policy).policy;assert.equal(r.eligible,true);assert.equal(r.status,'local-eligibility-only');assert.deepEqual(accountCatalog(file,a).batches[0].preparedPolicy,r);assert.equal(accountCatalog(file,i).batches[0].preparedPolicy,undefined);assert.equal(accountCatalog(file,b).batches.length,0);assert.ok(!JSON.stringify(r).includes('openingSalt'));assert.ok(!JSON.stringify(r).includes('signature'));});
 }finally{rmSync(dir,{recursive:true,force:true});}
});
