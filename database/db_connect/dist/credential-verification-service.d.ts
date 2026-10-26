export type VerificationPurpose = "EMPLOYMENT_VERIFICATION" | "HIGHER_EDUCATION_ADMISSION" | "SCHOLARSHIP_ELIGIBILITY" | "GOVERNMENT_SCHEME_BENEFIT" | "DIGILOCKER_ISSUANCE";
export type PublicVerificationResult = "VERIFIED" | "CONSENT_REQUIRED" | "RATE_LIMITED" | "NOT_AUTHORISED" | "NOT_VALID" | "NOT_VERIFIED";
export interface CredentialVerificationResult {
    result: PublicVerificationResult;
    verification_id: string;
    credential_type?: string;
    issued_at?: string;
    institution_id?: string;
    disclosure_scope?: string[];
}
export interface VerifyCredentialInput {
    actorUserId: string;
    requestId: string;
    verifierOrgId: string;
    credentialId: string;
    purpose: VerificationPurpose;
    presentedApaarId: string;
    presentedRollId: string;
    clientFingerprint?: Buffer;
}
export declare function verifyCredential(input: VerifyCredentialInput): Promise<CredentialVerificationResult>;
