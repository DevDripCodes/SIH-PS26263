"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ingestStagingRecords = ingestStagingRecords;
exports.listStagingRecordSummaries = listStagingRecordSummaries;
exports.listStagingAnomalies = listStagingAnomalies;
exports.getStagingStatusSummary = getStagingStatusSummary;
const authorization_1 = require("./authorization");
const pool_1 = require("./pool");
const staging_access_1 = require("./staging-access");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROWS = 500;
const RAW_FIELDS = ["raw_apaar_id", "raw_full_name", "raw_date_of_birth", "raw_gender", "raw_email", "raw_mobile", "raw_roll_no", "raw_program_code", "raw_admission_date", "raw_social_category", "raw_residency_status", "raw_seat_quota_type", "raw_is_fn", "raw_is_oci_status", "raw_nationality", "raw_passport_no", "raw_passport_expiry", "raw_visa_type", "raw_frro_reg_no", "raw_oci_card_no", "raw_embassy_sponsor_ref"];
function validate(input, batchId) { if (!input || !UUID.test(input.actorUserId) || !input.requestId?.trim() || input.requestId.length > 100 || !UUID.test(batchId))
    throw new TypeError("Invalid staging record request."); }
function bounds(limit = 100, offset = 0) { if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0 || offset > 100_000)
    throw new RangeError("Invalid staging page bounds."); }
async function ingestStagingRecords(input) {
    validate(input, input.batchId);
    if (!Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > MAX_ROWS)
        throw new RangeError("Ingestion is limited to 1–500 rows.");
    const seen = new Set();
    const payload = input.rows.map(row => {
        if (!row || !Number.isSafeInteger(row.sourceRowNumber) || row.sourceRowNumber < 1 || row.sourceRowNumber > 2_147_483_647 || seen.has(row.sourceRowNumber))
            throw new TypeError("Source row numbers must be unique positive integers.");
        seen.add(row.sourceRowNumber);
        const out = { source_row_number: row.sourceRowNumber };
        for (const field of RAW_FIELDS) {
            const value = row[field];
            if (value !== undefined && value !== null && (typeof value !== "string" || value.length > 10_000))
                throw new RangeError("A staging field exceeds the permitted size.");
            out[field] = value ?? null;
        }
        return out;
    });
    const json = JSON.stringify(payload);
    if (Buffer.byteLength(json, "utf8") > 1_000_000)
        throw new RangeError("Staging payload exceeds 1 MB.");
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const batch = await (0, staging_access_1.resolveAuthorizedBatch)(tx, input.actorUserId, input.batchId.toLowerCase(), true);
        const actor = await tx.query("SELECT role::text AS role, institution_id::text FROM master.user_profiles WHERE user_id = $1::uuid", [input.actorUserId.toLowerCase()]);
        const profile = actor.rows[0];
        if (!profile || !(profile.role === "AICTE_SUPER_ADMIN" || (profile.role === "INSTITUTION_NODAL_OFFICER" && profile.institution_id?.toLowerCase() === batch.institutionId.toLowerCase())))
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        const status = await tx.query("SELECT status::text AS status FROM staging.submission_batches WHERE batch_id = $1::uuid", [batch.batchId]);
        if (status.rows[0]?.status !== "UPLOADED")
            throw new Error("Batch is not accepting records.");
        const fieldDef = RAW_FIELDS.map(field => `"${field}" text`).join(", ");
        const insertFields = RAW_FIELDS.map(field => `x."${field}"`).join(", ");
        const result = await tx.query(`INSERT INTO staging.staging_enrolment_records (batch_id, institution_id, academic_year, source_row_number, ${RAW_FIELDS.join(", ")}) SELECT $1::uuid, $2::uuid, $3, x.source_row_number, ${insertFields} FROM jsonb_to_recordset($4::jsonb) AS x(source_row_number integer, ${fieldDef})`, [batch.batchId, batch.institutionId, batch.academicYear, json]);
        return { insertedCount: result.rowCount ?? input.rows.length };
    });
}
async function listStagingRecordSummaries(input) {
    validate(input, input.batchId);
    bounds(input.limit, input.offset);
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const batch = await (0, staging_access_1.resolveAuthorizedBatch)(tx, input.actorUserId, input.batchId.toLowerCase());
        const result = await tx.query(`SELECT record_id::text AS "recordId", source_row_number AS "sourceRowNumber", validation_status::text AS "validationStatus", rejected_at_level AS "rejectedAtLevel", resolved_program_id::text AS "resolvedProgramId", resolved_intake_approval_id::text AS "resolvedIntakeApprovalId", created_at AS "createdAt" FROM staging.staging_enrolment_records WHERE batch_id = $1::uuid ORDER BY source_row_number LIMIT $2 OFFSET $3`, [batch.batchId, input.limit ?? 100, input.offset ?? 0]);
        return result.rows.map(r => ({ recordId: r.recordId, sourceRowNumber: r.sourceRowNumber, validationStatus: r.validationStatus, rejectedAtLevel: r.rejectedAtLevel, resolvedProgramId: r.resolvedProgramId, resolvedIntakeApprovalId: r.resolvedIntakeApprovalId, createdAt: r.createdAt }));
    });
}
async function listStagingAnomalies(input) {
    validate(input, input.batchId);
    bounds(input.limit, input.offset);
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const batch = await (0, staging_access_1.resolveAuthorizedBatch)(tx, input.actorUserId, input.batchId.toLowerCase());
        const result = await tx.query(`SELECT anomaly_id::text AS "anomalyId", record_id::text AS "recordId", anomaly_code::text AS "anomalyCode", severity::text AS severity, validation_level AS "validationLevel", field_name AS "fieldName", is_resolved AS "isResolved", created_at AS "createdAt" FROM staging.validation_anomalies WHERE batch_id = $1::uuid ORDER BY anomaly_id LIMIT $2 OFFSET $3`, [batch.batchId, input.limit ?? 100, input.offset ?? 0]);
        return result.rows.map(r => ({ anomalyId: r.anomalyId, recordId: r.recordId, anomalyCode: r.anomalyCode, severity: r.severity, validationLevel: r.validationLevel, fieldName: r.fieldName, isResolved: r.isResolved, createdAt: r.createdAt }));
    });
}
async function getStagingStatusSummary(input) {
    validate(input, input.batchId);
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const batch = await (0, staging_access_1.resolveAuthorizedBatch)(tx, input.actorUserId, input.batchId.toLowerCase());
        const result = await tx.query("SELECT validation_status::text AS status, count(*)::integer AS count FROM staging.staging_enrolment_records WHERE batch_id = $1::uuid GROUP BY validation_status ORDER BY validation_status", [batch.batchId]);
        return result.rows.map(r => ({ status: r.status, count: r.count }));
    });
}
