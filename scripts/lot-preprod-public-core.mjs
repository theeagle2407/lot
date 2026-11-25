import {TARGET} from '../src/preprod-clearance.js';
// Pure ledger evaluation; no wallet or transaction APIs.
export function evaluatePublicLedger(state,batchKey,policyKey,clearanceKey,now=new Date(),target=TARGET){
 const inspectionPresent=state.inspections.member(batchKey)===true;
 const minPresent=state.minimumStrength.member(policyKey)===true;
 const maxPresent=state.maximumDefectsBps.member(policyKey)===true;
 const policyMatches=minPresent&&maxPresent&&state.minimumStrength.lookup(policyKey)===BigInt(target.minStrength)&&state.maximumDefectsBps.lookup(policyKey)===BigInt(target.maxDefectsBps);
 const clearancePresent=state.clearances.member(clearanceKey)===true&&state.clearances.lookup(clearanceKey)===true;
 return {...target,status:inspectionPresent&&policyMatches&&clearancePresent?'verified':'not_verified',inspectionPresent,policyMatches,clearancePresent,checkedAt:now.toISOString()};
}
export function createPublicReader(read,{cooldownMs=5000,clock=Date.now}={}){
 let pending=null,last=null,lastAt=-Infinity;
 return async function verify(){
  if(pending)return pending;
  if(last&&clock()-lastAt<cooldownMs)return last;
  pending=Promise.resolve().then(read).then(result=>{last=result;lastAt=clock();return result;},()=>{last=null;throw new Error('Ledger unavailable');}).finally(()=>{pending=null;});
  return pending;
 };
}
