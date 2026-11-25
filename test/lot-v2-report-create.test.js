import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mkdtempSync,rmSync,readFileSync,lstatSync,writeFileSync,symlinkSync,mkdirSync,existsSync} from 'node:fs';
import {validateSignedReportRequest,createSignedLocalReport,localSignedReportStatus} from '../scripts/lot-v2-report-create.mjs';
import {makeInspectorKeyPair,saveInspectorKeyPair,trustInspectorPublicKey,loadInspectorPublicPem,verifySavedAttestation} from '../scripts/lot-inspector-attestation.mjs';
import {loadEncryptedReport} from '../scripts/lot-private-vault.mjs';

const vaultPass='vault-very-private-2026';
const inspectorPass='inspector-very-private-2026';
const sample={report:{batchId:'LOT-3002',material:'Structural steel',strengthMpa:570,defectBps:80},authorization:{vaultPassphrase:vaultPass,inspectorPassphrase:inspectorPass}};
function isolated(fn,{trusted=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'lot-report-build24-'));
 const paths={vaultDir:join(dir,'vault'),attestationDir:join(dir,'attestations'),inspectorDir:join(dir,'inspector'),trustFile:join(dir,'inspector','trusted-public-keys.json')};
 try {
  const keys=makeInspectorKeyPair(inspectorPass);
  saveInspectorKeyPair(keys,paths.inspectorDir);
  if(trusted)trustInspectorPublicKey(keys.publicKey,paths.trustFile);
  return fn(paths,dir);
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('valid local request accepts only exact report and inspector authorization fields',()=>{
 const input=validateSignedReportRequest(sample);
 assert.equal(input.report.batchId,'LOT-3002');
 assert.equal(input.authorization.inspectorPassphrase,inspectorPass);
 for(const bad of [
  {...sample,report:{...sample.report,openingSalt:'00'.repeat(32)}},
  {...sample,report:{...sample.report,strengthMpa:0}},
  {...sample,report:{...sample.report,defectBps:10001}},
  {...sample,report:{...sample.report,material:' Invalid'}},
  {...sample,report:{...sample.report, batchId:'../LOT-3002'}},
  {...sample,authorization:{...sample.authorization,role:'inspector'}},
  {...sample,extra:true},
  {...sample,authorization:{vaultPassphrase:'short',inspectorPassphrase:inspectorPass}},
 ])assert.throws(()=>validateSignedReportRequest(bad));
});
test('inspector can encrypt and sign a fresh report, without persisting plaintext',()=>isolated(paths=>{
 const result=createSignedLocalReport(sample,paths);
 assert.deepEqual(result,{batchId:'LOT-3002',saved:true,signed:true});
 assert.deepEqual(localSignedReportStatus('LOT-3002',paths),{batchId:'LOT-3002',saved:true,incomplete:false});
 const encryptedFile=join(paths.vaultDir,'LOT-3002.lot.enc');
 const attestedFile=join(paths.attestationDir,'LOT-3002.lot.attestation.json');
 const ciphertext=readFileSync(encryptedFile,'utf8');
 assert.ok(!ciphertext.includes('Structural steel'));
 assert.ok(!ciphertext.includes('\"strengthMpa\"'));
 assert.ok(!ciphertext.includes('\"defectBps\"'));
 assert.ok(!ciphertext.includes(inspectorPass));
 assert.ok(!ciphertext.includes(vaultPass));
 assert.ok(!readFileSync(attestedFile,'utf8').includes('strengthMpa'));
 assert.equal(lstatSync(encryptedFile).mode&0o077,0);
 assert.equal(lstatSync(attestedFile).mode&0o077,0);
 const report=loadEncryptedReport('LOT-3002',vaultPass,paths.vaultDir);
 assert.equal(report.strengthMpa,570);
 assert.equal(report.defectBps,80);
 const checked=verifySavedAttestation(report,paths.trustFile,paths.attestationDir);
 assert.equal(checked.batchId,'LOT-3002');
}));
test('duplicate batch refuses overwrite and preserves encrypted file',()=>isolated(paths=>{
 createSignedLocalReport(sample,paths);
 const file=join(paths.vaultDir,'LOT-3002.lot.enc'), original=readFileSync(file,'utf8');
 assert.throws(()=>createSignedLocalReport(sample,paths),/already has local report/);
 assert.equal(readFileSync(file,'utf8'),original);
}));
test('wrong inspector passphrase does not create vault or attestation',()=>isolated(paths=>{
 assert.throws(()=>createSignedLocalReport({...sample,authorization:{...sample.authorization,inspectorPassphrase:'incorrect-but-long-enough'}},paths),/key unlock failed/);
 assert.deepEqual(localSignedReportStatus('LOT-3002',paths),{batchId:'LOT-3002',saved:false,incomplete:false});
}));
test('untrusted inspector cannot save an attestation',()=>isolated(paths=>{
 assert.throws(()=>createSignedLocalReport(sample,paths),/has not been trusted/);
 assert.deepEqual(localSignedReportStatus('LOT-3002',paths),{batchId:'LOT-3002',saved:false,incomplete:false});
},{trusted:false}));
test('failure to write signed attestation removes freshly saved vault report',()=>isolated((paths,dir)=>{
 const target=join(dir,'outside');mkdirSync(target);
 symlinkSync(target,paths.attestationDir);
 assert.throws(()=>createSignedLocalReport(sample,paths),/Unsafe inspector directory/);
 assert.equal(existsSync(join(paths.vaultDir,'LOT-3002.lot.enc')),false);
}));
test('preexisting stray file is marked incomplete and never overwritten',()=>isolated(paths=>{
 mkdirSync(paths.vaultDir,{recursive:true});
 writeFileSync(join(paths.vaultDir,'LOT-3002.lot.enc'),'existing',{mode:0o600});
 assert.deepEqual(localSignedReportStatus('LOT-3002',paths),{batchId:'LOT-3002',saved:false,incomplete:true});
 assert.throws(()=>createSignedLocalReport(sample,paths),/already has local report/);
 assert.equal(readFileSync(join(paths.vaultDir,'LOT-3002.lot.enc'),'utf8'),'existing');
}));
test('preexisting symlink is treated as occupied, not followed',()=>isolated((paths,dir)=>{
 mkdirSync(paths.vaultDir,{recursive:true});
 const target=join(dir,'target');writeFileSync(target,'do-not-touch');
 symlinkSync(target,join(paths.vaultDir,'LOT-3002.lot.enc'));
 assert.throws(()=>createSignedLocalReport(sample,paths),/already has local report/);
 assert.equal(readFileSync(target,'utf8'),'do-not-touch');
}));
test('report status does not expose sensitive reading or secret details',()=>isolated(paths=>{
 createSignedLocalReport(sample,paths);
 const json=JSON.stringify(localSignedReportStatus('LOT-3002',paths));
 for(const secret of ['Structural steel','570','80',inspectorPass,vaultPass,'openingSalt'])assert.ok(!json.includes(`"${secret}"`));
}));
