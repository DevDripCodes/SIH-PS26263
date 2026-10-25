import type { StudentRecord } from '@/types/apaar';
import { CheckCircle2, AlertTriangle, AlertCircle, FileCheck, Search, Filter } from 'lucide-react';

interface StudentDirectoryTableProps {
  students: StudentRecord[];
  searchQuery: string;
  setSearchQuery?: (query: string) => void;
  selectedCategory: string;
  setSelectedCategory?: (category: string) => void;
}

export function StudentDirectoryTable({
  students,
  searchQuery,
  setSearchQuery,
  selectedCategory,
  setSelectedCategory,
}: StudentDirectoryTableProps) {
  const filteredStudents = students.filter((s) => {
    const studentProgram = s.program || s.course || '';
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.apaarId.includes(searchQuery) ||
      studentProgram.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === 'All' || s.category.includes(selectedCategory);
    return matchesSearch && matchesCategory;
  });

  return (
    <div className='bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200/90 dark:border-neutral-800 shadow-sm overflow-hidden'>
      {/* Search and Filters Bar */}
      {setSearchQuery && setSelectedCategory && (
        <div className='p-4 border-b border-neutral-200 dark:border-neutral-800 flex flex-col sm:flex-row gap-3 items-center justify-between'>
          <div className='relative w-full sm:w-80'>
            <Search className='absolute left-3 top-2.5 size-4 text-neutral-400' />
            <input
              type='text'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder='Search by student name, APAAR ID or course...'
              className='w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500'
            />
          </div>

          <div className='flex items-center gap-2 w-full sm:w-auto'>
            <Filter className='size-4 text-neutral-400 shrink-0' />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className='text-xs px-2.5 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none'
            >
              <option value='All'>All Categories</option>
              <option value='Regular'>Regular</option>
              <option value='Supernumerary'>Supernumerary (EWS/TFW)</option>
              <option value='NRI'>NRI</option>
              <option value='Foreign'>Foreign National (FN)</option>
            </select>
          </div>
        </div>
      )}

      <div className='overflow-x-auto'>
        <table className='w-full text-left text-xs'>
          <thead className='bg-neutral-50 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 font-semibold border-b border-neutral-200 dark:border-neutral-800'>
            <tr>
              <th className='px-5 py-3.5'>Student Name & Details</th>
              <th className='px-5 py-3.5'>APAAR ID (12-Digit)</th>
              <th className='px-5 py-3.5'>Enrolled Program</th>
              <th className='px-5 py-3.5 text-center'>Quota / Category</th>
              <th className='px-5 py-3.5 text-center'>Dual Enrollment Flag</th>
              <th className='px-5 py-3.5 text-center'>ABC Linked</th>
              <th className='px-5 py-3.5 text-right'>Verification Status</th>
            </tr>
          </thead>
          <tbody className='divide-y divide-neutral-200 dark:divide-neutral-800 text-neutral-700 dark:text-neutral-300'>
            {filteredStudents.map((s) => {
              const programName = s.program || s.course || 'Engineering Program';
              const verification = s.verificationStatus || s.status || 'Verified';
              const dualStatus =
                s.dualEnrollmentStatus ||
                (s.flagReason?.includes('Dual')
                  ? 'Conflict Detected'
                  : s.status === 'Flagged'
                  ? 'Review Required'
                  : 'Clear');

              return (
                <tr key={s.id} className='hover:bg-neutral-50/70 dark:hover:bg-neutral-800/40 transition'>
                  <td className='px-5 py-4 font-semibold text-neutral-900 dark:text-white'>
                    {s.name}
                    <span className='block text-[11px] text-neutral-400 font-normal'>
                      Submitted: {s.submissionDate || '2026-08-15'}
                    </span>
                  </td>
                  <td className='px-5 py-4 font-mono font-medium text-blue-600 dark:text-blue-400'>
                    {s.apaarId}
                  </td>
                  <td className='px-5 py-4 max-w-[200px] truncate' title={programName}>
                    {programName}
                  </td>
                  <td className='px-5 py-4 text-center'>
                    <span className='px-2 py-0.5 rounded-md text-[11px] font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'>
                      {s.category}
                    </span>
                  </td>
                  <td className='px-5 py-4 text-center'>
                    {dualStatus === 'Clear' && (
                      <span className='inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400'>
                        <CheckCircle2 className='size-3.5' /> Clear
                      </span>
                    )}
                    {dualStatus === 'Review Required' && (
                      <span className='inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400'>
                        <AlertTriangle className='size-3.5' /> Review Needed
                      </span>
                    )}
                    {dualStatus === 'Conflict Detected' && (
                      <span className='inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 px-2 py-0.5 rounded-full'>
                        <AlertCircle className='size-3.5' /> Dual Enrollment
                      </span>
                    )}
                  </td>
                  <td className='px-5 py-4 text-center'>
                    {s.abcLinked !== false ? (
                      <span className='inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400'>
                        <CheckCircle2 className='size-3.5' /> Yes (ABC Linked)
                      </span>
                    ) : (
                      <span className='text-[11px] text-neutral-400'>Pending</span>
                    )}
                  </td>
                  <td className='px-5 py-4 text-right'>
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                        verification === 'Verified'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800'
                          : verification === 'Pending'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800'
                          : 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-400 dark:border-rose-800'
                      }`}
                    >
                      <FileCheck className='size-3' />
                      {verification}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
