#!/usr/bin/env node
/** Read-only Preprod readiness, NEVER loads the private inspection vault or wallet. */
import {existsSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadProjectToken} from './lot-preprod-credentials.mjs';
import {pingPreprodIndexer,PREPROD} from './lot-preprod-core.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const flag=process.argv.slice(2);
if(flag.length>1 || (flag.length===1&&flag[0]!=='--check-network')){
 console.error('Usage: npm run preprod:doctor [-- --check-network]');process.exit(1);
}
const has=x=>existsSync(join(root,x));
console.log('\nLOT PREPROD READINESS · NO DEPLOYMENT');
console.log('Network: Preprod (not Mainnet, not your local chain)');
const files=[
 ['V2 source', 'contracts/lot-v2.compact'],
 ['V2 generated contract','contracts/managed/lot-v2/contract/index.js'],
 ['V2 proof keys','contracts/managed/lot-v2/keys'],
 ['V2 proof IR','contracts/managed/lot-v2/zkir'],
];
let ready=true;
for(const [label,file] of files){const ok=has(file);ready&&=ok;console.log(`${ok?'OK':'MISSING'}: ${label}`);}
function packageVersion(name){try{return JSON.parse(readFileSync(join(root,'node_modules',...name.split('/'),'package.json'),'utf8')).version;}catch{return null;}}
for(const [name,pinned] of [
 ['@midnight-ntwrk/compact-runtime','0.21.0'],
 ['@midnight-ntwrk/midnight-js-contracts','5.0.1'],
 ['@midnightntwrk/wallet-sdk','2.0.1'],
]){
 const ver=packageVersion(name);
 console.log(`${ver===pinned?'OK':(ver?'REVIEW':'NOT FOUND')}: ${name} ${ver??'(not accessible)'}${ver&&ver!==pinned?' — expected '+pinned:''}`);
}
const token=loadProjectToken();
console.log(`Blockfrost Preprod token: ${token?'configured privately':'not configured'}`);
console.log('Preprod indexer: '+PREPROD.indexer);
console.log('Wallet funding/DUST: not checked (requires a separate funded Preprod wallet)');
console.log('Inspector accreditation: not established');
if(flag[0]==='--check-network'){
 if(!token)throw new Error('Configure a Midnight Preprod Blockfrost project token first: npm run preprod:configure');
 const connected=await pingPreprodIndexer(token);
 console.log('OK: Read-only Preprod indexer connectivity confirmed via '+connected.indexer);
}
console.log(ready?'V2 compilation artifacts: present.':'V2 artifacts incomplete — compile V2 before public-network preparation.');
console.log('No deployments, wallet signing, transaction submission or proof generation performed.');
