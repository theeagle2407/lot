import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,symlinkSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {sealSession,openSession,saveSession,loadSession,sessionPublic,sessionReportDigest} from '../scripts/lot-v2-session-store.mjs';
import {createSessionBridge,decodeSessionPayload,receiveSessionBridge} from '../scripts/lot-v2-session-bridge.mjs';
const password='a long sample passphrase 2026';
const meta=()=>({batchId:'LOT-3001',contractAddress:'a'.repeat(64),inspectionTx:'00'+'b'.repeat(64),reportDigest:'c'.repeat(64)});
const adminSecret='f'.repeat(64);
const report={batchId:'LOT-3001',material:'Steel',strengthMpa:570,defectBps:80,openingSalt:'a'.repeat(64)};
test('session key is encrypted and round-trips only with valid password',()=>{
 const txt=sealSession(meta(),adminSecret,password);
 assert.doesNotMatch(txt,new RegExp(adminSecret));
 assert.equal(openSession(txt,password).policyAdminSecret,adminSecret);
 assert.throws(()=>openSession(txt,'incorrect password 2026'),/Wrong session passphrase/);
});
test('changing public contract address invalidates authentication',()=>{
 const txt=JSON.parse(sealSession(meta(),adminSecret,password));txt.public.contractAddress='d'.repeat(64);
 assert.throws(()=>openSession(JSON.stringify(txt),password),/Wrong session passphrase/);
});
test('changing report fingerprint or TX invalidates authentication',()=>{
 for(const field of ['inspectionTx','reportDigest']){
  const txt=JSON.parse(sealSession(meta(),adminSecret,password));txt.public[field]=field==='inspectionTx'?'00'+'d'.repeat(64):'d'.repeat(64);
  assert.throws(()=>openSession(JSON.stringify(txt),password),/Wrong session passphrase/);
 }
});
test('rejects malformed metadata and admin keys',()=>{
 assert.throws(()=>sealSession({...meta(),strengthMpa:570},adminSecret,password),/Invalid V2 public session/);
 assert.throws(()=>sealSession(meta(),'short',password),/Invalid policy-admin key/);
 assert.throws(()=>sealSession(meta(),adminSecret,'short'),/Passphrase/);
});
test('session persists to restricted file and will not overwrite',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'lot-session-test-'));
 try{
  const file=saveSession(meta(),adminSecret,password,dir);
  assert.equal(statSync(file).mode&0o777,0o600);
  assert.equal(sessionPublic('LOT-3001',dir).contractAddress,meta().contractAddress);
  assert.equal(loadSession('LOT-3001',password,dir).policyAdminSecret,adminSecret);
  assert.throws(()=>saveSession(meta(),adminSecret,password,dir),/EEXIST/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('refuses to follow a linked session file',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'lot-session-link-'));
 try{
   const target=path.join(dir,'target.txt');writeFileSync(target,sealSession(meta(),adminSecret,password));
   symlinkSync(target,path.join(dir,'LOT-3001.json'));
   assert.throws(()=>loadSession('LOT-3001',password,dir),/Unsafe V2 session file/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('fingerprint changes with report changes',()=>{
 assert.notEqual(sessionReportDigest(report),sessionReportDigest({...report,strengthMpa:571}));
});
test('prove bridge never includes credentials unrelated to buyer proof',()=>{
 const text=JSON.stringify({mode:'prove',report,adminSecret,delegation:null,signature:null});
 assert.equal(decodeSessionPayload(text).mode,'prove');
 assert.throws(()=>decodeSessionPayload(JSON.stringify({...JSON.parse(text),delegation:{}})),/Unexpected signing credential/);
});
test('bridge rejects invalid signature fields',()=>{
 assert.throws(()=>decodeSessionPayload(JSON.stringify({mode:'init',report,adminSecret,delegation:{},signature:{announcement:{x:'xyz',y:'1'},response:'1'}})),/Invalid V2 signature encoding/);
});
test('one-use Unix bridge returns private payload once',async()=>{
 const bridge=await createSessionBridge({mode:'prove',report,adminSecret,delegation:null,signature:null});
 try{
   const value=await receiveSessionBridge(bridge.socketPath);
   assert.equal(value.report.strengthMpa,570);
   assert.equal(value.adminSecret,adminSecret);
   assert.equal(bridge.used,true);
 }finally{await bridge.close();}
});
