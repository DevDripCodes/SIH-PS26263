export interface CoreActor {
    actorUserId: string;
    requestId: string;
}
export interface StudentSummary {
    studentId: string;
    fullName: string;
    gender: string | null;
    residencyStatus: string;
    apaarVerificationStatus: string;
}
export interface EnrolmentSummary {
    enrolmentId: string;
    academicYear: string;
    studentId: string;
    institutionId: string;
    programId: string;
    intakeApprovalId: string;
    seatQuotaType: string;
    entryYearOfStudy: number;
    admissionDate: string;
    enrolmentStatus: string;
}
export interface EnrolmentStatusHistory {
    historyId: string;
    enrolmentId: string;
    academicYear: string;
    fromStatus: string | null;
    toStatus: string;
    changedAt: Date | string;
}
export declare function getStudentById(input: CoreActor & {
    studentId: string;
}): Promise<StudentSummary>;
export declare function listStudentEnrolments(input: CoreActor & {
    studentId: string;
    limit?: number;
    offset?: number;
}): Promise<EnrolmentSummary[]>;
export declare function getEnrolment(input: CoreActor & {
    enrolmentId: string;
    academicYear: string;
}): Promise<EnrolmentSummary>;
export declare function listEnrolmentStatusHistory(input: CoreActor & {
    enrolmentId: string;
    academicYear: string;
    limit?: number;
    offset?: number;
}): Promise<EnrolmentStatusHistory[]>;
