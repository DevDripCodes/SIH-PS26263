export interface VerifierOrganisationSummary {
    verifierOrgId: string;
    orgType: string;
    legalName: string;
    status: string;
}
export interface VerifierActor {
    actorUserId: string;
    requestId: string;
}
export type VerifierOrganisationType = "EMPLOYER" | "BGV_AGENCY" | "EDUCATIONAL_INSTITUTION" | "GOVERNMENT_AGENCY" | "DIGILOCKER_PLATFORM";
export type VerifierRegistrationType = "CIN" | "LLPIN" | "GSTIN" | "PAN" | "AICTE_ID" | "OTHER";
export declare function registerVerifierOrganisation(input: VerifierActor & {
    orgType: VerifierOrganisationType;
    legalName: string;
    registrationType: VerifierRegistrationType;
    registrationNo: string;
    contactEmail: string;
}): Promise<VerifierOrganisationSummary>;
export declare function getVerifierOrganisation(input: VerifierActor & {
    verifierOrgId: string;
}): Promise<VerifierOrganisationSummary>;
export declare function listMyVerifierOrganisations(input: VerifierActor & {
    limit?: number;
    offset?: number;
}): Promise<VerifierOrganisationSummary[]>;
export declare function reviewVerifierOrganisation(input: VerifierActor & {
    verifierOrgId: string;
    status: "APPROVED" | "SUSPENDED" | "REVOKED";
}): Promise<VerifierOrganisationSummary>;
export declare function addVerifierOrganisationMember(input: VerifierActor & {
    userId: string;
    verifierOrgId: string;
}): Promise<void>;
export declare function setMyVerifierMembershipActive(input: VerifierActor & {
    active: boolean;
}): Promise<void>;
export declare function setVerifierMembershipActive(input: VerifierActor & {
    userId: string;
    active: boolean;
}): Promise<void>;
