import type { DbTx } from "./pool";
import { withActorTx } from "./pool";

import {
  withMasterResourceAuthorization,
  type MasterResourceReference,
} from "./master-access";

import {
  getOrSetVersioned,
  invalidateCacheNamespaces,
} from "./versioned-cache";

import type { CacheVersionNamespace } from "./cache-version";
import {
  cacheNamespacesForMutation,
  PostCommitCacheInvalidationError,
} from "./cache-invalidation-policy";
export { PostCommitCacheInvalidationError } from "./cache-invalidation-policy";

import {
  AuthorizationError,
  type MasterPermission,
} from "./authorization";

// -----------------------------------------------------------------------------
// Public domain types
// -----------------------------------------------------------------------------

export type InstitutionApprovalStatus =
  | "EOA_GRANTED"
  | "NO_ADMISSION"
  | "WITHDRAWN"
  | "SUSPENDED";

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

// -----------------------------------------------------------------------------
// Internal database row
// -----------------------------------------------------------------------------

interface InstitutionDatabaseRow {
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

// -----------------------------------------------------------------------------
// Constants and SQL
// -----------------------------------------------------------------------------

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const INSTITUTION_READ_PERMISSION: MasterPermission =
  "master.institution.read";

const INSTITUTION_MANAGE_PERMISSION: MasterPermission =
  "master.institution.manage";

const INSTITUTION_CACHE_TTL_SECONDS = 300;

const INSTITUTION_APPROVAL_STATUSES: ReadonlySet<string> = new Set([
  "EOA_GRANTED",
  "NO_ADMISSION",
  "WITHDRAWN",
  "SUSPENDED",
]);

const INSTITUTION_SUMMARY_SQL = `
  SELECT
    i.institution_id::text AS "institutionId",
    i.institution_name AS "institutionName",
    i.institution_category::text AS "institutionCategory",
    i.aicte_region AS "aicteRegion",
    i.state_code AS "stateCode",
    i.district_name AS "districtName",
    i.approval_status AS "approvalStatus",
    i.is_minority_institution AS "isMinorityInstitution",
    i.is_women_only AS "isWomenOnly"
  FROM master.institutions AS i
  WHERE i.institution_id = $1::uuid
`;

const UPDATE_INSTITUTION_APPROVAL_STATUS_SQL = `
  UPDATE master.institutions AS i
     SET approval_status = $2
   WHERE i.institution_id = $1::uuid
  RETURNING
    i.institution_id::text AS "institutionId",
    i.institution_name AS "institutionName",
    i.institution_category::text AS "institutionCategory",
    i.aicte_region AS "aicteRegion",
    i.state_code AS "stateCode",
    i.district_name AS "districtName",
    i.approval_status AS "approvalStatus",
    i.is_minority_institution AS "isMinorityInstitution",
    i.is_women_only AS "isWomenOnly"
`;

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

function validateActorContext(
  context: InstitutionActorContext,
): void {
  if (
    context === null ||
    typeof context !== "object" ||
    typeof context.actorUserId !== "string" ||
    !UUID_REGEX.test(context.actorUserId)
  ) {
    throw new TypeError(
      "A valid authenticated actor context is required.",
    );
  }

  if (
    typeof context.requestId !== "string" ||
    context.requestId.trim().length === 0 ||
    context.requestId.length > 100
  ) {
    throw new TypeError(
      "Request ID must be a non-empty string of at most 100 characters.",
    );
  }
}

function validateInstitutionId(institutionId: unknown): asserts institutionId is string {
  if (
    typeof institutionId !== "string" ||
    !UUID_REGEX.test(institutionId)
  ) {
    throw new TypeError("Institution ID must be a valid UUID.");
  }
}

function validateInput(input: GetInstitutionByIdInput): void {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Invalid institution lookup input.");
  }

  validateInstitutionId(input.institutionId);
  validateActorContext(input.actorContext);
}

function assertValidApprovalStatus(
  value: unknown,
): asserts value is InstitutionApprovalStatus {
  if (
    typeof value !== "string" ||
    !INSTITUTION_APPROVAL_STATUSES.has(value)
  ) {
    throw new TypeError("Invalid institution approval status.");
  }
}

function validateUpdateApprovalStatusInput(
  input: UpdateInstitutionApprovalStatusInput,
): void {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Invalid institution approval update input.");
  }

  // Validate all caller-provided values before starting a transaction.
  validateInstitutionId(input.institutionId);
  assertValidApprovalStatus(input.approvalStatus);
  validateActorContext(input.actorContext);
}

// -----------------------------------------------------------------------------
// Mapping
// -----------------------------------------------------------------------------

function mapInstitutionSummary(
  row: InstitutionDatabaseRow,
): InstitutionSummary {
  return {
    institutionId: row.institutionId,
    institutionName: row.institutionName,
    institutionCategory: row.institutionCategory,
    aicteRegion: row.aicteRegion,
    stateCode: row.stateCode,
    districtName: row.districtName,
    approvalStatus: row.approvalStatus,
    isMinorityInstitution: row.isMinorityInstitution,
    isWomenOnly: row.isWomenOnly,
  };
}

// -----------------------------------------------------------------------------
// Internal dependency-injection seam
// -----------------------------------------------------------------------------

export interface InstitutionRepositoryDependencies {
  withActorTx<T>(
    actorContext: InstitutionActorContext,
    operation: (tx: DbTx) => Promise<T>,
  ): Promise<T>;

