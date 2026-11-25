import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {allowedLocalRequestHost,allowedLocalWrite,localAuthority} from '../scripts/lot-local-http-guard.mjs';

const csrf='a'.repeat(48);
const allowed={host:'127.0.0.1:5173',origin:'http://127.0.0.1:5173',suppliedCsrf:csrf,expectedCsrf:csrf,fetchSite:'same-origin'};

test('accepts expected loopback browser and proxied API hosts',()=>{
 for(const host of ['127.0.0.1:5173','localhost:5173','127.0.0.1:4175','localhost:5174']){
  assert.equal(localAuthority(host),host);
  assert.equal(allowedLocalRequestHost({host}),true);
 }
 assert.equal(allowedLocalWrite(allowed),true);
 assert.equal(allowedLocalWrite({...allowed,host:'localhost:5173',origin:'http://localhost:5173'}),true);
});
test('rejects remote LAN, public, malformed and DNS-rebinding Host values',()=>{
 for(const host of ['example.com:5173','evil.example:5173','192.168.1.88:5173','0.0.0.0:5173','[::1]:5173',
  '127.0.0.1.evil.test:5173','127.0.0.1:5173.evil.com','127.0.0.1:0','localhost:65536',
  'localhost:5173, evil.test','localhost:5173@evil.test','LOCALHOST:5173','127.0.0.1:5173/secret','localhost:5173\nX-Evil: 1', '',undefined]){
   assert.equal(localAuthority(host),null,String(host));
   assert.equal(allowedLocalRequestHost({host}),false,String(host));
   assert.equal(allowedLocalWrite({...allowed,host}),false,String(host));
 }
});
test('rejects off-origin writes, including another localhost port or hostname',()=>{
 for(const origin of [undefined,'null','http://evil.example:5173','http://localhost:5200','http://localhost:5173',
  'https://127.0.0.1:5173','http://127.0.0.1:4175','http://127.0.0.1:5173.evil.test',
  'http://127.0.0.1:5173/','http://127.0.0.1:5173@evil.test']){
   assert.equal(allowedLocalWrite({...allowed,origin}),false,String(origin));
 }
});
test('rejects missing, mismatched, or malformed CSRF token',()=>{
 for(const suppliedCsrf of [undefined,null,'',csrf.slice(0,-1),'b'.repeat(48)])
  assert.equal(allowedLocalWrite({...allowed,suppliedCsrf}),false);
 assert.equal(allowedLocalWrite({...allowed,expectedCsrf:'short'}),false);
});
test('rejects cross-site and same-site browser fetches',()=>{
 for(const fetchSite of ['cross-site','same-site','unknown']){
  assert.equal(allowedLocalRequestHost({...allowed, 'sec-fetch-site':fetchSite}),false);
  assert.equal(allowedLocalWrite({...allowed,fetchSite}),false);
 }
 assert.equal(allowedLocalWrite({...allowed,fetchSite:undefined}),true);
 assert.equal(allowedLocalRequestHost({host:'localhost:5173','sec-fetch-site':'same-origin'}),true);
});
test('proof API routes are guarded before returning session token or any data',()=>{
 const source=readFileSync(new URL('../scripts/lot-proof-api.mjs',import.meta.url),'utf8');
 const guardPosition=source.indexOf('if(!allowedLocalRequestHost(req.headers))');
 const csrfPosition=source.indexOf("requestPath==='/api/proof/session'");
 assert.ok(guardPosition>0 && csrfPosition>guardPosition);
 assert.match(source,/allowedLocalWrite\(\{host:req\.headers\.host,origin/);
 assert.match(source,/server\.listen\(port,'127\.0\.0\.1'/);
});
test('Vite proxy and dev command must never publish secret-bearing UI to LAN',()=>{
 const vite=readFileSync(new URL('../vite.config.js',import.meta.url),'utf8');
 assert.match(vite,/host: '127\.0\.0\.1'/);
 assert.match(vite,/changeOrigin: false/);
 const setup=readFileSync(new URL('../scripts/lot-build22-setup.sh',import.meta.url),'utf8');
 assert.match(setup,/scripts\.dev=vite --host 127\.0\.0\.1/);
 assert.match(setup,/scripts\.preview=vite preview --host 127\.0\.0\.1/);
});

test('workspace configuration and npm scripts retain loopback and same-origin proxy boundaries',()=>{
 const vite=readFileSync(new URL('../vite.workspace.config.mjs',import.meta.url),'utf8');
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
 assert.match(vite,/host:'127\.0\.0\.1'/);
 assert.match(vite,/strictPort:true/);
 assert.match(vite,/target:'http:\/\/127\.0\.0\.1:4176',changeOrigin:false/);
 assert.equal(pkg.scripts.dev,'vite --host 127.0.0.1');
 assert.equal(pkg.scripts.preview,'vite preview --host 127.0.0.1');
});
