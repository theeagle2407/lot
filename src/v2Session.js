/** Local-only V2 session controls; secrets never enter URLs, browser storage or receipts. */
async function responseJSON(response){
  const data=await response.json().catch(()=>({ok:false}));
  if(!response.ok||!data?.ok)throw new Error(data.error||'Local proof service is unavailable.');
  return data;
}
export async function loadV2Session(batchId){
  const query=new URLSearchParams({batch:batchId});
  return (await responseJSON(await fetch(`/api/proof/v2-session?${query}`,{cache:'no-store'}))).session;
}
export async function loadV2Job(){return (await responseJSON(await fetch('/api/proof/v2-job',{cache:'no-store'}))).job;}
export async function runV2UiSession(input,authorization){
  const {csrf}=await responseJSON(await fetch('/api/proof/session',{cache:'no-store'}));
  return (await responseJSON(await fetch('/api/proof/v2-session/authorize',{
    method:'POST',cache:'no-store',credentials:'same-origin',referrerPolicy:'no-referrer',headers:{'content-type':'application/json','x-lot-csrf':csrf},
    body:JSON.stringify({input,authorization})
  }))).job;
}

export async function loadV2Sessions(){
 return (await responseJSON(await fetch('/api/proof/v2-sessions',{cache:'no-store',credentials:'same-origin',referrerPolicy:'no-referrer'}))).sessions;
}
