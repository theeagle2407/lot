/**
 * LOT Preprod Ledger 9 boundary start — READ ONLY.
 *
 * Separate from the existing identity/register helper so that neither working
 * command must be edited. Connects/synchronizes a test wallet and reads its
 * current tNIGHT, tDUST, and coin registration flags. NEVER signs, registers,
 * deploys, submits, or transfers.
 *
 * Fresh verified wallets use normal shielded/unshielded sync and Ledger 9 DUST fast start; later runs restore.
 */
import { mkdir, readFile, writeFile, rename, chmod, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Option } from 'effect';
import { firstValueFrom, filter } from 'rxjs';
import { Buffer } from 'node:buffer';
import { WebSocket } from 'ws';
(globalThis as any).WebSocket = WebSocket;
import { mnemonicToSeedSync } from '@scure/bip39';
import {
  WalletSeeds, WalletFacade, ShieldedWallet, DustWallet, UnshieldedWallet, ProtocolVersion,
  createKeystore, PublicKey, NoOpTransactionHistoryStorage, validateMnemonic,
} from '@midnightntwrk/wallet-sdk';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/v9';

const networkId = 'preprod';
const expectedAddress = process.argv[2];
if (!expectedAddress?.startsWith('mn_addr_preprod1')) {
  throw new Error('Provide the exact expected, previously verified Preprod unshielded address.');
}
const phrase = process.env.WALLET_MNEMONIC?.trim().toLowerCase().replace(/\s+/g, ' ');
if (!phrase || phrase.split(' ').length !== 24 || !validateMnemonic(phrase)) {
  throw new Error('Use a valid 24-word recovery phrase for your dedicated disposable test wallet only.');
}
const projectId = process.env.BLOCKFROST_PROJECT_ID?.trim();
if (!projectId || !/^[A-Za-z0-9_-]{16,256}$/.test(projectId)) {
  throw new Error('A valid Midnight Preprod Blockfrost project ID is required.');
}

const masterSeed = Buffer.from(mnemonicToSeedSync(phrase));
const seeds = WalletSeeds.fromMasterSeed(masterSeed);
const signingKey = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, networkId);
const address = String(signingKey.getBech32Address());
if (address !== expectedAddress) {
  throw new Error('WALLET ADDRESS MISMATCH. No network request or transaction made.');
}

const withProjectId = (url: string) => `${url}?project_id=${encodeURIComponent(projectId)}`;
const proofServer = 'http://127.0.0.1:6300';
const config = {
  indexerHttpUrl: withProjectId('https://midnight-preprod.blockfrost.io/api/v0'),
  indexerWsUrl: withProjectId('wss://midnight-preprod.blockfrost.io/api/v0/ws'),
  node: withProjectId('https://rpc.midnight-preprod.blockfrost.io'),
};
const configuration = {
  networkId,
  indexerClientConnection: {
    indexerHttpUrl: config.indexerHttpUrl,
    indexerWsUrl: config.indexerWsUrl,
  },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(config.node.replace(/^http/, 'ws')),
  txHistoryStorage: new NoOpTransactionHistoryStorage(),
  costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
};

