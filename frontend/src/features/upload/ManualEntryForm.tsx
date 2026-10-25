import { useState } from 'react';
import { useForm, useWatch, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { apiErrorMessage } from '@/api/client';
import { cn } from '@/lib/utils';
import { submitForm } from './api';
import type { Batch, BatchScope, StudentRow } from './types';

const SOCIAL_CATEGORIES = ['GEN', 'EWS', 'OBC', 'SC', 'ST'];

const RESIDENCY = [
  { value: 'INDIAN_RESIDENT', label: 'Indian resident' },
  { value: 'NRI', label: 'NRI' },
  { value: 'OCI', label: 'OCI' },
  { value: 'PIO', label: 'PIO' },
  { value: 'FOREIGN_NATIONAL', label: 'Foreign national' },
  { value: 'CIWGC', label: 'CIWGC (children of Indian workers in Gulf)' },
];

const QUOTAS = [
  { value: 'REGULAR_SANCTIONED', label: 'Regular (sanctioned intake)' },
  { value: 'NRI_QUOTA', label: 'NRI quota' },
  { value: 'SUPERNUMERARY_TFW', label: 'Supernumerary – TFW' },
  { value: 'SUPERNUMERARY_EWS', label: 'Supernumerary – EWS' },
  { value: 'SUPERNUMERARY_PMSSS', label: 'Supernumerary – PMSSS' },
  { value: 'SUPERNUMERARY_FN_OCI_CIWGC', label: 'Supernumerary – FN / OCI / CIWGC' },
  { value: 'LATERAL_ENTRY', label: 'Lateral entry' },
];

const FOREIGN_RESIDENCY = ['FOREIGN_NATIONAL', 'OCI', 'PIO'];

const optional = z.string().trim();
const required = (label: string) => z.string().trim().min(1, { error: `${label} is required` });

const studentSchema = z
  .object({
    apaar_id: z
      .string()
      .transform((v) => v.replace(/[\s-]/g, ''))
      .pipe(z.string().regex(/^\d{12}$/, { error: 'APAAR ID must be 12 digits' })),
    full_name: required('Name'),
    date_of_birth: required('Date of birth'),
    gender: optional,
    email: z.union([z.literal(''), z.email({ error: 'Enter a valid email' })]),
    mobile: z
      .string()
      .trim()
      .refine((v) => v === '' || /^[6-9]\d{9}$/.test(v.replace(/^(\+91|0)/, '')), {
        error: 'Enter a 10-digit mobile number',
      }),
    roll_no: required('Roll number'),
    program_code: required('Program code'),
    admission_date: required('Admission date'),
    social_category: optional,
    residency_status: required('Residency status'),
    seat_quota_type: required('Seat quota'),
    nationality: optional,
    passport_no: optional,
    passport_expiry: optional,
    visa_type: optional,
    frro_reg_no: optional,
    oci_card_no: optional,
    embassy_sponsor_ref: optional,
  })
  .superRefine((s, ctx) => {
    const need = (field: keyof typeof s, label: string) => {
      if (!s[field]) ctx.addIssue({ code: 'custom', path: [field], message: `${label} is required` });
    };
    if (s.residency_status === 'FOREIGN_NATIONAL') {
      need('nationality', 'Nationality');
      need('passport_no', 'Passport number');
      need('passport_expiry', 'Passport expiry');
      need('visa_type', 'Visa type');
    }
    if (s.residency_status === 'OCI') need('oci_card_no', 'OCI card number');
    if (s.date_of_birth && s.admission_date && s.date_of_birth >= s.admission_date) {
      ctx.addIssue({ code: 'custom', path: ['admission_date'], message: 'Admission must be after date of birth' });
    }
  });

type StudentInput = z.input<typeof studentSchema>;
type StudentValues = z.output<typeof studentSchema>;

const EMPTY: StudentInput = {
  apaar_id: '',
  full_name: '',
  date_of_birth: '',
  gender: '',
  email: '',
  mobile: '',
  roll_no: '',
  program_code: '',
  admission_date: '',
  social_category: 'GEN',
  residency_status: 'INDIAN_RESIDENT',
  seat_quota_type: 'REGULAR_SANCTIONED',
  nationality: 'Indian',
  passport_no: '',
  passport_expiry: '',
  visa_type: '',
  frro_reg_no: '',
  oci_card_no: '',
  embassy_sponsor_ref: '',
};

function toRow(values: StudentValues): StudentRow {
  const isForeign = FOREIGN_RESIDENCY.includes(values.residency_status);
  const row: StudentRow = {
    ...values,
    is_fn: values.residency_status === 'FOREIGN_NATIONAL' ? 'Y' : 'N',
    is_oci_status: values.residency_status === 'OCI' ? 'Y' : 'N',
  };
  if (!isForeign) {
    for (const f of ['passport_no', 'passport_expiry', 'visa_type', 'frro_reg_no', 'oci_card_no', 'embassy_sponsor_ref'] as const) {
      delete row[f];
    }
  }
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== '')) as StudentRow;
}

