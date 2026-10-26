import { describe, expect, it } from "vitest";
import { findBatchDuplicates, validateRow, type L1Result, type ProgramRef, type RawRecord } from "../../../src/modules/validation/l1-rules.js";
import { nameSimilarity } from "../../../src/modules/validation/name-match.js";
import { parseApaar, parseCountry, parseDate, parseQuota, parseResidency } from "../../../src/modules/validation/normalise.js";

const programs = new Map<string, ProgramRef>([["1-111", { programId: "p1", level: "UG_DEGREE", isActive: true }]]);
const TODAY = "2026-10-26";

let nextId = 1;
function row(overrides: Partial<RawRecord> = {}): RawRecord {
  const id = String(nextId++);
  return {
    record_id: id,
    source_row_number: Number(id) + 1,
    raw_apaar_id: "123456789012",
    raw_full_name: "Aarav Sharma",
    raw_date_of_birth: "2007-05-14",
    raw_gender: "Male",
    raw_roll_no: `R${id}`,
    raw_program_code: "1-111",
    raw_admission_date: "2026-08-01",
    raw_social_category: "GEN",
    raw_residency_status: "INDIAN_RESIDENT",
    raw_seat_quota_type: "REGULAR_SANCTIONED",
    raw_is_fn: "N",
    raw_is_oci_status: "N",
    raw_nationality: "Indian",
    raw_passport_no: null,
    raw_passport_expiry: null,
    raw_visa_type: null,
    raw_frro_reg_no: null,
    raw_oci_card_no: null,
    raw_embassy_sponsor_ref: null,
    ...overrides,
  };
}

const codes = (r: L1Result) => r.anomalies.map((a) => a.code);

describe("normalise", () => {
  it("parses APAAR IDs with separators and rejects scientific notation", () => {
    expect(parseApaar("1234 5678-9012")).toEqual({ ok: true, value: "123456789012" });
    expect(parseApaar("1.23457E+11").ok).toBe(false);
  });

  it("reads dates day-first and rejects impossible ones", () => {
    expect(parseDate("14/05/2007")).toEqual({ ok: true, value: "2007-05-14" });
    expect(parseDate("2007-05-14")).toEqual({ ok: true, value: "2007-05-14" });
    expect(parseDate("31/02/2007").ok).toBe(false);
  });

  it("maps common spellings of residency, quota and country", () => {
    expect(parseResidency("Foreign National")).toEqual({ ok: true, value: "FOREIGN_NATIONAL" });
    expect(parseQuota("tfw")).toEqual({ ok: true, value: "SUPERNUMERARY_TFW" });
    expect(parseCountry("Nepali")).toEqual({ ok: true, value: "NP" });
  });

  it("matches names regardless of word order", () => {
    expect(nameSimilarity("Sharma Aarav", "Aarav Sharma")).toBe(1);
    expect(nameSimilarity("Aarav Sharma", "Priya Nair")).toBeLessThan(0.5);
  });
});

describe("validateRow", () => {
  it("passes a complete Indian resident row and resolves it", () => {
    const result = validateRow(row(), programs, TODAY);
    expect(result.passed).toBe(true);
    expect(result.resolved).toEqual({
      apaarId: "123456789012",
      programId: "p1",
      residency: "INDIAN_RESIDENT",
      quota: "REGULAR_SANCTIONED",
      admissionDate: "2026-08-01",
    });
  });

  it("requires APAAR for residents but not for foreign nationals", () => {
    expect(codes(validateRow(row({ raw_apaar_id: "" }), programs, TODAY))).toContain("MISSING_APAAR_ID");
    const fn = validateRow(
      row({
        raw_apaar_id: "",
        raw_residency_status: "FN",
        raw_is_fn: "Y",
        raw_nationality: "NP",
        raw_passport_no: "P1234567",
        raw_visa_type: "Student",
        raw_seat_quota_type: "FN_OCI_CIWGC",
      }),
      programs,
      TODAY,
    );
    expect(fn.passed).toBe(true);
  });

  it("flags OCI / FN conflicts and missing documents", () => {
    expect(codes(validateRow(row({ raw_is_fn: "Y", raw_is_oci_status: "Y" }), programs, TODAY))).toContain(
      "OCI_FN_STATUS_CONFLICT",
    );
    const oci = validateRow(row({ raw_residency_status: "OCI", raw_nationality: "US", raw_passport_no: "X1" }), programs, TODAY);
    expect(codes(oci)).toContain("MISSING_OCI_DETAILS");
  });

  it("rejects unknown programs and EWS seats for non-EWS students", () => {
    expect(codes(validateRow(row({ raw_program_code: "9-999" }), programs, TODAY))).toContain("UNKNOWN_PROGRAM");
    expect(codes(validateRow(row({ raw_seat_quota_type: "EWS" }), programs, TODAY))).toContain("INVALID_SEAT_QUOTA_TYPE");
  });

  it("warns, but does not reject, on an unusual age for the program", () => {
    const result = validateRow(row({ raw_date_of_birth: "2013-01-01" }), programs, TODAY);
    expect(result.passed).toBe(true);
    expect(result.anomalies[0]).toMatchObject({ code: "INVALID_DATE_OF_BIRTH", severity: "WARNING" });
  });
});

describe("findBatchDuplicates", () => {
  it("keeps the first occurrence and rejects later APAAR and roll number repeats", () => {
    const rows = [row({ raw_roll_no: "A" }), row({ raw_roll_no: "B" }), row({ raw_apaar_id: "999999999999", raw_roll_no: "a" })];
    const results = new Map(rows.map((r) => [r.record_id, validateRow(r, programs, TODAY)]));
    const dups = findBatchDuplicates(rows, results);
    expect(dups.map((d) => [d.recordId, d.code])).toEqual([
      [rows[1]!.record_id, "DUPLICATE_APAAR_IN_BATCH"],
      [rows[2]!.record_id, "DUPLICATE_ROLL_NO_IN_BATCH"],
    ]);
  });
});
