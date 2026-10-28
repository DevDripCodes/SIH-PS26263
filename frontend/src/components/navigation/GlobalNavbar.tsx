import type { UserRole } from '@/types/apaar';
import {
  ShieldCheck,
  School,
  Building2,
  QrCode,
  IdCard,
  LogOut,
} from 'lucide-react';

interface GlobalNavbarProps {
  activeRole: UserRole;
  onSelectRole: (role: UserRole) => void;
  onSignOut: () => void;
}

export function GlobalNavbar({
  activeRole,
  onSelectRole,
  onSignOut,
}: GlobalNavbarProps) {
  return (
    <header className='sticky top-0 z-40 bg-white/95 dark:bg-neutral-900/95 backdrop-blur border-b border-neutral-200 dark:border-neutral-800 shadow-sm'>
      <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
        <div className='flex items-center justify-between h-16'>
          {/* National Branding */}
          <div className='flex items-center gap-3'>
            <div className='size-10 rounded-xl bg-blue-600 bg-gradient-to-tr from-blue-700 via-indigo-600 to-sky-500 flex items-center justify-center text-white font-bold shadow-md shadow-blue-500/20'>
              <ShieldCheck className='size-6 text-white' />
            </div>
            <div>
              <div className='flex items-center gap-2'>
                <span className='font-bold text-base sm:text-lg tracking-tight text-neutral-900 dark:text-white'>
                  APAAR
                </span>
                <span className='text-[10px] font-semibold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200/80 dark:bg-blue-950/80 dark:text-blue-300 dark:border-blue-800 px-2 py-0.5 rounded-full'>
                  AICTE Central Portal
                </span>
              </div>
              <p className='text-xs text-neutral-500 dark:text-neutral-400 hidden sm:block'>
                One Nation, One Student ID • Data Management & Verification Platform
              </p>
            </div>
          </div>

          {/* Role Switcher Pill */}
          <div className='hidden md:flex items-center bg-neutral-100 dark:bg-neutral-800 p-1 rounded-xl text-xs font-medium'>
            <button
              onClick={() => onSelectRole('institution')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                activeRole === 'institution'
                  ? 'bg-white dark:bg-neutral-900 text-blue-600 dark:text-blue-400 shadow-sm font-semibold'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              <School className='size-3.5' />
              Institution Portal
            </button>
            <button
              onClick={() => onSelectRole('aicte-admin')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                activeRole === 'aicte-admin'
                  ? 'bg-white dark:bg-neutral-900 text-blue-600 dark:text-blue-400 shadow-sm font-semibold'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              <Building2 className='size-3.5' />
              AICTE Apex Monitor
            </button>
            <button
              onClick={() => onSelectRole('verifier')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                activeRole === 'verifier'
                  ? 'bg-white dark:bg-neutral-900 text-blue-600 dark:text-blue-400 shadow-sm font-semibold'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              <QrCode className='size-3.5' />
              Public Verifier
            </button>
            <button
              onClick={() => onSelectRole('student')}
              className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                activeRole === 'student'
                  ? 'bg-white dark:bg-neutral-900 text-blue-600 dark:text-blue-400 shadow-sm font-semibold'
                  : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              <IdCard className='size-3.5' />
              Student Passport
            </button>
          </div>

          {/* User Profile & Sign Out */}
          <div className='flex items-center gap-2.5'>
            <div className='hidden sm:block text-right'>
              <p className='text-xs font-semibold text-neutral-900 dark:text-white'>
                MAIT
              </p>
              <p className='text-[10px] text-neutral-500'>New Delhi</p>
            </div>
            <button
              onClick={onSignOut}
              className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-700 transition cursor-pointer'
              title='Sign Out to Login'
            >
              <LogOut className='size-3.5' />
              <span className='hidden sm:inline'>Sign out</span>
            </button>
          </div>
        </div>

        {/* Mobile Role Switcher Tab Row */}
        <div className='flex md:hidden items-center justify-around py-2 border-t border-neutral-200 dark:border-neutral-800 text-xs overflow-x-auto'>
          <button
            onClick={() => onSelectRole('institution')}
            className={`px-2 py-1 rounded whitespace-nowrap ${
              activeRole === 'institution'
                ? 'font-bold text-blue-600'
                : 'text-neutral-500'
            }`}
          >
            Institution
          </button>
          <button
            onClick={() => onSelectRole('aicte-admin')}
            className={`px-2 py-1 rounded whitespace-nowrap ${
              activeRole === 'aicte-admin'
                ? 'font-bold text-blue-600'
                : 'text-neutral-500'
            }`}
          >
            Apex Admin
          </button>
          <button
            onClick={() => onSelectRole('verifier')}
            className={`px-2 py-1 rounded whitespace-nowrap ${
              activeRole === 'verifier'
                ? 'font-bold text-blue-600'
                : 'text-neutral-500'
            }`}
          >
            Verifier
          </button>
          <button
            onClick={() => onSelectRole('student')}
            className={`px-2 py-1 rounded whitespace-nowrap ${
              activeRole === 'student'
                ? 'font-bold text-blue-600'
                : 'text-neutral-500'
            }`}
          >
            Student
          </button>
        </div>
      </div>
    </header>
  );
}
