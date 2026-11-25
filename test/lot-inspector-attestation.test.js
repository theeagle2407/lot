import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import {
  makeInspectorKeyPair, saveInspectorKeyPair, loadInspectorPrivatePem,
  loadInspectorPublicPem, fingerprint, listTrustedKeys, trustInspectorPublicKey,
  signInspectionReport, verifyInspectionReport, verifySavedAttestation,
  storeAttestation, digestReport,
} from '../scripts/lot-inspector-attestation.mjs';

const report = Object.freeze({
  batchId:'LOT-3001',material:'Structural steel',strengthMpa:570,
  defectBps:80,openingSalt:'a1'.repeat(32),
});
const PASS='my-new-local-inspector-password-99';
function withTemp(fn) {
  const dir=mkdtempSync(path.join(tmpdir(),'lot-inspector-test-'));
  try{return fn(dir);}finally{rmSync(dir,{recursive:true,force:true});}
}
function fixture(dir) {
  const keys=makeInspectorKeyPair(PASS);
  const trustFile=path.join(dir,'trusted.json');
  trustInspectorPublicKey(keys.publicKey,trustFile);
  const att=signInspectionReport(report,keys.encryptedPrivateKey,PASS,keys.publicKey,new Date('2026-11-21T13:00:00.000Z'));
  return {keys,trustFile,att};
}
const now=new Date('2026-11-22T13:00:00.000Z');

