export const v2Witnesses = {
  localPolicyAdminSecret: ({ privateState }) => {
    const secret = privateState?.policyAdminSecret;

    if (!(secret instanceof Uint8Array) ||
        secret.length !== 32) {
      throw new Error(
        'Valid policy admin secret required'
      );
    }

    return [privateState, secret];
  },
};
