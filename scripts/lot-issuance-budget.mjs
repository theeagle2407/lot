import {mkdirSync,lstatSync,readdirSync,readFileSync,openSync,writeFileSync,fsyncSync,closeSync,rmdirSync} from 'node:fs';
import {join} from 'node:path';
const keyPattern=/^[a-f0-9]{64}$/;
const namePattern=/^[a-z][a-z0-9_-]{2,31}$/;
export function issuanceAccounts(value=''){
 if(typeof value!=='string'||!value)return new Set();
 const names=value.split(',');
 if(names.length>20||names.some(n=>!namePattern.test(n))||new Set(names).size!==names.length)throw Error('Invalid issuance account allowlist');
 return new Set(names);
}
export function createIssuanceBudget(dir,{total=3,perAccount=3}={}){
 if(!Number.isInteger(total)||total<1||total>100||!Number.isInteger(perAccount)||perAccount<1||perAccount>100)throw Error('Invalid issuance budget');
 function ensure(){mkdirSync(dir,{recursive:true,mode:0o700});const st=lstatSync(dir);if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077))throw Error('Unsafe issuance budget directory');}
 function records(){
  ensure();return readdirSync(dir).filter(n=>n!=='.reserve-lock').map(n=>{
   if(!/^[a-f0-9]{64}\.json$/.test(n))throw Error('Unknown issuance budget entry');
   const p=join(dir,n),s=lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)||s.size>1024)throw Error('Unsafe issuance budget entry');
   const r=JSON.parse(readFileSync(p,'utf8'));if(!r||Object.keys(r).sort().join('|')!=='account|key|schema'||r.schema!==1||!namePattern.test(r.account)||r.key!==n.slice(0,-5))throw Error('Invalid issuance budget entry');return r;
  });
 }
 function remaining(account){const rs=records();return Math.max(0,Math.min(total-rs.length,perAccount-rs.filter(r=>r.account===account).length));}
 function has(key){if(!keyPattern.test(key))throw Error('Invalid issuance key');return records().some(r=>r.key===key);}
 function reserve(account,key){
  if(!namePattern.test(account)||!keyPattern.test(key))throw Error('Invalid issuance reservation');
  ensure();const lock=join(dir,'.reserve-lock');try{mkdirSync(lock,{mode:0o700});}catch{throw Error('Issuance budget locked; administrator reconciliation required.');}
  try{
   const rs=records();if(rs.some(r=>r.key===key))throw Error('Existing issuance reservation; reconcile before retrying.');
   if(rs.length>=total||rs.filter(r=>r.account===account).length>=perAccount)throw Error('Persistent issuance budget reached.');
   const fd=openSync(join(dir,key+'.json'),'wx',0o600);try{writeFileSync(fd,JSON.stringify({schema:1,account,key}));fsyncSync(fd);}finally{closeSync(fd);}
   // Persist directory entry as well as file contents before launching a transaction worker.
   const d=openSync(dir,'r');try{fsyncSync(d);}finally{closeSync(d);}
  }finally{rmdirSync(lock);}
 }
 return {remaining,has,reserve};
}