test('inspector keys are Ed25519 and private PEM is encrypted with passphrase',()=>withTemp(dir=>{
  const keys=makeInspectorKeyPair(PASS);
  const files=saveInspectorKeyPair(keys,dir);
  assert.match(readFileSync(files.privatePath,'utf8'),/BEGIN ENCRYPTED PRIVATE KEY/);
  assert.ok(!readFileSync(files.privatePath,'utf8').includes('BEGIN PRIVATE KEY-----'));
  assert.equal(fingerprint(loadInspectorPublicPem(dir)),keys.fingerprint);
  assert.equal(loadInspectorPrivatePem(dir),keys.encryptedPrivateKey);
  assert.equal(statSync(files.privatePath).mode&0o777,0o600);
}));
test('refuses to overwrite an existing inspector identity',()=>withTemp(dir=>{
  const keys=makeInspectorKeyPair(PASS);saveInspectorKeyPair(keys,dir);
  assert.throws(()=>saveInspectorKeyPair(keys,dir),/already exists/);
}));
test('rejects weak key passphrases',()=>{
  assert.throws(()=>makeInspectorKeyPair('short'),/12/);
});
test('enrollment allowlists a specific public Ed25519 key fingerprint',()=>withTemp(dir=>{
  const {keys,trustFile}=fixture(dir);
  assert.deepEqual(listTrustedKeys(trustFile),[keys.fingerprint]);
  assert.throws(()=>trustInspectorPublicKey(keys.publicKey,trustFile),/already trusted/);
}));
test('refuses a non-Ed25519 public key in trust registry',()=>withTemp(dir=>{
  const rsa=generateKeyPairSync('rsa',{modulusLength:2048});
  assert.throws(()=>trustInspectorPublicKey(rsa.publicKey.export({format:'pem',type:'spki'}),path.join(dir,'trusted.json')),/Ed25519/);
}));
test('authorized signed report verifies without exposing measurements or opening salt in detached evidence',()=>withTemp(dir=>{
  const {trustFile,att}=fixture(dir);
  const out=verifyInspectionReport(report,att,trustFile,now);
  assert.equal(out.batchId,'LOT-3001');
  const plain=JSON.stringify(att);
  assert.ok(!plain.includes(report.openingSalt));
  assert.ok(!Object.hasOwn(att,'strengthMpa'));
  assert.ok(!Object.hasOwn(att,'defectBps'));
}));
test('altered strength invalidates report binding',()=>withTemp(dir=>{
  const {trustFile,att}=fixture(dir);
  assert.throws(()=>verifyInspectionReport({...report,strengthMpa:571},att,trustFile,now),/does not match/);
}));
test('altered salt invalidates report binding',()=>withTemp(dir=>{
  const {trustFile,att}=fixture(dir);
  assert.throws(()=>verifyInspectionReport({...report,openingSalt:'b2'.repeat(32)},att,trustFile,now),/does not match/);
}));
test('changing buyer-independent batch ID prevents reusing attestation',()=>withTemp(dir=>{
  const {trustFile,att}=fixture(dir);
  assert.throws(()=>verifyInspectionReport({...report,batchId:'LOT-9999'},att,trustFile,now),/Malformed/);
}));
test('changing signed metadata invalidates signature',()=>withTemp(dir=>{
  const {trustFile,att}=fixture(dir);
  assert.throws(()=>verifyInspectionReport(report,{...att,expiresAt:'2026-12-19T13:00:00.000Z'},trustFile,now),/Invalid inspector signature/);
}));
test('refuses signature from a different untrusted inspector',()=>withTemp(dir=>{
  const {trustFile}=fixture(dir);
  const stranger=makeInspectorKeyPair(PASS);
  const att=signInspectionReport(report,stranger.encryptedPrivateKey,PASS,stranger.publicKey,new Date('2026-11-21T13:00:00.000Z'));
  assert.throws(()=>verifyInspectionReport(report,att,trustFile,now),/has not been trusted/);
}));
test('rejects wrong inspector signing passphrase',()=>withTemp(dir=>{
  const {keys}=fixture(dir);
  assert.throws(()=>signInspectionReport(report,keys.encryptedPrivateKey,'an-incorrect-long-password',keys.publicKey),/unlock failed/);
}));
test('rejects private and public key mismatch',()=>withTemp(dir=>{
  const {keys}=fixture(dir);
  const different=makeInspectorKeyPair(PASS);
  assert.throws(()=>signInspectionReport(report,keys.encryptedPrivateKey,PASS,different.publicKey),/does not match/);
}));
test('rejects expired attestations',()=>withTemp(dir=>{
  const {trustFile,att}=fixture(dir);
  assert.throws(()=>verifyInspectionReport(report,att,trustFile,new Date('2027-01-01T00:00:00.000Z')),/expired/);
}));
test('rejects attestation not yet valid',()=>withTemp(dir=>{
  const {trustFile,att}=fixture(dir);
  assert.throws(()=>verifyInspectionReport(report,att,trustFile,new Date('2026-11-01T00:00:00.000Z')),/not yet valid/);
}));
test('rejects malformed signatures, extra fields and malformed dates',()=>withTemp(dir=>{
  const {trustFile,att}=fixture(dir);
  assert.throws(()=>verifyInspectionReport(report,{...att,signature:'abc'},trustFile,now),/signature/);
  assert.throws(()=>verifyInspectionReport(report,{...att,measurements:570},trustFile,now),/Malformed/);
  assert.throws(()=>verifyInspectionReport(report,{...att,issuedAt:'not a date'},trustFile,now),/date/);
}));
test('signed attestation is stored once and recovered through trusted-key check',()=>withTemp(dir=>{
  const {trustFile,keys}=fixture(dir);
  const attDir=path.join(dir,'attestations');
  const current=signInspectionReport(report,keys.encryptedPrivateKey,PASS,keys.publicKey);
  const p=storeAttestation(current,attDir);
  assert.equal(statSync(p).mode&0o777,0o600);
  assert.equal(verifySavedAttestation(report,trustFile,attDir).batchId,'LOT-3001');
  assert.throws(()=>storeAttestation(current,attDir),/EEXIST/);
}));
test('attestation rejects changed stored bytes',()=>withTemp(dir=>{
  const {trustFile,att}=fixture(dir);
  const attDir=path.join(dir,'attestations');
  const p=storeAttestation(att,attDir);
  writeFileSync(p,JSON.stringify({...att,digest:'aa'.repeat(32)}));
  assert.throws(()=>verifySavedAttestation(report,trustFile,attDir),/does not match/);
}));
test('private report digest is deterministic and incorporates salt',()=>{
  assert.equal(digestReport(report),digestReport({...report}));
  assert.notEqual(digestReport(report),digestReport({...report,openingSalt:'b2'.repeat(32)}));
});
