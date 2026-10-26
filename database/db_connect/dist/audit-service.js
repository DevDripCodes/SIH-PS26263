"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logApplicationAuditEvent = logApplicationAuditEvent;
exports.verifyAuditChain = verifyAuditChain;
const actor_context_1 = require("./actor-context");
const authorization_1 = require("./authorization");
const pool_1 = require("./pool");
const CHAINS = new Set(["credentials", "consents", "verifier_orgs", "verification", "app_core", "app_master", "app_trust"]);
const APPLICATION_EVENTS = {
    BATCH_CREATED: { chain: "app_core", event: "BATCH.CREATED", subject: "BATCH" },
    BATCH_PROMOTED: { chain: "app_core", event: "BATCH.PROMOTED", subject: "BATCH" },
    CREDENTIAL_ISSUED: { chain: "app_trust", event: "CREDENTIAL.ISSUED_BY_APP", subject: "CREDENTIAL" },
    CONSENT_WITHDRAWN: { chain: "app_trust", event: "CONSENT.WITHDRAWN_BY_APP", subject: "CONSENT" },
    VERIFIER_ORG_REVIEWED: { chain: "app_trust", event: "VERIFIER_ORG.REVIEWED_BY_APP", subject: "VERIFIER_ORG" },
};
async function logApplicationAuditEvent(input) {
    const event = APPLICATION_EVENTS[input.event];
    if (!event || !/^[0-9a-f-]{36}$/i.test(input.actorUserId) || !/^[0-9a-f-]{36}$/i.test(input.subjectId) || (input.institutionId !== undefined && !/^[0-9a-f-]{36}$/i.test(input.institutionId)) || typeof input.requestId !== "string" || !input.requestId.trim() || input.requestId.length > 100 || !["SUCCESS", "DENIED", "FAILED"].includes(input.outcome))
        throw new TypeError("Invalid application audit event.");
    if (["BATCH_CREATED", "BATCH_PROMOTED", "CREDENTIAL_ISSUED"].includes(input.event) && !input.institutionId)
        throw new TypeError("This audit event requires an institution scope.");
    await (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId);
        if ((input.event === "BATCH_CREATED" || input.event === "BATCH_PROMOTED") && !(actor.role === "AICTE_SUPER_ADMIN" || actor.role === "INSTITUTION_NODAL_OFFICER"))
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        if (input.event === "CREDENTIAL_ISSUED" && !(actor.role === "INSTITUTION_NODAL_OFFICER" || actor.role === "AFFILIATING_BODY_REGISTRAR"))
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        if (input.event === "CONSENT_WITHDRAWN") {
            if (input.institutionId || actor.role !== "STUDENT")
                throw new authorization_1.AuthorizationError("FORBIDDEN");
            const owned = await tx.query("SELECT EXISTS (SELECT 1 FROM trust.student_consents c JOIN core.student_accounts sa ON sa.student_id = c.student_id WHERE c.consent_id = $1::uuid AND sa.user_id = $2::uuid) AS allowed", [input.subjectId.toLowerCase(), actor.userId.toLowerCase()]);
            if (owned.rows[0]?.allowed !== true)
                throw new authorization_1.AuthorizationError("FORBIDDEN");
        }
        if (input.event === "VERIFIER_ORG_REVIEWED" && (input.institutionId || actor.role !== "AICTE_SUPER_ADMIN"))
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        if (input.institutionId) {
            const resource = await tx.query("SELECT institution_id::text AS \"institutionId\", affiliating_body_id::text AS \"affiliatingBodyId\", aicte_region AS \"aicteRegion\" FROM master.institutions WHERE institution_id = $1::uuid FOR SHARE", [input.institutionId.toLowerCase()]);
            if (!resource.rows[0])
                throw new authorization_1.AuthorizationError("FORBIDDEN");
            (0, authorization_1.authorizeMasterAccess)(actor, "master.institution.read", resource.rows[0]);
        }
        await tx.query("SELECT trust.log_audit_event($1, $2, $3, $4::uuid, $5::uuid, $6::jsonb)", [event.chain, event.event, event.subject, input.subjectId.toLowerCase(), input.institutionId?.toLowerCase() ?? null, JSON.stringify({ outcome: input.outcome })]);
    });
}
async function verifyAuditChain(input) {
    const from = input.fromSequence ?? 1, to = input.toSequence ?? from + 99_999;
    if (!/^[0-9a-f-]{36}$/i.test(input.actorUserId) || typeof input.requestId !== "string" || !input.requestId.trim() || input.requestId.length > 100 || !CHAINS.has(input.chainKey) || !Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 1 || to < from || to - from > 100_000)
        throw new TypeError("Invalid audit verification request.");
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId);
        if (actor.role !== "AICTE_SUPER_ADMIN")
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        const result = await tx.query("SELECT ok, rows_checked, first_bad_seq, reason FROM trust.verify_audit_chain($1, $2::bigint, $3::bigint)", [input.chainKey, from, to]);
        const row = result.rows[0];
        if (!row)
            throw new Error("Audit verification returned no result.");
        return { ok: row.ok, rowsChecked: row.rows_checked, firstBadSequence: row.first_bad_seq, reason: row.reason };
    });
}
