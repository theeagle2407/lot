import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {receiptTarget,receiptSubmissions,receiptKeyValid} from '../src/receipt-target.js';
import {policyReceiptKey} from './lot-multi-policy.mjs';
export const defaultReceipts=()=>join(homedir(),'.lot','preprod','onboarding-v1');
export function readPublishedReceipt(root,key){
 if(!receiptKeyValid(key))throw Error('Invalid receipt key');
 const dir=join(root,key),file=join(dir,'public-receipt.json');
 if(lstatSync(dir).isSymbolicLink())throw Error('Invalid receipt directory');
 const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>32768)throw Error('Invalid receipt file');
 const r=JSON.parse(readFileSync(file,'utf8'));if(r.schema!==1)throw Error('Invalid receipt version');
 const target=receiptTarget(r,key);if(target.receiptKey&&policyReceiptKey(target.batchKey,target.policyId)!==key)throw Error('Policy receipt key mismatch');return {target,submissions:receiptSubmissions(r)};
}

// Read a static release first, then the local live receipt store only on absence.
// Malformed or unreadable receipts fail closed rather than selecting a substitute.
export function readReceiptFromRoots(roots,key){
 for(const root of roots){try{return readPublishedReceipt(root,key);}catch(e){if(e.code!=='ENOENT')throw e;}}
 return null;
}
