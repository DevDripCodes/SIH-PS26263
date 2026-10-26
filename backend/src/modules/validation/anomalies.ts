import type { PoolClient } from "pg";

export type Severity = "ERROR" | "WARNING";

export interface Anomaly {
  recordId: string;
  code: string; // staging.anomaly_code_enum
  severity: Severity;
  level: 1 | 2 | 3;
  field: string | null;
  /** Never put passport / OCI / contact values here (schema rule). */
  offendingValue: string | null;
  message: string;
  fixHint: string;
  details?: Record<string, unknown>;
}

/** Bulk insert in one statement; arrays keep the parameter count fixed regardless of size. */
export async function insertAnomalies(
  client: PoolClient,
  batchId: string,
  institutionId: string,
  anomalies: Anomaly[],
): Promise<void> {
  if (anomalies.length === 0) return;
  await client.query(
    `INSERT INTO staging.validation_anomalies
       (batch_id, record_id, institution_id, anomaly_code, severity, validation_level,
        field_name, offending_value, message, fix_hint, details)
     SELECT $1, u.record_id, $2, u.code::staging.anomaly_code_enum, u.severity::staging.anomaly_severity_enum,
            u.level, u.field, u.offending, u.message, u.fix_hint, u.details
       FROM unnest($3::bigint[], $4::text[], $5::text[], $6::smallint[], $7::text[], $8::text[],
                   $9::text[], $10::text[], $11::jsonb[])
         AS u(record_id, code, severity, level, field, offending, message, fix_hint, details)`,
    [
      batchId,
      institutionId,
      anomalies.map((a) => a.recordId),
      anomalies.map((a) => a.code),
      anomalies.map((a) => a.severity),
      anomalies.map((a) => a.level),
      anomalies.map((a) => a.field),
      anomalies.map((a) => a.offendingValue?.slice(0, 500) ?? null),
      anomalies.map((a) => a.message),
      anomalies.map((a) => a.fixHint),
      anomalies.map((a) => JSON.stringify(a.details ?? {})),
    ],
  );
}
