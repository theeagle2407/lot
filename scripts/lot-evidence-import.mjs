/** One-time migration of the CURRENT successful Build 06 receipt before restart. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultEvidenceFile, storeConfirmedEvidence } from './lot-proof-archive.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
try {
  const response = await fetch('http://127.0.0.1:4175/api/proof/status', {
    signal: AbortSignal.timeout(6000), cache: 'no-store',
  });
  if (!response.ok) throw new Error('The existing local proof API did not respond.');
  const data = await response.json();
  const job = data?.job;
  if (job?.status !== 'confirmed') throw new Error('The API has no confirmed receipt to import.');
  const entry = storeConfirmedEvidence(defaultEvidenceFile(root), job);
  console.log('LOT local public evidence preserved.');
  console.log(`Batch: ${entry.receipt.batchId}`);
  console.log(`Buyer clearances: ${1 + entry.receipt.additional.length}`);
  console.log('No private inspection values stored.');
} catch (err) {
  console.error('LOT import not completed:', err.message);
  process.exitCode = 1;
}
