// Hosted gateway. Listen on loopback ONLY, behind a trusted local HTTPS proxy.
import http from 'node:http';
import {isIP} from 'node:net';
import {createHash,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const get=new Set(['/api/proof/session','/api/proof/auth/me','/api/proof/onboarding/catalog']);
const post=new Set(['auth/login','auth/signup','auth/logout','onboarding/batches','onboarding/assign','onboarding/invitations','onboarding/connect','onboarding/decision','onboarding/sign','onboarding/prepare','onboarding/issue'].map(p=>'/api/proof/'+p));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.webp':'image/webp'};
export function createHostedGateway({origin,reviewerHash,publicSignup=false,dist=resolve(root,'dist'),publicDist=resolve(root,'dist-preprod'),operatorPort=4175,publicPort=4176}={}){
 const u=new URL(origin);if(u.protocol!=='https:'||u.origin!==origin||u.username||u.password||u.port||!/^([a-z0-9-]+\.)+[a-z0-9-]+$/.test(u.hostname))throw Error('Expected exact public HTTPS DNS origin');
 if(!publicSignup&&!/^[a-f0-9]{64}$/.test(reviewerHash??''))throw Error('Missing reviewer credential hash');
 const expected=Buffer.from(reviewerHash||'','hex');
 const authorized=header=>{if(typeof header!=='string'||header.length>512||!/^Basic [A-Za-z0-9+/=]+$/.test(header))return false;const decoded=Buffer.from(header.slice(6),'base64').toString('utf8');return timingSafeEqual(createHash('sha256').update(decoded).digest(),expected);};
 let windows=new Map(),inflight=0;
 function limit(key,max,ms){const now=Date.now();let w=windows.get(key);if(!w||now>=w.until){if(windows.size>=4096){for(const [k,v] of windows)if(now>=v.until)windows.delete(k);if(windows.size>=4096&&!windows.has(key))return false;}w={until:now+ms,count:0};windows.set(key,w);}return ++w.count<=max;}

 const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cache-Control','no-store');res.setHeader('Strict-Transport-Security','max-age=86400');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  const fail=(code,error)=>{if(!res.headersSent){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({ok:false,error}));}else res.destroy();};
  if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==u.host||req.headers['x-forwarded-proto']!=='https')return fail(403,'HTTPS gateway required.');
  const url=req.url||'';if(url.length>1024||!url.startsWith('/')||url.startsWith('//')||url.includes('\\'))return fail(400,'Invalid path.');
  const method=req.method,path=url.split('?')[0];
  const operator=(get.has(url)&&method==='GET')||(post.has(url)&&method==='POST');
  const publicApi=method==='GET'&&/^\/api\/preprod\/clearance(?:\?batch=LOT-(?:0001|3002)|\?key=[a-f0-9]{64})?$/.test(url);
  const isApp=method==='GET'&&url==='/app';
  if(!publicSignup&&(isApp||operator)){if(!limit('reviewer',240,60000))return fail(429,'Too many requests.');if(!authorized(req.headers.authorization)){res.setHeader('WWW-Authenticate','Basic realm="LOT reviewer", charset="UTF-8"');return fail(401,'Reviewer access required.');}}
  if(operator||publicApi){
   // The trusted Caddy reverse proxy overwrites this header with its actual peer IP.
   if(publicSignup){const ip=req.headers['x-lot-client-ip'];if(typeof ip!=='string'||!isIP(ip))return fail(403,'Trusted proxy required.');
    const signup=url==='/api/proof/auth/signup',login=url==='/api/proof/auth/login';
    if(!limit('ip:'+ip+(publicApi?':public':signup?':signup':login?':login':method==='POST'?':write':':read'),publicApi?30:signup?4:login?6:method==='POST'?20:90,signup?600000:60000))return fail(429,'Too many requests. Try again later.');
   }
   if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return fail(403,'Cross-site API access denied.');
   if(method==='POST'&&(req.headers.origin!==origin||!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')||!/^([a-f0-9]{48})$/.test(req.headers['x-lot-csrf']||'')))return fail(403,'Invalid request origin or authorization.');
   if(!limit(publicApi?'public':method==='POST'?'writes':'reads',publicApi?90:method==='POST'?40:180,60000)||inflight>=12)return fail(429,'Service busy.');
   if(url==='/api/proof/auth/login'||url==='/api/proof/auth/signup')if(!limit('auth',12,60000))return fail(429,'Too many sign-in attempts.');
   inflight++;
   try{
    let body=Buffer.alloc(0);if(method==='POST'){for await(const chunk of req){if(body.length+chunk.length>8192){return fail(413,'Request too large.');}body=Buffer.concat([body,chunk]);}}else if(req.headers['content-length']||req.headers['transfer-encoding'])return fail(400,'Unexpected request body.');
    const port=operator?operatorPort:publicPort;const headers={host:`127.0.0.1:${port}`,'sec-fetch-site':'same-origin'};
    if(operator&&req.headers.cookie)headers.cookie=req.headers.cookie;
    if(method==='POST'){headers.origin=`http://127.0.0.1:${port}`;headers['x-lot-csrf']=req.headers['x-lot-csrf'];headers['content-type']='application/json';headers['content-length']=body.length;}
    await new Promise((done)=>{const p=http.request({host:'127.0.0.1',port,path:url,method,headers,timeout:65000},up=>{
     res.statusCode=up.statusCode||502;res.setHeader('Content-Type','application/json; charset=utf-8');
     if(operator&&up.headers['set-cookie']){const cookies=up.headers['set-cookie'];if(cookies.some(c=>!/^lot_operator=(?:[a-f0-9]{64})?; Path=\/api\/proof; HttpOnly; SameSite=Strict; Max-Age=\d+$/.test(c))){up.resume();fail(502,'Unexpected session response.');return done();}res.setHeader('Set-Cookie',cookies.map(c=>c+'; Secure'));}
     up.on('error',()=>{fail(502,'Service unavailable.');done();});up.on('end',done);up.pipe(res);
    });p.on('error',()=>{fail(502,'Service unavailable.');done();});p.on('timeout',()=>p.destroy());res.on('close',()=>{p.destroy();done();});p.end(body);});
   }catch{fail(400,'Request could not be completed.');}finally{inflight--;}
   return;
  }
  if(method!=='GET')return fail(404,'Not found.');
  let file=null,dirs=[];
  if(url==='/'){file='lot-public.html';dirs=[publicDist];}else if(isApp){file='index.html';dirs=[dist];}
  else if(path==='/verify-preprod'&&/^\/verify-preprod(?:\?batch=LOT-(?:0001|3002)|\?key=[a-f0-9]{64})?$/.test(url)){file='lot-public.html';dirs=[publicDist];}
  else if(/^\/assets\/[A-Za-z0-9_-]+\.(?:js|css|svg|woff2|png|webp)$/.test(url)){file=url.slice(1);dirs=[dist,publicDist];}
  if(!file)return fail(404,'Not found.');
  for(const d of dirs){try{const bytes=await readFile(resolve(d,file));res.setHeader('Content-Type',mime[extname(file)]);res.end(bytes);return;}catch{}}
  return fail(404,'Not found.');
 });
 server.requestTimeout=20000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxHeadersCount=60;server.maxConnections=100;
 return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const server=createHostedGateway({origin:process.env.LOT_PUBLIC_ORIGIN,reviewerHash:process.env.LOT_REVIEWER_HASH,publicSignup:process.env.LOT_PUBLIC_SIGNUP==='1'});server.listen(4195,'127.0.0.1',()=>console.log('LOT HTTPS gateway ready on private port 4195.'));
}
