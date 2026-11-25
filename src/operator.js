/** Local operator sign-in; cookie is HttpOnly and never accessible to React. */
async function readJSON(res){
 const body=await res.json().catch(()=>({ok:false}));
 if(!res.ok||!body.ok)throw new Error(body.error||'Local operator service is unavailable.');
 return body;
}
export async function currentOperator(){
 return await readJSON(await fetch('/api/proof/auth/me',{cache:'no-store',credentials:'same-origin'}));
}
async function writeWithCsrf(path,body){
 const session=await readJSON(await fetch('/api/proof/session',{cache:'no-store',credentials:'same-origin'}));
 return await readJSON(await fetch(path,{
  method:'POST',credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',
  headers:{'content-type':'application/json','x-lot-csrf':session.csrf},body:JSON.stringify(body),
 }));
}
export async function loginOperator(name,password){
 return await writeWithCsrf('/api/proof/auth/login',{name,password});
}
export async function logoutOperator(){
 return await writeWithCsrf('/api/proof/auth/logout',{});
}
export async function signupOperator(input){return writeWithCsrf('/api/proof/auth/signup',input);}
export async function onboardingCatalog(){return readJSON(await fetch('/api/proof/onboarding/catalog',{cache:'no-store',credentials:'same-origin'}));}
export async function createBatchRequest(input){return writeWithCsrf('/api/proof/onboarding/batches',input);}
export async function assignBatchRequest(input){return writeWithCsrf('/api/proof/onboarding/assign',input);}

export async function inviteInspector(){return writeWithCsrf('/api/proof/onboarding/invitations',{});}

export const connectInspector=code=>writeWithCsrf('/api/proof/onboarding/connect',{code});
export const decideInspection=(requestId,decision)=>writeWithCsrf('/api/proof/onboarding/decision',{requestId,decision});
export const signInspection=input=>writeWithCsrf('/api/proof/onboarding/sign',input);

export const prepareClearance=input=>writeWithCsrf('/api/proof/onboarding/prepare',input);

export const issueClearance=input=>writeWithCsrf('/api/proof/onboarding/issue',input);
