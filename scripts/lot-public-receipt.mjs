/** Strict file transport from network runner to localhost API. No raw measurements. */
import { readFileSync, writeFileSync } from 'node:fs';
import { publicReceipt } from './lot-proof-utils.mjs';
import { isValidPublicChainId, publicIdFields } from './lot-chain-ids.mjs';

export function writeLocalPublicReceipt(filePath, receipt) {
  if(typeof filePath!=='string'||!filePath)throw new Error('Missing local receipt file path.');
  const ids={};
  for(const field of publicIdFields){
    if(!isValidPublicChainId(field,receipt?.[field]))throw new Error(`Invalid public ${field}.`);
    ids[field]=receipt[field];
  }
  const additional=receipt?.additional??[];
  if(!Array.isArray(additional)||additional.length>5)throw new Error('Invalid additional clearances.');
  if(additional.length){
    ids.additional=additional.map(item=>{
      if(!item || typeof item!=='object' || !/^[A-Za-z0-9-]{1,36}$/.test(item.policyLabel) ||
        !Number.isSafeInteger(item.minStrength)||item.minStrength<1||item.minStrength>1e9||
        !Number.isSafeInteger(item.maxDefectsBps)||item.maxDefectsBps<0||item.maxDefectsBps>10000||
        !isValidPublicChainId('policyTx',item.policyTx)||!isValidPublicChainId('clearanceTx',item.clearanceTx)) {
        throw new Error('Invalid additional buyer clearance.');
      }
      return {policyLabel:item.policyLabel,minStrength:item.minStrength,maxDefectsBps:item.maxDefectsBps,policyTx:item.policyTx,clearanceTx:item.clearanceTx};
    });
  }
  writeFileSync(filePath,JSON.stringify(ids),{flag:'wx',mode:0o600,encoding:'utf8'});
}
export function readLocalPublicReceipt(filePath,batchId,policyId,publicPolicy,expectedExtras=[]) {
  const raw=readFileSync(filePath,'utf8');
  if(raw.length>4096)throw new Error('Receipt file exceeded maximum size.');
  return publicReceipt(JSON.parse(raw),batchId,policyId,publicPolicy,expectedExtras);
}
