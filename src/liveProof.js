/** LOT's local developer-only proof interface. Not a production wallet connector. */
async function jsonResponse(response){
  const data=await response.json().catch(()=>({ok:false,error:'The local proof service returned an invalid response.'}));
  if(!response.ok||!data.ok)throw new Error(data.error||'The local proof service is unavailable.');
  return data;
}
export async function latestLocalProof(){
  return (await jsonResponse(await fetch('/api/proof/status',{cache:'no-store'}))).job;
}
export async function startLocalProof(report,policy,allPolicies=[]){
  const {csrf}=await jsonResponse(await fetch('/api/proof/session',{cache:'no-store'}));
  const otherPolicies=allPolicies.filter(p=>p.id!==policy.id).map(p=>({policyId:p.id,minStrength:p.minimumStrength,maxDefects:p.maximumDefects}));
  const response=await fetch('/api/proof/run',{
    method:'POST',headers:{'content-type':'application/json','x-lot-csrf':csrf},
    body:JSON.stringify({
      batchId:report.id,policyId:policy.id,
      strength:report.strength,defectRate:report.defectRate,
      minStrength:policy.minimumStrength,maxDefects:policy.maximumDefects,otherPolicies,
    }),
  });
  return (await jsonResponse(response)).job;
}
/** Returns only a clearance that matches the exact batch and public policy version. */
export function confirmedClearance(job,batchId,policy){
  if(job?.status!=='confirmed' || job.receipt?.batchId!==batchId || !policy)return null;
  const r=job.receipt;
  const items=[{policyId:r.policyId,policy:r.policy,policyTx:r.policyTx,clearanceTx:r.clearanceTx},...(r.additional||[])];
  return items.find(item=>item.policyId===policy.id && item.policy?.minStrength===policy.minimumStrength && item.policy?.maxDefectsBps===Math.round(policy.maximumDefects*100))||null;
}
export function verifiedFor(job,batchId,policy){return Boolean(confirmedClearance(job,batchId,policy));}
export function buyerSafeReceipt(job,policy){
  const r=job?.receipt;
  const item=confirmedClearance(job,r?.batchId,policy);
  if(!item)throw new Error('No matching finalized proof to export.');
  return {
    product:'LOT',network:'local',testData:true,result:'qualified',
    batchId:r.batchId,policyId:item.policyId,policy:item.policy,contractAddress:r.contractAddress,
    transactions:{inspection:r.inspectionTx,policy:item.policyTx,clearance:item.clearanceTx},
  };
}
