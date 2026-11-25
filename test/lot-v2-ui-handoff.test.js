import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {validateV2UiRequest,publicV2Session,publicV2Job,validateV2UiBatch} from '../scripts/lot-v2-ui-core.mjs';
import {createV2UiRunner} from '../scripts/lot-v2-ui-runner.mjs';

const parsed={mode:'prove',batchId:'LOT-3001',policyId:'B-03',minStrength:530,maxDefectsBps:100};
test('V2 browser init sends only a batch and mode, never secrets',()=>{
  const result=validateV2UiRequest({mode:'init',batchId:'LOT-3001'});
  assert.deepEqual(result.args,['init','LOT-3001']);
  assert.ok(!JSON.stringify(result).includes('passphrase'));
});
test('V2 buyer request carries only exact public policy thresholds',()=>{
  const result=validateV2UiRequest(parsed);
  assert.deepEqual(result.args,['prove','LOT-3001','B-03','530','100']);
  assert.ok(!JSON.stringify(result).includes('openingSalt'));
});
test('private report input, password, extra fields are rejected',()=>{
  for(const extra of [{passphrase:'topsecret'}, {strengthMpa:570},{openingSalt:'a'.repeat(64)},{adminSecret:'b'.repeat(64)}]){
    assert.throws(()=>validateV2UiRequest({...parsed,...extra}));
    assert.throws(()=>validateV2UiRequest({mode:'init',batchId:'LOT-3001',...extra}));
  }
});
test('malformed identities and unsafe numeric input are rejected before spawning',()=>{
  for(const input of [
    {...parsed,batchId:'../../etc/passwd'},{...parsed,policyId:'B-01;pwd'},
    {...parsed,minStrength:0},{...parsed,minStrength:1.5},{...parsed,minStrength:'530'},
    {...parsed,maxDefectsBps:-1},{...parsed,maxDefectsBps:10001},
    {...parsed,mode:'unknown'}])assert.throws(()=>validateV2UiRequest(input));
});
test('public session never reveals report digests or policy-admin secrets',()=>{
  const s=publicV2Session({batchId:'LOT-3001',contractAddress:'a'.repeat(64),inspectionTx:'00'+'b'.repeat(64),reportDigest:'c'.repeat(64),policyAdminSecret:'d'.repeat(64)});
  assert.deepEqual(Object.keys(s),['batchId','contractAddress','inspectionTx']);
});
test('public job only returns limited progress, no logs or private arguments',()=>{
  const result=publicV2Job({id:'abc',mode:'prove',batchId:'LOT-3001',policyId:'B-03',status:'running',phase:'Wallet ready',log:'private',passphrase:'secret',args:['private']});
  assert.equal(result.phase,'Wallet ready');
  assert.ok(!JSON.stringify(result).includes('private'));
});
test('validation rejects invalid session identifiers',()=>{
  assert.throws(()=>validateV2UiBatch('../LOT-3001'));
  assert.throws(()=>publicV2Session({batchId:'LOT-3001',contractAddress:'a'.repeat(63),inspectionTx:'00'+'b'.repeat(64)}));
});
test('V2 operations require an interactive Terminal before spawning',()=>{
  let called=false;
  const r=createV2UiRunner('/tmp/lot',{interactive:false,spawnChild:()=>{called=true;}});
  assert.throws(()=>r.start(validateV2UiRequest(parsed)),/interactive Terminal/);
  assert.equal(called,false);
});
test('browser run keeps passphrases off argv, uses inherited TTY, rejects overlapping requests',async()=>{
  let captured;const writes=[];
  const c=new EventEmitter();c.kill=()=>{};
  const r=createV2UiRunner('/tmp/lot',{interactive:true,spawnChild:(cmd,args,opts)=>{captured={cmd,args,opts};return c;},
    output:{write:s=>writes.push(s)},errorOutput:{write:s=>writes.push(s)}});
  const started=r.start(validateV2UiRequest(parsed));
  assert.equal(started.status,'running');
  assert.deepEqual(captured.opts.stdio,['inherit','inherit','inherit','ipc']);
  assert.equal(captured.opts.shell,false);
  assert.deepEqual(captured.args.slice(-5),['prove','LOT-3001','B-03','530','100']);
  assert.ok(!JSON.stringify(captured.args).includes('passphrase'));
  assert.throws(()=>r.start(validateV2UiRequest(parsed)),/already running/);
  c.emit('message',{type:'lot-v2-session-phase',phase:'POLICY'});
  assert.equal(r.status().phase,'Buyer policy finalized');
  c.emit('message',{type:'lot-v2-session-phase',phase:'CLEARANCE',secret:'DO_NOT_RETURN'});
  assert.equal(r.status().phase,'Private clearance finalized');
  assert.ok(!JSON.stringify(r.status()).includes('DO_NOT_RETURN'));
  c.emit('message',{type:'lot-v2-session-phase',phase:'FORGED',passphrase:'DO_NOT_RETURN'});
  assert.equal(r.status().phase,'Private clearance finalized');
  c.emit('message',{type:'unrecognized',phase:'RECEIPT'});
  assert.equal(r.status().phase,'Private clearance finalized');
  c.emit('close',0);
  assert.equal(r.status().status,'completed');
});
test('failed child leaves only generic public failure status',()=>{
  const c=new EventEmitter();c.kill=()=>{};
  const r=createV2UiRunner('/tmp/lot',{interactive:true,spawnChild:()=>c,output:{write:()=>{}},errorOutput:{write:()=>{}}});
  r.start(validateV2UiRequest(parsed));
  c.emit('message',{type:'lot-v2-session-phase',phase:'NOT_REAL',passphrase:'SENSITIVE DETAILS SHOULD REMAIN IN TERMINAL'});
  c.emit('close',1);
  assert.equal(r.status().status,'failed');
  assert.ok(!JSON.stringify(r.status()).includes('SENSITIVE'));
});

test('V2 interactive handoff must inherit stdout and stderr, never pipe prompts',()=>{
  let opts;const c=new EventEmitter();c.kill=()=>{};
  const r=createV2UiRunner('/tmp/lot',{interactive:true,spawnChild:(_cmd,_argv,config)=>{opts=config;return c;},
    output:{write:()=>{}},errorOutput:{write:()=>{}}});
  r.start(validateV2UiRequest({mode:'init',batchId:'LOT-5001'}));
  assert.deepEqual(opts.stdio,['inherit','inherit','inherit','ipc']);
  assert.ok(!('LOT_LOCAL_PROOF_PAYLOAD' in opts.env));
  c.emit('close',0);
});
test('V2 CLI only emits fixed progress over IPC, not secret-bearing child logs',()=>{
  const source=readFileSync(new URL('../scripts/lot-v2-session.mjs',import.meta.url),'utf8');
  assert.match(source,/process\.send\(\{type:'lot-v2-session-phase',phase\}\)/);
  assert.match(source,/typeof process\.send==='function'/);
  assert.doesNotMatch(source,/process\.send\(\{[^}]*report/);
});
