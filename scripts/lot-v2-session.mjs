#!/usr/bin/env node
/** Build 17: local-only persistent signed inspection, with repeatable buyer clearances. */
import process from 'node:process';
import { spawn } from 'node:child_process';
import { randomBytes,createHash } from 'node:crypto';
import { mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jubjubSampleScalar,jubjubSchnorrVerifyingKey } from '@midnight-ntwrk/compact-runtime';
import { loadEncryptedReport } from './lot-private-vault.mjs';
import { verifySavedAttestation,loadInspectorPrivatePem,loadInspectorPublicPem } from './lot-inspector-attestation.mjs';
import { makeV2Delegation,verifyV2Delegation } from './lot-v2-delegation.mjs';
import { signInspectionV2 } from './lot-v2-signing.mjs';
import { checkPolicyForReport,parseVaultProofArgs } from './lot-vault-bridge.mjs';
import { createSessionBridge } from './lot-v2-session-bridge.mjs';
import { saveSession,loadSession,sessionReportDigest,sessionPublic } from './lot-v2-session-store.mjs';
import {receiveV2Authorization} from './lot-v2-browser-auth.mjs';
import { readLocalPublicReceipt } from './lot-public-receipt.mjs';
import { defaultEvidenceFile,storeConfirmedEvidence } from './lot-proof-archive.mjs';
import { summarizeFailedRun } from './lot-test-diagnostics.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HEX=/^[0-9a-f]{64}$/;const TX=/^[0-9a-f]{66}$/;
async function secretPrompt(label){
 if(!process.stdin.isTTY||!process.stdout.isTTY||!process.stdin.setRawMode)throw new Error('Use an interactive Terminal; do not pass passphrases on command line.');
 process.stdout.write(label);const orig=Boolean(process.stdin.isRaw);
 process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((resolve,reject)=>{
  let value='';const cleanup=()=>{process.stdin.removeListener('data',onData);process.stdin.setRawMode(orig);process.stdin.pause();process.stdout.write('\n');};
  function onData(chunk){for(const ch of chunk.toString('utf8')){
   if(ch==='\r'||ch==='\n'){cleanup();resolve(value);return;}
   if(ch==='\u0003'){cleanup();reject(new Error('Canceled.'));return;}
   if(ch==='\b'||ch==='\u007f'){value=value.slice(0,-1);continue;}
   if(ch>=' '&&value.length<1024)value+=ch;
  }}
  process.stdin.on('data',onData);
 });
}
function parseArgs(argv){
 const [mode,...rest]=argv;
 if(mode==='init'&&rest.length===1&&/^LOT-[A-Z0-9-]{1,48}$/.test(rest[0]))return {mode,batchId:rest[0]};
 if(mode==='prove')return {mode,...parseVaultProofArgs(rest)};
 if(mode==='status'&&rest.length===1&&/^LOT-[A-Z0-9-]{1,48}$/.test(rest[0]))return {mode,batchId:rest[0]};
 throw new Error('Usage: npm run vault:session:v2 -- init LOT-3001 | prove LOT-3001 B-02 550 100 | status LOT-3001');
}
async function run(mode,bridgePath,receiptPath,params){
 const runner=path.join(root,'node_modules/vitest/vitest.mjs');
 const env={...process.env,MIDNIGHT_NETWORK:'local',LOT_V2_SESSION_MODE:mode,
   LOT_V2_SESSION_SOCKET:bridgePath,LOT_V2_SESSION_RECEIPT:receiptPath,
   LOT_V2_SESSION_BATCH:params.batchId,LOG_LEVEL:'silent'};
 if(mode==='prove'){
   env.LOT_V2_SESSION_ADDRESS=params.contractAddress;
   env.LOT_V2_SESSION_INSPECTION=params.inspectionTx;
   env.LOT_V2_SESSION_POLICY=params.policyId;
   env.LOT_V2_SESSION_MIN=String(params.minStrength);
   env.LOT_V2_SESSION_MAX=String(params.maxDefectsBps);
 }
 delete env.LOT_LOCAL_PROOF_PAYLOAD;
 const p=spawn(process.execPath,[runner,'run','test/lot.v2.session.network.test.ts'],{cwd:root,env,shell:false,stdio:['ignore','pipe','pipe']});
 let log='',phase='startup';const phases=new Set(['READY','DEPLOYED','INSPECTION','POLICY','CLEARANCE','RECEIPT']);
 for(const stream of [p.stdout,p.stderr]){
   stream.setEncoding('utf8');stream.on('data',s=>{
     log=(log+s).slice(-32768);
     for(const m of s.matchAll(/LOT_V2_SESSION_PHASE:([A-Z]+)/g))if(phases.has(m[1])){
       phase=m[1];console.log('LOT session:',phase.toLowerCase());
       // Emit ONLY an allowlisted phase. No report, passphrase, key, logs or stdout
       // are sent to the browser-facing service.
       if(typeof process.send==='function')process.send({type:'lot-v2-session-phase',phase});
     }
   });
 }
 const status=await new Promise((resolve,reject)=>{p.on('close',resolve);p.on('error',reject);});
 if(status!==0){const result=summarizeFailedRun(log,phase);throw new Error(`Network run failed at ${phase}: ${result.cause}`);}
}
function readInitReceipt(file,batch){
 const r=JSON.parse(readFileSync(file,'utf8'));
 if(!r||Object.keys(r).sort().join('|')!=='contractAddress|inspectionTx'||!HEX.test(r.contractAddress)||!TX.test(r.inspectionTx))throw new Error('Invalid session deployment receipt.');
 return {batchId:batch,contractAddress:r.contractAddress,inspectionTx:r.inspectionTx};
}
async function main(){
 if(process.env.MIDNIGHT_NETWORK&&process.env.MIDNIGHT_NETWORK!=='local')throw new Error('Build 17 is local-devnet only.');
 const input=parseArgs(process.argv.slice(2));
 if(input.mode==='status'){
   const state=sessionPublic(input.batchId);console.log(`LOT V2 SAVED SESSION\nBatch: ${state.batchId}\nContract: ${state.contractAddress}\nInspection TX: ${state.inspectionTx}\nPolicy-admin key remains encrypted.`);return;
 }
 const auth=process.env.LOT_V2_AUTH_PIPE==='1' ? await receiveV2Authorization(process.stdin,input.mode) : null;
 let password=auth ? auth.vaultPassphrase : await secretPrompt('Report vault passphrase (hidden): ');
 const report=loadEncryptedReport(input.batchId,password);
 const evidence=verifySavedAttestation(report);
 let session=null,signer=null,adminSecret;
 if(input.mode==='init'){
   // Fail before any transaction if a previous session already exists.
   try{sessionPublic(input.batchId);throw new Error('A saved V2 session already exists for this batch. Use prove, not init.');}
   catch(e){if(e?.code!=='ENOENT')throw e;}
   let scalar=jubjubSampleScalar();while(scalar===0n)scalar=jubjubSampleScalar();
   const inspectorKey=jubjubSchnorrVerifyingKey(scalar);
   let inspectorPass=auth ? auth.inspectorPassphrase : await secretPrompt('Inspector Ed25519 key passphrase (hidden): ');
   const pub=loadInspectorPublicPem();
   const delegation=makeV2Delegation(report,inspectorKey,loadInspectorPrivatePem(),inspectorPass,pub);
   inspectorPass='';const v=verifyV2Delegation(report,delegation,pub);
   if(evidence.inspector!==v.inspector)throw new Error('Inspector identity mismatch.');
   const batchHash=new Uint8Array(createHash('sha256').update('LOT_BATCH_V1').update(':').update(report.batchId).digest());
   const salt=new Uint8Array(Buffer.from(report.openingSalt,'hex'));
   const signed=signInspectionV2(batchHash,BigInt(report.strengthMpa),BigInt(report.defectBps),salt,scalar);
   scalar=0n;
   adminSecret=randomBytes(32).toString('hex');
   signer={delegation,signature:signed.signature};
 }else{
   const stored=loadSession(input.batchId,password);
   if(stored.public.reportDigest!==sessionReportDigest(report))throw new Error('Saved session does not match encrypted inspection.');
   checkPolicyForReport(report,input);
   session=stored.public;adminSecret=stored.policyAdminSecret;
 }
 const payload={mode:input.mode,report,adminSecret,delegation:signer?.delegation??null,
   signature:signer?.signature??null};
 const bridge=await createSessionBridge(payload),folder=mkdtempSync(path.join(tmpdir(),'lot-v2-session-receipt-'));
 const receiptPath=path.join(folder,'public.json');
 try{
   await run(input.mode,bridge.socketPath,receiptPath,{...input,...session});
   if(!bridge.used)throw new Error('Network process did not consume private report.');
   if(input.mode==='init'){
     const init=readInitReceipt(receiptPath,input.batchId);
     const publicMeta={...init,reportDigest:sessionReportDigest(report)};
     saveSession(publicMeta,adminSecret,password);
     console.log('\nLOT V2 SESSION DEPLOYED');
     console.log('Batch:',input.batchId);
     console.log('Contract:',init.contractAddress);
     console.log('Inspection TX:',init.inspectionTx);
     console.log('Policy-admin key: encrypted locally.');
     console.log('Use prove with a buyer policy to reuse this same contract.');
   }else{
     const receipt=readLocalPublicReceipt(receiptPath,input.batchId,input.policyId,{minStrength:input.minStrength,maxDefectsBps:input.maxDefectsBps});
     if(receipt.contractAddress!==session.contractAddress||receipt.inspectionTx!==session.inspectionTx)throw new Error('Receipt points to another inspection session.');
     const saved=storeConfirmedEvidence(defaultEvidenceFile(root),{id:randomBytes(8).toString('hex'),status:'confirmed',batchId:input.batchId,policyId:input.policyId,receipt});
     console.log('\nLOT V2 EXISTING CONTRACT CLEARANCE SUCCESS');
     console.log('Contract:',receipt.contractAddress);
     console.log('Inspection TX:',receipt.inspectionTx);
     console.log('Policy TX:',receipt.policyTx);
     console.log('Clearance TX:',receipt.clearanceTx);
     console.log('Archive entry:',saved.id);
   }
 }finally{await bridge.close();rmSync(folder,{recursive:true,force:true});password='';}
}
main().catch(e=>{console.error('LOT V2 persistent session:',e instanceof Error?e.message:'Failed.');process.exitCode=1;});
