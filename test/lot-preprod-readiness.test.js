import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,lstatSync,writeFileSync,symlinkSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PREPROD,validateProjectToken,preprodIndexerUrls,parsePublicAuditArgs,pingPreprodIndexer} from '../scripts/lot-preprod-core.mjs';
import {saveProjectToken,loadProjectToken,projectCredentialPath} from '../scripts/lot-preprod-credentials.mjs';
const sampleToken='PREPROD_SECRET_TOKEN_NOT_TO_PRINT_12345';
const sampleArgs=['LOT-3003','B-01','530','100','a'.repeat(64)];
function folder(){return mkdtempSync(join(tmpdir(),'lot-preprod-test-'));}

test('fixed Preprod URLs cannot be redirected to localhost or Mainnet',()=>{
 assert.equal(PREPROD.id,'preprod');
 const u=preprodIndexerUrls(sampleToken);
 assert.equal(new URL(u.http).origin,'https://midnight-preprod.blockfrost.io');
 assert.equal(new URL(u.ws).origin,'wss://midnight-preprod.blockfrost.io');
 assert.equal(new URL(u.http).searchParams.get('project_id'),sampleToken);
 assert.equal(u.http.includes('mainnet'),false);
});
test('reject injection, empty, malformed and suspicious Blockfrost project tokens',()=>{
 for(const token of ['', 'short','anything?project_id=foo','abc.example.notallowed',
   'token\nBEARER LEAK 123456','foo/bar/baz123456',' '.repeat(40),42,null])
  assert.throws(()=>validateProjectToken(token));
 assert.equal(validateProjectToken(sampleToken),sampleToken);
});
test('read-only health query sends only a fixed GraphQL introspection operation',async()=>{
 let called=0;
 const result=await pingPreprodIndexer(sampleToken,async(url,opts)=>{
  called++;
  assert.equal(new URL(url).hostname,'midnight-preprod.blockfrost.io');
  assert.equal(opts.method,'POST');
  assert.equal(opts.redirect,'error');
  assert.deepEqual(JSON.parse(opts.body),{query:'query LotPreprodHealth { __typename }'});
  assert.equal(opts.body.includes(sampleToken),false);
  return {status:200,json:async()=>({data:{__typename:'Query'}})};
 });
 assert.equal(called,1);assert.deepEqual(result,{ok:true,network:'preprod',indexer:'Blockfrost',operation:'read-only'});
});
test('health query fails closed on bad auth, GraphQL errors, malformed data and network errors',async()=>{
 for(const response of [{status:401},{status:410},{status:200,json:async()=>({errors:[{message:'private token 123'}]})},
  {status:200,json:async()=>({data:{}})}])
  await assert.rejects(pingPreprodIndexer(sampleToken,async()=>response));
 await assert.rejects(pingPreprodIndexer(sampleToken,async()=>{throw Error(sampleToken);}),e=>{
  assert.equal(e.message.includes(sampleToken),false);return true;
 });
});
test('strict public Preprod audit arguments reject local-network labels and unsafe values',()=>{
 const parsed=parsePublicAuditArgs(sampleArgs);
 assert.deepEqual(parsed,{batchId:'LOT-3003',policyId:'B-01',minStrength:530,maxDefectsBps:100,contractAddress:'a'.repeat(64)});
 for(const args of [[],[...sampleArgs,'extra'],['../../local',...sampleArgs.slice(1)],
 ['LOT-3003','B-01','NaN','100','a'.repeat(64)],
 ['LOT-3003','B-01','530','10001','a'.repeat(64)],
 ['LOT-3003','B-01','530','100','a'.repeat(66)],
 ['LOT-3003','B-01','530','100','https://localhost:4175']])
  assert.throws(()=>parsePublicAuditArgs(args));
});
test('credential is saved with owner-only permissions and restored without changing the token',()=>{
 const base=folder();try{
  assert.equal(loadProjectToken({base,env:{}}),null);
  const path=saveProjectToken(sampleToken,{base});
  assert.equal(path,projectCredentialPath(base));
  assert.equal(lstatSync(path).mode&0o077,0);
  assert.equal(lstatSync(base).mode&0o077,0);
  assert.equal(loadProjectToken({base,env:{}}),sampleToken);
  assert.equal(loadProjectToken({base,env:{BLOCKFROST_PROJECT_ID:'OTHER_PREPROD_TOKEN_123456789'}}),'OTHER_PREPROD_TOKEN_123456789');
  assert.equal(readFileSync(path,'utf8').includes(sampleToken),true);
 }finally{rmSync(base,{recursive:true,force:true});}
});
test('saving a second token refuses overwrite unless explicitly requested',()=>{
 const base=folder();try{
  saveProjectToken(sampleToken,{base});
  assert.throws(()=>saveProjectToken('ANOTHER_PREPROD_TOKEN_987654321',{base}),e=>e.code==='EEXIST');
  assert.equal(loadProjectToken({base,env:{}}),sampleToken);
  saveProjectToken('ANOTHER_PREPROD_TOKEN_987654321',{base,replace:true});
  assert.equal(loadProjectToken({base,env:{}}),'ANOTHER_PREPROD_TOKEN_987654321');
 }finally{rmSync(base,{recursive:true,force:true});}
});
test('world-readable or symlinked credential files are refused',()=>{
 const base=folder();try{
  const path=saveProjectToken(sampleToken,{base});
  chmodSync(path,0o644);
  assert.throws(()=>loadProjectToken({base,env:{}}));
  chmodSync(path,0o600);
  rmSync(path);
  const target=join(base,'other.json');writeFileSync(target,'{}',{mode:0o600});
  symlinkSync(target,path);
  assert.throws(()=>loadProjectToken({base,env:{}}));
 }finally{rmSync(base,{recursive:true,force:true});}
});
test('credential schema is strict and no private report fields are accepted',()=>{
 const base=folder();try{
  saveProjectToken(sampleToken,{base});
  const path=projectCredentialPath(base);
  writeFileSync(path,JSON.stringify({kind:'LOT_PREPROD_BLOCKFROST',version:1,network:'preprod',projectId:sampleToken,privateReport:'secret'}));
  assert.throws(()=>loadProjectToken({base,env:{}}));
 }finally{rmSync(base,{recursive:true,force:true});}
});
