"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIntakeApprovalById = getIntakeApprovalById;
exports.getIntakeApprovalByProgramYear = getIntakeApprovalByProgramYear;
exports.listIntakeApprovalsByInstitutionYear = listIntakeApprovalsByInstitutionYear;
exports.updateIntakeApprovalCaps = updateIntakeApprovalCaps;
const actor_context_1 = require("./actor-context");
const authorization_1 = require("./authorization");
const versioned_cache_1 = require("./versioned-cache");
const pool_1 = require("./pool");
const cache_invalidation_policy_1 = require("./cache-invalidation-policy");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YEAR = /^(19|20|21)\d{2}-(\d{2})$/;
const READ = "master.intake.read";
const MANAGE = "master.intake.manage";
const SQL = `SELECT a.intake_approval_id::text AS "intakeApprovalId", a.program_id::text AS "programId", a.institution_id::text AS "institutionId", a.academic_year AS "academicYear", a.eoa_issue_date AS "eoaIssueDate", a.approved_sanctioned_intake AS "approvedSanctionedIntake", a.approved_nri_seats AS "approvedNriSeats", a.approved_supernumerary_tfw AS "approvedTfwSeats", a.approved_supernumerary_fn_oci_ciwgc AS "approvedFnOciCiwgcSeats", a.approved_supernumerary_pmsss AS "approvedPmsssSeats", a.approved_supernumerary_ews AS "approvedEwsSeats", a.approved_lateral_entry_seats AS "approvedLateralEntrySeats", a.is_locked_by_aicte AS "lockedByAicte", a.admission_cutoff_date AS "admissionCutoffDate" FROM master.program_intake_approvals a`;
function validActor(actor) { if (!actor || !UUID.test(actor.actorUserId) || typeof actor.requestId !== "string" || !actor.requestId.trim() || actor.requestId.length > 100)
    throw new TypeError("Valid authenticated actor context is required."); }
function validYear(value) { if (!YEAR.test(value) || Number(value.slice(5)) !== (Number(value.slice(0, 4)) + 1) % 100)
    throw new TypeError("Academic year must use YYYY-YY format."); }
