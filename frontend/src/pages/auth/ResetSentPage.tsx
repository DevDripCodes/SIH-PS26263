import { useState } from 'react';
import { MailCheck, RotateCw, ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { BoxReveal, BottomGradient } from '@/components/ui/modern-animated-sign-in';
import type { AuthMode } from './types';

interface ResetSentPageProps {
  email: string;
  onSwitchMode: (mode: AuthMode) => void;
}

export function ResetSentPage({ email, onSwitchMode }: ResetSentPageProps) {
  const [resendStatus, setResendStatus] = useState<string>('');

  const handleResend = () => {
    setResendStatus('Recovery email resent!');
    setTimeout(() => setResendStatus(''), 3000);
  };

  return (
    <div className='w-full max-w-sm px-4 flex flex-col items-center text-center'>
      {/* Glowing Success Icon */}
      <BoxReveal boxColor='var(--skeleton)' duration={0.3}>
        <div className='mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 shadow-[0_0_24px_rgba(59,130,246,0.25)]'>
          <MailCheck className='size-8' />
        </div>
      </BoxReveal>

      {/* Title */}
      <BoxReveal boxColor='var(--skeleton)' duration={0.3}>
        <h2 className='text-3xl font-bold text-neutral-800 dark:text-neutral-100'>
          Check your email
        </h2>
      </BoxReveal>

      {/* Details */}
      <BoxReveal boxColor='var(--skeleton)' duration={0.3} className='mt-2'>
        <p className='text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed'>
          We sent a password recovery link to{' '}
          <span className='font-semibold text-neutral-900 dark:text-white'>
            {email || 'your email'}
          </span>
          . Follow the instructions inside to reset your password.
        </p>
      </BoxReveal>

      {/* Action Buttons */}
      <div className='w-full mt-6 flex flex-col gap-3'>
        <BoxReveal boxColor='var(--skeleton)' duration={0.3} width='100%'>
          <button
            onClick={handleResend}
            type='button'
            className='bg-gradient-to-br relative group/btn from-zinc-200 dark:from-zinc-900 dark:to-zinc-900 to-zinc-200 flex items-center justify-center gap-2 dark:bg-zinc-800 w-full text-black dark:text-white rounded-md h-10 font-medium shadow-[0px_1px_0px_0px_#ffffff40_inset,0px_-1px_0px_0px_#ffffff40_inset] dark:shadow-[0px_1px_0px_0px_var(--zinc-800)_inset,0px_-1px_0px_0px_var(--zinc-800)_inset] outline-none hover:cursor-pointer'
          >
            <RotateCw className='size-4' />
            Resend link
            <BottomGradient />
          </button>
        </BoxReveal>

        {resendStatus && (
          <motion.p
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className='text-xs text-emerald-600 dark:text-emerald-400 font-medium'
          >
            {resendStatus}
          </motion.p>
        )}

        <BoxReveal boxColor='var(--skeleton)' duration={0.3} width='100%'>
          <button
            onClick={() => onSwitchMode('login')}
            type='button'
            className='w-full flex items-center justify-center gap-2 py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-blue-500 dark:hover:text-blue-400 transition cursor-pointer'
          >
            <ArrowLeft className='size-4' />
            Back to sign in
          </button>
        </BoxReveal>
      </div>
    </div>
  );
}
