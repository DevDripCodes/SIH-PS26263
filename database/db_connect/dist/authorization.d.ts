import type { ActorContext } from "./actor-context";
export type MasterPermission = "master.institution.read" | "master.institution.manage" | "master.program.read" | "master.intake.read" | "master.intake.manage";
export interface MasterResourceScope {
    institutionId: string;
    affiliatingBodyId: string | null;
    aicteRegion: string | null;
}
export type AuthorizationErrorCode = "INVALID_PERMISSION" | "INVALID_ACTOR_CONTEXT" | "INVALID_RESOURCE_SCOPE" | "FORBIDDEN";
/**
 * Generic authorization error messages avoid exposing internal ownership
 * or scope information to callers.
 */
export declare class AuthorizationError extends Error {
    readonly code: AuthorizationErrorCode;
    constructor(code: AuthorizationErrorCode);
}
/**
 * Runtime validation is required because TypeScript types do not protect
 * against JavaScript callers or unsafe casts.
 */
export declare function isMasterPermission(value: unknown): value is MasterPermission;
/**
 * Pure, object-level authorization policy.
 *
 * This function performs no database access, caching, or side effects.
 * Its caller must obtain the resource scope from the internal
 * master-access layer, not trust a scope supplied by a client.
 *
 * Only AICTE_SUPER_ADMIN may perform management operations.
 *
 * Policy discrepancy:
 * master.sql currently permits AICTE_REGIONAL_OFFICER to read across
 * regions through its RLS policies. This SDK policy deliberately restricts
 * regional officers to resources in their assigned region.
 */
export declare function authorizeMasterAccess(actor: ActorContext, permission: MasterPermission, resource: MasterResourceScope): void;
