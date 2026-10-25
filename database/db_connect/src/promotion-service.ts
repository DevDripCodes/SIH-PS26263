import { withActorTx, withSystemTx } from "./pool";
import { resolveActorContext } from "./actor-context";
import { AuthorizationError } from "./authorization";
import { invalidateForMutation, PostCommitCacheInvalidationError } from "./cache-invalidation-policy";
import { resolveSystemBatch } from "./staging-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface BatchRow { institution_id: string; submitted_by: string | null }
export interface ProgramPromotionResult extends Record<string, unknown> {
  batch_id: string;
  program_id: string;
  promoted: number;
  quarantined: number;
  already_enrolled?: number;
  by_code: Record<string, number>;
  by_quota?: Record<string, number>;
}
export interface BatchPromotionResult extends Record<string, unknown> {
  batch_id: string;
  status: string;
  programs: ProgramPromotionResult[];
  already_finalised?: boolean;
}

function promote(actorUserId: string, requestId: string, batchId: string, fn: "core.promote_batch"): Promise<BatchPromotionResult>;
function promote(actorUserId: string, requestId: string, batchId: string, fn: "core.promote_program_batch", programId: string): Promise<ProgramPromotionResult>;
async function promote(actorUserId: string, requestId: string, batchId: string, fn: "core.promote_batch" | "core.promote_program_batch", programId?: string): Promise<BatchPromotionResult | ProgramPromotionResult> {
  if (!UUID.test(actorUserId) || !UUID.test(batchId) || (programId !== undefined && !UUID.test(programId)) || typeof requestId !== "string" || !requestId.trim() || requestId.length > 100) throw new TypeError("Invalid promotion input.");
  const result = await withActorTx({ actorUserId: actorUserId.toLowerCase(), requestId }, async tx => {
    const actor = await resolveActorContext(tx, actorUserId);
    const batch = await tx.query<BatchRow>("SELECT institution_id::text, submitted_by::text FROM staging.submission_batches WHERE batch_id = $1::uuid FOR UPDATE", [batchId.toLowerCase()]);
    const row = batch.rows[0];
    if (!row) throw new AuthorizationError("FORBIDDEN");
    const allowed = actor.role === "AICTE_SUPER_ADMIN" || (actor.role === "INSTITUTION_NODAL_OFFICER" && actor.institutionId?.toLowerCase() === row.institution_id.toLowerCase());
    if (!allowed) throw new AuthorizationError("FORBIDDEN");
    const params = programId === undefined ? [batchId.toLowerCase()] : [batchId.toLowerCase(), programId.toLowerCase()];
    const result = await tx.query<{ result: BatchPromotionResult | ProgramPromotionResult }>(`SELECT ${fn}(${params.map((_, i) => `$${i + 1}`).join(", ")}) AS result`, params);
    if (!result.rows[0]) throw new Error("Batch promotion returned no result.");
    return result.rows[0].result;
  });
  try { await invalidateForMutation("promotion", batchId.toLowerCase()); }
  catch (cause) { throw new PostCommitCacheInvalidationError("Promotion committed, but cache invalidation failed; do not retry the promotion.", cause); }
  return result;
}

export function promoteBatch(actorUserId: string, requestId: string, batchId: string): Promise<BatchPromotionResult> {
  return promote(actorUserId, requestId, batchId, "core.promote_batch");
}

export function promoteProgramBatch(actorUserId: string, requestId: string, batchId: string, programId: string): Promise<ProgramPromotionResult> {
  return promote(actorUserId, requestId, batchId, "core.promote_program_batch", programId);
}

