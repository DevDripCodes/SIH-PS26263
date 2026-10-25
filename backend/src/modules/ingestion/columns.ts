// Canonical upload fields -> staging.staging_enrolment_records.raw_* columns.
// Header matching is case/space/punctuation-insensitive; anything unmapped goes to raw_payload.

export const FIELDS = [
  "apaar_id",
  "full_name",
  "date_of_birth",
  "gender",
  "email",
  "mobile",
  "roll_no",
  "program_code",
  "admission_date",
  "social_category",
  "residency_status",
  "seat_quota_type",
  "is_fn",
  "is_oci_status",
  "nationality",
  "passport_no",
  "passport_expiry",
  "visa_type",
  "frro_reg_no",
  "oci_card_no",
  "embassy_sponsor_ref",
] as const;

export type Field = (typeof FIELDS)[number];

export const REQUIRED_FIELDS: readonly Field[] = [
  "apaar_id",
  "full_name",
  "date_of_birth",
  "roll_no",
  "program_code",
  "admission_date",
];

const ALIASES: Record<string, Field> = {
  apaar: "apaar_id",
  apaar_no: "apaar_id",
  apaar_number: "apaar_id",
  apaar_id_no: "apaar_id",
  abc_id: "apaar_id",
  name: "full_name",
  student_name: "full_name",
  candidate_name: "full_name",
  dob: "date_of_birth",
  birth_date: "date_of_birth",
  sex: "gender",
  email_id: "email",
  email_address: "email",
  mobile_no: "mobile",
  mobile_number: "mobile",
  phone: "mobile",
  phone_no: "mobile",
  roll_number: "roll_no",
  enrollment_no: "roll_no",
  enrolment_no: "roll_no",
  registration_no: "roll_no",
  course_code: "program_code",
  aicte_course_id: "program_code",
  program_id: "program_code",
  doa: "admission_date",
  date_of_admission: "admission_date",
  category: "social_category",
  caste_category: "social_category",
  residency: "residency_status",
  quota: "seat_quota_type",
  quota_type: "seat_quota_type",
  seat_type: "seat_quota_type",
  foreign_national: "is_fn",
  is_foreign_national: "is_fn",
  oci: "is_oci_status",
  is_oci: "is_oci_status",
  passport_number: "passport_no",
  visa: "visa_type",
  frro_no: "frro_reg_no",
  oci_card_number: "oci_card_no",
  embassy_ref: "embassy_sponsor_ref",
};

export function normaliseHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function resolveField(header: string): Field | undefined {
  const key = normaliseHeader(header);
  if ((FIELDS as readonly string[]).includes(key)) return key as Field;
  return ALIASES[key];
}

export interface ColumnMapping {
  /** source header -> canonical field */
  mapped: Record<string, Field>;
  /** headers that will be kept in raw_payload */
  unmapped: string[];
  missingRequired: Field[];
  /** canonical fields claimed by more than one header (first one wins) */
  duplicates: Field[];
}

export function buildMapping(headers: string[]): ColumnMapping {
  const mapped: Record<string, Field> = {};
  const unmapped: string[] = [];
  const seen = new Set<Field>();
  const duplicates = new Set<Field>();

  for (const header of headers) {
    const field = resolveField(header);
    if (!field) {
      if (header.trim()) unmapped.push(header);
    } else if (seen.has(field)) {
      duplicates.add(field);
      unmapped.push(header);
    } else {
      seen.add(field);
      mapped[header] = field;
    }
  }

  return {
    mapped,
    unmapped,
    missingRequired: REQUIRED_FIELDS.filter((f) => !seen.has(f)),
    duplicates: [...duplicates],
  };
}

export type CanonicalRow = Partial<Record<Field, string>> & { extra?: Record<string, string> };

export function applyMapping(row: Record<string, string>, mapping: ColumnMapping): CanonicalRow {
  const out: CanonicalRow = {};
  const extra: Record<string, string> = {};
  for (const [header, value] of Object.entries(row)) {
    const field = mapping.mapped[header];
    if (field) out[field] = value;
    else if (value !== "" && header.trim()) extra[header] = value;
  }
  if (Object.keys(extra).length) out.extra = extra;
  return out;
}
