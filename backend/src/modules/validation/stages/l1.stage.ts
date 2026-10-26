import { pool } from "../../../db/pool.js";
import { withTransaction } from "../../../db/transaction.js";
import { insertAnomalies } from "../anomalies.js";
import { findBatchDuplicates, validateRow, type L1Result, type ProgramRef, type RawRecord } from "../l1-rules.js";

export const RAW_COLUMNS = `record_id::text AS record_id, source_row_number, raw_apaar_id, raw_full_name, raw_date_of_birth,
  raw_gender, raw_roll_no, raw_program_code, raw_admission_date, raw_social_category, raw_residency_status,
  raw_seat_quota_type, raw_is_fn, raw_is_oci_status, raw_nationality, raw_passport_no, raw_passport_expiry,
  raw_visa_type, raw_frro_reg_no, raw_oci_card_no, raw_embassy_sponsor_ref`;

/** L1: syntax, category and intra-batch checks for every PENDING row of the batch. */
export async function runL1(batchId: string): Promise<void> {
  // Separate statement so dashboards see L1_PROCESSING while the work runs.
  await pool.query(
    `UPDATE staging.submission_batches
        SET status = 'L1_PROCESSING', processing_started_at = COALESCE(processing_started_at, NOW())
      WHERE batch_id = $1 AND status = 'UPLOADED'`,
    [batchId],
  );

  await withTransaction(async (client) => {
    const { rows: batches } = await client.query<{ institution_id: string; status: string }>(
      "SELECT institution_id, status FROM staging.submission_batches WHERE batch_id = $1 FOR UPDATE",
      [batchId],
    );
    const batch = batches[0];
    if (!batch || batch.status !== "L1_PROCESSING") return;

    const { rows: programRows } = await client.query<{
      program_id: string;
      aicte_course_id: string;
      program_level: string;
      is_active: boolean;
    }>(
      `SELECT program_id, aicte_course_id, program_level::text AS program_level, is_active
         FROM master.institutional_programs WHERE institution_id = $1`,
      [batch.institution_id],
    );
    const programs = new Map<string, ProgramRef>(
      programRows.map((p) => [
        p.aicte_course_id.trim().toUpperCase(),
        { programId: p.program_id, level: p.program_level, isActive: p.is_active },
      ]),
    );

    const { rows } = await client.query<RawRecord>(
      `SELECT ${RAW_COLUMNS} FROM staging.staging_enrolment_records
        WHERE batch_id = $1 AND validation_status = 'PENDING' ORDER BY source_row_number`,
      [batchId],
    );

    const today = new Date().toISOString().slice(0, 10);
    const results = new Map<string, L1Result>(rows.map((r) => [r.record_id, validateRow(r, programs, today)]));
    for (const dup of findBatchDuplicates(rows, results)) {
      const result = results.get(dup.recordId)!;
      result.anomalies.push(dup);
      result.passed = false;
    }

    const all = [...results.values()];
    await client.query(
      `UPDATE staging.staging_enrolment_records r
          SET validation_status = u.status::staging.record_validation_status_enum,
              rejected_at_level = u.level,
              normalised_apaar_id = u.apaar,
              resolved_program_id = u.program_id,
              resolved_residency_status = u.residency::master.residency_status_enum,
              resolved_quota_type = u.quota::master.seat_quota_type_enum,
              resolved_admission_date = u.admission_date
         FROM unnest($1::bigint[], $2::text[], $3::smallint[], $4::text[], $5::uuid[], $6::text[], $7::text[], $8::date[])
           AS u(record_id, status, level, apaar, program_id, residency, quota, admission_date)
        WHERE r.record_id = u.record_id AND r.batch_id = $9`,
      [
        all.map((r) => r.recordId),
        all.map((r) => (r.passed ? "L1_PASSED" : "REJECTED")),
        all.map((r) => (r.passed ? null : 1)),
        all.map((r) => r.resolved.apaarId),
        all.map((r) => r.resolved.programId),
        all.map((r) => r.resolved.residency),
        all.map((r) => r.resolved.quota),
        all.map((r) => r.resolved.admissionDate),
        batchId,
      ],
    );

    await insertAnomalies(
      client,
      batchId,
      batch.institution_id,
      all.flatMap((r) => r.anomalies),
    );

    await client.query(
      `UPDATE staging.submission_batches
          SET status = 'L1_COMPLETED',
              l1_rejected_rows = (SELECT count(*) FROM staging.staging_enrolment_records
                                   WHERE batch_id = $1 AND validation_status = 'REJECTED')
        WHERE batch_id = $1`,
      [batchId],
    );
  });
}
