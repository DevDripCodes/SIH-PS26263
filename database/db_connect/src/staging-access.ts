import { resolveActorContext } from "./actor-context";
import { authorizeMasterAccess, type MasterResourceScope } from "./authorization";
import type { DbTx } from "./pool";

export interface AuthorizedBatch { batchId: string; institutionId: string; academicYear: string; scope: MasterResourceScope }
export interface SystemBatch extends AuthorizedBatch { status: string }

/** Resolve the batch and institution ownership from PostgreSQL inside the caller's transaction. */
export async function resolveAuthorizedBatch(tx: DbTx, actorUserId: string, batchId: string, lock = false): Promise<AuthorizedBatch> {
  const actor = await resolveActorContext(tx, actorUserId);
  const lockClause = lock ? "FOR UPDATE OF b FOR SHARE OF i" : "FOR SHARE OF b, i";
  const result = await tx.query<{ batchId: string; institutionId: string; academicYear: string; affiliatingBodyId: string | null; aicteRegion: string | null }>(`SELECT b.batch_id::text AS "batchId", i.institution_id::text AS "institutionId", b.academic_year AS "academicYear", i.affiliating_body_id::text AS "affiliatingBodyId", i.aicte_region AS "aicteRegion" FROM staging.submission_batches b JOIN master.institutions i ON i.institution_id = b.institution_id WHERE b.batch_id = $1::uuid ${lockClause}`, [batchId]);
  const row = result.rows[0];
  if (!row) throw new Error("Submission batch is unavailable.");
  const scope: MasterResourceScope = { institutionId: row.institutionId, affiliatingBodyId: row.affiliatingBodyId, aicteRegion: row.aicteRegion };
  authorizeMasterAccess(actor, "master.institution.read", scope);
  return { batchId: row.batchId, institutionId: row.institutionId, academicYear: row.academicYear, scope };
}

/** Restricted worker path: callers must already be inside the internal system transaction wrapper. */
export async function resolveSystemBatch(tx: DbTx, batchId: string, lock = false): Promise<SystemBatch> {
  const lockClause = lock ? "FOR UPDATE OF b FOR SHARE OF i" : "FOR SHARE OF b, i";
  const result = await tx.query<{ batchId: string; institutionId: string; academicYear: string; status: string; affiliatingBodyId: string | null; aicteRegion: string | null }>(`SELECT b.batch_id::text AS "batchId", i.institution_id::text AS "institutionId", b.academic_year AS "academicYear", b.status::text AS status, i.affiliating_body_id::text AS "affiliatingBodyId", i.aicte_region AS "aicteRegion" FROM staging.submission_batches b JOIN master.institutions i ON i.institution_id = b.institution_id WHERE b.batch_id = $1::uuid ${lockClause}`, [batchId]);
  const row = result.rows[0];
  if (!row) throw new Error("Submission batch is unavailable.");
  return { batchId: row.batchId, institutionId: row.institutionId, academicYear: row.academicYear, status: row.status, scope: { institutionId: row.institutionId, affiliatingBodyId: row.affiliatingBodyId, aicteRegion: row.aicteRegion } };
}
