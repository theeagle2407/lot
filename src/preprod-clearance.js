// Public deployment identifiers only. A saved identifier is NOT a verified result.
export const TARGET = Object.freeze({
 network:'preprod', batchId:'LOT-3002', policyId:'B-02',
 contractAddress:'00840699a415c117c2470838f649179362871143f6d8a000ad42614940d9d7b8',
 minStrength:550, maxDefectsBps:100,
 policyKey:'10a6f52df072acd855b6b1bc992602f99c7898b6cc1b61905fbe34520d1d7437',
 clearanceKey:'8fa779c5356c16a0dc40eaa799c498b20da2150a0c2042c0627606529b9e55b8',
});
export const SUBMISSIONS=Object.freeze({
 deployment:'00f02d73ea074c2bd4684020fefa31cd5301c0ad2bd0e7e71d8ac32a3e6155d663',
 inspection:'007d968c48f72502874a5e5ee095e8d7b71e7b985b56da1d42b672ecfb74e39ecf',
 clearance:'00b1066ca395cff1cbd8a906f0218969c984c8fb059648f98de1ad895aa82ae04a',
});
// Build 41: second reviewed public receipt. The batch key is the organization-bound request ID, not a hash of the display label.
export const ONBOARDED_TARGET=Object.freeze({
 network:'preprod',batchId:'LOT-0001',policyId:'B-02',minStrength:550,maxDefectsBps:100,
 batchKey:'eee890fa3380b60bf9f08a5c1904dea1ed239566b37bd56ba44db71aac65b7f9',
 policyKey:'10a6f52df072acd855b6b1bc992602f99c7898b6cc1b61905fbe34520d1d7437',
 clearanceKey:'32f21fb6a6f4666cb88e54cc7bd5d236e53d3b1357f5f6367f670d0d0c1ada5b',
 contractAddress:'c776e67c0d6784e377c421b5abc6bfa935c8c39ee0b521fe70c820a8ca647bcf',
});
export const ONBOARDED_SUBMISSIONS=Object.freeze({
 deployment:'0091a3c28a24b770240f89ae27e7534e817c85e3d932d1b5ce4583599331e9ebe3',
 inspection:'004e92f657c414299a6d3bc2e7b861b20f1444353f0e145705c02b5f4b24ffee84',
 policy:'00f009a6625dd30c2fac7a22836264ac4e68925112c1efa317480e8fa871048096',
 clearance:'00e9c4439df7d1b6035e65070935d044ae5ea5312e520d669ff9adc0cb217d292f',
});
export function targetFor(id){return id==='LOT-0001'?ONBOARDED_TARGET:id==='LOT-3002'?TARGET:null;}
export function submissionsFor(id){return id==='LOT-0001'?ONBOARDED_SUBMISSIONS:id==='LOT-3002'?SUBMISSIONS:null;}
export function buyerPath(id){if(!targetFor(id))throw Error('Unknown clearance');return '/verify-preprod?batch='+id;}
export function matchesOnboardedReceipt(b){return b?.id===ONBOARDED_TARGET.batchId&&b.requestId===ONBOARDED_TARGET.batchKey&&b.status==='signed';}
export const MAX_AGE=60_000;
export function validResult(r,now=Date.now(),target=TARGET){
 return !!r && r.network===target.network && r.batchId===target.batchId && r.policyId===target.policyId &&
 r.contractAddress===target.contractAddress && r.policyKey===target.policyKey && r.clearanceKey===target.clearanceKey &&
 r.minStrength===target.minStrength && r.maxDefectsBps===target.maxDefectsBps &&
 (!target.receiptKey||r.receiptKey===target.receiptKey) && (!target.inspectorFingerprint||(r.inspectorFingerprint===target.inspectorFingerprint&&r.enrolledInspectorFingerprint===target.inspectorFingerprint)) && (!target.batchKey||r.batchKey===target.batchKey) && r.status==='verified' && r.inspectionPresent===true && r.policyMatches===true && r.clearancePresent===true &&
 typeof r.checkedAt==='string' && Number.isFinite(Date.parse(r.checkedAt)) && Date.parse(r.checkedAt)<=now+5000 && now-Date.parse(r.checkedAt)<=MAX_AGE;
}
