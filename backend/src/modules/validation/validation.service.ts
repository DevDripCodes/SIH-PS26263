import { pool } from "../../db/pool.js";
import { setActor, withTransaction } from "../../db/transaction.js";
import { enqueueValidationJob } from "../../jobs/queues/validation.queue.js";
import { apaarRegistry } from "../../integrations/apaar-registry/index.js";
import { HttpError } from "../../utils/http-error.js";
import { FIELDS } from "../ingestion/columns.js";
import { resumeStatusForFailedBatch } from "./pipeline.js";

export interface BatchHeader {
  batchId: string;
  institutionId: string;
  status: string;
}

export async function loadBatchHeader(batchId: string): Promise<BatchHeader> {
  const { rows } = await pool.query<{ batch_id: string; institution_id: string; status: string }>(
    "SELECT batch_id, institution_id, status FROM staging.submission_batches WHERE batch_id = $1",
    [batchId],
  );
  const row = rows[0];
  if (!row) throw new HttpError("Batch not found.", 404);
  return { batchId: row.batch_id, institutionId: row.institution_id, status: row.status };
}

/** "123456789012" -> "XXXX XXXX 9012" (APAAR IDs are masked in the UI by default). */
export function maskApaar(raw: string | null): string | null {
  if (!raw) return raw;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 4 ? `XXXX XXXX ${digits.slice(-4)}` : "XXXX";
}

export async function getValidationSummary(batchId: string) {
  const [statusCounts, anomalyCounts] = await Promise.all([
    pool.query<{ validation_status: string; count: string }>(
      `SELECT validation_status::text, count(*) FROM staging.staging_enrolment_records
        WHERE batch_id = $1 GROUP BY 1`,
      [batchId],
    ),
    pool.query<{ anomaly_code: string; severity: string; validation_level: number; field_name: string | null; count: string }>(
      `SELECT anomaly_code::text, severity::text, validation_level, field_name, count(*)
         FROM staging.validation_anomalies WHERE batch_id = $1
        GROUP BY 1, 2, 3, 4 ORDER BY count(*) DESC`,
      [batchId],
    ),
  ]);
  return {
    records: Object.fromEntries(statusCounts.rows.map((r) => [r.validation_status, Number(r.count)])),
    anomalies: anomalyCounts.rows.map((r) => ({
      code: r.anomaly_code,
      severity: r.severity,
      level: r.validation_level,
      field: r.field_name,
      count: Number(r.count),
    })),
    apaarRegistry: apaarRegistry().name,
  };
}

export interface AnomalyFilter {
  level?: number;
  severity?: "ERROR" | "WARNING";
  code?: string;
  page: number;
  pageSize: number;
}

export async function listAnomalies(batchId: string, filter: AnomalyFilter) {
  const where = ["a.batch_id = $1"];
  const params: unknown[] = [batchId];
  if (filter.level) {
    params.push(filter.level);
    where.push(`a.validation_level = $${params.length}`);
  }
  if (filter.severity) {
    params.push(filter.severity);
    where.push(`a.severity = $${params.length}::staging.anomaly_severity_enum`);
  }
  if (filter.code) {
    params.push(filter.code);
    where.push(`a.anomaly_code::text = $${params.length}`);
  }
  params.push(filter.pageSize, (filter.page - 1) * filter.pageSize);

  const { rows } = await pool.query(
    `SELECT a.anomaly_id::text AS anomaly_id, r.source_row_number, r.validation_status::text AS record_status,
            r.raw_apaar_id, r.raw_full_name, r.raw_roll_no, r.raw_program_code,
            a.anomaly_code::text AS code, a.severity::text AS severity, a.validation_level AS level,
            a.field_name, a.offending_value, a.message, a.fix_hint, a.details, a.is_resolved,
            count(*) OVER () AS total
       FROM staging.validation_anomalies a
       JOIN staging.staging_enrolment_records r ON r.record_id = a.record_id
      WHERE ${where.join(" AND ")}
      ORDER BY r.source_row_number, a.validation_level, a.anomaly_id
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return {
    total: Number(rows[0]?.total ?? 0),
    page: filter.page,
    pageSize: filter.pageSize,
    items: rows.map((r) => ({
      anomalyId: r.anomaly_id,
      sourceRowNumber: r.source_row_number,
      recordStatus: r.record_status,
      apaarId: maskApaar(r.raw_apaar_id),
      fullName: r.raw_full_name,
      rollNo: r.raw_roll_no,
      programCode: r.raw_program_code,
      code: r.code,
      severity: r.severity,
      level: r.level,
      field: r.field_name,
      offendingValue: r.field_name === "raw_apaar_id" ? maskApaar(r.offending_value) : r.offending_value,
      message: r.message,
      fixHint: r.fix_hint,
      details: r.details,
      isResolved: r.is_resolved,
    })),
  };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
}

/**
 * Rejected / quarantined rows in the upload template's column order plus the reasons, so the
 * institution can fix them in a spreadsheet and upload the file again.
 */
export async function correctionsCsv(batchId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT r.source_row_number, r.validation_status::text AS status,
            ${FIELDS.map((f) => `r.raw_${f}`).join(", ")},
            string_agg(a.severity || ': ' || a.message || COALESCE(' Fix: ' || a.fix_hint, ''), ' | '
                       ORDER BY a.validation_level, a.anomaly_id) AS problems
       FROM staging.staging_enrolment_records r
       JOIN staging.validation_anomalies a ON a.record_id = r.record_id
      WHERE r.batch_id = $1 AND r.validation_status IN ('REJECTED', 'QUARANTINED')
      GROUP BY r.record_id
      ORDER BY r.source_row_number`,
    [batchId],
  );
  const header = ["_source_row", "_status", "_problems", ...FIELDS];
  const lines = rows.map((r) =>
    [r.source_row_number, r.status, r.problems, ...FIELDS.map((f) => r[`raw_${f}`])].map(csvCell).join(","),
  );
  return `﻿${[header.join(","), ...lines].join("\r\n")}\r\n`;
}

