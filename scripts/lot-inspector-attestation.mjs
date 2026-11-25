/**
 * LOT Build 12 — local-only, signed inspection attestations.
 * An allowlisted Ed25519 key authenticates a signed digest of ONE private report.
 * This is a local OFF-CHAIN trust gate, not on-chain signature enforcement or
 * independently verified laboratory accreditation.
 *
 * NO readings, salts, or passwords are written to the detached attestation.
 */
import {
  createHash, createPrivateKey, createPublicKey, generateKeyPairSync,
  sign as edSign, verify as edVerify, timingSafeEqual,
} from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync,
  renameSync, rmSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { validatePrivateReport } from './lot-private-vault.mjs';

const DOMAIN = 'LOT_INSPECTION_ATTESTATION_V1';
const SCHEMA = 1;
const MAX_FILE = 8192;
const MAX_TRUSTED = 16;
const TTL_DAYS = 30;
const BATCH_RX = /^LOT-[A-Z0-9-]{1,48}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const own = (value, expected) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === [...expected].sort().join('|');

function safeDirectory(folder) {
  mkdirSync(folder,{recursive:true,mode:0o700});
  const s=lstatSync(folder);
  if(!s.isDirectory() || s.isSymbolicLink())throw new Error('Unsafe inspector directory.');
}
function safeFile(file) {
  const s=lstatSync(file);
  if(!s.isFile() || s.isSymbolicLink() || s.size<=0 || s.size>MAX_FILE)throw new Error('Unsafe inspector file.');
  return readFileSync(file,'utf8');
}
function putExclusive(file, data) {
  safeDirectory(path.dirname(file));
  writeFileSync(file,data,{flag:'wx',mode:0o600,encoding:'utf8'});
}
function putAtomic(file, data) {
  safeDirectory(path.dirname(file));
  const tmp=`${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp,data,{flag:'wx',mode:0o600,encoding:'utf8'});
    renameSync(tmp,file);
  } finally { rmSync(tmp,{force:true}); }
}
function parseJson(text) {
  if(typeof text!=='string'||Buffer.byteLength(text)>MAX_FILE)throw new Error('Inspector file too large.');
  try{return JSON.parse(text);}catch{throw new Error('Invalid inspector JSON.');}
}
function strictBase64(s, bytes) {
  if(typeof s!=='string'||!BASE64.test(s))throw new Error('Invalid signature encoding.');
  const b=Buffer.from(s,'base64');
  if(b.length!==bytes || b.toString('base64')!==s)throw new Error('Invalid signature length.');
  return b;
}
function validDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value))throw new Error('Invalid attestation date.');
  const n=Date.parse(value);
  if(!Number.isFinite(n)||new Date(n).toISOString()!==value)throw new Error('Invalid attestation date.');
  return n;
}
function validPassword(passphrase) {
  if(typeof passphrase!=='string'||passphrase.length<12||passphrase.length>1024)throw new Error('Use a 12–1024 character passphrase.');
  return passphrase;
}
function spkiKey(publicPem) {
  if(typeof publicPem!=='string'||publicPem.length>2048)throw new Error('Invalid inspector public key.');
  let pub;
  try{pub=createPublicKey(publicPem);}catch{throw new Error('Invalid inspector public key.');}
  if(pub.asymmetricKeyType!=='ed25519')throw new Error('Inspector key must be Ed25519.');
  return pub;
}
export function fingerprint(publicPem) {
  const pub=spkiKey(publicPem);
  return createHash('sha256').update(pub.export({type:'spki',format:'der'})).digest('hex');
}
export function makeInspectorKeyPair(passphrase) {
  validPassword(passphrase);
  const {publicKey,privateKey}=generateKeyPairSync('ed25519',{
    publicKeyEncoding:{type:'spki',format:'pem'},
    privateKeyEncoding:{type:'pkcs8',format:'pem',cipher:'aes-256-cbc',passphrase},
  });
  return {publicKey,encryptedPrivateKey:privateKey,fingerprint:fingerprint(publicKey)};
}
export function defaultInspectorDirectory(){return path.join(homedir(),'.lot','inspector');}
export function defaultAttestationDirectory(){return path.join(homedir(),'.lot','attestations');}
export function defaultTrustedFile(){return path.join(defaultInspectorDirectory(),'trusted-public-keys.json');}
export function defaultAttestationPath(batchId, dir=defaultAttestationDirectory()){
  if(typeof batchId!=='string'||!BATCH_RX.test(batchId))throw new Error('Invalid batch ID.');
  return path.join(dir,`${batchId}.lot.attestation.json`);
}
export function saveInspectorKeyPair(keys, dir=defaultInspectorDirectory()){
  if(!keys || typeof keys.encryptedPrivateKey!=='string' || !keys.encryptedPrivateKey.includes('ENCRYPTED PRIVATE KEY') ||
    fingerprint(keys.publicKey)!==keys.fingerprint)throw new Error('Invalid inspector key pair.');
  safeDirectory(dir);
  const privatePath=path.join(dir,'inspector-private.pem');
  const publicPath=path.join(dir,'inspector-public.pem');
  if(existsSync(privatePath)||existsSync(publicPath))throw new Error('Inspector key already exists. Refusing to overwrite.');
  putExclusive(privatePath,keys.encryptedPrivateKey);
  try{putExclusive(publicPath,keys.publicKey);}catch(e){rmSync(privatePath,{force:true});throw e;}
  return {privatePath,publicPath};
}
export function loadInspectorPrivatePem(dir=defaultInspectorDirectory()){
  const value=safeFile(path.join(dir,'inspector-private.pem'));
  if(!value.includes('ENCRYPTED PRIVATE KEY'))throw new Error('Inspector private key must be encrypted.');
  return value;
}
export function loadInspectorPublicPem(dir=defaultInspectorDirectory()){
  return safeFile(path.join(dir,'inspector-public.pem'));
}
function loadTrustedObject(file) {
  if(!existsSync(file))return {schema:SCHEMA,keys:{}};
  const data=parseJson(safeFile(file));
  if(!own(data,['schema','keys'])||data.schema!==SCHEMA||!data.keys||
    typeof data.keys!=='object'||Array.isArray(data.keys)||Object.keys(data.keys).length>MAX_TRUSTED)
    throw new Error('Invalid trusted-inspector registry.');
  for(const [fp,pem] of Object.entries(data.keys)){
    if(!HEX64.test(fp)||fp!==fingerprint(pem))throw new Error('Trusted-inspector registry is invalid.');
  }
  return data;
}
export function listTrustedKeys(file=defaultTrustedFile()){
  return Object.keys(loadTrustedObject(file).keys).sort();
}
export function trustInspectorPublicKey(publicPem,file=defaultTrustedFile()){
  const fp=fingerprint(publicPem);
  const data=loadTrustedObject(file);
  if(data.keys[fp])throw new Error('Inspector is already trusted.');
  if(Object.keys(data.keys).length>=MAX_TRUSTED)throw new Error('Trusted inspector limit reached.');
  const canonical=spkiKey(publicPem).export({type:'spki',format:'pem'}).toString();
  data.keys[fp]=canonical;
  putAtomic(file,JSON.stringify(data,null,2));
  return fp;
}
export function canonicalPrivateReport(reportInput) {
  const r=validatePrivateReport(reportInput);
  return JSON.stringify({
    domain:'LOT_PRIVATE_REPORT_V1',batchId:r.batchId,material:r.material,
    strengthMpa:r.strengthMpa,defectBps:r.defectBps,openingSalt:r.openingSalt,
  });
}
export function digestReport(report) {
  return createHash('sha256').update(canonicalPrivateReport(report),'utf8').digest('hex');
}
function message(fields){
  return Buffer.from(JSON.stringify({
    domain:DOMAIN,batchId:fields.batchId,inspector:fields.inspector,
    digest:fields.digest,issuedAt:fields.issuedAt,expiresAt:fields.expiresAt,
  }),'utf8');
}
export function signInspectionReport(reportInput,encryptedPrivatePem,passphrase,publicPem,issuedAt=new Date()){
  const r=validatePrivateReport(reportInput);
  validPassword(passphrase);
  if(!(issuedAt instanceof Date)||!Number.isFinite(issuedAt.getTime()))throw new Error('Invalid attestation issue time.');
  let priv;
  try{priv=createPrivateKey({key:encryptedPrivatePem,format:'pem',passphrase});}
  catch{throw new Error('Inspector key unlock failed.');}
  if(priv.asymmetricKeyType!=='ed25519')throw new Error('Inspector key must be Ed25519.');
  const derived=createPublicKey(priv).export({type:'spki',format:'der'});
  const expected=spkiKey(publicPem).export({type:'spki',format:'der'});
  if(derived.length!==expected.length||!timingSafeEqual(derived,expected))throw new Error('Inspector key pair does not match.');
  const fields={
    schema:SCHEMA,batchId:r.batchId,inspector:fingerprint(publicPem),digest:digestReport(r),
    issuedAt:issuedAt.toISOString(),expiresAt:new Date(issuedAt.getTime()+TTL_DAYS*86400000).toISOString(),
  };
  const signature=edSign(null,message(fields),priv).toString('base64');
  return Object.freeze({...fields,signature});
}
export function verifyInspectionReport(reportInput,attestation,registryFile=defaultTrustedFile(),now=new Date()){
  const r=validatePrivateReport(reportInput);
  if(!own(attestation,['schema','batchId','inspector','digest','issuedAt','expiresAt','signature'])||
    attestation.schema!==SCHEMA||attestation.batchId!==r.batchId||
    typeof attestation.inspector!=='string'||!HEX64.test(attestation.inspector)||
    typeof attestation.digest!=='string'||!HEX64.test(attestation.digest))throw new Error('Malformed inspection attestation.');
  if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw new Error('Invalid verifier clock.');
  const issued=validDate(attestation.issuedAt),expires=validDate(attestation.expiresAt);
  if(issued>now.getTime()+5*60*1000||now.getTime()>expires||expires<=issued||expires-issued>TTL_DAYS*86400000)
    throw new Error('Inspection attestation is expired or not yet valid.');
  const actual=digestReport(r);
  if(!timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(attestation.digest,'hex')))
    throw new Error('Attestation does not match the private report.');
  const registry=loadTrustedObject(registryFile);
  const trusted=registry.keys[attestation.inspector];
  if(!trusted)throw new Error('Inspector signing key has not been trusted.');
  const signature=strictBase64(attestation.signature,64);
  if(!edVerify(null,message(attestation),spkiKey(trusted),signature))throw new Error('Invalid inspector signature.');
  return Object.freeze({batchId:r.batchId,inspector:attestation.inspector,issuedAt:attestation.issuedAt,expiresAt:attestation.expiresAt});
}
export function storeAttestation(attestation,dir=defaultAttestationDirectory()){
  if(!attestation||!BATCH_RX.test(attestation.batchId))throw new Error('Invalid attestation batch.');
  const file=defaultAttestationPath(attestation.batchId,dir);
  // Always fail if an attestation already exists; never quietly replace signed evidence.
  putExclusive(file,JSON.stringify(attestation,null,2));
  return file;
}
export function verifySavedAttestation(report,registry=defaultTrustedFile(),dir=defaultAttestationDirectory()){
  const file=defaultAttestationPath(validatePrivateReport(report).batchId,dir);
  return verifyInspectionReport(report,parseJson(safeFile(file)),registry);
}
