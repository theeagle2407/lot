/** LOT Build 24 — local-only creation of an encrypted, inspector-signed report.
 * Report measurements and passphrases are accepted ONLY by the loopback service
 * after an authenticated inspector request. Never use this for a hosted site.
 */
import {existsSync, rmSync, lstatSync} from 'node:fs';
import {newPrivateReport, saveEncryptedReport, reportFilePath, defaultVaultDirectory} from './lot-private-vault.mjs';
import {
  defaultAttestationPath, defaultAttestationDirectory, defaultTrustedFile,
  loadInspectorPrivatePem, loadInspectorPublicPem, signInspectionReport,
  verifyInspectionReport, storeAttestation,
} from './lot-inspector-attestation.mjs';
import {validateV2Authorization} from './lot-v2-browser-auth.mjs';
import {validateV2UiBatch} from './lot-v2-ui-core.mjs';

const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
export function validateSignedReportRequest(raw){
  if(!exact(raw,['report','authorization']) || !exact(raw.report,['batchId','material','strengthMpa','defectBps']))
    throw new Error('Invalid signed report request.');
  const report=raw.report;
  validateV2UiBatch(report.batchId);
  if(typeof report.material!=='string'||!report.material||report.material!==report.material.trim()||report.material.length>80||/[\x00-\x1f\x7f]/.test(report.material))
    throw new Error('Material must be 1–80 plain-text characters.');
  if(!Number.isSafeInteger(report.strengthMpa)||report.strengthMpa<1||report.strengthMpa>1_000_000_000)
    throw new Error('Strength must be a positive whole number.');
  if(!Number.isSafeInteger(report.defectBps)||report.defectBps<0||report.defectBps>10_000)
    throw new Error('Defect rate must be between 0 and 10,000 basis points.');
  const authorization=validateV2Authorization(raw.authorization,'init');
  return {report:{batchId:report.batchId,material:report.material,strengthMpa:report.strengthMpa,defectBps:report.defectBps},authorization};
}
function entryExists(file){
  // lstat, not stat, so a malicious symlink counts as occupied too.
  try {lstatSync(file);return true;}catch(e){if(e?.code==='ENOENT')return false;throw e;}
}
export function localSignedReportStatus(batchId,{vaultDir=defaultVaultDirectory(),attestationDir=defaultAttestationDirectory()}={}){
  validateV2UiBatch(batchId);
  const encrypted=entryExists(reportFilePath(batchId,vaultDir));
  const signed=entryExists(defaultAttestationPath(batchId,attestationDir));
  return {batchId,saved:encrypted&&signed,incomplete:encrypted!==signed};
}
export function createSignedLocalReport(raw,options={}){
  const {report:input,authorization}=validateSignedReportRequest(raw);
  const vaultDir=options.vaultDir??defaultVaultDirectory();
  const attestationDir=options.attestationDir??defaultAttestationDirectory();
  const trustFile=options.trustFile??defaultTrustedFile();
  const inspectorDir=options.inspectorDir;
  const file=reportFilePath(input.batchId,vaultDir);
  const attestationFile=defaultAttestationPath(input.batchId,attestationDir);
  if(entryExists(file)||entryExists(attestationFile))throw new Error('This batch already has local report data; it will not be overwritten.');
  const report=newPrivateReport(input);
  // Sign and validate trust BEFORE writing anything. The inspector's encrypted
  // signing key stays on this machine, never in the browser or output.
  const privatePem=inspectorDir===undefined?loadInspectorPrivatePem():loadInspectorPrivatePem(inspectorDir);
  const publicPem=inspectorDir===undefined?loadInspectorPublicPem():loadInspectorPublicPem(inspectorDir);
  const attestation=signInspectionReport(report,privatePem,authorization.inspectorPassphrase,publicPem);
  verifyInspectionReport(report,attestation,trustFile);
  let wroteReport=false;
  try{
    saveEncryptedReport(report,authorization.vaultPassphrase,vaultDir);
    wroteReport=true;
    storeAttestation(attestation,attestationDir);
  }catch(e){
    // Never strand an unsigned vault report if writing the attestation fails.
    // Only remove the file created by this invocation (not an existing one).
    if(wroteReport)rmSync(file,{force:true});
    throw e;
  }
  return Object.freeze({batchId:report.batchId,saved:true,signed:true});
}
