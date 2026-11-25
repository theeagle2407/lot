import React,{useEffect,useState} from 'react';
import {ArrowUpRight,ShieldCheck} from 'lucide-react';
import {loadSavedPublicClearances,loadScopedBuyerClearance,exportSavedClearance} from './evidence.js';
import {checkScopedBuyerClearance,isCurrentLocalClearance} from './v2Audit.js';
import {freshLocalAudit,buyerVerificationPresentation} from './buyerStatus.js';
import {localBuyerLink} from './buyerLink.js';
function LocalCertificate({target}){
 const [state,setState]=useState({status:'checking'}),[receipt,setReceipt]=useState(null),[now,setNow]=useState(Date.now()),[epoch,setEpoch]=useState(0),[notice,setNotice]=useState('');
 useEffect(()=>{
  let active=true,controller=null;
  async function check(){
   if(target.invalid)return;
   controller?.abort();const current=new AbortController();controller=current;
   setState({status:'checking'});setReceipt(null);setNotice('');
   const timeout=setTimeout(()=>current.abort(),40000);
   try{const r=await loadScopedBuyerClearance(target,{signal:current.signal});const a=await checkScopedBuyerClearance(r,{signal:current.signal});if(active&&controller===current&&!current.signal.aborted){const t=Date.now();setReceipt(r);setNow(t);setState({...a,receivedAtMs:t});}}
   catch{if(active&&controller===current){setReceipt(null);setState({status:'unavailable'});}}
   finally{clearTimeout(timeout);if(active&&controller===current&&current.signal.aborted){setReceipt(null);setState({status:'unavailable'});}}
  }
  const onVisible=()=>{if(!document.hidden)check();};
  check();const timer=setInterval(onVisible,45000),clock=setInterval(()=>setNow(Date.now()),1000);
  document.addEventListener('visibilitychange',onVisible);
  return()=>{active=false;controller?.abort();clearInterval(timer);clearInterval(clock);document.removeEventListener('visibilitychange',onVisible);};
 },[target,epoch]);
 const exact=isCurrentLocalClearance(state,receipt),verified=exact&&freshLocalAudit(state,now),view=buyerVerificationPresentation(state,exact,verified);
 if(target.invalid)return <div className="lot-local-certificate"><a href={window.location.pathname}>Back to LOT</a><h2>Invalid clearance link</h2></div>;
 return <div className="lot-local-certificate"><a href={window.location.pathname}>Back to LOT</a><section className="signed-v2-panel"><span className="panel-label">LOCAL NETWORK</span><h2>{target.invalid?'Invalid clearance link':`${target.batchId} · ${target.policyId}`}</h2><h3 role="status">{view.heading}</h3><p>{view.description}</p>{receipt&&<><p>Minimum strength: {receipt.minStrength} MPa · Maximum defects: {receipt.maxDefectsBps/100}%</p><p>Inspection measurements not disclosed.</p><button className="button button-secondary" disabled={!verified} onClick={async()=>{if(!isCurrentLocalClearance(state,receipt)||!freshLocalAudit(state,Date.now()))return;try{await navigator.clipboard.writeText(localBuyerLink(window.location.href,receipt));setNotice("Verification link copied.");}catch{setNotice("Copy the browser address instead.");}}}>Copy verification link</button><button className="button button-secondary" disabled={!verified} onClick={()=>{if(!isCurrentLocalClearance(state,receipt)||!freshLocalAudit(state,Date.now()))return;const u=URL.createObjectURL(new Blob([JSON.stringify(exportSavedClearance(receipt),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='lot-local-receipt.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}}>Export receipt</button></>}<button className="button button-secondary" disabled={state.status==='checking'} onClick={()=>setEpoch(e=>e+1)}>Recheck</button>{notice&&<p role="status">{notice}</p>}<p>Local ledger only. Not a public-network clearance.</p></section></div>;
}
function Archive(){const [records,setRecords]=useState(null),[error,setError]=useState(false);useEffect(()=>{let active=true;async function refresh(){try{const r=await loadSavedPublicClearances();if(active){setRecords(r);setError(false);}}catch{if(active){setRecords(null);setError(true);}}}refresh();const t=setInterval(refresh,7000);return()=>{active=false;clearInterval(t);};},[]);return <section className="signed-v2-panel"><div className="signed-v2-title"><h2>Local clearances</h2><span className="saved-chip saved-chip-neutral">Local network</span></div>{error?<p className="signed-v2-hint">Local receipt service unavailable.</p>:!records?<p className="signed-v2-hint">Loading records…</p>:!records.length?<p className="signed-v2-hint">No local clearances yet.</p>:<div className="lot-receipt-list">{records.map(r=><a key={r.key} href={localBuyerLink(window.location.origin+'/',r)}><ShieldCheck size={18}/><span><strong>{r.batchId}</strong><small>{r.policyId} · Saved receipt</small></span><ArrowUpRight size={16}/></a>)}</div>}</section>;}
export default function LocalReceipts({target}){return target?<LocalCertificate target={target}/>:<Archive/>;}
