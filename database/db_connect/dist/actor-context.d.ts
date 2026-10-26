import type { DbTx } from "./pool";
export type ActorRole = "AICTE_SUPER_ADMIN" | "AICTE_REGIONAL_OFFICER" | "AFFILIATING_BODY_REGISTRAR" | "INSTITUTION_NODAL_OFFICER" | "EMPLOYER_VERIFIER" | "STUDENT";
export interface ActorContext {
    userId: string;
    role: ActorRole;
    institutionId: string | null;
    affiliatingBodyId: string | null;
    aicteRegion: string | null;
}
export type ActorContextErrorCode = "INVALID_ACTOR_USER_ID" | "ACTOR_PROFILE_NOT_FOUND" | "ACTOR_PROFILE_INACTIVE" | "ACTOR_ROLE_INVALID" | "ACTOR_PROFILE_INVALID" | "ACTOR_CONTEXT_MISMATCH";
export declare class ActorContextError extends Error {
    readonly code: ActorContextErrorCode;
    constructor(code: ActorContextErrorCode, message: string);
}
/**
 * Resolves the canonical actor profile inside an existing transaction.
 *
 * actorUserId must come from backend-verified authentication.
 * The transaction-local actor ID is only a consistency check,
 * never proof of authentication.
 *
 * Database errors propagate unchanged. No authorization context is cached.
 */
export declare function resolveActorContext(tx: DbTx, actorUserId: string): Promise<ActorContext>;
