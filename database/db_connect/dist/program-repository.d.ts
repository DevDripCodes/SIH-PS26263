export interface ProgramActor {
    actorUserId: string;
    requestId: string;
}
export interface ProgramSummary {
    programId: string;
    institutionId: string;
    aicteCourseId: string;
    programLevel: string;
    programShift: string;
    broadDiscipline: string;
    courseName: string;
    durationYears: string;
    nbaAccredited: boolean;
    nbaValidUpto: string | null;
    isActive: boolean;
}
export declare function getProgramById(input: ProgramActor & {
    programId: string;
}): Promise<ProgramSummary>;
export declare function listProgramsByInstitution(input: ProgramActor & {
    institutionId: string;
    limit?: number;
    offset?: number;
}): Promise<ProgramSummary[]>;
