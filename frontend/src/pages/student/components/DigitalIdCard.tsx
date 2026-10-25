import type { StudentRecord } from '@/types/apaar';
import { ShieldCheck, QrCode, Sparkles, Download } from 'lucide-react';

interface DigitalIdCardProps {
  student: StudentRecord;
}

export function DigitalIdCard({ student }: DigitalIdCardProps) {
  const programName = student.program || student.course || 'Computer Science & Engineering';

  return (
    <div className='relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-blue-900 text-white p-7 shadow-2xl border border-slate-700/60'>
      <div className='flex items-start justify-between'>
        <div className='flex items-center gap-3'>
          <div className='size-11 rounded-2xl bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center font-bold'>
            <ShieldCheck className='size-6 text-white' />
          </div>
          <div>
            <span className='text-[10px] uppercase font-bold tracking-widest text-sky-300'>
              Republic of India • AICTE
            </span>
            <h4 className='font-bold text-base tracking-tight text-white'>
              National Student Identity Card
            </h4>
          </div>
        </div>
        <span className='px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'>
          Active
        </span>
      </div>

      <div className='mt-8 flex items-end justify-between'>
        <div>
          <p className='text-[11px] text-slate-300 uppercase tracking-wider'>
            Automated Permanent Academic Account Registry
          </p>
          <p className='text-2xl font-mono font-bold tracking-widest mt-1 text-white'>
            {student.apaarId}
          </p>

          <div className='mt-6 space-y-1'>
            <p className='text-lg font-bold text-white'>{student.name}</p>
            <p className='text-xs text-slate-300'>{programName}</p>
            <p className='text-[11px] text-slate-400'>
              {student.institution || 'Delhi Technological University (AICTE ID: 1-9321482)'}
            </p>
          </div>
        </div>

        <div className='p-3 bg-white rounded-2xl shadow-inner'>
          <QrCode className='size-20 text-slate-900' />
          <p className='text-[9px] text-center font-mono text-slate-600 mt-1'>
            SCAN TO VERIFY
          </p>
        </div>
      </div>

      <div className='mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-300'>
        <span className='flex items-center gap-1.5'>
          <Sparkles className='size-3.5 text-amber-300' /> ABC Linked • DigiLocker Secured
        </span>
        <button
          type='button'
          onClick={() => alert('Downloading official AICTE APAAR Smart Card PDF...')}
          className='flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-medium transition cursor-pointer border border-white/20'
        >
          <Download className='size-3' /> Download Card
        </button>
      </div>
    </div>
  );
}
