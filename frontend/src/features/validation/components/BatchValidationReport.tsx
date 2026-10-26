import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Download, Info, RotateCcw, X } from 'lucide-react';
import { apiErrorMessage } from '@/api/client';
import { cn } from '@/lib/utils';
import type { Batch, BatchStatus } from '@/features/upload/types';
import { downloadCorrections, getValidationReport, retryBatch } from '../api';
import { anomalyLabel } from '../anomaly-labels';
import type { ValidationReport } from '../types';
import { AnomalyTable } from './AnomalyTable';
import { ApprovalPanel } from './ApprovalPanel';
import { BatchStatusStepper } from './BatchStatusStepper';

const IN_FLIGHT: BatchStatus[] = ['UPLOADED', 'L1_PROCESSING', 'L1_COMPLETED', 'L2_PROCESSING', 'L3_PROCESSING'];
const POLL_MS = 3000;

interface BatchValidationReportProps {
  batchId: string;
  onClose: () => void;
  /** Called whenever the batch's status or counters change, so lists can update. */
  onBatchChange?: (batch: Batch) => void;
}

export function BatchValidationReport({ batchId, onClose, onBatchChange }: BatchValidationReportProps) {
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [code, setCode] = useState<string | undefined>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const next = await getValidationReport(batchId);
      setReport(next);
      setError('');
      onBatchChange?.(next.batch);
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  }, [batchId, onBatchChange]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while a worker is processing the batch.
  const status = report?.batch.status;
  useEffect(() => {
    if (!status || !IN_FLIGHT.includes(status)) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [status, load]);

  if (!report) {
    return (
      <Shell onClose={onClose} title='Validation report'>
        <p className={cn('text-xs', error ? 'text-red-600' : 'text-neutral-500')}>{error || 'Loading…'}</p>
      </Shell>
    );
  }

  const { batch, records, anomalies } = report;
  const rejected = records.REJECTED ?? 0;
  const quarantined = records.QUARANTINED ?? 0;
  const ready = records.L2_VERIFIED ?? 0;
  const promoted = records.VALID ?? 0;
  const errorGroups = anomalies.filter((a) => a.severity === 'ERROR');
  const byCode = new Map<string, number>();
  for (const a of anomalies) byCode.set(a.code, (byCode.get(a.code) ?? 0) + a.count);

  const handleChanged = (next: Batch) => {
    onBatchChange?.(next);
    void load();
  };

  return (
    <Shell
      onClose={onClose}
      title={batch.originalFilename ?? 'Form submission'}
      subtitle={`Batch ${batch.batchId.slice(0, 8)} · ${batch.academicYear} · ${new Date(batch.uploadedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`}
    >
      <BatchStatusStepper status={batch.status} />

      {batch.status === 'FAILED' && (
        <Banner tone='red'>
          <span className='flex-1'>{batch.failureReason ?? 'Processing failed.'}</span>
          <button
            type='button'
            onClick={() => retryBatch(batch.batchId).then(handleChanged).catch((err) => setError(apiErrorMessage(err)))}
            className='px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold flex items-center gap-1 cursor-pointer'
          >
            <RotateCcw className='size-3.5' />
            Retry
          </button>
        </Banner>
      )}
      {batch.status === 'CANCELLED' && <Banner tone='neutral'>This batch was cancelled and will not be submitted.</Banner>}
      {report.apaarRegistry === 'not-configured' && batch.status !== 'CANCELLED' && (
        <Banner tone='blue'>
          <Info className='size-4 shrink-0' />
          APAAR IDs are format-checked and matched against students already in the AICTE repository. Live DigiLocker /
          ABC registry verification is not connected yet, so new students are recorded as declared by the institution.
        </Banner>
      )}

      <div className='grid grid-cols-2 sm:grid-cols-4 gap-3'>
        <Tile label='Rows received' value={batch.totalRows} />
        <Tile label='Rejected (fix & re-upload)' value={rejected} tone={rejected ? 'red' : undefined} />
        <Tile label='Held back' value={quarantined} tone={quarantined ? 'amber' : undefined} />
        <Tile
          label={promoted ? 'Committed to repository' : 'Ready for approval'}
          value={promoted || ready}
          tone='emerald'
        />
      </div>

      {batch.status === 'L2_COMPLETED' && <ApprovalPanel batch={batch} readyRows={ready} onChanged={handleChanged} />}

      {anomalies.length > 0 && (
        <div className='space-y-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <h4 className='text-sm font-bold mr-2'>Issues found</h4>
            <button
              type='button'
              onClick={() => setCode(undefined)}
              className={cn(
                'text-[11px] px-2.5 py-1 rounded-full border cursor-pointer',
                !code ? 'border-blue-600 text-blue-700 dark:text-blue-300' : 'border-neutral-200 dark:border-neutral-700',
              )}
            >
              All
            </button>
            {[...byCode.entries()].map(([c, count]) => (
              <button
                key={c}
                type='button'
                onClick={() => setCode(c === code ? undefined : c)}
                className={cn(
                  'text-[11px] px-2.5 py-1 rounded-full border cursor-pointer',
                  c === code
                    ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                    : errorGroups.some((g) => g.code === c)
                      ? 'border-red-200 dark:border-red-900 text-red-700 dark:text-red-300'
                      : 'border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300',
                )}
              >
                {anomalyLabel(c)} · {count}
              </button>
            ))}
            {rejected + quarantined > 0 && (
              <button
                type='button'
                onClick={() => downloadCorrections(batch.batchId).catch((err) => setError(apiErrorMessage(err)))}
                className='ml-auto border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 cursor-pointer'
              >
                <Download className='size-3.5' />
                Download rows to correct (CSV)
              </button>
            )}
          </div>
          <AnomalyTable batchId={batch.batchId} code={code} version={`${batch.status}:${anomalies.length}`} />
        </div>
      )}

      {error && (
        <p className='text-xs text-red-600 flex items-center gap-1.5'>
          <AlertTriangle className='size-3.5' />
          {error}
        </p>
      )}
    </Shell>
  );
}

function Shell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className='bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 p-6 shadow-xs space-y-5'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h3 className='text-base font-bold truncate'>{title}</h3>
          {subtitle && <p className='text-xs text-neutral-500'>{subtitle}</p>}
        </div>
        <button
          type='button'
          onClick={onClose}
          className='p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer'
          aria-label='Close report'
        >
          <X className='size-4' />
        </button>
      </div>
      {children}
    </section>
  );
}

function Banner({ tone, children }: { tone: 'red' | 'blue' | 'neutral'; children: React.ReactNode }) {
  const styles = {
    red: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300',
    blue: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900 text-blue-800 dark:text-blue-300',
    neutral: 'bg-neutral-50 dark:bg-neutral-800/50 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300',
  };
  return <div className={cn('p-3 border rounded-xl text-xs flex items-center gap-2', styles[tone])}>{children}</div>;
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: 'red' | 'amber' | 'emerald' }) {
  const color = {
    red: 'text-red-600 dark:text-red-400',
    amber: 'text-amber-600 dark:text-amber-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
  };
  return (
    <div className='rounded-xl border border-neutral-200 dark:border-neutral-800 p-3'>
      <div className={cn('text-xl font-bold tabular-nums', tone && value ? color[tone] : undefined)}>
        {value.toLocaleString('en-IN')}
      </div>
      <div className='text-[11px] text-neutral-500'>{label}</div>
    </div>
  );
}
