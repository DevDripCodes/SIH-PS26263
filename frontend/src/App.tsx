import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Sun, Moon, LayoutDashboard } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ApaarDashboard } from '@/components/dashboard/apaar-dashboard';
import {
  TechOrbitHero,
  LoginPage,
  ForgotPasswordPage,
  ResetSentPage,
  type AuthMode,
  type AuthFormData,
} from '@/pages/auth';

export default function App() {
  const [view, setView] = useState<'auth' | 'dashboard'>('auth');
  const [isDarkMode, setIsDarkMode] = useState(false);
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
    setFormData((prevState) => ({
      ...prevState,
      [name]: value,
    }));
  };

  const handleLoginSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    console.log('Login submitted:', formData);
    setView('dashboard');
  };

  const handleForgotSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    console.log('Forgot password requested for:', formData.email);
    setAuthMode('reset-sent');
  };

  const orbitText = authMode === 'login' ? 'APAAR Portal' : 'Password Reset';

  if (view === 'dashboard') {
    return (
      <div className={isDarkMode ? 'dark' : ''}>
        <ApaarDashboard onSignOut={() => setView('auth')} />
      </div>
    );
  }

  return (
    <main
      className={`min-h-screen w-full transition-colors duration-300 ${
        isDarkMode ? 'dark bg-[#030712] text-white' : 'bg-white text-neutral-900'
      }`}
    >
      {/* Top Header Controls: Dashboard shortcut & Theme Toggle */}
      <div className='fixed top-5 right-5 z-50 flex items-center gap-2'>
        <button
          onClick={() => setView('dashboard')}
          className='flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-md transition cursor-pointer'
        >
          <LayoutDashboard className='w-3.5 h-3.5' />
          <span>Launch Live Dashboard</span>
        </button>

        <button
          onClick={() => setIsDarkMode(!isDarkMode)}
          className='flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-full border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur shadow-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition cursor-pointer'
          aria-label='Toggle theme'
        >
          {isDarkMode ? (
            <>
              <Sun className='w-4 h-4 text-amber-400' />
              <span>Light</span>
            </>
          ) : (
            <>
              <Moon className='w-4 h-4 text-neutral-600' />
              <span>Dark</span>
            </>
          )}
        </button>
      </div>

      <section className='flex max-lg:justify-center min-h-screen'>
        {/* Left Side: Animated Orbit Display & Ripple */}
        <TechOrbitHero text={orbitText} />

        {/* Right Side: Auth Container */}
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
                <LoginPage
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
                <ForgotPasswordPage
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
                <ResetSentPage
                  email={formData.email}
                  onSwitchMode={setAuthMode}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </span>
      </section>
    </main>
  );
}
