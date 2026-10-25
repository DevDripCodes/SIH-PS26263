import type { IntakeData, StudentRecord } from '@/types/apaar';

export const mockIntakeData: IntakeData[] = [
  { branch: 'Computer Science & Engineering', approvedIntake: 180, actualEnrolment: 178, supernumerary: 18, nriOciFn: 12 },
  { branch: 'Artificial Intelligence & Data Science', approvedIntake: 60, actualEnrolment: 60, supernumerary: 6, nriOciFn: 4 },
  { branch: 'Electronics & Communication Eng.', approvedIntake: 120, actualEnrolment: 114, supernumerary: 12, nriOciFn: 6 },
  { branch: 'Mechanical Engineering', approvedIntake: 60, actualEnrolment: 48, supernumerary: 4, nriOciFn: 0 },
  { branch: 'MBA - Business Analytics', approvedIntake: 60, actualEnrolment: 62, supernumerary: 6, nriOciFn: 5 }, // Anomaly: 62 > 60
];

export const mockStudents: StudentRecord[] = [
  {
    id: 'STU-001',
    apaarId: '9420-1845-6712',
    name: 'Aarav Sharma',
    institution: 'Delhi Technological University',
    course: 'Computer Science & Engineering',
    admissionYear: '2026',
    category: 'Regular',
    status: 'Verified',
  },
  {
    id: 'STU-002',
    apaarId: '8114-2290-4431',
    name: 'Priya Sundaram',
    institution: 'Delhi Technological University',
    course: 'Computer Science & Engineering',
    admissionYear: '2026',
    category: 'Supernumerary (EWS/TFW)',
    status: 'Verified',
  },
  {
    id: 'STU-003',
    apaarId: '7729-1004-9823',
    name: 'Rohan Mehta',
    institution: 'Delhi Technological University',
    course: 'MBA - Business Analytics',
    admissionYear: '2026',
    category: 'Regular',
    status: 'Flagged',
    flagReason: 'Intake Ceiling Exceeded (Seat #61 of 60 Approved)',
  },
  {
    id: 'STU-004',
    apaarId: '6338-9120-1104',
    name: 'Kavya Nair',
    institution: 'Delhi Technological University',
    course: 'Electronics & Communication Eng.',
    admissionYear: '2026',
    category: 'NRI',
    status: 'Verified',
  },
  {
    id: 'STU-005',
    apaarId: '5512-8801-4478',
    name: 'Zaid Al-Mansoor',
    institution: 'Delhi Technological University',
    course: 'Artificial Intelligence & Data Science',
    admissionYear: '2026',
    category: 'Foreign National (FN)',
    status: 'Verified',
  },
  {
    id: 'STU-006',
    apaarId: '9420-1845-6712', // Duplicate APAAR anomaly
    name: 'Aarav Sharma (Duplicate Claim)',
    institution: 'National Institute of Tech, Kurukshetra',
    course: 'Computer Science & Engineering',
    admissionYear: '2026',
    category: 'Regular',
    status: 'Flagged',
    flagReason: 'Dual Enrolment Detected across DTU and NIT Kurukshetra',
  },
];
