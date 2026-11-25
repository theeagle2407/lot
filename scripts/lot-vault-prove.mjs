#!/usr/bin/env node
/**
 * One-off local proof from a previously encrypted LOT inspection report.
 * No password or plaintext measurements are passed via args, environment,
 * HTTP or temporary files. Only a private Unix socket forwards the report.
 */
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEncryptedReport } from './lot-private-vault.mjs';
import { parseVaultProofArgs, checkPolicyForReport, createOneUsePrivateBridge } from './lot-vault-bridge.mjs';
import { readLocalPublicReceipt } from './lot-public-receipt.mjs';
import { defaultEvidenceFile, storeConfirmedEvidence } from './lot-proof-archive.mjs';
import { summarizeFailedRun } from './lot-test-diagnostics.mjs';
import { verifySavedAttestation } from './lot-inspector-attestation.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// No passphrases in shell history, command arguments or an environment variable.
async function hiddenPassphrase(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error('Run in an interactive Terminal to unlock the vault.');
  }
  process.stdout.write(prompt);
  const initialRaw=Boolean(process.stdin.isRaw);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return await new Promise((resolve,reject)=>{
    let pass='';
    const clear=()=>{
      process.stdin.removeListener('data',onKey);
      process.stdin.setRawMode(initialRaw);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    function onKey(buf) {
      for(const c of buf.toString('utf8')) {
        if (c==='\r' || c==='\n') {clear();resolve(pass);return;}
        if(c==='\u0003') {clear();reject(new Error('Canceled.'));return;}
        if(c==='\u007f' || c==='\b') {pass=pass.slice(0,-1);continue;}
        if(c>=' ' && pass.length<1024) pass+=c;
      }
    }
    process.stdin.on('data',onKey);
  });
}

async function launchRunner(socketPath, receiptPath, policy) {
  const vitest=path.join(root,'node_modules','vitest','vitest.mjs');
  const env={...process.env,
    MIDNIGHT_NETWORK:'local',
    LOT_VAULT_PRIVATE_SOCKET:socketPath,
    LOT_VAULT_RECEIPT_PATH:receiptPath,
    LOT_VAULT_BATCH_ID:policy.batchId,
    LOT_VAULT_POLICY_ID:policy.policyId,
    LOT_VAULT_MIN_STRENGTH:String(policy.minStrength),
    LOT_VAULT_MAX_DEFECTS_BPS:String(policy.maxDefectsBps),
    LOG_LEVEL:'warn',
  };
  delete env.LOT_LOCAL_PROOF_PAYLOAD;
  delete env.LOT_PUBLIC_RECEIPT_FILE;
  const child=spawn(process.execPath,[vitest,'run','test/lot.vault.network.test.ts'],{
    cwd:root,env,shell:false,stdio:['ignore','pipe','pipe'],
  });
  let log='';
  let lastPhase='Wallets initializing';
  const allowed=new Set(['WALLETS_READY','CONTRACT_DEPLOYED','INSPECTION_FINALIZED','POLICY_FINALIZED','CLEARANCE_FINALIZED','PUBLIC_RECEIPT_SAVED']);
  const readStream=(stream)=>{
    stream.setEncoding('utf8');
    stream.on('data',s=>{
      log=(log+s).slice(-32768);
      for(const [,phase] of s.matchAll(/LOT_VAULT_PHASE:([A-Z_]+)/g)){
        if(allowed.has(phase)){
          lastPhase=phase;
          console.log('LOT:',phase.replaceAll('_',' ').toLowerCase());
        }
      }
    });
  };
  readStream(child.stdout);readStream(child.stderr);
  const code=await new Promise((resolve,reject)=>{
    child.on('close',resolve);
    child.on('error',reject);
  });
  if(code!==0){
    const failure=summarizeFailedRun(log,lastPhase);
    // Errors are filtered; never dump untrusted proof-server output or witnesses.
    throw new Error(`Network test failed near ${lastPhase}. ${failure.cause}`);
  }
}

async function main(){
  const policy=parseVaultProofArgs(process.argv.slice(2));
  if(process.env.MIDNIGHT_NETWORK && process.env.MIDNIGHT_NETWORK!=='local'){
    throw new Error('This proof command is limited to the disposable local Midnight network.');
  }
  let pass=await hiddenPassphrase('Enter LOT vault passphrase (hidden): ');
  const report=loadEncryptedReport(policy.batchId,pass);
  pass='';
  checkPolicyForReport(report,policy);
  if(process.env.LOT_REQUIRE_ATTESTATION==='1'){
    const validated=verifySavedAttestation(report);
    console.log(`Trusted inspector attestation checked for ${validated.batchId}.`);
  }
  console.log('Encrypted report unlocked. Private measurements will not be printed.');
  const bridge=await createOneUsePrivateBridge(report);
  const folder=mkdtempSync(path.join(tmpdir(),'lot-vault-receipt-'));
  const receiptPath=path.join(folder,'receipt.json');
  try{
    await launchRunner(bridge.socketPath,receiptPath,policy);
    if(!bridge.used)throw new Error('Network runner did not read the vault report.');
    const receipt=readLocalPublicReceipt(receiptPath,policy.batchId,policy.policyId,{
      minStrength:policy.minStrength,maxDefectsBps:policy.maxDefectsBps,
    });
    const archived=storeConfirmedEvidence(defaultEvidenceFile(root),{
      id:randomBytes(8).toString('hex'),
      status:'confirmed',batchId:policy.batchId,policyId:policy.policyId,receipt,
    });
    console.log('\nLOT VAULT-TO-MIDNIGHT SUCCESS');
    console.log('Local chain: verified; public-only evidence archived.');
    console.log(`Batch: ${policy.batchId}`);
    console.log(`Buyer: ${policy.policyId}`);
    console.log(`Contract: ${receipt.contractAddress}`);
    console.log(`Inspection TX: ${receipt.inspectionTx}`);
    console.log(`Policy TX: ${receipt.policyTx}`);
    console.log(`Clearance TX: ${receipt.clearanceTx}`);
    console.log(`Archive entry: ${archived.id}`);
  } finally {
    await bridge.close();
    rmSync(folder,{recursive:true,force:true});
  }
}
main().catch(err=>{
  console.error('LOT vault proof:',err instanceof Error?err.message:'Unable to prove saved report.');
  process.exitCode=1;
});