// Only use a checkpoint scoped to the verified wallet and this SDK version.
// The checkpoint contains private wallet-derived data. Never upload it.
const cacheDir = join(homedir(), '.lot', 'preprod', 'wallet-sync-ledger9');
await mkdir(cacheDir, { recursive: true, mode: 0o700 });
await chmod(cacheDir, 0o700);
const file = join(cacheDir, `${address}.json`);
type Snapshot = { version: number; network: string; address: string; sdk: string; shielded: string; unshielded: string; dust: string };
let saved: Snapshot | undefined;
let old: Snapshot | undefined;
async function loadSnapshot(path: string): Promise<Snapshot | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (parsed.version !== 1 || parsed.network !== networkId || parsed.address !== address || parsed.sdk !== '2.0.1' ||
        !['shielded', 'unshielded', 'dust'].every(k => typeof parsed[k] === 'string' && parsed[k].length > 0)) {
      throw new Error('Checkpoint format or identity mismatch. Preserved; no automatic reset.');
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return undefined;
  }
}
saved = await loadSnapshot(file);
if (!saved) {
  old = await loadSnapshot(join(homedir(), '.lot', 'preprod', 'wallet-sync-v2', `${address}.json`));
  // For a verified wallet with no prior snapshot, initialize shielded and unshielded from its own keys.
}
const cursor = 1857961;
const runtime = 2001100n;
// Validate the published Preprod boundary against the live indexer before using it.
async function dustEvent(id: number): Promise<{ id: number; version: bigint }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(config.indexerWsUrl, 'graphql-transport-ws', { handshakeTimeout: 12000 });
    let done = false;
    const timer = setTimeout(() => finish(undefined, 'DUST boundary request timed out'), 15000);
    function finish(value?: { id: number; version: bigint }, reason = 'DUST boundary query failed') {
      if (done) return;
      done = true; clearTimeout(timer);
      if (ws.readyState === WebSocket.OPEN) ws.close(); else if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
      if (value) resolve(value); else reject(new Error(reason));
    }
    ws.on('error', () => finish(undefined, 'Indexer WebSocket error'));
    ws.on('unexpected-response', (_req,res) => { res.resume(); finish(undefined, `Indexer WebSocket HTTP ${res.statusCode}`); });
    ws.on('close', code => finish(undefined, `Indexer closed before event (${code})`));
    ws.on('open', () => ws.send(JSON.stringify({type:'connection_init'})));
    ws.on('message', raw => {
      try {
        const m = JSON.parse(String(raw));
        if (m.type === 'connection_ack') ws.send(JSON.stringify({id:'boundary',type:'subscribe',payload:{query:'subscription($id: Int) { dustLedgerEvents(id: $id) { id protocolVersion } }', variables:{id}}}));
        else if (m.type === 'ping') ws.send(JSON.stringify({type:'pong',payload:m.payload}));
        else if (m.type === 'next') {
          const e = m.payload?.data?.dustLedgerEvents;
          if (!e || e.protocolVersion == null || e.id == null) return finish();
          finish({id:Number(e.id),version:BigInt(e.protocolVersion)});
        } else if (m.type === 'error' || m.type === 'complete') finish();
      } catch { finish(); }
    });
  });
}
async function verifyRpc() {
  await new Promise<void>((resolve,reject) => {
    const ws = new WebSocket(configuration.relayURL, {handshakeTimeout:12000});
    let done = false;
    const timer = setTimeout(() => finish('Node RPC did not return system_chain'), 15000);
    function finish(reason?: string) {
      if (done) return; done=true; clearTimeout(timer);
      if (ws.readyState === WebSocket.OPEN) ws.close(); else if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
      if (reason) reject(new Error(reason)); else resolve();
    }
    ws.on('error', () => finish('Node RPC WebSocket connection failed'));
    ws.on('unexpected-response', (_req,res) => {res.resume(); finish(`Node RPC HTTP ${res.statusCode}`);});
    ws.on('close', code => finish(`Node RPC closed before response (${code})`));
    ws.on('open', () => ws.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'system_chain',params:[]})));
    ws.on('message', raw => {
      try { const m=JSON.parse(String(raw)); if(m.id===1) finish(typeof m.result==='string' && m.result.length>0 ? undefined : 'Node RPC returned an error'); }
      catch {finish('Invalid Node RPC response');}
    });
  });
  console.log('Node RPC system_chain: OK (live response, not merely handshake)');
}

async function checkSocket(label: string, url: string, protocols?: string[]) {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url, protocols, { handshakeTimeout: 15000 });
    const timer = setTimeout(() => finish(new Error(`${label}: handshake timed out`)), 18000);
    let done = false;
    function finish(err?: Error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (ws.readyState === WebSocket.OPEN) ws.close();
      else if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
      if (err) reject(err); else resolve();
    }
    ws.on('error', () => finish(new Error(`${label}: WebSocket connection failed (DNS, TLS, token or provider).`)));
    ws.on('unexpected-response', (_req, res) => { res.resume(); finish(new Error(`${label}: HTTP ${res.statusCode}`)); });
    ws.once('open', () => finish());
  });
  console.log(`${label}: handshake OK (not proof of successful sync)`);
}
console.log('LOT PREPROD LEDGER 9 FAST START — READ ONLY');
console.log('Wallet identity verified. Network:', networkId);
console.log(saved ? 'Restoring Ledger 9 checkpoint.' : old ? 'Preserving old checkpoint; reusing shielded and unshielded, starting DUST at Ledger 9.' : 'No checkpoint for this wallet; initializing shielded and unshielded from verified keys, starting DUST at Ledger 9.');
const health = await fetch(config.indexerHttpUrl, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({query: 'query LotHealth { __typename }'}),
  signal: AbortSignal.timeout(15000), redirect: 'error',
});
if (!health.ok) throw new Error(`Indexer HTTP: ${health.status}`);
const healthBody = await health.json();
if (!healthBody.data?.__typename || healthBody.errors?.length) throw new Error('Indexer GraphQL health query failed.');
console.log('Indexer HTTP: OK');
await checkSocket('Indexer WS', config.indexerWsUrl, ['graphql-transport-ws']);
await verifyRpc();
if (!saved) {
  const before = await dustEvent(cursor);
  const after = await dustEvent(cursor + 1);
  if (before.id !== cursor || before.version >= 2000000n || after.id !== cursor + 1 || after.version !== runtime) {
    throw new Error('Published Ledger 9 boundary could not be verified; stopping without altering checkpoints.');
  }
  console.log('Ledger 9 boundary verified:', cursor, '→', after.id, 'protocol', String(after.version));
}
const dustConfig = (cfg: any) => ({ ...cfg,
  dustTimelineStartProbe: async () => Option.some({cursor: BigInt(cursor), version: ProtocolVersion.ProtocolVersion(runtime)}),
  batchUpdates: {size:500, timeout:200, spacing:0},
});

