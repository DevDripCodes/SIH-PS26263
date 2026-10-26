// L2: resolve every L1_PASSED row to a student in core.students.
//
//  * APAAR already in the national repository  -> must match on date of birth and name
//  * APAAR not yet in the repository            -> registry lookup (DigiLocker / ABC when configured),
//                                                  then the student is created
//  * Foreign National without APAAR             -> matched on encrypted-passport fingerprint, else created
//                                                  as EXEMPT_FOREIGN_PROVISIONAL
// Non-resident students get their core.student_foreign_nri_profiles row (AES-256-GCM fields) in the
// same transaction, as the deferred profile trigger requires.

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../../../db/pool.js";
import { pgErrorCode, withTransaction } from "../../../db/transaction.js";
import { apaarRegistry, type RegistryResult } from "../../../integrations/apaar-registry/index.js";
import { ENCRYPTION_KEY_VERSION, encryptField, fingerprint } from "../../../lib/crypto/field-encryption.js";
import { insertAnomalies, type Anomaly } from "../anomalies.js";
import type { RawRecord } from "../l1-rules.js";
import { NAME_MATCH_THRESHOLD, nameSimilarity } from "../name-match.js";
import {
  cleanDocumentNo,
  cleanName,
  parseCountry,
  parseDate,
  parseGender,
  type Residency,
} from "../normalise.js";
import { RAW_COLUMNS } from "./l1.stage.js";

interface L2Row extends RawRecord {
  normalised_apaar_id: string | null;
  resolved_residency_status: Residency;
}

interface ExistingStudent {
  student_id: string;
  apaar_id: string | null;
  full_name: string;
  date_of_birth: string;
  residency_status: Residency;
}

interface Outcome {
  recordId: string;
  studentId: string | null;
  similarity: number | null;
  abcRef: string | null;
  abcVerified: boolean;
}

interface NewStudent {
  studentId: string;
  apaarId: string | null;
  status: "VERIFIED" | "EXEMPT_FOREIGN_PROVISIONAL";
  fullName: string;
  dateOfBirth: string;
  gender: string | null;
  residency: Residency;
  country: string;
}

interface NewProfile {
  studentId: string;
  residency: Residency;
  country: string;
  passportEnc: Buffer;
  passportFp: Buffer;
  passportExpiry: string | null;
  visaType: string | null;
  frroEnc: Buffer | null;
  ociEnc: Buffer | null;
  sponsorEnc: Buffer | null;
}

const MAX_ATTEMPTS = 3;

export async function runL2(batchId: string): Promise<void> {
  await pool.query(
    "UPDATE staging.submission_batches SET status = 'L2_PROCESSING' WHERE batch_id = $1 AND status = 'L1_COMPLETED'",
    [batchId],
  );

  // A concurrent batch may create the same student between our read and insert (unique violation).
  // The whole stage is one transaction, so a retry simply sees that student as existing.
  for (let attempt = 1; ; attempt++) {
    try {
      await withTransaction((client) => resolveIdentities(client, batchId));
      return;
    } catch (err) {
      if (pgErrorCode(err) !== "23505" || attempt >= MAX_ATTEMPTS) throw err;
    }
  }
}

