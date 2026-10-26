// APAAR / ABC registry lookup used by L2 identity verification.
//
// Only the "not configured" registry exists for now: identities are taken as declared by the
// institution (staging rows are marked abc_response_ref = 'SELF_DECLARED'). When DigiLocker / ABC
// credentials are available, add a registry here that calls the API and return it from apaarRegistry().

export type RegistryResult =
  | { status: "FOUND"; fullName: string; dateOfBirth: string; responseRef: string }
  | { status: "NOT_FOUND"; responseRef: string }
  | { status: "INACTIVE"; responseRef: string }
  | { status: "UNAVAILABLE"; reason: string }
  | { status: "NOT_CONFIGURED" };

export interface ApaarRegistry {
  readonly name: string;
  lookupMany(apaarIds: string[]): Promise<Map<string, RegistryResult>>;
}

const notConfigured: ApaarRegistry = {
  name: "not-configured",
  async lookupMany(apaarIds) {
    return new Map(apaarIds.map((id) => [id, { status: "NOT_CONFIGURED" } as const]));
  },
};

export function apaarRegistry(): ApaarRegistry {
  // TODO(digilocker): return a DigiLocker/ABC-backed registry when DIGILOCKER_* credentials are set.
  return notConfigured;
}
