import { Building2, Users, AlertTriangle, ShieldCheck } from 'lucide-react';

interface NationalStatsGridProps {
  totalFlagged?: number;
}

export function NationalStatsGrid({ totalFlagged = 14 }: NationalStatsGridProps) {
  return (
    <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'>
      <div className='p-5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm'>
        <div className='flex items-center justify-between text-neutral-500'>
          <span className='text-xs font-medium uppercase tracking-wider'>AICTE Approved Colleges</span>
          <Building2 className='size-4 text-blue-500' />
        </div>
        <p className='text-2xl font-bold mt-2 font-mono text-neutral-950 dark:text-white'>8,942</p>
        <span className='inline-block text-[11px] text-emerald-600 font-medium mt-1'>
          Across 28 States & 8 UTs
        </span>
      </div>

      <div className='p-5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm'>
        <div className='flex items-center justify-between text-neutral-500'>
          <span className='text-xs font-medium uppercase tracking-wider'>APAAR IDs Verified</span>
          <Users className='size-4 text-indigo-500' />
        </div>
        <p className='text-2xl font-bold mt-2 font-mono text-blue-600 dark:text-blue-400'>2.84M</p>
        <span className='inline-block text-[11px] text-emerald-600 font-medium mt-1'>
          94.2% Aadhaar-seeded
        </span>
      </div>

      <div className='p-5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm'>
        <div className='flex items-center justify-between text-neutral-500'>
          <span className='text-xs font-medium uppercase tracking-wider'>Ceiling Breaches Flagged</span>
          <AlertTriangle className='size-4 text-rose-500' />
        </div>
        <p className='text-2xl font-bold mt-2 font-mono text-rose-600 dark:text-rose-400'>{totalFlagged}</p>
        <span className='inline-block text-[11px] text-rose-600 font-medium mt-1'>
          Notice issued automatically
        </span>
      </div>

      <div className='p-5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm'>
        <div className='flex items-center justify-between text-neutral-500'>
          <span className='text-xs font-medium uppercase tracking-wider'>Integrity Index</span>
          <ShieldCheck className='size-4 text-emerald-500' />
        </div>
        <p className='text-2xl font-bold mt-2 font-mono text-emerald-600 dark:text-emerald-400'>99.98%</p>
        <span className='inline-block text-[11px] text-neutral-500 mt-1'>
          Zero dual admissions detected
        </span>
      </div>
    </div>
  );
}