interface ManualEntryFormProps {
  scope: BatchScope | null;
  onSubmitted: (batch: Batch) => void;
}

export function ManualEntryForm({ scope, onSubmitted }: ManualEntryFormProps) {
  const [queue, setQueue] = useState<StudentRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    control,
    setError: setFieldError,
    formState: { errors },
  } = useForm<StudentInput, unknown, StudentValues>({
    resolver: zodResolver(studentSchema),
    defaultValues: EMPTY,
  });

  const residency = useWatch({ control, name: 'residency_status' });
  const isForeign = FOREIGN_RESIDENCY.includes(residency);

  const addToBatch = handleSubmit((values) => {
    if (queue.some((r) => r.apaar_id === values.apaar_id)) {
      setFieldError('apaar_id', { message: 'This APAAR ID is already in the batch' });
      return;
    }
    if (queue.some((r) => r.roll_no === values.roll_no)) {
      setFieldError('roll_no', { message: 'This roll number is already in the batch' });
      return;
    }
    setQueue((q) => [...q, toRow(values)]);
    // Keep the fields that are usually the same for a whole class.
    reset({
      ...EMPTY,
      program_code: values.program_code,
      admission_date: values.admission_date,
    });
  });

  const submitBatch = async () => {
    if (!scope || queue.length === 0) return;
    setIsSubmitting(true);
    setError('');
    try {
      onSubmitted(await submitForm(scope, queue));
      setQueue([]);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className='space-y-5'>
      <form onSubmit={addToBatch} className='space-y-5' noValidate>
        <Section title='Identity'>
          <Field label='APAAR ID' error={errors.apaar_id?.message} required>
            <Input {...register('apaar_id')} placeholder='1234 5678 9012' inputMode='numeric' className='font-mono' />
          </Field>
          <Field label='Full name (as on APAAR)' error={errors.full_name?.message} required>
            <Input {...register('full_name')} autoComplete='off' />
          </Field>
          <Field label='Date of birth' error={errors.date_of_birth?.message} required>
            <Input {...register('date_of_birth')} type='date' />
          </Field>
          <Field label='Gender' error={errors.gender?.message}>
            <Select {...register('gender')}>
              <option value=''>Select</option>
              <option value='Male'>Male</option>
              <option value='Female'>Female</option>
              <option value='Transgender'>Transgender</option>
            </Select>
          </Field>
          <Field label='Email' error={errors.email?.message}>
            <Input {...register('email')} type='email' />
          </Field>
          <Field label='Mobile' error={errors.mobile?.message}>
            <Input {...register('mobile')} inputMode='tel' placeholder='9876543210' />
          </Field>
        </Section>

        <Section title='Admission'>
          <Field label='Roll / enrolment no.' error={errors.roll_no?.message} required>
            <Input {...register('roll_no')} />
          </Field>
          <Field label='Program code (AICTE course ID)' error={errors.program_code?.message} required>
            <Input {...register('program_code')} placeholder='1-1234567890' />
          </Field>
          <Field label='Admission date' error={errors.admission_date?.message} required>
            <Input {...register('admission_date')} type='date' />
          </Field>
          <Field label='Social category' error={errors.social_category?.message}>
            <Select {...register('social_category')}>
              {SOCIAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label='Residency status' error={errors.residency_status?.message} required>
            <Select {...register('residency_status')}>
              {RESIDENCY.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label='Seat quota' error={errors.seat_quota_type?.message} required>
            <Select {...register('seat_quota_type')}>
              {QUOTAS.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        {isForeign && (
          <Section title='Foreign national / OCI details'>
            <Field label='Nationality' error={errors.nationality?.message} required={residency === 'FOREIGN_NATIONAL'}>
              <Input {...register('nationality')} />
            </Field>
            <Field label='Passport no.' error={errors.passport_no?.message} required={residency === 'FOREIGN_NATIONAL'}>
              <Input {...register('passport_no')} className='uppercase' />
            </Field>
            <Field
              label='Passport expiry'
              error={errors.passport_expiry?.message}
              required={residency === 'FOREIGN_NATIONAL'}
            >
              <Input {...register('passport_expiry')} type='date' />
            </Field>
            <Field label='Visa type' error={errors.visa_type?.message} required={residency === 'FOREIGN_NATIONAL'}>
              <Input {...register('visa_type')} placeholder='Student visa' />
            </Field>
            <Field label='FRRO registration no.' error={errors.frro_reg_no?.message}>
              <Input {...register('frro_reg_no')} />
            </Field>
            {residency === 'OCI' && (
              <Field label='OCI card no.' error={errors.oci_card_no?.message} required>
                <Input {...register('oci_card_no')} />
              </Field>
            )}
            <Field label='Embassy sponsorship ref.' error={errors.embassy_sponsor_ref?.message}>
              <Input {...register('embassy_sponsor_ref')} />
            </Field>
          </Section>
        )}

        <button
          type='submit'
          className='border border-blue-600 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 px-4 py-2.5 rounded-xl text-xs font-semibold transition flex items-center gap-2 cursor-pointer'
        >
          <Plus className='size-4' />
          Add student to batch
        </button>
      </form>

      {queue.length > 0 && (
        <div className='rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden'>
          <div className='px-4 py-2.5 bg-neutral-50 dark:bg-neutral-800/60 text-xs font-semibold'>
            Batch ({queue.length} {queue.length === 1 ? 'student' : 'students'})
          </div>
          <div className='overflow-x-auto'>
            <table className='w-full text-left text-xs'>
              <thead>
                <tr className='text-neutral-500 border-b border-neutral-200 dark:border-neutral-800'>
                  <th className='px-4 py-2 font-semibold'>APAAR ID</th>
                  <th className='px-4 py-2 font-semibold'>Name</th>
                  <th className='px-4 py-2 font-semibold'>Roll no.</th>
                  <th className='px-4 py-2 font-semibold'>Program</th>
                  <th className='px-4 py-2 font-semibold'>Quota</th>
                  <th className='px-4 py-2' />
                </tr>
              </thead>
              <tbody className='divide-y divide-neutral-100 dark:divide-neutral-800/60'>
                {queue.map((row, i) => (
                  <tr key={row.apaar_id}>
                    <td className='px-4 py-2 font-mono text-blue-600 dark:text-blue-400'>{row.apaar_id}</td>
                    <td className='px-4 py-2 font-medium'>{row.full_name}</td>
                    <td className='px-4 py-2'>{row.roll_no}</td>
                    <td className='px-4 py-2'>{row.program_code}</td>
                    <td className='px-4 py-2 text-neutral-500'>{row.seat_quota_type}</td>
                    <td className='px-4 py-2 text-right'>
                      <button
                        type='button'
                        onClick={() => setQueue((q) => q.filter((_, j) => j !== i))}
                        className='p-1 rounded-md text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer'
                        aria-label={`Remove ${row.full_name}`}
                      >
                        <Trash2 className='size-3.5' />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (
        <div className='p-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 rounded-xl text-xs flex items-start gap-2'>
          <AlertTriangle className='size-4 shrink-0' />
          <span>{error}</span>
        </div>
      )}

      <div className='flex flex-wrap items-center gap-3'>
        <button
          type='button'
          onClick={() => void submitBatch()}
          disabled={!scope || queue.length === 0 || isSubmitting}
          className='bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
        >
          {isSubmitting ? <RefreshCw className='size-4 animate-spin' /> : <Send className='size-4' />}
          Submit {queue.length || ''} {queue.length === 1 ? 'student' : 'students'}
        </button>
        {!scope && <span className='text-[11px] text-neutral-500'>Choose an institution and academic year first.</span>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className='space-y-3'>
      <legend className='text-xs font-bold uppercase tracking-wider text-neutral-500 mb-2'>{title}</legend>
      <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'>{children}</div>
    </fieldset>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className='block space-y-1'>
      <span className='text-[11px] font-medium text-neutral-600 dark:text-neutral-300'>
        {label}
        {required && <span className='text-red-500'> *</span>}
      </span>
      {children}
      {error && <span className='block text-[11px] text-red-600'>{error}</span>}
    </label>
  );
}

const controlClass =
  'w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500';

function Input({ className, ...props }: UseFormRegisterReturn & React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(controlClass, className)} />;
}

function Select({ className, ...props }: UseFormRegisterReturn & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(controlClass, className)} />;
}
