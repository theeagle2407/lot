/**
 * Local development only. Split role witnesses before initializing independent
 * per-wallet Midnight private-state providers. This helper does not persist
 * secret keys, inspection measurements, or report salts.
 *
 * A role secret is a bearer credential, NOT a wallet-address signature.
 * Production must bind credentials to an independently verified issuer.
 */
import { timingSafeEqual } from 'node:crypto';

function key32(name, value) {
  if (!(value instanceof Uint8Array) || value.length !== 32) {
    throw new TypeError(`${name} must be exactly 32 bytes`);
  }
  return new Uint8Array(value);
}

export function splitRoleState(inspectorKey, policyKey) {
  const inspectorSecret = key32('inspectorKey', inspectorKey);
  const policyAdminSecret = key32('policyKey', policyKey);
  if (timingSafeEqual(Buffer.from(inspectorSecret), Buffer.from(policyAdminSecret))) {
    throw new Error('Inspector and policy operator must use different secrets');
  }
  // The manufacturer receives only private measurements + opening salt via
  // separate secure transfer; neither privilege is stored in that wallet.
  return {
    inspector: { inspectorSecret },
    policyOperator: { policyAdminSecret },
    manufacturer: {},
  };
}

export const LOT_ROLE_STATE_IDS = Object.freeze({
  inspector: 'LOT_ROLE_INSPECTOR_V1',
  policyOperator: 'LOT_ROLE_POLICY_OPERATOR_V1',
  manufacturer: 'LOT_ROLE_MANUFACTURER_V1',
});
