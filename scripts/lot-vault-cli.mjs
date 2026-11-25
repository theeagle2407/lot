#!/usr/bin/env node
/** Encrypted report utility: local-only. No private data is printed or sent to an API. */
import process from 'node:process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { newPrivateReport, saveEncryptedReport, loadEncryptedReport, listPrivateReportIds } from './lot-private-vault.mjs';

async function hiddenPassphrase(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error('Run the vault command in an interactive Terminal; never pass passphrases as arguments.');
  }
  process.stdout.write(prompt);
  const wasRaw = Boolean(process.stdin.isRaw);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve,reject) => {
    let chars='';
    const cleanup=()=>{process.stdin.removeListener('data',onKey); process.stdin.setRawMode(wasRaw);process.stdin.pause(); process.stdout.write('\n');};
    function onKey(buf) {
      for (const key of buf.toString('utf8')) {
        if (key==='\r' || key==='\n') { cleanup();resolve(chars);return; }
        if (key==='\u0003') { cleanup();reject(new Error('Canceled.'));return; }
        if (key==='\u007f' || key==='\b') { chars=chars.slice(0,-1);continue; }
        if (key>=' ' && chars.length<1025) chars+=key; // 1025 sentinel ensures overly long input is rejected, not silently accepted.
      }
    }
    process.stdin.on('data', onKey);
  });
}
async function chooseNewPassphrase() {
  while (true) {
    const pass=await hiddenPassphrase('Choose a passphrase (12+ characters, hidden): ');
    if (pass.length < 12) {
      console.log(`Passphrase too short (${pass.length} characters received). Enter at least 12 characters.`);
      continue;
    }
    if (pass.length > 1024) {
      console.log('Passphrase is too long (maximum 1024 characters). Enter a shorter passphrase.');
      continue;
    }
    const repeat=await hiddenPassphrase('Confirm passphrase (hidden): ');
    if (pass!==repeat) {
      console.log('Passphrases do not match. Try again. Nothing has been saved.');
      continue;
    }
    return pass;
  }
}
async function main() {
  const command = process.argv[2];
  if (command==='list') {
    const ids=listPrivateReportIds();
    console.log(ids.length ? ids.join('\n') : 'No private inspection reports stored.');
    return;
  }
  if (!['save','check'].includes(command)) {
    console.log('Usage: node scripts/lot-vault-cli.mjs save | check LOT-2048 | list');
    process.exitCode=2; return;
  }
  let inputReport;
  if (command==='save') {
    const rl=createInterface({input, output});
    try {
      inputReport={
        batchId:(await rl.question('Batch ID (e.g. LOT-2048): ')).trim(),
        material:(await rl.question('Material: ')).trim(),
        strengthMpa:Number((await rl.question('Strength (whole MPa): ')).trim()),
        defectBps:Number((await rl.question('Defects (basis points; 100 = 1%): ')).trim()),
      };
    } finally { rl.close(); }
    // Generate a fresh cryptographic opening salt with the report.
    const report=newPrivateReport(inputReport);
    const pass=await chooseNewPassphrase();
    const saved=saveEncryptedReport(report,pass);
    console.log(`Encrypted report saved: ${saved}`);
    console.log('Keep your passphrase safe. Without it the private report cannot be recovered.');
    return;
  }
  const batchId=process.argv[3];
  if (!batchId) throw new Error('Provide a batch ID, e.g. check LOT-2048.');
  const pass=await hiddenPassphrase('Enter passphrase (hidden): ');
  const report=loadEncryptedReport(batchId,pass);
  console.log(`Private report unlocked: ${report.batchId}. Measurements were not printed.`);
}
main().catch(err=>{
  console.error(`LOT vault: ${err?.message || 'Unable to complete operation.'}`);
  process.exitCode=1;
});
