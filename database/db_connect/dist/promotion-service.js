"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.promoteBatch = promoteBatch;
exports.promoteProgramBatch = promoteProgramBatch;
exports.finalizeBatch = finalizeBatch;
exports.promoteBatchAsSystem = promoteBatchAsSystem;
exports.promoteProgramBatchAsSystem = promoteProgramBatchAsSystem;
exports.finalizeBatchAsSystem = finalizeBatchAsSystem;
const pool_1 = require("./pool");
const actor_context_1 = require("./actor-context");
const authorization_1 = require("./authorization");
const cache_invalidation_policy_1 = require("./cache-invalidation-policy");
const staging_access_1 = require("./staging-access");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function promote(actorUserId, requestId, batchId, fn, programId) {
    if (!UUID.test(actorUserId) || !UUID.test(batchId) || (programId !== undefined && !UUID.test(programId)) || typeof requestId !== "string" || !requestId.trim() || requestId.length > 100)
        throw new TypeError("Invalid promotion input.");
    const result = await (0, pool_1.withActorTx)({ actorUserId: actorUserId.toLowerCase(), requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, actorUserId);
        const batch = await tx.query("SELECT institution_id::text, submitted_by::text FROM staging.submission_batches WHERE batch_id = $1::uuid FOR UPDATE", [batchId.toLowerCase()]);
        const row = batch.rows[0];
        if (!row)
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        const allowed = actor.role === "AICTE_SUPER_ADMIN" || (actor.role === "INSTITUTION_NODAL_OFFICER" && actor.institutionId?.toLowerCase() === row.institution_id.toLowerCase());
        if (!allowed)
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        const params = programId === undefined ? [batchId.toLowerCase()] : [batchId.toLowerCase(), programId.toLowerCase()];
        const result = await tx.query(`SELECT ${fn}(${params.map((_, i) => `$${i + 1}`).join(", ")}) AS result`, params);
        if (!result.rows[0])
            throw new Error("Batch promotion returned no result.");
        return result.rows[0].result;
    });
    try {
        await (0, cache_invalidation_policy_1.invalidateForMutation)("promotion", batchId.toLowerCase());
    }
    catch (cause) {
        throw new cache_invalidation_policy_1.PostCommitCacheInvalidationError("Promotion committed, but cache invalidation failed; do not retry the promotion.", cause);
    }
    return result;
}
function promoteBatch(actorUserId, requestId, batchId) {
    return promote(actorUserId, requestId, batchId, "core.promote_batch");
}
function promoteProgramBatch(actorUserId, requestId, batchId, programId) {
    return promote(actorUserId, requestId, batchId, "core.promote_program_batch", programId);
}
async function finalizeBatch(actorUserId, requestId, batchId) {
    if (!UUID.test(actorUserId) || !UUID.test(batchId) || typeof requestId !== "string" || !requestId.trim() || requestId.length > 100)
        throw new TypeError("Invalid finalization input.");
    const status = await (0, pool_1.withActorTx)({ actorUserId: actorUserId.toLowerCase(), requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, actorUserId);
        const batch = await tx.query("SELECT institution_id::text, submitted_by::text FROM staging.submission_batches WHERE batch_id = $1::uuid FOR UPDATE", [batchId.toLowerCase()]);
        const row = batch.rows[0];
        if (!row || !(actor.role === "AICTE_SUPER_ADMIN" || (actor.role === "INSTITUTION_NODAL_OFFICER" && actor.institutionId?.toLowerCase() === row.institution_id.toLowerCase())))
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        const result = await tx.query("SELECT core.finalize_batch($1::uuid)::text AS status", [batchId.toLowerCase()]);
        if (!result.rows[0])
            throw new Error("Batch finalization returned no status.");
        return result.rows[0].status;
    });
    try {
        await (0, cache_invalidation_policy_1.invalidateForMutation)("batch", batchId.toLowerCase());
    }
    catch (cause) {
        throw new cache_invalidation_policy_1.PostCommitCacheInvalidationError("Batch finalization committed, but cache invalidation failed; do not retry finalization.", cause);
    }
    return status;
}
async function systemPromote(batchId, programId) {
    if (!UUID.test(batchId) || (programId !== undefined && !UUID.test(programId)))
        throw new TypeError("Invalid system promotion input.");
    const result = await (0, pool_1.withSystemTx)(async (tx) => {
        const batch = await (0, staging_access_1.resolveSystemBatch)(tx, batchId.toLowerCase(), true);
        if (!(batch.status === "L2_COMPLETED" || batch.status === "L3_PROCESSING"))
            throw new Error("Batch is not ready for promotion.");
        const params = programId === undefined ? [batch.batchId] : [batch.batchId, programId.toLowerCase()];
        const fn = programId === undefined ? "core.promote_batch" : "core.promote_program_batch";
        const call = await tx.query(`SELECT ${fn}(${params.map((_, i) => `$${i + 1}`).join(", ")}) AS result`, params);
        if (!call.rows[0])
            throw new Error("System promotion returned no result.");
        return { batchId: batch.batchId, result: call.rows[0].result };
    });
    try {
        await (0, cache_invalidation_policy_1.invalidateForMutation)("promotion", result.batchId);
    }
    catch (cause) {
        throw new cache_invalidation_policy_1.PostCommitCacheInvalidationError("System promotion committed, but cache invalidation failed; do not retry the promotion.", cause);
    }
    return result.result;
}
function promoteBatchAsSystem(batchId) {
    return systemPromote(batchId);
}
function promoteProgramBatchAsSystem(batchId, programId) {
    return systemPromote(batchId, programId);
}
async function finalizeBatchAsSystem(batchId) {
    if (!UUID.test(batchId))
        throw new TypeError("Batch ID must be a UUID.");
    const status = await (0, pool_1.withSystemTx)(async (tx) => {
        const batch = await (0, staging_access_1.resolveSystemBatch)(tx, batchId.toLowerCase(), true);
        if (!(batch.status === "L2_COMPLETED" || batch.status === "L3_PROCESSING"))
            throw new Error("Batch is not ready for finalization.");
        const result = await tx.query("SELECT core.finalize_batch($1::uuid)::text AS status", [batch.batchId]);
        if (!result.rows[0])
            throw new Error("System finalization returned no result.");
        return { batchId: batch.batchId, status: result.rows[0].status };
    });
    try {
        await (0, cache_invalidation_policy_1.invalidateForMutation)("promotion", status.batchId);
    }
    catch (cause) {
        throw new cache_invalidation_policy_1.PostCommitCacheInvalidationError("System finalization committed, but cache invalidation failed; do not retry finalization.", cause);
    }
    return status.status;
}
