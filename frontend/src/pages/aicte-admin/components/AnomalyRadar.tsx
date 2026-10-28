import type { StudentRecord } from '@/types/apaar';
import { AlertTriangle, AlertCircle } from 'lucide-react';

interface AnomalyRadarProps {
  flaggedStudents?: StudentRecord[];
  students?: StudentRecord[];
}

export function AnomalyRadar({ flaggedStudents, students }: AnomalyRadarProps) {
  const source = flaggedStudents || students || [];
  const anomalies = flaggedStudents
    ? flaggedStudents
    : source.filter(
        (s) =>
          (s.dualEnrollmentStatus && s.dualEnrollmentStatus !== 'Clear') ||
          s.status === 'Flagged' ||
          s.flagReason
      );

  return (
    <div className='bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 p-6 shadow-sm'>
      <div className='flex items-center justify-between mb-4'>
        <div>
          <h3 className='font-bold text-neutral-900 dark:text-white flex items-center gap-2 text-base'>
            <AlertTriangle className='size-5 text-amber-500' />
            Live Anomaly Detection Sentinel
          </h3>
          <p className='text-xs text-neutral-500 mt-0.5'>
            Algorithmic detection of concurrent enrollments, ceiling breaches, and ghost admissions.
          </p>
        </div>
        <span className='px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800'>
          {anomalies.length} Priority Alerts
        </span>
      </div>

      <div className='space-y-3'>
        {anomalies.map((a) => {
          const dualText =
            a.dualEnrollmentStatus ||
            (a.flagReason?.includes('Dual')
              ? 'Conflict Detected'
              : 'Intake Ceiling Exceeded');

          const reasonText =
            a.flagReason ||
            'Simultaneous active enrollment detected at: MAIT (CSE) & GGSIPU (IT). Conflicting admission counseling record.';

          return (
            <div
              key={a.id}
              className='p-4 rounded-xl border border-amber-200 dark:border-amber-800/80 bg-amber-50/40 dark:bg-amber-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3'
            >
              <div>
                <div className='flex items-center gap-2'>
                  <AlertCircle className='size-4 text-amber-600' />
                  <span className='font-semibold text-neutral-900 dark:text-white text-xs'>
                    {a.name} • APAAR: <span className='font-mono text-blue-600'>{a.apaarId}</span>
                  </span>
                  <span className='px-2 py-0.5 text-[10px] font-bold rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300'>
                    {dualText}
                  </span>
                </div>
                <p className='text-xs text-neutral-600 dark:text-neutral-400 mt-1 pl-6'>
                  {reasonText}
                </p>
              </div>
              <div className='flex items-center gap-2 pl-6 sm:pl-0'>
                <button
                  type='button'
                  className='px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition'
                >
                  Inspect Records
                </button>
                <button
                  type='button'
                  className='px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 transition'
                >
                  Issue Show-Cause Notice
                </button>
              </div>
            </div>
          );
        })}

        {anomalies.length === 0 && (
          <div className='p-8 text-center text-xs text-neutral-500'>
            No active anomalies detected across connected state counseling servers.
          </div>
        )}
      </div>
    </div>
  );
}
