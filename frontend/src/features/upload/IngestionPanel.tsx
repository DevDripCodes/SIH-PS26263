import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ClipboardList, FileSpreadsheet, FileText, RefreshCw } from 'lucide-react';
import { apiErrorMessage } from '@/api/client';
import { cn } from '@/lib/utils';
import { listBatches, listInstitutions } from './api';
import { CsvUpload, ExcelUpload } from './FileUpload';
import { ManualEntryForm } from './ManualEntryForm';
import type { Batch, BatchStatus, Institution } from './types';

type Method = 'csv' | 'excel' | 'form';

const METHODS: { id: Method; label: string; Icon: typeof FileText; hint: string }[] = [
  { id: 'csv', label: 'CSV upload', Icon: FileText, hint: 'Bulk upload from any ERP export or spreadsheet saved as .csv' },
  { id: 'excel', label: 'Excel upload', Icon: FileSpreadsheet, hint: 'Bulk upload an .xlsx workbook (first visible sheet is read)' },
  { id: 'form', label: 'Form entry', Icon: ClipboardList, hint: 'Key in a few students by hand, e.g. late admissions' },
];

/** Academic years around today, newest first, in the DB's YYYY-YY format. */
function academicYears(now = new Date()): string[] {
  // Indian academic years start in July.
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return [start + 1, start, start - 1].map((y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`);
}

const STATUS_STYLE: Record<BatchStatus, string> = {
  UPLOADED: 'text-blue-700 bg-blue-50 dark:text-blue-300 dark:bg-blue-950/40',
  L1_PROCESSING: 'text-indigo-700 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-950/40',
  L1_COMPLETED: 'text-indigo-700 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-950/40',
  L2_PROCESSING: 'text-indigo-700 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-950/40',
  L2_COMPLETED: 'text-indigo-700 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-950/40',
  L3_PROCESSING: 'text-indigo-700 bg-indigo-50 dark:text-indigo-300 dark:bg-indigo-950/40',
  COMPLETED: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
  COMPLETED_WITH_ANOMALIES: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40',
  FAILED: 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/40',
  CANCELLED: 'text-neutral-600 bg-neutral-100 dark:text-neutral-400 dark:bg-neutral-800',
};

const SOURCE_LABEL: Record<Batch['sourceChannel'], string> = {
  CSV_UPLOAD: 'CSV',
  EXCEL_UPLOAD: 'Excel',
  WEB_FORM: 'Form',
  ERP_API: 'ERP API',
};

interface IngestionPanelProps {
  /** Pre-select (and lock) the institution, e.g. from the signed-in nodal officer's profile. */
  institutionId?: string;
}

export function IngestionPanel({ institutionId: fixedInstitutionId }: IngestionPanelProps) {
  const years = academicYears();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [institutionId, setInstitutionId] = useState(fixedInstitutionId ?? '');
  const [academicYear, setAcademicYear] = useState(years[1]!);
  const [method, setMethod] = useState<Method>('csv');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [lastBatch, setLastBatch] = useState<Batch | null>(null);
  const [loadError, setLoadError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (fixedInstitutionId) return;
    listInstitutions()
      .then((list) => {
        setInstitutions(list);
        if (list.length === 1) setInstitutionId(list[0]!.institutionId);
      })
      .catch((err) => setLoadError(apiErrorMessage(err)));
  }, [fixedInstitutionId]);

  const refreshBatches = useCallback(async () => {
    if (!institutionId) return;
    setIsRefreshing(true);
    try {
      setBatches(await listBatches(institutionId));
    } catch (err) {
      setLoadError(apiErrorMessage(err));
    } finally {
      setIsRefreshing(false);
    }
  }, [institutionId]);

  useEffect(() => {
    void refreshBatches();
  }, [refreshBatches]);

  const scope = institutionId && academicYear ? { institutionId, academicYear } : null;

  const handleIngested = (batch: Batch) => {
    setLastBatch(batch);
    setBatches((prev) => [batch, ...prev.filter((b) => b.batchId !== batch.batchId)]);
  };

  return (
    <div className='space-y-6'>
      <div className='bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 p-6 shadow-xs space-y-6'>
        <div>
          <h3 className='text-base font-bold'>Submit Student Enrolment Data</h3>
          <p className='text-xs text-neutral-500 mt-1 leading-relaxed'>
            Every row is saved to the staging area first, then checked for APAAR ID format, duplicates, approved
            intake limits and cross-institution enrolments. Rows that fail come back as anomalies to fix.
          </p>
        </div>

        <div className='grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl'>
          <label className='block space-y-1'>
            <span className='text-[11px] font-medium text-neutral-600 dark:text-neutral-300'>Institution</span>
            <select
              value={institutionId}
              onChange={(e) => setInstitutionId(e.target.value)}
              disabled={!!fixedInstitutionId}
              className='w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:opacity-70'
            >
              {fixedInstitutionId ? (
                <option value={fixedInstitutionId}>Your institution</option>
              ) : (
                <>
                  <option value=''>{institutions.length ? 'Select institution' : 'No institutions found'}</option>
                  {institutions.map((i) => (
                    <option key={i.institutionId} value={i.institutionId}>
                      {i.name} ({i.aictePermanentId})
                    </option>
                  ))}
                </>
              )}
            </select>
          </label>
          <label className='block space-y-1'>
            <span className='text-[11px] font-medium text-neutral-600 dark:text-neutral-300'>Academic year</span>
            <select
              value={academicYear}
              onChange={(e) => setAcademicYear(e.target.value)}
              className='w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500'
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loadError && <p className='text-xs text-red-600'>{loadError}</p>}

        <div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
          {METHODS.map(({ id, label, Icon, hint }) => (
            <button
              key={id}
              type='button'
              onClick={() => setMethod(id)}
              className={cn(
                'text-left p-4 rounded-xl border transition cursor-pointer',
                method === id
                  ? 'border-blue-600 bg-blue-50/60 dark:bg-blue-950/30 ring-1 ring-blue-600'
                  : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700',
              )}
            >
              <span className='flex items-center gap-2 text-sm font-semibold'>
                <Icon className={cn('size-4', method === id ? 'text-blue-600' : 'text-neutral-400')} />
                {label}
              </span>
              <span className='block text-[11px] text-neutral-500 mt-1'>{hint}</span>
            </button>
          ))}
        </div>

        {lastBatch && (
          <div className='p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs flex items-center gap-2'>
            <CheckCircle2 className='size-4 shrink-0' />
            <span>
              {lastBatch.totalRows.toLocaleString('en-IN')} {lastBatch.totalRows === 1 ? 'record' : 'records'} received
              for {lastBatch.academicYear}. Batch <span className='font-mono'>{lastBatch.batchId.slice(0, 8)}</span> is
              queued for validation.
            </span>
          </div>
        )}

        {method === 'csv' && <CsvUpload scope={scope} onUploaded={handleIngested} />}
        {method === 'excel' && <ExcelUpload scope={scope} onUploaded={handleIngested} />}
        {method === 'form' && <ManualEntryForm scope={scope} onSubmitted={handleIngested} />}
      </div>

      {institutionId && (
        <div className='bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 p-6 shadow-xs'>
          <div className='flex items-center justify-between mb-4'>
            <div>
              <h3 className='text-base font-bold'>Recent Submissions</h3>
              <p className='text-xs text-neutral-500'>Validation progress for each batch</p>
            </div>
            <button
              type='button'
              onClick={() => void refreshBatches()}
              className='p-2 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer'
              aria-label='Refresh'
            >
              <RefreshCw className={cn('size-3.5', isRefreshing && 'animate-spin')} />
            </button>
          </div>

          {batches.length === 0 ? (
            <p className='text-xs text-neutral-500'>No submissions yet.</p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full text-left text-xs'>
                <thead>
                  <tr className='text-neutral-500 border-b border-neutral-200 dark:border-neutral-800'>
                    <th className='py-2.5 font-semibold'>Submitted</th>
                    <th className='py-2.5 font-semibold'>Source</th>
                    <th className='py-2.5 font-semibold'>Year</th>
                    <th className='py-2.5 font-semibold text-right'>Rows</th>
                    <th className='py-2.5 font-semibold text-right'>Rejected</th>
                    <th className='py-2.5 font-semibold text-right'>Quarantined</th>
                    <th className='py-2.5 font-semibold text-right'>Promoted</th>
                    <th className='py-2.5 font-semibold pl-4'>Status</th>
                  </tr>
                </thead>
                <tbody className='divide-y divide-neutral-100 dark:divide-neutral-800/60'>
                  {batches.map((b) => (
                    <tr key={b.batchId}>
                      <td className='py-2.5'>
                        <div className='font-medium'>
                          {new Date(b.uploadedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                        </div>
                        {b.originalFilename && (
                          <div className='text-[11px] text-neutral-500 truncate max-w-48'>{b.originalFilename}</div>
                        )}
                      </td>
                      <td className='py-2.5'>{SOURCE_LABEL[b.sourceChannel]}</td>
                      <td className='py-2.5'>{b.academicYear}</td>
                      <td className='py-2.5 text-right tabular-nums'>{b.totalRows.toLocaleString('en-IN')}</td>
                      <td className='py-2.5 text-right tabular-nums'>{b.l1RejectedRows}</td>
                      <td className='py-2.5 text-right tabular-nums'>{b.l2QuarantinedRows + b.l3QuarantinedRows}</td>
                      <td className='py-2.5 text-right tabular-nums'>{b.promotedRows}</td>
                      <td className='py-2.5 pl-4'>
                        <span
                          className={cn('px-2 py-0.5 rounded-full font-medium whitespace-nowrap', STATUS_STYLE[b.status])}
                          title={b.failureReason ?? undefined}
                        >
                          {b.status.replace(/_/g, ' ').toLowerCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
