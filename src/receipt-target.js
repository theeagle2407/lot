// Public fields only. Receipt metadata is not proof; the server must read the ledger.
export const receiptKeyValid=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
// Submission metadata can be a legacy 32-byte ID or a 33-byte tagged SDK ID.
// This does not relax the validation of batch keys or contract addresses.
export const submissionIdentifierValid=x=>typeof x==='string'&&/^(?:[a-f0-9]{64}|[a-f0-9]{66})$/.test(x);
export function receiptTarget(r,key){
 if(!r||r.network!=='preprod'||!receiptKeyValid(key)||!receiptKeyValid(r.batchKey)||(r.batchKey!==key&&r.receiptKey!==key)||(r.receiptKey!==undefined&&(!receiptKeyValid(r.receiptKey)||r.receiptKey!==key||r.batchKey===key))||(r.inspectorFingerprint!==undefined&&!receiptKeyValid(r.inspectorFingerprint))||!/^LOT-[A-Z0-9-]{1,48}$/.test(r.batchId)||!/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(r.policyId)||![r.contractAddress,r.policyKey,r.clearanceKey].every(receiptKeyValid)||!Number.isSafeInteger(r.minStrength)||r.minStrength<1||r.minStrength>100000||!Number.isSafeInteger(r.maxDefectsBps)||r.maxDefectsBps<0||r.maxDefectsBps>10000)throw Error('Invalid public receipt');
 const {network,batchId,batchKey,policyId,policyKey,clearanceKey,minStrength,maxDefectsBps,contractAddress}=r;
 return {network,batchId,batchKey,policyId,policyKey,clearanceKey,minStrength,maxDefectsBps,contractAddress,...(r.receiptKey?{receiptKey:r.receiptKey}:{}),...(r.inspectorFingerprint?{inspectorFingerprint:r.inspectorFingerprint}:{})};
}
export function receiptSubmissions(r){const result={};for(const [out,step] of [['deployment','deploy'],['inspection','inspection'],['policy','policy'],['clearance','clearance']]){const s=r?.steps?.[step];if(!s||!['confirmed','confirmed-by-ledger'].includes(s.status))throw Error('Incomplete receipt');const id=s.submittedIdentifier??s.txId;if(id!=null&&!submissionIdentifierValid(id))throw Error('Invalid submission identifier');if(id)result[out]=id;}return result;}
export const receiptPath=key=>{if(!receiptKeyValid(key))throw Error('Invalid receipt key');return '/verify-preprod?key='+key;};
