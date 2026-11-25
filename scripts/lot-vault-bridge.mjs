/**
 * LOT Build 10 — one-use, Unix-domain-socket bridge from an encrypted local
 * report vault to the disposable Ledger 9 integration test.  The socket path
 * (never measurements, salt, or passphrase) is sent through the environment.
 * This is local developer tooling, NOT a remote or multi-user sharing channel.
 */
import net from 'node:net';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validatePrivateReport } from './lot-private-vault.mjs';

const MAX_PAYLOAD = 4096;
const PASSABLE_POLICY = /^[A-Za-z0-9-]{1,36}$/;

export function parseVaultProofArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 4) {
    throw new Error('Usage: npm run vault:prove -- LOT-3001 B-01 530 100');
  }
  const [batchId, policyId, minText, maxText] = argv;
  if (!/^LOT-[A-Z0-9-]{1,48}$/.test(batchId) || !PASSABLE_POLICY.test(policyId)) {
    throw new Error('Invalid batch or buyer policy ID.');
  }
  if (!/^(0|[1-9][0-9]*)$/.test(minText) || !/^(0|[1-9][0-9]*)$/.test(maxText)) {
    throw new Error('Thresholds must be whole nonnegative numbers.');
  }
  const minStrength = Number(minText), maxDefectsBps = Number(maxText);
  if (!Number.isSafeInteger(minStrength) || minStrength < 1 || minStrength > 1_000_000_000 ||
      !Number.isSafeInteger(maxDefectsBps) || maxDefectsBps < 0 || maxDefectsBps > 10_000) {
    throw new Error('Invalid strength or defect limit.');
  }
  return Object.freeze({ batchId, policyId, minStrength, maxDefectsBps });
}

export function checkPolicyForReport(reportInput, policy) {
  const report = validatePrivateReport(reportInput);
  if (report.batchId !== policy.batchId) throw new Error('Vault batch ID does not match the request.');
  if (report.strengthMpa < policy.minStrength || report.defectBps > policy.maxDefectsBps) {
    throw new Error('Report does not qualify for this buyer policy. No proof submitted.');
  }
  return true;
}

export async function createOneUsePrivateBridge(reportInput) {
  const report = validatePrivateReport(reportInput);
  const dir = mkdtempSync(path.join(tmpdir(), 'lot-vault-ipc-'));
  chmodSync(dir, 0o700);
  const socketPath = path.join(dir, 'report.sock');
  const payload = JSON.stringify(report);
  if (Buffer.byteLength(payload) > MAX_PAYLOAD) throw new Error('Report payload too large.');
  let used = false;
  let closed = false;
  const server = net.createServer(socket => {
    if (used) { socket.destroy(); return; }
    used = true;
    // Only a single local consumer can obtain the report. No plaintext files.
    socket.end(payload);
  });
  try {
    server.listen(socketPath);
    await once(server, 'listening');
    chmodSync(socketPath, 0o600);
  } catch (err) {
    server.close();
    rmSync(dir, {recursive:true,force:true});
    throw err;
  }
  return {
    socketPath,
    get used() { return used; },
    async close() {
      if (closed) return;
      closed = true;
      // Prevent a stuck child from leaving the developer's CLI hanging.
      server.close();
      rmSync(dir,{recursive:true,force:true});
    },
  };
}

export async function receiveOneUsePrivateReport(socketPath) {
  if (typeof socketPath !== 'string' || socketPath.length < 8 || !socketPath.startsWith('/')) {
    throw new Error('Invalid private local report socket.');
  }
  return await new Promise((resolve, reject) => {
    let data = '';
    let completed = false;
    const fail = (err) => { if (!completed) { completed = true; reject(err); } };
    const client = net.createConnection({path:socketPath});
    client.setTimeout(15000, () => { client.destroy(); fail(new Error('Vault bridge timed out.')); });
    client.on('data', chunk => {
      data += chunk.toString('utf8');
      if (Buffer.byteLength(data) > MAX_PAYLOAD) {
        client.destroy(); fail(new Error('Private report exceeds transport limit.'));
      }
    });
    client.on('error', fail);
    client.on('end', () => {
      if (completed) return;
      try {
        const report = validatePrivateReport(JSON.parse(data));
        completed = true; resolve(report);
      } catch { fail(new Error('Private report bridge returned invalid data.')); }
    });
  });
}
