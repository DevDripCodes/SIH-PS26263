import { useState, type ChangeEvent, type FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  TechOrbitHero,
  LoginForm,
  ForgotPasswordForm,
  ResetSentCard,
  type AuthMode,
  type AuthFormData,
} from './components';

interface AuthPageProps {
  onLoginSuccess: () => void;
}

export function AuthPage({ onLoginSuccess }: AuthPageProps) {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [formData, setFormData] = useState<AuthFormData>({
    email: '',
    password: '',
  });

  const handleInputChange = (
    event: ChangeEvent<HTMLInputElement>,
    name: keyof AuthFormData
  ) => {
    const value = event.target.value;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleLoginSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    console.log('Login submitted:', formData);
    onLoginSuccess();
  };

  const handleForgotSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    console.log('Forgot password for:', formData.email);
    setAuthMode('reset-sent');
  };

  const orbitText = authMode === 'login' ? 'APAAR Portal' : 'Password Reset';

  return (
    <section className='flex max-lg:justify-center min-h-screen'>
      {/* 1. Left Side: Animated Orbit Display */}
      <TechOrbitHero text={orbitText} />

      {/* 2. Right Side: Isolated Auth Container */}
      <span className='w-1/2 h-[100dvh] flex flex-col justify-center items-center max-lg:w-full max-lg:px-[10%]'>
        <AnimatePresence mode='wait'>
          {authMode === 'login' && (
            <motion.div
              key='login'
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
              className='w-full flex justify-center'
            >
              <LoginForm
                formData={formData}
                onInputChange={handleInputChange}
                onSubmit={handleLoginSubmit}
                onSwitchMode={setAuthMode}
              />
            </motion.div>
          )}

          {authMode === 'forgot-password' && (
            <motion.div
              key='forgot-password'
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25 }}
              className='w-full flex justify-center'
            >
              <ForgotPasswordForm
                formData={formData}
                onInputChange={handleInputChange}
                onSubmit={handleForgotSubmit}
                onSwitchMode={setAuthMode}
              />
            </motion.div>
          )}

          {authMode === 'reset-sent' && (
            <motion.div
              key='reset-sent'
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25 }}
              className='w-full flex justify-center'
            >
              <ResetSentCard
                email={formData.email}
                onSwitchMode={setAuthMode}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </span>
    </section>
  );
}
