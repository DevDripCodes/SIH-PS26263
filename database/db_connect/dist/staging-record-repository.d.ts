import type { BatchActor } from "./submission-batch-repository";
declare const RAW_FIELDS: readonly ["raw_apaar_id", "raw_full_name", "raw_date_of_birth", "raw_gender", "raw_email", "raw_mobile", "raw_roll_no", "raw_program_code", "raw_admission_date", "raw_social_category", "raw_residency_status", "raw_seat_quota_type", "raw_is_fn", "raw_is_oci_status", "raw_nationality", "raw_passport_no", "raw_passport_expiry", "raw_visa_type", "raw_frro_reg_no", "raw_oci_card_no", "raw_embassy_sponsor_ref"];
type RawField = typeof RAW_FIELDS[number];
export type StagingRecordInput = {
    sourceRowNumber: number;
} & Partial<Record<RawField, string | null>>;
export interface StagingRecordSummary {
    recordId: string;
    sourceRowNumber: number;
    validationStatus: string;
    rejectedAtLevel: number | null;
    resolvedProgramId: string | null;
    resolvedIntakeApprovalId: string | null;
    createdAt: Date | string;
}
export interface StagingAnomalySummary {
    anomalyId: string;
    recordId: string;
    anomalyCode: string;
    severity: string;
    validationLevel: number;
    fieldName: string | null;
    isResolved: boolean;
    createdAt: Date | string;
}
export interface StagingStatusSummary {
    status: string;
    count: number;
}
export interface StagingRecordActor extends BatchActor {
}
export declare function ingestStagingRecords(input: StagingRecordActor & {
    batchId: string;
    rows: readonly StagingRecordInput[];
}): Promise<{
    insertedCount: number;
}>;
export declare function listStagingRecordSummaries(input: StagingRecordActor & {
    batchId: string;
    limit?: number;
    offset?: number;
}): Promise<StagingRecordSummary[]>;
export declare function listStagingAnomalies(input: StagingRecordActor & {
    batchId: string;
    limit?: number;
    offset?: number;
}): Promise<StagingAnomalySummary[]>;
export declare function getStagingStatusSummary(input: StagingRecordActor & {
    batchId: string;
}): Promise<StagingStatusSummary[]>;
export {};