/**
 * Maker-checker: the institution approves the validated batch, which moves it to L3_PROCESSING
 * atomically (so a double click cannot promote twice) and records the approval in the audit ledger.
 */
export async function approveBatch(batchId: string, actorUserId: string): Promise<void> {
  await withTransaction(async (client) => {
    await setActor(client, actorUserId, `approve:${batchId}`);
    const { rows } = await client.query<{ institution_id: string; total_rows: number }>(
      `UPDATE staging.submission_batches SET status = 'L3_PROCESSING'
        WHERE batch_id = $1 AND status = 'L2_COMPLETED'
        RETURNING institution_id, total_rows`,
      [batchId],
    );
    const batch = rows[0];
    if (!batch) throw new HttpError("Only a validated batch waiting for approval can be approved.", 409);

    const { rows: counts } = await client.query<{ verified: string }>(
      `SELECT count(*) FILTER (WHERE validation_status = 'L2_VERIFIED') AS verified
         FROM staging.staging_enrolment_records WHERE batch_id = $1`,
      [batchId],
    );
    await client.query("SELECT trust.log_audit_event('app_ingestion', 'BATCH.APPROVED', 'SUBMISSION_BATCH', $1, $2, $3)", [
      batchId,
      batch.institution_id,
      JSON.stringify({ total_rows: batch.total_rows, rows_to_promote: Number(counts[0]?.verified ?? 0) }),
    ]);
  });
  await enqueueValidationJob({ kind: "promote", batchId, actorUserId });
}

const CANCELLABLE = ["UPLOADED", "L1_COMPLETED", "L2_COMPLETED", "FAILED"];

export async function cancelBatch(batchId: string): Promise<void> {
  const { rowCount } = await pool.query(
    "UPDATE staging.submission_batches SET status = 'CANCELLED' WHERE batch_id = $1 AND status = ANY($2::staging.batch_status_enum[])",
    [batchId, CANCELLABLE],
  );
  if (!rowCount) throw new HttpError("This batch can no longer be cancelled.", 409);
}

/** Put a FAILED batch back where its rows are and queue it again. */
export async function retryBatch(batchId: string): Promise<string> {
  const resumeAt = await resumeStatusForFailedBatch(batchId);
  if (!resumeAt) throw new HttpError("Only failed batches can be retried.", 409);
  await pool.query(
    "UPDATE staging.submission_batches SET status = $2::staging.batch_status_enum, failure_reason = NULL WHERE batch_id = $1",
    [batchId, resumeAt],
  );
  // A batch that failed during promotion goes back to awaiting approval rather than being promoted unasked.
  if (resumeAt !== "L2_COMPLETED") await enqueueValidationJob({ kind: "validate", batchId });
  return resumeAt;
}
