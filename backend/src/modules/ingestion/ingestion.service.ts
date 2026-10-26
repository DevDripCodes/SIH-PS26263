import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool.js";
import { enqueueValidationJob } from "../../jobs/queues/validation.queue.js";
import { markBatchFailed } from "../validation/pipeline.js";
import { HttpError } from "../../utils/http-error.js";
import { FIELDS, applyMapping, buildMapping, type CanonicalRow, type ColumnMapping } from "./columns.js";
import type { ParsedSheet } from "./parsers.js";

export type SourceChannel = "CSV_UPLOAD" | "EXCEL_UPLOAD" | "WEB_FORM";

export const MAX_ROWS_PER_BATCH = 50_000;
// 26 bind params per row -> stays well under Postgres' 65,535 parameter limit
const INSERT_CHUNK = 1_000;

export class IngestionError extends HttpError {}

export interface SheetPreview {
  totalRows: number;
  headers: string[];
  mapping: ColumnMapping;
  sample: CanonicalRow[];
}

export function previewSheet(sheet: ParsedSheet, sampleSize = 10): SheetPreview {
  const mapping = buildMapping(sheet.headers);
  return {
    totalRows: sheet.rows.length,
    headers: sheet.headers,
    mapping,
    sample: sheet.rows.slice(0, sampleSize).map((r) => applyMapping(r, mapping)),
  };
}

export interface IngestInput {
  institutionId: string;
  academicYear: string;
  submittedBy?: string | null;
  source: SourceChannel;
  filename?: string | null;
  file?: Buffer;
  /** Re-ingest even if this exact file was already uploaded for the institution */
  allowDuplicateFile?: boolean;
  rows: { row: CanonicalRow; sourceRowNumber: number }[];
}

export interface BatchSummary {
  batchId: string;
  status: string;
  sourceChannel: string;
  originalFilename: string | null;
  academicYear: string;
  totalRows: number;
  l1RejectedRows: number;
  l2QuarantinedRows: number;
  l3QuarantinedRows: number;
  promotedRows: number;
  uploadedAt: string;
  completedAt: string | null;
  failureReason: string | null;
}

export async function ingest(input: IngestInput): Promise<BatchSummary> {
  const rows = input.rows.filter(({ row }) => FIELDS.some((f) => row[f]) || row.extra);
  if (rows.length === 0) throw new IngestionError("No student rows found to ingest.", 422);
  if (rows.length > MAX_ROWS_PER_BATCH) {
    throw new IngestionError(
      `A batch can hold at most ${MAX_ROWS_PER_BATCH.toLocaleString("en-IN")} rows; this one has ${rows.length.toLocaleString("en-IN")}. Split the file and upload each part.`,
      413,
    );
  }

  const sha256 = input.file ? createHash("sha256").update(input.file).digest("hex") : null;
  const client = await pool.connect();
  let batchId: string;
  try {
    await client.query("BEGIN");

    const inst = await client.query("SELECT 1 FROM master.institutions WHERE institution_id = $1", [input.institutionId]);
    if (inst.rowCount === 0) throw new IngestionError("Institution not found.", 404);

    if (sha256 && !input.allowDuplicateFile) {
      const dup = await client.query<{ batch_id: string; uploaded_at: Date }>(
        `SELECT batch_id, uploaded_at FROM staging.submission_batches
          WHERE institution_id = $1 AND file_sha256 = $2 AND status NOT IN ('FAILED', 'CANCELLED')
          ORDER BY uploaded_at DESC LIMIT 1`,
        [input.institutionId, sha256],
      );
      const prior = dup.rows[0];
      if (prior) {
        throw new IngestionError("This exact file was already uploaded for this institution.", 409, {
          batchId: prior.batch_id,
          uploadedAt: prior.uploaded_at,
        });
      }
    }

    const batch = await client.query<{ batch_id: string }>(
      `INSERT INTO staging.submission_batches
         (institution_id, academic_year, submitted_by, source_channel, original_filename, file_sha256, file_size_bytes, total_rows)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING batch_id`,
      [
        input.institutionId,
        input.academicYear,
        input.submittedBy ?? null,
        input.source,
        input.filename?.slice(0, 255) ?? null,
        sha256,
        input.file?.length ?? null,
        rows.length,
      ],
    );
    batchId = batch.rows[0]!.batch_id;

    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await insertRecords(client, batchId, input, rows.slice(i, i + INSERT_CHUNK));
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw translatePgError(err);
  } finally {
    client.release();
  }

  // Rows are committed; hand the batch to the L1/L2 validation pipeline. If the queue is down the
  // upload is kept and marked FAILED, so it can be retried from the dashboard without re-uploading.
  try {
    const jobId = await enqueueValidationJob({ kind: "validate", batchId });
    await pool.query("UPDATE staging.submission_batches SET bullmq_job_id = $2 WHERE batch_id = $1", [batchId, jobId]);
  } catch (err) {
    console.error(`[ingestion] could not queue batch ${batchId} for validation`, err);
    await markBatchFailed(batchId, "Could not queue the batch for validation. Use Retry to try again.");
  }
  return (await getBatch(batchId, input.institutionId))!;
}

