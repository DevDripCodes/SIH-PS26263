import type { DbTx } from "./pool";
import { resolveActorContext } from "./actor-context";

import {
  AuthorizationError,
  authorizeMasterAccess,
  isMasterPermission,
  type MasterPermission,
  type MasterResourceScope,
} from "./authorization";

// -----------------------------------------------------------------------------
// Resource contracts
// -----------------------------------------------------------------------------

export type MasterResourceReference =
  | {
      readonly kind: "institution";
      readonly id: string;
    }
  | {
      readonly kind: "program";
      readonly id: string;
    }
  | {
      readonly kind: "intake";
      readonly id: string;
    };

interface ResourceScopeRow {
  institutionId: string;
  affiliatingBodyId: string | null;
  aicteRegion: string | null;
}

type ResourceLockMode = "none" | "share" | "update";

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// -----------------------------------------------------------------------------
// Runtime validation
// -----------------------------------------------------------------------------

function assertValidResourceReference(
  value: MasterResourceReference,
): void {
  if (
    value === null ||
    typeof value !== "object" ||
    !["institution", "program", "intake"].includes(value.kind) ||
    typeof value.id !== "string" ||
    !UUID_REGEX.test(value.id)
  ) {
    throw new AuthorizationError("INVALID_RESOURCE_SCOPE");
  }
}

function assertPermissionMatchesResource(
  permission: MasterPermission,
  kind: MasterResourceReference["kind"],
): void {
  const isCompatible =
    ((permission === "master.institution.read" ||
      permission === "master.institution.manage") &&
      kind === "institution") ||
    (permission === "master.program.read" && kind === "program") ||
    ((permission === "master.intake.read" ||
      permission === "master.intake.manage") &&
      kind === "intake");

  if (!isCompatible) {
    throw new AuthorizationError("INVALID_RESOURCE_SCOPE");
  }
}

// -----------------------------------------------------------------------------
// Authoritative scope resolution and row locking
// -----------------------------------------------------------------------------

/**
 * Resolves the resource's authoritative institution/body/region scope.
 *
 * "none"   performs an unlocked read, used only for the initial authorization
 *          check before institution management obtains its exclusive lock.
 *
 * "share"  uses the existing shared locks for reads, programs, and intakes.
 *
 * "update" exclusively locks the institution row. It must be used only for
 *          the institution-management path.
 *
 * Scope values always come from PostgreSQL, never from caller-supplied fields.
 */
async function resolveResourceScope(
  tx: DbTx,
  resource: MasterResourceReference,
  lockMode: ResourceLockMode = "share",
): Promise<MasterResourceScope> {
  let sql: string;

  switch (resource.kind) {
    case "institution": {
      // This clause can only come from the internal lock-mode enum.
      const lockClause =
        lockMode === "update"
          ? "FOR UPDATE OF i"
          : lockMode === "share"
            ? "FOR SHARE OF i"
            : "";

      sql = `
        SELECT
          i.institution_id::text AS "institutionId",
          i.affiliating_body_id::text AS "affiliatingBodyId",
          i.aicte_region AS "aicteRegion"
        FROM master.institutions AS i
        WHERE i.institution_id = $1::uuid
        ${lockClause}
      `;
      break;
    }

    case "program":
      // Preserve the existing program locking behavior.
      sql = `
        SELECT
          i.institution_id::text AS "institutionId",
          i.affiliating_body_id::text AS "affiliatingBodyId",
          i.aicte_region AS "aicteRegion"
        FROM master.institutional_programs AS p
        JOIN master.institutions AS i
          ON i.institution_id = p.institution_id
        WHERE p.program_id = $1::uuid
        FOR SHARE OF p, i
      `;
      break;

    case "intake":
      // Preserve the existing intake locking behavior.
      sql = `
        SELECT
          i.institution_id::text AS "institutionId",
          i.affiliating_body_id::text AS "affiliatingBodyId",
          i.aicte_region AS "aicteRegion"
        FROM master.program_intake_approvals AS a
        JOIN master.institutions AS i
          ON i.institution_id = a.institution_id
        WHERE a.intake_approval_id = $1::uuid
        FOR SHARE OF a, i
      `;
      break;

    default:
      throw new AuthorizationError("INVALID_RESOURCE_SCOPE");
  }

  const result = await tx.query<ResourceScopeRow>(
    sql,
    [resource.id],
  );

  const row = result.rows[0];

  if (!row) {
    throw new AuthorizationError("FORBIDDEN");
  }

  // Apply the authorization module's runtime validation and branding.
  return {
  institutionId: row.institutionId,
  affiliatingBodyId: row.affiliatingBodyId,
  aicteRegion: row.aicteRegion,
  };
}

// -----------------------------------------------------------------------------
// Authorized callback contract
// -----------------------------------------------------------------------------

export type AuthorizedMasterOperation<T> = (
  tx: DbTx,
  resource: Readonly<MasterResourceReference>,
) => Promise<T>;

// -----------------------------------------------------------------------------
// Authorization and protected operation
// -----------------------------------------------------------------------------

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
export async function withMasterResourceAuthorization<T>(
  tx: DbTx,
  authenticatedActorUserId: string,
  permission: MasterPermission,
  resource: MasterResourceReference,
  operation: AuthorizedMasterOperation<T>,
): Promise<T> {
  // Reject malformed permissions/resources before database access.
  if (!isMasterPermission(permission)) {
    throw new AuthorizationError("INVALID_PERMISSION");
  }

  assertValidResourceReference(resource);
  assertPermissionMatchesResource(permission, resource.kind);

  // 1. Resolve the canonical active actor profile.
  const actor = await resolveActorContext(
    tx,
    authenticatedActorUserId,
  );

  let resourceScope: MasterResourceScope;

  if (
    resource.kind === "institution" &&
    permission === "master.institution.manage"
  ) {
    // 2a. Read the current scope WITHOUT locking the institution row.
    // This lets the authorization policy reject non-admin actors before
    // the exclusive row lock is acquired.
    const initialScope = await resolveResourceScope(
      tx,
      resource,
      "none",
    );

    authorizeMasterAccess(
      actor,
      permission,
      initialScope,
    );

    // 2b. The initial authorization succeeded. Acquire the exclusive lock
    // directly; do not acquire FOR SHARE and then attempt a lock upgrade.
    //
    // Under READ COMMITTED, this query obtains the row version available
    // after any competing writer commits. We reauthorize that current scope
    // below before allowing the protected operation to run.
    resourceScope = await resolveResourceScope(
      tx,
      resource,
      "update",
    );

    // 2c. Recheck scope-dependent authorization against the locked row.
    authorizeMasterAccess(
      actor,
      permission,
      resourceScope,
    );
  } else {
    // Existing read/program/intake paths keep their shared-lock behavior.
    resourceScope = await resolveResourceScope(
      tx,
      resource,
      "share",
    );

    // 3. Apply the pure authorization policy.
    authorizeMasterAccess(
      actor,
      permission,
      resourceScope,
    );
  }

  // 4. Execute protected work using the SAME transaction.
  // Pass only the validated resource kind and identifier.
  return operation(
    tx,
    Object.freeze({
      kind: resource.kind,
      id: resource.id,
    }),
  );
}