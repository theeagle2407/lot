import test from 'node:test';
import assert from 'node:assert/strict';
import { newPrivateReport } from '../scripts/lot-private-vault.mjs';
import { parseVaultProofArgs, checkPolicyForReport, createOneUsePrivateBridge, receiveOneUsePrivateReport } from '../scripts/lot-vault-bridge.mjs';
const sample=()=>newPrivateReport({batchId:'LOT-3001',material:'Structural steel',strengthMpa:570,defectBps:80});
const policy=()=>parseVaultProofArgs(['LOT-3001','B-01','530','100']);

test('accepts an explicit valid batch and public policy',()=>{
  assert.deepEqual(policy(),{batchId:'LOT-3001',policyId:'B-01',minStrength:530,maxDefectsBps:100});
  assert.equal(checkPolicyForReport(sample(),policy()),true);
});
test('rejects invalid or dangerous public arguments',()=>{
  for(const a of [[],['../secret','B-01','530','100'],['LOT-3001','B-01','-1','100'],
    ['LOT-3001','B-01','530','100.1'],['LOT-3001','B-01','530','10001'],
    ['LOT-3001','B-01','0','100'],['LOT-3001','B/01','530','100']]){
    assert.throws(()=>parseVaultProofArgs(a));
  }
});
test('does not submit a nonqualifying report',()=>{
  assert.throws(()=>checkPolicyForReport(sample(),parseVaultProofArgs(['LOT-3001','B-01','600','100'])),/does not qualify/);
  assert.throws(()=>checkPolicyForReport(sample(),parseVaultProofArgs(['LOT-3001','B-01','530','70'])),/does not qualify/);
  assert.throws(()=>checkPolicyForReport(sample(),{...policy(),batchId:'LOT-3002'}),/does not match/);
});
test('local bridge returns exact private report without plaintext disk files',async()=>{
  const report=sample();
  const bridge=await createOneUsePrivateBridge(report);
  try{
    const loaded=await receiveOneUsePrivateReport(bridge.socketPath);
    assert.deepEqual(loaded,report);
    assert.equal(bridge.used,true);
    const fs=await import('node:fs');
    const files=fs.readdirSync((await import('node:path')).dirname(bridge.socketPath));
    assert.deepEqual(files,['report.sock']);
  }finally{await bridge.close();}
});
test('bridge cannot be used to retrieve a report twice',async()=>{
  const bridge=await createOneUsePrivateBridge(sample());
  try{
    await receiveOneUsePrivateReport(bridge.socketPath);
    await assert.rejects(receiveOneUsePrivateReport(bridge.socketPath));
  }finally{await bridge.close();}
});
test('bridge rejects a nonexistent socket',async()=>{
  await assert.rejects(receiveOneUsePrivateReport('/tmp/lot-not-existing-socket-987666'));
});
