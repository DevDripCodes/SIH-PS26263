import { resolveActorContext } from "./actor-context";
import { AuthorizationError } from "./authorization";
import { withActorTx } from "./pool";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface AffiliatingBodyActor { actorUserId: string; requestId: string }
export interface AffiliatingBodySummary { affiliatingBodyId: string; aisheCode: string; bodyName: string; bodyType: string; stateCode: string; isActive: boolean }
interface BodyRow extends Record<string, unknown> { affiliatingBodyId: string; aisheCode: string; bodyName: string; bodyType: string; stateCode: string; isActive: boolean }

function validContext(actor: AffiliatingBodyActor): void {
  if (!actor || !UUID.test(actor.actorUserId) || typeof actor.requestId !== "string" || !actor.requestId.trim() || actor.requestId.length > 100) throw new TypeError("Valid authenticated actor context is required.");
}
function map(row: BodyRow): AffiliatingBodySummary {
  return { affiliatingBodyId: row.affiliatingBodyId, aisheCode: row.aisheCode, bodyName: row.bodyName, bodyType: row.bodyType, stateCode: row.stateCode, isActive: row.isActive };
}

export async function getAffiliatingBodyById(input: AffiliatingBodyActor & { affiliatingBodyId: string }): Promise<AffiliatingBodySummary> {
  validContext(input);
  if (!UUID.test(input.affiliatingBodyId)) throw new TypeError("Affiliating body ID must be a UUID.");
  return withActorTx({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async tx => {
    const actor = await resolveActorContext(tx, input.actorUserId);
    const id = input.affiliatingBodyId.toLowerCase();
    if (actor.role !== "AICTE_SUPER_ADMIN" && !(actor.role === "AFFILIATING_BODY_REGISTRAR" && actor.affiliatingBodyId?.toLowerCase() === id)) throw new AuthorizationError("FORBIDDEN");
    const result = await tx.query<BodyRow>(`SELECT affiliating_body_id::text AS "affiliatingBodyId", aishe_code AS "aisheCode", body_name AS "bodyName", body_type AS "bodyType", state_code AS "stateCode", is_active AS "isActive" FROM master.affiliating_bodies WHERE affiliating_body_id = $1::uuid`, [id]);
    if (!result.rows[0]) throw new AuthorizationError("FORBIDDEN");
    return map(result.rows[0]);
  });
}

/** Lists all only for super-admins, and only the actor's body for registrars. */
export async function listAffiliatingBodies(input: AffiliatingBodyActor): Promise<AffiliatingBodySummary[]> {
  validContext(input);
  return withActorTx({ actorUserId: input.actorUserId.toLowerCase(), requestId: input.requestId }, async tx => {
    const actor = await resolveActorContext(tx, input.actorUserId);
    let result;
    if (actor.role === "AICTE_SUPER_ADMIN") {
      result = await tx.query<BodyRow>(`SELECT affiliating_body_id::text AS "affiliatingBodyId", aishe_code AS "aisheCode", body_name AS "bodyName", body_type AS "bodyType", state_code AS "stateCode", is_active AS "isActive" FROM master.affiliating_bodies ORDER BY body_name LIMIT 500`);
    } else if (actor.role === "AFFILIATING_BODY_REGISTRAR" && actor.affiliatingBodyId) {
      result = await tx.query<BodyRow>(`SELECT affiliating_body_id::text AS "affiliatingBodyId", aishe_code AS "aisheCode", body_name AS "bodyName", body_type AS "bodyType", state_code AS "stateCode", is_active AS "isActive" FROM master.affiliating_bodies WHERE affiliating_body_id = $1::uuid ORDER BY body_name LIMIT 500`, [actor.affiliatingBodyId.toLowerCase()]);
    } else throw new AuthorizationError("FORBIDDEN");
    return result.rows.map(map);
  });
}
