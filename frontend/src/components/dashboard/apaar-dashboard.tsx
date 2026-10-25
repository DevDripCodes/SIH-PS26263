import { useState } from 'react';
import type { UserRole, StudentRecord } from '@/types/apaar';
import { mockIntakeData, mockStudents } from '@/data/mockApaarData';
import { DashboardHeader } from './DashboardHeader';
import { AddStudentModal } from './AddStudentModal';
import { BulkUploadModal } from './BulkUploadModal';
import { InstitutionPortal } from '@/pages/institution';
import { AicteAdminPortal } from '@/pages/aicte-admin';
import { PublicVerifierPortal } from '@/pages/verifier';
import { StudentPassportPortal } from '@/pages/student';

// Re-export types for backward compatibility
export type { UserRole, StudentRecord, IntakeData } from '@/types/apaar';

interface ApaarDashboardProps {
  onSignOut: () => void;
}

export function ApaarDashboard({ onSignOut }: ApaarDashboardProps) {
  const [activeRole, setActiveRole] = useState<UserRole>('institution');
  const [students, setStudents] = useState<StudentRecord[]>(mockStudents);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const handleAddStudent = (newRecord: StudentRecord) => {
    setStudents((prev) => [newRecord, ...prev]);
  };

  return (
    <div className='min-h-screen bg-neutral-50 dark:bg-[#030712] text-neutral-900 dark:text-neutral-100 font-sans transition-colors'>
      {/* Top National Header Bar */}
      <DashboardHeader
        activeRole={activeRole}
        onSelectRole={setActiveRole}
        onSignOut={onSignOut}
      />

      {/* Main Role-Based Content Area */}
      <main className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'>
        {activeRole === 'institution' && (
          <InstitutionPortal
            intakeData={mockIntakeData}
            students={students}
            onOpenAddModal={() => setIsAddModalOpen(true)}
            onOpenUploadModal={() => setIsUploadModalOpen(true)}
          />
        )}

        {activeRole === 'aicte-admin' && (
          <AicteAdminPortal students={students} />
        )}

        {activeRole === 'verifier' && (
          <PublicVerifierPortal students={students} />
        )}

        {activeRole === 'student' && (
          <StudentPassportPortal student={students[0]} />
        )}
      </main>

      {/* Modal Dialogs */}
      <AddStudentModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddStudent={handleAddStudent}
      />

      <BulkUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
      />
    </div>
  );
}
