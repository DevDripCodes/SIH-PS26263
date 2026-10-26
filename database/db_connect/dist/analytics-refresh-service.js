"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshAnalyticsAsAdmin = refreshAnalyticsAsAdmin;
exports.refreshAnalyticsAsSystem = refreshAnalyticsAsSystem;
const actor_context_1 = require("./actor-context");
const pool_1 = require("./pool");
const cache_invalidation_policy_1 = require("./cache-invalidation-policy");
async function refreshAnalyticsAsAdmin(actorUserId, requestId, force = false) {
    if (!/^[0-9a-f-]{36}$/i.test(actorUserId) || typeof requestId !== "string" || !requestId.trim() || requestId.length > 100 || typeof force !== "boolean")
        throw new TypeError("Invalid analytics refresh input.");
    const result = await (0, pool_1.withActorTx)({ actorUserId: actorUserId.toLowerCase(), requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, actorUserId);
        if (actor.role !== "AICTE_SUPER_ADMIN")
            throw new Error("Analytics refresh is restricted.");
        const result = await tx.query("SELECT analytics.refresh_all($1) AS result", [force]);
        if (!result.rows[0])
            throw new Error("Analytics refresh returned no result.");
        return result.rows[0].result;
    });
    if (result.status === "DONE" && Object.values(result.views ?? {}).includes("OK")) {
        try {
            await (0, cache_invalidation_policy_1.invalidateAnalyticsRefresh)();
        }
        catch (cause) {
            throw new cache_invalidation_policy_1.PostCommitCacheInvalidationError("Analytics refresh committed, but cache invalidation failed; cached analytics may remain stale until their TTL expires.", cause);
        }
    }
    return result;
}
async function refreshAnalyticsAsSystem() {
    const result = await (0, pool_1.withSystemTx)(async (tx) => {
        const result = await tx.query("SELECT analytics.refresh_all(FALSE) AS result");
        if (!result.rows[0])
            throw new Error("Analytics refresh returned no result.");
        return result.rows[0].result;
    });
    if (result.status === "DONE" && Object.values(result.views ?? {}).includes("OK")) {
        try {
            await (0, cache_invalidation_policy_1.invalidateAnalyticsRefresh)();
        }
        catch (cause) {
            throw new cache_invalidation_policy_1.PostCommitCacheInvalidationError("Analytics refresh committed, but cache invalidation failed; cached analytics may remain stale until their TTL expires.", cause);
        }
    }
    return result;
}
