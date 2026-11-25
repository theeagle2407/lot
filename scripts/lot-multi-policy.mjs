import {createHash} from 'node:crypto';
import {readdirSync} from 'node:fs';
import {receiptKeyValid} from '../src/receipt-target.js';
const digest=s=>createHash('sha256').update(s).digest('hex');
export function policyReceiptKey(batchKey,policyId){
 if(!receiptKeyValid(batchKey)||typeof policyId!=='string'||!/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(policyId))throw Error('Invalid policy receipt identity');
 return digest('LOT_POLICY_RECEIPT_V1:'+batchKey+':'+policyId);
}
export function validateAdditionalPolicy(p){
 if(!p||Object.keys(p).sort().join('|')!=='maxDefectsBps|minStrength|policyId'||typeof p.policyId!=='string'||!/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(p.policyId)||!Number.isSafeInteger(p.minStrength)||p.minStrength<1||p.minStrength>100000||!Number.isSafeInteger(p.maxDefectsBps)||p.maxDefectsBps<0||p.maxDefectsBps>10000)throw Error('Invalid additional buyer policy');
 return p;
}
function canonical(x){if(typeof x==='bigint')return x.toString();if(typeof x==='string'&&/^\d+$/.test(x))return x;if(x&&typeof x==='object'&&!Array.isArray(x))return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));throw Error('Invalid inspector verification key');}
export function inspectorFingerprint(key){return digest('LOT_INSPECTOR_KEY_V1:'+JSON.stringify(canonical(key)));}
export function listAdditionalReceipts(root,batchKey,read){
 if(!receiptKeyValid(batchKey))return [];
 let entries;try{entries=readdirSync(root,{withFileTypes:true});}catch{return [];}
 const out=[];
 for(const d of entries){if(!d.isDirectory()||!receiptKeyValid(d.name)||d.name===batchKey)continue;try{const {target}=read(root,d.name);if(target.batchKey===batchKey&&target.receiptKey===d.name&&policyReceiptKey(batchKey,target.policyId)===d.name)out.push({receiptKey:d.name,policyId:target.policyId,minStrength:target.minStrength,maxDefectsBps:target.maxDefectsBps});}catch{}}
 return out.sort((a,b)=>a.policyId.localeCompare(b.policyId));
}
