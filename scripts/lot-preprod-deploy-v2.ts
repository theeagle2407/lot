/** Build 31: one authorized Preprod V2 deploy, restoring the verified Ledger 9 checkpoint.
 * Never registers NIGHT, transfers NIGHT, or runs local tests against Preprod.
 * Enrollment derives from the existing locally attested report, not synthetic lab credentials.
 */
import { mkdir, readFile, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, createCipheriv } from 'node:crypto';
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
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { jubjubSampleScalar, jubjubSchnorrVerifyingKey } from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../contracts/managed/lot-v2/contract/index.js';
import { v2Witnesses } from '../contracts/witnesses-v2.js';
import { loadEncryptedReport } from './lot-private-vault.mjs';
import { verifySavedAttestation, loadInspectorPrivatePem, loadInspectorPublicPem } from './lot-inspector-attestation.mjs';
import { makeV2Delegation, verifyV2Delegation } from './lot-v2-delegation.mjs';
import { sessionReportDigest } from './lot-v2-session-store.mjs';
import { waitForIndexedState } from './lot-indexer-wait.mjs';
(globalThis as any).WebSocket = WebSocket;
process.umask(0o077);
const registeredAddress='mn_addr_preprod1mu8kr96p9s8xvt7lx2cutk0ucelwmfrfvd0hs7ndlwlsuzj4y5wqxgm0vg';
const networkId='preprod';
const [address,batch,approval]=process.argv.slice(2);
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
let inspectorPassword='';
const json=(data:unknown)=>JSON.stringify(data,(_k,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
async function atomic(file:string,data:string){
 const tmp=`${file}.${process.pid}.${randomBytes(5).toString('hex')}.tmp`;
 try{await writeFile(tmp,data,{mode:0o600,flag:'wx'});await rename(tmp,file);}finally{await unlink(tmp).catch(()=>{});}
}
async function journal(status:string, extra:Record<string,unknown>={}){
 if(!journalDir)throw new Error('No deployment record directory');
 await atomic(join(journalDir,'status.json'),json({schema:1,network:networkId,batchId:batch,walletAddress:address,status,updatedAt:new Date().toISOString(),submittedIdentifier:submittedId??null,contractAddress:knownContract??null,...extra}));
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
  cipher.setAAD(Buffer.from(`LOT_PREPROD_V2:${batch}:${address}`));
  const ciphertext=Buffer.concat([cipher.update(json(data),'utf8'),cipher.final()]);
  return json({version:1,kdf:'scrypt',N:32768,r:8,p:1,cipher:'aes-256-gcm',salt:salt.toString('hex'),iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')});
 }finally{key.fill(0);}
}
function safeError(e:unknown){
 let msg=e instanceof Error?e.message:typeof e==='string'?e:'SDK returned a non-Error object';
 for(const secret of [token,phrase,password,inspectorPassword])if(secret)msg=msg.split(secret).join('[REDACTED]');
 // SDK failures can embed transactions, signed bytes and private inputs. Do not dump them.
 return msg.replace(/project_id=[^\s&"']+/gi,'project_id=[REDACTED]').replace(/(?:0x)?[0-9a-f]{80,}/gi,'[REDACTED_BYTES]').slice(0,220);
}
async function main(){
 if(address!==registeredAddress||!/^LOT-[A-Z0-9-]{1,48}$/.test(batch??'')||approval!=='DEPLOY')throw new Error('Invalid network, wallet, batch or authorization.');
 phrase=process.env.WALLET_MNEMONIC?.trim().toLowerCase().replace(/\s+/g,' ')??'';
 token=process.env.BLOCKFROST_PROJECT_ID?.trim()??'';
 password=process.env.LOT_VAULT_PASSWORD??'';
 inspectorPassword=process.env.LOT_INSPECTOR_PASSWORD??'';
 for(const k of ['WALLET_MNEMONIC','BLOCKFROST_PROJECT_ID','LOT_VAULT_PASSWORD','LOT_INSPECTOR_PASSWORD'])delete process.env[k];
 if(!validateMnemonic(phrase)||phrase.split(' ').length!==24||!password||!inspectorPassword||!/^[A-Za-z0-9_-]{16,256}$/.test(token))throw new Error('Required credentials missing or invalid.');
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
 const root=join(homedir(),'.lot','preprod','deployments-v2');
 await mkdir(root,{recursive:true,mode:0o700});await chmod(root,0o700);
 const dir=join(root,batch);
 // Validate the actual report and enrollment before a network request or journal creation.
 phase='report enrollment';
 const report=loadEncryptedReport(batch,password);
 if(report.batchId!==batch)throw new Error('Vault report batch mismatch');
 const attestation=verifySavedAttestation(report);
 let inspectorScalar=jubjubSampleScalar();while(inspectorScalar===0n)inspectorScalar=jubjubSampleScalar();
 const inspectorKey=jubjubSchnorrVerifyingKey(inspectorScalar);
 const inspectorPublicPem=loadInspectorPublicPem();
 const delegation=makeV2Delegation(report,inspectorKey,loadInspectorPrivatePem(),inspectorPassword,inspectorPublicPem);
 const trusted=verifyV2Delegation(report,delegation,inspectorPublicPem);
 if(attestation.inspector!==trusted.inspector)throw new Error('Inspector identity mismatch.');
 const adminSecret=new Uint8Array(randomBytes(32));
 const storagePassword='Lot31!'+randomBytes(32).toString('hex');
 const privateStateId='LOT_PREPROD_V2_'+batch;
 const storeName='lot-preprod-v2-'+batch+'-'+randomBytes(8).toString('hex');
 const assets=fileURLToPath(new URL('../contracts/managed/lot-v2',import.meta.url));
 const compiled=CompiledContract.make('LotContractV2',Contract).pipe(CompiledContract.withWitnesses(v2Witnesses),CompiledContract.withCompiledFileAssets(assets));
 const keyUrl=(url:string)=>`${url}?project_id=${encodeURIComponent(token)}`;
 const indexer=keyUrl('https://midnight-preprod.blockfrost.io/api/v0');
 const indexerWS=keyUrl('wss://midnight-preprod.blockfrost.io/api/v0/ws');
 const relay=keyUrl('wss://rpc.midnight-preprod.blockfrost.io');
 const proofServer='http://127.0.0.1:6300';
 phase='restore wallet';
 const health=await fetch(indexer,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'query LotHealth { __typename }'}),signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!health.ok||!(await health.json()).data?.__typename)throw new Error('Preprod indexer health failed');
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
  if(submitAttempted)throw new Error('One submission attempt per run; refusing duplicate');
  const finalized=LedgerTransaction.isLedgerTransaction(tx)?Transaction.deserialize('signature','proof','binding',tx.serialize()):tx;
  await journal('submission-attempted');submitAttempted=true;
  const identifier=await w.submitTransaction(WalletTransaction.adopt('Finalized',finalized,await active()));
  submittedId=String(identifier);await journal('submitted-awaiting-confirmation');
  console.log('Submission identifier:',submittedId);return identifier;
 }),config:{networkId,ttlSeconds:3600}};
 // Exclusive directory is the permanent replay guard, including unknown submission outcomes.
 phase='save encrypted enrollment';
 await mkdir(dir,{mode:0o700});journalDir=dir;
 await atomic(join(dir,'enrollment.enc.json'),encryptedEnrollment({schema:1,network:networkId,batchId:batch,walletAddress:address,reportDigest:sessionReportDigest(report),inspectorScalar:inspectorScalar.toString(),policyAdminSecret:Buffer.from(adminSecret).toString('hex'),privateStateId,storeName,storagePassword},password));
 inspectorScalar=0n;
 await journal('prepared');
 phase='deploy contract';
 console.log('Attested report verified. Encrypted enrollment saved. Building and proving one Preprod deployment...');
 const deployed=await deployContract(providers,{compiledContract:compiled,privateStateId,initialPrivateState:{},args:[trusted.verifyingKey,adminSecret]});
 const data=deployed.deployTxData.public;
 knownContract=String(data.contractAddress);
 if(!/^[0-9a-f]{64}$/i.test(knownContract))throw new Error('Unexpected deployment address format');
 const deploymentTx=typeof (data as any).txId==='string'?(data as any).txId:undefined;
 await journal('deployment-returned-awaiting-indexer',{deploymentTx:deploymentTx??null});
 console.log('Contract address:',knownContract);
 phase='verify public ledger';
 await waitForIndexedState(async()=>{
  const read=await publicDataProvider.queryContractState(knownContract!);
  if(!read||read.contractState.era!=='v9')return null;
  return ledger(read.contractState.deserialize({v9:ContractState}).data);
 },(state:any)=>state.inspections.size()===0n&&state.minimumStrength.size()===0n&&state.clearances.size()===0n,{label:'new LOT V2 public ledger',timeoutMs:120000,pollMs:1500});
 await journal('confirmed',{deploymentTx:deploymentTx??null,indexedLedger:true});
 console.log('=== LOT V2 PREPROD DEPLOYMENT CONFIRMED ===');
 console.log('Batch:',batch);console.log('Contract:',knownContract);
 if(deploymentTx)console.log('Deployment TX ID:',deploymentTx);
 if(submittedId)console.log('Submission identifier:',submittedId);
 console.log('Public ledger indexed. Inspection, policy and clearance maps empty.');
 console.log('Public status:',join(dir,'status.json'));
 try{await firstValueFrom(w.state().pipe(filter(s=>s.isSynced&&s.protocol?._tag==='Settled'),timeout({first:30000})));await saveCheckpoint();}catch{console.warn('Post-deploy checkpoint update unavailable; prior checkpoint preserved.');}
}
try{await main();}catch(e){
 console.error('LOT Build 31 stopped at:',phase);
 // Do not print raw exceptions from proof/deploy paths.
 if(!['deploy contract','verify public ledger'].includes(phase))console.error(safeError(e));
 else console.error('Deployment/proof/indexer step did not finish normally. Do not rerun before reconciliation.');
 if(journalDir)try{await journal(submitAttempted?'reconciliation-required':'failed-before-submission',{phase});}catch{console.error('Could not update local deployment status. Preserve existing record.');}
 if(submittedId)console.error('Submission identifier:',submittedId);
 if(knownContract)console.error('Contract address:',knownContract);
 if(!submitAttempted)console.error('No wallet submission attempted by this process.');
 process.exitCode=1;
}finally{
 if(wallet)try{await wallet.stop();}catch{console.warn('Wallet cleanup incomplete.');}
 if(lockOwned&&lockFile)await unlink(lockFile).catch(()=>{});
}
