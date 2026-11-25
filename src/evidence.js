import {validLocalBuyerTarget,matchesLocalBuyerTarget} from './buyerLink.js';
/** Read-only local-development receipts. NEVER carry witness inputs into this view. */
const idPattern = /^[a-zA-Z0-9-]{1,36}$/;
const contractPattern = /^[0-9a-f]{64}$/i;
const transactionPattern = /^[0-9a-f]{66}$/i;

function policyIsValid(p) {
  return p && Number.isSafeInteger(p.minStrength) && p.minStrength > 0 && p.minStrength <= 1_000_000_000 &&
    Number.isSafeInteger(p.maxDefectsBps) && p.maxDefectsBps >= 0 && p.maxDefectsBps <= 10_000;
}
function receiptIdsValid(r) {
  return contractPattern.test(r?.contractAddress) &&
    transactionPattern.test(r?.inspectionTx) &&
    transactionPattern.test(r?.policyTx) &&
    transactionPattern.test(r?.clearanceTx);
}
/** Projection is deliberately field-by-field; it cannot leak raw readings or salts. */
export function savedPublicClearances(records) {
  if (!Array.isArray(records)) return [];
  const output=[];
  for (const entry of records.slice(-40).reverse()) {
    const r=entry?.receipt;
    if (!r || !idPattern.test(entry?.id || '') || !idPattern.test(r.batchId) ||
        r.network!=='local' || r.result!=='qualified' || r.testData!==true ||
        !idPattern.test(r.policyId) || !policyIsValid(r.policy) ||
        !receiptIdsValid(r)) continue;
    const all=[{policyId:r.policyId,policy:r.policy,policyTx:r.policyTx,clearanceTx:r.clearanceTx},
      ...(Array.isArray(r.additional)?r.additional.slice(0,5):[])];
    const seen=new Set();
    for (const item of all) {
      if (!idPattern.test(item?.policyId) || !policyIsValid(item?.policy) ||
          !transactionPattern.test(item?.policyTx) || !transactionPattern.test(item?.clearanceTx) ||
          seen.has(item.policyId)) continue;
      seen.add(item.policyId);
      output.push(Object.freeze({
        key:`${entry.id}:${item.policyId}`, batchId:r.batchId, policyId:item.policyId,
        minStrength:item.policy.minStrength, maxDefectsBps:item.policy.maxDefectsBps,
        contractAddress:r.contractAddress,inspectionTx:r.inspectionTx,
        policyTx:item.policyTx,clearanceTx:item.clearanceTx,
        savedAt:entry.savedAt,
      }));
    }
  }
  return output;
}
export async function loadSavedPublicClearances() {
  const response=await fetch('/api/proof/history',{cache:'no-store'});
  if(!response.ok) throw new Error('Local evidence service unavailable.');
  const result=await response.json();
  if(!result?.ok)throw new Error('Local evidence service unavailable.');
  return savedPublicClearances(result.records);
}
/** Public receipt export. Do not spread objects received from HTTP. */
export function exportSavedClearance(c) {
  if (!c || !contractPattern.test(c.contractAddress) ||
    !transactionPattern.test(c.inspectionTx) ||
    !transactionPattern.test(c.policyTx) ||
    !transactionPattern.test(c.clearanceTx) ||
    !idPattern.test(c.batchId) || !idPattern.test(c.policyId)) {
    throw new Error('Invalid public clearance.');
  }
  return {
    product:'LOT',network:'local',testData:true,archiveOnly:true,
    result:'qualified',batchId:c.batchId,policyId:c.policyId,
    policy:{minStrength:c.minStrength,maxDefectsBps:c.maxDefectsBps},
    contractAddress:c.contractAddress,
    transactions:{inspection:c.inspectionTx,policy:c.policyTx,clearance:c.clearanceTx},
  };
}

/** Unauthenticated link-only lookup. No full archive is ever downloaded for a buyer link. */
export async function loadScopedBuyerClearance(target, {signal}={}) {
 if(!validLocalBuyerTarget(target))throw new Error('Invalid buyer verification link.');
 const query=new URLSearchParams({batch:target.batchId,policy:target.policyId,
   contract:target.contractAddress,clearance:target.clearanceTx});
 const response=await fetch(`/api/proof/buyer-receipt?${query}`,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal});
 if(!response.ok)throw new Error('Buyer receipt unavailable on this device.');
 const data=await response.json();
 const c=data?.receipt;
 if(!data?.ok || !matchesLocalBuyerTarget(c,target) ||
    !transactionPattern.test(c.inspectionTx) || !transactionPattern.test(c.policyTx) ||
    !Number.isSafeInteger(c.minStrength)||c.minStrength<1||c.minStrength>1_000_000_000||
    !Number.isSafeInteger(c.maxDefectsBps)||c.maxDefectsBps<0||c.maxDefectsBps>10_000)
    throw new Error('Buyer receipt does not match verification link.');
 return Object.freeze({key:`shared:${c.batchId}:${c.policyId}:${c.clearanceTx}`,
   batchId:c.batchId,policyId:c.policyId,contractAddress:c.contractAddress,
   inspectionTx:c.inspectionTx,policyTx:c.policyTx,clearanceTx:c.clearanceTx,
   minStrength:c.minStrength,maxDefectsBps:c.maxDefectsBps});
}
