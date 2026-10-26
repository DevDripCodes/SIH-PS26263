import type { Batch } from '@/features/upload/types';

export type RecordStatus = 'PENDING' | 'L1_PASSED' | 'L2_VERIFIED' | 'REJECTED' | 'QUARANTINED' | 'VALID';
export type Severity = 'ERROR' | 'WARNING';

export interface AnomalyGroup {
  code: string;
  severity: Severity;
  level: 1 | 2 | 3;
  field: string | null;
  count: number;
}

export interface ValidationReport {
  batch: Batch;
  records: Partial<Record<RecordStatus, number>>;
  anomalies: AnomalyGroup[];
  /** Name of the APAAR registry used for L2; "not-configured" until DigiLocker is connected. */
  apaarRegistry: string;
}

export interface AnomalyItem {
  anomalyId: string;
  sourceRowNumber: number;
  recordStatus: RecordStatus;
  apaarId: string | null; // masked
  fullName: string | null;
  rollNo: string | null;
  programCode: string | null;
  code: string;
  severity: Severity;
  level: 1 | 2 | 3;
  field: string | null;
  offendingValue: string | null;
  message: string;
  fixHint: string | null;
  details: Record<string, unknown>;
  isResolved: boolean;
}

export interface AnomalyPage {
  total: number;
  page: number;
  pageSize: number;
  items: AnomalyItem[];
}

export interface AnomalyFilter {
  severity?: Severity;
  level?: number;
  code?: string;
  page: number;
}

export interface PromotionForecast {
  willPromote: number;
  alreadyEnrolled: number;
  willQuarantine: number;
  byCode: Record<string, number>;
  rows: { sourceRowNumber: number; code: string; message: string; fixHint: string | null; details: Record<string, unknown> }[];
}
