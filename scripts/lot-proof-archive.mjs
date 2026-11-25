/**
 * LOT local-development archive of PUBLIC evidence only.
 * This is not an inspector record vault or a production database.
 * Never store witnesses, salts, readings, wallet seeds or private state here.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { publicReceipt } from './lot-proof-utils.mjs';

const SCHEMA = 1;
const MAX_ENTRIES = 40;
const MAX_BYTES = 256_000;
const refPattern = /^[A-Za-z0-9-]{1,36}$/;

export function defaultEvidenceFile(root) {
  const projectId = createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);
  return path.join(homedir(), '.lot-local', projectId, 'public-evidence.json');
}

function validPolicy(value) {
  return value && typeof value === 'object' &&
    Number.isSafeInteger(value.minStrength) && value.minStrength > 0 && value.minStrength <= 1_000_000_000 &&
    Number.isSafeInteger(value.maxDefectsBps) && value.maxDefectsBps >= 0 && value.maxDefectsBps <= 10_000;
}

/** Rebuild the receipt through the existing strict allowlist instead of copying objects. */
export function sanitizeArchiveReceipt(receipt) {
  if (!receipt || receipt.network !== 'local' || receipt.testData !== true || receipt.result !== 'qualified' ||
      typeof receipt.batchId !== 'string' || !refPattern.test(receipt.batchId) ||
      typeof receipt.policyId !== 'string' || !refPattern.test(receipt.policyId) ||
      !validPolicy(receipt.policy)) throw new Error('Invalid public evidence metadata.');
  const extras = receipt.additional ?? [];
  if (!Array.isArray(extras) || extras.length > 5) throw new Error('Invalid additional public evidence.');
  const ids = new Set([receipt.policyId]);
  const inputExtras = extras.map(item => {
    if (!item || !refPattern.test(item.policyId) || !validPolicy(item.policy) || ids.has(item.policyId))
      throw new Error('Invalid buyer receipt metadata.');
    ids.add(item.policyId);
    return {
      policyLabel: item.policyId, minStrength: item.policy.minStrength,
      maxDefectsBps: item.policy.maxDefectsBps,
      policyTx: item.policyTx, clearanceTx: item.clearanceTx,
    };
  });
  const clean = publicReceipt({
    contractAddress: receipt.contractAddress,
    inspectionTx: receipt.inspectionTx,
    policyTx: receipt.policyTx,
    clearanceTx: receipt.clearanceTx,
    additional: inputExtras,
  }, receipt.batchId, receipt.policyId, receipt.policy,
  inputExtras.map(({ policyLabel, minStrength, maxDefectsBps }) => ({policyLabel, minStrength, maxDefectsBps})));
  // Every clearance must have its own transaction identifier.
  const txIds = [clean.clearanceTx, ...clean.additional.map(x => x.clearanceTx)];
  if (new Set(txIds).size !== txIds.length) throw new Error('Duplicate clearance transactions.');
  return clean;
}

function validateEntry(entry) {
  if (!entry || typeof entry.id !== 'string' || !/^[0-9a-f]{16}$/.test(entry.id) ||
      typeof entry.savedAt !== 'string' || !Number.isFinite(Date.parse(entry.savedAt)))
    throw new Error('Invalid public evidence archive entry.');
  return { id: entry.id, savedAt: entry.savedAt, receipt: sanitizeArchiveReceipt(entry.receipt) };
}

export function readPublicEvidence(filePath) {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf8');
  if (Buffer.byteLength(raw) > MAX_BYTES) throw new Error('Public evidence archive exceeds safety limit.');
  const data = JSON.parse(raw);
  if (data?.schemaVersion !== SCHEMA || !Array.isArray(data.records) || data.records.length > MAX_ENTRIES)
    throw new Error('Unrecognized public evidence archive version.');
  return data.records.map(validateEntry);
}

export function storeConfirmedEvidence(filePath, job) {
  if (job?.status !== 'confirmed' || !/^[0-9a-f]{16}$/.test(job.id))
    throw new Error('Cannot archive an unconfirmed proof.');
  const receipt = sanitizeArchiveReceipt(job.receipt);
  if (receipt.batchId !== job.batchId || receipt.policyId !== job.policyId)
    throw new Error('Receipt is not bound to the proof request.');
  const records = readPublicEvidence(filePath);
  const entry = { id: job.id, savedAt: new Date().toISOString(), receipt };
  const next = [...records.filter(x => x.id !== entry.id), entry].slice(-MAX_ENTRIES);
  const json = JSON.stringify({ schemaVersion: SCHEMA, records: next });
  if (Buffer.byteLength(json) > MAX_BYTES) throw new Error('Public evidence archive exceeds safety limit.');
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.${process.pid}.${createHash('sha256').update(job.id).digest('hex').slice(0,8)}.tmp`;
  try {
    writeFileSync(temp, json, { mode: 0o600, flag: 'wx' });
    renameSync(temp, filePath);
  } finally { rmSync(temp, { force: true }); }
  return entry;
}

export function savedJobFromEntry(entry) {
  const item = validateEntry(entry);
  return {
    id: item.id, status: 'saved', phase: 'Checking saved local evidence', startedAt: item.savedAt,
    batchId: item.receipt.batchId, policyId: item.receipt.policyId,
    receipt: item.receipt,
  };
}
