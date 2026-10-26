export interface AnalyticsActorContext {
    actorUserId: string;
    requestId: string;
}
export interface AnalyticsPage {
    limit?: number;
    offset?: number;
}
export interface SeatUtilisationRow extends Record<string, unknown> {
    intake_approval_id: string;
    academic_year: string;
    institution_id: string;
    institution_name: string;
    aicte_region: string;
    state_code: string;
    affiliating_body_id: string | null;
    program_id: string;
    aicte_course_id: string;
    course_name: string;
    program_level: string;
    program_shift: string;
    approved_sanctioned_intake: number;
    actual_regular_enrolled: number;
    approved_nri_seats: number;
    actual_nri_enrolled: number;
    approved_supernumerary_tfw: number;
    actual_tfw_enrolled: number;
    approved_supernumerary_fn_oci_ciwgc: number;
    actual_fn_oci_ciwgc_enrolled: number;
    approved_supernumerary_pmsss: number;
    actual_pmsss_enrolled: number;
    approved_supernumerary_ews: number;
    actual_ews_enrolled: number;
    approved_lateral_entry_seats: number;
    actual_lateral_enrolled: number;
    sanctioned_pool_enrolled: number;
    sanctioned_fill_pct: string | number | null;
    over_sanctioned_flag: boolean;
    policy_cap_flag: boolean;
    is_locked_by_aicte: boolean;
    admission_cutoff_date: Date | string;
    computed_at: Date | string;
}
export interface EnrolmentSummaryRow extends Record<string, unknown> {
    academic_year: string;
    institution_id: string;
    program_id: string;
    seat_quota_type: string;
    residency_status: string;
    enrolment_status: string;
    aicte_region: string;
    affiliating_body_id: string | null;
    program_level: string;
    enrolment_count: string | number;
    computed_at: Date | string;
}
export interface PipelineDailyRow extends Record<string, unknown> {
    institution_id: string;
    academic_year: string;
    upload_day_ist: string;
    aicte_region: string;
    affiliating_body_id: string | null;
    batches: string | number;
    batches_finished: string | number;
    batches_failed: string | number;
    batches_in_flight: string | number;
    rows_finished: string | number;
    l1_rejected_rows: string | number;
    l2_quarantined_rows: string | number;
    l3_quarantined_rows: string | number;
    promoted_rows: string | number;
    promotion_rate_pct: string | number | null;
    avg_processing_seconds: string | number | null;
    computed_at: Date | string;
}
export interface AnomalySummaryRow extends Record<string, unknown> {
    institution_id: string;
    academic_year: string;
    month_ist: string;
    anomaly_code: string;
    severity: string;
    validation_level: number;
    is_resolved: boolean;
    aicte_region: string;
    affiliating_body_id: string | null;
    anomaly_count: string | number;
    affected_rows: string | number;
    computed_at: Date | string;
}
export interface CredentialStatusRow extends Record<string, unknown> {
    institution_id: string;
    academic_year: string;
    credential_type: string;
    status: string;
    aicte_region: string;
    affiliating_body_id: string | null;
    credential_count: string | number;
    last_issued_at: Date | string | null;
    computed_at: Date | string;
}
export interface VerificationDailyRow extends Record<string, unknown> {
    day_ist: string;
    org_type: string;
    purpose: string;
    outcome: string;
    verification_count: string | number;
    distinct_orgs: string | number;
    computed_at: Date | string;
}
export interface QuotaReconciliationRow extends Record<string, unknown> {
    intake_approval_id: string;
    academic_year: string;
    institution_id: string;
    aicte_region: string;
    affiliating_body_id: string | null;
    drift_regular: number;
    drift_nri: number;
    drift_tfw: number;
    drift_fn_oci_ciwgc: number;
    drift_pmsss: number;
    drift_ews: number;
    drift_lateral: number;
    has_drift: boolean;
    computed_at: Date | string;
}
export interface AnalyticsFreshnessRow extends Record<string, unknown> {
    view_name: string;
    last_ok_at: Date | string | null;
    age_seconds: string | number | null;
}
export interface PublicNationalSummaryRow extends Record<string, unknown> {
    academic_year: string;
    program_level: string;
    residency_status: string;
    active_enrolments_approx: string | number | null;
}
export declare function getSeatUtilisation(input: AnalyticsActorContext & {
    academicYear: string;
    institutionId?: string;
    onlyFlagged?: boolean;
    page?: AnalyticsPage;
}): Promise<SeatUtilisationRow[]>;
export declare function getEnrolmentSummary(input: AnalyticsActorContext & {
    academicYear: string;
    institutionId?: string;
    page?: AnalyticsPage;
}): Promise<EnrolmentSummaryRow[]>;
export declare function getPipelineDaily(input: AnalyticsActorContext & {
    from: string;
    to: string;
    institutionId?: string;
    page?: AnalyticsPage;
}): Promise<PipelineDailyRow[]>;
export declare function getAnomalySummary(input: AnalyticsActorContext & {
    academicYear: string;
    institutionId?: string;
    onlyUnresolved?: boolean;
    page?: AnalyticsPage;
}): Promise<AnomalySummaryRow[]>;
export declare function getCredentialStatus(input: AnalyticsActorContext & {
    academicYear: string;
    institutionId?: string;
    page?: AnalyticsPage;
}): Promise<CredentialStatusRow[]>;
export declare function getVerificationDaily(input: AnalyticsActorContext & {
    from: string;
    to: string;
    page?: AnalyticsPage;
}): Promise<VerificationDailyRow[]>;
export declare function getQuotaReconciliation(input: AnalyticsActorContext & {
    academicYear: string;
    onlyDrift?: boolean;
    page?: AnalyticsPage;
}): Promise<QuotaReconciliationRow[]>;
export declare function getAnalyticsFreshness(input: AnalyticsActorContext): Promise<AnalyticsFreshnessRow[]>;
export declare function getPublicNationalSummary(academicYear: string): Promise<PublicNationalSummaryRow[]>;
