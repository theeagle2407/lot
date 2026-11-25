// Plain ESM mirror of witnesses.ts for Node's built-in contract simulator runner.
// This module does not contain any example production keys.
const zeros = () => new Uint8Array(32);
export const witnesses = {
  localInspectorSecret: ({privateState}) => [privateState, privateState.inspectorSecret ?? zeros()],
  localPolicyAdminSecret: ({privateState}) => [privateState, privateState.policyAdminSecret ?? zeros()],
};
