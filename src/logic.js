/** Demo-only business rules. They are NOT cryptographic proofs or inspector signatures. */
export function checkedNumber(value, label) {
  const number = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(number) || number < 0) throw new Error(`${label} must be a nonnegative number.`);
  return number;
}
export function validateReport({strength, defectRate}) {
  const a = checkedNumber(strength, 'Strength');
  const b = checkedNumber(defectRate, 'Defect rate');
  if (b > 100) throw new Error('Defect rate cannot exceed 100%.');
  return {strength:a, defectRate:b};
}
export function validatePolicy({minimumStrength, maximumDefects}) {
  const a = checkedNumber(minimumStrength, 'Minimum strength');
  const b = checkedNumber(maximumDefects, 'Maximum defect rate');
  if (b > 100) throw new Error('Maximum defect rate cannot exceed 100%.');
  return {minimumStrength:a,maximumDefects:b};
}
export function evaluatePolicy(report, policy) {
  const measurements=validateReport(report);
  const rules=validatePolicy(policy);
  const checks={strength:measurements.strength>=rules.minimumStrength, defects:measurements.defectRate<=rules.maximumDefects};
  return {passed:checks.strength && checks.defects,checks,policyId:policy.id??null};
}
export function evaluateAll(report, policies){return policies.map(policy=>({buyer:policy.buyer,policyId:policy.id,...evaluatePolicy(report,policy)}));}
export function createInspection({batchId, material, inspector, strength, defectRate}) {
  const id=String(batchId||'').trim().toUpperCase();
  if(!id || id.length>36 || !/^[A-Z0-9-]+$/.test(id)) throw new Error('Use 1–36 letters, numbers or hyphens for the batch ID.');
  if(!String(material||'').trim()) throw new Error('Material is required.');
  const measures=validateReport({strength,defectRate});
  return {id,material:String(material).trim(),inspector:String(inspector||'Northstar Labs').trim(),issuerStatus:'demo',date:new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date()),...measures};
}
/** Buyer-safe projection: omit measurements and all report-opening information. */
export function buyerProjection(report, policies) {
  if(!report)return null;
  return {id:report.id,material:report.material,inspector:report.inspector,date:report.date,demonstration:true,clearances:evaluateAll(report,policies).map(({buyer,policyId,passed,checks})=>({buyer,policyId,passed,checks}))};
}
export function downloadProjection(report,policies){return JSON.stringify({product:'LOT',environment:'DEMONSTRATION ONLY — NOT A MIDNIGHT PROOF',...buyerProjection(report,policies)},null,2);}
