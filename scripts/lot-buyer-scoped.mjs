/** Only the exact clearance named by a local buyer link can be returned publicly.
 * This is NOT an authorization scheme for an internet deployment. Ledger data is public.
 */
import {savedPublicClearances} from '../src/evidence.js';
import {validLocalBuyerTarget,matchesLocalBuyerTarget} from '../src/buyerLink.js';

const QUERY_KEYS=['batch','clearance','contract','policy'];
export function parseBuyerQuery(raw) {
  const params=raw instanceof URLSearchParams ? raw : new URLSearchParams(raw);
  if([...params.keys()].sort().join('|')!==QUERY_KEYS.join('|'))return null;
  const target={batchId:params.get('batch'),policyId:params.get('policy'),contractAddress:params.get('contract'),clearanceTx:params.get('clearance')};
  return validLocalBuyerTarget(target) ? target : null;
}
export function findScopedBuyerReceipt(records,target) {
  if(!validLocalBuyerTarget(target))return null;
  const matches=savedPublicClearances(records).filter(c=>matchesLocalBuyerTarget(c,target));
  if(!matches.length)return null;
  const first=matches[0];
  // A malformed archive with contradictory evidence must fail closed.
  if(matches.some(c=>c.inspectionTx!==first.inspectionTx || c.policyTx!==first.policyTx ||
        c.minStrength!==first.minStrength || c.maxDefectsBps!==first.maxDefectsBps)) return null;
  return Object.freeze({key:`shared:${first.batchId}:${first.policyId}:${first.clearanceTx}`,
    batchId:first.batchId,policyId:first.policyId,contractAddress:first.contractAddress,
    inspectionTx:first.inspectionTx,policyTx:first.policyTx,clearanceTx:first.clearanceTx,
    minStrength:first.minStrength,maxDefectsBps:first.maxDefectsBps,savedAt:first.savedAt});
}
/** Even though the internal audit evaluates the full session, publish ONLY one buyer's result. */
export function scopedBuyerAuditResult(audit,receipt) {
 if(!receipt || !validLocalBuyerTarget(receipt)) return {status:'unverified'};
 if(audit?.status!=='verified')return {status:audit?.status==='unavailable'?'unavailable':'unverified'};
 if(audit.network!=='local' || audit.batchId!==receipt.batchId ||
    audit.contractAddress!==receipt.contractAddress || audit.inspectionTx!==receipt.inspectionTx ||
    !Array.isArray(audit.clearances))return {status:'unverified'};
 const exact=audit.clearances.filter(c=>c.policyId===receipt.policyId &&
   c.policyTx===receipt.policyTx && c.clearanceTx===receipt.clearanceTx &&
   c.minStrength===receipt.minStrength && c.maxDefectsBps===receipt.maxDefectsBps);
 if(exact.length!==1)return {status:'unverified'};
 const c=exact[0];
 return {status:'verified',network:'local',checkedAt:audit.checkedAt,
   batchId:receipt.batchId,contractAddress:receipt.contractAddress,inspectionTx:receipt.inspectionTx,
   clearances:[{policyId:c.policyId,policyTx:c.policyTx,clearanceTx:c.clearanceTx,
     minStrength:c.minStrength,maxDefectsBps:c.maxDefectsBps}]};
}
