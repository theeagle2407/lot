/**
 * LOT Build 05: local-only proof runner. NOT a production wallet or API.
 * Uses the already validated Ledger 9 Vitest harness as the proof transaction engine.
 * The process receives demonstration measurements; the public HTTP responses never do.
 * Every run deploys a NEW contract on the disposable local network.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {validateLocalProofInput} from './lot-proof-utils.mjs';
import {readLocalPublicReceipt} from './lot-public-receipt.mjs';
import {summarizeFailedRun} from './lot-test-diagnostics.mjs';
import { defaultEvidenceFile, readPublicEvidence, storeConfirmedEvidence, savedJobFromEntry } from './lot-proof-archive.mjs';
import { checkSavedLocalContract } from './lot-saved-chain-check.mjs';
import { validateV2UiRequest, validateV2UiBatch, publicV2Session } from './lot-v2-ui-core.mjs';
import { createV2UiRunner } from './lot-v2-ui-runner.mjs';
import { validateV2AuthorizedRequest } from './lot-v2-browser-auth.mjs';
import { sessionPublic, listPublicSessions } from './lot-v2-session-store.mjs';
import {allowedLocalRequestHost,allowedLocalWrite} from './lot-local-http-guard.mjs';
import {operatorStorePath,authenticateLocalOperator,createLocalOperatorSessions,roleForAction,LOCAL_COOKIE} from './lot-operator-access.mjs';
import {createSignedLocalReport,localSignedReportStatus} from './lot-v2-report-create.mjs';
import {parseBuyerQuery,findScopedBuyerReceipt,scopedBuyerAuditResult} from './lot-buyer-scoped.mjs';

import {onboardingPath,registerOnboarded,authenticateOnboarded,hasOnboardedName,accountCatalog,createBatchRequest,assignBatchRequest,createInspectorInvitation,redeemInspectorInvitation,decideInspection,signAssignedInspection,prepareClearance,onboardingRouteAllowed} from './lot-onboarding.mjs';

import {createBrowserIssuer} from "./lot-browser-issuance.mjs";
import {createIssuanceBudget,issuanceAccounts} from "./lot-issuance-budget.mjs";

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port=Number(process.env.LOT_PROOF_API_PORT||4175);
if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('Invalid LOT_PROOF_API_PORT');
const csrf=randomBytes(24).toString('hex');
let authStarts=[]; // Local-only limit, never persist password guesses or request bodies.
// Public-only receipts are archived outside the project directory. The old
// devnet may be reset, so restored receipts are NOT confirmed until checked.
const evidenceFile = defaultEvidenceFile(root);
let archive = [];
try { archive = readPublicEvidence(evidenceFile); }
catch (err) { throw new Error(`Cannot read LOT local evidence archive: ${err.message}`); }
let job = archive.length ? savedJobFromEntry(archive[archive.length - 1]) : null;
const restoredJob = job;
let lastSavedCheck = 0;
let savedCheckPromise = null;
let child=null;
const v2Runner=createV2UiRunner(root);
const localOperators=operatorStorePath(root);
const operatorSessions=createLocalOperatorSessions();
let failedLogins=[];
const onboarding=onboardingPath(localOperators);
let signupAttempts=[];
const issuanceBudget=createIssuanceBudget(path.join(homedir(),".lot","preprod","browser-budget-v1"),{total:Number(process.env.LOT_ISSUER_TOTAL||3),perAccount:Number(process.env.LOT_ISSUER_PER_ACCOUNT||3)});
const reservedNames=issuanceAccounts(process.env.LOT_ISSUER_ACCOUNT);
const issuer=createBrowserIssuer({root,file:onboarding,allowed:process.env.LOT_ISSUER_ACCOUNT,phrase:process.env.LOT_ISSUER_MNEMONIC,token:process.env.LOT_ISSUER_TOKEN,runner:process.env.LOT_ISSUER_RUNNER,budget:issuanceBudget});
for(const k of ['LOT_ISSUER_ACCOUNT','LOT_ISSUER_MNEMONIC','LOT_ISSUER_TOKEN'])delete process.env[k];

async function refreshRestoredReceipt() {
  if (!job || job !== restoredJob || !['saved','confirmed'].includes(job.status)) return;
  if (savedCheckPromise) return savedCheckPromise;
  if (Date.now() - lastSavedCheck < 12000) return;
  lastSavedCheck = Date.now();
  const target = job;
  savedCheckPromise = (async () => {
    try {
      let timeout;
      const check = checkSavedLocalContract(target.receipt);
      const valid = await Promise.race([
        check,
        new Promise((resolve) => { timeout = setTimeout(() => resolve(false), 6000); }),
      ]).finally(() => clearTimeout(timeout));
      if (job === target) {
        target.status = valid ? 'confirmed' : 'saved';
        target.phase = valid ? 'Saved local proof; contract present' : 'Saved receipt; local contract not confirmed';
      }
    } catch {
      if (job === target) {
        target.status = 'saved';
        target.phase = 'Saved receipt; local indexer unavailable';
      }
    }
  })().finally(() => { savedCheckPromise = null; });
  return savedCheckPromise;
}

function reply(res,code,body,extraHeaders={}){
  res.writeHead(code,{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer',
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}
function safeJob(){
  if(!job) return null;
  return {
    id:job.id, status:job.status, phase:job.phase, startedAt:job.startedAt,
    batchId:job.batchId, policyId:job.policyId,
    ...(job.error?{error:job.error}:{}),
    ...(job.receipt?{receipt:job.receipt}:{}),
  };
}
function updateFromLine(line){
  if(!job || job.status!=='running')return;
  if(line.includes('LOT contract deployed and finalized'))job.phase='Contract deployed';
  else if(line.includes('Inspector commitment finalized'))job.phase='Inspection committed';
  else if(line.includes('Buyer policy finalized'))job.phase='Policy recorded';
  else if(line.includes('Private compliance proof finalized'))job.phase='Proof finalized';
  // Receipt handling is intentionally NOT based on terminal output.
  // Vitest logs can be chunked, colored or interleaved with stderr.
}
function runProof(data){
  const current={id:randomBytes(8).toString('hex'),status:'running',phase:'Starting local wallet',startedAt:new Date().toISOString(),batchId:data.batchLabel,policyId:data.policyLabel,receipt:null,_publicPolicy:{minStrength:data.minStrength,maxDefectsBps:data.maxDefectsBps},_additional:data.extraPolicies||[]};
  job=current;
  // Private to this local runner; not accessible via HTTP and never returned to clients.
  const receiptDir=mkdtempSync(path.join(tmpdir(),'lot-receipt-'));
  const receiptFile=path.join(receiptDir,'public.json');
  const cleanup=()=>rmSync(receiptDir,{recursive:true,force:true});
  const testFile=path.join(root,'node_modules','vitest','vitest.mjs');
  child=spawn(process.execPath,[testFile,'run','test/lot.live.test.ts'],{
    cwd:root, stdio:['ignore','pipe','pipe'],shell:false,
    env:{...process.env,MIDNIGHT_NETWORK:'local',LOT_LOCAL_PROOF_PAYLOAD:JSON.stringify(data),LOT_PUBLIC_RECEIPT_FILE:receiptFile,LOG_LEVEL:'info'},
  });
  let output='';
  const append=(chunk)=>{
    output=(output+chunk.toString('utf8')).slice(-32768);
    // Track user-facing phases; the authoritative receipt comes from a file.
    for(const line of output.split(/\r?\n/)) updateFromLine(line);
  };
  child.stdout.on('data',append);
  child.stderr.on('data',append);
  child.on('error',err=>{
    console.error('[LOT proof runner] spawn error:',err.message);
    if(job===current){current.status='failed';current.phase='Failed';current.error='Unable to start local proof runner.';}
    cleanup();
    child=null;
  });
  child.on('close',code=>{
    try{
      if(job!==current || current.status==='failed')return;
      if(code!==0){
        const failure=summarizeFailedRun(output,current.phase);
        current.status='failed';current.phase='Failed';
        current.error=`Local proof stopped during ${failure.phase}. See the Terminal diagnostic.`;
        // Only publish an exception summary; never dump the proof server trace,
        // private inputs, seeds, Hex blobs, or raw child output.
        console.error(`[LOT proof runner] Test exit ${code}; last phase: ${failure.phase}`);
        console.error(`[LOT proof runner] Cause: ${failure.cause}`);
        return;
      }
      // Vitest has exited successfully. Read a structured public-only receipt
      // rather than attempting to reconstruct it from its stdout stream.
      try{
        current.receipt=readLocalPublicReceipt(receiptFile,current.batchId,current.policyId,current._publicPolicy,current._additional);
        current.status='confirmed';current.phase='Verified on local Midnight';
        try {
          const stored = storeConfirmedEvidence(evidenceFile, current);
          archive = [...archive.filter(x => x.id !== stored.id), stored].slice(-40);
          console.log('[LOT proof runner] Public-only receipt archived for restart recovery.');
        } catch (err) {
          // A disk error does not invalidate a finalized blockchain proof.
          console.error('[LOT proof runner] Public receipt could not be archived:', err.message);
        }
        console.log('[LOT proof runner] Local transaction passed and public receipt validated.');
      }catch(err){
        current.status='failed';current.phase='Failed';
        current.error='Proof completed, but its public receipt could not be validated.';
        const detail=err?.code==='ENOENT'?'Receipt file was not produced.':err instanceof SyntaxError?'Receipt file was not valid JSON.':err instanceof Error?err.message:'Unknown receipt error.';
        console.error('[LOT proof runner] Receipt validation:',detail);
      }
    }finally{
      cleanup();
      child=null;
    }
  });
  return safeJob();
}
const server=http.createServer(async(req,res)=>{
  // Reject DNS-rebinding hosts and cross-site fetches on EVERY route, including
  // the CSRF bootstrap. The Vite proxy keeps the browser's Host unchanged.
  if(!allowedLocalRequestHost(req.headers))
    return reply(res,403,{ok:false,error:'LOT accepts requests from its local interface only.'});
  const requestPath=(req.url||'').split('?')[0];
  const routeActor=operatorSessions.fromCookie(req.headers.cookie);
  if(!onboardingRouteAllowed(requestPath,routeActor))return reply(res,routeActor?403:401,{ok:false,error:'Account not authorized for this operation.'});
  if(req.method==='GET'&&requestPath==='/api/proof/onboarding/catalog'){
    try{return reply(res,200,{ok:true,...issuer.decorate(routeActor,accountCatalog(onboarding,routeActor))});}catch{return reply(res,503,{ok:false,error:'Account catalog unavailable.'});}
  }
  if(req.method==='GET' && requestPath==='/api/proof/status'){
    await refreshRestoredReceipt();
    return reply(res,200,{ok:true,job:safeJob()});
  }
  if(req.method==='GET' && (requestPath==='/api/proof/buyer-receipt'||requestPath==='/api/proof/buyer-audit')){
    const target=parseBuyerQuery(new URL(req.url,'http://127.0.0.1').searchParams);
    if(!target)return reply(res,400,{ok:false,error:'Invalid buyer verification link.'});
    let receipt;
    try{receipt=findScopedBuyerReceipt(readPublicEvidence(evidenceFile),target);}
    catch{return reply(res,503,{ok:false,error:'Saved local evidence is unavailable.'});}
    if(!receipt)return reply(res,404,{ok:false,error:'This buyer clearance is not saved on this device.'});
    if(requestPath==='/api/proof/buyer-receipt')return reply(res,200,{ok:true,receipt});
    const {runLocalV2BrowserAudit}=await import('./lot-v2-browser-audit.mjs');
    const audit=await runLocalV2BrowserAudit({batchId:receipt.batchId,contractAddress:receipt.contractAddress,inspectionTx:receipt.inspectionTx});
    return reply(res,200,{ok:true,...scopedBuyerAuditResult(audit,receipt)});
  }
  if(req.method==='GET' && requestPath==='/api/proof/history'){
    // Only signed-in operators can enumerate ALL locally saved receipts.
    // A buyer link uses /buyer-receipt and /buyer-audit, each scoped to ONE clearance.
    const actor=operatorSessions.fromCookie(req.headers.cookie);
    if(!actor)return reply(res,401,{ok:false,error:'Sign in to view saved local receipts.'});
    // The vault command is a separate process. Read the archive from disk on
    // each request so its new receipts appear without restarting the API.
    // These are historical records, NOT a fresh chain-state verification.
    try {
      archive = readPublicEvidence(evidenceFile);
      return reply(res,200,{ok:true,records:archive.map(x=>({id:x.id,savedAt:x.savedAt,receipt:x.receipt}))});
    } catch {
      // Never include filesystem paths or internal parser exceptions in HTTP.
      return reply(res,503,{ok:false,error:'Saved local evidence is unavailable.'});
    }
  }
  if(req.method==='GET' && requestPath==='/api/proof/v2-audit'){
    // Full-session audit can enumerate buyer policies. Restricted to operators.
    if(!operatorSessions.fromCookie(req.headers.cookie))return reply(res,401,{ok:false,error:'Sign in to audit all buyer policies.'});
    const params=new URL(req.url,'http://127.0.0.1').searchParams;
    const request={batchId:params.get('batch')||'',contractAddress:params.get('contract')||'',inspectionTx:params.get('inspection')||''};
    // Browser receives only a public, read-only audit result. No wallet or vault access.
    const {runLocalV2BrowserAudit}=await import('./lot-v2-browser-audit.mjs');
    const result=await runLocalV2BrowserAudit(request);
    return reply(res,200,{ok:true,...result});
  }
  if(req.method==='GET' && requestPath==='/api/proof/v2-job')return reply(res,200,{ok:true,job:v2Runner.status()});
  if(req.method==='GET' && requestPath==='/api/proof/v2-session'){
    try{
      const batchId=validateV2UiBatch(new URL(req.url,'http://127.0.0.1').searchParams.get('batch'));
      let state=null;
      try{state=publicV2Session(sessionPublic(batchId));}catch(e){if(e?.code!=='ENOENT')return reply(res,503,{ok:false,error:'Saved session cannot be read.'});}
      return reply(res,200,{ok:true,session:state});
    }catch{return reply(res,400,{ok:false,error:'Invalid batch ID.'});}
  }
  if(req.method==='GET' && requestPath==='/api/proof/v2-sessions'){
    const actor=operatorSessions.fromCookie(req.headers.cookie);
    if(!actor)return reply(res,401,{ok:false,error:'Sign in to see your local signed batches.'});
    if(!['inspector','manufacturer'].includes(actor.role))return reply(res,403,{ok:false,error:'Operator access required.'});
    try{return reply(res,200,{ok:true,sessions:listPublicSessions()});}
    catch{return reply(res,503,{ok:false,error:'Saved V2 sessions cannot be listed safely.'});}
  }
  if(req.method==='GET' && requestPath==='/api/proof/v2-report/status'){
    const actor=operatorSessions.fromCookie(req.headers.cookie);
    if(!actor)return reply(res,401,{ok:false,error:'Sign in to inspect local report status.'});
    if(actor.role!=='inspector')return reply(res,403,{ok:false,error:'Inspector access required.'});
    try{
      const batchId=validateV2UiBatch(new URL(req.url,'http://127.0.0.1').searchParams.get('batch'));
      return reply(res,200,{ok:true,...localSignedReportStatus(batchId)});
    }catch{return reply(res,400,{ok:false,error:'Invalid report batch or local state.'});}
  }
  if(req.method==='GET' && requestPath==='/api/proof/auth/me'){
    const actor=operatorSessions.fromCookie(req.headers.cookie);
    return reply(res,200,{ok:true,authenticated:Boolean(actor),operator:actor});
  }
  if(req.method==='GET' && requestPath==='/api/proof/session')return reply(res,200,{ok:true,csrf});
  if(req.method!=='POST' || !['/api/proof/run','/api/proof/v2-session/run','/api/proof/v2-session/authorize','/api/proof/auth/login','/api/proof/auth/signup','/api/proof/auth/logout','/api/proof/onboarding/batches','/api/proof/onboarding/assign','/api/proof/onboarding/invitations','/api/proof/onboarding/connect','/api/proof/onboarding/decision','/api/proof/onboarding/sign','/api/proof/onboarding/prepare','/api/proof/onboarding/issue','/api/proof/v2-report/create'].includes(requestPath))return reply(res,404,{ok:false,error:'Not found'});
  // Same-origin, Host and CSRF checks on ALL state-changing endpoints.
  // This also rejects a foreign website attempting to use a local API proxy.
  const origin=req.headers.origin||'';
  if(!allowedLocalWrite({host:req.headers.host,origin,
      suppliedCsrf:req.headers['x-lot-csrf'],expectedCsrf:csrf,
      fetchSite:req.headers['sec-fetch-site']}) || req.headers['x-lot-csrf']!==csrf)
    return reply(res,403,{ok:false,error:'This demo only accepts requests from the local LOT interface.'});
  if(!String(req.headers['content-type']||'').startsWith('application/json'))
    return reply(res,415,{ok:false,error:'Expected JSON.'});
  if(requestPath==='/api/proof/auth/signup'){
    if(routeActor)return reply(res,409,{ok:false,error:'Sign out before creating another account.'});
    const now=Date.now();signupAttempts=signupAttempts.filter(t=>now-t<10*60*1000);
    if(signupAttempts.length>=8)return reply(res,429,{ok:false,error:'Too many signup attempts. Try again later.'});
    signupAttempts.push(now);
    try{let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>3000)throw Error('Check registration fields.');}
      const actor=registerOnboarded({file:onboarding,legacyFile:localOperators,input:JSON.parse(body),now,reservedNames});
      return reply(res,201,{ok:true,authenticated:true,operator:actor},{'set-cookie':operatorSessions.start(actor)});
    }catch(e){const safe=['Check registration fields.','Username unavailable.','Valid inspector invitation required.','Invalid or expired inspector invitation.','Manufacturer registration does not use invitations.','Local account limit reached.','Account store busy; retry later.'];return reply(res,400,{ok:false,error:safe.includes(e.message)?e.message:'Could not create account. Check username, password and registration fields.'});}
  }
  if(['/api/proof/onboarding/connect','/api/proof/onboarding/decision','/api/proof/onboarding/sign'].includes(requestPath)){
    if(routeActor?.role!=='inspector')return reply(res,403,{ok:false,error:'Inspector access required.'});
    try{let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1200)throw Error('Invalid inspection request.');}const input=JSON.parse(body);let result;
      if(requestPath.endsWith('/connect'))result=redeemInspectorInvitation(onboarding,routeActor,input);
      else if(requestPath.endsWith('/decision'))result=decideInspection(onboarding,routeActor,input);
      else {const {signInspectionV2}=await import('./lot-v2-signing.mjs');result=signAssignedInspection(onboarding,routeActor,input,signInspectionV2);}
      return reply(res,200,{ok:true,...result});
    }catch(e){const safe=['Invalid invitation.','Invalid or expired inspector invitation.','Already connected to this manufacturer.','Invalid inspection decision.','Inspection not found.','Inspection is not awaiting a decision.','Accept the inspection before signing.','Enter valid whole-number measurements.','Account store busy; retry later.'];return reply(res,400,{ok:false,error:safe.includes(e.message)?e.message:'Could not complete inspection action. Check local signing configuration.'});}
  }
  if(requestPath==='/api/proof/onboarding/issue'){
    if(routeActor?.role!=='manufacturer')return reply(res,403,{ok:false,error:'Manufacturer access required.'});
    try{let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2400)throw Error('Invalid clearance authorization.');}const result=issuer.start(routeActor,JSON.parse(body));return reply(res,202,{ok:true,...result});}
    catch(e){const safe=['Preprod issuance is not enabled for this account.','Another clearance is being issued.','Local issuance budget reached.','Invalid clearance authorization.','Too many authorization attempts.','Manufacturer password incorrect.','Signed batch or reviewed policy changed.','Existing issuance or failed attempt; reconcile before retrying.','Could not start issuance; check operator service.'];return reply(res,400,{ok:false,error:safe.includes(e.message)?e.message:'Could not start clearance issuance.'});}
  }
  if(requestPath==='/api/proof/onboarding/prepare'){
    if(routeActor?.role!=='manufacturer')return reply(res,403,{ok:false,error:'Manufacturer access required.'});
    try{let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1200)throw Error('Check policy fields.');}const input=JSON.parse(body);const row=issuer.decorate(routeActor,accountCatalog(onboarding,routeActor)).batches.find(b=>b.requestId===input.requestId);if(row&&!issuer.canPrepare(routeActor,row,input))return reply(res,409,{ok:false,error:'Existing issuance: policy is locked.'});return reply(res,200,{ok:true,...prepareClearance(onboarding,routeActor,input)});}
    catch(e){return reply(res,400,{ok:false,error:['Check policy fields.','Signed inspection not found.','Account store busy; retry later.'].includes(e.message)?e.message:'Could not prepare clearance.'});}
  }
  if(requestPath==='/api/proof/onboarding/invitations'){
    if(routeActor?.role!=='manufacturer')return reply(res,403,{ok:false,error:'Manufacturer access required.'});
    try{let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>128)throw Error('Invalid invitation request.');}
      const invitation=createInspectorInvitation(onboarding,routeActor,JSON.parse(body));return reply(res,201,{ok:true,...invitation});
    }catch(e){const safe=['Invalid invitation request.','Manufacturer access required.','Five active invitations allowed. Use an existing invitation or wait for expiry.','Invitation limit reached.','Account store busy; retry later.'];return reply(res,400,{ok:false,error:safe.includes(e.message)?e.message:'Could not create invitation.'});}
  }
  if(requestPath==='/api/proof/onboarding/batches'||requestPath==='/api/proof/onboarding/assign'){
    try{let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1200)throw Error('Check batch fields.');}const input=JSON.parse(body);const result=requestPath.endsWith('/assign')?assignBatchRequest(onboarding,routeActor,input):createBatchRequest(onboarding,routeActor,input);return reply(res,201,{ok:true,...result});}
    catch(e){const safe=['Manufacturer access required.','Check batch fields.','Check assignment.','Batch already exists.','Batch not found.','Inspector not available for this account.','Local batch limit reached.','Accepted or signed inspections cannot be reassigned.'];return reply(res,400,{ok:false,error:safe.includes(e.message)?e.message:'Could not save batch request.'});}
  }
  if(requestPath==='/api/proof/auth/login'){
    const now=Date.now();failedLogins=failedLogins.filter(t=>now-t<10*60*1000);
    if(failedLogins.length>=8)return reply(res,429,{ok:false,error:'Too many login attempts. Try again later.'});
    try{
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1600)throw new Error('Too large.');}
      const parsed=JSON.parse(body);
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).sort().join('|')!=='name|password')
        throw new Error('Invalid credentials.');
      const actor=hasOnboardedName(onboarding,parsed.name)?authenticateOnboarded({name:parsed.name,password:parsed.password,file:onboarding}):authenticateLocalOperator({name:parsed.name,password:parsed.password,file:localOperators});
      if(!actor){failedLogins.push(now);return reply(res,401,{ok:false,error:'Invalid username or password.'});}
      failedLogins=[];
      operatorSessions.revoke(req.headers.cookie);
      return reply(res,200,{ok:true,authenticated:true,operator:actor},{'set-cookie':operatorSessions.start(actor)});
    }catch(e){
      // No database paths, password bytes, or parser errors should reach the browser.
      if(e instanceof SyntaxError)return reply(res,400,{ok:false,error:'Invalid login request.'});
      if(e?.message==='Invalid credentials.'||e?.message==='Too large.')return reply(res,400,{ok:false,error:'Invalid login request.'});
      return reply(res,503,{ok:false,error:'Local operator store is unavailable.'});
    }
  }
  if(requestPath==='/api/proof/auth/logout'){
    operatorSessions.revoke(req.headers.cookie);
    return reply(res,200,{ok:true,authenticated:false},{'set-cookie':LOCAL_COOKIE});
  }
  // The UI and the legacy endpoints share the SAME server-enforced role boundary.
  // Role comes only from the HttpOnly cookie-backed server session, never JSON.
  const actor=operatorSessions.fromCookie(req.headers.cookie);
  if(!actor)return reply(res,401,{ok:false,error:'Sign in to LOT to authorize a proof.'});
  if(requestPath==='/api/proof/run'&&actor.role!==roleForAction(requestPath))
    return reply(res,403,{ok:false,error:'This operator cannot perform this action.'});
  if(job?.status==='running'||v2Runner.active())return reply(res,409,{ok:false,error:'A local proof is already running.'});
  if(requestPath==='/api/proof/v2-report/create'){
    if(actor.role!=='inspector')return reply(res,403,{ok:false,error:'Only a signed-in inspector can create a report.'});
    if(process.env.MIDNIGHT_NETWORK && process.env.MIDNIGHT_NETWORK!=='local')
      return reply(res,403,{ok:false,error:'This action is limited to the local development network.'});
    try{
      let body='';let bytes=0;
      for await(const chunk of req){bytes+=chunk.length;if(bytes>10_240)throw new Error('Request too large.');body+=chunk.toString('utf8');}
      const parsed=JSON.parse(body);
      const result=createSignedLocalReport(parsed);
      return reply(res,201,{ok:true,...result});
    }catch(e){
      // Never relay crypto errors, report values, passphrases, paths or keys.
      const msg=e?.message||'';
      if(msg.includes('already has local report data'))return reply(res,409,{ok:false,error:'A report already exists for this batch.'});
      if(msg.includes('key unlock failed'))return reply(res,401,{ok:false,error:'Inspector key authorization failed.'});
      if(msg.includes('Passphrase')||msg.includes('passphrase')||msg.includes('Invalid signed report')||msg.includes('must be')||msg.includes('basis points')||msg.includes('Strength')||msg.includes('Material')||msg.includes('rate')||msg.includes('Invalid batch'))
        return reply(res,400,{ok:false,error:'Check the report fields and passphrases.'});
      console.error('[LOT report] Local report creation failed:',e?.code||'validation');
      return reply(res,503,{ok:false,error:'Report could not be signed and saved. Check local inspector setup.'});
    }
  }
  if(requestPath==='/api/proof/v2-session/run'||requestPath==='/api/proof/v2-session/authorize'){
    if(process.env.MIDNIGHT_NETWORK && process.env.MIDNIGHT_NETWORK!=='local')return reply(res,403,{ok:false,error:'V2 sessions support the local development network only.'});
    try{
      // Authorization is never accepted on the public-input-only legacy route.
      // This endpoint is loopback-bound and deliberately NOT a hosted login API.
      const authorized=requestPath.endsWith('/authorize');
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>(authorized?2800:500))throw new Error('Request too large.');}
      const parsed=JSON.parse(body);
      const validated=authorized?validateV2AuthorizedRequest(parsed):{input:validateV2UiRequest(parsed),authorization:null};
      const {input,authorization}=validated;
      if(actor.role!==roleForAction(requestPath,input.mode))
        return reply(res,403,{ok:false,error:'This role is not authorized for the requested operation.'});
      let exists=false;try{sessionPublic(input.batchId);exists=true;}catch(e){if(e?.code!=='ENOENT')throw new Error('Cannot inspect saved session.');}
      if(input.mode==='init'&&exists)return reply(res,409,{ok:false,error:'A signed session already exists for this batch.'});
      if(input.mode==='prove'&&!exists)return reply(res,409,{ok:false,error:'Register the signed inspection before proving buyers.'});
      if(authorized){
        const now=Date.now();authStarts=authStarts.filter(t=>now-t<10*60*1000);
        if(authStarts.length>=12)return reply(res,429,{ok:false,error:'Too many local authorization attempts. Try again later.'});
        authStarts.push(now);
      }
      const started=v2Runner.start(input,authorization);return reply(res,202,{ok:true,job:started});
    }catch(e){return reply(res,400,{ok:false,error:e instanceof SyntaxError?'Invalid authorization request.':e instanceof Error?e.message:'Invalid V2 request.'});}
  }
  let body='';
  try{
    for await(const chunk of req){body+=chunk; if(body.length>2048)throw new Error('Request too large.');}
    const validated=validateLocalProofInput(JSON.parse(body));
    return reply(res,202,{ok:true,job:runProof(validated)});
  }catch(err){return reply(res,400,{ok:false,error:err instanceof Error?err.message:'Invalid proof request.'});}
});
server.listen(port,'127.0.0.1',()=>{
 console.log(`LOT local proof API: http://127.0.0.1:${port}`);
 console.log('Development only. Do not expose this API or point it at a public network.');
 console.log(`Saved public receipts: ${archive.length}. Private inspection values are not archived.`);
});
function stop(){if(child){child.kill('SIGTERM');}v2Runner.stop();server.close();}
process.on('SIGINT',stop);
process.on('SIGTERM',stop);
