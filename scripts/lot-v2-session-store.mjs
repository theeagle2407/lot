/**
 * Build 17: authenticated, encrypted local V2 session for a single batch.
 * Only the contract address, inspection TX and batch name are public.
 * The policy-admin secret is never written in plaintext.
 */
import { createHash, randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
const RX_BATCH=/^LOT-[A-Z0-9-]{1,48}$/;
const RX_HEX=/^[0-9a-f]{64}$/;
const RX_TX=/^[0-9a-f]{66}$/;
const RX_B64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const KDF={N:32768,r:8,p:1,maxmem:64*1024*1024};
const MAX=8192;
function checkPublic(meta){
  if(!meta || Object.keys(meta).sort().join('|')!==['batchId','contractAddress','inspectionTx','reportDigest'].sort().join('|') ||
    !RX_BATCH.test(meta.batchId) || !RX_HEX.test(meta.contractAddress) || !RX_TX.test(meta.inspectionTx) || !RX_HEX.test(meta.reportDigest))
    throw new Error('Invalid V2 public session metadata.');
  return meta;
}
function checkPass(p){if(typeof p!=='string'||p.length<12||p.length>1024)throw new Error('Passphrase must be 12–1024 characters.');}
function decode(value,n){
  if(typeof value!=='string'||!RX_B64.test(value))throw new Error('Malformed encrypted session.');
  const b=Buffer.from(value,'base64');if(b.length!==n||b.toString('base64')!==value)throw new Error('Malformed encrypted session.');return b;
}
function checkFile(file){const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX)throw new Error('Unsafe V2 session file.');}
export function sessionFile(batchId,dir=join(homedir(),'.lot','v2-sessions')){
  if(typeof batchId!=='string'||!RX_BATCH.test(batchId))throw new Error('Invalid batch ID.');
  return join(resolve(dir),`${batchId}.json`);
}
export function sealSession(meta,adminSecretHex,passphrase){
  checkPublic(meta);checkPass(passphrase);
  if(!RX_HEX.test(adminSecretHex))throw new Error('Invalid policy-admin key.');
  const salt=randomBytes(16),nonce=randomBytes(12);
  const key=scryptSync(passphrase,salt,32,KDF);
  const aad=Buffer.from('LOT_V2_SESSION_V1:'+JSON.stringify(meta));
  try{
    const cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(aad);
    const payload=Buffer.from(JSON.stringify({policyAdminSecret:adminSecretHex}));
    const data=Buffer.concat([cipher.update(payload),cipher.final()]);
    return JSON.stringify({kind:'LOT_V2_LOCAL_SESSION',version:1,public:meta,
      encrypted:{salt:salt.toString('base64'),nonce:nonce.toString('base64'),data:data.toString('base64'),tag:cipher.getAuthTag().toString('base64')}});
  } finally { key.fill(0); }
}
export function openSession(serialized,passphrase){
  checkPass(passphrase);
  if(typeof serialized!=='string'||Buffer.byteLength(serialized)>MAX)throw new Error('Unsafe V2 session size.');
  let data;try{data=JSON.parse(serialized);}catch{throw new Error('Invalid V2 session JSON.');}
  if(!data||Object.keys(data).sort().join('|')!=='encrypted|kind|public|version'||data.kind!=='LOT_V2_LOCAL_SESSION'||data.version!==1)
    throw new Error('Unsupported V2 session.');
  const meta=checkPublic(data.public);
  const envelope=data.encrypted;
  if(!envelope||Object.keys(envelope).sort().join('|')!=='data|nonce|salt|tag'||typeof envelope.data!=='string'||!RX_B64.test(envelope.data))throw new Error('Malformed encrypted session.');
  const salt=decode(envelope.salt,16),nonce=decode(envelope.nonce,12),tag=decode(envelope.tag,16);
  const enc=Buffer.from(envelope.data,'base64');if(enc.length===0||enc.length>256||enc.toString('base64')!==envelope.data)throw new Error('Malformed encrypted session.');
  const key=scryptSync(passphrase,salt,32,KDF);
  let clear;
  try{const cipher=createDecipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from('LOT_V2_SESSION_V1:'+JSON.stringify(meta)));cipher.setAuthTag(tag);clear=Buffer.concat([cipher.update(enc),cipher.final()]);}
  catch{throw new Error('Wrong session passphrase or modified metadata.');}
  finally{key.fill(0);}
  try{const payload=JSON.parse(clear.toString('utf8'));
    if(!payload||Object.keys(payload).join('|')!=='policyAdminSecret'||!RX_HEX.test(payload.policyAdminSecret))throw new Error('Invalid policy-admin secret.');
    return {public:meta,policyAdminSecret:payload.policyAdminSecret};
  }finally{clear.fill(0);}
}
export function saveSession(meta,secret,passphrase,dir){
  const file=sessionFile(meta.batchId,dir),base=resolve(dir??join(homedir(),'.lot','v2-sessions'));
  mkdirSync(base,{recursive:true,mode:0o700});
  const d=lstatSync(base);if(!d.isDirectory()||d.isSymbolicLink())throw new Error('Unsafe session directory.');
  writeFileSync(file,sealSession(meta,secret,passphrase),{flag:'wx',mode:0o600});return file;
}
export function loadSession(batchId,passphrase,dir){const file=sessionFile(batchId,dir);checkFile(file);const result=openSession(readFileSync(file,'utf8'),passphrase);if(result.public.batchId!==batchId)throw new Error('Session batch mismatch.');return result;}
export function sessionPublic(batchId,dir){const file=sessionFile(batchId,dir);checkFile(file);const data=JSON.parse(readFileSync(file,'utf8'));if(data.kind!=='LOT_V2_LOCAL_SESSION'||data.version!==1)throw new Error('Invalid session.');return checkPublic(data.public);}
export function sessionReportDigest(report){return createHash('sha256').update('LOT_V2_SESSION_REPORT:').update(JSON.stringify(report)).digest('hex');}

/** A local operator's catalog: only already-public session IDs and chain identifiers.
 * Never read or return the encrypted policy-admin secret, private vault or key files.
 * This is saved local metadata, NOT a fresh indexer audit.
 */
export function listPublicSessions(dir=join(homedir(),'.lot','v2-sessions')){
  const base=resolve(dir);
  let folder;
  try{folder=lstatSync(base);}catch(e){if(e?.code==='ENOENT')return [];throw e;}
  if(!folder.isDirectory()||folder.isSymbolicLink()||(folder.mode&0o077)!==0)
    throw new Error('Unsafe V2 sessions directory.');
  const names=readdirSync(base);
  if(names.length>256)throw new Error('Too many V2 session directory entries.');
  const result=[];
  for(const name of names){
    if(!name.endsWith('.json'))continue;
    const batchId=name.slice(0,-5);
    if(!RX_BATCH.test(batchId))throw new Error('Unexpected V2 session filename.');
    const file=sessionFile(batchId,base);
    const stat=lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw new Error('Unsafe V2 session file.');
    const publicMeta=sessionPublic(batchId,base);
    if(publicMeta.batchId!==batchId)throw new Error('V2 session filename mismatch.');
    result.push({batchId:publicMeta.batchId,contractAddress:publicMeta.contractAddress,inspectionTx:publicMeta.inspectionTx});
  }
  return result.sort((a,b)=>a.batchId.localeCompare(b.batchId));
}
