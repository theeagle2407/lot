import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeInspectorKeyPair, signInspectionReport, verifyInspectionReport,
  trustInspectorPublicKey } from '../scripts/lot-inspector-attestation.mjs';
import { newPrivateReport } from '../scripts/lot-private-vault.mjs';
import { makeV2Delegation, verifyV2Delegation } from '../scripts/lot-v2-delegation.mjs';
import { createOneUseV2Bridge, receiveOneUseV2SignedReport,
  encodeV2SignedReport, decodeV2SignedReport } from '../scripts/lot-v2-vault-bridge.mjs';
const report=newPrivateReport({batchId:'LOT-3001',material:'Structural steel',strengthMpa:570,defectBps:80});
const keys=makeInspectorKeyPair('test-only-key-passphrase-123');
const point={x:123456n,y:78901n}; // structural-only mock point; NOT a real curve point
const sig={announcement:{x:123n,y:456n},response:789n}; // structural-only mock signature
const date=new Date('2026-11-21T15:00:00.000Z');
const now=new Date('2026-11-21T15:01:00.000Z');
const signed=makeV2Delegation(report,point,keys.encryptedPrivateKey,'test-only-key-passphrase-123',keys.publicKey,date);
function modified(o,patch){return {...o,...patch};}
test('V2 delegation binds exactly the private report and Ed25519 inspector identity',()=>{
  const v=verifyV2Delegation(report,signed,keys.publicKey,now);
  assert.equal(v.batchId,report.batchId);
  assert.deepEqual(v.verifyingKey,point);
});
test('V2 delegation rejects tampered Jubjub coordinates',()=>{
  assert.throws(()=>verifyV2Delegation(report,modified(signed,{jubjubX:'9'}),keys.publicKey,now));
});
test('V2 delegation rejects changed private measurements and salt',()=>{
  assert.throws(()=>verifyV2Delegation({...report,strengthMpa:571},signed,keys.publicKey,now));
  assert.throws(()=>verifyV2Delegation({...report,openingSalt:'f'.repeat(64)},signed,keys.publicKey,now));
});
test('V2 delegation rejects expired or future-dated signatures',()=>{
  assert.throws(()=>verifyV2Delegation(report,signed,keys.publicKey,new Date('2026-11-21T15:16:00Z')));
  assert.throws(()=>verifyV2Delegation(report,signed,keys.publicKey,new Date('2026-11-21T14:30:00Z')));
});
test('V2 delegation rejects wrong Ed25519 key or wrong password',()=>{
  const wrong=makeInspectorKeyPair('different-test-password-123');
  assert.throws(()=>verifyV2Delegation(report,signed,wrong.publicKey,now));
  assert.throws(()=>makeV2Delegation(report,point,keys.encryptedPrivateKey,'wrong-passphrase-long',keys.publicKey,date));
});
test('existing inspector attestation and trusted registry remain independently checkable',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'lot-v2-check-'));
  try{
    const registry=path.join(dir,'trusted.json');
    trustInspectorPublicKey(keys.publicKey,registry);
    const att=signInspectionReport(report,keys.encryptedPrivateKey,'test-only-key-passphrase-123',keys.publicKey,date);
    assert.equal(verifyInspectionReport(report,att,registry,now).batchId,report.batchId);
    assert.throws(()=>verifyInspectionReport({...report,defectBps:81},att,registry,now));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('private IPC format uses decimal BigInt fields and decodes precisely',()=>{
  const encoded=encodeV2SignedReport(report,sig,signed);
  const decoded=decodeV2SignedReport(encoded);
  assert.equal(decoded.report.strengthMpa,570);
  assert.equal(decoded.signature.response,789n);
  assert.equal(decoded.delegation.inspector,signed.inspector);
});
test('private bridge rejects malformed and oversize payloads',()=>{
  assert.throws(()=>decodeV2SignedReport('{}'));
  assert.throws(()=>decodeV2SignedReport('a'.repeat(9000)));
  const encoded=encodeV2SignedReport(report,sig,signed);
  assert.throws(()=>decodeV2SignedReport(encoded.replace('"response":"789"','"response":"-1"')));
});
test('one-use socket safely relays report and signature without signing scalar',async()=>{
  const bridge=await createOneUseV2Bridge(report,sig,signed);
  try{
    const decoded=await receiveOneUseV2SignedReport(bridge.socketPath);
    assert.equal(decoded.report.batchId,report.batchId);
    assert.equal(decoded.signature.announcement.x,123n);
    assert.equal(bridge.used,true);
    await assert.rejects(receiveOneUseV2SignedReport(bridge.socketPath));
  }finally{await bridge.close();}
});
