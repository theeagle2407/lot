import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, lstatSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  newPrivateReport, validatePrivateReport, sealPrivateReport, openPrivateReport,
  saveEncryptedReport, loadEncryptedReport, listPrivateReportIds,
} from '../scripts/lot-private-vault.mjs';

const password='a-long-private-passphrase-for-lot';
const sample=()=>newPrivateReport({batchId:'LOT-2048',material:'Structural steel',strengthMpa:570,defectBps:80});
const temp=()=>mkdtempSync(join(tmpdir(),'lot-vault-test-'));

test('private report includes a unique 32-byte opening salt',()=>{
  const a=sample(), b=sample();
  assert.match(a.openingSalt,/^[a-f0-9]{64}$/);
  assert.notEqual(a.openingSalt,b.openingSalt);
});
test('seal/open retains exact private readings',()=>{
  const r=sample();
  const encrypted=sealPrivateReport(r,password);
  assert.deepEqual(openPrivateReport(encrypted,password),r);
});
test('different encryptions produce different envelopes',()=>{
  const r=sample();
  assert.notEqual(sealPrivateReport(r,password),sealPrivateReport(r,password));
});
test('encrypted file never contains plaintext readings or opening salt',()=>{
  const r=sample();
  const encrypted=sealPrivateReport(r,password);
  assert.ok(!encrypted.includes(r.openingSalt));
  assert.ok(!encrypted.includes('Structural steel'));
  assert.ok(!encrypted.includes('strengthMpa'));
  assert.ok(!encrypted.includes('LOT-2048'));
});
test('wrong passphrase is rejected',()=>{
  const c=sealPrivateReport(sample(),password);
  assert.throws(()=>openPrivateReport(c,'a-very-different-password'),/wrong passphrase|modified encrypted data/);
});
test('tampered ciphertext and authentication tags fail',()=>{
  for (const field of ['data','tag']) {
    const env=JSON.parse(sealPrivateReport(sample(),password));
    const chars=env[field].split('');
    chars[0]=chars[0]==='A'?'B':'A';
    env[field]=chars.join('');
    assert.throws(()=>openPrivateReport(JSON.stringify(env),password));
  }
});
test('tampered algorithm metadata is refused',()=>{
  const env=JSON.parse(sealPrivateReport(sample(),password));
  env.encryption='AES-128-CBC';
  assert.throws(()=>openPrivateReport(JSON.stringify(env),password),/header/);
});
test('report validation rejects invalid values',()=>{
  const r=sample();
  for (const bad of [{...r,defectBps:10001},{...r,strengthMpa:-1},{...r,batchId:'../wrong'}, {...r,openingSalt:'1234'}, {...r,password:'leak'}]) {
    assert.throws(()=>validatePrivateReport(bad));
  }
});
test('passwords shorter than 12 characters are rejected',()=>{
  assert.throws(()=>sealPrivateReport(sample(),'short'));
});
test('save/check/list works and uses owner-only file permissions',()=>{
  const dir=temp();
  try {
    const r=sample();
    const file=saveEncryptedReport(r,password,dir);
    assert.deepEqual(loadEncryptedReport('LOT-2048',password,dir),r);
    assert.deepEqual(listPrivateReportIds(dir),['LOT-2048']);
    assert.equal(lstatSync(file).mode & 0o777,0o600);
    assert.equal(lstatSync(dir).mode & 0o777,0o700);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('never overwrites an existing sealed report',()=>{
  const dir=temp();
  try {
    const r=sample();
    const file=saveEncryptedReport(r,password,dir);
    const before=readFileSync(file,'utf8');
    assert.throws(()=>saveEncryptedReport(sample(),password,dir),/EEXIST/);
    assert.equal(readFileSync(file,'utf8'),before);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('rejects symlinked report files',()=>{
  const dir=temp();
  try {
    const file=join(dir,'LOT-2048.lot.enc');
    symlinkSync(join(dir,'nonexistent'),file);
    assert.throws(()=>loadEncryptedReport('LOT-2048',password,dir));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('rejects ciphertext copied to a different batch filename',()=>{
  const dir=temp();
  try {
    const file=saveEncryptedReport(sample(),password,dir);
    writeFileSync(join(dir,'LOT-9999.lot.enc'),readFileSync(file));
    assert.throws(()=>loadEncryptedReport('LOT-9999',password,dir),/does not match/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('missing directory yields empty report list',()=>{
  const dir=join(tmpdir(),'lot-does-not-exist-'+randomBytes(10).toString('hex'));
  assert.deepEqual(listPrivateReportIds(dir),[]);
});
