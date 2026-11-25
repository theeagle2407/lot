#!/usr/bin/env node
/** Read-only V2 local chain audit. Never loads report vault, wallet, or admin secret. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultEvidenceFile, readPublicEvidence } from './lot-proof-archive.mjs';
import { summarizeEvidenceSessions } from './lot-evidence-summary.mjs';
import { auditV2PublicState } from './lot-v2-public-audit.mjs';
import { sessionPublic } from './lot-v2-session-store.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function main(){
  const [batchId,...other] = process.argv.slice(2);
  if(other.length || typeof batchId!=='string' || !/^LOT-[A-Z0-9-]{1,48}$/.test(batchId))
    throw new Error('Usage: node scripts/lot-v2-session-audit.mjs LOT-3001');
  if (process.env.MIDNIGHT_NETWORK && process.env.MIDNIGHT_NETWORK!=='local')
    throw new Error('Local devnet only.');
  const saved=sessionPublic(batchId);
  const sessions=summarizeEvidenceSessions(readPublicEvidence(defaultEvidenceFile(root)));
  const matching=sessions.filter(s=>s.batchId===saved.batchId &&
    s.contractAddress===saved.contractAddress && s.inspectionTx===saved.inspectionTx);
  if(matching.length!==1 || matching[0].clearanceCount===0)
    throw new Error('No matching archived buyer clearances for the saved V2 session.');
  const { indexerPublicDataProvider } = await import('@midnight-ntwrk/midnight-js-indexer-public-data-provider');
  const { ContractState } = await import('@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime');
  const { ledger } = await import('../contracts/managed/lot-v2/contract/index.js');
  const indexer=indexerPublicDataProvider('http://127.0.0.1:8088/api/v4/graphql','ws://127.0.0.1:8088/api/v4/graphql/ws');
  const raw=await indexer.queryContractState(saved.contractAddress);
  if(!raw || raw.contractState.era!=='v9')throw new Error('Saved V2 contract not available on the current local devnet.');
  const decoded=raw.contractState.deserialize({v9:ContractState});
  const result=auditV2PublicState(matching[0],ledger(decoded.data));
  if(!result.ok)throw new Error(result.reason);
  console.log('LOT V2 PUBLIC STATE CHECK PASSED');
  console.log('Batch:',result.batchId);
  console.log('Contract:',result.contractAddress);
  console.log('Buyer clearances present:',result.clearanceCount);
  console.log('Policies:',result.policies.join(', '));
  console.log('Verified current local public ledger membership and policy thresholds.');
  console.log('Not a transaction-history audit, accredited-lab check, or public-network proof.');
}
main().catch(e=>{
  console.error('LOT V2 public audit:',e instanceof Error?e.message:'Failed');
  process.exitCode=1;
});
