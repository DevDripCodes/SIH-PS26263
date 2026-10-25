interface NationalStatsGridProps {
  totalFlagged: number;
}

export function NationalStatsGrid({ totalFlagged }: NationalStatsGridProps) {
  return (
    <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
      <div className='bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm'>
        <p className='text-xs font-medium text-neutral-500 uppercase'>Approved Institutions</p>
        <p className='text-2xl font-bold mt-2 text-neutral-900 dark:text-white'>9,420</p>
        <p className='text-xs text-emerald-600 dark:text-emerald-400 mt-1'>98.4% reporting online</p>
      </div>

      <div className='bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm'>
        <p className='text-xs font-medium text-neutral-500 uppercase'>Total Sanctioned Intake</p>
        <p className='text-2xl font-bold mt-2 text-neutral-900 dark:text-white'>3,450,000</p>
        <p className='text-xs text-neutral-500 mt-1'>Across all disciplines</p>
      </div>

      <div className='bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm'>
        <p className='text-xs font-medium text-neutral-500 uppercase'>Registered APAAR IDs</p>
        <p className='text-2xl font-bold mt-2 text-blue-600 dark:text-blue-400'>3,180,450</p>
        <p className='text-xs text-neutral-500 mt-1'>Verified student credentials</p>
      </div>

      <div className='bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-sm'>
        <p className='text-xs font-medium text-neutral-500 uppercase'>Flagged Anomalies</p>
        <p className='text-2xl font-bold mt-2 text-red-600'>{totalFlagged}</p>
        <p className='text-xs text-red-500 mt-1'>Requires regulatory notice</p>
      </div>
    </div>
  );
}
