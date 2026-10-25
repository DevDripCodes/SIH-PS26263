import { useState } from 'react';
import type { StudentRecord } from '@/types/apaar';
import { QrCode, Search } from 'lucide-react';
import { VerificationResultCard } from './VerificationResultCard';

interface PublicVerifierPortalProps {
  students: StudentRecord[];
}

export function PublicVerifierPortal({ students }: PublicVerifierPortalProps) {
  const [verifyInput, setVerifyInput] = useState('9420-1845-6712');
  const [verifiedRecord, setVerifiedRecord] = useState<StudentRecord | null>(
    students[0] || null
  );
  const [verifySearched, setVerifySearched] = useState(true);

  const handleVerify = () => {
    setVerifySearched(true);
    const found = students.find((s) => s.apaarId.trim() === verifyInput.trim());
    setVerifiedRecord(found || null);
  };

  return (
    <div className='max-w-2xl mx-auto space-y-6'>
      <div className='text-center space-y-2'>
        <div className='size-12 mx-auto rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center border border-blue-200 dark:border-blue-800'>
          <QrCode className='size-6' />
        </div>
        <h1 className='text-2xl font-bold text-neutral-900 dark:text-white'>
          Authorized Credential Verification Portal
        </h1>
        <p className='text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed max-w-md mx-auto'>
          Instantly verify the authenticity of student credentials and degrees issued by AICTE-approved institutions using the national APAAR ID.
        </p>
      </div>

      {/* Search Input Bar */}
      <div className='bg-white dark:bg-neutral-900 p-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-md flex items-center gap-2'>
        <Search className='size-5 text-neutral-400 ml-2' />
        <input
          type='text'
          value={verifyInput}
          onChange={(e) => setVerifyInput(e.target.value)}
          placeholder='Enter 12-digit APAAR ID (e.g. 9420-1845-6712)'
          className='w-full px-2 py-2 text-sm bg-transparent focus:outline-none font-mono text-neutral-900 dark:text-white'
        />
        <button
          onClick={handleVerify}
          className='bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition shrink-0 cursor-pointer shadow-sm'
        >
          Verify Record
        </button>
      </div>

      {/* Verification Result Card */}
      {verifySearched && <VerificationResultCard record={verifiedRecord} />}
    </div>
  );
}
