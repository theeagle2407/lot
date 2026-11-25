import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultReceipts, readPublishedReceipt } from './lot-public-receipt-store.mjs';
export const RELEASE_RECEIPTS = Object.freeze([
 {key:'eee890fa3380b60bf9f08a5c1904dea1ed239566b37bd56ba44db71aac65b7f9',batchId:'LOT-0001',policyId:'B-02',minStrength:550,maxDefectsBps:100,contractAddress:'c776e67c0d6784e377c421b5abc6bfa935c8c39ee0b521fe70c820a8ca647bcf'},
 {key:'0cbf4ea97a25c0d98713534348de9bb31701052e41b3bdb0fb8049f7a3968123',batchId:'LOT-0002',policyId:'B-03',minStrength:280,maxDefectsBps:80,contractAddress:'02129d89467c1e5c901d2ebc42bc2626995860bfb20a4ae1cd4ee5136cf872e0'},
 {key:'f86c4070ce4bc0a0e85368a45c017bc3ebcbb0dccdc455d47c45f1fd6e385d13',batchId:'LOT-0002',policyId:'B-04',minStrength:300,maxDefectsBps:70,contractAddress:'02129d89467c1e5c901d2ebc42bc2626995860bfb20a4ae1cd4ee5136cf872e0'},
]);
export function exportReceipts(root,dest,read=readPublishedReceipt){
 // Validate all three before writing anything. Fixed release allowlist, never walk private storage.
 const records=RELEASE_RECEIPTS.map(({key,...expected})=>{
  const {target,submissions}=read(root,key);
  for(const [field,value] of Object.entries(expected))if(target[field]!==value)throw Error('Release receipt mismatch: '+expected.batchId+' '+expected.policyId);
  const steps={};for(const [name,id] of [['deploy','deployment'],['inspection','inspection'],['policy','policy'],['clearance','clearance']])steps[name]={status:'confirmed-by-ledger',...(submissions[id]?{submittedIdentifier:submissions[id]}:{})};
  return {key,receipt:{schema:1,...target,steps}};
 });
 for(const {key,receipt} of records){const dir=join(dest,key);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'public-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o644});}
 return records.length;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){try{if(!process.argv[2])throw Error('Missing export destination');console.log('Public receipt files exported:',exportReceipts(defaultReceipts(),process.argv[2]));}catch(e){console.error('Receipt export failed:',e.message);process.exitCode=1;}}
