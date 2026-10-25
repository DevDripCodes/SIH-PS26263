import { invalidateCacheNamespaces } from "./versioned-cache";
import type { CacheVersionNamespace } from "./cache-version";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Invalidation is post-commit; without an outbox, Redis outages can leave old values until their TTL expires.
type DomainMutation = "institution" | "program" | "intake" | "batch" | "promotion" | "credential" | "consent" | "verification";

export class PostCommitCacheInvalidationError extends Error {
  readonly committed = true;
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "PostCommitCacheInvalidationError";
  }
}

export function cacheNamespacesForMutation(mutation: DomainMutation, id: string): CacheVersionNamespace[] {
  if (!UUID.test(id)) throw new TypeError("Cache invalidation ID must be a UUID.");
  const identifier = id.toLowerCase();
  const byMutation: Record<DomainMutation, CacheVersionNamespace[]> = {
    institution: [{ schema: "master", resource: "institution", identifier }],
    program: [{ schema: "master", resource: "program", identifier }, { schema: "analytics", resource: "seat-utilisation", identifier: "all" }, { schema: "analytics", resource: "enrolment-summary", identifier: "all" }],
    intake: [{ schema: "master", resource: "intake", identifier }, { schema: "analytics", resource: "seat-utilisation", identifier: "all" }, { schema: "analytics", resource: "quota-reconciliation", identifier: "all" }],
    batch: [{ schema: "staging", resource: "batch", identifier }, { schema: "analytics", resource: "pipeline", identifier: "all" }],
    promotion: [{ schema: "staging", resource: "batch", identifier }, { schema: "analytics", resource: "pipeline", identifier: "all" }, { schema: "analytics", resource: "anomaly-summary", identifier: "all" }, { schema: "analytics", resource: "seat-utilisation", identifier: "all" }, { schema: "analytics", resource: "enrolment-summary", identifier: "all" }, { schema: "analytics", resource: "quota-reconciliation", identifier: "all" }],
    credential: [{ schema: "trust", resource: "credential", identifier }, { schema: "analytics", resource: "credential-status", identifier: "all" }],
    consent: [{ schema: "trust", resource: "consent", identifier }],
    verification: [{ schema: "analytics", resource: "verification-traffic", identifier: "all" }],
  };
  return byMutation[mutation];
}

export async function invalidateForMutation(mutation: DomainMutation, id: string): Promise<void> {
  await invalidateCacheNamespaces(...cacheNamespacesForMutation(mutation, id));
}

export async function invalidateCredentialChanges(...credentialIds: string[]): Promise<void> {
  if (credentialIds.length === 0) throw new Error("At least one credential ID is required.");
  await invalidateCacheNamespaces(...credentialIds.flatMap(id => cacheNamespacesForMutation("credential", id)));
}

export async function invalidateAnalyticsRefresh(): Promise<void> {
  await invalidateCacheNamespaces(
    { schema: "analytics", resource: "seat-utilisation", identifier: "all" },
    { schema: "analytics", resource: "enrolment-summary", identifier: "all" },
    { schema: "analytics", resource: "pipeline", identifier: "all" },
    { schema: "analytics", resource: "anomaly-summary", identifier: "all" },
    { schema: "analytics", resource: "credential-status", identifier: "all" },
    { schema: "analytics", resource: "verification-traffic", identifier: "all" },
    { schema: "analytics", resource: "quota-reconciliation", identifier: "all" },
  );
}
