import type { ReactNode } from 'react';

export type UserRole = 'institution' | 'aicte-admin' | 'verifier' | 'student';

export type AuthMode = 'login' | 'forgot-password' | 'reset-sent';

export interface AuthFormData {
  email: string;
  password: string;
}

export interface OrbitIcon {
  component: () => ReactNode;
  className: string;
  duration?: number;
  delay?: number;
  radius?: number;
  path?: boolean;
  reverse?: boolean;
}

export interface StudentRecord {
  id: string;
  apaarId: string;
  name: string;
  institution?: string;
  course?: string;
  program?: string;
  admissionYear: string;
  category: string;
  status?: 'Verified' | 'Flagged' | 'Pending';
  verificationStatus?: 'Verified' | 'Flagged' | 'Pending';
  flagReason?: string;
  dualEnrollmentStatus?: 'Clear' | 'Review Required' | 'Conflict Detected';
  abcLinked?: boolean;
  submissionDate?: string;
}

export interface IntakeData {
  branch?: string;
  department?: string;
  approvedIntake: number;
  actualEnrolment: number;
  supernumerary: number;
  nriOciFn: number;
  status?: string;
}
