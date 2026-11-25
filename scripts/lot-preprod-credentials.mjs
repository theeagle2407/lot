/** Strictly local Blockfrost Preprod project credential, never part of browser bundles. */
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {mkdirSync,lstatSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {validateProjectToken} from './lot-preprod-core.mjs';
export function projectCredentialPath(base=join(homedir(),'.lot','preprod')){return join(resolve(base),'blockfrost.json');}
function protectedDir(base){
 const d=lstatSync(base);if(!d.isDirectory()||d.isSymbolicLink()||(d.mode&0o077)!==0)
  throw new Error('Preprod credential directory must be a private real directory (0700).');
}
function protectedFile(filename){
 const s=lstatSync(filename);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)!==0)
  throw new Error('Preprod project credential must be a private regular file (0600).');
}
export function saveProjectToken(token,{base=join(homedir(),'.lot','preprod'),replace=false}={}){
 const checked=validateProjectToken(token);
 mkdirSync(base,{recursive:true,mode:0o700});protectedDir(base);
 const filename=projectCredentialPath(base);
 const data=JSON.stringify({kind:'LOT_PREPROD_BLOCKFROST',version:1,network:'preprod',projectId:checked})+'\n';
 if(!replace){writeFileSync(filename,data,{flag:'wx',mode:0o600});return filename;}
 try{protectedFile(filename);}catch(e){if(e?.code!=='ENOENT')throw e;}
 const tmp=join(resolve(base),`.blockfrost-${randomBytes(8).toString('hex')}.tmp`);
 try{writeFileSync(tmp,data,{flag:'wx',mode:0o600});renameSync(tmp,filename);}
 finally{rmSync(tmp,{force:true});}
 return filename;
}
export function loadProjectToken({base=join(homedir(),'.lot','preprod'),env=process.env}={}){
 if(typeof env.BLOCKFROST_PROJECT_ID==='string' && env.BLOCKFROST_PROJECT_ID.length)
   return validateProjectToken(env.BLOCKFROST_PROJECT_ID);
 const filename=projectCredentialPath(base);
 try{protectedDir(base);protectedFile(filename);}catch(e){if(e?.code==='ENOENT')return null;throw e;}
 let record;
 try{record=JSON.parse(readFileSync(filename,'utf8'));}catch{throw new Error('Invalid saved Preprod Blockfrost credential.');}
 if(!record || Object.keys(record).sort().join('|')!=='kind|network|projectId|version'||
    record.kind!=='LOT_PREPROD_BLOCKFROST'||record.network!=='preprod'||record.version!==1)
   throw new Error('Unsupported Preprod credential format.');
 return validateProjectToken(record.projectId);
}
