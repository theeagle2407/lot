/** Build 21 — local, single-user authorization for an encrypted V2 report.
 * Passphrases are transferred once from a localhost browser request to the local
 * V2 child over stdin. They must never be present in argv, env, logs or receipts.
 * This is NOT an internet authentication or multi-tenant security boundary.
 */
import {validateV2UiRequest} from './lot-v2-ui-core.mjs';

function exactObject(x,keys){
 return x!==null && typeof x==='object' && !Array.isArray(x) &&
   Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
}
function passphrase(value){
 if(typeof value!=='string'||value.length<12||value.length>1024||/[\u0000-\u001f\u007f]/.test(value))
   throw new Error('Passphrase must contain 12–1024 characters, without control characters.');
 return value;
}
export function validateV2Authorization(auth,mode){
 if(mode==='prove'){
  if(!exactObject(auth,['vaultPassphrase']))throw new Error('Expected one report-vault passphrase.');
  return {vaultPassphrase:passphrase(auth.vaultPassphrase)};
 }
 if(mode==='init'){
  if(!exactObject(auth,['vaultPassphrase','inspectorPassphrase']))throw new Error('Both report and inspector passphrases are required.');
  return {vaultPassphrase:passphrase(auth.vaultPassphrase),inspectorPassphrase:passphrase(auth.inspectorPassphrase)};
 }
 throw new Error('Unsupported authorization operation.');
}
export function validateV2AuthorizedRequest(raw){
 if(!exactObject(raw,['input','authorization']))throw new Error('Invalid authorization request.');
 const input=validateV2UiRequest(raw.input);
 const authorization=validateV2Authorization(raw.authorization,input.mode);
 return {input,authorization};
}
export function encodeV2Authorization(auth,mode){
 const validated=validateV2Authorization(auth,mode);
 return JSON.stringify(validated)+'\n';
}
export function decodeV2Authorization(serialized,mode){
 if(typeof serialized!=='string'||Buffer.byteLength(serialized,'utf8')>2400||
    !serialized.endsWith('\n')||serialized.indexOf('\n')!==serialized.length-1)
    throw new Error('Malformed local proof authorization.');
 let data;try{data=JSON.parse(serialized.slice(0,-1));}
 catch{throw new Error('Malformed local proof authorization.');}
 return validateV2Authorization(data,mode);
}
export async function receiveV2Authorization(stream,mode){
 let value='',length=0;
 for await(const chunk of stream){
  length+=Buffer.byteLength(chunk);if(length>2400)throw new Error('Local authorization exceeds limit.');
  value+=chunk.toString('utf8');
 }
 return decodeV2Authorization(value,mode);
}
