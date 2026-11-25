/** One-use local Unix socket transport; sends report + PUBLIC signature, never the Jubjub scalar. */
import net from 'node:net';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { validatePrivateReport } from './lot-private-vault.mjs';
const MAX=8192;
const DIGITS=/^(0|[1-9]\d{0,80})$/;
const keys = x => Object.keys(x||{}).sort().join('|');
const strict=(obj,fields)=>obj && typeof obj==='object' && !Array.isArray(obj) && keys(obj)===fields.slice().sort().join('|');
export function encodeV2SignedReport(reportInput, signature, delegation) {
  const report=validatePrivateReport(reportInput);
  if(!strict(signature,['announcement','response']) || !strict(signature.announcement,['x','y']) ||
    typeof signature.announcement.x!=='bigint'||typeof signature.announcement.y!=='bigint'||
    typeof signature.response!=='bigint')throw new Error('Invalid V2 signature object.');
  const payload={report,delegation,signature:{
    announcement:{x:String(signature.announcement.x),y:String(signature.announcement.y)},
    response:String(signature.response),
  }};
  const text=JSON.stringify(payload);
  if(Buffer.byteLength(text)>MAX) throw new Error('Private payload too large.');
  return text;
}
export function decodeV2SignedReport(raw) {
  if(typeof raw!=='string'||Buffer.byteLength(raw)>MAX)throw new Error('Invalid private payload length.');
  let obj;
  try{obj=JSON.parse(raw);}catch{throw new Error('Invalid private bridge JSON.');}
  if(!strict(obj,['report','delegation','signature'])||!strict(obj.signature,['announcement','response'])||
    !strict(obj.signature.announcement,['x','y']))throw new Error('Invalid private signed report format.');
  for(const item of [obj.signature.response,obj.signature.announcement.x,obj.signature.announcement.y]){
    if(typeof item!=='string'||!DIGITS.test(item))throw new Error('Malformed signature scalar or coordinates.');
  }
  return {
    report:validatePrivateReport(obj.report),delegation:obj.delegation,
    signature:{announcement:{x:BigInt(obj.signature.announcement.x),y:BigInt(obj.signature.announcement.y)},
      response:BigInt(obj.signature.response)},
  };
}
export async function createOneUseV2Bridge(report,signature,delegation){
  const payload=encodeV2SignedReport(report,signature,delegation);
  const dir=mkdtempSync(path.join(tmpdir(),'lot-v2-ipc-'));chmodSync(dir,0o700);
  const socketPath=path.join(dir,'report.sock');let used=false,closed=false;
  const server=net.createServer(client=>{
    if(used){client.destroy();return;}
    used=true;client.end(payload);
  });
  try {server.listen(socketPath);await once(server,'listening');chmodSync(socketPath,0o600);}
  catch(err){server.close();rmSync(dir,{recursive:true,force:true});throw err;}
  return {socketPath,get used(){return used;},async close(){
    if(closed)return;closed=true;server.close();rmSync(dir,{recursive:true,force:true});
  }};
}
export async function receiveOneUseV2SignedReport(socketPath){
  if(typeof socketPath!=='string'||!socketPath.startsWith('/')||socketPath.length>240)
    throw new Error('Invalid local private socket path.');
  return new Promise((resolve,reject)=>{
    let data='',done=false;
    const client=net.createConnection({path:socketPath});
    const fail=err=>{if(!done){done=true;reject(err);}};
    client.setTimeout(15000,()=>{client.destroy();fail(new Error('V2 bridge timeout.'));});
    client.on('data',chunk=>{data+=chunk.toString('utf8');if(Buffer.byteLength(data)>MAX){client.destroy();fail(new Error('Oversized V2 bridge.'));}});
    client.on('error',fail);
    client.on('end',()=>{if(done)return;try{const value=decodeV2SignedReport(data);done=true;resolve(value);}catch(err){fail(err);}});
  });
}
