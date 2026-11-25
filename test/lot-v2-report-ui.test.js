import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const api=readFileSync(new URL('../scripts/lot-proof-api.mjs',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
const client=readFileSync(new URL('../src/signedReport.js',import.meta.url),'utf8');
test('new report create and status endpoints enforce inspector role',()=>{
 assert.match(api,/requestPath==='\/api\/proof\/v2-report\/create'/);
 assert.match(api,/requestPath==='\/api\/proof\/v2-report\/status'/);
 assert.ok((api.match(/actor\.role!=='inspector'/g)||[]).length>=2);
 assert.match(api,/allowedLocalWrite/);
 assert.match(api,/createSignedLocalReport\(parsed\)/);
});
test('report creation is excluded from public receipts and returned response contains only metadata',()=>{
 assert.match(client,/credentials:'same-origin'/);
 assert.match(client,/referrerPolicy:'no-referrer'/);
 assert.match(client,/x-lot-csrf/);
 assert.ok(!api.includes('reply(res,201,{ok:true,...parsed}'));
 assert.match(api,/reply\(res,201,{ok:true,\.\.\.result}\)/);
});
test('inspector creation and on-chain registration are separate explicit actions',()=>{
 assert.match(ui,/Create signed report/);
 assert.match(ui,/Register inspection/);
 assert.match(ui,/!reportState\?\.saved/);
 assert.match(ui,/operator\?\.role!=='inspector'/);
 assert.match(ui,/Signed report saved · Not yet registered/);
});
test('browser report modal keeps signing secrets out of React state and storage',()=>{
 assert.match(ui,/const createVault=useRef\(null\)/);
 assert.match(ui,/const createInspector=useRef\(null\)/);
 assert.match(ui,/createVault\.current\.value=''/);
 assert.match(ui,/createInspector\.current\.value=''/);
 assert.ok(!ui.includes('localStorage.setItem'));
 assert.ok(!ui.includes('sessionStorage.setItem'));
});
test('sample creation is absent; real signed workflow remains labeled by network',()=>{
 assert.doesNotMatch(ui,/New sample|Sample inspection|Sample data/);
 assert.match(ui,/Local network/);
 const onboard=readFileSync(new URL('../src/Onboarding.jsx',import.meta.url),'utf8');
 assert.match(onboard,/inspector&&b.status==='accepted'/);
 assert.match(onboard,/Confidential inspection/);
 assert.match(onboard,/Sign report/);
});
