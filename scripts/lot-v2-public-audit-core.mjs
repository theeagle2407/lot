/** Testable, read-only checks for exact V2 public state membership. */
export function checkV2PublicLedger(session, state, { batchKey, policyKey, clearanceKey }) {
  if (!state || !session || !Array.isArray(session.clearances) || session.clearances.length===0)
    return {ok:false,reason:'Missing inspection or public ledger state'};
  try {
    const batch = batchKey(session.batchId);
    if(!state.inspections.member(batch))return {ok:false,reason:'Batch not found on current local chain'};
    for(const buyer of session.clearances){
      const policy = policyKey(buyer.policyId);
      if(!state.minimumStrength.member(policy) || !state.maximumDefectsBps.member(policy))
        return {ok:false,reason:`Buyer policy not found: ${buyer.policyId}`};
      if (BigInt(state.minimumStrength.lookup(policy))!==BigInt(buyer.minStrength) ||
          BigInt(state.maximumDefectsBps.lookup(policy))!==BigInt(buyer.maxDefectsBps))
        return {ok:false,reason:`Buyer policy thresholds differ: ${buyer.policyId}`};
      if (!state.clearances.member(clearanceKey(session.batchId,buyer.policyId)))
        return {ok:false,reason:`Clearance absent: ${buyer.policyId}`};
    }
    return {ok:true,batchId:session.batchId,contractAddress:session.contractAddress,
      clearanceCount:session.clearances.length,policies:session.clearances.map(x=>x.policyId)};
  } catch {return {ok:false,reason:'Unable to decode the current V2 public ledger'};}
}
