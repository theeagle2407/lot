/**
 * LOT Build 09 — encrypted, local-only inspection report vault.
 *
 * This is a portable encrypted-at-rest report format, NOT a wallet, identity
 * credential, on-chain inspection, or secure multi-party file-sharing system.
 * It intentionally never sends secrets to the proof HTTP API.
 */
import {
  randomBytes, scryptSync, createCipheriv, createDecipheriv,
} from 'node:crypto';
import {
  mkdirSync, writeFileSync, readFileSync, readdirSync, statSync,
  lstatSync, constants as fsConstants,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const AAD = Buffer.from('LOT_PRIVATE_INSPECTION_V1', 'utf8');
const MAX_BYTES = 16 * 1024;
const MAX_REPORT_BYTES = 4 * 1024;
const KDF = Object.freeze({ N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const RX_BATCH = /^LOT-[A-Z0-9-]{1,48}$/;
const RX_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function fail(message) { throw new Error(message); }
function validHex(name, value, bytes) {
  if (typeof value !== 'string' || !new RegExp(`^[a-fA-F0-9]{${bytes * 2}}$`).test(value)) {
    fail(`${name} must contain exactly ${bytes * 2} hexadecimal characters.`);
  }
  return value.toLowerCase();
}
function safeInteger(name, value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}
function validText(name, value, max = 80) {
  if (typeof value !== 'string' || value.trim() !== value || !value || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
    fail(`${name} must be nonempty plain text (max ${max} characters).`);
  }
  return value;
}
export function validatePrivateReport(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Invalid private inspection report.');
  const allowed = ['batchId','material','strengthMpa','defectBps','openingSalt'];
  if (Object.keys(input).some(k => !allowed.includes(k))) fail('Unexpected report fields.');
  const batchId = input.batchId;
  if (typeof batchId !== 'string' || !RX_BATCH.test(batchId)) fail('Batch ID must match LOT-[A-Z0-9-].');
  return Object.freeze({
    batchId,
    material: validText('Material', input.material),
    strengthMpa: safeInteger('Strength', input.strengthMpa, 1, 1_000_000_000),
    defectBps: safeInteger('Defect rate (basis points)', input.defectBps, 0, 10_000),
    openingSalt: validHex('Opening salt', input.openingSalt, 32),
  });
}
export function newPrivateReport({ batchId, material, strengthMpa, defectBps }) {
  return validatePrivateReport({batchId, material, strengthMpa, defectBps, openingSalt: randomBytes(32).toString('hex')});
}
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) {
    fail('Passphrase must contain between 12 and 1024 characters.');
  }
  return password;
}
function decodeBase64(value, name, length) {
  if (typeof value !== 'string' || !RX_BASE64.test(value)) fail(`Malformed ${name}.`);
  const decoded = Buffer.from(value, 'base64');
  if (length !== undefined && decoded.length !== length) fail(`Malformed ${name}.`);
  if (decoded.toString('base64') !== value) fail(`Malformed ${name}.`);
  return decoded;
}

export function sealPrivateReport(input, passphrase) {
  const report = validatePrivateReport(input);
  validatePassword(passphrase);
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, KDF);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(AAD);
    const content = Buffer.from(JSON.stringify(report), 'utf8');
    const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
    return JSON.stringify({
      kind:'LOT_ENCRYPTED_INSPECTION', version:1, encryption:'AES-256-GCM', kdf:'scrypt-N32768-r8-p1',
      salt:salt.toString('base64'), nonce:nonce.toString('base64'),
      data:encrypted.toString('base64'), tag:cipher.getAuthTag().toString('base64'),
    });
  } finally { key.fill(0); }
}
export function openPrivateReport(envelopeText, passphrase) {
  validatePassword(passphrase);
  if (typeof envelopeText !== 'string' || Buffer.byteLength(envelopeText) > MAX_BYTES) fail('Encrypted report exceeds safe size limit.');
  let envelope;
  try { envelope = JSON.parse(envelopeText); }
  catch { fail('Encrypted report is not valid JSON.'); }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
    envelope.kind !== 'LOT_ENCRYPTED_INSPECTION' || envelope.version !== 1 ||
    envelope.encryption !== 'AES-256-GCM' || envelope.kdf !== 'scrypt-N32768-r8-p1' ||
    Object.keys(envelope).sort().join('|') !== ['kind','version','encryption','kdf','salt','nonce','data','tag'].sort().join('|')) {
    fail('Unsupported or modified encrypted report header.');
  }
  const salt = decodeBase64(envelope.salt, 'KDF salt', 16);
  const nonce = decodeBase64(envelope.nonce, 'nonce', 12);
  const data = decodeBase64(envelope.data, 'ciphertext');
  const tag = decodeBase64(envelope.tag, 'authentication tag', 16);
  if (data.length === 0 || data.length > MAX_REPORT_BYTES) fail('Encrypted report payload size is invalid.');
  const key = scryptSync(passphrase, salt, 32, KDF);
  let clear;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    clear = Buffer.concat([decipher.update(data), decipher.final()]);
  } catch { fail('Unable to unlock report: wrong passphrase or modified encrypted data.'); }
  finally { key.fill(0); }
  try { return validatePrivateReport(JSON.parse(clear.toString('utf8'))); }
  catch { fail('Unlocked report contains invalid fields.'); }
  finally { clear.fill(0); }
}
export function defaultVaultDirectory() { return join(homedir(), '.lot', 'private-reports'); }
export function reportFilePath(batchId, dir = defaultVaultDirectory()) {
  if (typeof batchId !== 'string' || !RX_BATCH.test(batchId)) fail('Invalid batch ID.');
  return join(resolve(dir), `${batchId}.lot.enc`);
}
export function saveEncryptedReport(input, passphrase, dir = defaultVaultDirectory()) {
  const report = validatePrivateReport(input);
  const content = sealPrivateReport(report, passphrase);
  mkdirSync(dir, {recursive:true, mode:0o700});
  const directory = lstatSync(dir);
  if (!directory.isDirectory() || directory.isSymbolicLink()) fail('Vault directory must not be a symbolic link.');
  const file = reportFilePath(report.batchId, dir);
  // O_EXCL prevents overwriting a report or following a pre-existing symlink.
  writeFileSync(file, content, {encoding:'utf8',flag:'wx',mode:0o600});
  return file;
}
export function loadEncryptedReport(batchId, passphrase, dir = defaultVaultDirectory()) {
  const file = reportFilePath(batchId, dir);
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) fail('Unsafe or oversized vault entry.');
  const result = openPrivateReport(readFileSync(file,'utf8'), passphrase);
  if (result.batchId !== batchId) fail('Report batch does not match its filename.');
  return result;
}
export function listPrivateReportIds(dir = defaultVaultDirectory()) {
  try {
    const d = lstatSync(dir);
    if (!d.isDirectory() || d.isSymbolicLink()) fail('Unsafe vault directory.');
  } catch (err) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
  return readdirSync(dir).filter(name => name.endsWith('.lot.enc'))
    .map(name => name.slice(0,-8)).filter(name => RX_BATCH.test(name)).sort();
}
