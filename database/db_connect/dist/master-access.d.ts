import type { DbTx } from "./pool";
import { type MasterPermission } from "./authorization";
export type MasterResourceReference = {
    readonly kind: "institution";
    readonly id: string;
} | {
    readonly kind: "program";
    readonly id: string;
} | {
    readonly kind: "intake";
    readonly id: string;
};
export type AuthorizedMasterOperation<T> = (tx: DbTx, resource: Readonly<MasterResourceReference>) => Promise<T>;
/**
 * Authorizes a single master-schema resource and invokes the protected
 * operation using the same transaction used for actor resolution, resource
 * scope resolution, and row locking.
 *
 * authenticatedActorUserId must come from backend-verified authentication.
 *
 * This function does not start, commit, or roll back transactions. The
 * withActorTx/withSystemTx wrapper owns those responsibilities.
 */
export declare function withMasterResourceAuthorization<T>(tx: DbTx, authenticatedActorUserId: string, permission: MasterPermission, resource: MasterResourceReference, operation: AuthorizedMasterOperation<T>): Promise<T>;
