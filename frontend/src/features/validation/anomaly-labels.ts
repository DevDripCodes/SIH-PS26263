// Short labels for staging.anomaly_code_enum, shown on chips and in tables.
const LABELS: Record<string, string> = {
  MISSING_REQUIRED_FIELD: 'Missing / unreadable field',
  MISSING_APAAR_ID: 'Missing APAAR ID',
  INVALID_APAAR_FORMAT: 'Invalid APAAR format',
  INVALID_DATE_OF_BIRTH: 'Date of birth problem',
  INVALID_RESIDENCY_STATUS: 'Invalid residency status',
  INVALID_SEAT_QUOTA_TYPE: 'Invalid seat quota',
  OCI_FN_STATUS_CONFLICT: 'OCI / FN status conflict',
  MISSING_PASSPORT_DETAILS: 'Passport / visa details',
  MISSING_OCI_DETAILS: 'Missing OCI card',
  MISSING_EMBASSY_SPONSORSHIP: 'Missing embassy sponsorship',
  DUPLICATE_APAAR_IN_BATCH: 'Duplicate student in upload',
  DUPLICATE_ROLL_NO_IN_BATCH: 'Duplicate roll no. in upload',
  UNKNOWN_PROGRAM: 'Unknown program',
  PROGRAM_NOT_APPROVED_FOR_YEAR: 'Program not approved this year',
  APAAR_NOT_FOUND: 'APAAR not found',
  APAAR_INACTIVE: 'APAAR inactive',
  APAAR_DEMOGRAPHIC_MISMATCH: 'Identity mismatch',
  ABC_VERIFICATION_UNAVAILABLE: 'APAAR registry unavailable',
  EXCEEDS_SANCTIONED_INTAKE: 'Exceeds approved intake',
  EXCEEDS_NRI_QUOTA: 'Exceeds NRI seats',
  EXCEEDS_SUPERNUMERARY_TFW: 'Exceeds TFW seats',
  EXCEEDS_SUPERNUMERARY_FN_OCI_CIWGC: 'Exceeds FN/OCI/CIWGC seats',
  EXCEEDS_SUPERNUMERARY_PMSSS: 'Exceeds PMSSS seats',
  EXCEEDS_SUPERNUMERARY_EWS: 'Exceeds EWS seats',
  EXCEEDS_LATERAL_ENTRY_INTAKE: 'Exceeds lateral entry seats',
  CROSS_INSTITUTION_DUPLICATE_ENROLMENT: 'Enrolled at another institution',
  ADMISSION_AFTER_CUTOFF: 'Admitted after cut-off',
  PROGRAM_LOCKED_BY_AICTE: 'Program locked by AICTE',
  DUPLICATE_ROLL_NO_IN_PROGRAM: 'Roll no. already in use',
  QUOTA_RESIDENCY_MISMATCH: 'Quota not open to residency',
};

export function anomalyLabel(code: string): string {
  return LABELS[code] ?? code.replace(/_/g, ' ').toLowerCase();
}

export const LEVEL_LABEL: Record<number, string> = {
  1: 'Format & consistency',
  2: 'Identity',
  3: 'Seats & national lock',
};
