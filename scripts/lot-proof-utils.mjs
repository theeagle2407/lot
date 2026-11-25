/** Local-only developer proof input and public output boundaries.
 * Measurements enter this trusted localhost runner in plaintext. Do NOT deploy publicly.
 */
import { isValidPublicChainId, publicIdFields } from './lot-chain-ids.mjs';

function safeInt(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be a whole number between ${min} and ${max}.`);
  }
  return value;
}
function toBps(percent, label) {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(`${label} must be between 0 and 100%.`);
  }
  const exact = percent * 100;
  const bps = Math.round(exact);
  if (Math.abs(exact - bps) > 1e-7) throw new Error(`${label} supports at most two decimal places.`);
  return bps;
}
const cleanRef = (value, label) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9-]{1,36}$/.test(value)) {
    throw new Error(`${label} must be 1–36 letters, numbers or hyphens.`);
  }
  return value;
};
const parsePolicy = (id, strength, defectsBps, minStrength, maxDefects) => {
  const policyLabel = cleanRef(id, 'Policy ID');
  const min = safeInt(minStrength, 'Minimum strength', {min:1, max:1000000000});
  const max = toBps(maxDefects, 'Maximum defect rate');
  return {policyLabel, minStrength:min, maxDefectsBps:max, passed:strength>=min && defectsBps<=max};
};
export function validateLocalProofInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid proof request.');
  const batchLabel = cleanRef(input.batchId, 'Batch ID');
  const strength = safeInt(input.strength, 'Strength', {min:1,max:1000000000});
  const defectsBps = toBps(input.defectRate, 'Defect rate');
  const main = parsePolicy(input.policyId,strength,defectsBps,input.minStrength,input.maxDefects);
  if (!main.passed) throw new Error('This report does not meet the selected policy. No valid clearance can be created.');
  const extras = input.otherPolicies ?? [];
  if(!Array.isArray(extras) || extras.length>5) throw new Error('At most five additional buyer policies are allowed.');
  const seen = new Set([main.policyLabel]);
  const extraPolicies = [];
  for(const p of extras){
    if(!p || typeof p !== 'object' || Array.isArray(p))throw new Error('Invalid additional buyer policy.');
    const candidate = parsePolicy(p.policyId,strength,defectsBps,p.minStrength,p.maxDefects);
    if(seen.has(candidate.policyLabel)) throw new Error('Buyer policy IDs must be unique.');
    seen.add(candidate.policyLabel);
    // The contract only publishes passing clearances; a missing proof means NOT PROVEN.
    if(candidate.passed) extraPolicies.push({policyLabel:candidate.policyLabel,minStrength:candidate.minStrength,maxDefectsBps:candidate.maxDefectsBps});
  }
  const base = {batchLabel,policyLabel:main.policyLabel,strength,minStrength:main.minStrength,defectsBps,maxDefectsBps:main.maxDefectsBps};
  return extraPolicies.length ? {...base,extraPolicies} : base;
}
/** Revalidate input after JSON crosses into the isolated test child process. */
export function validateNormalizedProofInput(normalized) {
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) throw new Error('Invalid normalized proof request.');
  const defectsBps = safeInt(normalized.defectsBps,'Defect rate basis points',{max:10000});
  const maxDefectsBps = safeInt(normalized.maxDefectsBps,'Maximum defect rate basis points',{max:10000});
  const extras = normalized.extraPolicies ?? [];
  if(!Array.isArray(extras) || extras.length>5) throw new Error('Invalid additional buyer policies.');
  const raw = {
    batchId:normalized.batchLabel,policyId:normalized.policyLabel,strength:normalized.strength,
    defectRate:defectsBps/100,minStrength:normalized.minStrength,maxDefects:maxDefectsBps/100,
    otherPolicies:extras.map(p=>({
      policyId:p?.policyLabel,minStrength:p?.minStrength,maxDefects:safeInt(p?.maxDefectsBps,'Maximum defect rate basis points',{max:10000})/100,
    })),
  };
  const result = validateLocalProofInput(raw);
  if(result.defectsBps!==defectsBps || result.maxDefectsBps!==maxDefectsBps ||
      (result.extraPolicies?.length??0)!==extras.length) throw new Error('Invalid normalized defect precision or buyer policy.');
  return result;
}
const checkPublicIds = (receipt) => {
  for(const field of publicIdFields){
    if(!isValidPublicChainId(field,receipt?.[field]))throw new Error(`Missing valid ${field}.`);
  }
};
/** Project only allowlisted chain data. Expected policy values come from API validation,
 * not from untrusted receipt JSON. */
export function publicReceipt(receipt,batchLabel,policyLabel,publicPolicy,expectedExtras=[]) {
  checkPublicIds(receipt);
  const additional = receipt?.additional ?? [];
  if(!Array.isArray(additional)||additional.length!==expectedExtras.length)throw new Error('Unexpected number of buyer clearances.');
  const others=additional.map((raw,i)=>{
    const expected=expectedExtras[i];
    if(raw?.policyLabel!==expected.policyLabel || raw?.minStrength!==expected.minStrength || raw?.maxDefectsBps!==expected.maxDefectsBps ||
      !isValidPublicChainId('policyTx',raw.policyTx) || !isValidPublicChainId('clearanceTx',raw.clearanceTx)) {
      throw new Error('Invalid additional buyer clearance.');
    }
    return Object.freeze({policyId:expected.policyLabel,policy:{minStrength:expected.minStrength,maxDefectsBps:expected.maxDefectsBps},policyTx:raw.policyTx,clearanceTx:raw.clearanceTx});
  });
  return Object.freeze({
    network:'local',contractAddress:receipt.contractAddress,
    inspectionTx:receipt.inspectionTx,policyTx:receipt.policyTx,clearanceTx:receipt.clearanceTx,
    batchId:batchLabel,policyId:policyLabel,
    policy:{minStrength:publicPolicy.minStrength,maxDefectsBps:publicPolicy.maxDefectsBps},
    additional:Object.freeze(others),result:'qualified',testData:true,
  });
}
