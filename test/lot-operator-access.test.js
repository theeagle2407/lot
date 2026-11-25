import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,statSync,symlinkSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  createLocalOperator,resetLocalOperatorPassword,authenticateLocalOperator,listLocalOperators,operatorStorePath,
  createLocalOperatorSessions,roleForAction,validateOperatorPassword,validateOperatorUsername,LOCAL_COOKIE
} from '../scripts/lot-operator-access.mjs';

const password='This-is-a-demo-password-2026';
function workspace(){const dir=mkdtempSync(join(tmpdir(),'lot-operator-test-'));return {dir,file:join(dir,'accounts','users.json'),cleanup:()=>rmSync(dir,{recursive:true,force:true})};}

test('username, password, and roles must be validated',()=>{
 for(const name of ['','ABCD','ab','admin@example.com','a..','a'.repeat(33)])assert.throws(()=>validateOperatorUsername(name));
 for(const secret of ['short','a'.repeat(513),'abcdefghijklmn\n'])assert.throws(()=>validateOperatorPassword(secret));
 const w=workspace();try{assert.throws(()=>createLocalOperator({name:'worker01',role:'buyer',password,file:w.file}));}
 finally{w.cleanup();}
});

test('inspector and manufacturer accounts store only salted password hashes',()=>{
 const w=workspace();try{
  createLocalOperator({name:'inspector01',role:'inspector',password,file:w.file});
  createLocalOperator({name:'maker01',role:'manufacturer',password,file:w.file});
  const data=readFileSync(w.file,'utf8');
  assert.ok(!data.includes(password));
  assert.deepEqual(listLocalOperators(w.file),[{name:'inspector01',role:'inspector'},{name:'maker01',role:'manufacturer'}]);
  assert.equal(statSync(w.file).mode&0o077,0);
  assert.equal(statSync(join(w.dir,'accounts')).mode&0o077,0);
  assert.deepEqual(authenticateLocalOperator({name:'maker01',password,file:w.file}),{name:'maker01',role:'manufacturer'});
  assert.equal(authenticateLocalOperator({name:'maker01',password:'wrong',file:w.file}),null);
 }finally{w.cleanup();}
});

test('password hash includes a unique salt, no overwrite or role escalation',()=>{
 const w=workspace();try{
  createLocalOperator({name:'maker01',role:'manufacturer',password,file:w.file});
  createLocalOperator({name:'maker02',role:'manufacturer',password,file:w.file});
  const users=JSON.parse(readFileSync(w.file,'utf8')).users;
  assert.notEqual(users[0].salt,users[1].salt);
  assert.notEqual(users[0].hash,users[1].hash);
  assert.throws(()=>createLocalOperator({name:'maker01',role:'inspector',password,file:w.file}),/exists/);
  assert.deepEqual(listLocalOperators(w.file).find(x=>x.name==='maker01'),{name:'maker01',role:'manufacturer'});
 }finally{w.cleanup();}
});

test('tampered or unsafe account store fails closed',()=>{
 const w=workspace();try{
  createLocalOperator({name:'inspector01',role:'inspector',password,file:w.file});
  const content=readFileSync(w.file,'utf8');
  chmodSync(w.file,0o644);
  assert.throws(()=>listLocalOperators(w.file),/Unsafe/);
  chmodSync(w.file,0o600);
  writeFileSync(w.file,content.replace('\"role\":\"inspector\"','\"role\":\"unauthorized\"'));
  assert.throws(()=>listLocalOperators(w.file),/Invalid operator record/);
 }finally{w.cleanup();}
});

test('symlinked account file cannot be read',()=>{
 const w=workspace();try{
  mkdirSync(join(w.dir,'accounts'),{mode:0o700});
  const target=join(w.dir,'other.json');writeFileSync(target,'{}');
  symlinkSync(target,w.file);
  assert.throws(()=>listLocalOperators(w.file),/Unsafe/);
 }finally{w.cleanup();}
});

test('new session uses HttpOnly, SameSite=Strict, no JavaScript token',()=>{
 let time=1000000;
 const sessions=createLocalOperatorSessions({now:()=>time});
 const cookie=sessions.start({name:'inspector01',role:'inspector'});
 assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
 assert.match(cookie,/Path=\/api\/proof/);assert.doesNotMatch(cookie,/Domain=/);
 assert.match(LOCAL_COOKIE,/Max-Age=0/);
 assert.ok(!cookie.includes('inspector01'));
 const header=cookie.split(';')[0];
 assert.deepEqual(sessions.fromCookie(header),{name:'inspector01',role:'inspector'});
 assert.equal(sessions.fromCookie('lot_operator='+ 'f'.repeat(64)),null);
 assert.equal(sessions.fromCookie(`${header}; ${header}`),null);
 sessions.revoke(header);assert.equal(sessions.fromCookie(header),null);
});

