import { useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { apiErrorMessage } from '@/api/client';
import type { Batch } from '@/features/upload/types';
import { approveBatch, cancelBatch, precheckBatch } from '../api';
import { anomalyLabel } from '../anomaly-labels';
import type { PromotionForecast } from '../types';

interface ApprovalPanelProps {
  batch: Batch;
  readyRows: number;
  onChanged: (batch: Batch) => void;
}

/**
 * Maker-checker step: the institution reviews the validated batch, optionally runs a dry run of the
 * repository checks (seat caps, national enrolment lock, cut-off) and approves the commit.
 */
export function ApprovalPanel({ batch, readyRows, onChanged }: ApprovalPanelProps) {
  const [forecast, setForecast] = useState<PromotionForecast | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<'precheck' | 'approve' | 'cancel' | null>(null);
  const [error, setError] = useState('');

  const run = async (action: 'precheck' | 'approve' | 'cancel') => {
    setBusy(action);
    setError('');
    try {
      if (action === 'precheck') setForecast(await precheckBatch(batch.batchId));
      else if (action === 'approve') onChanged(await approveBatch(batch.batchId));
      else onChanged(await cancelBatch(batch.batchId));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className='rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20 p-4 space-y-4'>
      <div className='flex items-start gap-3'>
        <ShieldCheck className='size-5 text-blue-600 shrink-0 mt-0.5' />
        <div>
          <h4 className='text-sm font-bold'>Approve submission to the AICTE repository</h4>
          <p className='text-xs text-neutral-600 dark:text-neutral-400 mt-0.5'>
            {readyRows.toLocaleString('en-IN')} {readyRows === 1 ? 'student has' : 'students have'} passed format and
            identity checks. On approval, each is checked against the approved intake, seat quotas and enrolments at other
            institutions, then committed. Rows that fail stay in the report for correction.
          </p>
        </div>
      </div>

      {forecast && (
        <div className='grid grid-cols-3 gap-2 text-center'>
          <Stat label='Will be enrolled' value={forecast.willPromote} tone='emerald' />
          <Stat label='Already enrolled' value={forecast.alreadyEnrolled} tone='neutral' />
          <Stat label='Will be held back' value={forecast.willQuarantine} tone={forecast.willQuarantine ? 'amber' : 'neutral'} />
        </div>
      )}

      {forecast && forecast.rows.length > 0 && (
        <div className='rounded-lg border border-amber-200 dark:border-amber-900 bg-white dark:bg-neutral-900 p-3 text-xs space-y-1.5 max-h-48 overflow-y-auto'>
          {forecast.rows.slice(0, 50).map((r, i) => (
            <div key={i} className='flex gap-2'>
              <span className='font-semibold tabular-nums w-14 shrink-0'>Row {r.sourceRowNumber}</span>
              <span className='font-semibold shrink-0'>{anomalyLabel(r.code)}</span>
              <span className='text-neutral-500'>{r.message}</span>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className='text-xs text-red-600 flex items-center gap-1.5'>
          <AlertTriangle className='size-3.5' />
          {error}
        </p>
      )}

      <label className='flex items-start gap-2 text-xs cursor-pointer'>
        <input
          type='checkbox'
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className='mt-0.5 accent-blue-600'
        />
        <span>I confirm these admissions are genuine and the data is correct to the best of my knowledge.</span>
      </label>

      <div className='flex flex-wrap items-center gap-2'>
        <button
          type='button'
          onClick={() => void run('precheck')}
          disabled={busy !== null}
          className='border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50'
        >
          <RefreshCw className={busy === 'precheck' ? 'size-3.5 animate-spin' : 'size-3.5'} />
          {forecast ? 'Re-run pre-check' : 'Run pre-check'}
        </button>
        <button
          type='button'
          onClick={() => void run('approve')}
          disabled={!confirmed || busy !== null}
          className='bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
        >
          <CheckCircle2 className='size-3.5' />
          {busy === 'approve' ? 'Submitting…' : 'Approve & submit'}
        </button>
        <button
          type='button'
          onClick={() => {
            if (window.confirm('Cancel this batch? Its rows will not be submitted.')) void run('cancel');
          }}
          disabled={busy !== null}
          className='ml-auto text-xs font-medium text-neutral-500 hover:text-red-600 flex items-center gap-1 cursor-pointer disabled:opacity-50'
        >
          <XCircle className='size-3.5' />
          Cancel batch
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'neutral' }) {
  const color =
    tone === 'emerald'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'amber'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-neutral-700 dark:text-neutral-300';
  return (
    <div className='rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 py-2'>
      <div className={`text-lg font-bold tabular-nums ${color}`}>{value.toLocaleString('en-IN')}</div>
      <div className='text-[11px] text-neutral-500'>{label}</div>
    </div>
  );
}
