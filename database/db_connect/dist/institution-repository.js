"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateApprovalStatus = exports.getById = exports.PostCommitCacheInvalidationError = void 0;
exports.createInstitutionRepository = createInstitutionRepository;
const pool_1 = require("./pool");
const master_access_1 = require("./master-access");
const versioned_cache_1 = require("./versioned-cache");
const cache_invalidation_policy_1 = require("./cache-invalidation-policy");
var cache_invalidation_policy_2 = require("./cache-invalidation-policy");
Object.defineProperty(exports, "PostCommitCacheInvalidationError", { enumerable: true, get: function () { return cache_invalidation_policy_2.PostCommitCacheInvalidationError; } });
const authorization_1 = require("./authorization");
// -----------------------------------------------------------------------------
// Constants and SQL
// -----------------------------------------------------------------------------
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const INSTITUTION_READ_PERMISSION = "master.institution.read";
const INSTITUTION_MANAGE_PERMISSION = "master.institution.manage";
const INSTITUTION_CACHE_TTL_SECONDS = 300;
const INSTITUTION_APPROVAL_STATUSES = new Set([
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
function validateActorContext(context) {
    if (context === null ||
        typeof context !== "object" ||
        typeof context.actorUserId !== "string" ||
        !UUID_REGEX.test(context.actorUserId)) {
        throw new TypeError("A valid authenticated actor context is required.");
    }
    if (typeof context.requestId !== "string" ||
        context.requestId.trim().length === 0 ||
        context.requestId.length > 100) {
        throw new TypeError("Request ID must be a non-empty string of at most 100 characters.");
    }
}
function validateInstitutionId(institutionId) {
    if (typeof institutionId !== "string" ||
        !UUID_REGEX.test(institutionId)) {
        throw new TypeError("Institution ID must be a valid UUID.");
    }
}
function validateInput(input) {
    if (input === null || typeof input !== "object") {
        throw new TypeError("Invalid institution lookup input.");
    }
    validateInstitutionId(input.institutionId);
    validateActorContext(input.actorContext);
}
function assertValidApprovalStatus(value) {
    if (typeof value !== "string" ||
        !INSTITUTION_APPROVAL_STATUSES.has(value)) {
        throw new TypeError("Invalid institution approval status.");
    }
}
function validateUpdateApprovalStatusInput(input) {
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
function mapInstitutionSummary(row) {
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
// Repository
// -----------------------------------------------------------------------------
function createInstitutionRepository(dependencies) {
    async function getById(input) {
        // Validate before opening a transaction or accessing Redis.
        validateInput(input);
        // Use a canonical UUID representation for SQL and cache keys.
        const institutionId = input.institutionId.toLowerCase();
        const actorContext = {
            actorUserId: input.actorContext.actorUserId.toLowerCase(),
            requestId: input.actorContext.requestId,
        };
        const namespace = {
            schema: "master",
            resource: "institution",
            identifier: institutionId,
        };
        return dependencies.withActorTx(actorContext, async (tx) => {
            // Authorization must succeed before any cache access.
            return dependencies.withMasterResourceAuthorization(tx, actorContext.actorUserId, INSTITUTION_READ_PERMISSION, {
                kind: "institution",
                id: institutionId,
            }, async (authorizedTx, authorizedResource) => {
                if (authorizedResource.kind !== "institution") {
                    throw new authorization_1.AuthorizationError("INVALID_RESOURCE_SCOPE");
                }
                // The cache is accessed only after authorization.
                return dependencies.getOrSetVersioned(namespace, INSTITUTION_CACHE_TTL_SECONDS, async () => {
                    // The read uses the same transaction that authorized the actor.
                    const result = await authorizedTx.query(INSTITUTION_SUMMARY_SQL, [authorizedResource.id]);
                    const row = result.rows[0];
                    if (!row) {
                        throw new authorization_1.AuthorizationError("FORBIDDEN");
                    }
                    // Explicit mapping prevents extra database columns from leaking.
                    return mapInstitutionSummary(row);
                });
            });
        });
    }
    async function updateApprovalStatus(input) {
        // 1. Reject malformed UUIDs/status/context before transaction startup.
        validateUpdateApprovalStatusInput(input);
        const institutionId = input.institutionId.toLowerCase();
        const actorContext = {
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
        const updatedInstitution = await dependencies.withActorTx(actorContext, async (tx) => dependencies.withMasterResourceAuthorization(tx, actorContext.actorUserId, INSTITUTION_MANAGE_PERMISSION, {
            kind: "institution",
            id: institutionId,
        }, async (authorizedTx, authorizedResource) => {
            if (authorizedResource.kind !== "institution") {
                throw new authorization_1.AuthorizationError("INVALID_RESOURCE_SCOPE");
            }
            const result = await authorizedTx.query(UPDATE_INSTITUTION_APPROVAL_STATUS_SQL, [
                authorizedResource.id,
                input.approvalStatus,
            ]);
            const row = result.rows[0];
            if (!row) {
                throw new authorization_1.AuthorizationError("FORBIDDEN");
            }
            return mapInstitutionSummary(row);
        }));
        // 8. Cache invalidation is outside the PostgreSQL transaction.
        // If it fails, PostgreSQL has already committed.
        try {
            await dependencies.invalidateCacheNamespaces(...(0, cache_invalidation_policy_1.cacheNamespacesForMutation)("institution", institutionId));
        }
        catch (cause) {
            throw new cache_invalidation_policy_1.PostCommitCacheInvalidationError("Institution approval status was committed, but cache invalidation failed; do not retry the mutation.", cause);
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
    withActorTx: pool_1.withActorTx,
    withMasterResourceAuthorization: master_access_1.withMasterResourceAuthorization,
    getOrSetVersioned: versioned_cache_1.getOrSetVersioned,
    invalidateCacheNamespaces: versioned_cache_1.invalidateCacheNamespaces,
});
// Export domain operations, not the repository's infrastructure dependencies.
exports.getById = productionRepository.getById;
exports.updateApprovalStatus = productionRepository.updateApprovalStatus;
