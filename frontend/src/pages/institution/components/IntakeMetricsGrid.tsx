import type { IntakeData } from '@/types/apaar';
import { Building2, Users, FileCheck, Globe2 } from 'lucide-react';

interface IntakeMetricsGridProps {
  intakeData: IntakeData[];
}

export function IntakeMetricsGrid({ intakeData }: IntakeMetricsGridProps) {
  const totalApproved = intakeData.reduce((acc, curr) => acc + curr.approvedIntake, 0);
  const totalEnrolled = intakeData.reduce((acc, curr) => acc + curr.actualEnrolment, 0);
  const totalSupernumerary = intakeData.reduce((acc, curr) => acc + curr.supernumerary, 0);
  const totalNriOci = intakeData.reduce((acc, curr) => acc + curr.nriOciFn, 0);

  return (
    <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'>
      <div className='p-5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm'>
        <div className='flex items-center justify-between text-neutral-500'>
          <span className='text-xs font-medium uppercase tracking-wider'>Sanctioned Intake</span>
          <Building2 className='size-4 text-blue-500' />
        </div>
        <p className='text-2xl font-bold mt-2 font-mono text-neutral-950 dark:text-white'>
          {totalApproved}
        </p>
        <span className='inline-block text-[11px] text-emerald-600 font-medium mt-1'>
          AICTE Approved Cap
        </span>
      </div>

      <div className='p-5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm'>
        <div className='flex items-center justify-between text-neutral-500'>
          <span className='text-xs font-medium uppercase tracking-wider'>Admitted with APAAR</span>
          <Users className='size-4 text-indigo-500' />
        </div>
        <p className='text-2xl font-bold mt-2 font-mono text-blue-600 dark:text-blue-400'>
          {totalEnrolled}
        </p>
        <span className='inline-block text-[11px] text-neutral-500 mt-1'>
          {totalApproved > 0 ? Math.round((totalEnrolled / totalApproved) * 100) : 0}% Capacity Filled
        </span>
      </div>

      <div className='p-5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm'>
        <div className='flex items-center justify-between text-neutral-500'>
          <span className='text-xs font-medium uppercase tracking-wider'>Supernumerary (EWS/TFWS)</span>
          <FileCheck className='size-4 text-emerald-500' />
        </div>
        <p className='text-2xl font-bold mt-2 font-mono text-neutral-950 dark:text-white'>
          {totalSupernumerary}
        </p>
        <span className='inline-block text-[11px] text-emerald-600 font-medium mt-1'>
          Within 10% ceiling limit
        </span>
      </div>

      <div className='p-5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm'>
        <div className='flex items-center justify-between text-neutral-500'>
          <span className='text-xs font-medium uppercase tracking-wider'>NRI / OCI / Foreign</span>
          <Globe2 className='size-4 text-amber-500' />
        </div>
        <p className='text-2xl font-bold mt-2 font-mono text-neutral-950 dark:text-white'>
          {totalNriOci}
        </p>
        <span className='inline-block text-[11px] text-neutral-500 mt-1'>
          Govt. Quota Verified
        </span>
      </div>
    </div>
  );
}