async function resolveIdentities(client: PoolClient, batchId: string): Promise<void> {
  const { rows: batches } = await client.query<{ institution_id: string; status: string }>(
    "SELECT institution_id, status FROM staging.submission_batches WHERE batch_id = $1 FOR UPDATE",
    [batchId],
  );
  const batch = batches[0];
  if (!batch || batch.status !== "L2_PROCESSING") return;

  const { rows } = await client.query<L2Row>(
    `SELECT ${RAW_COLUMNS}, normalised_apaar_id, resolved_residency_status::text AS resolved_residency_status
       FROM staging.staging_enrolment_records
      WHERE batch_id = $1 AND validation_status = 'L1_PASSED' ORDER BY source_row_number`,
    [batchId],
  );

  const anomalies: Anomaly[] = [];
  const outcomes: Outcome[] = [];
  const quarantined = new Set<string>();
  const newStudents: NewStudent[] = [];
  const newProfiles: NewProfile[] = [];

  const quarantine = (row: L2Row, a: Omit<Anomaly, "recordId" | "level" | "severity">) => {
    quarantined.add(row.record_id);
    anomalies.push({ recordId: row.record_id, level: 2, severity: "ERROR", ...a });
  };

  // --- Look up everything we need in a few set-based queries ---------------------------------
  const apaarIds = rows.flatMap((r) => (r.normalised_apaar_id ? [r.normalised_apaar_id] : []));
  const { rows: byApaarRows } = await client.query<ExistingStudent>(
    `SELECT student_id, apaar_id, full_name, date_of_birth::text AS date_of_birth, residency_status::text AS residency_status
       FROM core.students WHERE apaar_id = ANY($1::char(12)[])`,
    [apaarIds],
  );
  const byApaar = new Map(byApaarRows.map((s) => [s.apaar_id!, s]));

  const passportKey = (row: L2Row) => {
    const no = cleanDocumentNo(row.raw_passport_no);
    return no && row.resolved_residency_status !== "INDIAN_RESIDENT" ? `passport:${no}` : null;
  };
  const fingerprints = new Map<string, Buffer>();
  for (const row of rows) {
    const k = passportKey(row);
    if (k && !fingerprints.has(k)) fingerprints.set(k, fingerprint(k));
  }
  const { rows: byPassportRows } = await client.query<ExistingStudent & { fp: Buffer }>(
    `SELECT p.passport_fingerprint AS fp, s.student_id, s.apaar_id, s.full_name,
            s.date_of_birth::text AS date_of_birth, s.residency_status::text AS residency_status
       FROM core.student_foreign_nri_profiles p JOIN core.students s USING (student_id)
      WHERE p.passport_fingerprint = ANY($1::bytea[])`,
    [[...fingerprints.values()]],
  );
  const byPassport = new Map(byPassportRows.map((s) => [s.fp.toString("hex"), s]));

  const unknownApaars = apaarIds.filter((id) => !byApaar.has(id));
  const registry = await apaarRegistry().lookupMany(unknownApaars);

  const claimedPassports = new Set<string>();

  // --- Decide each row ------------------------------------------------------------------------
  for (const row of rows) {
    const name = cleanName(row.raw_full_name)!;
    const dob = parseDate(row.raw_date_of_birth);
    const dateOfBirth = dob.ok ? dob.value! : "";
    const residency = row.resolved_residency_status;
    const pKey = passportKey(row);
    const fp = pKey ? fingerprints.get(pKey)! : null;
    const passportOwner = fp ? byPassport.get(fp.toString("hex")) : undefined;

    const existing = row.normalised_apaar_id
      ? byApaar.get(row.normalised_apaar_id)
      : residency === "FOREIGN_NATIONAL"
        ? passportOwner
        : undefined;

    if (existing) {
      const similarity = nameSimilarity(name, existing.full_name);
      const dobMatches = existing.date_of_birth === dateOfBirth;
      if (!dobMatches || similarity < NAME_MATCH_THRESHOLD) {
        quarantine(row, {
          code: "APAAR_DEMOGRAPHIC_MISMATCH",
          field: dobMatches ? "raw_full_name" : "raw_date_of_birth",
          offendingValue: null,
          message: `Name or date of birth does not match the student already registered with this ${row.normalised_apaar_id ? "APAAR ID" : "passport"}.`,
          fixHint: "Check the APAAR ID and enter the name and date of birth exactly as on the APAAR record.",
          details: { name_similarity: similarity, dob_matches: dobMatches },
        });
        outcomes.push({ recordId: row.record_id, studentId: null, similarity, abcRef: null, abcVerified: false });
        continue;
      }
      if (existing.residency_status !== residency) {
        anomalies.push({
          recordId: row.record_id,
          level: 2,
          severity: "WARNING",
          code: "APAAR_DEMOGRAPHIC_MISMATCH",
          field: "raw_residency_status",
          offendingValue: row.raw_residency_status,
          message: `Uploaded residency ${residency} differs from the registered residency ${existing.residency_status}. The registered value is used.`,
          fixHint: "If the residency status has really changed, raise a correction request with AICTE.",
          details: { uploaded: residency, registered: existing.residency_status },
        });
      }
      outcomes.push({ recordId: row.record_id, studentId: existing.student_id, similarity, abcRef: "REPOSITORY_MATCH", abcVerified: false });
      continue;
    }

    // A passport that already belongs to someone else (or to an earlier row of this upload).
    if (pKey && (passportOwner || claimedPassports.has(pKey))) {
      quarantine(row, {
        code: "APAAR_DEMOGRAPHIC_MISMATCH",
        field: "raw_passport_no",
        offendingValue: null,
        message: "This passport number is already registered to a different student.",
        fixHint: "Check the passport number and APAAR ID of this student.",
      });
      outcomes.push({ recordId: row.record_id, studentId: null, similarity: null, abcRef: null, abcVerified: false });
      continue;
    }

    // --- New student: verify the APAAR with the registry if one is configured ------------------
    let fullName = name;
    let abcRef: string | null = null;
    let abcVerified = false;
    let similarity: number | null = null;

    if (row.normalised_apaar_id) {
      const result: RegistryResult = registry.get(row.normalised_apaar_id) ?? { status: "NOT_CONFIGURED" };
      if (result.status === "NOT_FOUND" || result.status === "INACTIVE") {
        quarantine(row, {
          code: result.status === "NOT_FOUND" ? "APAAR_NOT_FOUND" : "APAAR_INACTIVE",
          field: "raw_apaar_id",
          offendingValue: row.raw_apaar_id,
          message: result.status === "NOT_FOUND" ? "APAAR ID does not exist in the APAAR registry." : "APAAR ID is inactive in the APAAR registry.",
          fixHint: "Check the APAAR ID with the student's DigiLocker account.",
          details: { registry_ref: result.responseRef },
        });
        outcomes.push({ recordId: row.record_id, studentId: null, similarity: null, abcRef: result.responseRef, abcVerified: false });
        continue;
      }
      if (result.status === "UNAVAILABLE") {
        quarantine(row, {
          code: "ABC_VERIFICATION_UNAVAILABLE",
          field: "raw_apaar_id",
          offendingValue: null,
          message: "The APAAR registry could not be reached to verify this student.",
          fixHint: "Re-submit this row later.",
          details: { reason: result.reason },
        });
        outcomes.push({ recordId: row.record_id, studentId: null, similarity: null, abcRef: null, abcVerified: false });
        continue;
      }
      if (result.status === "FOUND") {
        similarity = nameSimilarity(name, result.fullName);
        const dobMatches = result.dateOfBirth === dateOfBirth;
        if (!dobMatches || similarity < NAME_MATCH_THRESHOLD) {
          quarantine(row, {
            code: "APAAR_DEMOGRAPHIC_MISMATCH",
            field: dobMatches ? "raw_full_name" : "raw_date_of_birth",
            offendingValue: null,
            message: "Name or date of birth does not match the APAAR registry.",
            fixHint: "Enter the name and date of birth exactly as on the student's APAAR record.",
            details: { name_similarity: similarity, dob_matches: dobMatches, registry_ref: result.responseRef },
          });
          outcomes.push({ recordId: row.record_id, studentId: null, similarity, abcRef: result.responseRef, abcVerified: true });
          continue;
        }
        fullName = result.fullName;
        abcRef = result.responseRef;
        abcVerified = true;
      } else {
        abcRef = "SELF_DECLARED"; // registry not configured yet: identity as declared by the institution
      }
    }

    const country = resolveCountry(row);
    const gender = parseGender(row.raw_gender);
    const studentId = randomUUID();
    newStudents.push({
      studentId,
      apaarId: row.normalised_apaar_id,
      status: row.normalised_apaar_id ? "VERIFIED" : "EXEMPT_FOREIGN_PROVISIONAL",
      fullName: fullName.slice(0, 200),
      dateOfBirth,
      gender: gender.ok ? gender.value : null,
      residency,
      country,
    });
    if (residency !== "INDIAN_RESIDENT") {
      claimedPassports.add(pKey!);
      newProfiles.push(buildProfile(studentId, row, residency, country, fp!));
    }
    outcomes.push({ recordId: row.record_id, studentId, similarity, abcRef, abcVerified });
  }

  // --- Write ---------------------------------------------------------------------------------
  await insertStudents(client, newStudents);
  await insertProfiles(client, newProfiles);

  await client.query(
    `UPDATE staging.staging_enrolment_records r
        SET validation_status = u.status::staging.record_validation_status_enum,
            rejected_at_level = u.level,
            resolved_student_id = u.student_id,
            abc_name_similarity = u.similarity,
            abc_response_ref = u.abc_ref,
            abc_verified_at = CASE WHEN u.abc_verified THEN NOW() END
       FROM unnest($1::bigint[], $2::text[], $3::smallint[], $4::uuid[], $5::numeric[], $6::text[], $7::boolean[])
         AS u(record_id, status, level, student_id, similarity, abc_ref, abc_verified)
      WHERE r.record_id = u.record_id AND r.batch_id = $8`,
    [
      outcomes.map((o) => o.recordId),
      outcomes.map((o) => (quarantined.has(o.recordId) ? "QUARANTINED" : "L2_VERIFIED")),
      outcomes.map((o) => (quarantined.has(o.recordId) ? 2 : null)),
      outcomes.map((o) => o.studentId),
      outcomes.map((o) => o.similarity),
      outcomes.map((o) => o.abcRef?.slice(0, 100) ?? null),
      outcomes.map((o) => o.abcVerified),
      batchId,
    ],
  );

  await insertAnomalies(client, batchId, batch.institution_id, anomalies);

  await client.query(
    `UPDATE staging.submission_batches
        SET status = 'L2_COMPLETED',
            l2_quarantined_rows = (SELECT count(*) FROM staging.staging_enrolment_records
                                    WHERE batch_id = $1 AND validation_status = 'QUARANTINED' AND rejected_at_level = 2)
      WHERE batch_id = $1`,
    [batchId],
  );
}

