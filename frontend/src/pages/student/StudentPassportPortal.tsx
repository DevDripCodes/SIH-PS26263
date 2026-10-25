import type { StudentRecord } from '@/types/apaar';
import { DigitalIdCard } from './DigitalIdCard';

interface StudentPassportPortalProps {
  student: StudentRecord;
}

export function StudentPassportPortal({ student }: StudentPassportPortalProps) {
  return (
    <div className='max-w-xl mx-auto space-y-6'>
      <div className='text-center space-y-1'>
        <h1 className='text-2xl font-bold text-neutral-900 dark:text-white'>
          Student Academic Identity Card
        </h1>
        <p className='text-xs text-neutral-500 dark:text-neutral-400'>
          National Academic Identity linked with APAAR ID and Academic Bank of Credits (ABC)
        </p>
      </div>

      <DigitalIdCard student={student} />
    </div>
  );
}
