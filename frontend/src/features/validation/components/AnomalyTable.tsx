import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { apiErrorMessage } from '@/api/client';
import { cn } from '@/lib/utils';
import { listAnomalies } from '../api';
import { anomalyLabel, LEVEL_LABEL } from '../anomaly-labels';
import type { AnomalyFilter, AnomalyPage, Severity } from '../types';

const PAGE_SIZE = 25;

interface AnomalyTableProps {
  batchId: string;
  code?: string;
  /** Changes whenever the batch moves on, so the list reloads. */
  version: string;
}

export function AnomalyTable({ batchId, code, version }: AnomalyTableProps) {
  const [severity, setSeverity] = useState<Severity | undefined>();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AnomalyPage | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const filter: AnomalyFilter = { page, severity, code };
    let active = true;
    listAnomalies(batchId, filter, PAGE_SIZE)
      .then((result) => active && (setData(result), setError('')))
      .catch((err) => active && setError(apiErrorMessage(err)));
    return () => {
      active = false;
    };
  }, [batchId, code, severity, page, version]);

  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className='space-y-3'>
      <div className='flex items-center gap-2 text-xs'>
        {([undefined, 'ERROR', 'WARNING'] as const).map((s) => (
          <button
            key={s ?? 'all'}
            type='button'
            onClick={() => {
              setSeverity(s);
              setPage(1);
            }}
            className={cn(
              'px-3 py-1 rounded-full border transition cursor-pointer',
              severity === s
                ? 'bg-neutral-900 text-white border-neutral-900 dark:bg-white dark:text-neutral-900 dark:border-white'
                : 'border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800',
            )}
          >
            {s === undefined ? 'All' : s === 'ERROR' ? 'Errors' : 'Warnings'}
          </button>
        ))}
        {data && <span className='ml-auto text-neutral-500'>{data.total.toLocaleString('en-IN')} issues</span>}
      </div>

      {error && <p className='text-xs text-red-600'>{error}</p>}

      {data && data.items.length === 0 ? (
        <p className='text-xs text-neutral-500 py-6 text-center'>No issues for this filter.</p>
      ) : (
        <div className='overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800'>
          <table className='w-full text-left text-xs'>
            <thead className='bg-neutral-50 dark:bg-neutral-800/60 text-neutral-500'>
              <tr>
                <th className='px-3 py-2 font-semibold'>Row</th>
                <th className='px-3 py-2 font-semibold'>Student</th>
                <th className='px-3 py-2 font-semibold'>Issue</th>
                <th className='px-3 py-2 font-semibold'>How to fix</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-neutral-100 dark:divide-neutral-800/60'>
              {data?.items.map((a) => (
                <tr key={a.anomalyId} className='align-top'>
                  <td className='px-3 py-2 tabular-nums font-semibold'>{a.sourceRowNumber}</td>
                  <td className='px-3 py-2'>
                    <div className='font-medium'>{a.fullName || '—'}</div>
                    <div className='text-[11px] text-neutral-500 font-mono'>
                      {a.apaarId ?? 'no APAAR'} · {a.rollNo || 'no roll no.'}
                    </div>
                  </td>
                  <td className='px-3 py-2 max-w-sm'>
                    <div className='flex items-center gap-1.5'>
                      {a.severity === 'ERROR' ? (
                        <AlertTriangle className='size-3.5 text-red-600 shrink-0' />
                      ) : (
                        <Info className='size-3.5 text-amber-500 shrink-0' />
                      )}
                      <span className='font-semibold'>{anomalyLabel(a.code)}</span>
                      <span className='text-[10px] text-neutral-400'>{LEVEL_LABEL[a.level]}</span>
                    </div>
                    <p className='text-neutral-600 dark:text-neutral-400 mt-0.5'>{a.message}</p>
                    {a.offendingValue && (
                      <p className='text-[11px] text-neutral-500 mt-0.5'>
                        Value: <span className='font-mono'>{a.offendingValue}</span>
                      </p>
                    )}
                  </td>
                  <td className='px-3 py-2 text-neutral-600 dark:text-neutral-400 max-w-xs'>{a.fixHint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className='flex items-center justify-end gap-2 text-xs'>
          <button
            type='button'
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className='p-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 disabled:opacity-40 cursor-pointer'
            aria-label='Previous page'
          >
            <ChevronLeft className='size-3.5' />
          </button>
          <span>
            Page {page} of {pages}
          </span>
          <button
            type='button'
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
            className='p-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 disabled:opacity-40 cursor-pointer'
            aria-label='Next page'
          >
            <ChevronRight className='size-3.5' />
          </button>
        </div>
      )}
    </div>
  );
}
