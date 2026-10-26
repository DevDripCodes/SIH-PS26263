import { useRef, useState, type DragEvent } from 'react';
import { isAxiosError } from 'axios';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react';
import { apiErrorMessage } from '@/api/client';
import { cn } from '@/lib/utils';
import { downloadTemplate, previewFile, uploadFile } from './api';
import { FIELD_LABELS, FIELDS, type Batch, type BatchScope, type FilePreview } from './types';

const MAX_FILE_BYTES = 25 * 1024 * 1024;

const KIND_CONFIG = {
  csv: {
    accept: '.csv,text/csv',
    extensions: ['.csv'],
    label: 'CSV',
    template: 'csv' as const,
    Icon: FileText,
  },
  excel: {
    accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['.xlsx'],
    label: 'Excel (.xlsx)',
    template: 'xlsx' as const,
    Icon: FileSpreadsheet,
  },
};

type Phase =
  | { name: 'idle' }
  | { name: 'reading' }
  | { name: 'ready'; preview: FilePreview }
  | { name: 'uploading'; preview: FilePreview; percent: number }
  | { name: 'duplicate'; preview: FilePreview; message: string };

interface FileUploadProps {
  kind: 'csv' | 'excel';
  /** null until an institution and academic year are chosen */
  scope: BatchScope | null;
  onUploaded: (batch: Batch) => void;
}

