import { useState } from 'react';
import type { IntakeData, StudentRecord } from '@/types/apaar';
import { RefreshCw, Download, CheckCircle2, Upload } from 'lucide-react';
import {
  InstitutionHeader,
  IntakeMetricsGrid,
  IntakeSummaryTable,
  StudentDirectoryTable,
  AddStudentModal,
  BulkUploadModal,
} from './components';

interface InstitutionPortalProps {
  intakeData: IntakeData[];
  students: StudentRecord[];
  onAddStudent?: (student: StudentRecord) => void;
}

export function InstitutionPortal({
  intakeData,
  students,
  onAddStudent,
}: InstitutionPortalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'students' | 'upload'>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const handleSimulateBulkUpload = () => {
    setIsUploading(true);
    setTimeout(() => {
      setIsUploading(false);
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 4000);
    }, 1500);
  };

  const handleAddNewStudent = (newRecord: StudentRecord) => {
    if (onAddStudent) {
      onAddStudent(newRecord);
    }
  };

  return (
    <div className='space-y-6'>
      {/* 1. Institution Header Banner */}
      <InstitutionHeader
        onOpenAddModal={() => setIsAddModalOpen(true)}
        onOpenUploadModal={() => setIsUploadModalOpen(true)}
      />

      {/* 2. 4 Metric Stats Cards */}
      <IntakeMetricsGrid intakeData={intakeData} />

      {/* 3. Navigation Tabs */}
      <div className='flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-3'>
        <div className='flex items-center gap-2'>
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-blue-600 text-white'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            Intake Compliance Matrix
          </button>
          <button
            onClick={() => setActiveTab('students')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition cursor-pointer ${
              activeTab === 'students'
                ? 'bg-blue-600 text-white'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            Student Roster ({students.length})
          </button>
          <button
            onClick={() => setActiveTab('upload')}
            className={`px-4 py-2 text-xs font-semibold rounded-lg transition cursor-pointer ${
              activeTab === 'upload'
                ? 'bg-blue-600 text-white'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            Batch Submission Portal
          </button>
        </div>
      </div>

      {/* 4. Tab Panels */}
      {activeTab === 'overview' && (
        <IntakeSummaryTable intakeData={intakeData} />
      )}

      {activeTab === 'students' && (
        <StudentDirectoryTable
          students={students}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
        />
      )}

      {activeTab === 'upload' && (
        <div className='bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-8 shadow-sm max-w-2xl mx-auto'>
          <h3 className='text-lg font-bold text-neutral-900 dark:text-white text-center'>
            Upload Student Admission Batch
          </h3>
          <p className='text-xs text-neutral-500 text-center mt-1 mb-6'>
            Submit complete student-level admission data anchored to APAAR IDs for the academic session.
          </p>

          <div
            onClick={handleSimulateBulkUpload}
            className='border-2 border-dashed border-blue-400 dark:border-blue-700 rounded-2xl p-10 text-center bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition cursor-pointer'
          >
            {isUploading ? (
              <div className='flex flex-col items-center justify-center space-y-3'>
                <RefreshCw className='size-8 text-blue-600 animate-spin' />
                <p className='text-xs font-semibold text-neutral-800 dark:text-neutral-200'>
                  Validating 120 Student APAAR IDs with DigiLocker API...
                </p>
              </div>
            ) : uploadSuccess ? (
              <div className='flex flex-col items-center justify-center space-y-2'>
                <CheckCircle2 className='size-10 text-emerald-600' />
                <p className='text-sm font-bold text-emerald-700 dark:text-emerald-400'>
                  120 Records Successfully Verified & Registered!
                </p>
                <p className='text-xs text-neutral-500'>
                  Intake ceiling compliance verified. Dual enrollment checks passed.
                </p>
              </div>
            ) : (
              <div className='flex flex-col items-center justify-center space-y-3'>
                <Upload className='size-10 text-blue-600' />
                <div>
                  <p className='text-sm font-semibold text-neutral-900 dark:text-white'>
                    Click to browse or drop CSV/Excel file
                  </p>
                  <p className='text-xs text-neutral-500 mt-0.5'>
                    AICTE format specification 2026.1 (Max 5,000 records per upload)
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className='mt-6 flex items-center justify-between text-xs text-neutral-500'>
            <span>Need template format?</span>
            <button
              type='button'
              className='text-blue-600 dark:text-blue-400 font-semibold flex items-center gap-1 hover:underline'
            >
              <Download className='size-3.5' /> Download AICTE Schema Sample
            </button>
          </div>
        </div>
      )}

      {/* 5. Isolated Modals specifically for Institution */}
      <AddStudentModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddStudent={handleAddNewStudent}
      />

      <BulkUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
      />
    </div>
  );
}
