import { useState } from 'react';
import { Sun, Moon, LayoutDashboard } from 'lucide-react';
import { ApaarDashboard } from '@/components/dashboard/apaar-dashboard';
import { AuthPage } from '@/pages/auth';

export default function App() {
  const [view, setView] = useState<'auth' | 'dashboard'>('auth');
  const [isDarkMode, setIsDarkMode] = useState(false);

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

      {/* Fully Modular Auth Page Component */}
      <AuthPage onLoginSuccess={() => setView('dashboard')} />
    </main>
  );
}
