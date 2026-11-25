import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app=readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
test('customer nav omits chain diagnostics',()=>{
  assert.doesNotMatch(app, /id: ['"]chain['"]/);
  assert.doesNotMatch(app, /On-chain evidence|ChainView/);
});
test('local records and Preprod demonstration are clearly distinguished',()=>{
 const live=readFileSync(new URL('../src/PreprodBuyer.jsx',import.meta.url),'utf8');
 const local=readFileSync(new URL('../src/LocalReceipts.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(app,/Sample data|New sample/);
 assert.match(live,/Preprod demonstration/);
 assert.match(local,/Not a public-network clearance/);
});
test('current core workflow remains available through role-based accounts',()=>{
 const onboard=readFileSync(new URL('../src/Onboarding.jsx',import.meta.url),'utf8');
 for(const action of ['Create batch','Invite inspector','Sign report','Check eligibility','Generate clearance','View clearance','Add buyer policy'])assert.ok(onboard.includes(action),action);
 assert.match(app,/Sign in to LOT/);
 assert.match(app,/Have a clearance to verify/);
});
