import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { getCurrentUser, logout } from '@/api/auth';
import {
  AUTH_SESSION_EXPIRED_EVENT,
  clearAuthSession,
  hasAuthSession,
} from '@/api/auth-session';
import { ApaarDashboard } from '@/components/dashboard/apaar-dashboard';
import { AuthPage } from '@/pages/auth';

export default function App() {
  const [view, setView] = useState<'auth' | 'dashboard'>('auth');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isRestoringSession, setIsRestoringSession] = useState(hasAuthSession());

  useEffect(() => {
    let isMounted = true;

    if (hasAuthSession()) {
      void getCurrentUser()
        .then(() => {
          if (isMounted) setView('dashboard');
        })
        .catch(() => {
          clearAuthSession();
        })
        .finally(() => {
          if (isMounted) setIsRestoringSession(false);
        });
    } else {
      setIsRestoringSession(false);
    }

    const handleSessionExpired = () => {
      if (isMounted) {
        setView('auth');
        setIsRestoringSession(false);
      }
    };

    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      isMounted = false;
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, []);

  const handleSignOut = async () => {
    try {
      await logout();
    } catch {
      clearAuthSession();
    } finally {
      setView('auth');
    }
  };

  if (view === 'dashboard') {
    return (
      <div className={isDarkMode ? 'dark' : ''}>
        <ApaarDashboard onSignOut={handleSignOut} />
      </div>
    );
  }

  if (isRestoringSession) {
    return (
      <main className='min-h-screen w-full flex items-center justify-center bg-[#030712] text-white'>
        <p className='text-sm text-neutral-400'>Restoring your session...</p>
      </main>
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

      {/* Fully Modular Auth Page Component */}
      <AuthPage onLoginSuccess={() => setView('dashboard')} />
    </main>
  );
}
