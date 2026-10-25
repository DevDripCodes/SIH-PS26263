import { useState } from 'react';
import type { StudentRecord } from '@/types/apaar';
import { X } from 'lucide-react';

interface AddStudentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddStudent: (student: StudentRecord) => void;
}

export function AddStudentModal({
  isOpen,
  onClose,
  onAddStudent,
}: AddStudentModalProps) {
  const [formData, setFormData] = useState({
    name: '',
    apaarId: '',
    program: 'Computer Science & Engineering',
    category: 'Merit',
    admissionYear: '2026',
    dualEnrollmentStatus: 'Clear' as const,
  });

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.apaarId) return;

    onAddStudent({
      id: String(Date.now()),
      name: formData.name,
      apaarId: formData.apaarId,
      institution: 'Delhi Technological University',
      course: formData.program,
      program: formData.program,
      category: formData.category,
      admissionYear: formData.admissionYear,
      status: 'Verified',
      verificationStatus: 'Verified',
      dualEnrollmentStatus: formData.dualEnrollmentStatus,
      abcLinked: true,
      submissionDate: new Date().toISOString().split('T')[0],
    });

    onClose();
  };

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs'>
      <div className='bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative'>
        <button
          onClick={onClose}
          className='absolute top-5 right-5 text-neutral-400 hover:text-neutral-700 dark:hover:text-white transition'
        >
          <X className='size-5' />
        </button>

        <h3 className='text-lg font-bold text-neutral-900 dark:text-white mb-1'>
          Register New Student Record
        </h3>
        <p className='text-xs text-neutral-500 dark:text-neutral-400 mb-5'>
          Record student admission anchored to APAAR ID & verified against AICTE approved intake.
        </p>

        <form onSubmit={handleSubmit} className='space-y-4 text-xs'>
          <div>
            <label className='block font-semibold text-neutral-700 dark:text-neutral-300 mb-1'>
              Student Full Name *
            </label>
            <input
              type='text'
              required
              placeholder='e.g., Aditya Sharma'
              value={formData.name}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, name: e.target.value }))
              }
              className='w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500'
            />
          </div>

          <div>
            <label className='block font-semibold text-neutral-700 dark:text-neutral-300 mb-1'>
              APAAR ID (12 Digits) *
            </label>
            <input
              type='text'
              required
              maxLength={14}
              placeholder='9021-4829-1029'
              value={formData.apaarId}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, apaarId: e.target.value }))
              }
              className='w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500'
            />
          </div>

          <div className='grid grid-cols-2 gap-3'>
            <div>
              <label className='block font-semibold text-neutral-700 dark:text-neutral-300 mb-1'>
                Admission Category
              </label>
              <select
                value={formData.category}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, category: e.target.value }))
                }
                className='w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500'
              >
                <option value='Regular'>Merit / Regular (State Counseling)</option>
                <option value='Management'>Management Quota</option>
                <option value='Supernumerary (EWS/TFW)'>EWS / TFW Supernumerary</option>
                <option value='NRI'>NRI Quota</option>
                <option value='Foreign National (FN)'>Foreign National (FN)</option>
              </select>
            </div>

            <div>
              <label className='block font-semibold text-neutral-700 dark:text-neutral-300 mb-1'>
                Academic Year
              </label>
              <input
                type='text'
                disabled
                value='2026-2027'
                className='w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800/50 text-neutral-500'
              />
            </div>
          </div>

          <div>
            <label className='block font-semibold text-neutral-700 dark:text-neutral-300 mb-1'>
              Enrolled Department / Program
            </label>
            <select
              value={formData.program}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, program: e.target.value }))
              }
              className='w-full px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500'
            >
              <option value='Computer Science & Engineering'>
                Computer Science & Engineering
              </option>
              <option value='Artificial Intelligence & Data Science'>
                Artificial Intelligence & Data Science
              </option>
              <option value='Electronics & Communication Eng.'>
                Electronics & Communication Eng.
              </option>
              <option value='Mechanical Engineering'>
                Mechanical Engineering
              </option>
              <option value='MBA - Business Analytics'>
                MBA - Business Analytics
              </option>
            </select>
          </div>

          <div className='pt-4 flex items-center justify-end gap-2 border-t border-neutral-200 dark:border-neutral-800'>
            <button
              type='button'
              onClick={onClose}
              className='px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800 transition'
            >
              Cancel
            </button>
            <button
              type='submit'
              className='px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-md shadow-blue-500/20 transition'
            >
              Validate & Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
