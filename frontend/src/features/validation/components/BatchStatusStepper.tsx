import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BatchStatus } from '@/features/upload/types';

const STEPS = [
  { label: 'Received', hint: 'Rows saved to staging' },
  { label: 'Format checks', hint: 'Fields, categories, duplicates' },
  { label: 'Identity', hint: 'APAAR / student match' },
  { label: 'Your approval', hint: 'Review and approve' },
  { label: 'Repository', hint: 'Seat caps, national lock, commit' },
];

/** Index of the step in progress, and whether it is actively running. */
function position(status: BatchStatus): { index: number; running: boolean } {
  switch (status) {
    case 'UPLOADED':
      return { index: 1, running: true };
    case 'L1_PROCESSING':
      return { index: 1, running: true };
    case 'L1_COMPLETED':
    case 'L2_PROCESSING':
      return { index: 2, running: true };
    case 'L2_COMPLETED':
      return { index: 3, running: false };
    case 'L3_PROCESSING':
      return { index: 4, running: true };
    case 'COMPLETED':
    case 'COMPLETED_WITH_ANOMALIES':
      return { index: 5, running: false };
    default:
      return { index: -1, running: false };
  }
}

export function BatchStatusStepper({ status }: { status: BatchStatus }) {
  const { index, running } = position(status);
  if (index < 0) return null; // FAILED / CANCELLED are shown as a banner instead

  return (
    <ol className='grid grid-cols-5 gap-2'>
      {STEPS.map((step, i) => {
        const done = i < index;
        const current = i === index;
        return (
          <li key={step.label} className='space-y-1.5'>
            <div
              className={cn(
                'h-1.5 rounded-full',
                done ? 'bg-emerald-500' : current ? 'bg-blue-500' : 'bg-neutral-200 dark:bg-neutral-800',
              )}
            />
            <div className='flex items-center gap-1 text-[11px] font-semibold'>
              {done && <Check className='size-3 text-emerald-600' />}
              {current && running && <Loader2 className='size-3 animate-spin text-blue-600' />}
              <span className={cn(!done && !current && 'text-neutral-400')}>{step.label}</span>
            </div>
            <p className='text-[10px] text-neutral-500 hidden sm:block'>{step.hint}</p>
          </li>
        );
      })}
    </ol>
  );
}
