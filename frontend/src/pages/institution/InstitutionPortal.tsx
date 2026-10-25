import { useState } from 'react';
import type { IntakeData, StudentRecord } from '@/types/apaar';
import { IngestionPanel } from '@/features/upload';
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
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

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
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            Intake Compliance Matrix
          </button>
          <button
            onClick={() => setActiveTab('students')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
              activeTab === 'students'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            Enrolled Students Roster ({students.length})
          </button>
          <button
            onClick={() => setActiveTab('upload')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
              activeTab === 'upload'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            }`}
          >
            Batch Ingestion & Uploads
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
        <IngestionPanel />
      )}

      {/* 5. Modals isolated to Institution page */}
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
