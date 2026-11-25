/** LOT Build 30 — deliberately read-only public-network configuration. */
export const PREPROD = Object.freeze({
  id: 'preprod',
  indexer: 'https://midnight-preprod.blockfrost.io/api/v0',
  indexerWs: 'wss://midnight-preprod.blockfrost.io/api/v0/ws',
  rpc: 'https://rpc.midnight-preprod.blockfrost.io',
  explorer: 'https://preprod.midnightexplorer.com/',
  faucet: 'https://midnight-tmnight-preprod.nethermind.dev/',
});
const RX_TOKEN = /^[A-Za-z0-9_-]{16,256}$/;
export function validateProjectToken(value) {
  if (typeof value !== 'string' || !RX_TOKEN.test(value))
    throw new Error('Expected a Midnight Preprod Blockfrost project token (ASCII letters, digits, _ or -, 16–256 characters).');
  return value;
}
export function preprodIndexerUrls(token) {
  validateProjectToken(token);
  const project_id=encodeURIComponent(token);
  return {
    http:`${PREPROD.indexer}?project_id=${project_id}`,
    ws:`${PREPROD.indexerWs}?project_id=${project_id}`,
  };
}
export function parsePublicAuditArgs(args) {
  if (!Array.isArray(args) || args.length !== 5)
    throw new Error('Usage: npm run preprod:audit -- LOT-3003 B-01 530 100 <64-hex-preprod-contract>');
  const [batchId,policyId,min,max,contractAddress]=args;
  if(!/^LOT-[A-Z0-9-]{1,48}$/.test(batchId) || !/^[A-Z0-9][A-Z0-9-]{0,47}$/.test(policyId) ||
     !/^(0|[1-9]\d{0,11})$/.test(min) || !/^(0|[1-9]\d{0,5})$/.test(max) ||
     !Number.isSafeInteger(Number(min)) || Number(min)<=0 || Number(max)>10000 ||
     !/^[0-9a-f]{64}$/.test(contractAddress))
     throw new Error('Invalid public audit arguments. No request was made.');
  return {batchId,policyId,minStrength:Number(min),maxDefectsBps:Number(max),contractAddress};
}
export async function pingPreprodIndexer(token,fetchFn=globalThis.fetch) {
  const {http}=preprodIndexerUrls(token);
  let response;
  try {
    response=await fetchFn(http,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({query:'query LotPreprodHealth { __typename }'}),
      signal:AbortSignal.timeout(12000),redirect:'error',cache:'no-store'});
  } catch {throw new Error('Preprod indexer unreachable (connection, DNS or TLS error).');}
  if(!response || response.status !== 200)
    throw new Error(`Preprod indexer did not accept the request (HTTP ${response?.status ?? 'unknown'}). Check your Preprod project token.`);
  let decoded;
  try { decoded=await response.json(); }catch { throw new Error('Indexer returned unreadable JSON.'); }
  if(!decoded || Array.isArray(decoded.errors) && decoded.errors.length ||
     typeof decoded.data?.__typename!=='string' || !decoded.data.__typename)
    throw new Error('Indexer GraphQL health query was not accepted.');
  return {ok:true,network:'preprod',indexer:'Blockfrost',operation:'read-only'};
}
