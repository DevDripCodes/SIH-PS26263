"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConsent = createConsent;
exports.listMyConsents = listMyConsents;
exports.withdrawMyConsent = withdrawMyConsent;
const actor_context_1 = require("./actor-context");
const authorization_1 = require("./authorization");
const pool_1 = require("./pool");
const cache_invalidation_policy_1 = require("./cache-invalidation-policy");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURPOSES = new Set(["EMPLOYMENT_VERIFICATION", "HIGHER_EDUCATION_ADMISSION", "SCHOLARSHIP_ELIGIBILITY", "GOVERNMENT_SCHEME_BENEFIT", "DIGILOCKER_ISSUANCE"]);
const CHANNELS = new Set(["DIGILOCKER", "STUDENT_APP", "OTP_ESIGN"]);
const DISCLOSURES = new Set(["CREDENTIAL_VALIDITY", "PROGRAM_DETAILS", "GRADES", "ENROLMENT_STATUS"]);
function actor(input) { if (!input || !UUID.test(input.actorUserId) || typeof input.requestId !== "string" || !input.requestId.trim() || input.requestId.length > 100)
    throw new TypeError("Valid authenticated actor context is required."); }
function map(r) { return { consentId: r.consentId, granteeOrgId: r.granteeOrgId, purpose: r.purpose, scopeCredentialId: r.scopeCredentialId, scopeAllCredentials: r.scopeAllCredentials, disclosureScope: r.disclosureScope, grantedAt: r.grantedAt, expiresAt: r.expiresAt, status: r.status, withdrawnAt: r.withdrawnAt }; }
const COLUMNS = `consent_id::text AS "consentId", grantee_org_id::text AS "granteeOrgId", purpose::text AS purpose, scope_credential_id::text AS "scopeCredentialId", scope_all_credentials AS "scopeAllCredentials", disclosure_scope::text[] AS "disclosureScope", granted_at AS "grantedAt", expires_at AS "expiresAt", status::text AS status, withdrawn_at AS "withdrawnAt"`;
async function ownedStudent(tx, userId) {
    const result = await tx.query("SELECT student_id::text AS \"studentId\" FROM core.student_accounts WHERE user_id = $1::uuid FOR SHARE", [userId]);
    if (!result.rows[0])
        throw new authorization_1.AuthorizationError("FORBIDDEN");
    return result.rows[0].studentId;
}
async function createConsent(input) {
    actor(input);
    if (!UUID.test(input.granteeOrgId) || (input.scopeCredentialId !== undefined && !UUID.test(input.scopeCredentialId)) || !PURPOSES.has(input.purpose) || !CHANNELS.has(input.grantChannel) || !Array.isArray(input.disclosureScope) || input.disclosureScope.length < 1 || input.disclosureScope.length > 4 || input.disclosureScope.some(v => !DISCLOSURES.has(v)) || new Set(input.disclosureScope).size !== input.disclosureScope.length || (input.scopeAllCredentials === (input.scopeCredentialId !== undefined)) || typeof input.consentTextVersion !== "string" || !/^[A-Za-z0-9._-]{1,30}$/.test(input.consentTextVersion) || !Buffer.isBuffer(input.consentArtifactHash) || input.consentArtifactHash.length !== 32 || (input.guardianArtifactHash != null && (!Buffer.isBuffer(input.guardianArtifactHash) || input.guardianArtifactHash.length !== 32)) || typeof input.expiresAt !== "string" || Number.isNaN(Date.parse(input.expiresAt)))
        throw new TypeError("Invalid consent request.");
    const result = await (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const profile = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId);
        if (profile.role !== "STUDENT")
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        const studentId = await ownedStudent(tx, profile.userId.toLowerCase());
        const inserted = await tx.query(`INSERT INTO trust.student_consents (student_id, grantee_org_id, purpose, scope_credential_id, scope_all_credentials, disclosure_scope, consent_text_version, grant_channel, consent_artifact_hash, guardian_consent, guardian_artifact_hash, expires_at) VALUES ($1::uuid, $2::uuid, $3::trust.consent_purpose_enum, $4::uuid, $5, $6::trust.disclosure_category_enum[], $7, $8::trust.consent_channel_enum, $9, $10, $11, $12::timestamptz) RETURNING ${COLUMNS}`, [studentId, input.granteeOrgId.toLowerCase(), input.purpose, input.scopeCredentialId?.toLowerCase() ?? null, input.scopeAllCredentials, [...input.disclosureScope], input.consentTextVersion, input.grantChannel, input.consentArtifactHash, input.guardianConsent ?? false, input.guardianArtifactHash ?? null, input.expiresAt]);
        if (!inserted.rows[0])
            throw new Error("Consent creation returned no row.");
        return map(inserted.rows[0]);
    });
    try {
        await (0, cache_invalidation_policy_1.invalidateForMutation)("consent", result.consentId);
    }
    catch (cause) {
        throw new cache_invalidation_policy_1.PostCommitCacheInvalidationError("Consent was created, but cache invalidation failed; do not retry consent creation.", cause);
    }
    return result;
}
async function listMyConsents(input) {
    actor(input);
    const limit = input.limit ?? 100, offset = input.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || !Number.isInteger(offset) || offset < 0 || offset > 10_000)
        throw new RangeError("Invalid consent page bounds.");
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const profile = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId);
        if (profile.role !== "STUDENT")
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        const studentId = await ownedStudent(tx, profile.userId.toLowerCase());
        const result = await tx.query(`SELECT ${COLUMNS} FROM trust.student_consents WHERE student_id = $1::uuid ORDER BY granted_at DESC, consent_id LIMIT $2 OFFSET $3`, [studentId, limit, offset]);
        return result.rows.map(map);
    });
}
async function withdrawMyConsent(input) {
    actor(input);
    if (!UUID.test(input.consentId) || !CHANNELS.has(input.channel))
        throw new TypeError("Invalid consent withdrawal input.");
    await (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const profile = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId);
        if (profile.role !== "STUDENT")
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        const studentId = await ownedStudent(tx, profile.userId.toLowerCase());
        await tx.query("SELECT trust.withdraw_consent($1::uuid, $2::uuid, $3::trust.consent_channel_enum)", [input.consentId.toLowerCase(), studentId, input.channel]);
    });
    try {
        await (0, cache_invalidation_policy_1.invalidateForMutation)("consent", input.consentId.toLowerCase());
    }
    catch (cause) {
        throw new cache_invalidation_policy_1.PostCommitCacheInvalidationError("Consent withdrawal was committed, but cache invalidation failed; do not retry withdrawal.", cause);
    }
}
