import { useState } from 'react';
import { Upload, RefreshCw, FileCheck, Download, CheckCircle2 } from 'lucide-react';

interface BulkUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BulkUploadModal({ isOpen, onClose }: BulkUploadModalProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSimulateBulkUpload = () => {
    setIsUploading(true);
    setTimeout(() => {
      setIsUploading(false);
      setUploadSuccess(true);
      setTimeout(() => {
        setUploadSuccess(false);
        onClose();
      }, 2500);
    }, 1500);
  };

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4'>
      <div className='bg-white dark:bg-neutral-900 rounded-3xl max-w-lg w-full p-6 border border-neutral-200 dark:border-neutral-800 shadow-2xl space-y-4'>
        <div className='flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-3'>
          <div className='flex items-center gap-2'>
            <Upload className='size-5 text-blue-600' />
            <h3 className='font-bold text-base text-neutral-900 dark:text-white'>
              Bulk Upload Student Enrolment
            </h3>
          </div>
          <button
            onClick={onClose}
            className='text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-pointer'
          >
            ✕
          </button>
        </div>

        <div className='space-y-4 text-center'>
          <p className='text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed text-left'>
            Submit student admission data in AICTE standard CSV/Excel format. The platform automatically verifies 12-digit APAAR IDs, validates approved intake limits, and checks for cross-institution duplicate admissions.
          </p>

          <div className='border-2 border-dashed border-neutral-300 dark:border-neutral-700 rounded-2xl p-6 hover:border-blue-500 transition cursor-pointer'>
            <p className='text-xs text-neutral-600 dark:text-neutral-300 font-medium'>
              Drag and drop your <span className='font-bold text-blue-600'>.CSV or .XLSX</span> file here
            </p>
            <p className='text-[11px] text-neutral-400 mt-1'>
              Maximum file size 25MB • Up to 5,000 records per batch
            </p>
          </div>

          <div className='flex items-center justify-end gap-2 pt-2'>
            <button
              type='button'
              onClick={() => alert('Downloaded sample AICTE APAAR template (.csv)')}
              className='px-3.5 py-2 border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 rounded-xl text-xs font-medium transition flex items-center gap-1.5 cursor-pointer text-neutral-800 dark:text-neutral-200'
            >
              <Download className='size-3.5' />
              Sample Template
            </button>
            <button
              onClick={handleSimulateBulkUpload}
              disabled={isUploading}
              className='bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50'
            >
              {isUploading ? (
                <>
                  <RefreshCw className='size-4 animate-spin' />
                  Validating...
                </>
              ) : (
                <>
                  <FileCheck className='size-4' />
                  Validate & Upload
                </>
              )}
            </button>
          </div>

          {uploadSuccess && (
            <div className='p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs flex items-center justify-center gap-2 animate-fade-in'>
              <CheckCircle2 className='size-4' />
              240 Student Records Validated & Synced with AICTE Central Database!
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