test('operator session expires on idle or absolute lifetime',()=>{
 let time=0;const sessions=createLocalOperatorSessions({now:()=>time});
 const cookie=sessions.start({name:'maker01',role:'manufacturer'}).split(';')[0];
 time=44*60*1000;assert.ok(sessions.fromCookie(cookie));
 time=90*60*1000;assert.equal(sessions.fromCookie(cookie),null);
 const fresh=sessions.start({name:'maker01',role:'manufacturer'}).split(';')[0];
 for(let i=0;i<12;i++){time+=44*60*1000;sessions.fromCookie(fresh);}
 assert.equal(sessions.fromCookie(fresh),null);
});

test('backend roles apply to every proof write and are never browser-supplied',()=>{
 assert.equal(roleForAction('/api/proof/v2-session/authorize','init'),'inspector');
 assert.equal(roleForAction('/api/proof/v2-session/authorize','prove'),'manufacturer');
 assert.equal(roleForAction('/api/proof/v2-session/run','init'),'inspector');
 assert.equal(roleForAction('/api/proof/v2-session/run','prove'),'manufacturer');
 assert.equal(roleForAction('/api/proof/run'),'manufacturer');
 assert.equal(roleForAction('/api/proof/v2-session/authorize','status'),null);
});

test('account namespace is stable and isolated per project',()=>{
 const p=operatorStorePath('/var/tmp/lot1','/tmp/operator-home');
 assert.equal(p,operatorStorePath('/var/tmp/lot1','/tmp/operator-home'));
 assert.notEqual(p,operatorStorePath('/var/tmp/lot2','/tmp/operator-home'));
});

test('API enforces server-issued session on every proof-writing endpoint',()=>{
 const api=readFileSync(new URL('../scripts/lot-proof-api.mjs',import.meta.url),'utf8');
 assert.match(api,/operatorSessions\.fromCookie\(req\.headers\.cookie\)/);
 assert.match(api,/actor\.role!==roleForAction\(requestPath,input\.mode\)/);
 assert.match(api,/requestPath==='\/api\/proof\/run'&&actor\.role!==roleForAction/);
 assert.match(api,/if\(!actor\)return reply\(res,401/);
 assert.match(api,/auth\/login/);
 assert.match(api,/auth\/logout/);
 assert.match(api,/set-cookie/);
});

test('browser never stores credentials and uses role-specific navigation',()=>{
 const client=readFileSync(new URL('../src/operator.js',import.meta.url),'utf8');
 const jsx=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
 assert.match(client,/credentials:'same-origin'/);
 assert.doesNotMatch(client,/localStorage|sessionStorage/);
 assert.match(jsx,/Sign in to LOT/);
 assert.match(jsx,/operator\?\.role!=='inspector'/);
 assert.match(jsx,/operator\?\.role!=='manufacturer'/);
 assert.match(jsx,/const nav=inspector\?\[\{id:'batches',label:'Inspections'/);
 assert.match(jsx,/id:'clearances',label:'Clearances'/);
 const onboarding=readFileSync(new URL('../src/Onboarding.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(jsx+onboarding,/localStorage\.setItem|sessionStorage\.setItem/);
});

test('local administrator password reset retains role and other accounts',()=>{
 const w=workspace();try{
  createLocalOperator({name:'inspector01',role:'inspector',password,file:w.file});
  createLocalOperator({name:'maker01',role:'manufacturer',password,file:w.file});
  const before=JSON.parse(readFileSync(w.file,'utf8'));
  const newPassword='New-manufacturer-password-2026';
  assert.deepEqual(resetLocalOperatorPassword({name:'maker01',password:newPassword,file:w.file}),{name:'maker01',role:'manufacturer'});
  assert.equal(authenticateLocalOperator({name:'maker01',password,file:w.file}),null);
  assert.deepEqual(authenticateLocalOperator({name:'maker01',password:newPassword,file:w.file}),{name:'maker01',role:'manufacturer'});
  assert.deepEqual(authenticateLocalOperator({name:'inspector01',password,file:w.file}),{name:'inspector01',role:'inspector'});
  const after=JSON.parse(readFileSync(w.file,'utf8'));
  assert.deepEqual(after.users[0],before.users[0]);
  assert.equal(after.users[1].role,'manufacturer');
  assert.notEqual(after.users[1].salt,before.users[1].salt);
  assert.notEqual(after.users[1].hash,before.users[1].hash);
  assert.equal(statSync(w.file).mode&0o077,0);
  assert.throws(()=>resetLocalOperatorPassword({name:'missing01',password:newPassword,file:w.file}),/not found/);
  assert.throws(()=>resetLocalOperatorPassword({name:'maker01',password:'short',file:w.file}),/14/);
 }finally{w.cleanup();}
});

test('password recovery refuses unsafe user store',()=>{
 const w=workspace();try{
  createLocalOperator({name:'maker01',role:'manufacturer',password,file:w.file});
  chmodSync(w.file,0o644);
  assert.throws(()=>resetLocalOperatorPassword({name:'maker01',password,file:w.file}),/Unsafe/);
 }finally{w.cleanup();}
});