export async function finalizeBatch(actorUserId: string, requestId: string, batchId: string): Promise<string> {
  if (!UUID.test(actorUserId) || !UUID.test(batchId) || typeof requestId !== "string" || !requestId.trim() || requestId.length > 100) throw new TypeError("Invalid finalization input.");
  const status = await withActorTx({ actorUserId: actorUserId.toLowerCase(), requestId }, async tx => {
    const actor = await resolveActorContext(tx, actorUserId);
    const batch = await tx.query<BatchRow>("SELECT institution_id::text, submitted_by::text FROM staging.submission_batches WHERE batch_id = $1::uuid FOR UPDATE", [batchId.toLowerCase()]);
    const row = batch.rows[0];
    if (!row || !(actor.role === "AICTE_SUPER_ADMIN" || (actor.role === "INSTITUTION_NODAL_OFFICER" && actor.institutionId?.toLowerCase() === row.institution_id.toLowerCase()))) throw new AuthorizationError("FORBIDDEN");
    const result = await tx.query<{ status: string }>("SELECT core.finalize_batch($1::uuid)::text AS status", [batchId.toLowerCase()]);
    if (!result.rows[0]) throw new Error("Batch finalization returned no status.");
    return result.rows[0].status;
  });
  try { await invalidateForMutation("batch", batchId.toLowerCase()); }
  catch (cause) { throw new PostCommitCacheInvalidationError("Batch finalization committed, but cache invalidation failed; do not retry finalization.", cause); }
  return status;
}

function systemPromote(batchId: string): Promise<BatchPromotionResult>;
function systemPromote(batchId: string, programId: string): Promise<ProgramPromotionResult>;
async function systemPromote(batchId: string, programId?: string): Promise<BatchPromotionResult | ProgramPromotionResult> {
  if (!UUID.test(batchId) || (programId !== undefined && !UUID.test(programId))) throw new TypeError("Invalid system promotion input.");
  const result = await withSystemTx(async tx => {
    const batch = await resolveSystemBatch(tx, batchId.toLowerCase(), true);
    if (!(batch.status === "L2_COMPLETED" || batch.status === "L3_PROCESSING")) throw new Error("Batch is not ready for promotion.");
    const params = programId === undefined ? [batch.batchId] : [batch.batchId, programId.toLowerCase()];
    const fn = programId === undefined ? "core.promote_batch" : "core.promote_program_batch";
    const call = await tx.query<{ result: BatchPromotionResult | ProgramPromotionResult }>(`SELECT ${fn}(${params.map((_, i) => `$${i + 1}`).join(", ")}) AS result`, params);
    if (!call.rows[0]) throw new Error("System promotion returned no result.");
    return { batchId: batch.batchId, result: call.rows[0].result };
  });
  try { await invalidateForMutation("promotion", result.batchId); }
  catch (cause) { throw new PostCommitCacheInvalidationError("System promotion committed, but cache invalidation failed; do not retry the promotion.", cause); }
  return result.result;
}

export function promoteBatchAsSystem(batchId: string): Promise<BatchPromotionResult> {
  return systemPromote(batchId);
}

export function promoteProgramBatchAsSystem(batchId: string, programId: string): Promise<ProgramPromotionResult> {
  return systemPromote(batchId, programId);
}

export async function finalizeBatchAsSystem(batchId: string): Promise<string> {
  if (!UUID.test(batchId)) throw new TypeError("Batch ID must be a UUID.");
  const status = await withSystemTx(async tx => {
    const batch = await resolveSystemBatch(tx, batchId.toLowerCase(), true);
    if (!(batch.status === "L2_COMPLETED" || batch.status === "L3_PROCESSING")) throw new Error("Batch is not ready for finalization.");
    const result = await tx.query<{ status: string }>("SELECT core.finalize_batch($1::uuid)::text AS status", [batch.batchId]);
    if (!result.rows[0]) throw new Error("System finalization returned no result.");
    return { batchId: batch.batchId, status: result.rows[0].status };
  });
  try { await invalidateForMutation("promotion", status.batchId); }
  catch (cause) { throw new PostCommitCacheInvalidationError("System finalization committed, but cache invalidation failed; do not retry finalization.", cause); }
  return status.status;
}
