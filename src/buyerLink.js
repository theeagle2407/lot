/** Local-development buyer links. Only public receipt identifiers are included.
 * A link does not confer a verified status; the buyer page ALWAYS rechecks the ledger.
 * These links are limited to the same local LOT service, never a public URL.
 */
const BATCH=/^LOT-[A-Z0-9-]{1,48}$/;
const POLICY=/^[A-Za-z0-9-]{1,36}$/;
const CONTRACT=/^[a-f0-9]{64}$/;
const TX=/^[a-f0-9]{66}$/;

export function validLocalBuyerTarget(x){
 return !!x && BATCH.test(x.batchId) && POLICY.test(x.policyId) &&
    CONTRACT.test(x.contractAddress) && TX.test(x.clearanceTx);
}
export function buyerTargetFromReceipt(x){
 if(!validLocalBuyerTarget(x)) throw new Error('Invalid public buyer receipt.');
 return Object.freeze({batchId:x.batchId,policyId:x.policyId,contractAddress:x.contractAddress,clearanceTx:x.clearanceTx});
}
export function localBuyerHash(target){
 const x=buyerTargetFromReceipt(target);
 return `#/buyer/${x.batchId}/${x.policyId}/${x.contractAddress}/${x.clearanceTx}`;
}
export function parseLocalBuyerHash(hash){
 if(typeof hash!=='string' || !hash.startsWith('#/buyer'))return null;
 const parts=hash.split('/');
 if(parts.length!==6 || parts[0]!=='#' || parts[1]!=='buyer')return {invalid:true};
 const [, , batchId,policyId,contractAddress,clearanceTx]=parts;
 const target={batchId,policyId,contractAddress,clearanceTx};
 return validLocalBuyerTarget(target)?Object.freeze(target):{invalid:true};
}
export function matchesLocalBuyerTarget(receipt,target){
 return validLocalBuyerTarget(target) && validLocalBuyerTarget(receipt) &&
  receipt.batchId===target.batchId && receipt.policyId===target.policyId &&
  receipt.contractAddress===target.contractAddress && receipt.clearanceTx===target.clearanceTx;
}
export function localBuyerLink(href,receipt){
 const url=new URL(href);
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !['http:','https:'].includes(url.protocol))
  throw new Error('Local proof links must use the local LOT website.');
 url.username='';
 url.password='';
 url.search='';
 url.hash=localBuyerHash(receipt);
 return url.toString();
}