/** Citizenship for core: Indian residents, NRIs and CIWGC default to IN. */
function resolveCountry(row: L2Row): string {
  const parsed = parseCountry(row.raw_nationality);
  if (parsed.ok && parsed.value) return parsed.value;
  return "IN";
}

function buildProfile(studentId: string, row: L2Row, residency: Residency, country: string, passportFp: Buffer): NewProfile {
  const enc = (raw: string | null) => {
    const value = cleanDocumentNo(raw);
    return value ? encryptField(value) : null;
  };
  const expiry = parseDate(row.raw_passport_expiry);
  return {
    studentId,
    residency,
    country,
    passportEnc: encryptField(cleanDocumentNo(row.raw_passport_no)!),
    passportFp,
    passportExpiry: expiry.ok ? expiry.value : null,
    visaType: row.raw_visa_type?.trim().slice(0, 50) || null,
    frroEnc: enc(row.raw_frro_reg_no),
    ociEnc: enc(row.raw_oci_card_no),
    sponsorEnc: row.raw_embassy_sponsor_ref?.trim() ? encryptField(row.raw_embassy_sponsor_ref.trim()) : null,
  };
}

async function insertStudents(client: PoolClient, students: NewStudent[]): Promise<void> {
  if (students.length === 0) return;
  await client.query(
    `INSERT INTO core.students (student_id, apaar_id, apaar_verification_status, apaar_verified_at, full_name,
                                date_of_birth, gender, residency_status, nationality_country_code)
     SELECT u.student_id, u.apaar_id, u.status::core.apaar_verification_status_enum,
            CASE WHEN u.status = 'VERIFIED' THEN NOW() END, u.full_name, u.dob, u.gender,
            u.residency::master.residency_status_enum, u.country
       FROM unnest($1::uuid[], $2::char(12)[], $3::text[], $4::text[], $5::date[], $6::text[], $7::text[], $8::char(2)[])
         AS u(student_id, apaar_id, status, full_name, dob, gender, residency, country)`,
    [
      students.map((s) => s.studentId),
      students.map((s) => s.apaarId),
      students.map((s) => s.status),
      students.map((s) => s.fullName),
      students.map((s) => s.dateOfBirth),
      students.map((s) => s.gender),
      students.map((s) => s.residency),
      students.map((s) => s.country),
    ],
  );
}

