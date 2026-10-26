export interface IntakeActor {
    actorUserId: string;
    requestId: string;
}
export interface IntakeApprovalSummary {
    intakeApprovalId: string;
    programId: string;
    institutionId: string;
    academicYear: string;
    eoaIssueDate: string;
    approvedSanctionedIntake: number;
    approvedNriSeats: number;
    approvedTfwSeats: number;
    approvedFnOciCiwgcSeats: number;
    approvedPmsssSeats: number;
    approvedEwsSeats: number;
    approvedLateralEntrySeats: number;
    lockedByAicte: boolean;
    admissionCutoffDate: string;
}
export interface IntakeSeatCaps {
    approvedSanctionedIntake: number;
    approvedNriSeats: number;
    approvedTfwSeats: number;
    approvedFnOciCiwgcSeats: number;
    approvedPmsssSeats: number;
    approvedEwsSeats: number;
    approvedLateralEntrySeats: number;
}
export declare function getIntakeApprovalById(input: IntakeActor & {
    intakeApprovalId: string;
}): Promise<IntakeApprovalSummary>;
export declare function getIntakeApprovalByProgramYear(input: IntakeActor & {
    programId: string;
    academicYear: string;
}): Promise<IntakeApprovalSummary | null>;
export declare function listIntakeApprovalsByInstitutionYear(input: IntakeActor & {
    institutionId: string;
    academicYear: string;
    limit?: number;
    offset?: number;
}): Promise<IntakeApprovalSummary[]>;
export declare function updateIntakeApprovalCaps(input: IntakeActor & {
    intakeApprovalId: string;
    caps: IntakeSeatCaps;
    lockedByAicte?: boolean;
}): Promise<IntakeApprovalSummary>;
