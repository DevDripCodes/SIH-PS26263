import { resolveActorContext } from "./actor-context";
import { AuthorizationError } from "./authorization";
import { withActorTx } from "./pool";
import { assertStudentReadable, enrolmentScopePredicate } from "./core-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YEAR = /^(19|20|21)\d{2}-(\d{2})$/;
export interface CoreActor { actorUserId: string; requestId: string }
export interface StudentSummary { studentId: string; fullName: string; gender: string | null; residencyStatus: string; apaarVerificationStatus: string }
export interface EnrolmentSummary { enrolmentId: string; academicYear: string; studentId: string; institutionId: string; programId: string; intakeApprovalId: string; seatQuotaType: string; entryYearOfStudy: number; admissionDate: string; enrolmentStatus: string }
export interface EnrolmentStatusHistory { historyId: string; enrolmentId: string; academicYear: string; fromStatus: string | null; toStatus: string; changedAt: Date | string }
interface StudentRow extends Record<string, unknown>, StudentSummary {}
interface EnrolmentRow extends Record<string, unknown>, EnrolmentSummary {}
interface HistoryRow extends Record<string, unknown>, EnrolmentStatusHistory {}
function validate(actor: CoreActor): void { if (!actor || !UUID.test(actor.actorUserId) || typeof actor.requestId !== "string" || !actor.requestId.trim() || actor.requestId.length > 100) throw new TypeError("Valid authenticated actor context is required."); }
function page(limit = 100, offset = 0): void { if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0 || offset > 100_000) throw new RangeError("Invalid enrolment page bounds."); }
function year(value: string): void { if (!YEAR.test(value) || Number(value.slice(5)) !== (Number(value.slice(0, 4)) + 1) % 100) throw new TypeError("Academic year must use YYYY-YY format."); }
const ENROLMENT_COLUMNS = `e.enrolment_id::text AS "enrolmentId", e.academic_year AS "academicYear", e.student_id::text AS "studentId", e.institution_id::text AS "institutionId", e.program_id::text AS "programId", e.intake_approval_id::text AS "intakeApprovalId", e.seat_quota_type::text AS "seatQuotaType", e.entry_year_of_study AS "entryYearOfStudy", e.admission_date AS "admissionDate", e.enrolment_status::text AS "enrolmentStatus"`;

