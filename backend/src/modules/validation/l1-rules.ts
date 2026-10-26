// Level 1: syntax, category and intra-batch checks. Pure functions over raw staging rows, so they
// can be unit tested without a database. Quota caps, cross-institution enrolment, intake approval,
// cut-off dates and roll numbers already in the repository are checked by the database at L3
// (core.promote_batch) and are deliberately not repeated here.

import type { Anomaly } from "./anomalies.js";
import {
  ageOn,
  cleanDocumentNo,
  cleanName,
  cleanRollNo,
  looksLikeScientificNotation,
  parseApaar,
  parseCountry,
  parseDate,
  parseGender,
  parseQuota,
  parseResidency,
  parseSocialCategory,
  parseYesNo,
  type Quota,
  type Residency,
} from "./normalise.js";

export interface RawRecord {
  record_id: string;
  source_row_number: number;
  raw_apaar_id: string | null;
  raw_full_name: string | null;
  raw_date_of_birth: string | null;
  raw_gender: string | null;
  raw_roll_no: string | null;
  raw_program_code: string | null;
  raw_admission_date: string | null;
  raw_social_category: string | null;
  raw_residency_status: string | null;
  raw_seat_quota_type: string | null;
  raw_is_fn: string | null;
  raw_is_oci_status: string | null;
  raw_nationality: string | null;
  raw_passport_no: string | null;
  raw_passport_expiry: string | null;
  raw_visa_type: string | null;
  raw_frro_reg_no: string | null;
  raw_oci_card_no: string | null;
  raw_embassy_sponsor_ref: string | null;
}

export interface ProgramRef {
  programId: string;
  level: string; // master.program_level_enum
  isActive: boolean;
}

export interface L1Resolved {
  apaarId: string | null;
  programId: string | null;
  residency: Residency | null;
  quota: Quota | null;
  admissionDate: string | null;
}

export interface L1Result {
  recordId: string;
  passed: boolean;
  resolved: L1Resolved;
  anomalies: Anomaly[];
}

/** Youngest plausible age at admission per program level (warning only). */
const MIN_AGE: Record<string, number> = {
  DIPLOMA: 14,
  POST_DIPLOMA: 16,
  UG_DEGREE: 16,
  PG_DEGREE: 19,
  PGDM: 19,
  FELLOWSHIP_PHD: 20,
};
const MAX_PLAUSIBLE_AGE = 65;

const NON_RESIDENT: Residency[] = ["NRI", "OCI", "PIO", "FOREIGN_NATIONAL", "CIWGC"];

