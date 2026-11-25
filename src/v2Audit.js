/** Validate a fresh, public, current-local-ledger check for one archived buyer receipt. */
const batch=/^LOT-[A-Z0-9-]{1,48}$/;
const contract=/^[0-9a-f]{64}$/;
const tx=/^[0-9a-f]{66}$/;
export function isCurrentLocalClearance(audit, clearance) {
 if(!audit || audit.status!=='verified'||audit.network!=='local'||
   !batch.test(audit.batchId) || !contract.test(audit.contractAddress) ||
   !tx.test(audit.inspectionTx) || !Array.isArray(audit.clearances) ||
   !clearance || audit.batchId!==clearance.batchId ||
   audit.contractAddress!==clearance.contractAddress || audit.inspectionTx!==clearance.inspectionTx) return false;
 return audit.clearances.some(c => c.policyId===clearance.policyId &&
   c.minStrength===clearance.minStrength && c.maxDefectsBps===clearance.maxDefectsBps &&
   c.policyTx===clearance.policyTx && c.clearanceTx===clearance.clearanceTx);
}
export async function checkCurrentLocalClearance(clearance){
 if(!clearance || !batch.test(clearance.batchId)||!contract.test(clearance.contractAddress)||!tx.test(clearance.inspectionTx))return {status:'unverified'};
 const query=new URLSearchParams({batch:clearance.batchId,contract:clearance.contractAddress,inspection:clearance.inspectionTx});
 const response=await fetch(`/api/proof/v2-audit?${query}`,{cache:'no-store'});
 if(!response.ok) throw new Error('Local ledger check unavailable.');
 const result=await response.json();
 if(!result?.ok)throw new Error('Local ledger check unavailable.');
 return result;
}

/** Public buyer link sees ONLY its selected clearance, never all buyer policies. */
export async function checkScopedBuyerClearance(clearance, {signal}={}) {
 if(!clearance || !batch.test(clearance.batchId)||!contract.test(clearance.contractAddress)||
    !tx.test(clearance.clearanceTx))return {status:'unverified'};
 const query=new URLSearchParams({batch:clearance.batchId,policy:clearance.policyId,
   contract:clearance.contractAddress,clearance:clearance.clearanceTx});
 const response=await fetch(`/api/proof/buyer-audit?${query}`,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal});
 if(!response.ok)throw new Error('Local ledger check unavailable.');
 const result=await response.json();
 if(!result?.ok)throw new Error('Local ledger check unavailable.');
 return result;
}