function map(row) { return { intakeApprovalId: row.intakeApprovalId, programId: row.programId, institutionId: row.institutionId, academicYear: row.academicYear, eoaIssueDate: row.eoaIssueDate, approvedSanctionedIntake: row.approvedSanctionedIntake, approvedNriSeats: row.approvedNriSeats, approvedTfwSeats: row.approvedTfwSeats, approvedFnOciCiwgcSeats: row.approvedFnOciCiwgcSeats, approvedPmsssSeats: row.approvedPmsssSeats, approvedEwsSeats: row.approvedEwsSeats, approvedLateralEntrySeats: row.approvedLateralEntrySeats, lockedByAicte: row.lockedByAicte, admissionCutoffDate: row.admissionCutoffDate }; }
function scope(row) { return { institutionId: row.institutionId, affiliatingBodyId: row.affiliatingBodyId, aicteRegion: row.aicteRegion }; }
async function authorizedRead(input, id, operation) {
    validActor(input);
    if (!UUID.test(id))
        throw new TypeError("Intake approval ID must be a UUID.");
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId);
        const result = await tx.query(`SELECT i.institution_id::text AS "institutionId", i.affiliating_body_id::text AS "affiliatingBodyId", i.aicte_region AS "aicteRegion" FROM master.program_intake_approvals a JOIN master.institutions i ON i.institution_id = a.institution_id WHERE a.intake_approval_id = $1::uuid FOR SHARE OF a, i`, [id.toLowerCase()]);
        if (!result.rows[0])
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        (0, authorization_1.authorizeMasterAccess)(actor, READ, scope(result.rows[0]));
        return operation(tx, id.toLowerCase());
    });
}
async function fetch(tx, where, params) {
    const result = await tx.query(`${SQL} WHERE ${where}`, params);
    return result.rows.map(map);
}
async function getIntakeApprovalById(input) {
    return authorizedRead(input, input.intakeApprovalId, async (tx, id) => {
        const namespace = { schema: "master", resource: "intake", identifier: id };
        return (0, versioned_cache_1.getOrSetVersioned)(namespace, 300, async () => {
            const rows = await fetch(tx, "a.intake_approval_id = $1::uuid", [id]);
            if (!rows[0])
                throw new authorization_1.AuthorizationError("FORBIDDEN");
            return rows[0];
        });
    });
}
async function getIntakeApprovalByProgramYear(input) {
    validActor(input);
    if (!UUID.test(input.programId))
        throw new TypeError("Program ID must be a UUID.");
    validYear(input.academicYear);
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId);
        const owner = await tx.query("SELECT institution_id::text AS \"institutionId\" FROM master.institutional_programs WHERE program_id = $1::uuid FOR SHARE", [input.programId.toLowerCase()]);
        if (!owner.rows[0])
            return null;
        const actor = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId);
        const master = await tx.query("SELECT affiliating_body_id::text AS \"affiliatingBodyId\", aicte_region AS \"aicteRegion\" FROM master.institutions WHERE institution_id = $1::uuid FOR SHARE", [owner.rows[0].institutionId]);
        if (!master.rows[0])
            return null;
        (0, authorization_1.authorizeMasterAccess)(actor, READ, scope({ institutionId: owner.rows[0].institutionId, ...master.rows[0] }));
        const rows = await fetch(tx, "a.program_id = $1::uuid AND a.academic_year = $2", [input.programId.toLowerCase(), input.academicYear]);
        return rows[0] ?? null;
    });
}
async function listIntakeApprovalsByInstitutionYear(input) {
    validActor(input);
    if (!UUID.test(input.institutionId))
        throw new TypeError("Institution ID must be a UUID.");
    validYear(input.academicYear);
    const limit = input.limit ?? 100, offset = input.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0 || offset > 100_000)
        throw new RangeError("Invalid intake page bounds.");
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId);
        const res = await tx.query("SELECT institution_id::text AS \"institutionId\", affiliating_body_id::text AS \"affiliatingBodyId\", aicte_region AS \"aicteRegion\" FROM master.institutions WHERE institution_id = $1::uuid FOR SHARE", [input.institutionId.toLowerCase()]);
        if (!res.rows[0])
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        (0, authorization_1.authorizeMasterAccess)(actor, "master.institution.read", scope(res.rows[0]));
        return fetch(tx, "a.institution_id = $1::uuid AND a.academic_year = $2 ORDER BY a.program_id LIMIT $3 OFFSET $4", [input.institutionId.toLowerCase(), input.academicYear, limit, offset]);
    });
}
async function updateIntakeApprovalCaps(input) {
    validActor(input);
    if (!UUID.test(input.intakeApprovalId))
        throw new TypeError("Intake approval ID must be a UUID.");
    const values = [input.caps.approvedSanctionedIntake, input.caps.approvedNriSeats, input.caps.approvedTfwSeats, input.caps.approvedFnOciCiwgcSeats, input.caps.approvedPmsssSeats, input.caps.approvedEwsSeats, input.caps.approvedLateralEntrySeats];
    if (!values.every(v => Number.isInteger(v) && v >= 0) || (input.lockedByAicte !== undefined && typeof input.lockedByAicte !== "boolean"))
        throw new TypeError("Seat caps must be non-negative integers.");
    const id = input.intakeApprovalId.toLowerCase();
    const result = await (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId);
        const resource = await tx.query("SELECT i.institution_id::text AS \"institutionId\", i.affiliating_body_id::text AS \"affiliatingBodyId\", i.aicte_region AS \"aicteRegion\" FROM master.program_intake_approvals a JOIN master.institutions i ON i.institution_id = a.institution_id WHERE a.intake_approval_id = $1::uuid FOR UPDATE OF a, i", [id]);
        const resourceRow = resource.rows[0];
        if (!resourceRow)
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        (0, authorization_1.authorizeMasterAccess)(actor, MANAGE, scope(resourceRow));
        const updated = await tx.query(`UPDATE master.program_intake_approvals a SET approved_sanctioned_intake = $2, approved_nri_seats = $3, approved_supernumerary_tfw = $4, approved_supernumerary_fn_oci_ciwgc = $5, approved_supernumerary_pmsss = $6, approved_supernumerary_ews = $7, approved_lateral_entry_seats = $8, is_locked_by_aicte = COALESCE($9, a.is_locked_by_aicte) WHERE a.intake_approval_id = $1::uuid RETURNING a.intake_approval_id::text AS "intakeApprovalId", a.program_id::text AS "programId", a.institution_id::text AS "institutionId", a.academic_year AS "academicYear", a.eoa_issue_date AS "eoaIssueDate", a.approved_sanctioned_intake AS "approvedSanctionedIntake", a.approved_nri_seats AS "approvedNriSeats", a.approved_supernumerary_tfw AS "approvedTfwSeats", a.approved_supernumerary_fn_oci_ciwgc AS "approvedFnOciCiwgcSeats", a.approved_supernumerary_pmsss AS "approvedPmsssSeats", a.approved_supernumerary_ews AS "approvedEwsSeats", a.approved_lateral_entry_seats AS "approvedLateralEntrySeats", a.is_locked_by_aicte AS "lockedByAicte", a.admission_cutoff_date AS "admissionCutoffDate"`, [id, ...values, input.lockedByAicte ?? null]);
        if (!updated.rows[0])
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        return map(updated.rows[0]);
    });
    try {
        await (0, cache_invalidation_policy_1.invalidateForMutation)("intake", id);
    }
    catch (cause) {
        throw new cache_invalidation_policy_1.PostCommitCacheInvalidationError("Intake caps committed, but cache invalidation failed; do not retry the mutation.", cause);
    }
    return result;
}
