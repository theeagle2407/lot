/**
 * LOT Build 29: One-buyer OFFLINE HTML evidence export.
 * Never a live or independent Midnight verification. Deliberately no fetch, JS,
 * external resources, login state, material readings, salts, keys or witnesses.
 */
import { exportSavedClearance } from './evidence.js';
import { isCurrentLocalClearance } from './v2Audit.js';
import { freshLocalAudit } from './buyerStatus.js';

function escapeHtml(value) {
 return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
   .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function stamp(value) {
 if(typeof value!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value))
   throw new Error('A valid local ledger-check timestamp is required.');
 const d=new Date(value);
 if(!Number.isFinite(d.getTime()) || d.toISOString()!==value)throw new Error('Invalid verification timestamp.');
 return value;
}

/**
 * Refuses stale, fabricated or mismatched local audit input. The resulting page
 * is an untrusted snapshot after download; it does NOT prove chain membership.
 */
export function makePortableBuyerPage(clearance,audit,now=Date.now()) {
 if(!isCurrentLocalClearance(audit,clearance) || !freshLocalAudit(audit,now))
   throw new Error('Recheck the exact buyer clearance against the local ledger before exporting.');
 const snapshot=exportSavedClearance(clearance); // allowlisted public fields only
 const checkedAt=stamp(audit.checkedAt);
 const recordedMs=Date.parse(checkedAt);
 if(recordedMs>now+30000 || now-recordedMs>120000)
   throw new Error('The ledger check time is outside the permitted export window.');
 const exportedAt=new Date(now).toISOString();
 const safe=x=>escapeHtml(x);
 const lines={
   batch:safe(snapshot.batchId),policy:safe(snapshot.policyId),
   min:safe(snapshot.policy.minStrength),max:safe((snapshot.policy.maxDefectsBps/100).toFixed(2)),
   contract:safe(snapshot.contractAddress),inspection:safe(snapshot.transactions.inspection),
   policyTx:safe(snapshot.transactions.policy),clearance:safe(snapshot.transactions.clearance),
   exported:safe(exportedAt),checked:safe(checkedAt),
 };
 return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow,noarchive">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; object-src 'none'">
<title>LOT — ${lines.batch} / ${lines.policy} — local evidence</title>
<style>
:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f7f7f4;color:#1e2926}
*{box-sizing:border-box}body{margin:0;padding:0 18px}main{max-width:720px;margin:64px auto 90px}
.brand{letter-spacing:-.045em;font-size:26px;font-weight:750}.brand span{color:#97a19d}.kicker{margin:45px 0 10px;font-size:11px;font-weight:750;letter-spacing:.14em;color:#606e68}
h1{font-size:clamp(32px,6vw,45px);line-height:1.1;letter-spacing:-.045em;margin:0 0 10px}p{color:#606e68;line-height:1.65;margin:0 0 16px}
.panel{border:1px solid #dfe3dd;background:#fff;border-radius:15px;padding:27px;margin-top:25px}
.notice{border-left:3px solid #7d867d;background:#eff2ed;padding:15px 17px;margin:24px 0;font-size:14px;line-height:1.6;color:#36423b}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:20px}label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.11em;color:#798580;margin-bottom:7px}
strong{font-size:20px;letter-spacing:-.025em}.identifier{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;overflow-wrap:anywhere;line-height:1.7;color:#2e3834;margin:3px 0 20px}
hr{border:0;border-top:1px solid #e7eae5;margin:24px 0}.foot{margin-top:34px;font-size:12px}
@media(max-width:540px){main{margin:30px auto 50px}.panel{padding:20px}.grid{grid-template-columns:1fr;gap:14px}}
@media print{body{background:white}main{margin:12px auto}.panel{break-inside:avoid}}
</style></head><body><main>
<div class="brand">LOT<span>.</span></div>
<div class="kicker">PORTABLE BUYER EVIDENCE / LOCAL DEVELOPMENT</div>
<h1>${lines.batch}</h1><p>Buyer policy ${lines.policy} · Archived clearance record</p>
<div class="notice"><strong style="font-size:14px">Not independently verified</strong><br>
This file describes a synthetic clearance that LOT checked on a <b>private local Midnight network</b> at export time.
It cannot connect to that chain, refresh its status or prove that this document has not been modified.
For independent verification, require a deployment on a publicly accessible Midnight network and a trusted inspector identity.</div>
<section class="panel" aria-label="Buyer requirements"><label>Recorded policy</label>
<div class="grid"><div><label>Minimum strength</label><strong>≥ ${lines.min} MPa</strong></div>
<div><label>Maximum defects</label><strong>≤ ${lines.max}%</strong></div></div>
<hr><label>Underlying measurements</label><p>Not included in this file.</p></section>
<section class="panel" aria-label="Public identifiers"><label>Contract identifier (local network)</label><div class="identifier">${lines.contract}</div>
<label>Inspection transaction</label><div class="identifier">${lines.inspection}</div>
<label>Policy transaction</label><div class="identifier">${lines.policyTx}</div>
<label>Clearance transaction</label><div class="identifier">${lines.clearance}</div>
<hr><label>Local ledger checked by LOT</label><div class="identifier">${lines.checked}</div>
<label>File generated</label><div class="identifier">${lines.exported}</div></section>
<p class="foot">LOT portable evidence · Read-only, offline HTML · No passwords, signing keys, private measurements or network connections. The contents are not an authenticated third-party certificate.</p>
</main></body></html>`;
}

export function portableBuyerFilename(clearance){
 const s=exportSavedClearance(clearance);
 return `${s.batchId.toLowerCase()}-${s.policyId.toLowerCase()}-local-evidence.html`;
}
