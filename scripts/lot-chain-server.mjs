/**
 * LOT Build 03 — read-only local network evidence API.
 * Never accepts private measurements or witness secrets.
 * Binds localhost only. Not a production API or wallet endpoint.
 */
import http from 'node:http';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { ContractState } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-runtime';
import { ledger } from '../contracts/managed/lot/contract/index.js';
import { publicLedgerSummary } from './lot-chain-utils.mjs';

const DEFAULT_LOCAL_ADDRESS = 'bd0b0fdbf5466b489be6e486ddee1a2fa7e84d41862f44f25d277d210373a8c4';
const address = (process.env.LOT_CONTRACT_ADDRESS || DEFAULT_LOCAL_ADDRESS).trim();
if (!/^[0-9a-fA-F]{64}$/.test(address)) throw new Error('LOT_CONTRACT_ADDRESS must be 64 hexadecimal characters');
const port = Number(process.env.LOT_CHAIN_PORT || 4174);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid LOT_CHAIN_PORT');

const indexer = indexerPublicDataProvider(
  'http://127.0.0.1:8088/api/v4/graphql',
  'ws://127.0.0.1:8088/api/v4/graphql/ws',
);

function respond(res, code, body) {
  res.writeHead(code, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req,res)=>{
  if (req.method !== 'GET' || req.url !== '/api/lot/state') {
    respond(res,404,{ok:false,error:'Not found'});
    return;
  }
  try {
    const read = await indexer.queryContractState(address);
    if (!read) throw new Error('The contract was not found on the local chain (was the devnet reset?)');
    if (read.contractState.era !== 'v9') throw new Error('Expected a Ledger 9 contract');
    const state = read.contractState.deserialize({v9:ContractState});
    const view = ledger(state.data);
    respond(res,200,publicLedgerSummary(address, view));
  } catch(error) {
    // Only a concise, sanitized error is returned to the UI.
    const message=error instanceof Error?error.message:'Unexpected indexer error';
    console.error('[LOT local indexer]', message);
    respond(res,503,{ok:false,error:'Local indexer query failed. Check Docker and the contract address.'});
  }
});
server.listen(port,'127.0.0.1',()=>{
  console.log(`LOT read-only local chain API: http://127.0.0.1:${port}/api/lot/state`);
  console.log(`Contract: ${address}`);
});