export function validateRow(row: RawRecord, programs: Map<string, ProgramRef>, today: string): L1Result {
  const anomalies: Anomaly[] = [];
  const add = (a: Omit<Anomaly, "recordId" | "level" | "severity"> & { severity?: Anomaly["severity"] }) =>
    anomalies.push({ recordId: row.record_id, level: 1, severity: "ERROR", ...a });
  const missing = (field: string, label: string, hint: string) =>
    add({ code: "MISSING_REQUIRED_FIELD", field, offendingValue: null, message: `${label} is missing.`, fixHint: hint });

  const resolved: L1Resolved = { apaarId: null, programId: null, residency: null, quota: null, admissionDate: null };

  // --- Residency, FN / OCI flags --------------------------------------------------------------
  const residency = parseResidency(row.raw_residency_status);
  const isFn = parseYesNo(row.raw_is_fn);
  const isOci = parseYesNo(row.raw_is_oci_status);

  if (!residency.ok) {
    add({
      code: "INVALID_RESIDENCY_STATUS",
      field: "raw_residency_status",
      offendingValue: row.raw_residency_status,
      message: `"${row.raw_residency_status}" is not a recognised residency status.`,
      fixHint: "Use one of INDIAN_RESIDENT, NRI, OCI, PIO, FOREIGN_NATIONAL, CIWGC.",
    });
  }
  for (const [flag, raw, field] of [
    [isFn, row.raw_is_fn, "raw_is_fn"],
    [isOci, row.raw_is_oci_status, "raw_is_oci_status"],
  ] as const) {
    if (!flag.ok) {
      add({
        code: "OCI_FN_STATUS_CONFLICT",
        field,
        offendingValue: raw,
        message: `"${raw}" is not a yes/no value.`,
        fixHint: "Use Y or N.",
      });
    }
  }

  const fnFlag = isFn.ok && isFn.value === true;
  const ociFlag = isOci.ok && isOci.value === true;
  let effectiveResidency: Residency | null = residency.ok ? residency.value : null;
  if (residency.ok && residency.value === null) {
    effectiveResidency = fnFlag ? "FOREIGN_NATIONAL" : ociFlag ? "OCI" : "INDIAN_RESIDENT";
  }

  if (fnFlag && ociFlag) {
    add({
      code: "OCI_FN_STATUS_CONFLICT",
      field: "raw_is_oci_status",
      offendingValue: null,
      message: "Student is marked both Foreign National and OCI.",
      fixHint: "A student can be either a Foreign National or an OCI card holder, not both.",
    });
  } else if (
    effectiveResidency &&
    ((fnFlag && effectiveResidency !== "FOREIGN_NATIONAL") || (ociFlag && effectiveResidency !== "OCI"))
  ) {
    add({
      code: "OCI_FN_STATUS_CONFLICT",
      field: fnFlag ? "raw_is_fn" : "raw_is_oci_status",
      offendingValue: null,
      message: `Residency status ${effectiveResidency} contradicts the ${fnFlag ? "Foreign National" : "OCI"} flag.`,
      fixHint: "Make the residency status and the FN / OCI flags agree.",
    });
  }
  resolved.residency = effectiveResidency;

  // --- APAAR ------------------------------------------------------------------------------------
  const apaar = parseApaar(row.raw_apaar_id);
  if (!apaar.ok) {
    add({
      code: "INVALID_APAAR_FORMAT",
      field: "raw_apaar_id",
      offendingValue: row.raw_apaar_id,
      message: "APAAR ID must be exactly 12 digits.",
      fixHint: looksLikeScientificNotation(row.raw_apaar_id)
        ? "Excel converted the APAAR ID to scientific notation and lost digits. Format the column as Text and re-enter the IDs."
        : "Check the APAAR ID on the student's APAAR / DigiLocker card.",
    });
  } else if (apaar.value === null && effectiveResidency !== "FOREIGN_NATIONAL") {
    add({
      code: "MISSING_APAAR_ID",
      field: "raw_apaar_id",
      offendingValue: null,
      message: "APAAR ID is missing.",
      fixHint: "Every student except Foreign Nationals must have an APAAR ID. Help the student generate one via DigiLocker.",
    });
  }
  resolved.apaarId = apaar.ok ? apaar.value : null;

  // --- Name ----------------------------------------------------------------------------------
  const name = cleanName(row.raw_full_name);
  if (!name) missing("raw_full_name", "Student name", "Enter the name exactly as on the APAAR ID.");
  else if (name.length > 200) {
    add({
      code: "MISSING_REQUIRED_FIELD",
      field: "raw_full_name",
      offendingValue: null,
      message: "Student name is longer than 200 characters.",
      fixHint: "Enter the name exactly as on the APAAR ID.",
    });
  }

  if (!parseGender(row.raw_gender).ok) {
    add({
      code: "MISSING_REQUIRED_FIELD",
      severity: "WARNING",
      field: "raw_gender",
      offendingValue: row.raw_gender,
      message: `Gender "${row.raw_gender}" is not recognised and will be left blank.`,
      fixHint: "Use Male, Female or Other.",
    });
  }

  // --- Dates ---------------------------------------------------------------------------------
  const dob = parseDate(row.raw_date_of_birth);
  const admission = parseDate(row.raw_admission_date);

  if (!dob.ok) {
    add({
      code: "INVALID_DATE_OF_BIRTH",
      field: "raw_date_of_birth",
      offendingValue: row.raw_date_of_birth,
      message: "Date of birth is not a valid date.",
      fixHint: "Use YYYY-MM-DD or DD/MM/YYYY.",
    });
  } else if (dob.value === null) {
    missing("raw_date_of_birth", "Date of birth", "Enter the date of birth as YYYY-MM-DD.");
  } else if (dob.value < "1930-01-01" || dob.value > today) {
    add({
      code: "INVALID_DATE_OF_BIRTH",
      field: "raw_date_of_birth",
      offendingValue: row.raw_date_of_birth,
      message: dob.value > today ? "Date of birth is in the future." : "Date of birth is before 1930.",
      fixHint: "Check the date of birth; DD/MM/YYYY is read day-first.",
    });
  }

  if (!admission.ok) {
    add({
      code: "MISSING_REQUIRED_FIELD",
      field: "raw_admission_date",
      offendingValue: row.raw_admission_date,
      message: "Admission date is not a valid date.",
      fixHint: "Use YYYY-MM-DD or DD/MM/YYYY.",
    });
  } else if (admission.value === null) {
    missing("raw_admission_date", "Admission date", "Enter the admission date as YYYY-MM-DD.");
  }
  resolved.admissionDate = admission.ok ? admission.value : null;

  // --- Program ------------------------------------------------------------------------------
  const programCode = row.raw_program_code?.trim();
  let program: ProgramRef | undefined;
  if (!programCode) {
    missing("raw_program_code", "Program code", "Enter the AICTE course ID of the program the student is admitted to.");
  } else {
    program = programs.get(programCode.toUpperCase());
    if (!program || !program.isActive) {
      add({
        code: "UNKNOWN_PROGRAM",
        field: "raw_program_code",
        offendingValue: programCode,
        message: program
          ? "This program is marked inactive for the institution."
          : "Program code does not match any AICTE-approved program of this institution.",
        fixHint: "Use the AICTE course ID shown in the institution's approved program list.",
      });
      program = undefined;
    }
  }
  resolved.programId = program?.programId ?? null;

  // Age vs program level: a warning, the row still proceeds.
  if (dob.ok && dob.value && admission.ok && admission.value) {
    const age = ageOn(dob.value, admission.value);
    const minAge = program ? (MIN_AGE[program.level] ?? 14) : 14;
    if (age < 10) {
      add({
        code: "INVALID_DATE_OF_BIRTH",
        field: "raw_date_of_birth",
        offendingValue: row.raw_date_of_birth,
        message: `Student would be ${age} years old at admission.`,
        fixHint: "Date of birth and admission date look swapped or mistyped.",
      });
    } else if (age < minAge || age > MAX_PLAUSIBLE_AGE) {
      add({
        code: "INVALID_DATE_OF_BIRTH",
        severity: "WARNING",
        field: "raw_date_of_birth",
        offendingValue: row.raw_date_of_birth,
        message: `Student is ${age} at admission, unusual for a ${program?.level.replace(/_/g, " ").toLowerCase() ?? "this"} program.`,
        fixHint: "Confirm the date of birth. The row will still be processed.",
        details: { age_at_admission: age, expected_min_age: minAge },
      });
    }
  }

  // --- Roll number -----------------------------------------------------------------------------
  if (!cleanRollNo(row.raw_roll_no)) missing("raw_roll_no", "Roll number", "Enter the institution's roll / enrolment number.");

  // --- Seat quota and category consistency ---------------------------------------------------
  const quota = parseQuota(row.raw_seat_quota_type);
  if (!quota.ok) {
    add({
      code: "INVALID_SEAT_QUOTA_TYPE",
      field: "raw_seat_quota_type",
      offendingValue: row.raw_seat_quota_type,
      message: `"${row.raw_seat_quota_type}" is not a recognised seat quota.`,
      fixHint: "Use REGULAR_SANCTIONED, NRI_QUOTA, SUPERNUMERARY_TFW, SUPERNUMERARY_EWS, SUPERNUMERARY_PMSSS, SUPERNUMERARY_FN_OCI_CIWGC or LATERAL_ENTRY.",
    });
  } else {
    // Blank quota means a regular sanctioned seat.
    resolved.quota = quota.value ?? "REGULAR_SANCTIONED";
  }

  const category = parseSocialCategory(row.raw_social_category);
  if (resolved.quota === "SUPERNUMERARY_EWS" && category.ok && category.value !== "EWS") {
    add({
      code: "INVALID_SEAT_QUOTA_TYPE",
      field: "raw_seat_quota_type",
      offendingValue: row.raw_seat_quota_type,
      message: `EWS supernumerary seat given to a student whose category is ${category.value ?? "not stated"}.`,
      fixHint: "Only EWS-category students can occupy EWS supernumerary seats. Correct the quota or the category.",
    });
  }

  // --- Non-resident documents -------------------------------------------------------------------
  if (effectiveResidency && NON_RESIDENT.includes(effectiveResidency)) {
    if (!cleanDocumentNo(row.raw_passport_no)) {
      add({
        code: "MISSING_PASSPORT_DETAILS",
        field: "raw_passport_no",
        offendingValue: null,
        message: `Passport number is required for ${effectiveResidency.replace(/_/g, " ")} students.`,
        fixHint: "Enter the passport number.",
      });
    }
    const expiry = parseDate(row.raw_passport_expiry);
    if (!expiry.ok) {
      add({
        code: "MISSING_PASSPORT_DETAILS",
        field: "raw_passport_expiry",
        offendingValue: null,
        message: "Passport expiry is not a valid date.",
        fixHint: "Use YYYY-MM-DD.",
      });
    } else if (expiry.value && admission.ok && admission.value && expiry.value < admission.value) {
      add({
        code: "MISSING_PASSPORT_DETAILS",
        severity: "WARNING",
        field: "raw_passport_expiry",
        offendingValue: null,
        message: "Passport had expired before the admission date.",
        fixHint: "Collect the student's renewed passport details.",
      });
    }

    const country = parseCountry(row.raw_nationality);
    const needsForeignCountry = ["OCI", "PIO", "FOREIGN_NATIONAL"].includes(effectiveResidency);
    if (!country.ok || (needsForeignCountry && !country.value)) {
      add({
        code: "MISSING_REQUIRED_FIELD",
        field: "raw_nationality",
        offendingValue: row.raw_nationality,
        message: country.ok ? "Nationality is required for this residency status." : `"${row.raw_nationality}" is not a recognised country.`,
        fixHint: "Enter the country of citizenship as a 2-letter ISO code (e.g. NP, US) or its English name.",
      });
    } else if (effectiveResidency === "FOREIGN_NATIONAL" && country.value === "IN") {
      add({
        code: "OCI_FN_STATUS_CONFLICT",
        field: "raw_nationality",
        offendingValue: row.raw_nationality,
        message: "A Foreign National cannot have Indian nationality.",
        fixHint: "Correct the residency status or the nationality.",
      });
    }

    if (
      effectiveResidency === "FOREIGN_NATIONAL" &&
      !row.raw_visa_type?.trim() &&
      !cleanDocumentNo(row.raw_frro_reg_no)
    ) {
      add({
        code: "MISSING_PASSPORT_DETAILS",
        field: "raw_visa_type",
        offendingValue: null,
        message: "Foreign Nationals need a visa type or an FRRO registration number.",
        fixHint: "Enter the student visa type or the FRRO registration number.",
      });
    }
    if (effectiveResidency === "OCI" && !cleanDocumentNo(row.raw_oci_card_no)) {
      add({
        code: "MISSING_OCI_DETAILS",
        field: "raw_oci_card_no",
        offendingValue: null,
        message: "OCI card number is required for OCI students.",
        fixHint: "Enter the OCI card number.",
      });
    }
    if (effectiveResidency === "CIWGC" && !row.raw_embassy_sponsor_ref?.trim()) {
      add({
        code: "MISSING_EMBASSY_SPONSORSHIP",
        field: "raw_embassy_sponsor_ref",
        offendingValue: null,
        message: "Embassy sponsorship reference is required for CIWGC students.",
        fixHint: "Enter the Indian embassy sponsorship letter reference.",
      });
    }
  }

  return {
    recordId: row.record_id,
    passed: !anomalies.some((a) => a.severity === "ERROR"),
    resolved,
    anomalies,
  };
}

