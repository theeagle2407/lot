/** LOT Build 23: local single-computer operator accounts (NOT hosted identity).
 * Never grant privileges from a browser-provided role. Read-only buyer checks stay public.
 */
import {randomBytes, scryptSync, timingSafeEqual, createHash} from 'node:crypto';
import {mkdirSync, lstatSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, chmodSync, unlinkSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {homedir} from 'node:os';

const USERNAME=/^[a-z][a-z0-9_-]{2,31}$/;
const ROLES=new Set(['inspector','manufacturer']);
const COOKIE_NAME='lot_operator';
const KDF={N:1<<17,r:8,p:1,maxmem:256*1024*1024};
const HASH_SIZE=32;
const MAX_FILE=128*1024;
const IDLE_MS=45*60*1000;
const ABS_MS=8*60*60*1000;

export function operatorStorePath(projectRoot=process.cwd(),home=homedir()){
 const digest=createHash('sha256').update(resolve(projectRoot)).digest('hex').slice(0,16);
 return join(home,'.lot','access',digest,'users.json');
}
export function validateOperatorUsername(input){
 if(typeof input!=='string'||!USERNAME.test(input))throw new Error('Username must be 3–32 lower-case letters, numbers, _ or -.');
 return input;
}
export function validateOperatorPassword(input){
 if(typeof input!=='string'||input.length<14||input.length>512||/[\u0000-\u001f\u007f]/.test(input))
  throw new Error('Password must be 14–512 characters without control characters.');
 return input;
}
function safeDirectory(dir){
 mkdirSync(dir,{recursive:true,mode:0o700});
 const stat=lstatSync(dir);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Unsafe operator account directory.');
 // Local accounts cannot be stored in a group/world-readable directory.
 if((stat.mode&0o077)!==0)throw new Error('Operator directory permissions are too broad.');
}
function readUsers(file){
 let raw;
 try{
  const stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_FILE||(stat.mode&0o077)!==0)throw new Error('Unsafe operator account file.');
  raw=readFileSync(file,'utf8');
 }catch(error){if(error?.code==='ENOENT')return [];throw error;}
 let parsed;
 try{parsed=JSON.parse(raw);}catch{throw new Error('Invalid operator account file.');}
 if(!parsed||parsed.kind!=='LOT_LOCAL_OPERATORS_V1'||!Array.isArray(parsed.users)||parsed.users.length>30)
  throw new Error('Invalid operator account file.');
 const seen=new Set();
 for(const user of parsed.users){
  if(!user||Object.keys(user).sort().join('|')!=='hash|name|role|salt'||
     !USERNAME.test(user.name)||!ROLES.has(user.role)||
     !/^[0-9a-f]{32}$/.test(user.salt)||!/^[0-9a-f]{64}$/.test(user.hash)||seen.has(user.name))
   throw new Error('Invalid operator record.');
  seen.add(user.name);
 }
 return parsed.users;
}
export function listLocalOperators(file){return readUsers(file).map(({name,role})=>({name,role}));}
export function createLocalOperator({name,role,password,file}){
 validateOperatorUsername(name);validateOperatorPassword(password);
 if(!ROLES.has(role))throw new Error('Operator role must be inspector or manufacturer.');
 const dir=dirname(file);
 safeDirectory(dir);
 const users=readUsers(file);
 if(users.some(user=>user.name===name))throw new Error('Operator already exists.');
 if(users.length>=30)throw new Error('Operator account limit reached.');
 const salt=randomBytes(16).toString('hex');
 const hash=scryptSync(password,Buffer.from(salt,'hex'),HASH_SIZE,KDF).toString('hex');
 users.push({name,role,salt,hash});
 const tmp=join(dir,`.operators-${randomBytes(12).toString('hex')}.tmp`);
 let fd;
 try{
  fd=openSync(tmp,'wx',0o600);
  writeFileSync(fd,JSON.stringify({kind:'LOT_LOCAL_OPERATORS_V1',users}));
  closeSync(fd);fd=undefined;
  chmodSync(tmp,0o600);
  renameSync(tmp,file);
 }finally{if(fd!==undefined)closeSync(fd);}
 return {name,role};
}
/** Local administrator-only password recovery; never callable through HTTP. */
export function resetLocalOperatorPassword({name,password,file}){
 validateOperatorUsername(name);validateOperatorPassword(password);
 const users=readUsers(file);
 const index=users.findIndex(user=>user.name===name);
 if(index<0)throw new Error('Operator not found. Run npm run users:list first.');
 const dir=dirname(file);
 safeDirectory(dir);
 const salt=randomBytes(16).toString('hex');
 const hash=scryptSync(password,Buffer.from(salt,'hex'),HASH_SIZE,KDF).toString('hex');
 const prior=users[index];
 users[index]={name:prior.name,role:prior.role,salt,hash};
 const tmp=join(dir,`.operators-${randomBytes(12).toString('hex')}.tmp`);
 let fd;
 try{
  fd=openSync(tmp,'wx',0o600);
  writeFileSync(fd,JSON.stringify({kind:'LOT_LOCAL_OPERATORS_V1',users}));
  closeSync(fd);fd=undefined;
  chmodSync(tmp,0o600);
  renameSync(tmp,file);
 }finally{
  if(fd!==undefined)closeSync(fd);
  try{unlinkSync(tmp);}catch(error){if(error?.code!=='ENOENT')throw error;}
 }
 return {name:prior.name,role:prior.role};
}
export function authenticateLocalOperator({name,password,file}){
 // Invalid shapes fail quietly; never expose account existence through HTTP.
 if(typeof name!=='string'||!USERNAME.test(name)||typeof password!=='string'||password.length>512)return null;
 const user=readUsers(file).find(u=>u.name===name);
 if(!user){
  // Run the KDF for missing users too, to reduce distinguishability.
  const dummySalt=Buffer.alloc(16);
  scryptSync(password,dummySalt,HASH_SIZE,KDF);
  return null;
 }
 const attempted=scryptSync(password,Buffer.from(user.salt,'hex'),HASH_SIZE,KDF);
 const stored=Buffer.from(user.hash,'hex');
 return timingSafeEqual(attempted,stored)?{name:user.name,role:user.role}:null;
}
export function roleForAction(path,mode){
 if(path==='/api/proof/run')return 'manufacturer';
 if(path==='/api/proof/v2-session/run'||path==='/api/proof/v2-session/authorize')
  return mode==='init'?'inspector':mode==='prove'?'manufacturer':null;
 return null;
}
function parseCookie(cookieHeader){
 if(typeof cookieHeader!=='string'||cookieHeader.length>4096)return null;
 const tokens=cookieHeader.split(';').map(x=>x.trim()).filter(x=>x.startsWith(`${COOKIE_NAME}=`));
 if(tokens.length!==1)return null;
 const token=tokens[0].slice(COOKIE_NAME.length+1);
 return /^[0-9a-f]{64}$/.test(token)?token:null;
}
export const LOCAL_COOKIE=`${COOKIE_NAME}=; Path=/api/proof; HttpOnly; SameSite=Strict; Max-Age=0`;
export function createLocalOperatorSessions({now=Date.now}={}){
 const sessions=new Map();
 function fromCookie(cookieHeader){
  const token=parseCookie(cookieHeader);
  if(!token)return null;
  const key=createHash('sha256').update(token).digest('hex');
  const session=sessions.get(key);
  if(!session)return null;
  const timestamp=now();
  if(timestamp>session.absoluteExpiry||timestamp>session.idleExpiry){sessions.delete(key);return null;}
  session.idleExpiry=Math.min(session.absoluteExpiry,timestamp+IDLE_MS);
  return {name:session.name,role:session.role,...(session.scope==='onboarding'?{scope:'onboarding'}:{})};
 }
 function start(actor){
  if(!actor||!USERNAME.test(actor.name)||!ROLES.has(actor.role))throw new Error('Invalid operator session.');
  const token=randomBytes(32).toString('hex');
  const stamp=now();
  for(const [key,s] of sessions)if(stamp>s.absoluteExpiry||stamp>s.idleExpiry)sessions.delete(key);
  const owned=[...sessions].filter(([,s])=>s.name===actor.name&&s.role===actor.role&&s.scope===actor.scope);
  while(owned.length>=8)sessions.delete(owned.shift()[0]);
  while(sessions.size>=1024)sessions.delete(sessions.keys().next().value);
  sessions.set(createHash('sha256').update(token).digest('hex'),{
   name:actor.name,role:actor.role,...(actor.scope==='onboarding'?{scope:'onboarding'}:{}),absoluteExpiry:stamp+ABS_MS,idleExpiry:stamp+IDLE_MS
  });
  return `${COOKIE_NAME}=${token}; Path=/api/proof; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(IDLE_MS/1000)}`;
 }
 function revoke(cookieHeader){
  const token=parseCookie(cookieHeader);
  if(token)sessions.delete(createHash('sha256').update(token).digest('hex'));
 }
 return {start,fromCookie,revoke};
}
