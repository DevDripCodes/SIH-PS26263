import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import {
  Ripple,
  AuthTabs,
  TechOrbitDisplay,
  BoxReveal,
  BottomGradient,
} from '@/components/ui/modern-animated-sign-in';
import { Sun, Moon, MailCheck, ArrowLeft, RotateCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type AuthMode = 'login' | 'forgot-password' | 'reset-sent';

type FormData = {
  email: string;
  password: string;
};

interface OrbitIcon {
  component: () => ReactNode;
  className: string;
  duration?: number;
  delay?: number;
  radius?: number;
  path?: boolean;
  reverse?: boolean;
}

const iconsArray: OrbitIcon[] = [
  {
    component: () => (
      <img
        width={30}
        height={30}
        src='https://cdn.21st.dev/assets/mirror/34/34826e5b3315daadf4fa15f723a3c1d5ba4a89277bfd94e22ac4d7d3d54338c5.svg'
        alt='HTML5'
      />
    ),
    className: 'size-[30px] border-none bg-transparent',
    duration: 20,
    delay: 20,
    radius: 100,
    path: false,
    reverse: false,
  },
  {
    component: () => (
      <img
        width={30}
        height={30}
        src='https://cdn.21st.dev/assets/mirror/36/36b7d94b657d571d3f94042acbf6a4c86a5301a222f83f4b4583ad2acf6e297d.svg'
        alt='CSS3'
      />
    ),
    className: 'size-[30px] border-none bg-transparent',
    duration: 20,
    delay: 10,
    radius: 100,
    path: false,
    reverse: false,
  },
  {
    component: () => (
      <img
        width={50}
        height={50}
        src='https://cdn.21st.dev/assets/mirror/c9/c9191199f4049920c2fc19035b8a6664f37f4689fcd9e8434e786097e78863f0.svg'
        alt='TypeScript'
      />
    ),
    className: 'size-[50px] border-none bg-transparent',
    radius: 210,
    duration: 20,
    path: false,
    reverse: false,
  },
  {
    component: () => (
      <img
        width={50}
        height={50}
        src='https://cdn.21st.dev/assets/mirror/06/0656ff65fc8eeacda5c78d7f9ffe91ec1eb919db64f56e0b7dcd460af4bbd36c.svg'
        alt='JavaScript'
      />
    ),
    className: 'size-[50px] border-none bg-transparent',
    radius: 210,
    duration: 20,
    delay: 20,
    path: false,
    reverse: false,
  },
  {
    component: () => (
      <img
        width={30}
        height={30}
        src='https://cdn.21st.dev/assets/mirror/f8/f8cec54589553807eb603bcaf4e056aa090196211698b056542e3cc62a2f3448.svg'
        alt='TailwindCSS'
      />
    ),
    className: 'size-[30px] border-none bg-transparent',
    duration: 20,
    delay: 20,
    radius: 150,
    path: false,
    reverse: true,
  },
  {
    component: () => (
      <img
        width={30}
        height={30}
        src='https://cdn.21st.dev/assets/mirror/d9/d9435c4ede7133b376c0173a80226bb3856729366707cd96e9a66e39448d0288.svg'
        alt='Nextjs'
      />
    ),
    className: 'size-[30px] border-none bg-transparent',
    duration: 20,
    delay: 10,
    radius: 150,
    path: false,
    reverse: true,
  },
  {
    component: () => (
      <img
        width={50}
        height={50}
        src='https://cdn.21st.dev/assets/mirror/58/5825b649c8c04dec13ecf01d0182401bd0ec71789d2fa06224866d882cd1515f.svg'
        alt='React'
      />
    ),
    className: 'size-[50px] border-none bg-transparent',
    radius: 270,
    duration: 20,
    path: false,
    reverse: true,
  },
  {
    component: () => (
      <img
        width={50}
        height={50}
        src='https://cdn.21st.dev/assets/mirror/d3/d37c2bf1a1d4f10aeffb224e44da672cb8b9510f6e5a2e24b61758262995805e.svg'
        alt='Figma'
      />
    ),
    className: 'size-[50px] border-none bg-transparent',
    radius: 270,
    duration: 20,
    delay: 60,
    path: false,
    reverse: true,
  },
  {
    component: () => (
      <img
        width={50}
        height={50}
        src='https://cdn.21st.dev/assets/mirror/71/717a57ea97bf7e86de721dab3e68afac66332a10676d5c9abce4ae6a5a9c9983.svg'
        alt='Git'
      />
    ),
    className: 'size-[50px] border-none bg-transparent',
    radius: 320,
    duration: 20,
    delay: 20,
    path: false,
    reverse: false,
  },
];

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [resendStatus, setResendStatus] = useState<string>('');
  const [formData, setFormData] = useState<FormData>({
    email: '',
    password: '',
  });

  const handleInputChange = (
    event: ChangeEvent<HTMLInputElement>,
    name: keyof FormData
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
  };

  const handleForgotSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    console.log('Forgot password requested for:', formData.email);
    setAuthMode('reset-sent');
  };

  const handleResend = () => {
    setResendStatus('Recovery email resent!');
    setTimeout(() => setResendStatus(''), 3000);
  };

  const loginFormFields = {
    header: 'Welcome back',
    subHeader: 'Sign in to your account',
    fields: [
      {
        label: 'Email',
        required: true,
        type: 'email' as const,
        placeholder: 'Enter your email address',
        onChange: (event: ChangeEvent<HTMLInputElement>) =>
          handleInputChange(event, 'email'),
      },
      {
        label: 'Password',
        required: true,
        type: 'password' as const,
        placeholder: 'Enter your password',
        onChange: (event: ChangeEvent<HTMLInputElement>) =>
          handleInputChange(event, 'password'),
      },
    ],
    submitButton: 'Sign in',
    textVariantButton: 'Forgot password?',
  };

  const forgotFormFields = {
    header: 'Reset password',
    subHeader: 'Enter your email and we will send you a reset link',
    fields: [
      {
        label: 'Email',
        required: true,
        type: 'email' as const,
        placeholder: 'Enter your registered email address',
        onChange: (event: ChangeEvent<HTMLInputElement>) =>
          handleInputChange(event, 'email'),
      },
    ],
    submitButton: 'Send reset link',
    textVariantButton: '← Back to sign in',
  };

  const orbitText = authMode === 'login' ? 'Animated Login' : 'Password Reset';

  return (
    <main
      className={`min-h-screen w-full transition-colors duration-300 ${
        isDarkMode ? 'dark bg-[#030712] text-white' : 'bg-white text-neutral-900'
      }`}
    >
      {/* Theme Toggle Button in Top Right */}
      <div className='fixed top-5 right-5 z-50'>
        <button
          onClick={() => setIsDarkMode(!isDarkMode)}
          className='flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-full border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur shadow-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 transition cursor-pointer'
          aria-label='Toggle theme'
        >
          {isDarkMode ? (
            <>
              <Sun className='w-4 h-4 text-amber-400' />
              <span>Light Mode</span>
            </>
          ) : (
            <>
              <Moon className='w-4 h-4 text-neutral-600' />
              <span>Dark Mode</span>
            </>
          )}
        </button>
      </div>

      <section className='flex max-lg:justify-center min-h-screen'>
        {/* Left Side: Animated Orbit Display & Ripple */}
        <span className='flex flex-col justify-center w-1/2 max-lg:hidden relative overflow-hidden bg-neutral-50/50 dark:bg-black/20 border-r border-neutral-100 dark:border-neutral-800/40'>
          <Ripple mainCircleSize={120} className='w-full max-w-none' />
          <TechOrbitDisplay iconsArray={iconsArray} text={orbitText} />
        </span>

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
                <AuthTabs
                  formFields={loginFormFields}
                  goTo={(e) => {
                    e.preventDefault();
                    setAuthMode('forgot-password');
                  }}
                  handleSubmit={handleLoginSubmit}
                  googleLogin='Login with Google'
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
                <AuthTabs
                  formFields={forgotFormFields}
                  goTo={(e) => {
                    e.preventDefault();
                    setAuthMode('login');
                  }}
                  handleSubmit={handleForgotSubmit}
                  googleLogin={undefined}
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
                className='w-full max-w-sm px-4 flex flex-col items-center text-center'
              >
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
                      {formData.email || 'your email'}
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
                      className='bg-gradient-to-br relative group/btn from-zinc-200 dark:from-zinc-900 dark:to-zinc-900 to-zinc-200 flex items-center justify-center gap-2 dark:bg-zinc-800 w-full text-black dark:text-white rounded-md h-10 font-medium shadow-[0px_1px_0px_0px_#ffffff40_inset,0px_-1px_0px_0px_#ffffff40_inset] dark:shadow-[0px_1px_0px_0px_var(--zinc-800)_inset,0px_-1px_0px_0px_var(--zinc-800)_inset] outline-hidden hover:cursor-pointer'
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
                      onClick={() => setAuthMode('login')}
                      type='button'
                      className='w-full flex items-center justify-center gap-2 py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-blue-500 dark:hover:text-blue-400 transition cursor-pointer'
                    >
                      <ArrowLeft className='size-4' />
                      Back to sign in
                    </button>
                  </BoxReveal>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </span>
      </section>
    </main>
  );
}
