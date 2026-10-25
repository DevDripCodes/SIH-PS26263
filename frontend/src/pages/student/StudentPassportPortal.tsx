import type { StudentRecord } from '@/types/apaar';
import { StudentHeader, DigitalIdCard } from './components';

interface StudentPassportPortalProps {
  student: StudentRecord;
}

export function StudentPassportPortal({ student }: StudentPassportPortalProps) {
  return (
    <div className='max-w-2xl mx-auto space-y-6'>
      {/* 1. Student Passport Header */}
      <StudentHeader />

      {/* 2. Plastic Digital ID Card with QR & Download */}
      <DigitalIdCard student={student} />
    </div>
  );
}