export function FileUpload({ kind, scope, onUploaded }: FileUploadProps) {
  const config = KIND_CONFIG[kind];
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const reset = () => {
    setFile(null);
    setPhase({ name: 'idle' });
    setError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const selectFile = async (selected: File | undefined) => {
    if (!selected) return;
    setError('');
    const name = selected.name.toLowerCase();
    if (!config.extensions.some((ext) => name.endsWith(ext))) {
      setError(
        kind === 'excel' && name.endsWith('.xls')
          ? 'Old .xls files are not supported. Open the file in Excel and save it as .xlsx.'
          : `Choose a ${config.extensions.join(' / ')} file.`,
      );
      return;
    }
    if (selected.size > MAX_FILE_BYTES) {
      setError('File is larger than 25 MB. Split it into smaller files.');
      return;
    }
    setFile(selected);
    setPhase({ name: 'reading' });
    try {
      setPhase({ name: 'ready', preview: await previewFile(selected) });
    } catch (err) {
      setPhase({ name: 'idle' });
      setFile(null);
      setError(apiErrorMessage(err));
    }
  };

  const submit = async (allowDuplicate = false) => {
    if (!file || !scope || (phase.name !== 'ready' && phase.name !== 'duplicate')) return;
    const { preview } = phase;
    setError('');
    setPhase({ name: 'uploading', preview, percent: 0 });
    try {
      const { batch } = await uploadFile(file, scope, {
        allowDuplicate,
        onProgress: (percent) => setPhase({ name: 'uploading', preview, percent }),
      });
      onUploaded(batch);
      reset();
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 409) {
        setPhase({ name: 'duplicate', preview, message: apiErrorMessage(err) });
      } else {
        setPhase({ name: 'ready', preview });
        setError(apiErrorMessage(err));
      }
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    void selectFile(e.dataTransfer.files[0]);
  };

  const preview = 'preview' in phase ? phase.preview : null;

  return (
    <div className='space-y-4'>
      {!file ? (
        <div
          role='button'
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={cn(
            'border-2 border-dashed rounded-2xl p-8 text-center transition cursor-pointer',
            isDragging
              ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/30'
              : 'border-neutral-300 dark:border-neutral-700 hover:border-blue-500',
          )}
        >
          <div className='size-12 mx-auto rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 flex items-center justify-center border border-blue-200 dark:border-blue-800'>
            <Upload className='size-5' />
          </div>
          <p className='text-xs text-neutral-600 dark:text-neutral-300 font-medium mt-3'>
            Drag and drop your <span className='font-bold text-blue-600'>{config.label}</span> file here, or click to
            browse
          </p>
          <p className='text-[11px] text-neutral-400 mt-1'>Maximum 25 MB • First row must be the column headers</p>
          <input
            ref={inputRef}
            type='file'
            accept={config.accept}
            className='hidden'
            onChange={(e) => void selectFile(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div className='flex items-center justify-between gap-3 p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/40'>
          <div className='flex items-center gap-3 min-w-0'>
            <config.Icon className='size-5 text-blue-600 shrink-0' />
            <div className='min-w-0'>
              <p className='text-xs font-semibold truncate'>{file.name}</p>
              <p className='text-[11px] text-neutral-500'>
                {(file.size / 1024).toFixed(1)} KB
                {preview && ` • ${preview.totalRows.toLocaleString('en-IN')} student rows`}
              </p>
            </div>
          </div>
          <button
            type='button'
            onClick={reset}
            disabled={phase.name === 'uploading'}
            className='p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 cursor-pointer disabled:opacity-50'
            aria-label='Remove file'
          >
            <X className='size-4' />
          </button>
        </div>
      )}

      {phase.name === 'reading' && (
        <p className='text-xs text-neutral-500 flex items-center gap-2'>
          <RefreshCw className='size-3.5 animate-spin' /> Reading file…
        </p>
      )}

      {preview && <PreviewPanel preview={preview} />}

      {error && (
        <div className='p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 rounded-xl text-xs flex items-start gap-2'>
          <AlertTriangle className='size-4 shrink-0' />
          <span>{error}</span>
        </div>
      )}

      {phase.name === 'duplicate' && (
        <div className='p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2'>
          <span className='flex items-center gap-2'>
            <AlertTriangle className='size-4 shrink-0' />
            {phase.message}
          </span>
          <button
            type='button'
            onClick={() => void submit(true)}
            className='px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer'
          >
            Upload again anyway
          </button>
        </div>
      )}

      <div className='flex flex-wrap items-center gap-3'>
        <button
          type='button'
          onClick={() => void submit()}
          disabled={
            !scope ||
            phase.name !== 'ready' ||
            phase.preview.mapping.missingRequired.some((f) => f === 'apaar_id' || f === 'full_name')
          }
          className='bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
        >
          {phase.name === 'uploading' ? (
            <>
              <RefreshCw className='size-4 animate-spin' />
              {phase.percent < 100 ? `Uploading ${phase.percent}%` : 'Saving rows…'}
            </>
          ) : (
            <>
              <Upload className='size-4' />
              Submit {preview ? `${preview.totalRows.toLocaleString('en-IN')} rows` : 'file'}
            </>
          )}
        </button>
        <button
          type='button'
          onClick={() => downloadTemplate(config.template).catch((err) => setError(apiErrorMessage(err)))}
          className='border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 px-4 py-2.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5 cursor-pointer'
        >
          <Download className='size-3.5' />
          {config.label} template
        </button>
        {!scope && <span className='text-[11px] text-neutral-500'>Choose an institution and academic year first.</span>}
      </div>
    </div>
  );
}

export function CsvUpload(props: Omit<FileUploadProps, 'kind'>) {
  return <FileUpload kind='csv' {...props} />;
}

export function ExcelUpload(props: Omit<FileUploadProps, 'kind'>) {
  return <FileUpload kind='excel' {...props} />;
}

function PreviewPanel({ preview }: { preview: FilePreview }) {
  const { mapping, sample } = preview;
  const columns = FIELDS.filter((f) => Object.values(mapping.mapped).includes(f));
  const blocking = mapping.missingRequired.filter((f) => f === 'apaar_id' || f === 'full_name');
  const warnings = mapping.missingRequired.filter((f) => f !== 'apaar_id' && f !== 'full_name');

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap gap-1.5'>
        {Object.entries(mapping.mapped).map(([header, field]) => (
          <span
            key={header}
            className='inline-flex items-center gap-1 text-[11px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full'
            title={`"${header}" → ${field}`}
          >
            <CheckCircle2 className='size-3' />
            {header === field ? FIELD_LABELS[field] : `${header} → ${FIELD_LABELS[field]}`}
          </span>
        ))}
        {mapping.unmapped.map((header) => (
          <span
            key={header}
            className='text-[11px] bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 px-2 py-0.5 rounded-full'
            title='Not a standard column. Kept as extra data on the record.'
          >
            {header} (extra)
          </span>
        ))}
      </div>

      {blocking.length > 0 && (
        <p className='text-xs text-red-600 flex items-center gap-1.5'>
          <AlertTriangle className='size-3.5' />
          Missing required column: {blocking.map((f) => FIELD_LABELS[f]).join(', ')}. Check the header row against the
          template.
        </p>
      )}
      {warnings.length > 0 && (
        <p className='text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5'>
          <AlertTriangle className='size-3.5' />
          No column for {warnings.map((f) => FIELD_LABELS[f]).join(', ')}. Rows will be flagged during validation.
        </p>
      )}

      {columns.length > 0 && (
        <div className='overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-800'>
          <table className='w-full text-left text-xs'>
            <thead className='bg-neutral-50 dark:bg-neutral-800/60'>
              <tr className='text-neutral-500'>
                {columns.map((f) => (
                  <th key={f} className='px-3 py-2 font-semibold whitespace-nowrap'>
                    {FIELD_LABELS[f]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className='divide-y divide-neutral-100 dark:divide-neutral-800/60'>
              {sample.map((row, i) => (
                <tr key={i}>
                  {columns.map((f) => (
                    <td key={f} className='px-3 py-1.5 whitespace-nowrap'>
                      {row[f] || <span className='text-neutral-300 dark:text-neutral-600'>—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {preview.totalRows > sample.length && (
            <p className='text-[11px] text-neutral-500 px-3 py-2 border-t border-neutral-100 dark:border-neutral-800'>
              Showing first {sample.length} of {preview.totalRows.toLocaleString('en-IN')} rows
            </p>
          )}
        </div>
      )}
    </div>
  );
}
