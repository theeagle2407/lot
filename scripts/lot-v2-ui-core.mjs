/** Build 20: strictly public request projection for terminal-authorized V2 actions. */
import {parseVaultProofArgs} from './lot-vault-bridge.mjs';
const BATCH=/^LOT-[A-Z0-9-]{1,48}$/;
const EXACT = (obj, names) => obj!==null && typeof obj==='object' && !Array.isArray(obj) &&
  Object.keys(obj).sort().join('|')===names.slice().sort().join('|');

export function validateV2UiRequest(raw){
  if(!raw||typeof raw!=='object')throw new Error('Invalid V2 request.');
  if(raw.mode==='init'){
    if(!EXACT(raw,['mode','batchId'])||!BATCH.test(raw.batchId))throw new Error('Invalid signed inspection request.');
    return Object.freeze({mode:'init',batchId:raw.batchId,args:['init',raw.batchId]});
  }
  if(raw.mode==='prove'){
    if(!EXACT(raw,['mode','batchId','policyId','minStrength','maxDefectsBps']))throw new Error('Invalid buyer proof request.');
    if(!Number.isSafeInteger(raw.minStrength)||!Number.isSafeInteger(raw.maxDefectsBps))throw new Error('Thresholds must be whole numbers.');
    const p=parseVaultProofArgs([raw.batchId,raw.policyId,String(raw.minStrength),String(raw.maxDefectsBps)]);
    return Object.freeze({mode:'prove',...p,args:['prove',p.batchId,p.policyId,String(p.minStrength),String(p.maxDefectsBps)]});
  }
  throw new Error('Expected init or prove.');
}
export function validateV2UiBatch(batchId){if(typeof batchId!=='string'||!BATCH.test(batchId))throw new Error('Invalid batch ID.');return batchId;}
export function publicV2Session(state){
 if(!state)return null;
 const {batchId,contractAddress,inspectionTx}=state;
 if(!BATCH.test(batchId)||!/^[0-9a-f]{64}$/.test(contractAddress)||!/^[0-9a-f]{66}$/.test(inspectionTx))throw new Error('Invalid saved V2 session.');
 return {batchId,contractAddress,inspectionTx};
}
export function publicV2Job(job){
 if(!job)return null;
 return {id:job.id,mode:job.mode,batchId:job.batchId,status:job.status,phase:job.phase,
   ...(job.policyId?{policyId:job.policyId}:{})};
}
