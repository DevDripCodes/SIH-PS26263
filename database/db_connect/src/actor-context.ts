import type { DbTx } from "./pool";

export type ActorRole =
  | "AICTE_SUPER_ADMIN"
  | "AICTE_REGIONAL_OFFICER"
  | "AFFILIATING_BODY_REGISTRAR"
  | "INSTITUTION_NODAL_OFFICER"
  | "EMPLOYER_VERIFIER"
  | "STUDENT";

export interface ActorContext {
  userId: string;
  role: ActorRole;
  institutionId: string | null;
  affiliatingBodyId: string | null;
  aicteRegion: string | null;
}

export type ActorContextErrorCode =
  | "INVALID_ACTOR_USER_ID"
  | "ACTOR_PROFILE_NOT_FOUND"
  | "ACTOR_PROFILE_INACTIVE"
  | "ACTOR_ROLE_INVALID"
  | "ACTOR_PROFILE_INVALID"
  | "ACTOR_CONTEXT_MISMATCH";

export class ActorContextError extends Error {
  public readonly code: ActorContextErrorCode;

  constructor(code: ActorContextErrorCode, message: string) {
    super(message);
    this.name = "ActorContextError";
    this.code = code;
  }
}

interface ActorProfileRow {
  user_id: string;
  role: string;
  institution_id: string | null;
  affiliating_body_id: string | null;
  aicte_region: string | null;
  is_active: boolean;
  transaction_actor_user_id: string | null;
}

const ACTOR_ROLES: ReadonlySet<string> = new Set<ActorRole>([
  "AICTE_SUPER_ADMIN",
  "AICTE_REGIONAL_OFFICER",
  "AFFILIATING_BODY_REGISTRAR",
  "INSTITUTION_NODAL_OFFICER",
  "EMPLOYER_VERIFIER",
  "STUDENT",
]);

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Resolves the canonical actor profile inside an existing transaction.
 *
 * actorUserId must come from backend-verified authentication.
 * The transaction-local actor ID is only a consistency check,
 * never proof of authentication.
 *
 * Database errors propagate unchanged. No authorization context is cached.
 */
export async function resolveActorContext(
  tx: DbTx,
  actorUserId: string,
): Promise<ActorContext> {
  if (typeof actorUserId !== "string" || !UUID_REGEX.test(actorUserId)) {
    throw new ActorContextError(
      "INVALID_ACTOR_USER_ID",
      "Actor user ID must be a valid UUID.",
    );
  }

  const normalizedActorUserId = actorUserId.toLowerCase();

  const result = await tx.query<ActorProfileRow>(
    `
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
    `,
    [normalizedActorUserId],
  );

  const profile = result.rows[0];

  if (!profile) {
    throw new ActorContextError(
      "ACTOR_PROFILE_NOT_FOUND",
      "No canonical profile exists for this actor.",
    );
  }

  // Consistency check only. This setting does not authenticate the caller.
  const transactionActorUserId = profile.transaction_actor_user_id;

  if (
    transactionActorUserId !== null &&
    transactionActorUserId.toLowerCase() !== normalizedActorUserId
  ) {
    throw new ActorContextError(
      "ACTOR_CONTEXT_MISMATCH",
      "The supplied actor does not match the transaction actor.",
    );
  }

  if (profile.is_active !== true) {
    if (profile.is_active === false) {
      throw new ActorContextError(
        "ACTOR_PROFILE_INACTIVE",
        "The actor profile is inactive.",
      );
    }

    throw new ActorContextError(
      "ACTOR_PROFILE_INVALID",
      "The actor profile has an invalid active-status value.",
    );
  }

  if (
    typeof profile.role !== "string" ||
    !ACTOR_ROLES.has(profile.role)
  ) {
    throw new ActorContextError(
      "ACTOR_ROLE_INVALID",
      "The actor profile contains an unrecognized role.",
    );
  }

  return {
    userId: profile.user_id,
    role: profile.role as ActorRole,
    institutionId: profile.institution_id,
    affiliatingBodyId: profile.affiliating_body_id,
    aicteRegion: profile.aicte_region,
  };
}