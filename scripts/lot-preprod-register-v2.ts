/** Build 32: one authorized call on the existing Preprod contract. No redeployment. */
import { mkdir, readFile, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, createDecipheriv, createHash } from 'node:crypto';
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
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { jubjubSchnorrVerify } from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../contracts/managed/lot-v2/contract/index.js';
import { v2Witnesses } from '../contracts/witnesses-v2.js';
import { loadEncryptedReport } from './lot-private-vault.mjs';
import { verifySavedAttestation } from './lot-inspector-attestation.mjs';
import { signInspectionV2, signatureMessageType, reportSignatureFields } from './lot-v2-signing.mjs';
import { sessionReportDigest } from './lot-v2-session-store.mjs';
import { waitForIndexedState } from './lot-indexer-wait.mjs';
(globalThis as any).WebSocket = WebSocket;
process.umask(0o077);
const registeredAddress='mn_addr_preprod1mu8kr96p9s8xvt7lx2cutk0ucelwmfrfvd0hs7ndlwlsuzj4y5wqxgm0vg';
const networkId='preprod';
const [address,batch,action,approval,policyLabel,minText,maxText]=process.argv.slice(2);
const digestId=(domain:string,label:string)=>new Uint8Array(createHash('sha256').update(domain).update(':').update(label).digest());
let actionDir:string;
let publicFields:Record<string,unknown>={};
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
async function journal(status:string, extra:Record<string,unknown>={}){
 if(!journalDir)throw new Error('No deployment record directory');
 await atomic(join(journalDir,'status.json'),json({schema:1,network:networkId,batchId:batch,walletAddress:address,action,...publicFields,status,updatedAt:new Date().toISOString(),submittedIdentifier:submittedId??null,contractAddress:knownContract??null,...extra}));
}
async function saveCheckpoint(){
 if(!wallet)return;
 const [shielded,unshielded,dust]=await Promise.all([wallet.shielded.serializeState(),wallet.unshielded.serializeState(),wallet.dust.serializeState()]);
 if(![shielded,unshielded,dust].every(v=>typeof v==='string'&&v.length>0))throw new Error('Invalid checkpoint output');
 await atomic(checkpoint,json({version:1,network:networkId,address,sdk:'2.0.1',shielded,unshielded,dust}));
 console.log('Wallet checkpoint updated.');
}
function decryptEnrollment(raw:any,pass:string){
 if(raw.version!==1||raw.kdf!=='scrypt'||raw.N!==32768||raw.r!==8||raw.p!==1||raw.cipher!=='aes-256-gcm')throw new Error('Unsupported enrollment format');
 for(const [name,len] of [['salt',64],['iv',24],['tag',32]] as const){if(typeof raw[name]!=='string'||raw[name].length!==len||!/^[0-9a-f]+$/i.test(raw[name]))throw new Error('Invalid enrollment encoding');}
 if(typeof raw.ciphertext!=='string'||raw.ciphertext.length>100000||!/^([0-9a-f]{2})+$/i.test(raw.ciphertext))throw new Error('Invalid enrollment ciphertext');
 const key=scryptSync(pass,Buffer.from(raw.salt,'hex'),32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
 try{
  const d=createDecipheriv('aes-256-gcm',key,Buffer.from(raw.iv,'hex'));
  d.setAAD(Buffer.from(`LOT_PREPROD_V2:${batch}:${address}`));d.setAuthTag(Buffer.from(raw.tag,'hex'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(raw.ciphertext,'hex')),d.final()]).toString('utf8'));
 }finally{key.fill(0);}
}
function safeError(e:unknown){
 let msg=e instanceof Error?e.message:typeof e==='string'?e:'SDK returned a non-Error object';
 for(const secret of [token,phrase,password])if(secret)msg=msg.split(secret).join('[REDACTED]');
 // SDK failures can embed transactions, signed bytes and private inputs. Do not dump them.
 return msg.replace(/project_id=[^\s&"']+/gi,'project_id=[REDACTED]').replace(/(?:0x)?[0-9a-f]{80,}/gi,'[REDACTED_BYTES]').slice(0,220);
}
async function main(){
 if(address!==registeredAddress||!/^LOT-[A-Z0-9-]{1,48}$/.test(batch??'')||!['inspection','policy'].includes(action)||approval!=='REGISTER')throw new Error('Invalid network, wallet, batch, action or authorization.');
 if(action==='policy'&&(!/^[A-Z0-9][A-Z0-9-]{0,47}$/.test(policyLabel??'')||!/^\d{1,20}$/.test(minText??'')||!/^\d{1,5}$/.test(maxText??'')||BigInt(minText)<=0n||BigInt(minText)>18446744073709551615n||BigInt(maxText)>10000n))throw new Error('Invalid policy ID or thresholds');
 phrase=process.env.WALLET_MNEMONIC?.trim().toLowerCase().replace(/\s+/g,' ')??'';
 token=process.env.BLOCKFROST_PROJECT_ID?.trim()??'';
 password=process.env.LOT_VAULT_PASSWORD??'';
 for(const k of ['WALLET_MNEMONIC','BLOCKFROST_PROJECT_ID','LOT_VAULT_PASSWORD','LOT_INSPECTOR_PASSWORD'])delete process.env[k];
 if(!validateMnemonic(phrase)||phrase.split(' ').length!==24||!password||!/^[A-Za-z0-9_-]{16,256}$/.test(token))throw new Error('Required credentials missing or invalid.');
 const seeds=WalletSeeds.fromMasterSeed(Buffer.from(mnemonicToSeedSync(phrase)));
 const signingKey=createKeystore({kind:'schnorr',secret:seeds.unshielded},networkId);
 if(String(signingKey.getBech32Address())!==address)throw new Error('Recovery phrase does not match registered wallet.');
 const cacheDir=join(homedir(),'.lot','preprod','wallet-sync-ledger9');
 checkpoint=join(cacheDir,`${address}.json`);
 const snap=JSON.parse(await readFile(checkpoint,'utf8'));
 if(snap.version!==1||snap.network!==networkId||snap.address!==address||snap.sdk!=='2.0.1'||!['shielded','unshielded','dust'].every(k=>typeof snap[k]==='string'&&snap[k].length>0))throw new Error('Checkpoint invalid; preserved without fallback replay.');
 // Share the existing Build 31 wallet lock to prevent concurrent writes.
 lockFile=join(cacheDir,`${address}.deploy.lock`);
 await writeFile(lockFile,String(process.pid)+'\n',{mode:0o600,flag:'wx'});lockOwned=true;
 const root=join(homedir(),'.lot','preprod','deployments-v2');
 const dir=join(root,batch);
 phase='verify existing enrollment';
 const status=JSON.parse(await readFile(join(dir,'status.json'),'utf8'));
 if(status.schema!==1||status.network!==networkId||status.batchId!==batch||status.walletAddress!==address||status.status!=='confirmed'||status.indexedLedger!==true||! /^[0-9a-f]{64}$/i.test(status.contractAddress))throw new Error('No confirmed Build 31 deployment for this batch');
 knownContract=status.contractAddress;
 const e=decryptEnrollment(JSON.parse(await readFile(join(dir,'enrollment.enc.json'),'utf8')),password);
 if(e.schema!==1||e.network!==networkId||e.batchId!==batch||e.walletAddress!==address||!/^([0-9a-f]{2}){32}$/i.test(e.policyAdminSecret)||!/^\d+$/.test(e.inspectorScalar)||!/^LOT_PREPROD_V2_[A-Z0-9-]+$/.test(e.privateStateId)||!/^lot-preprod-v2-[A-Z0-9-]+-[0-9a-f]{16}$/.test(e.storeName)||!/^Lot31![0-9a-f]{64}$/.test(e.storagePassword))throw new Error('Enrollment does not match this deployment');
 const report=loadEncryptedReport(batch,password);
 if(report.batchId!==batch||e.reportDigest!==sessionReportDigest(report))throw new Error('Report differs from enrolled report');
 verifySavedAttestation(report);
 const strength=BigInt(report.strengthMpa),defect=BigInt(report.defectBps);
 if(strength<=0n||strength>18446744073709551615n||defect<0n||defect>10000n||!/^([0-9a-f]{2}){32}$/i.test(report.openingSalt))throw new Error('Invalid enrolled report values');
 const salt=new Uint8Array(Buffer.from(report.openingSalt,'hex'));
 const batchId=digestId('LOT_BATCH_V1',batch);
 const policyId=action==='policy'?digestId('LOT_BUYER_POLICY_V1',policyLabel):null;
 const adminSecret=new Uint8Array(Buffer.from(e.policyAdminSecret,'hex'));
 const {privateStateId,storeName,storagePassword}=e;
 const actions=join(dir,'actions');await mkdir(actions,{recursive:true,mode:0o700});
 actionDir=join(actions,action==='inspection'?'inspection':`policy-${Buffer.from(policyId!).toString('hex')}`);
 try{await readFile(join(actionDir,'status.json'));throw new Error('Action already has a submission record; reconcile before any retry');}catch(err:any){if(err?.code!=='ENOENT')throw err;}
 publicFields=action==='inspection'?{batchKey:Buffer.from(batchId).toString('hex')}:{policyId:policyLabel,policyKey:Buffer.from(policyId!).toString('hex'),minStrength:minText,maxDefectsBps:maxText};
 console.log('Confirmed deployment record:',knownContract);
 console.log('Existing encrypted enrollment and report attestation verified.');
 const assets=fileURLToPath(new URL('../contracts/managed/lot-v2',import.meta.url));
 const compiled=CompiledContract.make('LotContractV2',Contract).pipe(CompiledContract.withWitnesses(v2Witnesses),CompiledContract.withCompiledFileAssets(assets));
 const keyUrl=(url:string)=>`${url}?project_id=${encodeURIComponent(token)}`;
 const indexer=keyUrl('https://midnight-preprod.blockfrost.io/api/v0');
 const indexerWS=keyUrl('wss://midnight-preprod.blockfrost.io/api/v0/ws');
 const relay=keyUrl('wss://rpc.midnight-preprod.blockfrost.io');
 const proofServer='http://127.0.0.1:6300';
 phase='indexer HTTP preflight';
 // Retry only this non-mutating health query. Never retry transaction submission.
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
 phase='initialize wallet from existing checkpoint';
 wallet=await WalletFacade.init({configuration:{networkId,indexerClientConnection:{indexerHttpUrl:indexer,indexerWsUrl:indexerWS},provingServerUrl:new URL(proofServer),relayURL:new URL(relay),txHistoryStorage:new NoOpTransactionHistoryStorage(),costParameters:{additionalFeeOverhead:300_000_000_000_000n,feeBlocksMargin:5}},shielded:cfg=>ShieldedWallet(cfg).restore(snap.shielded),unshielded:cfg=>UnshieldedWallet(cfg).restore(snap.unshielded),dust:cfg=>DustWallet({...cfg,dustTimelineStartProbe:async()=>Option.some({cursor:1857961n,version:ProtocolVersion.ProtocolVersion(2001100n)}),batchUpdates:{size:500,timeout:200,spacing:0}}).restore(snap.dust)});
 phase='start restored wallet';
 await wallet.start(seeds);
 console.log('Existing Ledger 9 checkpoint restored; checking for new chain events.');
 phase='wait for wallet settlement';
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
  if(submitAttempted)throw new Error('One submission attempt per run; refusing duplicate');
  const finalized=LedgerTransaction.isLedgerTransaction(tx)?Transaction.deserialize('signature','proof','binding',tx.serialize()):tx;
  await mkdir(actionDir,{mode:0o700});journalDir=actionDir;
  await journal('submission-attempted');submitAttempted=true;
  const identifier=await w.submitTransaction(WalletTransaction.adopt('Finalized',finalized,await active()));
  submittedId=String(identifier);await journal('submitted-awaiting-confirmation');
  console.log('Submission identifier:',submittedId);return identifier;
 }),config:{networkId,ttlSeconds:3600}};
 phase='check existing public ledger';
 const readLedger=async()=>{const read=await publicDataProvider.queryContractState(knownContract!);if(!read||read.contractState.era!=='v9')return null;return ledger(read.contractState.deserialize({v9:ContractState}).data);};
 const current=await waitForIndexedState(readLedger,()=>true,{label:'existing LOT V2 ledger',timeoutMs:45000,pollMs:1500});
 let args:unknown[],circuitId:'registerInspectionSigned'|'registerPolicy';
 let verified:(state:any)=>boolean;
 if(action==='inspection'){
  if(current.inspections.member(batchId))throw new Error('Inspection already exists on-chain; no submission');
  const signed=signInspectionV2(batchId,strength,defect,salt,BigInt(e.inspectorScalar));
  if(!jubjubSchnorrVerify(signatureMessageType,reportSignatureFields(batchId,strength,defect,salt),current.inspectorVerificationKey,signed.signature))throw new Error('Enrolled signature does not match on-chain inspector key');
  circuitId='registerInspectionSigned';args=[batchId,strength,defect,salt,signed.signature];
  verified=state=>state.inspections.member(batchId);
  await providers.privateStateProvider.forContract(knownContract!).set(privateStateId,{});
 }else{
  if(!current.inspections.member(batchId))throw new Error('Register the signed inspection first');
  if(current.minimumStrength.member(policyId!)||current.maximumDefectsBps.member(policyId!))throw new Error('Policy already exists on-chain; no submission');
  circuitId='registerPolicy';args=[policyId!,BigInt(minText),BigInt(maxText)];
  verified=state=>state.minimumStrength.member(policyId!)&&state.maximumDefectsBps.member(policyId!)&&state.minimumStrength.lookup(policyId!)===BigInt(minText)&&state.maximumDefectsBps.lookup(policyId!)===BigInt(maxText);
  await providers.privateStateProvider.forContract(knownContract!).set(privateStateId,{policyAdminSecret:adminSecret});
 }
 phase='prove and submit contract call';
 console.log('Existing contract verified. Building and proving one',circuitId,'call...');
 const tx=await submitCallTx(providers,{compiledContract:compiled,contractAddress:knownContract!,privateStateId,circuitId,args} as never);
 const txId=typeof tx.public.txId==='string'?tx.public.txId:undefined;
 if(!submitAttempted||!journalDir||!submittedId)throw new Error('No tracked wallet submission; reconcile before claiming success');
 await journal('call-returned-awaiting-indexer',{txId:txId??null});
 phase='verify public ledger';
 await waitForIndexedState(readLedger,verified,{label:circuitId+' public ledger effect',timeoutMs:120000,pollMs:1500});
 await journal('confirmed',{txId:txId??null,indexedLedger:true});
 console.log('=== LOT V2 PREPROD '+action.toUpperCase()+' CONFIRMED ===');
 console.log('Batch:',batch);console.log('Contract:',knownContract);
 if(action==='policy')console.log('Policy:',policyLabel,'Minimum strength:',minText,'Maximum defects (bps):',maxText);
 if(txId)console.log('Call TX ID:',txId);
 if(submittedId)console.log('Submission identifier:',submittedId);
 console.log('Public ledger indexed.');console.log('Public status:',join(actionDir,'status.json'));
 try{await firstValueFrom(w.state().pipe(filter(s=>s.isSynced&&s.protocol?._tag==='Settled'),timeout({first:30000})));await saveCheckpoint();}catch{console.warn('Post-deploy checkpoint update unavailable; prior checkpoint preserved.');}
}
try{await main();}catch(e){
 console.error('LOT Build 32 stopped at:',phase);
 // Do not print raw exceptions from proof/deploy paths.
 if(!['prove and submit contract call','verify public ledger'].includes(phase)){
  console.error(safeError(e));
  const code=(e as {cause?:{code?:string}})?.cause?.code;
  if(typeof code==='string'&&/^[A-Za-z0-9_]{1,50}$/.test(code))console.error('Underlying error code:',code);
 }
 else console.error('Call/proof/indexer step did not finish normally. Do not rerun before reconciliation.');
 if(journalDir)try{await journal(submitAttempted?'reconciliation-required':'failed-before-submission',{phase});}catch{console.error('Could not update local deployment status. Preserve existing record.');}
 if(submittedId)console.error('Submission identifier:',submittedId);
 if(knownContract)console.error('Contract address:',knownContract);
 if(!submitAttempted)console.error('No wallet submission attempted by this process.');
 process.exitCode=1;
}finally{
 if(wallet)try{await wallet.stop();}catch{console.warn('Wallet cleanup incomplete.');}
 if(lockOwned&&lockFile)await unlink(lockFile).catch(()=>{});
}
