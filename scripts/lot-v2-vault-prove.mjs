#!/usr/bin/env node
/**
 * LOT Build 16: a real encrypted report + an existing trusted Ed25519 attestation
 * + a short-lived Ed25519-authorized Jubjub key -> V2 local blockchain proof.
 * All identity/trust administration here is LOCAL DEVELOPMENT ONLY.
 */
import process from 'node:process';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jubjubSampleScalar, jubjubSchnorrVerifyingKey } from '@midnight-ntwrk/compact-runtime';
import { loadEncryptedReport } from './lot-private-vault.mjs';
import { parseVaultProofArgs, checkPolicyForReport } from './lot-vault-bridge.mjs';
import { verifySavedAttestation, loadInspectorPrivatePem, loadInspectorPublicPem } from './lot-inspector-attestation.mjs';
import { makeV2Delegation, verifyV2Delegation } from './lot-v2-delegation.mjs';
import { signInspectionV2 } from './lot-v2-signing.mjs';
import { createOneUseV2Bridge } from './lot-v2-vault-bridge.mjs';
import { readLocalPublicReceipt } from './lot-public-receipt.mjs';
import { defaultEvidenceFile, storeConfirmedEvidence } from './lot-proof-archive.mjs';
import { summarizeFailedRun } from './lot-test-diagnostics.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function hidden(label){
  if(!process.stdin.isTTY||!process.stdout.isTTY||!process.stdin.setRawMode)
    throw new Error('Use interactive Terminal; never pass passwords on the command line.');
  process.stdout.write(label);const original=Boolean(process.stdin.isRaw);
  process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((resolve,reject)=>{
    let result='';
    const finish=()=>{process.stdin.removeListener('data',key);process.stdin.setRawMode(original);process.stdin.pause();process.stdout.write('\n');};
    function key(buf){for(const c of buf.toString('utf8')){
      if(c==='\r'||c==='\n'){finish();resolve(result);return;}
      if(c==='\u0003'){finish();reject(new Error('Canceled.'));return;}
      if(c==='\u007f'||c==='\b'){result=result.slice(0,-1);continue;}
      if(c>=' '&&result.length<1024)result+=c;
    }}
    process.stdin.on('data',key);
  });
}
async function launch(socket,receipt,policy){
  const runner=path.join(root,'node_modules/vitest/vitest.mjs');
  const env={...process.env,MIDNIGHT_NETWORK:'local',
    LOT_V2_VAULT_SOCKET:socket,LOT_V2_VAULT_RECEIPT:receipt,
    LOT_V2_VAULT_BATCH:policy.batchId,LOT_V2_VAULT_POLICY:policy.policyId,
    LOT_V2_MIN_STRENGTH:String(policy.minStrength),LOT_V2_MAX_DEFECTS:String(policy.maxDefectsBps),
    LOG_LEVEL:'silent',
  };
  delete env.LOT_LOCAL_PROOF_PAYLOAD;
  const child=spawn(process.execPath,[runner,'run','test/lot.v2.vault.network.test.ts'],
    {cwd:root,env,shell:false,stdio:['ignore','pipe','pipe']});
  let log='',last='Wallet setup';
  const stages=new Set(['WALLETS_READY','CONTRACT_DEPLOYED','INSPECTION_FINALIZED','POLICY_FINALIZED','CLEARANCE_FINALIZED','PUBLIC_RECEIPT_SAVED']);
  for(const stream of [child.stdout,child.stderr]){
    stream.setEncoding('utf8');
    stream.on('data',s=>{
      log=(log+s).slice(-32768);
      for(const match of s.matchAll(/LOT_V2_VAULT_PHASE:([A-Z_]+)/g)){
        if(stages.has(match[1])){last=match[1];console.log('LOT V2:',last.replaceAll('_',' ').toLowerCase());}
      }
    });
  }
  const code=await new Promise((resolve,reject)=>{child.on('close',resolve);child.on('error',reject);});
  if(code!==0){const failure=summarizeFailedRun(log,last);throw new Error(`V2 network run failed at ${last}: ${failure.cause}`);}
}
async function main(){
  const policy=parseVaultProofArgs(process.argv.slice(2));
  if(process.env.MIDNIGHT_NETWORK && process.env.MIDNIGHT_NETWORK!=='local')
    throw new Error('Build 16 is restricted to a disposable local Midnight chain.');
  let vaultPassword=await hidden('Report vault passphrase (hidden): ');
  const report=loadEncryptedReport(policy.batchId,vaultPassword);vaultPassword='';
  checkPolicyForReport(report,policy);
  const attestation=verifySavedAttestation(report);
  console.log(`Existing trusted Ed25519 report attestation verified for ${attestation.batchId}.`);
  // Fresh ephemeral signer ensures the old Ed25519 key is not implicitly reused as a Jubjub scalar.
  let jubjubSecret=jubjubSampleScalar();
  while(jubjubSecret===0n)jubjubSecret=jubjubSampleScalar();
  const publicKey=jubjubSchnorrVerifyingKey(jubjubSecret);
  let inspectorPassword=await hidden('Inspector Ed25519 key passphrase (hidden): ');
  const inspectorPublicPem=loadInspectorPublicPem();
  const delegation=makeV2Delegation(report,publicKey,loadInspectorPrivatePem(),inspectorPassword,inspectorPublicPem);
  inspectorPassword='';
  verifyV2Delegation(report,delegation,inspectorPublicPem);
  if(attestation.inspector!==delegation.inspector)
    throw new Error('Existing report attestation and Jubjub delegation use different inspectors.');
  const batchId=new Uint8Array((await import('node:crypto')).createHash('sha256')
    .update('LOT_BATCH_V1').update(':').update(report.batchId).digest());
  const salt=new Uint8Array(Buffer.from(report.openingSalt,'hex'));
  const signed=signInspectionV2(batchId,BigInt(report.strengthMpa),BigInt(report.defectBps),salt,jubjubSecret);
  jubjubSecret=0n;
  if(signed.inspectorPublicKey.x!==publicKey.x||signed.inspectorPublicKey.y!==publicKey.y)
    throw new Error('Unexpected Jubjub public key mismatch.');
  console.log('Inspector authorized a short-lived Jubjub key for this report.');
  console.log('Private measurements, passphrases and signing keys will not be printed.');
  const bridge=await createOneUseV2Bridge(report,signed.signature,delegation);
  const folder=mkdtempSync(path.join(tmpdir(),'lot-v2-public-receipt-'));
  const receiptPath=path.join(folder,'receipt.json');
  try{
    await launch(bridge.socketPath,receiptPath,policy);
    if(!bridge.used)throw new Error('Network test did not consume the private report.');
    const receipt=readLocalPublicReceipt(receiptPath,policy.batchId,policy.policyId,{
      minStrength:policy.minStrength,maxDefectsBps:policy.maxDefectsBps,
    });
    const record=storeConfirmedEvidence(defaultEvidenceFile(root),{
      id:randomBytes(8).toString('hex'),status:'confirmed',
      batchId:policy.batchId,policyId:policy.policyId,receipt,
    });
    console.log('\nLOT V2 SIGNED-VAULT LOCAL SUCCESS');
    console.log('Ed25519 report attestation: checked locally.');
    console.log('Jubjub inspector signature: verified by the V2 Compact contract.');
    console.log('Network: local only; public-only receipt archived.');
    console.log(`Batch: ${policy.batchId}`);
    console.log(`Buyer: ${policy.policyId}`);
    console.log(`Contract: ${receipt.contractAddress}`);
    console.log(`Inspection TX: ${receipt.inspectionTx}`);
    console.log(`Policy TX: ${receipt.policyTx}`);
    console.log(`Clearance TX: ${receipt.clearanceTx}`);
    console.log(`Archive entry: ${record.id}`);
  }finally{await bridge.close();rmSync(folder,{recursive:true,force:true});}
}
main().catch(err=>{console.error('LOT V2 signed-vault:',err instanceof Error?err.message:'Local V2 verification failed.');process.exitCode=1;});
