import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  localPolicyAdminSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  registerInspectionSigned(context: __compactRuntime.CircuitContext<PS>,
                           batchId_0: Uint8Array,
                           strength_0: bigint,
                           defectBps_0: bigint,
                           salt_0: Uint8Array,
                           inspectorSignature_0: { announcement: __compactRuntime.JubjubPoint,
                                                   response: bigint
                                                 }): Promise<__compactRuntime.CircuitResults<PS, []>>;
  registerPolicy(context: __compactRuntime.CircuitContext<PS>,
                 policyId_0: Uint8Array,
                 minStrength_0: bigint,
                 maxDefectsBps_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  proveClearance(context: __compactRuntime.CircuitContext<PS>,
                 batchId_0: Uint8Array,
                 policyId_0: Uint8Array,
                 strength_0: bigint,
                 defectBps_0: bigint,
                 salt_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type ProvableCircuits<PS> = {
  registerInspectionSigned(context: __compactRuntime.CircuitContext<PS>,
                           batchId_0: Uint8Array,
                           strength_0: bigint,
                           defectBps_0: bigint,
                           salt_0: Uint8Array,
                           inspectorSignature_0: { announcement: __compactRuntime.JubjubPoint,
                                                   response: bigint
                                                 }): Promise<__compactRuntime.CircuitResults<PS, []>>;
  registerPolicy(context: __compactRuntime.CircuitContext<PS>,
                 policyId_0: Uint8Array,
                 minStrength_0: bigint,
                 maxDefectsBps_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  proveClearance(context: __compactRuntime.CircuitContext<PS>,
                 batchId_0: Uint8Array,
                 policyId_0: Uint8Array,
                 strength_0: bigint,
                 defectBps_0: bigint,
                 salt_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type PureCircuits = {
  reportSignatureMessage(batchId_0: Uint8Array,
                         strength_0: bigint,
                         defectBps_0: bigint,
                         salt_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  reportSignatureMessage(context: __compactRuntime.CircuitContext<PS>,
                         batchId_0: Uint8Array,
                         strength_0: bigint,
                         defectBps_0: bigint,
                         salt_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  registerInspectionSigned(context: __compactRuntime.CircuitContext<PS>,
                           batchId_0: Uint8Array,
                           strength_0: bigint,
                           defectBps_0: bigint,
                           salt_0: Uint8Array,
                           inspectorSignature_0: { announcement: __compactRuntime.JubjubPoint,
                                                   response: bigint
                                                 }): Promise<__compactRuntime.CircuitResults<PS, []>>;
  registerPolicy(context: __compactRuntime.CircuitContext<PS>,
                 policyId_0: Uint8Array,
                 minStrength_0: bigint,
                 maxDefectsBps_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  proveClearance(context: __compactRuntime.CircuitContext<PS>,
                 batchId_0: Uint8Array,
                 policyId_0: Uint8Array,
                 strength_0: bigint,
                 defectBps_0: bigint,
                 salt_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type Ledger = {
  readonly inspectorVerificationKey: __compactRuntime.JubjubPoint;
  readonly policyAdminKeyHash: Uint8Array;
  inspections: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  minimumStrength: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  maximumDefectsBps: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, bigint]>
  };
  clearances: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<[Uint8Array, boolean]>
  };
}

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               inspectorKey_0: __compactRuntime.JubjubPoint,
               policyAdminSecret_0: Uint8Array): Promise<__compactRuntime.ConstructorResult<PS>>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
export declare const expectedVk: Record<string, string>;
export declare const circuitSignatures: __compactRuntime.CircuitSignatures;
export declare const declaredInterfaces: __compactRuntime.DeclaredInterfaces;
