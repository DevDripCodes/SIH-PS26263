export interface ProgramPromotionResult extends Record<string, unknown> {
    batch_id: string;
    program_id: string;
    promoted: number;
    quarantined: number;
    already_enrolled?: number;
    by_code: Record<string, number>;
    by_quota?: Record<string, number>;
}
export interface BatchPromotionResult extends Record<string, unknown> {
    batch_id: string;
    status: string;
    programs: ProgramPromotionResult[];
    already_finalised?: boolean;
}
export declare function promoteBatch(actorUserId: string, requestId: string, batchId: string): Promise<BatchPromotionResult>;
export declare function promoteProgramBatch(actorUserId: string, requestId: string, batchId: string, programId: string): Promise<ProgramPromotionResult>;
export declare function finalizeBatch(actorUserId: string, requestId: string, batchId: string): Promise<string>;
export declare function promoteBatchAsSystem(batchId: string): Promise<BatchPromotionResult>;
export declare function promoteProgramBatchAsSystem(batchId: string, programId: string): Promise<ProgramPromotionResult>;
export declare function finalizeBatchAsSystem(batchId: string): Promise<string>;
