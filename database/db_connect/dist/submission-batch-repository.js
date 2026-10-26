"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSubmissionBatch = createSubmissionBatch;
exports.getSubmissionBatch = getSubmissionBatch;
exports.listSubmissionBatches = listSubmissionBatches;
exports.transitionSubmissionBatchAsWorker = transitionSubmissionBatchAsWorker;
const actor_context_1 = require("./actor-context");
const authorization_1 = require("./authorization");
const pool_1 = require("./pool");
const staging_access_1 = require("./staging-access");
const cache_invalidation_policy_1 = require("./cache-invalidation-policy");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YEAR = /^(19|20|21)\d{2}-(\d{2})$/;
const CHANNELS = new Set(["CSV_UPLOAD", "EXCEL_UPLOAD", "ERP_API"]);
const WORKER_TRANSITIONS = {
    UPLOADED: new Set(["L1_PROCESSING"]),
    L1_PROCESSING: new Set(["L1_COMPLETED", "FAILED", "CANCELLED"]),
    L1_COMPLETED: new Set(["L2_PROCESSING"]),
    L2_PROCESSING: new Set(["L2_COMPLETED", "FAILED", "CANCELLED"]),
};
const FAILURE_CODES = new Set(["WORKER_TIMEOUT", "SOURCE_FORMAT_INVALID", "UPSTREAM_UNAVAILABLE", "PROCESSING_FAILED"]);
function validateActor(input) { if (!input || !UUID.test(input.actorUserId) || typeof input.requestId !== "string" || !input.requestId.trim() || input.requestId.length > 100)
    throw new TypeError("Valid authenticated actor context is required."); }
function validYear(value) { if (!YEAR.test(value) || Number(value.slice(5)) !== (Number(value.slice(0, 4)) + 1) % 100)
    throw new TypeError("Academic year must use YYYY-YY format."); }
