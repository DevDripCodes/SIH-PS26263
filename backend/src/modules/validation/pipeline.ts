// Batch lifecycle (staging.batch_status_enum):
//
//   UPLOADED -> L1_PROCESSING -> L1_COMPLETED -> L2_PROCESSING -> L2_COMPLETED
//        (waits here for the institution's maker-checker approval)
//   -> L3_PROCESSING -> COMPLETED | COMPLETED_WITH_ANOMALIES          (core.promote_batch)
//
// Every stage only touches rows in its input state and runs in one transaction, so a crashed or
// retried job resumes from whatever status the batch is in.

import { pool } from "../../db/pool.js";
import { runL1 } from "./stages/l1.stage.js";
import { runL2 } from "./stages/l2.stage.js";
import { runL3 } from "./stages/l3.stage.js";

async function batchStatus(batchId: string): Promise<string | null> {
  const { rows } = await pool.query<{ status: string }>(
    "SELECT status FROM staging.submission_batches WHERE batch_id = $1",
    [batchId],
  );
  return rows[0]?.status ?? null;
}

/** L1 + L2. Leaves the batch at L2_COMPLETED, ready for approval. */
export async function validateBatch(batchId: string): Promise<void> {
  let status = await batchStatus(batchId);
  if (status === "UPLOADED" || status === "L1_PROCESSING") {
    await runL1(batchId);
    status = await batchStatus(batchId);
  }
  if (status === "L1_COMPLETED" || status === "L2_PROCESSING") {
    await runL2(batchId);
  }
}

/** L3, after approval. */
export async function promoteBatch(batchId: string, actorUserId: string | null): Promise<void> {
  const status = await batchStatus(batchId);
  if (status === "L2_COMPLETED" || status === "L3_PROCESSING") await runL3(batchId, actorUserId);
}

export async function markBatchFailed(batchId: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE staging.submission_batches SET status = 'FAILED', failure_reason = $2
      WHERE batch_id = $1 AND status NOT IN ('COMPLETED', 'COMPLETED_WITH_ANOMALIES', 'CANCELLED')`,
    [batchId, reason.slice(0, 1000)],
  );
}

/**
 * Status a FAILED batch should resume from, derived from where its rows actually are.
 * Returns null when the batch is not FAILED.
 */
export async function resumeStatusForFailedBatch(batchId: string): Promise<string | null> {
  const { rows } = await pool.query<{ status: string; pending: string; l1_passed: string; l2_verified: string }>(
    `SELECT b.status,
            count(*) FILTER (WHERE r.validation_status = 'PENDING') AS pending,
            count(*) FILTER (WHERE r.validation_status = 'L1_PASSED') AS l1_passed,
            count(*) FILTER (WHERE r.validation_status = 'L2_VERIFIED') AS l2_verified
       FROM staging.submission_batches b
       LEFT JOIN staging.staging_enrolment_records r ON r.batch_id = b.batch_id
      WHERE b.batch_id = $1
      GROUP BY b.status`,
    [batchId],
  );
  const row = rows[0];
  if (!row || row.status !== "FAILED") return null;
  if (Number(row.pending) > 0) return "UPLOADED";
  if (Number(row.l1_passed) > 0) return "L1_COMPLETED";
  return "L2_COMPLETED";
}