/**
 * Same student or roll number twice in one upload. The first occurrence (by source row) is kept;
 * later ones are rejected and point back at it. Foreign Nationals without APAAR are matched on passport.
 */
export function findBatchDuplicates(rows: RawRecord[], results: Map<string, L1Result>): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const firstByStudent = new Map<string, RawRecord>();
  const firstByRoll = new Map<string, RawRecord>();

  for (const row of [...rows].sort((a, b) => a.source_row_number - b.source_row_number)) {
    const result = results.get(row.record_id)!;
    const passport = cleanDocumentNo(row.raw_passport_no);
    const studentKey = result.resolved.apaarId
      ? `apaar:${result.resolved.apaarId}`
      : result.resolved.residency === "FOREIGN_NATIONAL" && passport
        ? `passport:${passport}`
        : null;

    if (studentKey) {
      const first = firstByStudent.get(studentKey);
      if (first) {
        anomalies.push({
          recordId: row.record_id,
          code: "DUPLICATE_APAAR_IN_BATCH",
          severity: "ERROR",
          level: 1,
          field: studentKey.startsWith("apaar") ? "raw_apaar_id" : "raw_passport_no",
          offendingValue: studentKey.startsWith("apaar") ? row.raw_apaar_id : null,
          message: `Same student as row ${first.source_row_number} of this upload.`,
          fixHint: "Keep one row per student. A student can hold only one active enrolment.",
          details: { first_row: first.source_row_number },
        });
      } else {
        firstByStudent.set(studentKey, row);
      }
    }

    const roll = cleanRollNo(row.raw_roll_no);
    if (roll) {
      const first = firstByRoll.get(roll);
      if (first) {
        anomalies.push({
          recordId: row.record_id,
          code: "DUPLICATE_ROLL_NO_IN_BATCH",
          severity: "ERROR",
          level: 1,
          field: "raw_roll_no",
          offendingValue: row.raw_roll_no,
          message: `Roll number is also used in row ${first.source_row_number} of this upload.`,
          fixHint: "Each student needs a unique roll number.",
          details: { first_row: first.source_row_number },
        });
      } else {
        firstByRoll.set(roll, row);
      }
    }
  }
  return anomalies;
}