export async function getStudentById(input: CoreActor & { studentId: string }): Promise<StudentSummary> {
  validate(input); if (!UUID.test(input.studentId)) throw new TypeError("Student ID must be a UUID.");
  return withActorTx({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async tx => {
    const actor = await resolveActorContext(tx, input.actorUserId), id = input.studentId.toLowerCase();
    await assertStudentReadable(tx, actor, id);
    const result = await tx.query<StudentRow>(`SELECT s.student_id::text AS "studentId", s.full_name AS "fullName", s.gender, s.residency_status::text AS "residencyStatus", s.apaar_verification_status::text AS "apaarVerificationStatus" FROM core.students s WHERE s.student_id = $1::uuid`, [id]);
    if (!result.rows[0]) throw new AuthorizationError("FORBIDDEN");
    const r = result.rows[0]; return { studentId: r.studentId, fullName: r.fullName, gender: r.gender, residencyStatus: r.residencyStatus, apaarVerificationStatus: r.apaarVerificationStatus };
  });
}

export async function listStudentEnrolments(input: CoreActor & { studentId: string; limit?: number; offset?: number }): Promise<EnrolmentSummary[]> {
  validate(input); if (!UUID.test(input.studentId)) throw new TypeError("Student ID must be a UUID."); page(input.limit, input.offset);
  return withActorTx({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async tx => {
    const actor = await resolveActorContext(tx, input.actorUserId), id = input.studentId.toLowerCase();
    await assertStudentReadable(tx, actor, id);
    const scope = enrolmentScopePredicate(actor, "e", 2);
    const result = await tx.query<EnrolmentRow>(`SELECT ${ENROLMENT_COLUMNS} FROM core.student_enrolments e WHERE e.student_id = $1::uuid AND (${scope.sql}) ORDER BY e.academic_year DESC LIMIT $${scope.values.length + 2} OFFSET $${scope.values.length + 3}`, [id, ...scope.values, input.limit ?? 100, input.offset ?? 0]);
    return result.rows.map(r => ({ enrolmentId: r.enrolmentId, academicYear: r.academicYear, studentId: r.studentId, institutionId: r.institutionId, programId: r.programId, intakeApprovalId: r.intakeApprovalId, seatQuotaType: r.seatQuotaType, entryYearOfStudy: r.entryYearOfStudy, admissionDate: r.admissionDate, enrolmentStatus: r.enrolmentStatus }));
  });
}

export async function getEnrolment(input: CoreActor & { enrolmentId: string; academicYear: string }): Promise<EnrolmentSummary> {
  validate(input); if (!UUID.test(input.enrolmentId)) throw new TypeError("Enrolment ID must be a UUID."); year(input.academicYear);
  return withActorTx({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async tx => {
    const actor = await resolveActorContext(tx, input.actorUserId), scope = enrolmentScopePredicate(actor, "e", 3);
    const result = await tx.query<EnrolmentRow>(`SELECT ${ENROLMENT_COLUMNS} FROM core.student_enrolments e WHERE e.enrolment_id = $1::uuid AND e.academic_year = $2 AND (${scope.sql})`, [input.enrolmentId.toLowerCase(), input.academicYear, ...scope.values]);
    const row = result.rows[0]; if (!row) throw new AuthorizationError("FORBIDDEN");
    if (actor.role !== "STUDENT") await assertStudentReadable(tx, actor, row.studentId);
    return { enrolmentId: row.enrolmentId, academicYear: row.academicYear, studentId: row.studentId, institutionId: row.institutionId, programId: row.programId, intakeApprovalId: row.intakeApprovalId, seatQuotaType: row.seatQuotaType, entryYearOfStudy: row.entryYearOfStudy, admissionDate: row.admissionDate, enrolmentStatus: row.enrolmentStatus };
  });
}

export async function listEnrolmentStatusHistory(input: CoreActor & { enrolmentId: string; academicYear: string; limit?: number; offset?: number }): Promise<EnrolmentStatusHistory[]> {
  validate(input); if (!UUID.test(input.enrolmentId)) throw new TypeError("Enrolment ID must be a UUID."); year(input.academicYear); page(input.limit, input.offset);
  return withActorTx({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async tx => {
    const actor = await resolveActorContext(tx, input.actorUserId), scope = enrolmentScopePredicate(actor, "e", 3);
    const visible = await tx.query<{ studentId: string }>(`SELECT e.student_id::text AS "studentId" FROM core.student_enrolments e WHERE e.enrolment_id = $1::uuid AND e.academic_year = $2 AND (${scope.sql})`, [input.enrolmentId.toLowerCase(), input.academicYear, ...scope.values]);
    if (!visible.rows[0]) throw new AuthorizationError("FORBIDDEN");
    if (actor.role !== "STUDENT") await assertStudentReadable(tx, actor, visible.rows[0].studentId);
    const result = await tx.query<HistoryRow>(`SELECT h.history_id::text AS "historyId", h.enrolment_id::text AS "enrolmentId", h.academic_year AS "academicYear", h.from_status::text AS "fromStatus", h.to_status::text AS "toStatus", h.changed_at AS "changedAt" FROM core.enrolment_status_history h WHERE h.enrolment_id = $1::uuid AND h.academic_year = $2 ORDER BY h.changed_at DESC LIMIT $3 OFFSET $4`, [input.enrolmentId.toLowerCase(), input.academicYear, input.limit ?? 100, input.offset ?? 0]);
    return result.rows.map(r => ({ historyId: r.historyId, enrolmentId: r.enrolmentId, academicYear: r.academicYear, fromStatus: r.fromStatus, toStatus: r.toStatus, changedAt: r.changedAt }));
  });
}
