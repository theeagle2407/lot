import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {
 validateV2Authorization,validateV2AuthorizedRequest,
 encodeV2Authorization,decodeV2Authorization,receiveV2Authorization
} from '../scripts/lot-v2-browser-auth.mjs';
import {createV2UiRunner} from '../scripts/lot-v2-ui-runner.mjs';
const vault='my long vault passphrase';
const inspector='another long key passphrase';
const publicProof={mode:'prove',batchId:'LOT-3001',policyId:'B-04',minStrength:530,maxDefectsBps:100};
const publicInit={mode:'init',batchId:'LOT-4001'};
const auth={vaultPassphrase:vault};

test('browser can authorize a buyer proof with one encrypted-report passphrase',()=>{
 const v=validateV2AuthorizedRequest({input:publicProof,authorization:auth});
 assert.deepEqual(v.input.args,['prove','LOT-3001','B-04','530','100']);
 assert.deepEqual(v.authorization,auth);
});
test('new signed inspection requires two distinct passphrase inputs',()=>{
 const v=validateV2AuthorizedRequest({input:publicInit,authorization:{vaultPassphrase:vault,inspectorPassphrase:inspector}});
 assert.deepEqual(v.input.args,['init','LOT-4001']);
 assert.equal(v.authorization.inspectorPassphrase,inspector);
 assert.throws(()=>validateV2Authorization(auth,'init'));
});
test('browser authorization rejects extra identity and private report fields',()=>{
 for(const extra of [{secret:'123'},{adminSecret:'a'.repeat(64)},{openingSalt:'x'.repeat(64)}]){
  assert.throws(()=>validateV2AuthorizedRequest({input:publicProof,authorization:{...auth,...extra}}));
  assert.throws(()=>validateV2AuthorizedRequest({input:{...publicProof,...extra},authorization:auth}));
 }
 assert.throws(()=>validateV2AuthorizedRequest({input:publicProof,authorization:auth,unexpected:true}));
});
test('weak, oversized and control-containing passphrases are rejected',()=>{
 for(const value of ['too-short','a'.repeat(1025),'first\nsecond\nthird','abc\u0000defghijkl'])
  assert.throws(()=>validateV2Authorization({vaultPassphrase:value},'prove'));
 assert.throws(()=>validateV2Authorization({vaultPassphrase:vault,inspectorPassphrase:inspector},'prove'));
});
test('one-use authorization payload binds to its exact operation',()=>{
 const encoded=encodeV2Authorization(auth,'prove');
 assert.deepEqual(decodeV2Authorization(encoded,'prove'),auth);
 assert.throws(()=>decodeV2Authorization(encoded,'init'));
 assert.throws(()=>decodeV2Authorization(encoded+'garbage','prove'));
 assert.throws(()=>decodeV2Authorization('not json\n','prove'));
});
test('private pipe decodes a single limited passphrase message',async()=>{
 const message=encodeV2Authorization({vaultPassphrase:vault,inspectorPassphrase:inspector},'init');
 assert.deepEqual(await receiveV2Authorization(Readable.from([Buffer.from(message)]),'init'),
 {vaultPassphrase:vault,inspectorPassphrase:inspector});
 await assert.rejects(receiveV2Authorization(Readable.from([Buffer.alloc(2500,65)]),'init'),/limit/);
});
test('browser-authorized proof works without an interactive Terminal and never logs passwords',()=>{
 let cfg=null;let argv=null;let command=null;const child=new EventEmitter();
 let data='';child.stdin={on:()=>{},end:(buffer,done)=>{data=buffer.toString('utf8');done?.();}};
 child.kill=()=>{};
 const logs=[];
 const runner=createV2UiRunner('/tmp/lot',{interactive:false,spawnChild:(cmd,args,opts)=>{cfg=opts;argv=args;command=cmd;return child;},
 output:{write:s=>logs.push(s)}});
 const job=runner.start({mode:'prove',batchId:'LOT-3001',policyId:'B-04',args:['prove','LOT-3001','B-04','530','100']},auth);
 assert.equal(job.status,'running');assert.equal(typeof command,'string');
 assert.deepEqual(cfg.stdio,['pipe','inherit','inherit','ipc']);
 assert.equal(cfg.env.LOT_V2_AUTH_PIPE,'1');
 assert.ok(!JSON.stringify(cfg.env).includes(vault));
 assert.ok(!JSON.stringify(argv).includes(vault));
 assert.deepEqual(decodeV2Authorization(data,'prove'),auth);
 assert.ok(!JSON.stringify(job).includes(vault));
 assert.ok(!logs.join('').includes(vault));
 child.emit('message',{type:'lot-v2-session-phase',phase:'CLEARANCE'});
 assert.equal(runner.status().phase,'Private clearance finalized');
 child.emit('close',0);
 assert.equal(runner.status().status,'completed');
});
test('invalid authorizations fail before starting a worker',()=>{
 let spawned=false;
 const runner=createV2UiRunner('/tmp/lot',{interactive:false,spawnChild:()=>{spawned=true;}});
 assert.throws(()=>runner.start({mode:'prove',batchId:'LOT-3001',args:['prove']},{vaultPassphrase:'weak'}));
 assert.equal(spawned,false);
});
test('local API still rejects cross-origin requests and requires a CSRF token',()=>{
 const api=readFileSync(new URL('../scripts/lot-proof-api.mjs',import.meta.url),'utf8');
 assert.match(api,/req\.headers\.origin/);
 assert.match(api,/req\.headers\['x-lot-csrf'\]!==csrf/);
 assert.match(api,/server\.listen\(port,'127\.0\.0\.1'/);
 assert.match(api,/validateV2AuthorizedRequest/);
 assert.match(api,/authStarts\.length>=12/);
});
test('browser form does not persist passphrases or include them in routes or status',()=>{
 const ui=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
 const api=readFileSync(new URL('../src/v2Session.js',import.meta.url),'utf8');
 assert.match(ui,/type="password"/);
 assert.match(ui,/Authorize & continue/);
 assert.match(api,/JSON\.stringify\(\{input,authorization\}\)/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage/);
 assert.doesNotMatch(api,/localStorage|sessionStorage/);
 assert.match(api,/referrerPolicy:'no-referrer'/);
});
test('real Node child accepts authorization by stdin without a TTY',async()=>{
 const {spawn}=await import('node:child_process');
 const moduleHref=new URL('../scripts/lot-v2-browser-auth.mjs',import.meta.url).href;
 const code=`import {receiveV2Authorization} from ${JSON.stringify(moduleHref)};
 const a=await receiveV2Authorization(process.stdin,'prove');
 if(a.vaultPassphrase!==${JSON.stringify(vault)})process.exitCode=7;
 else process.stdout.write('authorized');`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);
 child.stdin.end(encodeV2Authorization(auth,'prove'));
 const codeResult=await new Promise((resolve,reject)=>{child.on('close',resolve);child.on('error',reject)});
 assert.equal(codeResult,0,stderr);assert.equal(stdout,'authorized');
 assert.ok(!stdout.includes(vault));
});