let wallet: InstanceType<typeof WalletFacade> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let pending: Promise<void> | undefined;
let stopping = false;
let lastUpdate = 0;
let stopRequested!: () => void;
let timedOut = false;
let deadline: ReturnType<typeof setTimeout> | undefined;
const interrupted = new Promise<'interrupted'>(resolve => { stopRequested = () => resolve('interrupted'); });
const onSignal = () => { stopping = true; stopRequested(); };
process.once('SIGINT', onSignal);
process.once('SIGTERM', onSignal);

async function save() {
  if (!wallet) return;
  if (pending) return pending;
  const current = wallet;
  pending = (async () => {
    const [shielded, unshielded, dust] = await Promise.all([
      current.shielded.serializeState(), current.unshielded.serializeState(), current.dust.serializeState(),
    ]);
    if (![shielded, unshielded, dust].every(x => typeof x === 'string' && x.length > 0)) {
      throw new Error('SDK returned an unexpected snapshot format; existing checkpoint preserved.');
    }
    const snapshot: Snapshot = {version: 1, network: networkId, address, sdk: '2.0.1', shielded, unshielded, dust};
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' });
      await rename(tmp, file);
    } finally { await unlink(tmp).catch(() => {}); }
    console.log('Checkpoint saved:', new Date().toISOString());
  })();
  try { await pending; } finally { pending = undefined; }
}
function showProgress(state: any) {
  // Log only simple public synchronization counters, never raw wallet state.
  for (const key of ['shielded', 'unshielded', 'dust']) {
    const sub = state[key];
    const progress = sub?.progress;
    if (progress && typeof progress === 'object') {
      const counters = Object.entries(progress).filter(([k,v]) => /index|height|tip|current|total|sync/i.test(k) && ['number','bigint','boolean'].includes(typeof v));
      if (counters.length) console.log(`${key}:`, counters.map(([k,v]) => `${k}=${String(v)}`).join(' '));
    }
  }
}
try {
  wallet = await WalletFacade.init({
    configuration,
    shielded: (cfg) => (saved ?? old) ? ShieldedWallet(cfg).restore((saved ?? old)!.shielded) : ShieldedWallet(cfg).startWithSeed(seeds.shielded),
    unshielded: (cfg) => (saved ?? old) ? UnshieldedWallet(cfg).restore((saved ?? old)!.unshielded) : UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(signingKey)),
    dust: (cfg) => saved ? DustWallet(dustConfig(cfg)).restore(saved.dust) : DustWallet(dustConfig(cfg)).startWithSeed(seeds.dust),
  });
  if (![wallet.shielded, wallet.unshielded, wallet.dust].every(w => typeof w.serializeState === 'function')) {
    throw new Error('Installed SDK does not expose the expected snapshot API. No new sync started.');
  }
  await wallet.start(seeds);
  console.log('Wallet started. Ten-minute diagnostic sync limit; checkpoints every 60 seconds.');
  deadline = setTimeout(() => { timedOut = true; onSignal(); }, 10 * 60_000);
  timer = setInterval(() => {
    if (!stopping) void save().catch(() => console.warn('Checkpoint not saved this interval; previous snapshot preserved.'));
  }, 60000);
  const subscription = wallet.state().subscribe({
    next: (state) => {
      if (Date.now() - lastUpdate >= 30000) {
        lastUpdate = Date.now();
        console.log('Wallet synchronization:', state.isSynced ? 'synced' : 'still syncing');
        showProgress(state);
        console.log('Protocol phase:', state.protocol?._tag ?? 'unknown');
      }
    },
    error: () => console.warn('Wallet state stream reported an error.'),
  });
  try {
    const result = await Promise.race([firstValueFrom(wallet.state().pipe(filter(s => s.isSynced && s.protocol?._tag === 'Settled'))), interrupted]);
    if (result === 'interrupted') {
      console.log(timedOut ? 'DIAGNOSTIC LIMIT REACHED: wallet not yet fully synced and settled.' : 'Stop requested; attempting final checkpoint.');
      if (timedOut) process.exitCode = 2;
    } else {
      const night = result.unshielded.balances[unshieldedToken().raw] ?? 0n;
      const dust = result.dust.balance(new Date());
      console.log('=== VERIFIED WALLET STATE AT SYNC TIME ===');
      console.log('Wallet synchronization: synced; protocol Settled');
      console.log('tNIGHT (STAR units):', night.toString());
      console.log('tDUST (SPECK units):', dust.toString());
      console.log('Spendable tDUST detected:', dust > 0n ? 'YES' : 'NO');
      console.log('Registered NIGHT coins:', result.unshielded.availableCoins.filter(c => c.meta?.registeredForDustGeneration === true).length);
    }
    stopping = true;
    if (timer) clearInterval(timer);
    if (pending) await pending;
    await save();
    console.log('READ ONLY: No transaction submitted.');
  } finally { subscription.unsubscribe(); }
} finally {
  stopping = true;
  if (deadline) clearTimeout(deadline);
  if (timer) clearInterval(timer);
  if (pending) await pending.catch(() => {});
  if (wallet) await wallet.stop();
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);
}
