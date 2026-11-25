/** Read-only V2 ledger validation. Never reads the private report or admin key. */
import { summarizeEvidenceSessions } from './lot-evidence-summary.mjs';
const RX_BATCH = /^LOT-[A-Z0-9-]{1,48}$/;
const RX_ADDRESS = /^[0-9a-f]{64}$/;
const RX_TX = /^[0-9a-f]{66}$/;

export function findAuditableSession(records, savedSession, request) {
  if (!request || !RX_BATCH.test(request.batchId) || !RX_ADDRESS.test(request.contractAddress) || !RX_TX.test(request.inspectionTx))
    return null;
  if (!savedSession || savedSession.batchId!==request.batchId ||
      savedSession.contractAddress!==request.contractAddress || savedSession.inspectionTx!==request.inspectionTx) return null;
  const matches=summarizeEvidenceSessions(records).filter(s =>
    s.batchId===request.batchId && s.contractAddress===request.contractAddress &&
    s.inspectionTx===request.inspectionTx && s.clearanceCount>0);
  return matches.length===1 ? matches[0] : null;
}

/** The status returned to the browser is an explicit public-only allowlist. */
export function publicAuditResult(session, check, checkedAt = new Date().toISOString()) {
  if(!session || check?.ok!==true || check.batchId!==session.batchId ||
      check.contractAddress!==session.contractAddress || check.clearanceCount!==session.clearances.length ||
      !Array.isArray(check.policies) || check.policies.length!==session.clearances.length ||
      session.clearances.some(c=>!check.policies.includes(c.policyId))) return {status:'unverified'};
  return {status:'verified',network:'local',checkedAt,
    batchId:session.batchId,contractAddress:session.contractAddress,inspectionTx:session.inspectionTx,
    clearances:session.clearances.map(c=>({policyId:c.policyId,minStrength:c.minStrength,
      maxDefectsBps:c.maxDefectsBps,policyTx:c.policyTx,clearanceTx:c.clearanceTx}))};
}
