"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSeatUtilisation = getSeatUtilisation;
exports.getEnrolmentSummary = getEnrolmentSummary;
exports.getPipelineDaily = getPipelineDaily;
exports.getAnomalySummary = getAnomalySummary;
exports.getCredentialStatus = getCredentialStatus;
exports.getVerificationDaily = getVerificationDaily;
exports.getQuotaReconciliation = getQuotaReconciliation;
exports.getAnalyticsFreshness = getAnalyticsFreshness;
exports.getPublicNationalSummary = getPublicNationalSummary;
const actor_context_1 = require("./actor-context");
const pool_1 = require("./pool");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YEAR = /^(19|20|21)\d{2}-(\d{2})$/;
const MAX_LIMIT = 500;
function validateActor(context) {
    if (!context || !UUID.test(context.actorUserId) || typeof context.requestId !== "string" || !context.requestId.trim() || context.requestId.length > 100)
        throw new TypeError("Valid authenticated actor context is required.");
}
function year(value) {
    if (typeof value !== "string" || !YEAR.test(value) || Number(value.slice(5)) !== (Number(value.slice(0, 4)) + 1) % 100)
        throw new TypeError("Academic year must use YYYY-YY format.");
    return value;
}
function uuid(value) {
    if (value === undefined)
        return null;
    if (!UUID.test(value))
        throw new TypeError("Institution ID must be a UUID.");
    return value.toLowerCase();
}
function page(input = {}) {
    const limit = input.limit ?? 100;
    const offset = input.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT || !Number.isInteger(offset) || offset < 0 || offset > 100_000)
        throw new RangeError("Invalid analytics page bounds.");
    return [limit, offset];
}
function date(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
        throw new TypeError("Date must be a valid YYYY-MM-DD value.");
    return value;
}
async function list(context, fn, params) {
    validateActor(context);
    return (0, pool_1.withActorTx)({ actorUserId: context.actorUserId.toLowerCase(), requestId: context.requestId }, async (tx) => {
        await (0, actor_context_1.resolveActorContext)(tx, context.actorUserId);
        const result = await tx.query(`SELECT * FROM ${fn}(${params.map((_, i) => `$${i + 1}`).join(", ")})`, params);
        return result.rows.map(row => ({ ...row }));
    });
}
function getSeatUtilisation(input) {
    const [limit, offset] = page(input.page);
    return list(input, "analytics.get_seat_utilisation", [year(input.academicYear), uuid(input.institutionId), input.onlyFlagged ?? false, limit, offset]);
}
function getEnrolmentSummary(input) {
    const [limit, offset] = page(input.page);
    return list(input, "analytics.get_enrolment_summary", [year(input.academicYear), uuid(input.institutionId), limit, offset]);
}
function getPipelineDaily(input) {
    const [limit, offset] = page(input.page);
    const from = date(input.from), to = date(input.to);
    if (to < from || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86400000)
        throw new RangeError("Date range must be at most 366 days.");
    return list(input, "analytics.get_pipeline_daily", [from, to, uuid(input.institutionId), limit, offset]);
}
function getAnomalySummary(input) {
    const [limit, offset] = page(input.page);
    return list(input, "analytics.get_anomaly_summary", [year(input.academicYear), uuid(input.institutionId), input.onlyUnresolved ?? false, limit, offset]);
}
function getCredentialStatus(input) {
    const [limit, offset] = page(input.page);
    return list(input, "analytics.get_credential_status", [year(input.academicYear), uuid(input.institutionId), limit, offset]);
}
function getVerificationDaily(input) {
    const [limit, offset] = page(input.page);
    const from = date(input.from), to = date(input.to);
    if (to < from || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86400000)
        throw new RangeError("Date range must be at most 366 days.");
    return list(input, "analytics.get_verification_daily", [from, to, limit, offset]);
}
function getQuotaReconciliation(input) {
    const [limit, offset] = page(input.page);
    return list(input, "analytics.get_quota_reconciliation", [year(input.academicYear), input.onlyDrift ?? true, limit, offset]);
}
function getAnalyticsFreshness(input) {
    return list(input, "analytics.get_freshness", []);
}
async function getPublicNationalSummary(academicYear) {
    const result = await (0, pool_1.withSystemTx)(tx => tx.query("SELECT * FROM analytics.public_national_summary($1)", [year(academicYear)]));
    return result.rows.map(row => ({ ...row }));
}
