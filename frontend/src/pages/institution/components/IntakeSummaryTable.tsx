import type { IntakeData } from '@/types/apaar';
import { Building2 } from 'lucide-react';

interface IntakeSummaryTableProps {
  intakeData: IntakeData[];
}

export function IntakeSummaryTable({ intakeData }: IntakeSummaryTableProps) {
  return (
    <div className='bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 overflow-hidden shadow-sm'>
      <div className='p-5 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between'>
        <div>
          <h3 className='font-bold text-neutral-900 dark:text-white flex items-center gap-2 text-sm sm:text-base'>
            <Building2 className='size-4 text-blue-600' />
            AICTE Approved Intake vs Actual Admissions Roster
          </h3>
          <p className='text-xs text-neutral-500 mt-0.5'>
            Monitored against ceiling limits sanctioned in Approval Process Handbook (APH 2026-27).
          </p>
        </div>
        <span className='px-2.5 py-1 text-xs rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 font-semibold border border-emerald-200 dark:border-emerald-800'>
          Real-time Sync Active
        </span>
      </div>

      <div className='overflow-x-auto'>
        <table className='w-full text-left text-xs'>
          <thead className='bg-neutral-50 dark:bg-neutral-800/60 text-neutral-600 dark:text-neutral-400 font-semibold border-b border-neutral-200 dark:border-neutral-800'>
            <tr>
              <th className='px-5 py-3.5'>Program / Department</th>
              <th className='px-5 py-3.5 text-center'>Sanctioned Intake</th>
              <th className='px-5 py-3.5 text-center'>Actual Enrolment</th>
              <th className='px-5 py-3.5 text-center'>Supernumerary</th>
              <th className='px-5 py-3.5 text-center'>NRI / OCI / FN</th>
              <th className='px-5 py-3.5 text-center'>Utilization</th>
              <th className='px-5 py-3.5 text-right'>Audit Status</th>
            </tr>
          </thead>
          <tbody className='divide-y divide-neutral-200 dark:divide-neutral-800 text-neutral-700 dark:text-neutral-300'>
            {intakeData.map((row, index) => {
              const departmentName = row.department || row.branch || `Program ${index + 1}`;
              const percentage = Math.round((row.actualEnrolment / row.approvedIntake) * 100);
              const auditStatus =
                row.status ||
                (percentage > 100
                  ? 'Ceiling Exceeded'
                  : percentage >= 95
                  ? 'Near Capacity'
                  : 'Within Ceiling');

              return (
                <tr key={departmentName} className='hover:bg-neutral-50/70 dark:hover:bg-neutral-800/40 transition'>
                  <td className='px-5 py-4 font-semibold text-neutral-900 dark:text-white'>
                    {departmentName}
                  </td>
                  <td className='px-5 py-4 text-center font-mono'>{row.approvedIntake}</td>
                  <td className='px-5 py-4 text-center font-mono font-bold text-blue-600 dark:text-blue-400'>
                    {row.actualEnrolment}
                  </td>
                  <td className='px-5 py-4 text-center font-mono text-neutral-500'>
                    +{row.supernumerary}
                  </td>
                  <td className='px-5 py-4 text-center font-mono text-neutral-500'>{row.nriOciFn}</td>
                  <td className='px-5 py-4 text-center'>
                    <div className='flex items-center justify-center gap-2'>
                      <div className='w-16 h-2 bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden'>
                        <div
                          className={`h-full rounded-full ${
                            percentage > 100
                              ? 'bg-rose-500'
                              : percentage >= 95
                              ? 'bg-emerald-500'
                              : 'bg-blue-500'
                          }`}
                          style={{ width: `${Math.min(percentage, 100)}%` }}
                        />
                      </div>
                      <span className='font-mono text-[11px]'>{percentage}%</span>
                    </div>
                  </td>
                  <td className='px-5 py-4 text-right'>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        auditStatus === 'Within Ceiling'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800'
                          : auditStatus === 'Near Capacity'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-800'
                          : 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-400 dark:border-rose-800'
                      }`}
                    >
                      {auditStatus}
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
