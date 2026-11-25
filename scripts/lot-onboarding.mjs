/** Local onboarding only. Existing operator vault and signing authority are NOT inherited. */
import {randomBytes,createHash,scryptSync,timingSafeEqual,createHmac,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdirSync,lstatSync,readFileSync,writeFileSync,renameSync,openSync,closeSync,unlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {inspectorFingerprint} from './lot-multi-policy.mjs';
import {validateOperatorUsername,validateOperatorPassword,listLocalOperators} from './lot-operator-access.mjs';
const KDF={N:1<<17,r:8,p:1,maxmem:256*1024*1024};
const hash=x=>createHash('sha256').update(x).digest('hex');
export const onboardingPath=legacy=>join(dirname(legacy),'onboarding-v1.json');
const text=(x,max)=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=max&&!/[\u0000-\u001f\u007f]/.test(x);
export const materialCategories=['metals','construction','polymers','ceramics','textiles','other'];
const batchRx=/^LOT-[A-Z0-9-]{1,48}$/;
const MAX_STORE_BYTES=512*1024;
const empty=()=>({version:1,users:[],invites:[],batches:[]});
function safeDir(file){const dir=dirname(file);mkdirSync(dir,{recursive:true,mode:0o700});const s=lstatSync(dir);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077))throw Error('Unsafe onboarding directory.');return dir;}
function read(file){try{const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)||s.size>MAX_STORE_BYTES)throw Error('Unsafe onboarding file.');const d=JSON.parse(readFileSync(file,'utf8'));if(d.version!==1||!Array.isArray(d.users)||!Array.isArray(d.invites)||!Array.isArray(d.batches))throw Error('Invalid onboarding store.');return d;}catch(e){if(e.code==='ENOENT')return empty();throw e;}}
function mutate(file,fn){const dir=safeDir(file),lock=file+'.lock';let fd;try{fd=openSync(lock,'wx',0o600);}catch{throw Error('Account store busy; retry later.');}const tmp=join(dir,'.onboarding-'+randomBytes(12).toString('hex'));try{const d=read(file),result=fn(d);const encoded=JSON.stringify(d);if(Buffer.byteLength(encoded)>MAX_STORE_BYTES)throw Error('Account storage limit reached.');writeFileSync(tmp,encoded,{flag:'wx',mode:0o600});renameSync(tmp,file);return result;}finally{try{unlinkSync(tmp);}catch(e){if(e.code!=='ENOENT')throw e;}closeSync(fd);unlinkSync(lock);}}
const orgs=u=>new Set([u.org,...(u.linkedOrgs||[])]);
const related=(u,org)=>u.role==='inspector'&&orgs(u).has(org);
const requestId=b=>hash('LOT_ONBOARD_BATCH_V1:'+b.org+':'+b.id);
const state=b=>b.state||(b.inspector?'assigned':'awaiting-inspector');
const actorOf=u=>({name:u.name,role:u.role,scope:'onboarding'});
function member(d,actor){if(actor?.scope!=='onboarding')throw Error('New account required.');const u=d.users.find(u=>u.name===actor.name&&u.role===actor.role);if(!u)throw Error('Account unavailable.');return u;}
export function hasOnboardedName(file,name){return read(file).users.some(u=>u.name===name);}
export function listOnboarded(file){return read(file).users.map(u=>({name:u.name,role:u.role,company:u.company}));}
export function registerOnboarded({file,legacyFile,input,now=Date.now(),reservedNames=new Set()}){
 if(!input||Object.keys(input).sort().join('|')!=='company|email|fullName|invite|name|password|role')throw Error('Check registration fields.');
 const {name,password,role,fullName,company,email,invite}=input;validateOperatorUsername(name);validateOperatorPassword(password);
 if(!['manufacturer','inspector'].includes(role)||!text(fullName,80)||!text(company,100)||!text(email,160)||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||typeof invite!=='string'||invite.length>128)throw Error('Check registration fields.');
 return mutate(file,d=>{
  if(d.users.length>=100)throw Error('Local account limit reached.');
  if(reservedNames.has(name)||d.users.some(u=>u.name===name)||listLocalOperators(legacyFile).some(u=>u.name===name))throw Error('Username unavailable.');
  let org=randomBytes(16).toString('hex'),actualCompany=company,inv;
  if(role==='inspector'){if(!/^[0-9a-f]{48}$/.test(invite))throw Error('Valid inspector invitation required.');inv=d.invites.find(i=>i.digest===hash(invite)&&i.expires>now);if(!inv)throw Error('Invalid or expired inspector invitation.');const owner=d.users.find(u=>u.role==='manufacturer'&&u.org===inv.org);if(!owner)throw Error('Invalid inspector invitation.');org=owner.org;actualCompany=company;}
  else if(invite!=='')throw Error('Manufacturer registration does not use invitations.');
  const salt=randomBytes(16).toString('hex'),digest=scryptSync(password,Buffer.from(salt,'hex'),32,KDF).toString('hex');
  const u={name,role,fullName,company:actualCompany,email,org,salt,digest};d.users.push(u);if(inv)d.invites=d.invites.filter(i=>i!==inv);return actorOf(u);
 });
}
export function authenticateOnboarded({file,name,password}){const u=read(file).users.find(u=>u.name===name);if(!u||typeof password!=='string'||password.length>512)return null;const actual=scryptSync(password,Buffer.from(u.salt,'hex'),32,KDF);return timingSafeEqual(actual,Buffer.from(u.digest,'hex'))?actorOf(u):null;}
/** Local administrator CLI compatibility. Browser requests use the session-bound function below. */
function addInspectorInvite(d,u,now){
 const code=randomBytes(24).toString('hex'),expires=now+24*3600*1000;
 d.invites=d.invites.filter(i=>i.expires>now);
 if(d.invites.filter(i=>i.org===u.org).length>=5)throw Error('Five active invitations allowed. Use an existing invitation or wait for expiry.');
 if(d.invites.length>=100)throw Error('Invitation limit reached.');
 d.invites.push({org:u.org,digest:hash(code),expires});return {code,expiresAt:new Date(expires).toISOString()};
}
export function issueInspectorInvite(file,manufacturer,now=Date.now()){return mutate(file,d=>{const u=d.users.find(u=>u.name===manufacturer&&u.role==='manufacturer');if(!u)throw Error('New manufacturer account not found.');return addInspectorInvite(d,u,now).code;});}
/** Actor is supplied exclusively by the authenticated server session, never by request JSON. */
export function createInspectorInvitation(file,actor,input,now=Date.now()){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==0)throw Error('Invalid invitation request.');
 return mutate(file,d=>{const u=member(d,actor);if(u.role!=='manufacturer')throw Error('Manufacturer access required.');return addInspectorInvite(d,u,now);});
}
export function redeemInspectorInvitation(file,actor,input,now=Date.now()){
 if(!input||Object.keys(input).join('|')!=='code'||typeof input.code!=='string'||!/^[a-f0-9]{48}$/.test(input.code))throw Error('Invalid invitation.');
 return mutate(file,d=>{const u=member(d,actor);if(u.role!=='inspector')throw Error('Inspector access required.');const inv=d.invites.find(i=>i.digest===hash(input.code)&&i.expires>now);if(!inv||!d.users.some(x=>x.role==='manufacturer'&&x.org===inv.org))throw Error('Invalid or expired inspector invitation.');if(related(u,inv.org))throw Error('Already connected to this manufacturer.');u.linkedOrgs=[...(u.linkedOrgs||[]),inv.org];d.invites=d.invites.filter(i=>i!==inv);return {connected:true};});
}
export function accountCatalog(file,actor){const d=read(file),u=member(d,actor);return {profile:{name:u.name,fullName:u.fullName,company:u.company,role:u.role},inspectors:u.role==='manufacturer'?d.users.filter(x=>related(x,u.org)).map(x=>({name:x.name,fullName:x.fullName,company:x.company})):[],batches:d.batches.filter(b=>u.role==='manufacturer'?b.org===u.org:related(u,b.org)&&b.inspector===u.name).map(b=>({id:b.id,material:b.material,category:b.category||null,inspector:b.inspector,createdAt:b.createdAt,requestId:requestId(b),manufacturer:d.users.find(x=>x.role==='manufacturer'&&x.org===b.org)?.company||'Manufacturer',status:state(b),signedAt:b.signedAt||null,inspectorFingerprint:state(b)==='signed'&&b.report?inspectorFingerprint(unseal(master(file),requestId(b),b.report).inspectorPublicKey):null,preparedPolicy:u.role==='manufacturer'?b.preparedPolicy||null:undefined}))};}
export function createBatchRequest(file,actor,input){return mutate(file,d=>{const u=member(d,actor);if(u.role!=='manufacturer')throw Error('Manufacturer access required.');if(!input||!['id|inspector|material','category|id|inspector|material'].includes(Object.keys(input).sort().join('|'))||('category' in input&&!materialCategories.includes(input.category))||typeof input.id!=='string'||!batchRx.test(input.id)||!text(input.material,80)||typeof input.inspector!=='string')throw Error('Check batch fields.');if(d.batches.length>=1000||d.batches.filter(b=>b.org===u.org).length>=12)throw Error('Local batch limit reached.');if(d.batches.some(b=>b.org===u.org&&b.id===input.id))throw Error('Batch already exists.');if(input.inspector&&!d.users.some(x=>related(x,u.org)&&x.name===input.inspector))throw Error('Inspector not available for this account.');d.batches.push({...input,org:u.org,createdAt:new Date().toISOString()});return {id:input.id};});}
export function assignBatchRequest(file,actor,input){return mutate(file,d=>{const u=member(d,actor);if(u.role!=='manufacturer')throw Error('Manufacturer access required.');if(!input||Object.keys(input).sort().join('|')!=='id|inspector'||typeof input.id!=='string'||!batchRx.test(input.id)||typeof input.inspector!=='string')throw Error('Check assignment.');const b=d.batches.find(b=>b.org===u.org&&b.id===input.id);if(!b)throw Error('Batch not found.');if(['accepted','signed'].includes(state(b)))throw Error('Accepted or signed inspections cannot be reassigned.');if(!d.users.some(x=>related(x,u.org)&&x.name===input.inspector))throw Error('Inspector not available for this account.');b.inspector=input.inspector;b.state='assigned';return {id:b.id};});}
function assigned(d,actor,id){const u=member(d,actor);if(u.role!=='inspector')throw Error('Inspector access required.');const b=d.batches.find(b=>requestId(b)===id&&related(u,b.org)&&b.inspector===u.name);if(!b)throw Error('Inspection not found.');return [u,b];}
export function decideInspection(file,actor,input){if(!input||Object.keys(input).sort().join('|')!=='decision|requestId'||!['accepted','declined'].includes(input.decision))throw Error('Invalid inspection decision.');return mutate(file,d=>{const [,b]=assigned(d,actor,input.requestId);if(state(b)!=='assigned')throw Error('Inspection is not awaiting a decision.');b.state=input.decision;return {status:b.state};});}
// Local server custodial key. Distinct derivation domains for encryption and per-inspector signing.
function master(file,create=false){const dir=safeDir(file),keyFile=join(dir,'onboarding-report-master-v1.key');if(create){try{writeFileSync(keyFile,randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}}const stat=lstatSync(keyFile);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||stat.size!==32)throw Error('Unsafe report key.');return readFileSync(keyFile);}
const derive=(key,label)=>createHmac('sha256',key).update(label).digest();
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v);
function seal(key,id,report){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',derive(key,'report:'+id),iv);c.setAAD(Buffer.from(id));const ciphertext=Buffer.concat([c.update(json(report),'utf8'),c.final()]);return {iv:iv.toString('hex'),tag:c.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')};}
function unseal(key,id,enc){const c=createDecipheriv('aes-256-gcm',derive(key,'report:'+id),Buffer.from(enc.iv,'hex'));c.setAAD(Buffer.from(id));c.setAuthTag(Buffer.from(enc.tag,'hex'));return JSON.parse(Buffer.concat([c.update(Buffer.from(enc.ciphertext,'hex')),c.final()]).toString('utf8'));}
// signer must be the existing Compact V2 signing adapter, loaded by the server, not the browser.
export function signAssignedInspection(file,actor,input,signer){if(!input||Object.keys(input).sort().join('|')!=='defectBps|requestId|strength'||!Number.isSafeInteger(input.strength)||input.strength<1||input.strength>100000||!Number.isSafeInteger(input.defectBps)||input.defectBps<0||input.defectBps>10000)throw Error('Enter valid whole-number measurements.');return mutate(file,d=>{const [u,b]=assigned(d,actor,input.requestId);if(state(b)!=='accepted')throw Error('Accept the inspection before signing.');const id=requestId(b),key=master(file,!d.batches.some(x=>x.report)),salt=randomBytes(32),scalar=BigInt('0x'+derive(key,'inspector:'+u.name).subarray(0,31).toString('hex'))+1n;const {signature,inspectorPublicKey}=signer(new Uint8Array(Buffer.from(id,'hex')),BigInt(input.strength),BigInt(input.defectBps),new Uint8Array(salt),scalar);if(!signature||!inspectorPublicKey)throw Error('Signing failed.');const signedAt=new Date().toISOString();b.report=seal(key,id,{version:1,requestId:id,batchId:b.id,inspector:u.name,strength:input.strength,defectBps:input.defectBps,openingSalt:salt.toString('hex'),signature,inspectorPublicKey,signedAt});b.signedAt=signedAt;b.state='signed';return {status:'signed',signedAt};});}
// Internal only: never route private openings or signatures to the public verifier.
export function loadManufacturerInspection(file,actor,id){const d=read(file),u=member(d,actor);if(u.role!=='manufacturer')throw Error('Manufacturer access required.');const b=d.batches.find(b=>b.org===u.org&&requestId(b)===id);if(!b||state(b)!=='signed'||!b.report)throw Error('Signed inspection not found.');return unseal(master(file),id,b.report);}
/** Explicit allowlist: anonymous users get only auth bootstrap and intentionally public scoped buyer endpoints. */
export function onboardingRouteAllowed(path,actor){if(['/api/proof/session','/api/proof/auth/me','/api/proof/auth/login','/api/proof/auth/signup','/api/proof/auth/logout','/api/proof/buyer-receipt','/api/proof/buyer-audit'].includes(path))return true;if(path.startsWith('/api/proof/onboarding/'))return actor?.scope==='onboarding';return Boolean(actor&&actor.scope!=='onboarding');}

