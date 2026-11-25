/** Local inspector flow. Do not persist measurements or passphrases in browser storage. */
async function json(response){
 const body=await response.json().catch(()=>({ok:false}));
 if(!response.ok||!body.ok)throw new Error(body.error||'Local inspector service unavailable.');
 return body;
}
export async function signedReportStatus(batchId){
 return json(await fetch(`/api/proof/v2-report/status?${new URLSearchParams({batch:batchId})}`,{
  cache:'no-store',credentials:'same-origin',referrerPolicy:'no-referrer'
 }));
}
export async function createSignedReport(report,authorization){
 const {csrf}=await json(await fetch('/api/proof/session',{cache:'no-store',credentials:'same-origin'}));
 return json(await fetch('/api/proof/v2-report/create',{
  method:'POST',cache:'no-store',credentials:'same-origin',referrerPolicy:'no-referrer',
  headers:{'content-type':'application/json','x-lot-csrf':csrf},
  body:JSON.stringify({report,authorization})
 }));
}
