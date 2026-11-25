#!/usr/bin/env node
/** Independent, read-only V2 PREPROD state check. Never reads local receipt archives or vault. */
import {loadProjectToken} from './lot-preprod-credentials.mjs';
import {parsePublicAuditArgs,preprodIndexerUrls} from './lot-preprod-core.mjs';
async function main(){
 const input=parsePublicAuditArgs(process.argv.slice(2));
 const token=loadProjectToken();
 if(!token)throw new Error('Configure a Midnight Preprod Blockfrost project token first.');
 const urls=preprodIndexerUrls(token);
 const [{setNetworkId},{indexerPublicDataProvider},{ContractState},{ledger},{auditV2PublicState}]=await Promise.all([
   import('@midnight-ntwrk/midnight-js-network-id'),
   import('@midnight-ntwrk/midnight-js-indexer-public-data-provider'),
   import('@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime'),
   import('../contracts/managed/lot-v2/contract/index.js'),
   import('./lot-v2-public-audit.mjs'),
 ]);
 setNetworkId('preprod');
 const indexer=indexerPublicDataProvider(urls.http,urls.ws);
 let timer;
 const state=await Promise.race([
   indexer.queryContractState(input.contractAddress),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Preprod query timed out.')),18000);}),
 ]).finally(()=>clearTimeout(timer));
 if(!state||state.contractState?.era!=='v9')throw new Error('No Ledger 9 V2 contract state returned by Preprod.');
 const decoded=state.contractState.deserialize({v9:ContractState});
 const result=auditV2PublicState({...input,clearances:[{
   policyId:input.policyId,minStrength:input.minStrength,maxDefectsBps:input.maxDefectsBps,
 }]},ledger(decoded.data));
 if(!result.ok)throw new Error('Preprod public state did not match the requested batch and buyer policy.');
 console.log('LOT V2 PREPROD STATE VERIFIED');
 console.log('Network: preprod · read-only');
 console.log('Batch:',input.batchId);
 console.log('Buyer:',input.policyId);
 console.log('Contract:',input.contractAddress);
 console.log('Verified current inspection membership, buyer policy thresholds, and clearance membership.');
 console.log('Not a transaction-history or independent laboratory-accreditation check.');
}
main().catch(e=>{ // prevent credentials and remote error payloads from entering shared logs
 const safe=e?.message;
 const allowed = /^(Usage:|Invalid public audit arguments|Configure a Midnight|No Ledger 9|Preprod query timed out|Preprod public state did not match)/.test(safe??'');
 console.error('LOT Preprod audit:',allowed?safe:'Public indexer request failed or contract could not be decoded.');
 process.exitCode=1;
});
