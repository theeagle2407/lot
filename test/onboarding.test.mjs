import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalOperator,authenticateLocalOperator,createLocalOperatorSessions} from '../scripts/lot-operator-access.mjs';
import {onboardingPath,registerOnboarded,authenticateOnboarded,issueInspectorInvite,createInspectorInvitation,accountCatalog,createBatchRequest,assignBatchRequest,onboardingRouteAllowed,listOnboarded} from '../scripts/lot-onboarding.mjs';
const dir=mkdtempSync(join(tmpdir(),'lot-onboard-test-')),legacy=join(dir,'users.json'),file=onboardingPath(legacy);
const password='test-password-long-enough';
const input=(name,role='manufacturer',invite='')=>({name,role,invite,password,company:'Example company',fullName:'Example User',email:name+'@example.invalid'});
let a,b,i,j;
const reg=x=>registerOnboarded({file,legacyFile:legacy,input:x});
test('onboarding, assignment and authorization',async t=>{
 try{
 await t.test('legacy credentials preserved, no username collision',()=>{createLocalOperator({name:'legacy01',role:'inspector',password,file:legacy});assert.throws(()=>reg(input('legacy01')),/Username unavailable/);assert.equal(authenticateLocalOperator({name:'legacy01',password,file:legacy}).role,'inspector');});
 await t.test('manufacturer signup starts with empty catalog',()=>{a=reg(input('maker01'));b=reg(input('maker02'));assert.equal(a.scope,'onboarding');assert.deepEqual(accountCatalog(file,a).batches,[]);assert.throws(()=>reg(input('maker01')),/Username unavailable/);assert.equal(listOnboarded(file).length,2);});
 await t.test('passwords hashed and login survives store reopen',()=>{assert.deepEqual(authenticateOnboarded({file,name:a.name,password}),a);assert.equal(authenticateOnboarded({file,name:a.name,password:'wrong'}),null);assert.ok(!readFileSync(file,'utf8').includes(password));assert.equal(statSync(file).mode&0o077,0);});
 await t.test('inspector invitation is required, expiring, one-use and org-bound',()=>{assert.throws(()=>reg(input('inspect01','inspector')),/invitation/);const expired=issueInspectorInvite(file,a.name,0);assert.throws(()=>reg(input('inspect01','inspector',expired)),/expired/);const code=issueInspectorInvite(file,a.name);i=reg(input('inspect01','inspector',code));assert.throws(()=>reg(input('inspect02','inspector',code)),/expired/);j=reg(input('inspect02','inspector',issueInspectorInvite(file,b.name)));assert.ok(!readFileSync(file,'utf8').includes(code));assert.deepEqual(accountCatalog(file,a).inspectors.map(x=>x.name),[i.name]);});
 await t.test('same batch ID can exist in independent organizations',()=>{createBatchRequest(file,a,{id:'LOT-4001',material:'Steel',inspector:''});createBatchRequest(file,b,{id:'LOT-4001',material:'Copper',inspector:j.name});assert.equal(accountCatalog(file,a).batches[0].material,'Steel');assert.equal(accountCatalog(file,b).batches[0].material,'Copper');assert.deepEqual(accountCatalog(file,i).batches,[]);assert.throws(()=>createBatchRequest(file,a,{id:'LOT-4001',material:'Steel',inspector:''}),/exists/);});
 await t.test('inspector only sees assigned requests, cannot create or cross-assign',()=>{assert.throws(()=>assignBatchRequest(file,a,{id:'LOT-4001',inspector:j.name}),/not available/);assignBatchRequest(file,a,{id:'LOT-4001',inspector:i.name});assert.equal(accountCatalog(file,i).batches[0].material,'Steel');assert.equal(accountCatalog(file,j).batches[0].material,'Copper');assert.throws(()=>createBatchRequest(file,i,{id:'LOT-4002',material:'Steel',inspector:''}),/Manufacturer access/);assert.throws(()=>assignBatchRequest(file,i,{id:'LOT-4001',inspector:i.name}),/Manufacturer access/);});
 await t.test('session preserves onboarding scope; all legacy proof routes blocked',()=>{const sessions=createLocalOperatorSessions();const cookie=sessions.start(a).split(';')[0];const restored=sessions.fromCookie(cookie);assert.deepEqual(restored,a);for(const p of ['status','history','run','v2-job','v2-session','v2-sessions','v2-report/status','v2-report/create','v2-session/run','v2-session/authorize','v2-audit','unknown']){assert.equal(onboardingRouteAllowed('/api/proof/'+p,restored),false,p);assert.equal(onboardingRouteAllowed('/api/proof/'+p,null),false,p);}assert.equal(onboardingRouteAllowed('/api/proof/onboarding/catalog',restored),true);assert.equal(onboardingRouteAllowed('/api/proof/onboarding/catalog',{name:'legacy01',role:'inspector'}),false);assert.equal(onboardingRouteAllowed('/api/proof/buyer-receipt',null),true);assert.equal(onboardingRouteAllowed('/api/proof/v2-report/create',{name:'legacy01',role:'inspector'}),true);sessions.revoke(cookie);assert.equal(sessions.fromCookie(cookie),null);});
 await t.test('private onboarding catalog cannot be read by legacy or anonymous actors',()=>{assert.throws(()=>accountCatalog(file,null));assert.throws(()=>accountCatalog(file,{name:a.name,role:a.role}));assert.throws(()=>accountCatalog(file,{name:a.name,role:'inspector',scope:'onboarding'}));});
 await t.test('browser invites require authenticated manufacturer and cannot select another organization',()=>{
  for(const actor of [null,i,{name:a.name,role:a.role},{name:i.name,role:'manufacturer',scope:'onboarding'}])assert.throws(()=>createInspectorInvitation(file,actor,{}));
  assert.throws(()=>createInspectorInvitation(file,a,{manufacturer:b.name}),/Invalid invitation request/);
  const now=Date.now(),invite=createInspectorInvitation(file,a,{},now);assert.match(invite.code,/^[0-9a-f]{48}$/);assert.equal(Date.parse(invite.expiresAt),now+86400000);
  const x=reg(input('inspect03','inspector',invite.code));assert.ok(accountCatalog(file,a).inspectors.some(u=>u.name===x.name));assert.ok(!accountCatalog(file,b).inspectors.some(u=>u.name===x.name));assert.throws(()=>reg(input('inspect04','inspector',invite.code)),/expired/);assert.ok(!readFileSync(file,'utf8').includes(invite.code));assert.ok(!JSON.stringify(accountCatalog(file,a)).includes(invite.code));
 });
 await t.test('pending browser invitations capped per organization and expire',()=>{
  const now=Date.now();for(let k=0;k<5;k++)createInspectorInvitation(file,a,{},now);assert.throws(()=>createInspectorInvitation(file,a,{},now),/Five active/);assert.ok(createInspectorInvitation(file,b,{},now).code);assert.ok(createInspectorInvitation(file,a,{},now+86400001).code);
 });
 }finally{rmSync(dir,{recursive:true,force:true});}
});
