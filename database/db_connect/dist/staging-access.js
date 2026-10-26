"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAuthorizedBatch = resolveAuthorizedBatch;
exports.resolveSystemBatch = resolveSystemBatch;
const actor_context_1 = require("./actor-context");
const authorization_1 = require("./authorization");
/** Resolve the batch and institution ownership from PostgreSQL inside the caller's transaction. */
async function resolveAuthorizedBatch(tx, actorUserId, batchId, lock = false) {
    const actor = await (0, actor_context_1.resolveActorContext)(tx, actorUserId);
    const lockClause = lock ? "FOR UPDATE OF b FOR SHARE OF i" : "FOR SHARE OF b, i";
    const result = await tx.query(`SELECT b.batch_id::text AS "batchId", i.institution_id::text AS "institutionId", b.academic_year AS "academicYear", i.affiliating_body_id::text AS "affiliatingBodyId", i.aicte_region AS "aicteRegion" FROM staging.submission_batches b JOIN master.institutions i ON i.institution_id = b.institution_id WHERE b.batch_id = $1::uuid ${lockClause}`, [batchId]);
    const row = result.rows[0];
    if (!row)
        throw new Error("Submission batch is unavailable.");
    const scope = { institutionId: row.institutionId, affiliatingBodyId: row.affiliatingBodyId, aicteRegion: row.aicteRegion };
    (0, authorization_1.authorizeMasterAccess)(actor, "master.institution.read", scope);
    return { batchId: row.batchId, institutionId: row.institutionId, academicYear: row.academicYear, scope };
}
/** Restricted worker path: callers must already be inside the internal system transaction wrapper. */
async function resolveSystemBatch(tx, batchId, lock = false) {
    const lockClause = lock ? "FOR UPDATE OF b FOR SHARE OF i" : "FOR SHARE OF b, i";
    const result = await tx.query(`SELECT b.batch_id::text AS "batchId", i.institution_id::text AS "institutionId", b.academic_year AS "academicYear", b.status::text AS status, i.affiliating_body_id::text AS "affiliatingBodyId", i.aicte_region AS "aicteRegion" FROM staging.submission_batches b JOIN master.institutions i ON i.institution_id = b.institution_id WHERE b.batch_id = $1::uuid ${lockClause}`, [batchId]);
    const row = result.rows[0];
    if (!row)
        throw new Error("Submission batch is unavailable.");
    return { batchId: row.batchId, institutionId: row.institutionId, academicYear: row.academicYear, status: row.status, scope: { institutionId: row.institutionId, affiliatingBodyId: row.affiliatingBodyId, aicteRegion: row.aicteRegion } };
}
