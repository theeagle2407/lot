/** Local-only V2 worker runner.
 * Browser-authenticated actions use a one-use child stdin pipe (no TTY needed).
 * Legacy developer CLI actions retain interactive Terminal prompts.
 * Never pass secrets via argv, env, progress IPC or public responses.
 */
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {publicV2Job} from './lot-v2-ui-core.mjs';
import {encodeV2Authorization} from './lot-v2-browser-auth.mjs';

const PUBLIC_PHASES=Object.freeze({
 READY:'Wallet ready',DEPLOYED:'Contract deployed',
 INSPECTION:'Signed inspection finalized',POLICY:'Buyer policy finalized',
 CLEARANCE:'Private clearance finalized',RECEIPT:'Public receipt saved'
});

export function createV2UiRunner(root,{spawnChild=spawn,output=process.stdout,errorOutput=process.stderr,interactive=Boolean(process.stdin.isTTY && process.stdout.isTTY)}={}){
 let child=null,job=null;
 function active(){return job?.status==='running';}
 function start(input,authorization=null){
   if(active())throw new Error('A signed V2 operation is already running.');
   // A Buffer holds the one-shot payload only until queued to child stdin.
   const payload=authorization ? Buffer.from(encodeV2Authorization(authorization,input.mode),'utf8') : null;
   if(!payload && !interactive)
     throw new Error('Run npm run proof:serve in an interactive Terminal to authorize signed operations.');
   const next={id:randomBytes(8).toString('hex'),mode:input.mode,batchId:input.batchId,
     policyId:input.policyId,status:'running',phase:payload?'Authorizing encrypted report':'Enter passphrase in the proof-service Terminal'};
   job=next;
   const script=path.join(root,'scripts','lot-v2-session.mjs');
   // Interactive fallback needs a TTY; browser authorization never needs one.
   // Node IPC only carries fixed progress identifiers, never secret data.
   const env={...process.env,MIDNIGHT_NETWORK:'local'};
   delete env.LOT_LOCAL_PROOF_PAYLOAD;
   if(payload)env.LOT_V2_AUTH_PIPE='1'; else delete env.LOT_V2_AUTH_PIPE;
   try{child=spawnChild(process.execPath,[script,...input.args],{
      cwd:root,env,shell:false,stdio:payload?['pipe','inherit','inherit','ipc']:['inherit','inherit','inherit','ipc']
   });}
   catch{payload?.fill(0);job.status='failed';job.phase='Unable to start signed operation';child=null;return publicV2Job(job);}
   if(payload){
     // stdout/stderr remain attached to the local service, not the browser.
     // Only the child's stdin receives this one-use encoded authorization.
     child.stdin.on('error',()=>{});
     child.stdin.end(payload,()=>payload.fill(0));
     output.write(`\n[LOT V2] ${input.mode==='init'?'Registering signed inspection':'Proving buyer policy'}: ${input.batchId}. Browser authorization received locally.\n`);
   }else{
     output.write(`\n[LOT V2] ${input.mode==='init'?'Registering signed inspection':'Proving buyer policy'}: ${input.batchId}. Enter hidden passphrases here.\n`);
   }
   // IPC messages are trusted only as fixed, non-sensitive phase names.
   child.on('message',message=>{
     if(!message||message.type!=='lot-v2-session-phase'||typeof message.phase!=='string')return;
     if(Object.hasOwn(PUBLIC_PHASES,message.phase))next.phase=PUBLIC_PHASES[message.phase];
   });
   let done=false;
   function finish(ok){
     if(done)return;done=true;
     next.status=ok?'completed':'failed';
     next.phase=ok?'Completed · Refresh Buyer view':'Stopped · See local service logs';
     child=null;
   }
   child.on('close',code=>finish(code===0));
   child.on('error',()=>finish(false));
   return publicV2Job(next);
 }
 function stop(){if(child)child.kill('SIGTERM');}
 return {start,stop,active,status:()=>publicV2Job(job)};
}
