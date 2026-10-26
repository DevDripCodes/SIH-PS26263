export interface ConsentActor {
    actorUserId: string;
    requestId: string;
}
export interface ConsentSummary {
    consentId: string;
    granteeOrgId: string;
    purpose: string;
    scopeCredentialId: string | null;
    scopeAllCredentials: boolean;
    disclosureScope: string[];
    grantedAt: Date | string;
    expiresAt: Date | string;
    status: string;
    withdrawnAt: Date | string | null;
}
export declare function createConsent(input: ConsentActor & {
    granteeOrgId: string;
    purpose: string;
    scopeCredentialId?: string;
    scopeAllCredentials: boolean;
    disclosureScope: readonly string[];
    consentTextVersion: string;
    grantChannel: string;
    consentArtifactHash: Buffer;
    guardianConsent?: boolean;
    guardianArtifactHash?: Buffer | null;
    expiresAt: string;
}): Promise<ConsentSummary>;
export declare function listMyConsents(input: ConsentActor & {
    limit?: number;
    offset?: number;
}): Promise<ConsentSummary[]>;
export declare function withdrawMyConsent(input: ConsentActor & {
    consentId: string;
    channel: string;
}): Promise<void>;
