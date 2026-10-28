import type { UserRole } from '@/types/apaar';
import {
  ShieldCheck,
  School,
  Building2,
  QrCode,
  IdCard,
  LogOut,
} from 'lucide-react';

interface DashboardHeaderProps {
  activeRole: UserRole;
  onSelectRole: (role: UserRole) => void;
  onSignOut: () => void;
}

export function DashboardHeader({
  activeRole,
  onSelectRole,
  onSignOut,
}: DashboardHeaderProps) {
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
              title='Sign out'
              className='p-2 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition text-neutral-600 dark:text-neutral-300 cursor-pointer'
            >
              <LogOut className='size-4' />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Role Switcher */}
      <div className='md:hidden flex overflow-x-auto px-4 py-2 border-t border-neutral-100 dark:border-neutral-800 gap-1 text-xs'>
        {(['institution', 'aicte-admin', 'verifier', 'student'] as UserRole[]).map(
          (role) => (
            <button
              key={role}
              onClick={() => onSelectRole(role)}
              className={`px-2.5 py-1 rounded-md shrink-0 capitalize ${
                activeRole === role
                  ? 'bg-blue-600 text-white font-medium'
                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
              }`}
            >
              {role.replace('-', ' ')}
            </button>
          )
        )}
      </div>
    </header>
  );
}
