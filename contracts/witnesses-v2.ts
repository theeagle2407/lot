/**
 * LOT V2 witness adapter. Only the policy operator needs a secret witness;
 * inspector registration is authorized by an on-chain-verified Jubjub signature.
 * This module is for local development, NOT identity accreditation.
 */
import type { Witnesses } from './managed/lot-v2/contract/index.js';

export type LotV2PrivateState = {
  readonly policyAdminSecret?: Uint8Array;
};

const emptySecret = () => new Uint8Array(32);

export const v2Witnesses: Witnesses<LotV2PrivateState> = {
  localPolicyAdminSecret: ({ privateState }) => [
    privateState,
    privateState.policyAdminSecret ?? emptySecret(),
  ],
};
