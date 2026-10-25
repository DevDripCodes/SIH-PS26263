import type { StudentRecord } from '@/types/apaar';
import { AdminHeader, NationalStatsGrid, AnomalyRadar } from './components';

interface AicteAdminPortalProps {
  students: StudentRecord[];
}

export function AicteAdminPortal({ students }: AicteAdminPortalProps) {
  const flaggedStudents = students.filter((s) => s.status === 'Flagged');
  const totalFlagged = flaggedStudents.length;

  return (
    <div className='space-y-6'>
      {/* 1. Admin Regulatory Header */}
      <AdminHeader />

      {/* 2. 4 National Statistics Cards */}
      <NationalStatsGrid totalFlagged={totalFlagged} />

      {/* 3. Live Anomaly Sentinel Table */}
      <AnomalyRadar flaggedStudents={flaggedStudents} students={students} />
    </div>
  );
}
