export interface CredentialActor {
    actorUserId: string;
    requestId: string;
}
export interface CredentialSummary {
    credentialId: string;
    academicYear: string;
    institutionId: string;
    programId: string;
    credentialType: string;
    periodLabel: string;
    status: string;
    validFrom: Date | string;
    validUntil: Date | string | null;
    issuedAt: Date | string;
}
export interface IssueCredentialInput extends CredentialActor {
    enrolmentId: string;
    academicYear: string;
    credentialType: string;
    periodLabel?: string;
    issuerDid: string;
    verificationMethod: string;
    proofType: string;
    proofValue: string;
    vcDocument: unknown;
    credentialHash: Buffer;
    statusListId?: string;
    statusListIndex?: number;
    validFrom?: string;
    validUntil?: string | null;
    supersedesCredentialId?: string;
}
export interface UpdateCredentialStatusInput extends CredentialActor {
    credentialId: string;
    status: "ISSUED" | "SUSPENDED" | "REVOKED";
    reason: "ADMINISTRATIVE_REVIEW" | "COMPLIANCE_REVIEW" | "DATA_CORRECTION" | "SUSPECTED_FRAUD";
}
export declare function issueCredential(input: IssueCredentialInput): Promise<CredentialSummary>;
export declare function updateCredentialStatus(input: UpdateCredentialStatusInput): Promise<void>;
export declare function getCredentialById(input: CredentialActor & {
    credentialId: string;
}): Promise<CredentialSummary>;
