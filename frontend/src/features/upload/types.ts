// Mirrors backend/src/modules/ingestion/columns.ts — keep the two field lists in sync.
export const FIELDS = [
  'apaar_id',
  'full_name',
  'date_of_birth',
  'gender',
  'email',
  'mobile',
  'roll_no',
  'program_code',
  'admission_date',
  'social_category',
  'residency_status',
  'seat_quota_type',
  'is_fn',
  'is_oci_status',
  'nationality',
  'passport_no',
  'passport_expiry',
  'visa_type',
  'frro_reg_no',
  'oci_card_no',
  'embassy_sponsor_ref',
] as const;

export type Field = (typeof FIELDS)[number];

export const FIELD_LABELS: Record<Field, string> = {
  apaar_id: 'APAAR ID',
  full_name: 'Full name',
  date_of_birth: 'Date of birth',
  gender: 'Gender',
  email: 'Email',
  mobile: 'Mobile',
  roll_no: 'Roll / enrolment no.',
  program_code: 'Program code (AICTE course ID)',
  admission_date: 'Admission date',
  social_category: 'Social category',
  residency_status: 'Residency status',
  seat_quota_type: 'Seat quota',
  is_fn: 'Foreign national',
  is_oci_status: 'OCI',
  nationality: 'Nationality',
  passport_no: 'Passport no.',
  passport_expiry: 'Passport expiry',
  visa_type: 'Visa type',
  frro_reg_no: 'FRRO registration no.',
  oci_card_no: 'OCI card no.',
  embassy_sponsor_ref: 'Embassy sponsorship ref.',
};

export type StudentRow = Partial<Record<Field, string>>;

export interface ColumnMapping {
  mapped: Record<string, Field>;
  unmapped: string[];
  missingRequired: Field[];
  duplicates: Field[];
}

export interface FilePreview {
  kind: 'csv' | 'excel';
  totalRows: number;
  headers: string[];
  mapping: ColumnMapping;
  sample: (StudentRow & { extra?: Record<string, string> })[];
}

export type BatchStatus =
  | 'UPLOADED'
  | 'L1_PROCESSING'
  | 'L1_COMPLETED'
  | 'L2_PROCESSING'
  | 'L2_COMPLETED'
  | 'L3_PROCESSING'
  | 'COMPLETED'
  | 'COMPLETED_WITH_ANOMALIES'
  | 'FAILED'
  | 'CANCELLED';

export interface Batch {
  batchId: string;
  status: BatchStatus;
  sourceChannel: 'CSV_UPLOAD' | 'EXCEL_UPLOAD' | 'WEB_FORM' | 'ERP_API';
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

export interface Institution {
  institutionId: string;
  name: string;
  aictePermanentId: string;
  region: string;
}

/** Where a batch is going: chosen once in the panel and shared by every ingestion method. */
export interface BatchScope {
  institutionId: string;
  academicYear: string;
}
