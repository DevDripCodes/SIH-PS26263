import { useState } from 'react';
import type { IntakeData, StudentRecord } from '@/types/apaar';
import {
  Sparkles,
  UserPlus,
  Upload,
  Building2,
  Users,
  FileCheck,
  Globe2,
  RefreshCw,
  Download,
  CheckCircle2,
} from 'lucide-react';
import { IntakeSummaryTable } from './IntakeSummaryTable';
import { StudentDirectoryTable } from './StudentDirectoryTable';

interface InstitutionPortalProps {
  intakeData: IntakeData[];
  students: StudentRecord[];
  onOpenAddModal: () => void;
  onOpenUploadModal: () => void;
}

export function InstitutionPortal({
  intakeData,
  students,
  onOpenAddModal,
  onOpenUploadModal,
}: InstitutionPortalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'students' | 'upload'>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const totalApproved = intakeData.reduce((acc, curr) => acc + curr.approvedIntake, 0);
  const totalEnrolled = intakeData.reduce((acc, curr) => acc + curr.actualEnrolment, 0);
  const totalSupernumerary = intakeData.reduce((acc, curr) => acc + curr.supernumerary, 0);
  const totalNriOci = intakeData.reduce((acc, curr) => acc + curr.nriOciFn, 0);

  const handleSimulateBulkUpload = () => {
    setIsUploading(true);
    setTimeout(() => {
      setIsUploading(false);
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 4000);
    }, 1500);
  };

  return (
    <div className='space-y-6'>
      {/* Sub-header Banner */}
      <div className='relative overflow-hidden bg-white dark:bg-neutral-900 rounded-2xl p-6 border border-neutral-200/90 dark:border-neutral-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4'>
        <div className='absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500' />
        <div>
          <span className='inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 mb-2'>
            <Sparkles className='size-3 text-amber-500' />
            Academic Year 2026-2027 • Approved Intake Verification
          </span>
          <h1 className='text-2xl font-bold tracking-tight text-neutral-900 dark:text-white'>
            Delhi Technological University
          </h1>
          <p className='text-sm text-neutral-500 dark:text-neutral-400 mt-1'>
            Permanent Institute ID: <span className='font-mono font-medium text-neutral-800 dark:text-neutral-200'>1-9321482</span> • Region: North-West • Affiliated with AICTE
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <button
            onClick={onOpenAddModal}
            className='bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 shadow-sm cursor-pointer'
          >
            <UserPlus className='size-4' />
            Add Student Record
          </button>
          <button
            onClick={onOpenUploadModal}
            className='bg-neutral-100 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700 border border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 cursor-pointer'
          >
            <Upload className='size-4' />
            Bulk Upload (CSV)
          </button>
        </div>
      </div>

      {/* Key Metrics Cards */}
      <div className='grid grid-cols-2 lg:grid-cols-4 gap-4'>
        <div className='bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 shadow-sm'>
          <div className='flex items-center justify-between text-neutral-500'>
            <span className='text-xs font-medium uppercase tracking-wider'>Approved Intake</span>
            <Building2 className='size-4 text-blue-500' />
          </div>
          <p className='text-2xl font-bold mt-2 text-neutral-900 dark:text-white'>{totalApproved}</p>
          <p className='text-xs text-neutral-500 mt-1'>Sanctioned AICTE Seats</p>
        </div>

        <div className='bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 shadow-sm'>
          <div className='flex items-center justify-between text-neutral-500'>
            <span className='text-xs font-medium uppercase tracking-wider'>Actual Enrolment</span>
            <Users className='size-4 text-emerald-500' />
          </div>
          <p className='text-2xl font-bold mt-2 text-emerald-600 dark:text-emerald-400'>
            {totalEnrolled}{' '}
            <span className='text-xs font-normal text-neutral-500'>
              ({((totalEnrolled / totalApproved) * 100).toFixed(1)}%)
            </span>
          </p>
          <p className='text-xs text-neutral-500 mt-1'>Verified with APAAR ID</p>
        </div>

        <div className='bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 shadow-sm'>
          <div className='flex items-center justify-between text-neutral-500'>
            <span className='text-xs font-medium uppercase tracking-wider'>Supernumerary</span>
            <FileCheck className='size-4 text-indigo-500' />
          </div>
          <p className='text-2xl font-bold mt-2 text-neutral-900 dark:text-white'>{totalSupernumerary}</p>
          <p className='text-xs text-neutral-500 mt-1'>EWS, TFW & PMSSS Quota</p>
        </div>

        <div className='bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 shadow-sm'>
          <div className='flex items-center justify-between text-neutral-500'>
            <span className='text-xs font-medium uppercase tracking-wider'>NRI / OCI / FN</span>
            <Globe2 className='size-4 text-amber-500' />
          </div>
          <p className='text-2xl font-bold mt-2 text-neutral-900 dark:text-white'>{totalNriOci}</p>
          <p className='text-xs text-neutral-500 mt-1'>International Quota Allocation</p>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className='flex items-center gap-6 border-b border-neutral-200 dark:border-neutral-800 text-sm font-medium'>
        <button
          onClick={() => setActiveTab('overview')}
          className={`pb-3 border-b-2 transition cursor-pointer ${
            activeTab === 'overview'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
              : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
          }`}
        >
          Intake & Quotas Summary
        </button>
        <button
          onClick={() => setActiveTab('students')}
          className={`pb-3 border-b-2 transition cursor-pointer ${
            activeTab === 'students'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
              : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
          }`}
        >
          Student Records Directory ({students.length})
        </button>
        <button
          onClick={() => setActiveTab('upload')}
          className={`pb-3 border-b-2 transition cursor-pointer ${
            activeTab === 'upload'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
              : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
          }`}
        >
          Bulk Upload & Verification Engine
        </button>
      </div>

      {/* Tab Content: Overview (Branch-wise intake) */}
      {activeTab === 'overview' && <IntakeSummaryTable intakeData={intakeData} />}

      {/* Tab Content: Student Directory */}
      {activeTab === 'students' && (
        <StudentDirectoryTable
          students={students}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
        />
      )}

      {/* Tab Content: Bulk Upload */}
      {activeTab === 'upload' && (
        <div className='bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 p-8 shadow-sm text-center'>
          <div className='max-w-lg mx-auto space-y-4'>
            <div className='size-14 mx-auto rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 flex items-center justify-center border border-blue-200 dark:border-blue-800'>
              <Upload className='size-6' />
            </div>
            <h3 className='text-lg font-bold text-neutral-900 dark:text-white'>
              Upload Student Enrolment Sheet
            </h3>
            <p className='text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed'>
              Submit student admission data in AICTE standard CSV/Excel format. The platform automatically verifies 12-digit APAAR IDs, validates approved intake limits, and checks for cross-institution duplicate admissions.
            </p>

            <div className='border-2 border-dashed border-neutral-300 dark:border-neutral-700 rounded-2xl p-6 hover:border-blue-500 transition cursor-pointer'>
              <p className='text-xs text-neutral-600 dark:text-neutral-300 font-medium'>
                Drag and drop your <span className='font-bold text-blue-600'>.CSV or .XLSX</span> file here
              </p>
              <p className='text-[11px] text-neutral-400 mt-1'>Maximum file size 25MB • Up to 5,000 records per batch</p>
            </div>

            <div className='flex items-center justify-center gap-3 pt-2'>
              <button
                onClick={handleSimulateBulkUpload}
                disabled={isUploading}
                className='bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50'
              >
                {isUploading ? (
                  <>
                    <RefreshCw className='size-4 animate-spin' />
                    Validating APAAR Checksums...
                  </>
                ) : (
                  <>
                    <FileCheck className='size-4' />
                    Run Automated Validation
                  </>
                )}
              </button>
              <button
                type='button'
                onClick={() => alert('Downloaded sample AICTE APAAR template (.csv)')}
                className='border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 px-4 py-2.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5 cursor-pointer text-neutral-800 dark:text-neutral-200'
              >
                <Download className='size-3.5' />
                Sample Template
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
      )}
    </div>
  );
}