function map(r) { return { batchId: r.batchId, institutionId: r.institutionId, academicYear: r.academicYear, sourceChannel: r.sourceChannel, status: r.status, totalRows: r.totalRows, rejectedRows: r.rejectedRows, quarantinedRows: r.quarantinedRows, promotedRows: r.promotedRows, uploadedAt: r.uploadedAt, completedAt: r.completedAt }; }
const COLUMNS = `batch_id::text AS "batchId", institution_id::text AS "institutionId", academic_year AS "academicYear", source_channel::text AS "sourceChannel", status::text AS status, total_rows AS "totalRows", l1_rejected_rows + l2_quarantined_rows + l3_quarantined_rows AS "rejectedRows", l2_quarantined_rows + l3_quarantined_rows AS "quarantinedRows", promoted_rows AS "promotedRows", uploaded_at AS "uploadedAt", completed_at AS "completedAt"`;
async function createSubmissionBatch(input) {
    validateActor(input);
    if (!UUID.test(input.institutionId))
        throw new TypeError("Institution ID must be a UUID.");
    validYear(input.academicYear);
    if (!CHANNELS.has(input.sourceChannel) || !/^[a-f0-9]{64}$/i.test(input.fileSha256) || (input.fileSizeBytes !== undefined && (!Number.isSafeInteger(input.fileSizeBytes) || input.fileSizeBytes < 0)))
        throw new TypeError("Invalid submission metadata.");
    const institutionId = input.institutionId.toLowerCase();
    const result = await (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId);
        const scope = await tx.query("SELECT institution_id::text AS \"institutionId\", affiliating_body_id::text AS \"affiliatingBodyId\", aicte_region AS \"aicteRegion\" FROM master.institutions WHERE institution_id = $1::uuid FOR SHARE", [institutionId]);
        if (!scope.rows[0])
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        (0, authorization_1.authorizeMasterAccess)(actor, "master.institution.read", scope.rows[0]);
        if (!(actor.role === "AICTE_SUPER_ADMIN" || (actor.role === "INSTITUTION_NODAL_OFFICER" && actor.institutionId?.toLowerCase() === institutionId)))
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        const digest = input.fileSha256.toLowerCase();
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${institutionId}:${digest}`]);
        const existing = await tx.query(`SELECT ${COLUMNS} FROM staging.submission_batches WHERE institution_id = $1::uuid AND file_sha256 = $2 ORDER BY created_at LIMIT 1 FOR SHARE`, [institutionId, digest]);
        if (existing.rows[0])
            return { batch: map(existing.rows[0]), duplicate: true };
        const inserted = await tx.query(`INSERT INTO staging.submission_batches (institution_id, academic_year, submitted_by, source_channel, file_sha256, file_size_bytes) VALUES ($1::uuid, $2, $3::uuid, $4::staging.submission_source_enum, $5, $6) RETURNING ${COLUMNS}`, [institutionId, input.academicYear, actor.userId.toLowerCase(), input.sourceChannel, digest, input.fileSizeBytes ?? null]);
        if (!inserted.rows[0])
            throw new Error("Submission batch creation returned no row.");
        return { batch: map(inserted.rows[0]), duplicate: false };
    });
    if (!result.duplicate) {
        try {
            await (0, cache_invalidation_policy_1.invalidateForMutation)("batch", result.batch.batchId);
        }
        catch (cause) {
            throw new cache_invalidation_policy_1.PostCommitCacheInvalidationError("Submission batch was created, but cache invalidation failed; do not retry creation.", cause);
        }
    }
    return result;
}
async function getSubmissionBatch(input) {
    validateActor(input);
    if (!UUID.test(input.batchId))
        throw new TypeError("Batch ID must be a UUID.");
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const batch = await (0, staging_access_1.resolveAuthorizedBatch)(tx, input.actorUserId, input.batchId.toLowerCase());
        const result = await tx.query(`SELECT ${COLUMNS} FROM staging.submission_batches WHERE batch_id = $1::uuid`, [batch.batchId]);
        if (!result.rows[0])
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        return map(result.rows[0]);
    });
}
async function listSubmissionBatches(input) {
    validateActor(input);
    if (!UUID.test(input.institutionId))
        throw new TypeError("Institution ID must be a UUID.");
    if (input.academicYear !== undefined)
        validYear(input.academicYear);
    const limit = input.limit ?? 100, offset = input.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0 || offset > 100_000)
        throw new RangeError("Invalid batch page bounds.");
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId);
        const scope = await tx.query("SELECT institution_id::text AS \"institutionId\", affiliating_body_id::text AS \"affiliatingBodyId\", aicte_region AS \"aicteRegion\" FROM master.institutions WHERE institution_id = $1::uuid FOR SHARE", [input.institutionId.toLowerCase()]);
        if (!scope.rows[0])
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        (0, authorization_1.authorizeMasterAccess)(actor, "master.institution.read", scope.rows[0]);
        const values = [input.institutionId.toLowerCase()];
        let where = "institution_id = $1::uuid";
        if (input.academicYear) {
            values.push(input.academicYear);
            where += ` AND academic_year = $${values.length}`;
        }
        values.push(limit, offset);
        const result = await tx.query(`SELECT ${COLUMNS} FROM staging.submission_batches WHERE ${where} ORDER BY uploaded_at DESC, batch_id LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
        return result.rows.map(map);
    });
}
/** Worker-only pre-promotion transitions. Promotion/final states remain owned by core's SQL functions. */
async function transitionSubmissionBatchAsWorker(input) {
    if (!UUID.test(input.batchId) || !Object.values(WORKER_TRANSITIONS).some(targets => targets.has(input.nextStatus)))
        throw new TypeError("Invalid worker batch transition.");
    if (input.failureCode !== undefined && !FAILURE_CODES.has(input.failureCode))
        throw new TypeError("Invalid worker failure code.");
    if ((input.nextStatus === "FAILED") !== (input.failureCode !== undefined))
        throw new TypeError("A fixed failure code is required only for failed batches.");
    return (0, pool_1.withSystemTx)(async (tx) => {
        const current = await (0, staging_access_1.resolveSystemBatch)(tx, input.batchId.toLowerCase(), true);
        const oldStatus = current.status;
        if (!oldStatus || !WORKER_TRANSITIONS[oldStatus]?.has(input.nextStatus))
            throw new Error("Batch status transition is not allowed.");
        const totals = await tx.query(`SELECT count(*)::integer AS total, count(*) FILTER (WHERE validation_status = 'REJECTED' AND rejected_at_level = 1)::integer AS l1, count(*) FILTER (WHERE validation_status = 'QUARANTINED' AND rejected_at_level = 2)::integer AS l2, count(*) FILTER (WHERE validation_status = 'QUARANTINED' AND rejected_at_level = 3)::integer AS l3, count(*) FILTER (WHERE validation_status = 'VALID')::integer AS promoted FROM staging.staging_enrolment_records WHERE batch_id = $1::uuid`, [input.batchId.toLowerCase()]);
        const c = totals.rows[0];
        if (!c)
            throw new Error("Batch counters could not be calculated.");
        const done = ["FAILED", "CANCELLED"].includes(input.nextStatus);
        const update = await tx.query(`UPDATE staging.submission_batches SET status = $2::staging.batch_status_enum, total_rows = $3, l1_rejected_rows = $4, l2_quarantined_rows = $5, l3_quarantined_rows = $6, promoted_rows = $7, processing_started_at = CASE WHEN $2 IN ('L1_PROCESSING', 'L2_PROCESSING') THEN COALESCE(processing_started_at, now()) ELSE processing_started_at END, completed_at = CASE WHEN $8 THEN now() ELSE completed_at END, failure_reason = COALESCE($9, failure_reason) WHERE batch_id = $1::uuid AND status::text = $10 RETURNING ${COLUMNS}`, [input.batchId.toLowerCase(), input.nextStatus, c.total, c.l1, c.l2, c.l3, c.promoted, done, input.failureCode ?? null, oldStatus]);
        if (!update.rows[0])
            throw new Error("Batch status changed concurrently.");
        return map(update.rows[0]);
    }).then(async (batch) => {
        try {
            await (0, cache_invalidation_policy_1.invalidateForMutation)("batch", batch.batchId);
        }
        catch (cause) {
            throw new cache_invalidation_policy_1.PostCommitCacheInvalidationError("Batch status was committed, but cache invalidation failed; do not retry the transition.", cause);
        }
        return batch;
    });
}
