import { Sparkles, UserPlus, Upload } from 'lucide-react';

interface InstitutionHeaderProps {
  onOpenAddModal: () => void;
  onOpenUploadModal: () => void;
}

export function InstitutionHeader({
  onOpenAddModal,
  onOpenUploadModal,
}: InstitutionHeaderProps) {
  return (
    <div className='relative overflow-hidden bg-white dark:bg-neutral-900 rounded-2xl p-6 border border-neutral-200/90 dark:border-neutral-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4'>
      <div className='absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500' />
      <div>
        <span className='inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 mb-2'>
          <Sparkles className='size-3 text-amber-500' />
          Academic Year 2026-2027 • Approved Intake Verification
        </span>
        <h2 className='text-2xl font-bold tracking-tight text-neutral-950 dark:text-white'>
          Maharaja Agrasen Institute of Technology (MAIT)
        </h2>
        <p className='text-xs text-neutral-500 dark:text-neutral-400 mt-1'>
          Institution Portal • New Delhi
        </p>
      </div>

      <div className='flex items-center gap-2'>
        <button
          onClick={onOpenAddModal}
          className='flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-md shadow-blue-500/20 transition cursor-pointer'
        >
          <UserPlus className='size-4' />
          Add Single Student
        </button>
        <button
          onClick={onOpenUploadModal}
          className='flex items-center gap-2 px-4 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 text-xs font-semibold transition cursor-pointer'
        >
          <Upload className='size-4' />
          Bulk CSV Upload
        </button>
      </div>
    </div>
  );
}
