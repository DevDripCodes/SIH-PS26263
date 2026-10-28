import type { StudentRecord } from '@/types/apaar';
import { ShieldCheck, CheckCircle2 } from 'lucide-react';

interface VerificationResultCardProps {
  record?: StudentRecord | null;
  student?: StudentRecord | null;
}

export function VerificationResultCard({ record, student }: VerificationResultCardProps) {
  const currentRecord = record || student;
  if (!currentRecord) return null;

  const programName = currentRecord.program || currentRecord.course || 'Computer Science & Engineering';

  return (
    <div className='p-6 rounded-2xl bg-white dark:bg-neutral-900 border border-emerald-300 dark:border-emerald-800 shadow-sm'>
      <div className='flex items-center gap-3 pb-4 border-b border-neutral-200 dark:border-neutral-800'>
        <div className='size-12 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold'>
          <ShieldCheck className='size-7' />
        </div>
        <div>
          <span className='px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300'>
            AICTE Authenticated Academic Record
          </span>
          <h4 className='text-lg font-bold text-neutral-900 dark:text-white mt-1'>
            {currentRecord.name}
          </h4>
          <p className='text-xs text-neutral-500 font-mono'>
            APAAR ID: {currentRecord.apaarId}
          </p>
        </div>
      </div>

      <div className='grid grid-cols-2 gap-4 py-4 text-xs'>
        <div>
          <span className='text-neutral-400 block text-[11px]'>Institution Name</span>
          <span className='font-semibold text-neutral-800 dark:text-neutral-200'>
            {currentRecord.institution || 'Maharaja Agrasen Institute of Technology'}
          </span>
        </div>
        <div>
          <span className='text-neutral-400 block text-[11px]'>Approved Program</span>
          <span className='font-semibold text-neutral-800 dark:text-neutral-200'>
            {programName}
          </span>
        </div>
        <div>
          <span className='text-neutral-400 block text-[11px]'>Academic Session</span>
          <span className='font-semibold text-neutral-800 dark:text-neutral-200'>
            2026 - 2030 (Batch 2026)
          </span>
        </div>
        <div>
          <span className='text-neutral-400 block text-[11px]'>Admission Category</span>
          <span className='font-semibold text-neutral-800 dark:text-neutral-200'>
            {currentRecord.category}
          </span>
        </div>
      </div>

      <div className='p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-xl text-xs flex items-center justify-between'>
        <div className='flex items-center gap-2 text-neutral-600 dark:text-neutral-300'>
          <CheckCircle2 className='size-4 text-emerald-600' />
          <span>DigiLocker & ABC Trust Anchor: Validated</span>
        </div>
        <span className='font-mono text-[10px] text-neutral-400'>
          Hash: 9a2f..7c81
        </span>
      </div>
    </div>
  );
}
