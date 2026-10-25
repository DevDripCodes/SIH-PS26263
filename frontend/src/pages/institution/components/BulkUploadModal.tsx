import { X, Upload, FileText, CheckCircle2 } from 'lucide-react';

interface BulkUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BulkUploadModal({ isOpen, onClose }: BulkUploadModalProps) {
  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs'>
      <div className='bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative'>
        <button
          onClick={onClose}
          className='absolute top-5 right-5 text-neutral-400 hover:text-neutral-700 dark:hover:text-white transition'
        >
          <X className='size-5' />
        </button>

        <h3 className='text-lg font-bold text-neutral-900 dark:text-white mb-1'>
          AICTE Intake Verified Bulk Import
        </h3>
        <p className='text-xs text-neutral-500 dark:text-neutral-400 mb-5'>
          Upload formatted CSV/Excel records containing student APAAR IDs for batch validation.
        </p>

        <div className='border-2 border-dashed border-neutral-300 dark:border-neutral-700 rounded-xl p-8 text-center bg-neutral-50 dark:bg-neutral-800/40 hover:bg-neutral-100/50 dark:hover:bg-neutral-800/80 transition cursor-pointer'>
          <Upload className='size-10 text-blue-500 mx-auto mb-3' />
          <p className='text-sm font-semibold text-neutral-800 dark:text-neutral-200'>
            Drag and drop your roster file here
          </p>
          <p className='text-xs text-neutral-500 mt-1'>
            Supports .CSV, .XLSX up to 25MB (Max 5,000 students per batch)
          </p>
          <div className='mt-4 flex justify-center gap-2'>
            <button
              type='button'
              className='px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm'
            >
              Select File from Computer
            </button>
          </div>
        </div>

        <div className='mt-4 p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800/60 rounded-xl text-xs flex items-center justify-between'>
          <div className='flex items-center gap-2 text-blue-800 dark:text-blue-300'>
            <FileText className='size-4 text-blue-600' />
            <span>AICTE-APAAR-Standard-Template-v2.csv</span>
          </div>
          <button
            type='button'
            className='text-blue-600 dark:text-blue-400 font-semibold hover:underline flex items-center gap-1'
          >
            Download
          </button>
        </div>

        <div className='mt-5 flex items-center justify-between text-xs text-neutral-500'>
          <span className='flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium'>
            <CheckCircle2 className='size-3.5' /> Auto API Schema validation active
          </span>
          <button
            onClick={onClose}
            className='px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 transition'
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
