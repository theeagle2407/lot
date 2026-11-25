import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {accountCatalog,authenticateOnboarded} from './lot-onboarding.mjs';
import {receiptKeyValid} from '../src/receipt-target.js';
import {issuanceAccounts} from './lot-issuance-budget.mjs';
const address='mn_addr_preprod1mu8kr96p9s8xvt7lx2cutk0ucelwmfrfvd0hs7ndlwlsuzj4y5wqxgm0vg';
import {policyReceiptKey,listAdditionalReceipts} from './lot-multi-policy.mjs';
import {defaultReceipts,readPublishedReceipt} from './lot-public-receipt-store.mjs';
export function createBrowserIssuer({root,file,receipts=defaultReceipts(),allowed='',phrase='',token='',launch=spawn,maxJobs=3,runner=join(homedir(),'Downloads','lot-preprod-dust-helper','node_modules','.bin','tsx'),catalog=accountCatalog,authenticate=authenticateOnboarded,budget=null}={}){
 const accounts=issuanceAccounts(allowed);
 const enabled=accounts.size>0&&phrase.trim().split(/\s+/).length===24&&/^[A-Za-z0-9_-]{16,256}$/.test(token);
 let active=null,used=0;const jobs=new Map();let attempts=[];
 const authorized=a=>a?.scope==='onboarding'&&a.role==='manufacturer';
 const permitted=a=>enabled&&authorized(a)&&accounts.has(a.name);
 function status(b,a){
  if(!authorized(a)||!receiptKeyValid(b.requestId))return {};
  try{const {target}=readPublishedReceipt(receipts,b.requestId);if(target.batchId===b.id&&target.batchKey===b.requestId&&!target.receiptKey)return {issuance:'receipt',receiptKey:b.requestId};}catch{}
  if(active?.key===b.requestId)return {issuance:'running'};
  if(existsSync(join(receipts,b.requestId))||budget?.has(b.requestId))return {issuance:'reconcile'};
  return {issuance:jobs.get(b.requestId)||'idle'};
 }
 function primary(b){try{const r=readPublishedReceipt(receipts,b.requestId);return r.target.batchId===b.id&&r.target.batchKey===b.requestId&&!r.target.receiptKey?r.target:null;}catch{return null;}}
 function extraStatus(b,p){if(!p||!primary(b)||p.policyId===primary(b).policyId)return null;const key=policyReceiptKey(b.requestId,p.policyId);try{const {target}=readPublishedReceipt(receipts,key);if(target.batchKey===b.requestId&&target.batchId===b.id)return {status:'receipt',key};}catch{}if(active?.key===key)return {status:'running',key};if(existsSync(join(receipts,key))||budget?.has(key))return {status:'reconcile',key};return {status:jobs.get(key)||'idle',key};}
 function canPrepare(a,b,input){if(!authorized(a)||!b||!input||typeof input.policyId!=='string'||!/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(input.policyId)||active?.batch===b.requestId)return false;const s=status(b,a).issuance;if(s==='idle')return true;if(s!=='receipt')return false;const old=extraStatus(b,b.preparedPolicy);if(old&&['running','reconcile'].includes(old.status))return false;const first=primary(b);if(!first||input.policyId===first.policyId)return false;return extraStatus(b,input)?.status==='idle';}
 function decorate(a,data){return {...data,issuanceEnabled:permitted(a)&&used<maxJobs&&(!budget||budget.remaining(a.name)>0),batches:data.batches.map(b=>{const s=status(b,a);if(s.issuance!=='receipt')return {...b,...s};const first=primary(b);return {...b,...s,primaryPolicy:first?{policyId:first.policyId,minStrength:first.minStrength,maxDefectsBps:first.maxDefectsBps}:null,additionalReceipts:listAdditionalReceipts(receipts,b.requestId,readPublishedReceipt),additionalIssuance:extraStatus(b,b.preparedPolicy)};})};}

 function start(a,input){
  if(!permitted(a))throw Error('Preprod issuance is not enabled for this account.');
  if(active)throw Error('Another clearance is being issued.');
  if(used>=maxJobs)throw Error('Local issuance budget reached.');
  if(!input||Object.keys(input).sort().join('|')!=='approval|maxDefectsBps|minStrength|password|policyId|requestId'||input.approval!=='ISSUE_AND_PUBLISH'||!receiptKeyValid(input.requestId)||typeof input.password!=='string'||input.password.length>512)throw Error('Invalid clearance authorization.');
  const now=Date.now();attempts=attempts.filter(t=>now-t<60000);if(attempts.length>=5)throw Error('Too many authorization attempts.');attempts.push(now);
  const verified=authenticate({file,name:a.name,password:input.password});if(!verified||verified.name!==a.name||verified.role!=='manufacturer'||verified.scope!=='onboarding')throw Error('Manufacturer password incorrect.');
  const b=catalog(file,a).batches.find(x=>x.requestId===input.requestId);const p=b?.preparedPolicy;
  if(!b||b.status!=='signed'||!p?.eligible||p.policyId!==input.policyId||p.minStrength!==input.minStrength||p.maxDefectsBps!==input.maxDefectsBps)throw Error('Signed batch or reviewed policy changed.');
  const first=primary(b),additional=first&&p.policyId!==first.policyId;
  if(additional?extraStatus(b,p)?.status!=='idle':status(b,a).issuance!=='idle')throw Error('Existing issuance or failed attempt; reconcile before retrying.');
  // Explicit policy binding passed to child; no credentials in argv, stdout or UI state.
  const binding=JSON.stringify({requestId:b.requestId,policyId:p.policyId,minStrength:p.minStrength,maxDefectsBps:p.maxDefectsBps});
  const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LOT_ACCOUNT_PASSWORD:input.password,WALLET_MNEMONIC:phrase,BLOCKFROST_PROJECT_ID:token,LOT_BROWSER_APPROVAL:binding};
  // Existing store-path overrides must match the server. Preserve only the required nonsecret config.
  for(const k of ['LOT_OPERATOR_DIR','LOT_OPERATOR_STORE','LOT_DATA_DIR'])if(process.env[k])env[k]=process.env[k];
  if(additional)env.LOT_ADDITIONAL_POLICY=JSON.stringify({policyId:p.policyId,minStrength:p.minStrength,maxDefectsBps:p.maxDefectsBps});
  const key=additional?policyReceiptKey(b.requestId,p.policyId):b.requestId;
  if(budget)budget.reserve(a.name,key);
  active={key,batch:b.requestId};used++;jobs.set(key,'running');
  let child;
  try{child=launch(runner,['scripts/lot-onboard-preprod.ts',address,a.name,b.id,'ISSUE'],{cwd:root,env,stdio:'ignore',detached:false});}catch{active=null;jobs.set(key,'reconcile');throw Error('Could not start issuance; check operator service.');}
  const finish=()=>{if(active?.key!==key)return;active=null;jobs.set(key,'reconcile');try{if(readPublishedReceipt(receipts,key).target.batchId===b.id&&readPublishedReceipt(receipts,key).target.batchKey===b.requestId)jobs.set(key,'receipt');}catch{}};
  child.once('error',finish);child.once('close',finish);
  return {status:'running',requestId:key};
 }
 return {decorate,start,canPrepare,isBusy:key=>active?.key===key||active?.batch===key};
}
