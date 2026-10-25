import { resolveActorContext } from "./actor-context";
import { withActorTx, withSystemTx } from "./pool";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YEAR = /^(19|20|21)\d{2}-(\d{2})$/;
const MAX_LIMIT = 500;

export interface AnalyticsActorContext { actorUserId: string; requestId: string }
export interface AnalyticsPage { limit?: number; offset?: number }
export interface SeatUtilisationRow extends Record<string, unknown> { intake_approval_id: string; academic_year: string; institution_id: string; institution_name: string; aicte_region: string; state_code: string; affiliating_body_id: string | null; program_id: string; aicte_course_id: string; course_name: string; program_level: string; program_shift: string; approved_sanctioned_intake: number; actual_regular_enrolled: number; approved_nri_seats: number; actual_nri_enrolled: number; approved_supernumerary_tfw: number; actual_tfw_enrolled: number; approved_supernumerary_fn_oci_ciwgc: number; actual_fn_oci_ciwgc_enrolled: number; approved_supernumerary_pmsss: number; actual_pmsss_enrolled: number; approved_supernumerary_ews: number; actual_ews_enrolled: number; approved_lateral_entry_seats: number; actual_lateral_enrolled: number; sanctioned_pool_enrolled: number; sanctioned_fill_pct: string | number | null; over_sanctioned_flag: boolean; policy_cap_flag: boolean; is_locked_by_aicte: boolean; admission_cutoff_date: Date | string; computed_at: Date | string }
export interface EnrolmentSummaryRow extends Record<string, unknown> { academic_year: string; institution_id: string; program_id: string; seat_quota_type: string; residency_status: string; enrolment_status: string; aicte_region: string; affiliating_body_id: string | null; program_level: string; enrolment_count: string | number; computed_at: Date | string }
export interface PipelineDailyRow extends Record<string, unknown> { institution_id: string; academic_year: string; upload_day_ist: string; aicte_region: string; affiliating_body_id: string | null; batches: string | number; batches_finished: string | number; batches_failed: string | number; batches_in_flight: string | number; rows_finished: string | number; l1_rejected_rows: string | number; l2_quarantined_rows: string | number; l3_quarantined_rows: string | number; promoted_rows: string | number; promotion_rate_pct: string | number | null; avg_processing_seconds: string | number | null; computed_at: Date | string }
export interface AnomalySummaryRow extends Record<string, unknown> { institution_id: string; academic_year: string; month_ist: string; anomaly_code: string; severity: string; validation_level: number; is_resolved: boolean; aicte_region: string; affiliating_body_id: string | null; anomaly_count: string | number; affected_rows: string | number; computed_at: Date | string }
export interface CredentialStatusRow extends Record<string, unknown> { institution_id: string; academic_year: string; credential_type: string; status: string; aicte_region: string; affiliating_body_id: string | null; credential_count: string | number; last_issued_at: Date | string | null; computed_at: Date | string }
export interface VerificationDailyRow extends Record<string, unknown> { day_ist: string; org_type: string; purpose: string; outcome: string; verification_count: string | number; distinct_orgs: string | number; computed_at: Date | string }
export interface QuotaReconciliationRow extends Record<string, unknown> { intake_approval_id: string; academic_year: string; institution_id: string; aicte_region: string; affiliating_body_id: string | null; drift_regular: number; drift_nri: number; drift_tfw: number; drift_fn_oci_ciwgc: number; drift_pmsss: number; drift_ews: number; drift_lateral: number; has_drift: boolean; computed_at: Date | string }
export interface AnalyticsFreshnessRow extends Record<string, unknown> { view_name: string; last_ok_at: Date | string | null; age_seconds: string | number | null }
export interface PublicNationalSummaryRow extends Record<string, unknown> { academic_year: string; program_level: string; residency_status: string; active_enrolments_approx: string | number | null }
type AnalyticsRow = SeatUtilisationRow | EnrolmentSummaryRow | PipelineDailyRow | AnomalySummaryRow | CredentialStatusRow | VerificationDailyRow | QuotaReconciliationRow | AnalyticsFreshnessRow | PublicNationalSummaryRow;

function validateActor(context: AnalyticsActorContext): void {
  if (!context || !UUID.test(context.actorUserId) || typeof context.requestId !== "string" || !context.requestId.trim() || context.requestId.length > 100) throw new TypeError("Valid authenticated actor context is required.");
}
function year(value: string): string {
  if (typeof value !== "string" || !YEAR.test(value) || Number(value.slice(5)) !== (Number(value.slice(0, 4)) + 1) % 100) throw new TypeError("Academic year must use YYYY-YY format.");
  return value;
}
function uuid(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (!UUID.test(value)) throw new TypeError("Institution ID must be a UUID.");
  return value.toLowerCase();
}
function page(input: AnalyticsPage = {}): [number, number] {
  const limit = input.limit ?? 100;
  const offset = input.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT || !Number.isInteger(offset) || offset < 0 || offset > 100_000) throw new RangeError("Invalid analytics page bounds.");
  return [limit, offset];
}
function date(value: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new TypeError("Date must be a valid YYYY-MM-DD value.");
  return value;
}

