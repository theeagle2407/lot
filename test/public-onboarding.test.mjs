import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {registerOnboarded,createBatchRequest,accountCatalog} from '../scripts/lot-onboarding.mjs';
import {createLocalOperatorSessions} from '../scripts/lot-operator-access.mjs';
import {createBrowserIssuer} from '../scripts/lot-browser-issuance.mjs';
function fixture(t){const dir=mkdtempSync(join(tmpdir(),'lot-public-onboarding-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'onboarding-v1.json'),legacyFile=join(dir,'users.json');const input={name:'maker01',role:'manufacturer',fullName:'Example User',company:'Example Ltd',email:'demo@example.invalid',password:'a-long-test-password',invite:''};return {dir,file,legacyFile,input};}
test('issuance-authorized names cannot be claimed by public registration; ordinary signup cannot enable issuance',t=>{const f=fixture(t),reservedNames=new Set(['maker01']);assert.throws(()=>registerOnboarded({...f,reservedNames}),/Username unavailable/);const actor=registerOnboarded({...f,input:{...f.input,name:'ordinary01'},reservedNames});const issuer=createBrowserIssuer({root:f.dir,file:f.file,allowed:'maker01',phrase:Array(24).fill('test').join(' '),token:'x'.repeat(32)});assert.equal(issuer.decorate(actor,accountCatalog(f.file,actor)).issuanceEnabled,false);assert.throws(()=>issuer.start(actor,{}),/not enabled/);});
test('one organization cannot exceed 12 batches or exhaust the global batch count alone',t=>{const f=fixture(t),actor=registerOnboarded(f);for(let i=0;i<12;i++)createBatchRequest(f.file,actor,{id:'LOT-'+i,material:'Steel',inspector:''});assert.throws(()=>createBatchRequest(f.file,actor,{id:'LOT-12',material:'Steel',inspector:''}),/batch limit/);assert.equal(accountCatalog(f.file,actor).batches.length,12);});
test('storage overflow does not replace the valid account database',t=>{const f=fixture(t),actor=registerOnboarded(f);const d=JSON.parse(readFileSync(f.file,'utf8'));d.padding='x'.repeat(512*1024-40-Buffer.byteLength(JSON.stringify(d))-13);writeFileSync(f.file,JSON.stringify(d));const before=readFileSync(f.file);assert.throws(()=>createBatchRequest(f.file,actor,{id:'LOT-1234',material:'Steel',inspector:''}),/storage limit/);assert.deepEqual(readFileSync(f.file),before);assert.equal(accountCatalog(f.file,actor).batches.length,0);});
test('sessions are limited to eight per account without invalidating other accounts',()=>{const s=createLocalOperatorSessions(),a={name:'maker01',role:'manufacturer',scope:'onboarding'},b={...a,name:'maker02'};const other=s.start(b).split(';')[0];const cookies=Array.from({length:9},()=>s.start(a).split(';')[0]);assert.equal(s.fromCookie(cookies[0]),null);assert.deepEqual(s.fromCookie(cookies[8]),a);assert.deepEqual(s.fromCookie(other),b);});

test('open gateway and real operator: signup, invite, isolation, logout and wallet permission',async t=>{
 const {spawn}=await import('node:child_process');const http=await import('node:http');const {once}=await import('node:events');const {createHostedGateway}=await import('../scripts/lot-hosted-gateway.mjs');
 const f=fixture(t),origin='https://lot.example.org';
 const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const operatorPort=probe.address().port;await new Promise(r=>probe.close(r));
 const child=spawn(process.execPath,['scripts/lot-proof-api.mjs'],{env:{PATH:process.env.PATH,HOME:f.dir,LOT_PROOF_API_PORT:String(operatorPort),LOT_ISSUER_ACCOUNT:'reserved01',LOT_ISSUER_MNEMONIC:Array(24).fill('test').join(' '),LOT_ISSUER_TOKEN:'x'.repeat(32)},stdio:['ignore','pipe','pipe']});
 t.after(()=>{child.kill('SIGTERM');});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Operator did not start')),5000);child.once('exit',code=>{clearTimeout(timer);reject(Error('Operator exited '+code));});child.stdout.on('data',c=>{if(String(c).includes('LOT local proof API:')){clearTimeout(timer);resolve();}});child.stderr.resume();});
 const gateway=createHostedGateway({origin,publicSignup:true,operatorPort});await new Promise(r=>gateway.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>gateway.close(r)));const port=gateway.address().port;
 let csrf;async function req(path,{body,cookie,ip='192.0.2.1',token=csrf}={}){const headers={host:'lot.example.org','x-forwarded-proto':'https','x-lot-client-ip':ip};if(cookie)headers.cookie=cookie;if(body!==undefined){headers.origin=origin;headers['x-lot-csrf']=token;headers['content-type']='application/json';}return new Promise((resolve,reject)=>{const q=http.request({host:'127.0.0.1',port,path,method:body===undefined?'GET':'POST',headers},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text),cookie:res.headers['set-cookie']?.[0]}));});q.on('error',reject);q.end(body===undefined?undefined:JSON.stringify(body));});}
 const session=await req('/api/proof/session');assert.equal(session.status,200);csrf=session.body.csrf;assert.match(csrf,/^[a-f0-9]{48}$/);
 assert.equal((await req('/api/proof/onboarding/catalog')).status,401);
 const signup=body=>req('/api/proof/auth/signup',{body});assert.equal((await signup({...f.input,name:'reserved01'})).status,400);
 const a=await signup(f.input);assert.equal(a.status,201);assert.match(a.cookie,/; Secure$/);const ac=a.cookie.split(';')[0];
 const b=await signup({...f.input,name:'maker02'});assert.equal(b.status,201);const bc=b.cookie.split(';')[0];
 assert.equal((await req('/api/proof/onboarding/batches',{cookie:ac,body:{id:'LOT-01',material:'Steel',inspector:''},token:'a'.repeat(48)})).status,403);
 assert.equal((await req('/api/proof/onboarding/batches',{cookie:ac,body:{id:'LOT-01',material:'Steel',inspector:''}})).status,201);
 const inv=await req('/api/proof/onboarding/invitations',{cookie:ac,body:{}});assert.equal(inv.status,201);
 const inspector=await signup({...f.input,role:'inspector',name:'inspector01',invite:inv.body.code});assert.equal(inspector.status,201);
 const catalog=await req('/api/proof/onboarding/catalog',{cookie:ac});assert.equal(catalog.body.batches.length,1);assert.equal(catalog.body.issuanceEnabled,false);
 assert.equal((await req('/api/proof/onboarding/catalog',{cookie:bc})).body.batches.length,0);
 assert.equal((await req('/api/proof/onboarding/issue',{cookie:ac,body:{}})).status,400);
 assert.equal((await req('/api/proof/auth/logout',{cookie:ac,body:{}})).status,200);assert.equal((await req('/api/proof/onboarding/catalog',{cookie:ac})).status,401);
});
