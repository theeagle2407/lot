import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {TARGET,ONBOARDED_TARGET} from '../src/preprod-clearance.js';
import {createPublicReader} from './lot-preprod-public-core.mjs';
const root=fileURLToPath(new URL('../dist-preprod/',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'};
export function createPublicServer(read,{dist=root,readOnboarded=null,readByKey=null}={}){
 const verify=createPublicReader(read);
 const verifyOnboarded=readOnboarded?createPublicReader(readOnboarded):null;
 return http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  res.setHeader('Cache-Control','no-store');
  const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
  if(req.method!=='GET')return json(405,{status:'method_not_allowed'});
  if(req.url==='/healthz')return json(200,{status:'ok'});
  if(req.url==='/api/preprod/clearance'||req.url==='/api/preprod/clearance?batch=LOT-3002'||req.url==='/api/preprod/clearance?batch=LOT-0001'){
   const reader=req.url.endsWith('LOT-0001')?verifyOnboarded:verify;
   if(!reader)return json(503,{status:'unavailable'});
   try{return json(200,await reader());}catch{return json(503,{status:'unavailable'});}
  }
  const keyed=/^\/api\/preprod\/clearance\?key=([a-f0-9]{64})$/.exec(req.url??'');
  if(keyed&&readByKey){try{const result=await readByKey(keyed[1]);return result?json(200,result):json(404,{status:'not_found'});}catch{return json(503,{status:'unavailable'});}}
  // Exact fixed paths only; no access to source, HOME, local APIs or arbitrary files.
  const pathname=(req.url??'').split('?')[0];
  const file=pathname==='/'||pathname==='/verify-preprod'||pathname==='/lot-public.html'?'lot-public.html':/^\/assets\/[A-Za-z0-9_.-]+\.(js|css|svg|woff2|png|webp)$/.test(pathname)?pathname.slice(1):null;
  if(!file)return json(404,{status:'not_found'});
  try{const body=await readFile(resolve(dist,file));res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(body);}catch{return json(404,{status:'not_found'});}
 });
}
async function main(){
 const token=(process.env.BLOCKFROST_PROJECT_ID??'').trim();delete process.env.BLOCKFROST_PROJECT_ID;
 const port=Number(process.env.PORT||4176),host=process.env.HOST||'127.0.0.1';
 if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');
 await readFile(resolve(root,'lot-public.html'));
 const {createLedgerReader}=await import('./lot-preprod-public-read.mjs');
 const dir=process.env.LOT_PUBLIC_RECEIPTS_DIR;
 const {readReceiptFromRoots,defaultReceipts}=await import('./lot-public-receipt-store.mjs');
 const roots=[dir,process.env.LOT_PUBLIC_LIVE_RECEIPTS==='1'?defaultReceipts():null].filter(Boolean);
 const readers=new Map();
 const readByKey=roots.length?async key=>{
  const entry=readReceiptFromRoots(roots,key);if(!entry)return null;
  const signature=JSON.stringify(entry.target);let cached=readers.get(key);
  if(!cached||cached.signature!==signature){if(readers.size>=64)readers.delete(readers.keys().next().value);cached={signature,verify:createPublicReader(createLedgerReader(token,entry.target))};readers.set(key,cached);}
  return {...await cached.verify(),submissionIdentifiers:entry.submissions};
 }:null;
 const server=createPublicServer(createLedgerReader(token,TARGET),{readOnboarded:createLedgerReader(token,ONBOARDED_TARGET),readByKey});
 server.listen(port,host,()=>console.log(`LOT read-only public verifier: http://${host}:${port}/`));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Verifier could not start. Check build, compiled contract, dependencies and Preprod token.');process.exitCode=1;});