async function list<T extends AnalyticsRow>(context: AnalyticsActorContext, fn: string, params: unknown[]): Promise<T[]> {
  validateActor(context);
  return withActorTx({ actorUserId: context.actorUserId.toLowerCase(), requestId: context.requestId }, async tx => {
    await resolveActorContext(tx, context.actorUserId);
    const result = await tx.query<T>(`SELECT * FROM ${fn}(${params.map((_, i) => `$${i + 1}`).join(", ")})`, params);
    return result.rows.map(row => ({ ...row }));
  });
}

export function getSeatUtilisation(input: AnalyticsActorContext & { academicYear: string; institutionId?: string; onlyFlagged?: boolean; page?: AnalyticsPage }): Promise<SeatUtilisationRow[]> {
  const [limit, offset] = page(input.page);
  return list<SeatUtilisationRow>(input, "analytics.get_seat_utilisation", [year(input.academicYear), uuid(input.institutionId), input.onlyFlagged ?? false, limit, offset]);
}
export function getEnrolmentSummary(input: AnalyticsActorContext & { academicYear: string; institutionId?: string; page?: AnalyticsPage }): Promise<EnrolmentSummaryRow[]> {
  const [limit, offset] = page(input.page);
  return list<EnrolmentSummaryRow>(input, "analytics.get_enrolment_summary", [year(input.academicYear), uuid(input.institutionId), limit, offset]);
}
export function getPipelineDaily(input: AnalyticsActorContext & { from: string; to: string; institutionId?: string; page?: AnalyticsPage }): Promise<PipelineDailyRow[]> {
  const [limit, offset] = page(input.page);
  const from = date(input.from), to = date(input.to);
  if (to < from || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86400000) throw new RangeError("Date range must be at most 366 days.");
  return list<PipelineDailyRow>(input, "analytics.get_pipeline_daily", [from, to, uuid(input.institutionId), limit, offset]);
}
export function getAnomalySummary(input: AnalyticsActorContext & { academicYear: string; institutionId?: string; onlyUnresolved?: boolean; page?: AnalyticsPage }): Promise<AnomalySummaryRow[]> {
  const [limit, offset] = page(input.page);
  return list<AnomalySummaryRow>(input, "analytics.get_anomaly_summary", [year(input.academicYear), uuid(input.institutionId), input.onlyUnresolved ?? false, limit, offset]);
}
export function getCredentialStatus(input: AnalyticsActorContext & { academicYear: string; institutionId?: string; page?: AnalyticsPage }): Promise<CredentialStatusRow[]> {
  const [limit, offset] = page(input.page);
  return list<CredentialStatusRow>(input, "analytics.get_credential_status", [year(input.academicYear), uuid(input.institutionId), limit, offset]);
}
export function getVerificationDaily(input: AnalyticsActorContext & { from: string; to: string; page?: AnalyticsPage }): Promise<VerificationDailyRow[]> {
  const [limit, offset] = page(input.page);
  const from = date(input.from), to = date(input.to);
  if (to < from || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 366 * 86400000) throw new RangeError("Date range must be at most 366 days.");
  return list<VerificationDailyRow>(input, "analytics.get_verification_daily", [from, to, limit, offset]);
}
export function getQuotaReconciliation(input: AnalyticsActorContext & { academicYear: string; onlyDrift?: boolean; page?: AnalyticsPage }): Promise<QuotaReconciliationRow[]> {
  const [limit, offset] = page(input.page);
  return list<QuotaReconciliationRow>(input, "analytics.get_quota_reconciliation", [year(input.academicYear), input.onlyDrift ?? true, limit, offset]);
}
export function getAnalyticsFreshness(input: AnalyticsActorContext): Promise<AnalyticsFreshnessRow[]> {
  return list<AnalyticsFreshnessRow>(input, "analytics.get_freshness", []);
}
export async function getPublicNationalSummary(academicYear: string): Promise<PublicNationalSummaryRow[]> {
  const result = await withSystemTx(tx => tx.query<PublicNationalSummaryRow>("SELECT * FROM analytics.public_national_summary($1)", [year(academicYear)]));
  return result.rows.map(row => ({ ...row }));
}
