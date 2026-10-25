import { ShieldCheck, Download } from 'lucide-react';

export function AdminHeader() {
  return (
    <div className='relative overflow-hidden bg-white dark:bg-neutral-900 rounded-2xl p-6 border border-neutral-200/90 dark:border-neutral-800 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4'>
      <div className='absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500' />
      <div>
        <span className='inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 mb-2'>
          <ShieldCheck className='size-3 text-amber-600 dark:text-amber-400' />
          National Regulatory Authority • Live Anomaly Detection
        </span>
        <h1 className='text-2xl font-bold tracking-tight text-neutral-900 dark:text-white'>
          AICTE Central Monitoring Command
        </h1>
        <p className='text-sm text-neutral-500 dark:text-neutral-400 mt-1'>
          Pan-India Student Academic Registry & Enrolment Discrepancy Sentinel
        </p>
      </div>

      <div className='flex items-center gap-2'>
        <button
          type='button'
          onClick={() => alert('Generating National AICTE Accreditation & Enrolment Report...')}
          className='bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 cursor-pointer shadow-sm'
        >
          <Download className='size-4' />
          Export National Audit Report
        </button>
      </div>
    </div>
  );
}