  withMasterResourceAuthorization<T>(
    tx: DbTx,
    actorUserId: string,
    permission: MasterPermission,
    resource: MasterResourceReference,
    operation: (
      tx: DbTx,
      resource: Readonly<MasterResourceReference>,
    ) => Promise<T>,
  ): Promise<T>;

  getOrSetVersioned<T>(
    namespace: CacheVersionNamespace,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
  ): Promise<T>;

  invalidateCacheNamespaces(
    ...namespaces: CacheVersionNamespace[]
  ): Promise<void>;
}

// -----------------------------------------------------------------------------
// Repository
// -----------------------------------------------------------------------------

export function createInstitutionRepository(
  dependencies: InstitutionRepositoryDependencies,
) {
  async function getById(
    input: GetInstitutionByIdInput,
  ): Promise<InstitutionSummary> {
    // Validate before opening a transaction or accessing Redis.
    validateInput(input);

    // Use a canonical UUID representation for SQL and cache keys.
    const institutionId = input.institutionId.toLowerCase();

    const actorContext: InstitutionActorContext = {
      actorUserId: input.actorContext.actorUserId.toLowerCase(),
      requestId: input.actorContext.requestId,
    };

    const namespace: CacheVersionNamespace = {
      schema: "master",
      resource: "institution",
      identifier: institutionId,
    };

    return dependencies.withActorTx(actorContext, async (tx) => {
      // Authorization must succeed before any cache access.
      return dependencies.withMasterResourceAuthorization(
        tx,
        actorContext.actorUserId,
        INSTITUTION_READ_PERMISSION,
        {
          kind: "institution",
          id: institutionId,
        },
        async (authorizedTx, authorizedResource) => {
          if (authorizedResource.kind !== "institution") {
            throw new AuthorizationError("INVALID_RESOURCE_SCOPE");
          }

          // The cache is accessed only after authorization.
          return dependencies.getOrSetVersioned(
            namespace,
            INSTITUTION_CACHE_TTL_SECONDS,
            async () => {
              // The read uses the same transaction that authorized the actor.
              const result =
                await authorizedTx.query<InstitutionDatabaseRow>(
                  INSTITUTION_SUMMARY_SQL,
                  [authorizedResource.id],
                );

              const row = result.rows[0];

              if (!row) {
                throw new AuthorizationError("FORBIDDEN");
              }

              // Explicit mapping prevents extra database columns from leaking.
              return mapInstitutionSummary(row);
            },
          );
        },
      );
    });
  }

  async function updateApprovalStatus(
    input: UpdateInstitutionApprovalStatusInput,
  ): Promise<InstitutionSummary> {
    // 1. Reject malformed UUIDs/status/context before transaction startup.
    validateUpdateApprovalStatusInput(input);

    const institutionId = input.institutionId.toLowerCase();

    const actorContext: InstitutionActorContext = {
      actorUserId: input.actorContext.actorUserId.toLowerCase(),
      requestId: input.actorContext.requestId,
    };

    // 2. Begin actor transaction.
    // 3–5. Resolve canonical actor, authorize, and acquire the resource lock
    // through withMasterResourceAuthorization().
    //
    // REQUIRED: master-access.ts must use FOR UPDATE OF i for
    // master.institution.manage. Do not acquire FOR SHARE first and upgrade.
    //
    // 6. Execute the parameterized update inside the transaction.
    // 7. withActorTx must commit before its promise resolves.
    const updatedInstitution = await dependencies.withActorTx(
      actorContext,
      async (tx) =>
        dependencies.withMasterResourceAuthorization(
          tx,
          actorContext.actorUserId,
          INSTITUTION_MANAGE_PERMISSION,
          {
            kind: "institution",
            id: institutionId,
          },
          async (authorizedTx, authorizedResource) => {
            if (authorizedResource.kind !== "institution") {
              throw new AuthorizationError("INVALID_RESOURCE_SCOPE");
            }

            const result =
              await authorizedTx.query<InstitutionDatabaseRow>(
                UPDATE_INSTITUTION_APPROVAL_STATUS_SQL,
                [
                  authorizedResource.id,
                  input.approvalStatus,
                ],
              );

            const row = result.rows[0];

            if (!row) {
              throw new AuthorizationError("FORBIDDEN");
            }

            return mapInstitutionSummary(row);
          },
        ),
    );

    // 8. Cache invalidation is outside the PostgreSQL transaction.
    // If it fails, PostgreSQL has already committed.
    try {
      await dependencies.invalidateCacheNamespaces(
        ...cacheNamespacesForMutation("institution", institutionId),
      );
    } catch (cause: unknown) {
      throw new PostCommitCacheInvalidationError(
        "Institution approval status was committed, but cache invalidation failed; do not retry the mutation.",
        cause,
      );
    }

    return updatedInstitution;
  }

  return {
    getById,
    updateApprovalStatus,
  };
}

// -----------------------------------------------------------------------------
// Production wiring
// -----------------------------------------------------------------------------

const productionRepository = createInstitutionRepository({
  withActorTx,
  withMasterResourceAuthorization,
  getOrSetVersioned,
  invalidateCacheNamespaces,
});

// Export domain operations, not the repository's infrastructure dependencies.
export const getById = productionRepository.getById;

export const updateApprovalStatus =
  productionRepository.updateApprovalStatus;
