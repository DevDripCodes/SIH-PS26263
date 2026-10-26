export interface AuditVerification {
    ok: boolean;
    rowsChecked: string | number;
    firstBadSequence: string | number | null;
    reason: string | null;
}
declare const APPLICATION_EVENTS: {
    readonly BATCH_CREATED: {
        readonly chain: "app_core";
        readonly event: "BATCH.CREATED";
        readonly subject: "BATCH";
    };
    readonly BATCH_PROMOTED: {
        readonly chain: "app_core";
        readonly event: "BATCH.PROMOTED";
        readonly subject: "BATCH";
    };
    readonly CREDENTIAL_ISSUED: {
        readonly chain: "app_trust";
        readonly event: "CREDENTIAL.ISSUED_BY_APP";
        readonly subject: "CREDENTIAL";
    };
    readonly CONSENT_WITHDRAWN: {
        readonly chain: "app_trust";
        readonly event: "CONSENT.WITHDRAWN_BY_APP";
        readonly subject: "CONSENT";
    };
    readonly VERIFIER_ORG_REVIEWED: {
        readonly chain: "app_trust";
        readonly event: "VERIFIER_ORG.REVIEWED_BY_APP";
        readonly subject: "VERIFIER_ORG";
    };
};
export declare function logApplicationAuditEvent(input: {
    actorUserId: string;
    requestId: string;
    event: keyof typeof APPLICATION_EVENTS;
    subjectId: string;
    institutionId?: string;
    outcome: "SUCCESS" | "DENIED" | "FAILED";
}): Promise<void>;
export declare function verifyAuditChain(input: {
    actorUserId: string;
    requestId: string;
    chainKey: string;
    fromSequence?: number;
    toSequence?: number;
}): Promise<AuditVerification>;
export {};
