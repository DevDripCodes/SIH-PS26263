import type { ChangeEvent, FormEvent, ReactNode } from 'react';

export type AuthMode = 'login' | 'forgot-password' | 'reset-sent';

export type AuthFormData = {
  email: string;
  password: string;
};

export interface OrbitIcon {
  component: () => ReactNode;
  className: string;
  duration?: number;
  delay?: number;
  radius?: number;
  path?: boolean;
  reverse?: boolean;
}

export interface AuthPageProps {
  formData: AuthFormData;
  onInputChange: (event: ChangeEvent<HTMLInputElement>, name: keyof AuthFormData) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSwitchMode: (mode: AuthMode) => void;
}
