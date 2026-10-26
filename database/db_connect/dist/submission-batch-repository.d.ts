export interface BatchActor {
    actorUserId: string;
    requestId: string;
}
export interface SubmissionBatchSummary {
    batchId: string;
    institutionId: string;
    academicYear: string;
    sourceChannel: string;
    status: string;
    totalRows: number;
    rejectedRows: number;
    quarantinedRows: number;
    promotedRows: number;
    uploadedAt: Date | string;
    completedAt: Date | string | null;
}
export declare function createSubmissionBatch(input: BatchActor & {
    institutionId: string;
    academicYear: string;
    sourceChannel: "CSV_UPLOAD" | "EXCEL_UPLOAD" | "ERP_API";
    fileSha256: string;
    fileSizeBytes?: number;
}): Promise<{
    batch: SubmissionBatchSummary;
    duplicate: boolean;
}>;
export declare function getSubmissionBatch(input: BatchActor & {
    batchId: string;
}): Promise<SubmissionBatchSummary>;
export declare function listSubmissionBatches(input: BatchActor & {
    institutionId: string;
    academicYear?: string;
    limit?: number;
    offset?: number;
}): Promise<SubmissionBatchSummary[]>;
/** Worker-only pre-promotion transitions. Promotion/final states remain owned by core's SQL functions. */
export declare function transitionSubmissionBatchAsWorker(input: {
    batchId: string;
    nextStatus: string;
    failureCode?: string;
}): Promise<SubmissionBatchSummary>;
