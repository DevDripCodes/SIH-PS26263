import type { ActorContext, ActorRole } from "./actor-context";

export type MasterPermission =
  | "master.institution.read"
  | "master.institution.manage"
  | "master.program.read"
  | "master.intake.read"
  | "master.intake.manage";

export interface MasterResourceScope {
  institutionId: string;
  affiliatingBodyId: string | null;
  aicteRegion: string | null;
}

export type AuthorizationErrorCode =
  | "INVALID_PERMISSION"
  | "INVALID_ACTOR_CONTEXT"
  | "INVALID_RESOURCE_SCOPE"
  | "FORBIDDEN";

/**
 * Generic authorization error messages avoid exposing internal ownership
 * or scope information to callers.
 */
export class AuthorizationError extends Error {
  readonly code: AuthorizationErrorCode;

  constructor(code: AuthorizationErrorCode) {
    super("Authorization request denied.");
    this.name = "AuthorizationError";
    this.code = code;
  }
}

const PERMISSIONS: ReadonlySet<string> = new Set([
  "master.institution.read",
  "master.institution.manage",
  "master.program.read",
  "master.intake.read",
  "master.intake.manage",
]);

const READ_PERMISSIONS: ReadonlySet<MasterPermission> = new Set([
  "master.institution.read",
  "master.program.read",
  "master.intake.read",
]);

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

const AICTE_REGIONS: ReadonlySet<string> = new Set([
  "NORTH",
  "NORTH_WEST",
  "SOUTH",
  "SOUTH_WEST",
  "CENTRAL",
  "EAST",
  "WEST",
  "SOUTH_CENTRAL",
]);

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

function normalizeUuid(value: string): string {
  return value.toLowerCase();
}

function normalizeRegion(value: string): string {
  return value.trim().toUpperCase();
}

function isValidNullableUuid(value: unknown): boolean {
  return value === null || isUuid(value);
}

function isValidNullableRegion(value: unknown): boolean {
  return (
    value === null ||
    (
      typeof value === "string" &&
      AICTE_REGIONS.has(normalizeRegion(value))
    )
  );
}

/**
 * Runtime validation is required because TypeScript types do not protect
 * against JavaScript callers or unsafe casts.
 */
export function isMasterPermission(
  value: unknown,
): value is MasterPermission {
  return typeof value === "string" && PERMISSIONS.has(value);
}

/**
 * Validate the actor without using an assertion signature that narrows
 * the role union. This ensures the super-admin branch remains reachable
 * to TypeScript after validation.
 */
function assertValidActor(actor: ActorContext): void {
  if (
    actor === null ||
    typeof actor !== "object" ||
    !isUuid(actor.userId) ||
    typeof actor.role !== "string" ||
    !ACTOR_ROLES.has(actor.role) ||
    !isValidNullableUuid(actor.institutionId) ||
    !isValidNullableUuid(actor.affiliatingBodyId) ||
    !isValidNullableRegion(actor.aicteRegion)
  ) {
    throw new AuthorizationError("INVALID_ACTOR_CONTEXT");
  }
}

function assertValidResourceScope(
  resource: MasterResourceScope,
): void {
  if (
    resource === null ||
    typeof resource !== "object" ||
    !isUuid(resource.institutionId) ||
    !isValidNullableUuid(resource.affiliatingBodyId) ||
    !isValidNullableRegion(resource.aicteRegion)
  ) {
    throw new AuthorizationError("INVALID_RESOURCE_SCOPE");
  }
}

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
export function authorizeMasterAccess(
  actor: ActorContext,
  permission: MasterPermission,
  resource: MasterResourceScope,
): void {
  // 1. Validate runtime inputs before evaluating the policy.
  if (!isMasterPermission(permission)) {
    throw new AuthorizationError("INVALID_PERMISSION");
  }

  assertValidActor(actor);
  assertValidResourceScope(resource);

  // 2. Super-admins may perform every supported permission.
  if (actor.role === "AICTE_SUPER_ADMIN") {
    return;
  }

  // 3. All management operations are restricted to super-admins.
  if (
    permission === "master.institution.manage" ||
    permission === "master.intake.manage"
  ) {
    throw new AuthorizationError("FORBIDDEN");
  }

  // 4. Remaining permissions must be read permissions.
  if (!READ_PERMISSIONS.has(permission)) {
    throw new AuthorizationError("FORBIDDEN");
  }

  // 5. Scope-aware read authorization.
  switch (actor.role) {
    case "AICTE_REGIONAL_OFFICER": {
      const actorRegion =
        actor.aicteRegion === null
          ? null
          : normalizeRegion(actor.aicteRegion);

      const resourceRegion =
        resource.aicteRegion === null
          ? null
          : normalizeRegion(resource.aicteRegion);

      if (
        actorRegion !== null &&
        resourceRegion !== null &&
        actorRegion === resourceRegion
      ) {
        return;
      }

      throw new AuthorizationError("FORBIDDEN");
    }

    case "AFFILIATING_BODY_REGISTRAR": {
      if (
        actor.affiliatingBodyId !== null &&
        resource.affiliatingBodyId !== null &&
        normalizeUuid(actor.affiliatingBodyId) ===
          normalizeUuid(resource.affiliatingBodyId)
      ) {
        return;
      }

      throw new AuthorizationError("FORBIDDEN");
    }

    case "INSTITUTION_NODAL_OFFICER": {
      if (
        actor.institutionId !== null &&
        normalizeUuid(actor.institutionId) ===
          normalizeUuid(resource.institutionId)
      ) {
        return;
      }

      throw new AuthorizationError("FORBIDDEN");
    }

    case "EMPLOYER_VERIFIER":
    case "STUDENT":
      throw new AuthorizationError("FORBIDDEN");

    default:
      // Fail closed if unexpected runtime role data reaches this branch.
      throw new AuthorizationError("INVALID_ACTOR_CONTEXT");
  }
}