#!/usr/bin/env node
/** Local pilot CLI, never uploads keys or private report data. */
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { loadEncryptedReport } from './lot-private-vault.mjs';
import {
  defaultInspectorDirectory, defaultAttestationPath, defaultTrustedFile,
  listTrustedKeys, loadInspectorPrivatePem, loadInspectorPublicPem,
  makeInspectorKeyPair, saveInspectorKeyPair, signInspectionReport,
  storeAttestation, trustInspectorPublicKey, verifySavedAttestation,
} from './lot-inspector-attestation.mjs';

async function secretPrompt(label) {
  if(!process.stdin.isTTY||!process.stdout.isTTY||typeof process.stdin.setRawMode!=='function')
    throw new Error('Run in an interactive Terminal. Never provide passphrases as arguments.');
  process.stdout.write(label);
  const old=Boolean(process.stdin.isRaw);
  process.stdin.setRawMode(true);process.stdin.resume();
  return await new Promise((resolve,reject)=>{
    let pass='';
    const done=()=>{process.stdin.removeListener('data',onData);process.stdin.setRawMode(old);process.stdin.pause();process.stdout.write('\n');};
    function onData(buf) {
      for(const c of buf.toString('utf8')){
        if(c==='\n'||c==='\r'){done();resolve(pass);return;}
        if(c==='\u0003'){done();reject(new Error('Canceled.'));return;}
        if(c==='\u007f'||c==='\b'){pass=pass.slice(0,-1);continue;}
        if(c>=' '&&pass.length<1025)pass+=c;
      }
    }
    process.stdin.on('data',onData);
  });
}
async function newPassword() {
  for(;;){
    const pass=await secretPrompt('Create inspector key passphrase (12+ characters, hidden): ');
    if(pass.length<12||pass.length>1024){console.log('Please use 12–1024 characters.');continue;}
    const repeat=await secretPrompt('Confirm inspector key passphrase (hidden): ');
    if(pass!==repeat){console.log('Passphrases differ. Retry.');continue;}
    return pass;
  }
}
async function main(){
  const [cmd,batch,...extra]=process.argv.slice(2);
  if(extra.length||!['init','trust-local','attest','check','trusted'].includes(cmd))
    throw new Error('Usage: inspector:init | inspector:trust-local | inspector:attest -- LOT-3001 | inspector:check -- LOT-3001 | inspector:trusted');
  if(cmd==='init'){
    const pass=await newPassword();
    const keys=makeInspectorKeyPair(pass);
    const paths=saveInspectorKeyPair(keys);
    console.log('Encrypted inspector key saved.');
    console.log(`Public key: ${paths.publicPath}`);
    console.log(`Fingerprint: ${keys.fingerprint}`);
    console.log('This is a local pilot identity, not a verified laboratory accreditation.');
    return;
  }
  if(cmd==='trusted'){
    const list=listTrustedKeys();
    console.log(list.length?list.join('\n'):'No trusted inspectors.');return;
  }
  if(cmd==='trust-local'){
    console.log('LOCAL DEVELOPMENT ONLY: enrolling your own key does not prove laboratory accreditation.');
    const id=trustInspectorPublicKey(loadInspectorPublicPem());
    console.log(`Trusted local key fingerprint: ${id}`);return;
  }
  if(!batch)throw new Error('Provide a batch ID such as LOT-3001.');
  const pass=await secretPrompt('Enter report vault passphrase (hidden): ');
  const report=loadEncryptedReport(batch,pass);
  if(cmd==='attest'){
    const inspectorPass=await secretPrompt('Enter inspector signing key passphrase (hidden): ');
    const att=signInspectionReport(report,loadInspectorPrivatePem(),inspectorPass,loadInspectorPublicPem());
    const file=storeAttestation(att);
    console.log(`Signed attestation saved: ${file}`);
    console.log('Private measurements and salt were not written to the attestation.');
    return;
  }
  const result=verifySavedAttestation(report);
  console.log(`Trusted inspector signature verified for ${result.batchId}.`);
  console.log('Local identity gate only. The Compact V1 contract still authorizes by bearer secret.');
}
main().catch(e=>{console.error('LOT inspector:',e?.message||'Inspector operation failed.');process.exitCode=1;});
