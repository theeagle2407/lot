/** One-use private Unix socket for Build 17. Neither reports nor admin keys enter env/argv. */
import net from 'node:net';
import { once } from 'node:events';
import { chmodSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validatePrivateReport } from './lot-private-vault.mjs';
const RX_HEX=/^[0-9a-f]{64}$/;
const RX_DIGIT=/^(0|[1-9]\d{0,80})$/;
const MAX=13000;
const shape=(x,fields)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join('|')===fields.slice().sort().join('|');
function normalized(payload){
 if(!shape(payload,['mode','report','adminSecret','delegation','signature'])||!['init','prove'].includes(payload.mode)||!RX_HEX.test(payload.adminSecret))throw new Error('Invalid V2 private session payload.');
 const report=validatePrivateReport(payload.report);
 if(payload.mode==='prove'){
   if(payload.delegation!==null||payload.signature!==null)throw new Error('Unexpected signing credential in prove request.');
   return {...payload,report};
 }
 if(!payload.delegation||!shape(payload.signature,['announcement','response'])||!shape(payload.signature.announcement,['x','y']))throw new Error('Missing V2 inspector signature.');
 for(const v of [payload.signature.announcement.x,payload.signature.announcement.y,payload.signature.response])if(typeof v!=='string'||!RX_DIGIT.test(v))throw new Error('Invalid V2 signature encoding.');
 return {...payload,report,signature:{announcement:{x:BigInt(payload.signature.announcement.x),y:BigInt(payload.signature.announcement.y)},response:BigInt(payload.signature.response)}};
}
export function encodeSessionPayload(value){
 let o={...value};
 if(value.mode==='init')o.signature={announcement:{x:String(value.signature.announcement.x),y:String(value.signature.announcement.y)},response:String(value.signature.response)};
 const serialized=JSON.stringify(o);if(Buffer.byteLength(serialized)>MAX)throw new Error('V2 session payload too large.');
 decodeSessionPayload(serialized);return serialized;
}
export function decodeSessionPayload(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>MAX)throw new Error('V2 session payload oversized.');
 let value;try{value=JSON.parse(text);}catch{throw new Error('Invalid V2 session payload JSON.');}
 return normalized(value);
}
export async function createSessionBridge(value){
 const text=encodeSessionPayload(value),dir=mkdtempSync(path.join(tmpdir(),'lot-v2-session-ipc-'));
 chmodSync(dir,0o700);const socketPath=path.join(dir,'session.sock');let used=false,closed=false;
 const server=net.createServer(client=>{if(used){client.destroy();return;}used=true;client.end(text);});
 try{server.listen(socketPath);await once(server,'listening');chmodSync(socketPath,0o600);}catch(e){server.close();rmSync(dir,{recursive:true,force:true});throw e;}
 return {socketPath,get used(){return used;},async close(){if(closed)return;closed=true;server.close();rmSync(dir,{recursive:true,force:true});}};
}
export function receiveSessionBridge(socketPath){
 if(typeof socketPath!=='string'||!socketPath.startsWith('/')||socketPath.length>240)throw new Error('Invalid session socket path.');
 return new Promise((resolve,reject)=>{
   let s='',done=false;const client=net.createConnection({path:socketPath});
   const fail=e=>{if(!done){done=true;reject(e);}};
   client.setTimeout(15000,()=>{client.destroy();fail(new Error('Session IPC timeout.'));});
   client.on('data',chunk=>{s+=chunk.toString('utf8');if(Buffer.byteLength(s)>MAX){client.destroy();fail(new Error('Session IPC oversized.'));}});
   client.on('error',fail);
   client.on('end',()=>{if(done)return;try{const result=decodeSessionPayload(s);done=true;resolve(result);}catch(e){fail(e);}});
 });
}
