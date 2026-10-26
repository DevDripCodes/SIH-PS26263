"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostCommitCacheInvalidationError = void 0;
exports.cacheNamespacesForMutation = cacheNamespacesForMutation;
exports.invalidateForMutation = invalidateForMutation;
exports.invalidateCredentialChanges = invalidateCredentialChanges;
exports.invalidateAnalyticsRefresh = invalidateAnalyticsRefresh;
const versioned_cache_1 = require("./versioned-cache");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class PostCommitCacheInvalidationError extends Error {
    committed = true;
    constructor(message, cause) {
        super(message, { cause });
        this.name = "PostCommitCacheInvalidationError";
    }
}
exports.PostCommitCacheInvalidationError = PostCommitCacheInvalidationError;
function cacheNamespacesForMutation(mutation, id) {
    if (!UUID.test(id))
        throw new TypeError("Cache invalidation ID must be a UUID.");
    const identifier = id.toLowerCase();
    const byMutation = {
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
async function invalidateForMutation(mutation, id) {
    await (0, versioned_cache_1.invalidateCacheNamespaces)(...cacheNamespacesForMutation(mutation, id));
}
async function invalidateCredentialChanges(...credentialIds) {
    if (credentialIds.length === 0)
        throw new Error("At least one credential ID is required.");
    await (0, versioned_cache_1.invalidateCacheNamespaces)(...credentialIds.flatMap(id => cacheNamespacesForMutation("credential", id)));
}
async function invalidateAnalyticsRefresh() {
    await (0, versioned_cache_1.invalidateCacheNamespaces)({ schema: "analytics", resource: "seat-utilisation", identifier: "all" }, { schema: "analytics", resource: "enrolment-summary", identifier: "all" }, { schema: "analytics", resource: "pipeline", identifier: "all" }, { schema: "analytics", resource: "anomaly-summary", identifier: "all" }, { schema: "analytics", resource: "credential-status", identifier: "all" }, { schema: "analytics", resource: "verification-traffic", identifier: "all" }, { schema: "analytics", resource: "quota-reconciliation", identifier: "all" });
}
