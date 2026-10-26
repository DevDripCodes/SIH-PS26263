"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAffiliatingBodyById = getAffiliatingBodyById;
exports.listAffiliatingBodies = listAffiliatingBodies;
const actor_context_1 = require("./actor-context");
const authorization_1 = require("./authorization");
const pool_1 = require("./pool");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validContext(actor) {
    if (!actor || !UUID.test(actor.actorUserId) || typeof actor.requestId !== "string" || !actor.requestId.trim() || actor.requestId.length > 100)
        throw new TypeError("Valid authenticated actor context is required.");
}
function map(row) {
    return { affiliatingBodyId: row.affiliatingBodyId, aisheCode: row.aisheCode, bodyName: row.bodyName, bodyType: row.bodyType, stateCode: row.stateCode, isActive: row.isActive };
}
async function getAffiliatingBodyById(input) {
    validContext(input);
    if (!UUID.test(input.affiliatingBodyId))
        throw new TypeError("Affiliating body ID must be a UUID.");
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId);
        const id = input.affiliatingBodyId.toLowerCase();
        if (actor.role !== "AICTE_SUPER_ADMIN" && !(actor.role === "AFFILIATING_BODY_REGISTRAR" && actor.affiliatingBodyId?.toLowerCase() === id))
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        const result = await tx.query(`SELECT affiliating_body_id::text AS "affiliatingBodyId", aishe_code AS "aisheCode", body_name AS "bodyName", body_type AS "bodyType", state_code AS "stateCode", is_active AS "isActive" FROM master.affiliating_bodies WHERE affiliating_body_id = $1::uuid`, [id]);
        if (!result.rows[0])
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        return map(result.rows[0]);
    });
}
/** Lists all only for super-admins, and only the actor's body for registrars. */
async function listAffiliatingBodies(input) {
    validContext(input);
    return (0, pool_1.withActorTx)({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async (tx) => {
        const actor = await (0, actor_context_1.resolveActorContext)(tx, input.actorUserId);
        let result;
        if (actor.role === "AICTE_SUPER_ADMIN") {
            result = await tx.query(`SELECT affiliating_body_id::text AS "affiliatingBodyId", aishe_code AS "aisheCode", body_name AS "bodyName", body_type AS "bodyType", state_code AS "stateCode", is_active AS "isActive" FROM master.affiliating_bodies ORDER BY body_name LIMIT 500`);
        }
        else if (actor.role === "AFFILIATING_BODY_REGISTRAR" && actor.affiliatingBodyId) {
            result = await tx.query(`SELECT affiliating_body_id::text AS "affiliatingBodyId", aishe_code AS "aisheCode", body_name AS "bodyName", body_type AS "bodyType", state_code AS "stateCode", is_active AS "isActive" FROM master.affiliating_bodies WHERE affiliating_body_id = $1::uuid ORDER BY body_name LIMIT 500`, [actor.affiliatingBodyId.toLowerCase()]);
        }
        else
            throw new authorization_1.AuthorizationError("FORBIDDEN");
        return result.rows.map(map);
    });
}
