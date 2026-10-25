import type { FormEvent } from 'react';
import { AuthTabs } from '@/components/ui/modern-animated-sign-in';
import type { AuthPageProps } from './types';

export function LoginForm({
  onInputChange,
  onSubmit,
  onSwitchMode,
}: AuthPageProps) {
  const loginFormFields = {
    header: 'Welcome back',
    subHeader: 'Sign in to access AICTE APAAR Platform',
    fields: [
      {
        label: 'Email',
        required: true,
        type: 'email' as const,
        placeholder: 'Enter institution admin or student email',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onInputChange(event, 'email'),
      },
      {
        label: 'Password',
        required: true,
        type: 'password' as const,
        placeholder: 'Enter your password',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          onInputChange(event, 'password'),
      },
    ],
    submitButton: 'Sign in to Dashboard',
    textVariantButton: 'Forgot password?',
  };

  return (
    <div className='w-full flex justify-center'>
      <AuthTabs
        formFields={loginFormFields}
        goTo={(e: FormEvent) => {
          e.preventDefault();
          onSwitchMode('forgot-password');
        }}
        handleSubmit={onSubmit}
        googleLogin='Login with Google'
      />
    </div>
  );
}
