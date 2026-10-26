export interface AffiliatingBodyActor {
    actorUserId: string;
    requestId: string;
}
export interface AffiliatingBodySummary {
    affiliatingBodyId: string;
    aisheCode: string;
    bodyName: string;
    bodyType: string;
    stateCode: string;
    isActive: boolean;
}
export declare function getAffiliatingBodyById(input: AffiliatingBodyActor & {
    affiliatingBodyId: string;
}): Promise<AffiliatingBodySummary>;
/** Lists all only for super-admins, and only the actor's body for registrars. */
export declare function listAffiliatingBodies(input: AffiliatingBodyActor): Promise<AffiliatingBodySummary[]>;