const RECORD_COLUMNS = [
  "batch_id",
  "institution_id",
  "academic_year",
  "source_row_number",
  ...FIELDS.map((f) => `raw_${f}`),
  "raw_payload",
];

async function insertRecords(
  client: PoolClient,
  batchId: string,
  input: IngestInput,
  rows: IngestInput["rows"],
): Promise<void> {
  const params: unknown[] = [];
  const tuples = rows.map(({ row, sourceRowNumber }) => {
    const values = [
      batchId,
      input.institutionId,
      input.academicYear,
      sourceRowNumber,
      ...FIELDS.map((f) => (row[f] ? row[f] : null)),
      row.extra ? JSON.stringify(row.extra) : null,
    ];
    const start = params.length;
    params.push(...values);
    return `(${values.map((_, j) => `$${start + j + 1}`).join(", ")})`;
  });
  await client.query(
    `INSERT INTO staging.staging_enrolment_records (${RECORD_COLUMNS.join(", ")}) VALUES ${tuples.join(", ")}`,
    params,
  );
}

export async function getBatch(batchId: string, institutionId?: string): Promise<BatchSummary | null> {
  const { rows } = await pool.query(
    `SELECT batch_id, status, source_channel, original_filename, academic_year, total_rows,
            l1_rejected_rows, l2_quarantined_rows, l3_quarantined_rows, promoted_rows,
            uploaded_at, completed_at, failure_reason
       FROM staging.submission_batches
      WHERE batch_id = $1 AND ($2::uuid IS NULL OR institution_id = $2::uuid)`,
    [batchId, institutionId ?? null],
  );
  return rows[0] ? toSummary(rows[0]) : null;
}

export async function listBatches(institutionId: string, limit = 20): Promise<BatchSummary[]> {
  const { rows } = await pool.query(
    `SELECT batch_id, status, source_channel, original_filename, academic_year, total_rows,
            l1_rejected_rows, l2_quarantined_rows, l3_quarantined_rows, promoted_rows,
            uploaded_at, completed_at, failure_reason
       FROM staging.submission_batches
      WHERE institution_id = $1
      ORDER BY uploaded_at DESC
      LIMIT $2`,
    [institutionId, limit],
  );
  return rows.map(toSummary);
}

export async function listInstitutions(): Promise<
  { institutionId: string; name: string; aictePermanentId: string; region: string }[]
> {
  const { rows } = await pool.query(
    `SELECT institution_id, institution_name, aicte_permanent_id, aicte_region
       FROM master.institutions ORDER BY institution_name LIMIT 500`,
  );
  return rows.map((r) => ({
    institutionId: r.institution_id,
    name: r.institution_name,
    aictePermanentId: r.aicte_permanent_id,
    region: r.aicte_region,
  }));
}

function toSummary(r: Record<string, any>): BatchSummary {
  return {
    batchId: r.batch_id,
    status: r.status,
    sourceChannel: r.source_channel,
    originalFilename: r.original_filename,
    academicYear: r.academic_year,
    totalRows: r.total_rows,
    l1RejectedRows: r.l1_rejected_rows,
    l2QuarantinedRows: r.l2_quarantined_rows,
    l3QuarantinedRows: r.l3_quarantined_rows,
    promotedRows: r.promoted_rows,
    uploadedAt: r.uploaded_at?.toISOString?.() ?? r.uploaded_at,
    completedAt: r.completed_at?.toISOString?.() ?? r.completed_at ?? null,
    failureReason: r.failure_reason,
  };
}

function translatePgError(err: unknown): unknown {
  if (err instanceof IngestionError) return err;
  const pgErr = err as { code?: string; message?: string };
  if (pgErr.code === "22P02" && pgErr.message?.includes("submission_source_enum")) {
    return new IngestionError(
      "Form submissions need the WEB_FORM source channel. Run database/db_scripts/ingestion_patch.sql on the database.",
      500,
    );
  }
  if (pgErr.code === "23503") return new IngestionError("Institution or submitting user does not exist.", 422);
  return err;
}
