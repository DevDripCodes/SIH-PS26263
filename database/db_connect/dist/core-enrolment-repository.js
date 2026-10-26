"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStudentById = getStudentById;
exports.listStudentEnrolments = listStudentEnrolments;
exports.getEnrolment = getEnrolment;
exports.listEnrolmentStatusHistory = listEnrolmentStatusHistory;
const actor_context_1 = require("./actor-context");
const authorization_1 = require("./authorization");
const pool_1 = require("./pool");
const core_access_1 = require("./core-access");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YEAR = /^(19|20|21)\d{2}-(\d{2})$/;
function validate(actor) { if (!actor || !UUID.test(actor.actorUserId) || typeof actor.requestId !== "string" || !actor.requestId.trim() || actor.requestId.length > 100)
    throw new TypeError("Valid authenticated actor context is required."); }
function page(limit = 100, offset = 0) { if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0 || offset > 100_000)
    throw new RangeError("Invalid enrolment page bounds."); }
function year(value) { if (!YEAR.test(value) || Number(value.slice(5)) !== (Number(value.slice(0, 4)) + 1) % 100)
    throw new TypeError("Academic year must use YYYY-YY format."); }
const ENROLMENT_COLUMNS = `e.enrolment_id::text AS "enrolmentId", e.academic_year AS "academicYear", e.student_id::text AS "studentId", e.institution_id::text AS "institutionId", e.program_id::text AS "programId", e.intake_approval_id::text AS "intakeApprovalId", e.seat_quota_type::text AS "seatQuotaType", e.entry_year_of_study AS "entryYearOfStudy", e.admission_date AS "admissionDate", e.enrolment_status::text AS "enrolmentStatus"`;
async function getStudentById(input) {
    validate(input);
    if (!UUID.test(input.studentId))
        throw new TypeError("Student ID must be a UUID.");
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId), id = input.studentId.toLowerCase();
        await (0, core_access_1.assertStudentReadable)(tx, actor, id);
        const result = await tx.query(`SELECT s.student_id::text AS "studentId", s.full_name AS "fullName", s.gender, s.residency_status::text AS "residencyStatus", s.apaar_verification_status::text AS "apaarVerificationStatus" FROM core.students s WHERE s.student_id = $1::uuid`, [id]);
        if (!result.rows[0])
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        const r = result.rows[0];
        return { studentId: r.studentId, fullName: r.fullName, gender: r.gender, residencyStatus: r.residencyStatus, apaarVerificationStatus: r.apaarVerificationStatus };
    });
}
async function listStudentEnrolments(input) {
    validate(input);
    if (!UUID.test(input.studentId))
        throw new TypeError("Student ID must be a UUID.");
    page(input.limit, input.offset);
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId), id = input.studentId.toLowerCase();
        await (0, core_access_1.assertStudentReadable)(tx, actor, id);
        const scope = (0, core_access_1.enrolmentScopePredicate)(actor, "e", 2);
        const result = await tx.query(`SELECT ${ENROLMENT_COLUMNS} FROM core.student_enrolments e WHERE e.student_id = $1::uuid AND (${scope.sql}) ORDER BY e.academic_year DESC LIMIT $${scope.values.length + 2} OFFSET $${scope.values.length + 3}`, [id, ...scope.values, input.limit ?? 100, input.offset ?? 0]);
        return result.rows.map(r => ({ enrolmentId: r.enrolmentId, academicYear: r.academicYear, studentId: r.studentId, institutionId: r.institutionId, programId: r.programId, intakeApprovalId: r.intakeApprovalId, seatQuotaType: r.seatQuotaType, entryYearOfStudy: r.entryYearOfStudy, admissionDate: r.admissionDate, enrolmentStatus: r.enrolmentStatus }));
    });
}
async function getEnrolment(input) {
    validate(input);
    if (!UUID.test(input.enrolmentId))
        throw new TypeError("Enrolment ID must be a UUID.");
    year(input.academicYear);
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId), scope = (0, core_access_1.enrolmentScopePredicate)(actor, "e", 3);
        const result = await tx.query(`SELECT ${ENROLMENT_COLUMNS} FROM core.student_enrolments e WHERE e.enrolment_id = $1::uuid AND e.academic_year = $2 AND (${scope.sql})`, [input.enrolmentId.toLowerCase(), input.academicYear, ...scope.values]);
        const row = result.rows[0];
        if (!row)
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        if (actor.role !== "STUDENT")
            await (0, core_access_1.assertStudentReadable)(tx, actor, row.studentId);
        return { enrolmentId: row.enrolmentId, academicYear: row.academicYear, studentId: row.studentId, institutionId: row.institutionId, programId: row.programId, intakeApprovalId: row.intakeApprovalId, seatQuotaType: row.seatQuotaType, entryYearOfStudy: row.entryYearOfStudy, admissionDate: row.admissionDate, enrolmentStatus: row.enrolmentStatus };
    });
}
async function listEnrolmentStatusHistory(input) {
    validate(input);
    if (!UUID.test(input.enrolmentId))
        throw new TypeError("Enrolment ID must be a UUID.");
    year(input.academicYear);
    page(input.limit, input.offset);
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId), scope = (0, core_access_1.enrolmentScopePredicate)(actor, "e", 3);
        const visible = await tx.query(`SELECT e.student_id::text AS "studentId" FROM core.student_enrolments e WHERE e.enrolment_id = $1::uuid AND e.academic_year = $2 AND (${scope.sql})`, [input.enrolmentId.toLowerCase(), input.academicYear, ...scope.values]);
        if (!visible.rows[0])
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        if (actor.role !== "STUDENT")
            await (0, core_access_1.assertStudentReadable)(tx, actor, visible.rows[0].studentId);
        const result = await tx.query(`SELECT h.history_id::text AS "historyId", h.enrolment_id::text AS "enrolmentId", h.academic_year AS "academicYear", h.from_status::text AS "fromStatus", h.to_status::text AS "toStatus", h.changed_at AS "changedAt" FROM core.enrolment_status_history h WHERE h.enrolment_id = $1::uuid AND h.academic_year = $2 ORDER BY h.changed_at DESC LIMIT $3 OFFSET $4`, [input.enrolmentId.toLowerCase(), input.academicYear, input.limit ?? 100, input.offset ?? 0]);
        return result.rows.map(r => ({ historyId: r.historyId, enrolmentId: r.enrolmentId, academicYear: r.academicYear, fromStatus: r.fromStatus, toStatus: r.toStatus, changedAt: r.changedAt }));
    });
}
