/** Public archive status. Describes saved receipts, not independently revalidated txs. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultEvidenceFile, readPublicEvidence } from './lot-proof-archive.mjs';
import { summarizeEvidenceSessions } from './lot-evidence-summary.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
try {
  const records = readPublicEvidence(defaultEvidenceFile(root));
  const sessions = summarizeEvidenceSessions(records);
  console.log(`LOT archived local receipts: ${records.length}`);
  console.log(`Distinct inspection sessions: ${sessions.length}`);
  console.log(`Total archived clearances: ${sessions.reduce((count,s)=>count+s.clearanceCount,0)}`);
  if (sessions.length) {
    const last = sessions.at(-1);
    console.log(`Latest batch: ${last.batchId}`);
    console.log(`Latest contract: ${last.contractAddress}`);
    console.log(`Latest inspection TX: ${last.inspectionTx}`);
    console.log(`Clearances for latest inspection: ${last.clearanceCount}`);
    console.log(`Buyer policies: ${last.clearances.map(c=>c.policyId).join(', ')}`);
  }
  console.log('Archive is public-only local-development evidence; current chain state is not rechecked by this command.');
} catch (error) {
  console.error('LOT evidence summary failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode=1;
}
