/**
 * Local-only, short-lived inspector delegation: Ed25519 attestor authorizes
 * ONE ephemeral Jubjub verification key for ONE existing private report.
 * The Compact contract checks the Jubjub signature; the Ed25519 delegation
 * remains an OFF-CHAIN prerequisite checked by our local harness.
 */
import { createPrivateKey, createPublicKey, sign, verify, timingSafeEqual } from 'node:crypto';
import { digestReport, fingerprint } from './lot-inspector-attestation.mjs';
import { validatePrivateReport } from './lot-private-vault.mjs';

const DOMAIN = 'LOT_JUBJUB_DELEGATION_V1';
const LIMIT_MS = 15 * 60 * 1000;
const DECIMAL = /^(0|[1-9]\d{0,80})$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const FIELDS = ['domain','batchId','reportDigest','inspector','jubjubX','jubjubY','issuedAt','expiresAt','signature'];
function requirePoint(point){
  if (!point || typeof point.x !== 'bigint' || typeof point.y !== 'bigint' || point.x < 0n || point.y < 0n)
    throw new Error('Invalid Jubjub verifying key.');
  return { jubjubX: point.x.toString(), jubjubY: point.y.toString() };
}
function message(item) {
  return Buffer.from(JSON.stringify({
    domain: item.domain, batchId: item.batchId, reportDigest: item.reportDigest,
    inspector: item.inspector, jubjubX: item.jubjubX, jubjubY: item.jubjubY,
    issuedAt: item.issuedAt, expiresAt: item.expiresAt,
  }), 'utf8');
}
function enforceShape(record){
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      Object.keys(record).sort().join('|') !== [...FIELDS].sort().join('|'))
    throw new Error('Invalid inspector delegation structure.');
  if (record.domain !== DOMAIN || !DECIMAL.test(record.jubjubX) || !DECIMAL.test(record.jubjubY) ||
    typeof record.reportDigest !== 'string' || !/^[a-f0-9]{64}$/.test(record.reportDigest) ||
    typeof record.inspector !== 'string' || !/^[a-f0-9]{64}$/.test(record.inspector) ||
    typeof record.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(record.signature) ||
    !ISO.test(record.issuedAt) || !ISO.test(record.expiresAt))
    throw new Error('Malformed inspector delegation.');
  const sig=Buffer.from(record.signature, 'base64');
  if (sig.length !== 64 || sig.toString('base64') !== record.signature)
    throw new Error('Malformed inspector delegation signature.');
  const start=Date.parse(record.issuedAt), stop=Date.parse(record.expiresAt);
  if (!Number.isFinite(start) || !Number.isFinite(stop) ||
    new Date(start).toISOString() !== record.issuedAt ||
    new Date(stop).toISOString() !== record.expiresAt || stop-start !== LIMIT_MS)
    throw new Error('Invalid inspector delegation validity.');
  return {sig,start,stop};
}
export function makeV2Delegation(reportInput, point, encryptedPrivatePem, passphrase, inspectorPublicPem, when = new Date()) {
  const report=validatePrivateReport(reportInput);
  const coord=requirePoint(point);
  if (!(when instanceof Date) || !Number.isFinite(when.getTime())) throw new Error('Invalid delegation issue time.');
  let privateKey;
  try { privateKey=createPrivateKey({key:encryptedPrivatePem,format:'pem',passphrase}); }
  catch {throw new Error('Inspector signing-key unlock failed.');}
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Wrong inspector key type.');
  const own=createPublicKey(privateKey).export({type:'spki',format:'der'});
  let expected;
  try { expected=createPublicKey(inspectorPublicPem).export({type:'spki',format:'der'}); }
  catch {throw new Error('Inspector public key is invalid.');}
  if (own.length !== expected.length || !timingSafeEqual(own,expected))
    throw new Error('Inspector signing key does not match trusted key.');
  const record={
    domain:DOMAIN,batchId:report.batchId,reportDigest:digestReport(report),
    inspector:fingerprint(inspectorPublicPem),...coord,
    issuedAt:when.toISOString(), expiresAt:new Date(when.getTime()+LIMIT_MS).toISOString(),
  };
  return Object.freeze({...record, signature:sign(null,message(record),privateKey).toString('base64')});
}
export function verifyV2Delegation(reportInput, delegation, inspectorPublicPem, now = new Date()) {
  const report=validatePrivateReport(reportInput);
  const {sig,start,stop}=enforceShape(delegation);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) ||
      start>now.getTime()+60_000 || stop<now.getTime())
    throw new Error('Inspector delegation expired or not yet valid.');
  if (delegation.batchId !== report.batchId || delegation.reportDigest !== digestReport(report) ||
      delegation.inspector !== fingerprint(inspectorPublicPem))
    throw new Error('Inspector delegation does not match report or trusted identity.');
  if (!verify(null,message(delegation),createPublicKey(inspectorPublicPem),sig))
    throw new Error('Inspector delegation signature invalid.');
  return Object.freeze({
    batchId:report.batchId, inspector:delegation.inspector,
    verifyingKey:{x:BigInt(delegation.jubjubX),y:BigInt(delegation.jubjubY)},
  });
}
