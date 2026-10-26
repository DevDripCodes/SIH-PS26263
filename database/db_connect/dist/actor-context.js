"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActorContextError = void 0;
exports.resolveActorContext = resolveActorContext;
class ActorContextError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "ActorContextError";
        this.code = code;
    }
}
exports.ActorContextError = ActorContextError;
const ACTOR_ROLES = new Set([
    "AICTE_SUPER_ADMIN",
    "AICTE_REGIONAL_OFFICER",
    "AFFILIATING_BODY_REGISTRAR",
    "INSTITUTION_NODAL_OFFICER",
    "EMPLOYER_VERIFIER",
    "STUDENT",
]);
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/**
 * Resolves the canonical actor profile inside an existing transaction.
 *
 * actorUserId must come from backend-verified authentication.
 * The transaction-local actor ID is only a consistency check,
 * never proof of authentication.
 *
 * Database errors propagate unchanged. No authorization context is cached.
 */
async function resolveActorContext(tx, actorUserId) {
    if (typeof actorUserId !== "string" || !UUID_REGEX.test(actorUserId)) {
        throw new ActorContextError("INVALID_ACTOR_USER_ID", "Actor user ID must be a valid UUID.");
    }
    const normalizedActorUserId = actorUserId.toLowerCase();
    const result = await tx.query(`
      SELECT
        up.user_id::text AS user_id,
        up.role::text AS role,
        up.institution_id::text AS institution_id,
        up.affiliating_body_id::text AS affiliating_body_id,
        up.aicte_region,
        up.is_active,
        NULLIF(
          current_setting('app.actor_user_id', true),
          ''
        ) AS transaction_actor_user_id
      FROM master.user_profiles AS up
      WHERE up.user_id = $1::uuid
      LIMIT 1
      FOR SHARE OF up
    `, [normalizedActorUserId]);
    const profile = result.rows[0];
    if (!profile) {
        throw new ActorContextError("ACTOR_PROFILE_NOT_FOUND", "No canonical profile exists for this actor.");
    }
    // Consistency check only. This setting does not authenticate the caller.
    const transactionActorUserId = profile.transaction_actor_user_id;
    if (transactionActorUserId !== null &&
        transactionActorUserId.toLowerCase() !== normalizedActorUserId) {
        throw new ActorContextError("ACTOR_CONTEXT_MISMATCH", "The supplied actor does not match the transaction actor.");
    }
    if (profile.is_active !== true) {
        if (profile.is_active === false) {
            throw new ActorContextError("ACTOR_PROFILE_INACTIVE", "The actor profile is inactive.");
        }
        throw new ActorContextError("ACTOR_PROFILE_INVALID", "The actor profile has an invalid active-status value.");
    }
    if (typeof profile.role !== "string" ||
        !ACTOR_ROLES.has(profile.role)) {
        throw new ActorContextError("ACTOR_ROLE_INVALID", "The actor profile contains an unrecognized role.");
    }
    return {
        userId: profile.user_id,
        role: profile.role,
        institutionId: profile.institution_id,
        affiliatingBodyId: profile.affiliating_body_id,
        aicteRegion: profile.aicte_region,
    };
}
