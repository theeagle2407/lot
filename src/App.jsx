import React, {useEffect,useRef,useState} from 'react';
import {ArrowRight,ArrowUpRight,Check,ChevronRight,FileCheck2,Layers2,LockKeyhole,Menu,Plus,ShieldCheck,X,LogOut} from 'lucide-react';
import {loadV2Session,loadV2Job,runV2UiSession,loadV2Sessions} from './v2Session.js';
import {currentOperator,loginOperator,logoutOperator} from './operator.js';
import {createSignedReport,signedReportStatus} from './signedReport.js';
import LiveOverview from './LiveOverview.jsx';
import LocalReceipts from './LocalReceipts.jsx';
import {parseLocalBuyerHash} from './buyerLink.js';
import './styles.css';
import './roles.css';
import {Signup,OnboardedHome} from './Onboarding.jsx';
function Logo(){return <div className="logo"><span className="logo-symbol" aria-hidden="true"><span/></span><span>lot<span className="logo-period">.</span></span></div>}
function PrimaryButton({ children, onClick, icon:Icon=ArrowUpRight, disabled=false, type='button', secondary=false }) { return <button className={`button ${secondary?'button-secondary':'button-primary'}`} type={type} disabled={disabled} onClick={onClick}>{children}{Icon&&<Icon size={16} strokeWidth={1.9}/>}</button> }
function SectionTitle({ children, right }) { return <div className="section-title"><h2>{children}</h2>{right}</div> }
function Field({label,value,onChange,type='text',min,step,placeholder,required=false,disabled=false}) { return <label className="field"><span>{label}</span><input required={required} disabled={disabled} type={type} min={min} step={step} value={value} placeholder={placeholder} onChange={e=>onChange(e.target.value)}/></label> }
function OperatorApp(){
 const [signup,setSignup]=useState(false);
 const [page,setPage]=useState('batches'); const [mobile,setMobile]=useState(false); const [authReady,setAuthReady]=useState(false); const [authUnavailable,setAuthUnavailable]=useState(false);
 const [batchId,setBatchId]=useState('LOT-3001');
 const [policyId,setPolicyId]=useState('');
 const [minimum,setMinimum]=useState('');
 const [maximum,setMaximum]=useState('');
 const [session,setSession]=useState(null);
 const [job,setJob]=useState(null);
 const [error,setError]=useState('');
 const [online,setOnline]=useState(false);
 const [sending,setSending]=useState(false);
 const [operator,setOperator]=useState(null);
 const [reportState,setReportState]=useState(null);
 const [signedBatches,setSignedBatches]=useState([]);
 const [signedBatchesError,setSignedBatchesError]=useState('');
 const [createOpen,setCreateOpen]=useState(false);
 const [createBatch,setCreateBatch]=useState('');
 const [createMaterial,setCreateMaterial]=useState('');
 const [createStrength,setCreateStrength]=useState('');
 const [createDefects,setCreateDefects]=useState('');
 const [createError,setCreateError]=useState('');
 const [createdMessage,setCreatedMessage]=useState('');
 const [createSending,setCreateSending]=useState(false);
 const createVault=useRef(null);
 const createInspector=useRef(null);
 const [loginName,setLoginName]=useState('');
 const [loginError,setLoginError]=useState('');
 const [loginSending,setLoginSending]=useState(false);
 const loginPassword=useRef(null);
 const [pendingAuth,setPendingAuth]=useState(null);
 const [authError,setAuthError]=useState('');
 const vaultInput=useRef(null);
 const inspectorInput=useRef(null);
 useEffect(()=>{let active=true;currentOperator().then(data=>{if(active){setOperator(data.operator);setAuthUnavailable(false);}}).catch(()=>{if(active){setOperator(null);setAuthUnavailable(true);}}).finally(()=>{if(active)setAuthReady(true);});return()=>{active=false;};},[]);
 useEffect(()=>{
  if(!operator||operator.scope==='onboarding'||!/^LOT-[A-Z0-9-]{1,48}$/.test(batchId)){setSession(null);return;}
  let mounted=true;
  const refresh=async()=>{
   try{
    const [s,j]=await Promise.all([loadV2Session(batchId),loadV2Job()]);
    if(mounted){setSession(s);setJob(j);setOnline(true);}
   }catch{if(mounted){setOnline(false);setSession(null);}}
  };
  refresh();const timer=setInterval(refresh,3000);
  return()=>{mounted=false;clearInterval(timer)};
 },[batchId,operator?.name,operator?.role]);
 useEffect(()=>{
  if(operator?.scope==='onboarding'||operator?.role!=='inspector'||!online||!/^LOT-[A-Z0-9-]{1,48}$/.test(batchId)){
   setReportState(null);return;
  }
  let active=true;
  const refresh=()=>signedReportStatus(batchId)
   .then(result=>{if(active)setReportState(result)})
   .catch(()=>{if(active)setReportState(null)});
  refresh();const timer=setInterval(refresh,5000);
  return()=>{active=false;clearInterval(timer)};
 },[batchId,operator?.name,operator?.role,online]);
 useEffect(()=>{
  if(!operator||operator.scope==='onboarding'||!online){setSignedBatches([]);setSignedBatchesError('');return;}
  let active=true;
  const refresh=async()=>{
   try{
    const items=await loadV2Sessions();
    if(active){setSignedBatches(items);setSignedBatchesError('');}
   }catch{if(active){setSignedBatches([]);setSignedBatchesError('Saved batches are unavailable.');}}
  };
  refresh();const timer=setInterval(refresh,7000);
  return()=>{active=false;clearInterval(timer)};
 },[operator?.name,operator?.role,online]);
 const running=job?.status==='running';
 function changeBatch(value){setBatchId(value);setSession(null);setReportState(null);setCreatedMessage('');setError('');}
 function openCreate(){
  if(operator?.role!=='inspector'){setError('Sign in as an inspector to create a report.');return;}
  setCreateBatch(batchId);setCreateMaterial('');setCreateStrength('');setCreateDefects('');
  setCreateError('');setCreatedMessage('');setCreateOpen(true);
 }
 function closeCreate(){
  if(createVault.current)createVault.current.value='';
  if(createInspector.current)createInspector.current.value='';
  setCreateBatch('');setCreateMaterial('');setCreateStrength('');setCreateDefects('');
  setCreateOpen(false);setCreateError('');
 }
 useEffect(()=>{
  if(createOpen){if(createVault.current)createVault.current.value='';if(createInspector.current)createInspector.current.value='';}
 },[createOpen]);
 async function submitCreatedReport(event){
  event.preventDefault();if(createSending)return;
  const min=Number(createStrength),max=Number(createDefects);
  if(!/^LOT-[A-Z0-9-]{1,48}$/.test(createBatch)||!createMaterial.trim()||createMaterial.trim()!==createMaterial||createMaterial.length>80||
     !/^\d+$/.test(createStrength)||!Number.isSafeInteger(min)||min<1||min>1_000_000_000||
     !/^(?:\d+)(?:\.\d{1,2})?$/.test(createDefects)||!Number.isFinite(max)||max<0||max>100){
    setCreateError('Check the batch ID, material, strength and defect percentage (up to 2 decimals).');return;
  }
  const authorization={vaultPassphrase:createVault.current?.value??'',inspectorPassphrase:createInspector.current?.value??''};
  if(Object.values(authorization).some(v=>v.length<12||v.length>1024)){
   setCreateError('Enter your vault and inspector passphrases (at least 12 characters).');return;
  }
  setCreateSending(true);setCreateError('');
  try{
   const result=await createSignedReport({batchId:createBatch,material:createMaterial,strengthMpa:min,defectBps:Math.round(max*100)},authorization);
   setBatchId(result.batchId);setReportState({batchId:result.batchId,saved:true,incomplete:false});
   setCreatedMessage(`${result.batchId} encrypted and signed locally. Select Register signed batch to anchor it on Midnight.`);
   closeCreate();
  }catch(e){setCreateError(e instanceof Error?e.message:'Could not save signed report.');}
  finally{authorization.vaultPassphrase='';authorization.inspectorPassphrase='';setCreateSending(false);}
 }
 function clearLogin(){if(loginPassword.current)loginPassword.current.value='';setLoginName('');setLoginError('');}
 function prepare(mode){
  setError('');
  if(!operator)return;
  if(operator.role!==(mode==='init'?'inspector':'manufacturer')){setError('This account cannot perform that operation.');return;}
  const batch=batchId.trim();
  if(!/^LOT-[A-Z0-9-]{1,48}$/.test(batch)){setError('Enter a valid LOT batch ID.');return;}
  let input={mode,batchId:batch};
  if(mode==='prove'){
   const min=Number(minimum),max=Number(maximum);
   if(!/^[A-Za-z0-9-]{1,36}$/.test(policyId)||!Number.isInteger(min)||min<1||min>1_000_000_000||
      !/^(?:\d+)(?:\.\d{1,2})?$/.test(maximum)||!Number.isFinite(max)||max<0||max>100){
     setError('Check the buyer ID and whole-number strength / defect percentage (up to 2 decimals).');return;
   }
   input={...input,policyId,minStrength:min,maxDefectsBps:Math.round(max*100)};
  }
  setAuthError('');setPendingAuth(input);
 }
 function closeAuthorization(){
  if(vaultInput.current)vaultInput.current.value='';
  if(inspectorInput.current)inspectorInput.current.value='';
  setPendingAuth(null);setAuthError('');
 }
 async function signIn(event){
  event.preventDefault();if(loginSending)return;
  setLoginSending(true);setLoginError('');
  try{
   const data=await loginOperator(loginName.trim(),loginPassword.current?.value??'');
   setOperator(data.operator);setPage('batches');setAuthUnavailable(false);window.dispatchEvent(new Event('lot-operator-changed'));clearLogin();
  }catch(e){
   if(loginPassword.current)loginPassword.current.value='';
   setLoginError(e instanceof Error?e.message:'Sign-in failed.');
  }
  finally{setLoginSending(false);}
 }
 async function signOut(){
  if(running||sending||createSending)return;
  try{await logoutOperator();clearLogin();closeCreate();closeAuthorization();setOperator(null);setSignup(false);setPage('batches');setBatchId('LOT-3001');setPolicyId('');setMinimum('');setMaximum('');setSession(null);setJob(null);setReportState(null);setSignedBatches([]);setOnline(false);setMobile(false);window.dispatchEvent(new Event('lot-operator-changed'));setPendingAuth(null);setCreateOpen(false);setError('');setCreatedMessage('');}
  catch(e){setError(e instanceof Error?e.message:'Unable to sign out.');}
 }
 async function authorize(event){
  event.preventDefault();
  if(!pendingAuth||sending)return;
  let authorization={vaultPassphrase:vaultInput.current?.value??''};
  if(pendingAuth.mode==='init')authorization.inspectorPassphrase=inspectorInput.current?.value??'';
  if(Object.values(authorization).some(v=>v.length<12||v.length>1024)){
    setAuthError('Enter your existing passphrase (at least 12 characters).');return;
  }
  setSending(true);setAuthError('');
  try{
    const next=await runV2UiSession(pendingAuth,authorization);
    setJob(next);closeAuthorization();
  }catch(e){setAuthError(e instanceof Error?e.message:'Unable to authorize this action.');}
  finally{authorization=null;setSending(false);}
 }
 if(operator?.scope==='onboarding')return <OnboardedHome key={operator.name} operator={operator} onSignOut={signOut} logo={<Logo/>}/>;
 const inspector=operator?.role==='inspector';
 const authenticated=inspector||operator?.role==='manufacturer';
 const nav=inspector?[{id:'batches',label:'Inspections',Icon:FileCheck2}]:[{id:'batches',label:'Batches',Icon:Layers2},{id:'clearances',label:'Clearances',Icon:ShieldCheck}];
 const title=inspector?'Inspections':page==='clearances'?'Clearances':'Batches';
 return <>
 {!authenticated?<div className="lot-signin"><header><Logo/></header><main className="lot-signin-main"><section className="lot-signin-card"><div className="lot-login-icon"><LockKeyhole size={25}/></div><>{signup?<Signup disabled={!authReady||authUnavailable} onCancel={()=>{setSignup(false);clearLogin();}} onCreated={actor=>{setOperator(actor);setSignup(false);clearLogin();}}/>:<><h1>Sign in to LOT</h1><form onSubmit={signIn} className="lot-signin-form"><label className="field"><span>Username</span><input name="lot-local-operator-entry" value={loginName} onChange={e=>setLoginName(e.target.value)} autoComplete="off" required/></label><label className="field"><span>Password</span><input ref={loginPassword} name="lot-local-manual-secret" type="password" autoComplete="new-password" minLength={14} maxLength={512} required/></label>{loginError&&<p className="form-error" role="alert">{loginError}</p>}<PrimaryButton icon={ArrowRight} type="submit" disabled={!authReady||authUnavailable||loginSending}>{loginSending?'Signing in…':authReady?'Sign in':'Checking session…'}</PrimaryButton></form><button className="lot-auth-switch" disabled={loginSending} onClick={()=>{clearLogin();setSignup(true);}}>New to LOT? <strong>Create account</strong></button></>}</>{authUnavailable&&<p className="form-error">Local operator service unavailable. Start the proof service first.</p>}<a className="lot-login-buyer" href="/verify-preprod">Have a clearance to verify? <ArrowRight size={14}/></a></section></main></div>:<div className="app"><button aria-label="Close navigation" className={`scrim ${mobile?'scrim-visible':''}`} onClick={()=>setMobile(false)} tabIndex={mobile?0:-1}/><aside className={`sidebar ${mobile?'sidebar-open':''}`}><div className="side-top"><Logo/><button className="side-close" onClick={()=>setMobile(false)} aria-label="Close menu"><X size={19}/></button></div><div className="side-menu">{nav.map(({id,label,Icon})=><button key={id} className={`nav-item ${page===id?'nav-active':''}`} onClick={()=>{setPage(id);setMobile(false)}}><Icon size={18}/><span>{label}</span>{page===id&&<span className="nav-active-dot"/>}</button>)}</div><div className="lot-side-account"><strong>{operator.name}</strong><span>{inspector?'Inspector':'Manufacturer'}</span><button disabled={running||sending||createSending} className="nav-item" onClick={signOut}><LogOut size={17}/> Sign out</button></div></aside><div className="main"><header className="header"><div className="header-left"><button className="mobile-menu" onClick={()=>setMobile(true)} aria-label="Open menu"><Menu size={22}/></button><span className="header-page">{title}</span></div><div className="header-actions"><span className="lot-account-role">{inspector?'Inspector':'Manufacturer'}</span></div></header><main className="main-content"><div className="page-heading"><div><h1>{title}</h1></div></div>{!inspector&&page==='clearances'?<><LiveOverview/><LocalReceipts/></>:<>{inspector&&<LiveOverview inspector/>}{!inspector&&<section className="lot-role-summary"><div><span className="panel-label">MIDNIGHT PREPROD</span><h2>LOT-3002</h2><p>Existing signed batch · Policy B-02</p></div><button className="button button-secondary" onClick={()=>setPage('clearances')}>View clearance <ArrowRight size={15}/></button></section>}
 <section className="signed-v2-panel" aria-label="Local inspection and clearance operations">
  <div className="signed-v2-title"><div><h2>{inspector?'Inspection records':'Generate clearance'}</h2></div><span className="saved-chip saved-chip-neutral">Local network</span></div>
  <p className="signed-v2-hint">{inspector?'Create and register an encrypted, signed inspection.':'Select a signed batch and enter the buyer requirements. New Preprod clearances are issued through the operator CLI.'}</p>
  {operator&&online&&<div className="signed-v2-catalog" aria-label="Saved signed batches">
   <div className="signed-v2-catalog-head"><strong>Signed batches</strong><span>Local records</span></div>
   {signedBatchesError?<p className="form-error" role="alert">{signedBatchesError}</p>:
    signedBatches.length?<div className="signed-v2-catalog-items">{signedBatches.map(entry=><button type="button" key={entry.batchId} aria-pressed={entry.batchId===batchId} className={`signed-v2-batch ${entry.batchId===batchId?'signed-v2-batch-active':''}`} disabled={running||sending||createSending} onClick={()=>{changeBatch(entry.batchId);}}>
     <span className="signed-v2-batch-label"><FileCheck2 size={15}/><strong>{entry.batchId}</strong></span>
     <span className="signed-v2-batch-id">{entry.contractAddress.slice(0,10)}…{entry.contractAddress.slice(-8)}</span>
     <ChevronRight size={16}/>
    </button>)}</div>:<p className="signed-v2-catalog-empty">No signed batches registered on this device yet.</p>}
  </div>}
  <div className={`signed-v2-inputs ${inspector?'inspector-inputs':''}`}><Field label="Batch ID" value={batchId} onChange={changeBatch} disabled={running||sending||createSending} placeholder="LOT-3001"/>
   {!inspector&&<><Field label="Buyer ID" value={policyId} onChange={setPolicyId} placeholder="B-05"/>
   <Field label="Minimum strength (MPa)" value={minimum} onChange={setMinimum} type="number" min="1" step="1"/>
   <Field label="Maximum defects (%)" value={maximum} onChange={setMaximum} type="number" min="0" step="0.01"/></>}</div>
  <div className="signed-v2-actions">
   {inspector&&<><PrimaryButton secondary icon={Plus} disabled={!online||running||sending||!!session||reportState?.saved||operator?.role!=='inspector'} onClick={openCreate}>Create signed report</PrimaryButton>
   <PrimaryButton secondary icon={null} disabled={!online||!!session||!reportState?.saved||running||sending||operator?.role!=='inspector'} onClick={()=>prepare('init')}>Register inspection</PrimaryButton></>}
   {!inspector&&<PrimaryButton icon={ArrowUpRight} disabled={!online||!session||running||sending||operator?.role!=='manufacturer'} onClick={()=>prepare('prove')}>Generate clearance</PrimaryButton>}
  </div>
  {reportState?.saved&&!session&&operator?.role==='inspector'&&<p className="signed-v2-foot">Signed report saved · Not yet registered.</p>}
  {reportState?.incomplete&&<p className="form-error" role="alert">This batch has incomplete local report files. No files were overwritten.</p>}
  {createdMessage&&<p className="signed-v2-foot" role="status">{createdMessage}</p>}
  {session&&<p className="signed-v2-foot">Registered · <code>{session.contractAddress.slice(0,12)}…{session.contractAddress.slice(-8)}</code></p>}
  {!online&&<p className="signed-v2-foot" role="status">Local proof service unavailable. Start it to continue.</p>}
  {running&&<p className="signed-v2-foot" role="status">{job.phase} · Processing locally.</p>}
  {job?.status==='completed'&&<p className="signed-v2-foot" role="status">{inspector?'Inspection action completed.':'Clearance action completed. Open Clearances to check the receipt.'}</p>}
  {job?.status==='failed'&&<p className="signed-v2-foot" role="alert">V2 action stopped. See the local proof-service logs.</p>}
  {error&&<p className="form-error" role="alert">{error}</p>}
 </section></>}{error&&page==='clearances'&&<p className="form-error" role="alert">{error}</p>}</main></div></div>}
  {authenticated&&inspector&&createOpen&&<div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget&&!createSending)closeCreate()}}>
   <div className="modal signed-auth-modal" role="dialog" aria-modal="true" aria-labelledby="lot-create-title">
    <div className="modal-top"><h2 id="lot-create-title">Create signed report</h2><button type="button" onClick={closeCreate} disabled={createSending} aria-label="Close report form"><X size={18}/></button></div>
    <p className="modal-sub">Encrypted inspection · Inspector only</p>
    <form onSubmit={submitCreatedReport} autoComplete="off">
     <div className="new-fields">
      <Field label="Batch ID" value={createBatch} onChange={setCreateBatch} placeholder="LOT-3002" required/>
      <Field label="Material" value={createMaterial} onChange={setCreateMaterial} placeholder="Structural steel" required/>
      <div className="two-fields">
       <Field label="Strength (MPa)" value={createStrength} onChange={setCreateStrength} type="number" min="1" step="1" required/>
       <Field label="Defects (%)" value={createDefects} onChange={setCreateDefects} type="number" min="0" step="0.01" required/>
      </div>
      <label className="field"><span>New report passphrase</span><input ref={createVault} name="lot-local-new-report-secret" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required spellCheck="false" placeholder="Encrypt this report" /></label>
      <label className="field"><span>Inspector signing-key passphrase</span><input ref={createInspector} name="lot-local-inspector-signing-secret" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required spellCheck="false" placeholder="Authorize signing" /></label>
     </div>
     <p className="signed-auth-note"><LockKeyhole size={14}/> Measurements stay in an encrypted local report. The signing key stays on this device. This is not independent laboratory accreditation.</p>
     {createError&&<p className="form-error" role="alert">{createError}</p>}
     <div className="modal-actions"><PrimaryButton secondary icon={null} disabled={createSending} onClick={closeCreate}>Cancel</PrimaryButton><PrimaryButton type="submit" icon={Check} disabled={createSending}>{createSending?'Saving…':'Encrypt & sign'}</PrimaryButton></div>
    </form>
   </div>
  </div>}
  {authenticated&&pendingAuth&&<div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget&&!sending)closeAuthorization()}}>
    <div className="modal signed-auth-modal" role="dialog" aria-modal="true" aria-labelledby="v2-auth-title">
     <div className="modal-top"><h2 id="v2-auth-title">Authorize {pendingAuth.mode==='init'?'inspection':'buyer proof'}</h2>
      <button aria-label="Close authorization" onClick={closeAuthorization} disabled={sending}><X size={18}/></button></div>
     <p className="modal-sub">{pendingAuth.batchId}{pendingAuth.mode==='prove'?` · ${pendingAuth.policyId}`:''} · Local network</p>
     <form onSubmit={authorize} autoComplete="off">
      <div className="new-fields">
       <label className="field"><span>Encrypted report passphrase</span><input ref={vaultInput} type="password" autoComplete="off" minLength={12} maxLength={1024} required autoFocus spellCheck="false" placeholder="Enter passphrase" /></label>
       {pendingAuth.mode==='init'&&<label className="field"><span>Inspector signing-key passphrase</span><input ref={inspectorInput} type="password" autoComplete="off" minLength={12} maxLength={1024} required spellCheck="false" placeholder="Enter inspector passphrase" /></label>}
      </div>
      <p className="signed-auth-note"><LockKeyhole size={14}/> Passphrases go only to your local proof service for this action. They are not saved by LOT.</p>
      {authError&&<p className="form-error" role="alert">{authError}</p>}
      <div className="modal-actions"><PrimaryButton secondary icon={null} disabled={sending} onClick={closeAuthorization}>Cancel</PrimaryButton><PrimaryButton icon={ArrowRight} disabled={sending} type="submit">{sending?'Authorizing…':'Authorize & continue'}</PrimaryButton></div>
     </form>
    </div>
  </div>}
 </>
}

export default function App(){const [target,setTarget]=useState(()=>parseLocalBuyerHash(window.location.hash));useEffect(()=>{const update=()=>setTarget(parseLocalBuyerHash(window.location.hash));window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);return target?<LocalReceipts key={JSON.stringify(target)} target={target}/>:<OperatorApp/>;}