// Local private eligibility only. No proof, certificate, or transaction is produced.
export function prepareClearance(file,actor,input){
 if(!input||Object.keys(input).sort().join('|')!=='maxDefectsBps|minStrength|policyId|requestId'||typeof input.policyId!=='string'||!/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(input.policyId)||!Number.isSafeInteger(input.minStrength)||input.minStrength<1||input.minStrength>100000||!Number.isSafeInteger(input.maxDefectsBps)||input.maxDefectsBps<0||input.maxDefectsBps>10000)throw Error('Check policy fields.');
 return mutate(file,d=>{const u=member(d,actor);if(u.role!=='manufacturer')throw Error('Manufacturer access required.');const b=d.batches.find(b=>b.org===u.org&&requestId(b)===input.requestId);if(!b||state(b)!=='signed'||!b.report)throw Error('Signed inspection not found.');const report=unseal(master(file),input.requestId,b.report);if(report.requestId!==input.requestId||report.batchId!==b.id||report.inspector!==b.inspector||!Number.isSafeInteger(report.strength)||report.strength<1||!Number.isSafeInteger(report.defectBps)||report.defectBps<0||report.defectBps>10000||!report.signature||!report.inspectorPublicKey)throw Error('Invalid stored report.');const policy={policyId:input.policyId,minStrength:input.minStrength,maxDefectsBps:input.maxDefectsBps,eligible:report.strength>=input.minStrength&&report.defectBps<=input.maxDefectsBps,checkedAt:new Date().toISOString(),status:'local-eligibility-only'};b.preparedPolicy=policy;return {policy};});
}
