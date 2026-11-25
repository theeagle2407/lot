import {lstat,readFile,writeFile,link,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {defaultReceipts,readPublishedReceipt} from './lot-public-receipt-store.mjs';
import {receiptKeyValid,submissionIdentifierValid,receiptTarget,receiptSubmissions} from '../src/receipt-target.js';
import {policyReceiptKey} from './lot-multi-policy.mjs';
const names=['deploy','inspection','policy','clearance'];
async function readJournal(dir){
 const d=await lstat(dir);if(!d.isDirectory()||d.isSymbolicLink())throw Error('Invalid issuance directory');
 const f=join(dir,'status.json'),st=await lstat(f);if(!st.isFile()||st.isSymbolicLink()||st.size>65536)throw Error('Invalid issuance journal');
 return JSON.parse(await readFile(f,'utf8'));
}
export async function recoverReceipt({root=defaultReceipts(),key,readLedger}){
 if(!receiptKeyValid(key))throw Error('Invalid receipt key');
 const dir=join(root,key),r=await readJournal(dir),b=r.binding;
 const extra=r.receiptKey!==undefined;
 if(r.schema!==1||r.network!=='preprod'||b?.requestId!==r.requestId||(!extra&&r.requestId!==key)||(extra&&(r.receiptKey!==key||policyReceiptKey(r.requestId,b.policyId)!==key)))throw Error('Journal identity mismatch');
 const target=receiptTarget({network:r.network,batchId:b.batchId,batchKey:r.requestId,...(extra?{receiptKey:key,inspectorFingerprint:r.inspectorFingerprint}:{}),policyId:b.policyId,policyKey:b.policyKey,clearanceKey:b.clearanceKey,minStrength:b.minStrength,maxDefectsBps:b.maxDefectsBps,contractAddress:r.contractAddress},key);
 if(extra&&!target.inspectorFingerprint)throw Error('Inspector fingerprint missing');
 const steps={};
 for(const n of names){const s=r.steps?.[n];if(!s||!['confirmed','confirmed-by-ledger'].includes(s.status))throw Error('Journal contains unfinished stage: '+n);steps[n]={status:s.status,updatedAt:s.updatedAt,submittedIdentifier:s.submittedIdentifier??null,txId:s.txId??null};if(!Number.isFinite(Date.parse(s.updatedAt))||[steps[n].submittedIdentifier,steps[n].txId].some(v=>v!==null&&!submissionIdentifierValid(v)))throw Error('Invalid stage evidence');}
 const submissions=receiptSubmissions({steps});
 const result=await readLedger(target);
 if((extra&&result?.enrolledInspectorFingerprint!==target.inspectorFingerprint)||result?.status!=='verified'||result.inspectionPresent!==true||result.policyMatches!==true||result.clearancePresent!==true||Object.entries(target).some(([k,v])=>result[k]!==v))throw Error('Exact clearance not verified; no receipt published');
 if(!Number.isFinite(Date.parse(result.checkedAt))||Math.abs(Date.now()-Date.parse(result.checkedAt))>120000)throw Error('Ledger check is stale; no receipt published');
 const receipt={schema:1,...target,verifiedAt:result.checkedAt,steps};
 const dest=join(dir,'public-receipt.json'),tmp=join(dir,`.recover-${randomBytes(12).toString('hex')}.tmp`);
 const confirmExisting=()=>{const existing=readPublishedReceipt(root,key);if(JSON.stringify(existing.target)!==JSON.stringify(target)||JSON.stringify(existing.submissions)!==JSON.stringify(submissions))throw Error('Existing receipt differs; preserved for manual review');return {status:'already-published',target};};
 try{await lstat(dest);return confirmExisting();}catch(e){if(e.code!=='ENOENT')throw e;}
 try{await writeFile(tmp,JSON.stringify(receipt,null,2)+'\n',{mode:0o600,flag:'wx'});try{await link(tmp,dest);}catch(e){if(e.code==='EEXIST')return confirmExisting();throw e;}}finally{await unlink(tmp).catch(()=>{});}
 return {status:'recovered',target};
}
async function main(){
 const key=process.argv[2];if(!receiptKeyValid(key))throw Error('Invalid receipt key');
 const token=(process.env.BLOCKFROST_PROJECT_ID??'').trim();delete process.env.BLOCKFROST_PROJECT_ID;
 const {createLedgerReader}=await import('./lot-preprod-public-read.mjs');
 const result=await recoverReceipt({key,readLedger:target=>createLedgerReader(token,target)()});
 console.log('Public receipt:',result.status);console.log('Batch:',result.target.batchId);console.log('Contract:',result.target.contractAddress);console.log('Buyer path: /verify-preprod?key='+key);console.log('No wallet state or transaction journal modified. No transaction submitted.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(()=>{process.exit(0);},()=>{console.error('Receipt recovery stopped. Existing receipt/journal preserved. Check journal, token and live ledger. No transaction submitted.');process.exit(1);});
