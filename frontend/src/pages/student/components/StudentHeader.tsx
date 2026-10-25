import { IdCard } from 'lucide-react';

export function StudentHeader() {
  return (
    <div className='text-center space-y-2 mb-6'>
      <div className='size-12 mx-auto rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-200 dark:border-blue-800'>
        <IdCard className='size-6' />
      </div>
      <h1 className='text-2xl font-bold text-neutral-900 dark:text-white'>
        My National Academic Identity (APAAR Passport)
      </h1>
      <p className='text-xs text-neutral-500 dark:text-neutral-400 max-w-md mx-auto leading-relaxed'>
        Your lifetime universal student identification recognized across all AICTE, UGC, and CBSE academic bodies.
      </p>
    </div>
  );
}
