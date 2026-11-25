import test from 'node:test';
import assert from 'node:assert/strict';
import {publicLedgerSummary} from '../scripts/lot-chain-utils.mjs';
const address='a'.repeat(64);
const ledger={inspections:{size:()=>2n},minimumStrength:{size:()=>3n},clearances:{size:()=>1n},secret:'never export', strength:999, salt:'private'};
test('public evidence contains only the allowlisted fields',()=>{
  const result=publicLedgerSummary(address,ledger,new Date('2026-11-21T12:00:00Z'));
  assert.deepEqual(Object.keys(result),['ok','network','contractAddress','inspections','policies','clearances','checkedAt']);
  assert.equal(result.clearances,1);
  assert.equal(JSON.stringify(result).includes('never export'),false);
  assert.equal(JSON.stringify(result).includes('999'),false);
  assert.equal(JSON.stringify(result).includes('private'),false);
});
test('rejects missing ledger fields and malformed addresses',()=>{
  assert.throws(()=>publicLedgerSummary('bad',ledger),/address/);
  assert.throws(()=>publicLedgerSummary(address,{...ledger,clearances:null}),/clearances/);
});
