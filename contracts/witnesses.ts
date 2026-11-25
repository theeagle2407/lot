/**
 * Genuine witness implementation for the generated LOT Compact contract.
 * Secrets belong in the user's private state, never in a shared React bundle.
 * The zeroed fallback allows a caller without an inspector/admin role to load
 * a contract and invoke proveClearance; it does NOT authorize privileged calls.
 */
import type { Witnesses } from './managed/lot/contract/index.js';

export type LotPrivateState = {
  readonly inspectorSecret?: Uint8Array;
  readonly policyAdminSecret?: Uint8Array;
};

const emptySecret = (): Uint8Array => new Uint8Array(32);

export const witnesses: Witnesses<LotPrivateState> = {
  localInspectorSecret: ({ privateState }) => [
    privateState,
    privateState.inspectorSecret ?? emptySecret(),
  ],
  localPolicyAdminSecret: ({ privateState }) => [
    privateState,
    privateState.policyAdminSecret ?? emptySecret(),
  ],
};
