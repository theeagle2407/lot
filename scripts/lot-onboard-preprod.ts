/** Build 40: locally authorized, sequential Preprod issuance for a signed onboarding report. */
import { mkdir, readFile, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { firstValueFrom, filter, timeout } from 'rxjs';
import { Option } from 'effect';
import { WebSocket } from 'ws';
import { mnemonicToSeedSync } from '@scure/bip39';
import { WalletSeeds, WalletFacade, ShieldedWallet, DustWallet, UnshieldedWallet, ProtocolVersion, DefaultForkSchedule, WalletTransaction, createKeystore, NoOpTransactionHistoryStorage, validateMnemonic } from '@midnightntwrk/wallet-sdk';
import { Transaction, ZswapSecretKeys, unshieldedToken, type FinalizedTransaction } from '@midnight-ntwrk/midnight-js-protocol/v9';
import { LedgerTransaction, createLedger9WalletProvider, createLedger9MidnightProvider, type Ledger9WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { jubjubSchnorrVerify, CompactTypeBytes, CompactTypeVector, persistentHash } from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../contracts/managed/lot-v2/contract/index.js';
import { v2Witnesses } from '../contracts/witnesses-v2.js';
import { waitForIndexedState } from './lot-indexer-wait.mjs';
import { operatorStorePath } from './lot-operator-access.mjs';
import { onboardingPath, authenticateOnboarded, accountCatalog, loadManufacturerInspection } from './lot-onboarding.mjs';
import { policyReceiptKey, validateAdditionalPolicy, inspectorFingerprint } from './lot-multi-policy.mjs';
import { readPublishedReceipt } from './lot-public-receipt-store.mjs';
import { signatureMessageType, reportSignatureFields } from './lot-v2-signing.mjs';
(globalThis as any).WebSocket = WebSocket;
process.umask(0o077);
const registeredAddress='mn_addr_preprod1mu8kr96p9s8xvt7lx2cutk0ucelwmfrfvd0hs7ndlwlsuzj4y5wqxgm0vg';
const networkId='preprod';
const [address,username,batch,approval]=process.argv.slice(2);
let record:any;
let step:string;
let phase='preflight';
let wallet: WalletFacade | undefined;
let journalDir: string | undefined;
let submittedId: string | undefined;
let knownContract: string | undefined;
let submitAttempted=false;
let checkpoint: string;
let lockFile: string | undefined;
let lockOwned=false;
let token='';
let phrase='';
let password='';
const json=(data:unknown)=>JSON.stringify(data,(_k,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
async function atomic(file:string,data:string){
 const tmp=`${file}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
 try{await writeFile(tmp,data,{mode:0o600,flag:'wx'});await rename(tmp,file);}finally{await unlink(tmp).catch(()=>{});}
}
async function saveCheckpoint(){
 if(!wallet)return;
 const [shielded,unshielded,dust]=await Promise.all([wallet.shielded.serializeState(),wallet.unshielded.serializeState(),wallet.dust.serializeState()]);
 if(![shielded,unshielded,dust].every(v=>typeof v==='string'&&v.length>0))throw new Error('Invalid checkpoint output');
 await atomic(checkpoint,json({version:1,network:networkId,address,sdk:'2.0.1',shielded,unshielded,dust}));
 console.log('Wallet checkpoint updated.');
}
function encryptedEnrollment(data:unknown, pass:string){
 const salt=randomBytes(32), iv=randomBytes(12);
 const key=scryptSync(pass,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 try{
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(`LOT_ONBOARD_PREPROD_V1:${record.requestId}:${address}`));
  const ciphertext=Buffer.concat([cipher.update(json(data),'utf8'),cipher.final()]);
  return json({version:1,kdf:'scrypt',N:32768,r:8,p:1,cipher:'aes-256-gcm',salt:salt.toString('hex'),iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')});
 }finally{key.fill(0);}
}
function safeError(e:unknown){
 let msg=e instanceof Error?e.message:typeof e==='string'?e:'SDK returned a non-Error object';
 for(const secret of [token,phrase,password])if(secret)msg=msg.split(secret).join('[REDACTED]');
 // SDK failures can embed transactions, signed bytes and private inputs. Do not dump them.
 return msg.replace(/project_id=[^\s&"']+/gi,'project_id=[REDACTED]').replace(/(?:0x)?[0-9a-f]{80,}/gi,'[REDACTED_BYTES]').slice(0,220);
}

async function persist(){await atomic(join(journalDir!,'status.json'),json(record));}
async function setStep(status:string, extra:Record<string,unknown>={}){
 record.steps[step]={status,updatedAt:new Date().toISOString(),submittedIdentifier:submittedId??null,...extra};
 record.contractAddress=knownContract??null;await persist();
}
function decryptEnrollment(raw:any,pass:string){
 if(raw.version!==1||raw.N!==32768||raw.r!==8||raw.p!==1||raw.cipher!=='aes-256-gcm')throw Error('Unsupported enrollment');
 const key=scryptSync(pass,Buffer.from(raw.salt,'hex'),32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 try{const d=createDecipheriv('aes-256-gcm',key,Buffer.from(raw.iv,'hex'));d.setAAD(Buffer.from(`LOT_ONBOARD_PREPROD_V1:${record.requestId}:${address}`));d.setAuthTag(Buffer.from(raw.tag,'hex'));return JSON.parse(Buffer.concat([d.update(Buffer.from(raw.ciphertext,'hex')),d.final()]).toString('utf8'));}finally{key.fill(0);}
}
// Compact Jubjub values consist of nested records of bigint fields. Stored JSON encodes bigint as decimal strings.
function revive(value:any):any{if(typeof value==='string'&&/^\d+$/.test(value))return BigInt(value);if(Array.isArray(value))return value.map(revive);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,revive(v)]));throw Error('Invalid stored signature or verification key');}
const hex=(b:Uint8Array)=>Buffer.from(b).toString('hex');
const bytes=(s:string)=>{if(!/^[a-f0-9]{64}$/.test(s))throw Error('Invalid 32-byte encoding');return new Uint8Array(Buffer.from(s,'hex'));};
const equal=(a:any,b:any)=>json(a)===json(b); // same Compact record shape
async function main(){
 if(address!==registeredAddress||!/^[a-z][a-z0-9_-]{2,31}$/.test(username??'')||!/^LOT-[A-Z0-9-]{1,48}$/.test(batch??'')||!['ISSUE','CHECK'].includes(approval))throw Error('Invalid invocation.');
 const browserApproval=process.env.LOT_BROWSER_APPROVAL;delete process.env.LOT_BROWSER_APPROVAL;
 const extraInput=process.env.LOT_ADDITIONAL_POLICY;delete process.env.LOT_ADDITIONAL_POLICY;
 const additional=extraInput?validateAdditionalPolicy(JSON.parse(extraInput)):null;
 password=process.env.LOT_ACCOUNT_PASSWORD??'';phrase=process.env.WALLET_MNEMONIC?.trim().toLowerCase().replace(/\s+/g,' ')??'';token=process.env.BLOCKFROST_PROJECT_ID?.trim()??'';
 for(const k of ['LOT_ACCOUNT_PASSWORD','WALLET_MNEMONIC','BLOCKFROST_PROJECT_ID'])delete process.env[k];
 const file=onboardingPath(operatorStorePath(fileURLToPath(new URL('..',import.meta.url))));
 const actor=authenticateOnboarded({file,name:username,password});if(!actor||actor.role!=='manufacturer')throw Error('Manufacturer login failed.');
 const entry=accountCatalog(file,actor).batches.find(b=>b.id===batch);if(!entry||entry.status!=='signed'||(!additional&&!entry.preparedPolicy?.eligible))throw Error('Signed batch with eligible prepared policy required.');
 const report=loadManufacturerInspection(file,actor,entry.requestId);
 const policy=additional??entry.preparedPolicy;
 if(report.requestId!==entry.requestId||report.batchId!==batch||report.inspector!==entry.inspector||!Number.isSafeInteger(report.strength)||!Number.isSafeInteger(report.defectBps)||report.strength<policy.minStrength||report.defectBps>policy.maxDefectsBps)throw Error('Report or policy mismatch.');
 const strength=BigInt(report.strength),defect=BigInt(report.defectBps),salt=bytes(report.openingSalt),batchId=bytes(entry.requestId);
 const inspectorKey=revive(report.inspectorPublicKey),signature=revive(report.signature);
 if(!jubjubSchnorrVerify(signatureMessageType,reportSignatureFields(batchId,strength,defect,salt),inspectorKey,signature))throw Error('Original saved inspector signature is invalid.');
 const min=BigInt(policy.minStrength),max=BigInt(policy.maxDefectsBps);
 const policyId=new Uint8Array(createHash('sha256').update('LOT_BUYER_POLICY_V1:'+policy.policyId).digest());
 const clearanceKey=persistentHash(new CompactTypeVector(2,new CompactTypeBytes(32)),[batchId,policyId]);
 const binding={requestId:entry.requestId,batchId:batch,policyId:policy.policyId,minStrength:policy.minStrength,maxDefectsBps:policy.maxDefectsBps,policyKey:hex(policyId),clearanceKey:hex(clearanceKey),inspector:entry.inspector,reportFingerprint:createHash('sha256').update(json(report)).digest('hex')};
 console.log('Original inspector signature verified; prepared policy eligible. Private measurements not printed.');
 console.log('Batch:',batch,'Policy:',policy.policyId,'Minimum strength:',policy.minStrength,'Maximum defects (bps):',policy.maxDefectsBps);
 if(approval==='CHECK'){console.log('PASS: stored report and original Midnight signature verified. No transaction made.');return;}
 if(browserApproval){const approved=JSON.parse(browserApproval);if(!equal(approved,{requestId:entry.requestId,policyId:policy.policyId,minStrength:policy.minStrength,maxDefectsBps:policy.maxDefectsBps}))throw Error('Reviewed policy changed. No submission.');}
 else if(!additional&&(policy.policyId!=='B-02'||policy.minStrength!==550||policy.maxDefectsBps!==100))throw Error('Prepared policy differs from the specifically authorized B-02 (550 MPa, 100 bps). No submission.');
 if(!validateMnemonic(phrase)||phrase.split(' ').length!==24||!password||!/^[A-Za-z0-9_-]{16,256}$/.test(token))throw Error('Required wallet credentials invalid.');
 const seeds=WalletSeeds.fromMasterSeed(Buffer.from(mnemonicToSeedSync(phrase)));
 const signingKey=createKeystore({kind:'schnorr',secret:seeds.unshielded},networkId);
 if(String(signingKey.getBech32Address())!==address)throw new Error('Recovery phrase does not match registered wallet.');
 const cacheDir=join(homedir(),'.lot','preprod','wallet-sync-ledger9');
 checkpoint=join(cacheDir,`${address}.json`);
 const snap=JSON.parse(await readFile(checkpoint,'utf8'));
 if(snap.version!==1||snap.network!==networkId||snap.address!==address||snap.sdk!=='2.0.1'||!['shielded','unshielded','dust'].every(k=>typeof snap[k]==='string'&&snap[k].length>0))throw new Error('Checkpoint invalid; preserved without fallback replay.');
 // Do not allow concurrent Build 31 deployments using the same fee-paying wallet.
 lockFile=join(cacheDir,`${address}.deploy.lock`);
 await writeFile(lockFile,String(process.pid)+'\n',{mode:0o600,flag:'wx'});lockOwned=true;

 const root=join(homedir(),'.lot','preprod','onboarding-v1');await mkdir(root,{recursive:true,mode:0o700});
 const primaryDir=join(root,entry.requestId);
 const receiptKey=additional?policyReceiptKey(entry.requestId,policy.policyId):entry.requestId;
 const dir=join(root,receiptKey);let enrollment:any;let primary:any=null;
 if(additional){
  primary=JSON.parse(await readFile(join(primaryDir,'status.json'),'utf8'));
  const original=readPublishedReceipt(root,entry.requestId).target;
  if(primary.network!==networkId||primary.walletAddress!==address||primary.requestId!==entry.requestId||primary.binding?.reportFingerprint!==binding.reportFingerprint||primary.binding?.inspector!==binding.inspector||primary.contractAddress!==original.contractAddress||primary.binding.policyId!==original.policyId||primary.binding.policyKey!==original.policyKey||primary.binding.clearanceKey!==original.clearanceKey||primary.binding.minStrength!==original.minStrength||primary.binding.maxDefectsBps!==original.maxDefectsBps||policy.policyId===original.policyId)throw Error('Primary report or policy mismatch; no additional issuance.');
  for(const n of ['deploy','inspection','policy','clearance'])if(!['confirmed','confirmed-by-ledger'].includes(primary.steps?.[n]?.status))throw Error('Primary issuance not confirmed.');
 }
 // Wallet lock is acquired above, shared with Builds 31–33. Existing records are never overwritten with another policy/report.
 try{record=JSON.parse(await readFile(join(dir,'status.json'),'utf8'));}catch(e:any){if(e.code!=='ENOENT')throw e;record=null;}
 if(record){
  if(record.network!==networkId||record.walletAddress!==address||!equal(record.binding,binding)||record.requestId!==entry.requestId||(additional&&(record.receiptKey!==receiptKey||record.contractAddress!==primary.contractAddress||record.inspectorFingerprint!==inspectorFingerprint(inspectorKey))))throw Error('Existing issuance belongs to another report or policy. Stop for reconciliation.');
  journalDir=dir;knownContract=record.contractAddress??undefined;
  if(knownContract&&!/^[a-f0-9]{64}$/.test(knownContract))throw Error('Invalid contract address in journal');
  if(!knownContract&&record.steps.deploy&&record.steps.deploy.status!=='preparing')throw Error('Deployment outcome unknown; do not redeploy. Reconcile manually.');
  enrollment=decryptEnrollment(JSON.parse(await readFile(join(additional?primaryDir:dir,'enrollment.enc.json'),'utf8')),password);
 }else{
  // Directory creation is exclusive; an incomplete enrollment must be investigated, not recreated.
  await mkdir(dir,{mode:0o700});journalDir=dir;
  record={schema:1,network:networkId,walletAddress:address,requestId:entry.requestId,binding,contractAddress:null,steps:{}};
  if(additional){
   knownContract=primary.contractAddress;
   record.contractAddress=knownContract;record.receiptKey=receiptKey;record.inspectorFingerprint=inspectorFingerprint(inspectorKey);
   record.steps={deploy:primary.steps.deploy,inspection:primary.steps.inspection};
   enrollment=decryptEnrollment(JSON.parse(await readFile(join(primaryDir,'enrollment.enc.json'),'utf8')),password);
   await persist();
  }else{
  enrollment={adminSecret:randomBytes(32).toString('hex'),storagePassword:'Lot40!'+randomBytes(32).toString('hex'),storeName:'lot-onboard-preprod-'+entry.requestId,privateStateId:'LOT_ONBOARD_'+entry.requestId};
  await atomic(join(dir,'enrollment.enc.json'),encryptedEnrollment(enrollment,password));await persist();
  }
 }
 const adminSecret=bytes(enrollment.adminSecret),{storagePassword,storeName,privateStateId}=enrollment;
 if(storeName!=='lot-onboard-preprod-'+entry.requestId||privateStateId!=='LOT_ONBOARD_'+entry.requestId||!/^Lot40![a-f0-9]{64}$/.test(storagePassword))throw Error('Invalid enrollment');
 const assets=fileURLToPath(new URL('../contracts/managed/lot-v2',import.meta.url));
 const compiled=CompiledContract.make('LotContractV2',Contract).pipe(CompiledContract.withWitnesses(v2Witnesses),CompiledContract.withCompiledFileAssets(assets));
 const keyUrl=(url:string)=>`${url}?project_id=${encodeURIComponent(token)}`;
 const indexer=keyUrl('https://midnight-preprod.blockfrost.io/api/v0');
 const indexerWS=keyUrl('wss://midnight-preprod.blockfrost.io/api/v0/ws');
 const relay=keyUrl('wss://rpc.midnight-preprod.blockfrost.io');
 const proofServer='http://127.0.0.1:6300';
 phase='restore wallet';
 for(let attempt=1;attempt<=3;attempt++){
  let response:Response|undefined;
  let reason='';
  try{
   response=await fetch(indexer,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'query LotHealth { __typename }'}),signal:AbortSignal.timeout(20000),redirect:'error'});
  }catch(err){
   const e=err as {name?:string,cause?:{code?:string}};
   const code=e?.cause?.code??e?.name??'NETWORK_ERROR';
   reason=/^[A-Za-z0-9_]{1,50}$/.test(code)?code:'NETWORK_ERROR';
  }
  if(response){
   console.log(`Indexer HTTP attempt ${attempt}: ${response.status}`);
   if(response.ok){
    let data:any;
    try{data=await response.json();}catch{throw new Error('Indexer returned invalid JSON; no submission');}
    if(!data?.data?.__typename)throw new Error('Indexer GraphQL health response missing expected field; no submission');
    console.log('Preprod indexer HTTP: OK');break;
   }
   if(response.status!==429&&response.status!==408&&response.status<500)throw new Error(`Indexer HTTP ${response.status}; check project token or endpoint; no submission`);
   reason=`HTTP_${response.status}`;
  }else console.log(`Indexer HTTP attempt ${attempt}: ${reason}`);
  if(attempt===3)throw new Error(`Indexer unavailable after 3 read-only attempts (${reason}); no submission`);
  await new Promise<void>(resolve=>setTimeout(resolve,attempt*2000));
 }
 wallet=await WalletFacade.init({configuration:{networkId,indexerClientConnection:{indexerHttpUrl:indexer,indexerWsUrl:indexerWS},provingServerUrl:new URL(proofServer),relayURL:new URL(relay),txHistoryStorage:new NoOpTransactionHistoryStorage(),costParameters:{additionalFeeOverhead:300_000_000_000_000n,feeBlocksMargin:5}},shielded:cfg=>ShieldedWallet(cfg).restore(snap.shielded),unshielded:cfg=>UnshieldedWallet(cfg).restore(snap.unshielded),dust:cfg=>DustWallet({...cfg,dustTimelineStartProbe:async()=>Option.some({cursor:1857961n,version:ProtocolVersion.ProtocolVersion(2001100n)}),batchUpdates:{size:500,timeout:200,spacing:0}}).restore(snap.dust)});
 await wallet.start(seeds);
 console.log('Existing Ledger 9 checkpoint restored; checking for new chain events.');
 const synced=await firstValueFrom(wallet.state().pipe(filter(s=>s.isSynced&&s.protocol?._tag==='Settled'),timeout({first:180000})));
 if(synced.dust.balance(new Date())<=0n||!synced.unshielded.availableCoins.some(c=>c.meta?.registeredForDustGeneration===true))throw new Error('Registered wallet has no verified spendable DUST.');
 console.log('Wallet settled. Spendable DUST (SPECK):',synced.dust.balance(new Date()).toString());
 console.log('Available NIGHT (STAR):',(synced.unshielded.balances[unshieldedToken().raw]??0n).toString());
 await saveCheckpoint();
 const w=wallet;
 const zswap=ZswapSecretKeys.fromSeed(seeds.shielded);
 const active=async()=> (await firstValueFrom(w.state())).activeProtocolVersion;
 const adapter:Ledger9WalletProvider={
  getCoinPublicKey:()=>zswap.coinPublicKey,
  getEncryptionPublicKey:()=>zswap.encryptionPublicKey,
  async balanceTx(handle,ttl=new Date(Date.now()+3600000)){
   if(handle.era!=='v9')throw new Error('Only Ledger 9 is supported');
   const tx=Transaction.deserialize('signature','proof','pre-binding',handle.serialize());
   const version=await active();
   const recipe=await w.balanceUnboundTransaction(WalletTransaction.adopt('Unbound',tx,version),{ttl});
   const signed=await w.signRecipe(recipe,payload=>signingKey.signDataAsync(payload));
   const finalized=await w.finalizeRecipe(signed);
   const result=WalletTransaction.unwrapWithin<FinalizedTransaction>(finalized,ProtocolVersion.epochOf(version,DefaultForkSchedule.v9));
   if(result._tag==='Left')throw result.left;
   return result.right;
  },
 };
 const zkConfigProvider=new NodeZkConfigProvider(assets);
 const publicDataProvider=indexerPublicDataProvider(indexer,indexerWS);
 const providers={privateStateProvider:levelPrivateStateProvider({privateStateStoreName:storeName,signingKeyStoreName:storeName+'-signing',privateStoragePasswordProvider:()=>storagePassword,accountId:adapter.getCoinPublicKey()}),publicDataProvider,zkConfigProvider,proofProvider:httpClientProofProvider(proofServer,zkConfigProvider),walletProvider:createLedger9WalletProvider(adapter),midnightProvider:createLedger9MidnightProvider(async tx=>{
  if(submitAttempted)throw new Error('One submission attempt per stage; refusing duplicate');
  const finalized=LedgerTransaction.isLedgerTransaction(tx)?Transaction.deserialize('signature','proof','binding',tx.serialize()):tx;
  await setStep('submission-attempted');submitAttempted=true;
  const identifier=await w.submitTransaction(WalletTransaction.adopt('Finalized',finalized,await active()));
  submittedId=String(identifier);await setStep('submitted-awaiting-confirmation');
  console.log('Submission identifier:',submittedId);return identifier;
 }),config:{networkId,ttlSeconds:3600}};

 const readLedger=async()=>{if(!knownContract)return null;const r=await publicDataProvider.queryContractState(knownContract);if(!r||r.contractState.era!=='v9')return null;return ledger(r.contractState.deserialize({v9:ContractState}).data);};
 const waitLedger=(predicate:any,label:string)=>waitForIndexedState(readLedger,predicate,{label,timeoutMs:120000,pollMs:1500});
 const adminDomain=new Uint8Array(32);adminDomain.set(Buffer.from('LOT_POLICY_ADMIN_V2'));
 const adminHash=persistentHash(new CompactTypeVector(2,new CompactTypeBytes(32)),[adminDomain,adminSecret]);
 const verifyKey=(st:any)=>hex(st.policyAdminKeyHash)===hex(adminHash)&&inspectorFingerprint(st.inspectorVerificationKey)===inspectorFingerprint(inspectorKey)&&jubjubSchnorrVerify(signatureMessageType,reportSignatureFields(batchId,strength,defect,salt),st.inspectorVerificationKey,signature);
 async function refreshWallet(){await firstValueFrom(w.state().pipe(filter(s=>s.isSynced&&s.protocol?._tag==='Settled'),timeout({first:60000})));await saveCheckpoint();}
 if(additional&&!knownContract)throw Error('No primary contract. Additional policies never deploy.');
 if(!knownContract){
  step='deploy';phase='deploy contract';submitAttempted=false;submittedId=undefined;await setStep('preparing');
  const deployed=await deployContract(providers,{compiledContract:compiled,privateStateId,initialPrivateState:{},args:[inspectorKey,adminSecret]});
  knownContract=String(deployed.deployTxData.public.contractAddress);
  if(!/^[a-f0-9]{64}$/.test(knownContract))throw Error('Invalid deployment address');
  await setStep('returned-awaiting-indexer',{txId:(deployed.deployTxData.public as any).txId??null});
  console.log('New contract:',knownContract);await waitLedger(verifyKey,'new enrolled inspector key');await setStep('confirmed',{txId:(deployed.deployTxData.public as any).txId??null});await refreshWallet();
 }
 let current=await waitLedger(verifyKey,'enrolled inspector key');
 if(record.steps.deploy?.status!=='confirmed'){step='deploy';submittedId=record.steps.deploy?.submittedIdentifier??undefined;await setStep('confirmed-by-ledger',{txId:record.steps.deploy?.txId??null});}
 const inspected=(st:any)=>verifyKey(st)&&st.inspections.member(batchId);
 if(additional){
  const oldPolicy=bytes(primary.binding.policyKey),oldClearance=bytes(primary.binding.clearanceKey);
  if(!inspected(current)||!current.minimumStrength.member(oldPolicy)||!current.maximumDefectsBps.member(oldPolicy)||current.minimumStrength.lookup(oldPolicy)!==BigInt(primary.binding.minStrength)||current.maximumDefectsBps.lookup(oldPolicy)!==BigInt(primary.binding.maxDefectsBps)||!current.clearances.member(oldClearance)||current.clearances.lookup(oldClearance)!==true)throw Error('Original clearance not present on ledger; no additional submission.');
 }
 const policyMatches=(st:any)=>inspected(st)&&st.minimumStrength.member(policyId)&&st.maximumDefectsBps.member(policyId)&&st.minimumStrength.lookup(policyId)===min&&st.maximumDefectsBps.lookup(policyId)===max;
 const cleared=(st:any)=>policyMatches(st)&&st.clearances.member(clearanceKey)&&st.clearances.lookup(clearanceKey)===true;
 async function call(name:string,circuitId:string,args:any[],predicate:any,privateState:any){
  step=name;phase='read '+name;current=await waitLedger(verifyKey,'contract ledger');
  const prior=record.steps[name];submittedId=prior?.submittedIdentifier??undefined;
  if(predicate(current)){await setStep(prior?.status==='confirmed'?'confirmed':'confirmed-by-ledger',{txId:prior?.txId??null});console.log(name+': confirmed on public ledger');return;}
  if(prior&&prior.status!=='preparing')throw Error(name+' has an earlier incomplete attempt; reconcile before retrying.');
  if(name==='policy'&&(current.minimumStrength.member(policyId)||current.maximumDefectsBps.member(policyId)))throw Error('Existing policy mismatch.');
  if(name==='clearance'&&!policyMatches(current))throw Error('Inspection or policy not confirmed.');
  if(name==='policy'&&!inspected(current))throw Error('Inspection not confirmed.');
  await providers.privateStateProvider.forContract(knownContract!).set(privateStateId,privateState);
  submitAttempted=false;submittedId=undefined;phase='submit '+name;await setStep('preparing');
  console.log('Building and proving:',circuitId);
  const tx=await submitCallTx(providers,{compiledContract:compiled,contractAddress:knownContract!,privateStateId,circuitId,args} as never);
  await setStep('returned-awaiting-indexer',{txId:tx.public.txId??null});
  current=await waitLedger(predicate,name+' public ledger effect');await setStep('confirmed',{txId:tx.public.txId??null});console.log(name+': confirmed on public ledger');if(name!=='clearance')await refreshWallet();
 }
 if(!additional)await call('inspection','registerInspectionSigned',[batchId,strength,defect,salt,signature],inspected,{});
 else console.log('Existing signed inspection reused. No redeployment or re-registration.');
 await call('policy','registerPolicy',[policyId,min,max],policyMatches,{policyAdminSecret:adminSecret});
 await call('clearance','proveClearance',[batchId,policyId,strength,defect,salt],cleared,{});
 phase='final ledger check';await waitLedger(cleared,'exact batch-policy clearance');
 const receipt={schema:1,network:networkId,batchId:batch,batchKey:entry.requestId,...(additional?{receiptKey,inspectorFingerprint:inspectorFingerprint(inspectorKey)}:{}),policyId:policy.policyId,policyKey:hex(policyId),clearanceKey:hex(clearanceKey),minStrength:policy.minStrength,maxDefectsBps:policy.maxDefectsBps,contractAddress:knownContract,verifiedAt:new Date().toISOString(),steps:record.steps};
 await atomic(join(dir,'public-receipt.json'),json(receipt));
 console.log('=== ONBOARDED LOT PREPROD CLEARANCE CONFIRMED ===');console.log(json(receipt));console.log('Public receipt:',join(dir,'public-receipt.json'));
 try{await refreshWallet();}catch{console.warn('Receipt published. Wallet checkpoint refresh incomplete; next run must synchronize.');}
}
try{await main();}catch(e){console.error('LOT Build 40 stopped at:',phase);if(phase.startsWith('submit ')||phase==='deploy contract')console.error('Submission may have occurred. Journal preserved. Do not redeploy or delete records.');else console.error(safeError(e));if(knownContract)console.error('Contract:',knownContract);if(submittedId)console.error('Submission identifier:',submittedId);process.exitCode=1;}finally{if(wallet)try{await wallet.stop();}catch{console.warn('Wallet cleanup incomplete.');}if(lockOwned&&lockFile)await unlink(lockFile).catch(()=>{});}
