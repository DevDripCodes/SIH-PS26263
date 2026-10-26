"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyCredential = verifyCredential;
const actor_context_1 = require("./actor-context");
const authorization_1 = require("./authorization");
const pool_1 = require("./pool");
const cache_invalidation_policy_1 = require("./cache-invalidation-policy");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURPOSES = new Set(["EMPLOYMENT_VERIFICATION", "HIGHER_EDUCATION_ADMISSION", "SCHOLARSHIP_ELIGIBILITY", "GOVERNMENT_SCHEME_BENEFIT", "DIGILOCKER_ISSUANCE"]);
const PUBLIC_RESULTS = new Set(["VERIFIED", "CONSENT_REQUIRED", "RATE_LIMITED", "NOT_AUTHORISED", "NOT_VALID", "NOT_VERIFIED"]);
async function verifyCredential(input) {
    if (!input || !UUID.test(input.actorUserId) || !UUID.test(input.verifierOrgId) || !UUID.test(input.credentialId) || typeof input.requestId !== "string" || !input.requestId.trim() || input.requestId.length > 100 || !PURPOSES.has(input.purpose) || typeof input.presentedApaarId !== "string" || !/^\d{12}$/.test(input.presentedApaarId) || typeof input.presentedRollId !== "string" || input.presentedRollId.trim().length === 0 || input.presentedRollId.length > 50 || (input.clientFingerprint !== undefined && (!Buffer.isBuffer(input.clientFingerprint) || input.clientFingerprint.length !== 32)))
        throw new TypeError("Invalid credential verification input.");
    const value = await (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId);
        if (actor.role !== "EMPLOYER_VERIFIER")
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        const result = await tx.query("SELECT trust.verify_credential($1::uuid, $2::uuid, $3::uuid, $4::trust.consent_purpose_enum, $5, $6, $7) AS result", [input.credentialId.toLowerCase(), input.verifierOrgId.toLowerCase(), actor.userId.toLowerCase(), input.purpose, input.presentedApaarId, input.presentedRollId, input.clientFingerprint ?? null]);
        const value = result.rows[0]?.result;
        if (!value || !PUBLIC_RESULTS.has(value.result) || !UUID.test(value.verification_id))
            throw new Error("Credential verification returned an invalid public result.");
        return value;
    });
    try {
        await (0, cache_invalidation_policy_1.invalidateForMutation)("verification", input.verifierOrgId);
    }
    catch (cause) {
        throw new cache_invalidation_policy_1.PostCommitCacheInvalidationError("Verification was recorded, but analytics cache invalidation failed; do not retry verification.", cause);
    }
    return value;
}
