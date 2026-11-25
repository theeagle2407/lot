import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {listPublicSessions,sealSession} from '../scripts/lot-v2-session-store.mjs';

const mk=()=>mkdtempSync(join(tmpdir(),'lot-v2-signed-list-'));
const address='a'.repeat(64),tx='00'+'b'.repeat(64),digest='c'.repeat(64);
const meta=batchId=>({batchId,contractAddress:address,inspectionTx:tx,reportDigest:digest});
function writeSession(base,batchId){
 const directory=join(base,'v2-sessions');mkdirSync(directory,{recursive:true,mode:0o700});
 writeFileSync(join(directory,`${batchId}.json`),sealSession(meta(batchId),'d'.repeat(64),'passphrase-012345'),{mode:0o600});
 return directory;
}
test('missing session folder gives an empty list',()=>{const root=mk();try{assert.deepEqual(listPublicSessions(join(root,'missing')),[]);}finally{rmSync(root,{recursive:true,force:true});}});
test('lists saved signed batches with only public identifiers',()=>{
 const root=mk();try{
  const dir=writeSession(root,'LOT-3002');writeSession(root,'LOT-3001');
  const items=listPublicSessions(dir);
  assert.deepEqual(items.map(x=>x.batchId),['LOT-3001','LOT-3002']);
  for(const x of items){assert.deepEqual(Object.keys(x).sort(),['batchId','contractAddress','inspectionTx']);}
  assert.ok(!JSON.stringify(items).includes('policyAdminSecret'));
  assert.ok(!JSON.stringify(items).includes('passphrase-012345'));
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('rejects filename that disagrees with authenticated session batch',()=>{
 const root=mk();try{
  const dir=writeSession(root,'LOT-3002');
  const bytes=readFileSync(join(dir,'LOT-3002.json'));writeFileSync(join(dir,'LOT-3003.json'),bytes,{mode:0o600});
  assert.throws(()=>listPublicSessions(dir),/filename mismatch/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('refuses symlinked session files and directory',()=>{
 const root=mk();try{
  const dir=writeSession(root,'LOT-3001');
  symlinkSync(join(dir,'LOT-3001.json'),join(dir,'LOT-3004.json'));
  assert.throws(()=>listPublicSessions(dir),/Unsafe/);
  symlinkSync(dir,join(root,'link'));
  assert.throws(()=>listPublicSessions(join(root,'link')),/Unsafe/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('refuses over-permissive session metadata directory and file',()=>{
 const root=mk();try{
  const dir=writeSession(root,'LOT-3001');
  chmodSync(dir,0o755);assert.throws(()=>listPublicSessions(dir),/Unsafe/);
  chmodSync(dir,0o700);chmodSync(join(dir,'LOT-3001.json'),0o644);assert.throws(()=>listPublicSessions(dir),/Unsafe/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('rejects malformed metadata and invalid json filename',()=>{
 const root=mk();try{
  const dir=writeSession(root,'LOT-3001');
  writeFileSync(join(dir,'oops.json'),'{}',{mode:0o600});
  assert.throws(()=>listPublicSessions(dir),/filename/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('API and UI enforce account boundary and label saved state honestly',()=>{
 const root=new URL('../',import.meta.url);
 const api=readFileSync(new URL('scripts/lot-proof-api.mjs',root),'utf8');
 const ui=readFileSync(new URL('src/App.jsx',root),'utf8');
 const client=readFileSync(new URL('src/v2Session.js',root),'utf8');
 assert.match(api,/requestPath==='\/api\/proof\/v2-sessions'/);
 assert.match(api,/operatorSessions\.fromCookie\(req\.headers\.cookie\)/);
 assert.match(api,/sessions:listPublicSessions\(\)/);
 assert.match(client,/credentials:'same-origin'/);
 assert.match(ui,/Local records/);
 assert.match(ui,/Signed batches/);
 assert.match(ui,/Local network/);
 assert.doesNotMatch(ui,/Sample inspections/);
 assert.match(ui,/operator&&online&&<div className="signed-v2-catalog"/);
});
