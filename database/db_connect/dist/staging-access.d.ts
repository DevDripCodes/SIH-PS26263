import { type MasterResourceScope } from "./authorization";
import type { DbTx } from "./pool";
export interface AuthorizedBatch {
    batchId: string;
    institutionId: string;
    academicYear: string;
    scope: MasterResourceScope;
}
export interface SystemBatch extends AuthorizedBatch {
    status: string;
}
/** Resolve the batch and institution ownership from PostgreSQL inside the caller's transaction. */
export declare function resolveAuthorizedBatch(tx: DbTx, actorUserId: string, batchId: string, lock?: boolean): Promise<AuthorizedBatch>;
/** Restricted worker path: callers must already be inside the internal system transaction wrapper. */
export declare function resolveSystemBatch(tx: DbTx, batchId: string, lock?: boolean): Promise<SystemBatch>;