async function insertProfiles(client: PoolClient, profiles: NewProfile[]): Promise<void> {
  if (profiles.length === 0) return;
  await client.query(
    `INSERT INTO core.student_foreign_nri_profiles
       (student_id, residency_status, country_of_citizenship, passport_number_enc, passport_fingerprint,
        passport_expiry, visa_type, frro_registration_no_enc, oci_card_no_enc, embassy_sponsorship_ref_enc,
        encryption_key_version)
     SELECT u.student_id, u.residency::master.residency_status_enum, u.country, u.passport_enc, u.passport_fp,
            u.expiry, u.visa, u.frro, u.oci, u.sponsor, $11
       FROM unnest($1::uuid[], $2::text[], $3::char(2)[], $4::bytea[], $5::bytea[], $6::date[], $7::text[],
                   $8::bytea[], $9::bytea[], $10::bytea[])
         AS u(student_id, residency, country, passport_enc, passport_fp, expiry, visa, frro, oci, sponsor)`,
    [
      profiles.map((p) => p.studentId),
      profiles.map((p) => p.residency),
      profiles.map((p) => p.country),
      profiles.map((p) => p.passportEnc),
      profiles.map((p) => p.passportFp),
      profiles.map((p) => p.passportExpiry),
      profiles.map((p) => p.visaType),
      profiles.map((p) => p.frroEnc),
      profiles.map((p) => p.ociEnc),
      profiles.map((p) => p.sponsorEnc),
      ENCRYPTION_KEY_VERSION,
    ],
  );
}
