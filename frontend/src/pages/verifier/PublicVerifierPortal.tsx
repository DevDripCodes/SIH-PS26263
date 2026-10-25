import { useState } from 'react';
import type { StudentRecord } from '@/types/apaar';
import { QrCode } from 'lucide-react';
import { VerifierSearchBox, VerificationResultCard } from './components';

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

      {/* 1. Verifier Search Input Bar Component */}
      <VerifierSearchBox
        value={verifyInput}
        onChange={setVerifyInput}
        onVerify={handleVerify}
      />

      {/* 2. Verification Result Card Component */}
      {verifySearched && <VerificationResultCard record={verifiedRecord} />}
    </div>
  );
}
