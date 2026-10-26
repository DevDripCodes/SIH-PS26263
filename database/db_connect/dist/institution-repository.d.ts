import type { DbTx } from "./pool";
import { type MasterResourceReference } from "./master-access";
import type { CacheVersionNamespace } from "./cache-version";
export { PostCommitCacheInvalidationError } from "./cache-invalidation-policy";
import { type MasterPermission } from "./authorization";
export type InstitutionApprovalStatus = "EOA_GRANTED" | "NO_ADMISSION" | "WITHDRAWN" | "SUSPENDED";
export interface InstitutionActorContext {
    actorUserId: string;
    requestId: string;
}
export interface GetInstitutionByIdInput {
    institutionId: string;
    actorContext: InstitutionActorContext;
}
export interface UpdateInstitutionApprovalStatusInput {
    institutionId: string;
    approvalStatus: InstitutionApprovalStatus;
    actorContext: InstitutionActorContext;
}
export interface InstitutionSummary {
    institutionId: string;
    institutionName: string;
    institutionCategory: string;
    aicteRegion: string;
    stateCode: string;
    districtName: string;
    approvalStatus: string;
    isMinorityInstitution: boolean;
    isWomenOnly: boolean;
}
export interface InstitutionRepositoryDependencies {
    withActorTx<T>(actorContext: InstitutionActorContext, operation: (tx: DbTx) => Promise<T>): Promise<T>;
    withMasterResourceAuthorization<T>(tx: DbTx, actorUserId: string, permission: MasterPermission, resource: MasterResourceReference, operation: (tx: DbTx, resource: Readonly<MasterResourceReference>) => Promise<T>): Promise<T>;
    getOrSetVersioned<T>(namespace: CacheVersionNamespace, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T>;
    invalidateCacheNamespaces(...namespaces: CacheVersionNamespace[]): Promise<void>;
}
export declare function createInstitutionRepository(dependencies: InstitutionRepositoryDependencies): {
    getById: (input: GetInstitutionByIdInput) => Promise<InstitutionSummary>;
    updateApprovalStatus: (input: UpdateInstitutionApprovalStatusInput) => Promise<InstitutionSummary>;
};
export declare const getById: (input: GetInstitutionByIdInput) => Promise<InstitutionSummary>;
export declare const updateApprovalStatus: (input: UpdateInstitutionApprovalStatusInput) => Promise<InstitutionSummary>;
