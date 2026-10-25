import type { FormEvent } from 'react';
import { AuthTabs } from '@/components/ui/modern-animated-sign-in';
import type { AuthPageProps } from './types';

export function ForgotPasswordPage({
  onInputChange,
  onSubmit,
  onSwitchMode,
}: AuthPageProps) {
  const forgotFormFields = {
    header: 'Reset password',
    subHeader: 'Enter your email and we will send you a reset link',
    fields: [
      {
        label: 'Email',
        required: true,
        type: 'email' as const,
        placeholder: 'Enter your registered email address',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onInputChange(event, 'email'),
      },
    ],
    submitButton: 'Send reset link',
    textVariantButton: '← Back to sign in',
  };

  return (
    <div className='w-full flex justify-center'>
      <AuthTabs
        formFields={forgotFormFields}
        goTo={(e: FormEvent) => {
          e.preventDefault();
          onSwitchMode('login');
        }}
        handleSubmit={onSubmit}
        googleLogin={undefined}
      />
    </div>
  );
}
