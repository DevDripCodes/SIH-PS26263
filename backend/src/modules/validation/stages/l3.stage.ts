// L3: quota caps, national enrolment lock, cut-off dates and promotion into core all live in the
// database (core.promote_batch). This module only calls it: for real after the maker-checker
// approval, or inside a rolled-back transaction to show the approver what would happen.

import { pool } from "../../../db/pool.js";
import { pgErrorCode, setActor, withTransaction } from "../../../db/transaction.js";

const DEADLOCK = "40P01";
const MAX_ATTEMPTS = 3;

export async function runL3(batchId: string, actorUserId: string | null): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTransaction(async (client) => {
        await setActor(client, actorUserId, `promote:${batchId}`);
        const { rows } = await client.query<{ result: unknown }>("SELECT core.promote_batch($1) AS result", [batchId]);
        return rows[0]?.result;
      });
    } catch (err) {
      // The promotion SQL documents that callers must retry on deadlock.
      if (pgErrorCode(err) !== DEADLOCK || attempt >= MAX_ATTEMPTS) throw err;
      await new Promise((r) => setTimeout(r, 200 * attempt));
    }
  }
}

export interface PromotionForecast {
  willPromote: number;
  alreadyEnrolled: number;
  willQuarantine: number;
  byCode: Record<string, number>;
  rows: {
    sourceRowNumber: number;
    code: string;
    message: string;
    fixHint: string | null;
    details: Record<string, unknown>;
  }[];
}

/**
 * Dry run of core.promote_batch: executes it and rolls back, so the approver sees seat-cap,
 * cross-institution and cut-off results before committing. Nothing is persisted.
 */
export async function forecastPromotion(batchId: string): Promise<PromotionForecast> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SELECT core.promote_batch($1)", [batchId]);

    const { rows: counts } = await client.query<{ promote: string; existing: string; quarantine: string }>(
      `SELECT count(*) FILTER (WHERE r.validation_status = 'VALID' AND e.source_batch_id = $1) AS promote,
              count(*) FILTER (WHERE r.validation_status = 'VALID' AND e.source_batch_id IS DISTINCT FROM $1) AS existing,
              count(*) FILTER (WHERE r.validation_status = 'QUARANTINED' AND r.rejected_at_level = 3) AS quarantine
         FROM staging.staging_enrolment_records r
         LEFT JOIN core.student_enrolments e
           ON e.enrolment_id = r.promoted_enrolment_id AND e.academic_year = r.academic_year
        WHERE r.batch_id = $1`,
      [batchId],
    );
    const { rows: anomalyRows } = await client.query<{
      source_row_number: number;
      anomaly_code: string;
      message: string;
      fix_hint: string | null;
      details: Record<string, unknown>;
    }>(
      `SELECT r.source_row_number, a.anomaly_code::text AS anomaly_code, a.message, a.fix_hint, a.details
         FROM staging.validation_anomalies a
         JOIN staging.staging_enrolment_records r ON r.record_id = a.record_id
        WHERE a.batch_id = $1 AND a.created_at = transaction_timestamp()
        ORDER BY r.source_row_number`,
      [batchId],
    );

    const byCode: Record<string, number> = {};
    for (const a of anomalyRows) byCode[a.anomaly_code] = (byCode[a.anomaly_code] ?? 0) + 1;

    return {
      willPromote: Number(counts[0]?.promote ?? 0),
      alreadyEnrolled: Number(counts[0]?.existing ?? 0),
      willQuarantine: Number(counts[0]?.quarantine ?? 0),
      byCode,
      rows: anomalyRows.slice(0, 500).map((a) => ({
        sourceRowNumber: a.source_row_number,
        code: a.anomaly_code,
        message: a.message,
        fixHint: a.fix_hint,
        details: a.details,
      })),
    };
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}
