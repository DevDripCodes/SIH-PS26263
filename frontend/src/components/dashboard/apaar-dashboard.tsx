import { useState } from 'react';
import {
  ShieldCheck,
  Building2,
  Users,
  AlertTriangle,
  FileCheck,
  Search,
  Upload,
  UserPlus,
  QrCode,
  CheckCircle2,
  XCircle,
  Download,
  LogOut,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  School,
  IdCard,
} from 'lucide-react';

export type UserRole = 'institution' | 'aicte-admin' | 'verifier' | 'student';

export interface StudentRecord {
  id: string;
  apaarId: string;
  name: string;
  institution: string;
  course: string;
  admissionYear: string;
  category: 'Regular' | 'Supernumerary (EWS/TFW)' | 'NRI' | 'OCI' | 'Foreign National (FN)';
  status: 'Verified' | 'Flagged' | 'Pending';
  flagReason?: string;
}

export interface IntakeData {
  branch: string;
  approvedIntake: number;
  actualEnrolment: number;
  supernumerary: number;
  nriOciFn: number;
}

const mockIntakeData: IntakeData[] = [
  { branch: 'Computer Science & Engineering', approvedIntake: 180, actualEnrolment: 178, supernumerary: 18, nriOciFn: 12 },
  { branch: 'Artificial Intelligence & Data Science', approvedIntake: 60, actualEnrolment: 60, supernumerary: 6, nriOciFn: 4 },
  { branch: 'Electronics & Communication Eng.', approvedIntake: 120, actualEnrolment: 114, supernumerary: 12, nriOciFn: 6 },
  { branch: 'Mechanical Engineering', approvedIntake: 60, actualEnrolment: 48, supernumerary: 4, nriOciFn: 0 },
  { branch: 'MBA - Business Analytics', approvedIntake: 60, actualEnrolment: 62, supernumerary: 6, nriOciFn: 5 }, // Anomaly: 62 > 60
];

const mockStudents: StudentRecord[] = [
  {
    id: 'STU-001',
    apaarId: '9420-1845-6712',
    name: 'Aarav Sharma',
    institution: 'Delhi Technological University',
    course: 'Computer Science & Engineering',
    admissionYear: '2026',
    category: 'Regular',
    status: 'Verified',
  },
  {
    id: 'STU-002',
    apaarId: '8114-2290-4431',
    name: 'Priya Sundaram',
    institution: 'Delhi Technological University',
    course: 'Computer Science & Engineering',
    admissionYear: '2026',
    category: 'Supernumerary (EWS/TFW)',
    status: 'Verified',
  },
  {
    id: 'STU-003',
    apaarId: '7729-1004-9823',
    name: 'Rohan Mehta',
    institution: 'Delhi Technological University',
    course: 'MBA - Business Analytics',
    admissionYear: '2026',
    category: 'Regular',
    status: 'Flagged',
    flagReason: 'Intake Ceiling Exceeded (Seat #61 of 60 Approved)',
  },
  {
    id: 'STU-004',
    apaarId: '6338-9120-1104',
    name: 'Kavya Nair',
    institution: 'Delhi Technological University',
    course: 'Electronics & Communication Eng.',
    admissionYear: '2026',
    category: 'NRI',
    status: 'Verified',
  },
  {
    id: 'STU-005',
    apaarId: '5512-8801-4478',
    name: 'Zaid Al-Mansoor',
    institution: 'Delhi Technological University',
    course: 'Artificial Intelligence & Data Science',
    admissionYear: '2026',
    category: 'Foreign National (FN)',
    status: 'Verified',
  },
  {
    id: 'STU-006',
    apaarId: '9420-1845-6712', // Duplicate APAAR anomaly!
    name: 'Aarav Sharma (Duplicate Claim)',
    institution: 'National Institute of Tech, Kurukshetra',
    course: 'Computer Science & Engineering',
    admissionYear: '2026',
    category: 'Regular',
    status: 'Flagged',
    flagReason: 'Dual Enrolment Detected across DTU and NIT Kurukshetra',
  },
];

interface ApaarDashboardProps {
  onSignOut: () => void;
}

export function ApaarDashboard({ onSignOut }: ApaarDashboardProps) {
  const [activeRole, setActiveRole] = useState<UserRole>('institution');
  const [students, setStudents] = useState<StudentRecord[]>(mockStudents);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [activeTab, setActiveTab] = useState<'overview' | 'students' | 'upload' | 'anomalies'>('overview');
  
  // Verification states
  const [verifyInput, setVerifyInput] = useState('9420-1845-6712');
  const [verifiedRecord, setVerifiedRecord] = useState<StudentRecord | null>(mockStudents[0]);
  const [verifySearched, setVerifySearched] = useState(true);

  // New Student Form Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newStudent, setNewStudent] = useState({
    apaarId: '',
    name: '',
    course: 'Computer Science & Engineering',
    category: 'Regular' as StudentRecord['category'],
  });
  const [addError, setAddError] = useState('');

  // Bulk Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Filter students
  const filteredStudents = students.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.apaarId.includes(searchQuery) ||
      s.course.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      selectedCategory === 'All' || s.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const totalApproved = mockIntakeData.reduce((acc, curr) => acc + curr.approvedIntake, 0);
  const totalEnrolled = mockIntakeData.reduce((acc, curr) => acc + curr.actualEnrolment, 0);
  const totalSupernumerary = mockIntakeData.reduce((acc, curr) => acc + curr.supernumerary, 0);
  const totalForeign = mockIntakeData.reduce((acc, curr) => acc + curr.nriOciFn, 0);
  const totalFlagged = students.filter((s) => s.status === 'Flagged').length;

  const handleVerify = () => {
    const cleanId = verifyInput.trim().replace(/\s+/g, '');
    const found = students.find((s) => s.apaarId.replace(/-/g, '') === cleanId.replace(/-/g, ''));
    setVerifiedRecord(found || null);
    setVerifySearched(true);
  };

  const handleAddStudentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudent.apaarId || !newStudent.name) {
      setAddError('Please fill in both APAAR ID and Student Name');
      return;
    }

    const cleanApaar = newStudent.apaarId.replace(/[^0-9]/g, '');
    if (cleanApaar.length !== 12) {
      setAddError('APAAR ID must be exactly 12 numeric digits');
      return;
    }

    const formattedApaar = `${cleanApaar.slice(0, 4)}-${cleanApaar.slice(4, 8)}-${cleanApaar.slice(8, 12)}`;
    
    // Check duplicate
    const isDuplicate = students.some((s) => s.apaarId === formattedApaar);

    const record: StudentRecord = {
      id: `STU-00${students.length + 1}`,
      apaarId: formattedApaar,
      name: newStudent.name,
      institution: 'Delhi Technological University',
      course: newStudent.course,
      admissionYear: '2026',
      category: newStudent.category,
      status: isDuplicate ? 'Flagged' : 'Verified',
      flagReason: isDuplicate ? 'Potential Duplicate APAAR ID already registered in database' : undefined,
    };

    setStudents([record, ...students]);
    setIsAddModalOpen(false);
    setNewStudent({ apaarId: '', name: '', course: 'Computer Science & Engineering', category: 'Regular' });
    setAddError('');
  };

  const handleSimulateBulkUpload = () => {
    setIsUploading(true);
    setTimeout(() => {
      setIsUploading(false);
      setUploadSuccess(true);
      setTimeout(() => setUploadSuccess(false), 4000);
    }, 1500);
  };

  return (
    <div className='min-h-screen bg-neutral-50 dark:bg-[#030712] text-neutral-900 dark:text-neutral-100 font-sans transition-colors'>
      {/* Top National Header Bar */}
      <header className='sticky top-0 z-40 bg-white/95 dark:bg-neutral-900/95 backdrop-blur border-b border-neutral-200 dark:border-neutral-800 shadow-xs'>
        <div className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8'>
          <div className='flex items-center justify-between h-16'>
            {/* National Branding */}
            <div className='flex items-center gap-3'>
              <div className='size-10 rounded-lg bg-linear-to-tr from-blue-700 via-indigo-600 to-sky-500 flex items-center justify-center text-white font-bold shadow-md'>
                <ShieldCheck className='size-6' />
              </div>
              <div>
                <div className='flex items-center gap-2'>
                  <span className='font-bold text-base sm:text-lg tracking-tight'>
                    APAAR
                  </span>
                  <span className='text-[10px] font-semibold uppercase tracking-wider bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 px-2 py-0.5 rounded-full'>
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
                onClick={() => { setActiveRole('institution'); setActiveTab('overview'); }}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  activeRole === 'institution'
                    ? 'bg-white dark:bg-neutral-900 text-blue-600 dark:text-blue-400 shadow-xs font-semibold'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
                }`}
              >
                <School className='size-3.5' />
                Institution Portal
              </button>
              <button
                onClick={() => { setActiveRole('aicte-admin'); setActiveTab('overview'); }}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  activeRole === 'aicte-admin'
                    ? 'bg-white dark:bg-neutral-900 text-blue-600 dark:text-blue-400 shadow-xs font-semibold'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
                }`}
              >
                <Building2 className='size-3.5' />
                AICTE Apex Monitor
              </button>
              <button
                onClick={() => { setActiveRole('verifier'); setActiveTab('overview'); }}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  activeRole === 'verifier'
                    ? 'bg-white dark:bg-neutral-900 text-blue-600 dark:text-blue-400 shadow-xs font-semibold'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
                }`}
              >
                <QrCode className='size-3.5' />
                Public Verifier
              </button>
              <button
                onClick={() => { setActiveRole('student'); setActiveTab('overview'); }}
                className={`px-3 py-1.5 rounded-lg transition cursor-pointer flex items-center gap-1.5 ${
                  activeRole === 'student'
                    ? 'bg-white dark:bg-neutral-900 text-blue-600 dark:text-blue-400 shadow-xs font-semibold'
                    : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900'
                }`}
              >
                <IdCard className='size-3.5' />
                Student Passport
              </button>
            </div>

            {/* User Profile & Sign Out */}
            <div className='flex items-center gap-2.5'>
              <div className='hidden sm:block text-right'>
                <p className='text-xs font-semibold'>AICTE ID: 1-9321482</p>
                <p className='text-[10px] text-neutral-500'>DTU, Delhi (Govt)</p>
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
          {(['institution', 'aicte-admin', 'verifier', 'student'] as UserRole[]).map((role) => (
            <button
              key={role}
              onClick={() => setActiveRole(role)}
              className={`px-2.5 py-1 rounded-md shrink-0 capitalize ${
                activeRole === role
                  ? 'bg-blue-600 text-white font-medium'
                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400'
              }`}
            >
              {role.replace('-', ' ')}
            </button>
          ))}
        </div>
      </header>

      {/* Main Container */}
      <main className='max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8'>
        {/* ======================================================== */}
        {/* 1. INSTITUTION PORTAL (COLLEGE VIEW)                      */}
        {/* ======================================================== */}
        {activeRole === 'institution' && (
          <div className='space-y-6'>
            {/* Sub-header Banner */}
            <div className='bg-linear-to-r from-blue-900 via-indigo-900 to-blue-950 rounded-2xl p-6 text-white shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4'>
              <div>
                <span className='inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-200 border border-blue-400/30 mb-2'>
                  <Sparkles className='size-3 text-amber-300' />
                  Academic Year 2026-2027 • Approved Intake Verification
                </span>
                <h1 className='text-2xl font-bold tracking-tight'>
                  Delhi Technological University
                </h1>
                <p className='text-sm text-blue-200/90 mt-1'>
                  Permanent Institute ID: 1-9321482 • Region: North-West • Affiliated with AICTE
                </p>
              </div>
              <div className='flex items-center gap-2'>
                <button
                  onClick={() => setIsAddModalOpen(true)}
                  className='bg-white text-blue-900 hover:bg-blue-50 px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 shadow-sm cursor-pointer'
                >
                  <UserPlus className='size-4' />
                  Add Student Record
                </button>
                <button
                  onClick={() => setActiveTab('upload')}
                  className='bg-blue-600/80 hover:bg-blue-600 border border-blue-400/30 text-white px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 cursor-pointer'
                >
                  <Upload className='size-4' />
                  Bulk Upload (CSV)
                </button>
              </div>
            </div>

            {/* Key Metrics Cards */}
            <div className='grid grid-cols-2 lg:grid-cols-4 gap-4'>
              <div className='bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 shadow-xs'>
                <div className='flex items-center justify-between text-neutral-500'>
                  <span className='text-xs font-medium uppercase tracking-wider'>Approved Intake</span>
                  <Building2 className='size-4 text-blue-500' />
                </div>
                <p className='text-2xl font-bold mt-2'>{totalApproved}</p>
                <p className='text-xs text-neutral-500 mt-1'>Sanctioned AICTE Seats</p>
              </div>

              <div className='bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 shadow-xs'>
                <div className='flex items-center justify-between text-neutral-500'>
                  <span className='text-xs font-medium uppercase tracking-wider'>Actual Enrolment</span>
                  <Users className='size-4 text-emerald-500' />
                </div>
                <p className='text-2xl font-bold mt-2 text-emerald-600 dark:text-emerald-400'>
                  {totalEnrolled}{' '}
                  <span className='text-xs font-normal text-neutral-500'>
                    ({((totalEnrolled / totalApproved) * 100).toFixed(1)}%)
                  </span>
                </p>
                <p className='text-xs text-neutral-500 mt-1'>Verified with APAAR ID</p>
              </div>

              <div className='bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 shadow-xs'>
                <div className='flex items-center justify-between text-neutral-500'>
                  <span className='text-xs font-medium uppercase tracking-wider'>Supernumerary</span>
                  <FileCheck className='size-4 text-indigo-500' />
                </div>
                <p className='text-2xl font-bold mt-2'>{totalSupernumerary}</p>
                <p className='text-xs text-neutral-500 mt-1'>EWS, TFW & PMSSS Quota</p>
              </div>

              <div className='bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 shadow-xs'>
                <div className='flex items-center justify-between text-neutral-500'>
                  <span className='text-xs font-medium uppercase tracking-wider'>NRI / OCI / FN</span>
                  <SlidersHorizontal className='size-4 text-amber-500' />
                </div>
                <p className='text-2xl font-bold mt-2'>{totalForeign}</p>
                <p className='text-xs text-neutral-500 mt-1'>Capped at max 15% threshold</p>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className='flex border-b border-neutral-200 dark:border-neutral-800 gap-6 text-sm font-medium'>
              <button
                onClick={() => setActiveTab('overview')}
                className={`pb-3 border-b-2 transition cursor-pointer ${
                  activeTab === 'overview'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                    : 'border-transparent text-neutral-500 hover:text-neutral-800'
                }`}
              >
                Intake & Quotas Summary
              </button>
              <button
                onClick={() => setActiveTab('students')}
                className={`pb-3 border-b-2 transition cursor-pointer ${
                  activeTab === 'students'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                    : 'border-transparent text-neutral-500 hover:text-neutral-800'
                }`}
              >
                Student Records Directory ({students.length})
              </button>
              <button
                onClick={() => setActiveTab('upload')}
                className={`pb-3 border-b-2 transition cursor-pointer ${
                  activeTab === 'upload'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                    : 'border-transparent text-neutral-500 hover:text-neutral-800'
                }`}
              >
                Bulk Upload & Verification Engine
              </button>
            </div>

            {/* Tab Content: Overview (Branch-wise intake) */}
            {activeTab === 'overview' && (
              <div className='bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 p-6 shadow-xs'>
                <div className='flex items-center justify-between mb-4'>
                  <div>
                    <h2 className='text-base font-bold'>Branch-Wise Approved Intake vs Actual Admissions</h2>
                    <p className='text-xs text-neutral-500'>Real-time quota monitoring and ceiling alert system</p>
                  </div>
                  <span className='text-xs text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-full'>
                    AICTE Synchronized
                  </span>
                </div>

                <div className='overflow-x-auto'>
                  <table className='w-full text-left text-sm'>
                    <thead>
                      <tr className='text-xs text-neutral-500 border-b border-neutral-200 dark:border-neutral-800'>
                        <th className='py-3 font-semibold'>Course / Department</th>
                        <th className='py-3 font-semibold'>Approved Intake</th>
                        <th className='py-3 font-semibold'>Actual Enrolment</th>
                        <th className='py-3 font-semibold'>Supernumerary</th>
                        <th className='py-3 font-semibold'>NRI / OCI / FN</th>
                        <th className='py-3 font-semibold'>Status</th>
                      </tr>
                    </thead>
                    <tbody className='divide-y divide-neutral-100 dark:divide-neutral-800/60'>
                      {mockIntakeData.map((item, idx) => {
                        const isOverIntake = item.actualEnrolment > item.approvedIntake;
                        const fillPercent = Math.min(100, Math.round((item.actualEnrolment / item.approvedIntake) * 100));

                        return (
                          <tr key={idx} className='hover:bg-neutral-50/50 dark:hover:bg-neutral-800/40'>
                            <td className='py-3.5 font-medium'>{item.branch}</td>
                            <td className='py-3.5 font-semibold text-neutral-700 dark:text-neutral-300'>
                              {item.approvedIntake}
                            </td>
                            <td className='py-3.5'>
                              <div className='flex items-center gap-2'>
                                <span className={isOverIntake ? 'text-red-600 font-bold' : 'font-semibold'}>
                                  {item.actualEnrolment}
                                </span>
                                <div className='w-24 bg-neutral-100 dark:bg-neutral-800 h-2 rounded-full overflow-hidden'>
                                  <div
                                    className={`h-full ${
                                      isOverIntake ? 'bg-red-500' : 'bg-blue-600'
                                    }`}
                                    style={{ width: `${fillPercent}%` }}
                                  />
                                </div>
                                <span className='text-[10px] text-neutral-400'>{fillPercent}%</span>
                              </div>
                            </td>
                            <td className='py-3.5 text-neutral-600 dark:text-neutral-400'>
                              +{item.supernumerary} seats
                            </td>
                            <td className='py-3.5 text-neutral-600 dark:text-neutral-400'>
                              {item.nriOciFn} seats
                            </td>
                            <td className='py-3.5'>
                              {isOverIntake ? (
                                <span className='inline-flex items-center gap-1 text-xs text-red-600 bg-red-50 dark:bg-red-950/40 px-2 py-0.5 rounded-full font-medium'>
                                  <AlertTriangle className='size-3' />
                                  Intake Exceeded
                                </span>
                              ) : (
                                <span className='inline-flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full font-medium'>
                                  <CheckCircle2 className='size-3' />
                                  Within Quota
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Tab Content: Student Directory */}
            {activeTab === 'students' && (
              <div className='bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 p-6 shadow-xs space-y-4'>
                <div className='flex flex-col sm:flex-row sm:items-center justify-between gap-3'>
                  <div className='relative flex-1 max-w-sm'>
                    <Search className='size-4 absolute left-3 top-2.5 text-neutral-400' />
                    <input
                      type='text'
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder='Search by Student Name, APAAR ID, or Branch...'
                      className='w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500'
                    />
                  </div>

                  <div className='flex items-center gap-2'>
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className='text-xs rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 px-3 py-1.5 focus:outline-hidden'
                    >
                      <option value='All'>All Categories</option>
                      <option value='Regular'>Regular</option>
                      <option value='Supernumerary (EWS/TFW)'>Supernumerary (EWS/TFW)</option>
                      <option value='NRI'>NRI</option>
                      <option value='OCI'>OCI</option>
                      <option value='Foreign National (FN)'>Foreign National (FN)</option>
                    </select>
                  </div>
                </div>

                <div className='overflow-x-auto'>
                  <table className='w-full text-left text-sm'>
                    <thead>
                      <tr className='text-xs text-neutral-500 border-b border-neutral-200 dark:border-neutral-800'>
                        <th className='py-3 font-semibold'>APAAR ID</th>
                        <th className='py-3 font-semibold'>Student Name</th>
                        <th className='py-3 font-semibold'>Course</th>
                        <th className='py-3 font-semibold'>Category</th>
                        <th className='py-3 font-semibold'>Verification Status</th>
                      </tr>
                    </thead>
                    <tbody className='divide-y divide-neutral-100 dark:divide-neutral-800/60'>
                      {filteredStudents.map((student) => (
                        <tr key={student.id} className='hover:bg-neutral-50/50 dark:hover:bg-neutral-800/40'>
                          <td className='py-3 font-mono text-xs font-semibold text-blue-600 dark:text-blue-400'>
                            {student.apaarId}
                          </td>
                          <td className='py-3 font-medium'>{student.name}</td>
                          <td className='py-3 text-xs text-neutral-600 dark:text-neutral-400'>{student.course}</td>
                          <td className='py-3'>
                            <span className='text-[11px] bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 rounded-md font-medium text-neutral-700 dark:text-neutral-300'>
                              {student.category}
                            </span>
                          </td>
                          <td className='py-3'>
                            {student.status === 'Verified' ? (
                              <span className='inline-flex items-center gap-1 text-xs text-emerald-600 font-medium'>
                                <CheckCircle2 className='size-3.5' /> Verified
                              </span>
                            ) : (
                              <div className='flex flex-col'>
                                <span className='inline-flex items-center gap-1 text-xs text-red-600 font-medium'>
                                  <AlertTriangle className='size-3.5' /> Flagged
                                </span>
                                {student.flagReason && (
                                  <span className='text-[10px] text-red-500'>{student.flagReason}</span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Tab Content: Bulk Upload */}
            {activeTab === 'upload' && (
              <div className='bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 p-8 shadow-xs text-center'>
                <div className='max-w-lg mx-auto space-y-4'>
                  <div className='size-14 mx-auto rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 flex items-center justify-center border border-blue-200 dark:border-blue-800'>
                    <Upload className='size-6' />
                  </div>
                  <h3 className='text-lg font-bold'>Upload Student Enrolment Sheet</h3>
                  <p className='text-xs text-neutral-500 leading-relaxed'>
                    Submit student admission data in AICTE standard CSV/Excel format. The platform automatically verifies 12-digit APAAR IDs, validates approved intake limits, and checks for cross-institution duplicate admissions.
                  </p>

                  <div className='border-2 border-dashed border-neutral-300 dark:border-neutral-700 rounded-2xl p-6 hover:border-blue-500 transition cursor-pointer'>
                    <p className='text-xs text-neutral-600 dark:text-neutral-300 font-medium'>
                      Drag and drop your <span className='font-bold text-blue-600'>.CSV or .XLSX</span> file here
                    </p>
                    <p className='text-[11px] text-neutral-400 mt-1'>Maximum file size 25MB • Up to 5,000 records per batch</p>
                  </div>

                  <div className='flex items-center justify-center gap-3 pt-2'>
                    <button
                      onClick={handleSimulateBulkUpload}
                      disabled={isUploading}
                      className='bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50'
                    >
                      {isUploading ? (
                        <>
                          <RefreshCw className='size-4 animate-spin' />
                          Validating APAAR Checksums...
                        </>
                      ) : (
                        <>
                          <FileCheck className='size-4' />
                          Run Automated Validation
                        </>
                      )}
                    </button>
                    <button
                      type='button'
                      onClick={() => alert('Downloaded sample AICTE APAAR template (.csv)')}
                      className='border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 px-4 py-2.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5 cursor-pointer'
                    >
                      <Download className='size-3.5' />
                      Sample Template
                    </button>
                  </div>

                  {uploadSuccess && (
                    <div className='p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs flex items-center justify-center gap-2 animate-fade-in'>
                      <CheckCircle2 className='size-4' />
                      240 Student Records Validated & Synced with AICTE Central Database!
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* 2. AICTE APEX CENTRAL MONITOR                            */}
        {/* ======================================================== */}
        {activeRole === 'aicte-admin' && (
          <div className='space-y-6'>
            <div className='bg-linear-to-r from-neutral-900 to-indigo-950 text-white rounded-2xl p-6 shadow-lg flex flex-col md:flex-row justify-between items-start md:items-center gap-4'>
              <div>
                <span className='inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-400/20 text-amber-300 border border-amber-400/30 mb-2'>
                  <ShieldCheck className='size-3' />
                  National Regulatory Authority • Live Anomaly Detection
                </span>
                <h1 className='text-2xl font-bold tracking-tight'>AICTE Central Monitoring Command</h1>
                <p className='text-sm text-neutral-300 mt-1'>
                  Pan-India Student Academic Registry & Enrolment Discrepancy Sentinel
                </p>
              </div>

              <div className='flex items-center gap-2'>
                <button
                  type='button'
                  onClick={() => alert('Generating National AICTE Accreditation & Enrolment Report...')}
                  className='bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 cursor-pointer shadow-sm'
                >
                  <Download className='size-4' />
                  Export National Audit Report
                </button>
              </div>
            </div>

            {/* National Stat Cards */}
            <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
              <div className='bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-xs'>
                <p className='text-xs font-medium text-neutral-500 uppercase'>Approved Institutions</p>
                <p className='text-2xl font-bold mt-2'>9,420</p>
                <p className='text-xs text-emerald-600 dark:text-emerald-400 mt-1'>98.4% reporting online</p>
              </div>
              <div className='bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-xs'>
                <p className='text-xs font-medium text-neutral-500 uppercase'>Total Sanctioned Intake</p>
                <p className='text-2xl font-bold mt-2'>3,450,000</p>
                <p className='text-xs text-neutral-500 mt-1'>Across all disciplines</p>
              </div>
              <div className='bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-xs'>
                <p className='text-xs font-medium text-neutral-500 uppercase'>Registered APAAR IDs</p>
                <p className='text-2xl font-bold mt-2 text-blue-600 dark:text-blue-400'>3,180,450</p>
                <p className='text-xs text-neutral-500 mt-1'>Verified student credentials</p>
              </div>
              <div className='bg-white dark:bg-neutral-900 p-5 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-xs'>
                <p className='text-xs font-medium text-neutral-500 uppercase'>Flagged Anomalies</p>
                <p className='text-2xl font-bold mt-2 text-red-600'>{totalFlagged}</p>
                <p className='text-xs text-red-500 mt-1'>Requires regulatory notice</p>
              </div>
            </div>

            {/* Anomaly Center Table */}
            <div className='bg-white dark:bg-neutral-900 rounded-2xl border border-red-200 dark:border-red-950/60 p-6 shadow-xs space-y-4'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-2'>
                  <div className='size-8 rounded-lg bg-red-100 dark:bg-red-950 text-red-600 flex items-center justify-center font-bold'>
                    <AlertTriangle className='size-4' />
                  </div>
                  <div>
                    <h2 className='text-base font-bold'>Intelligent Anomaly Radar</h2>
                    <p className='text-xs text-neutral-500'>Automated detection of duplicate enrolments and intake limit breaches</p>
                  </div>
                </div>
                <span className='text-xs font-semibold px-2.5 py-1 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 rounded-full'>
                  Action Required
                </span>
              </div>

              <div className='overflow-x-auto'>
                <table className='w-full text-left text-sm'>
                  <thead>
                    <tr className='text-xs text-neutral-500 border-b border-neutral-200 dark:border-neutral-800'>
                      <th className='py-3 font-semibold'>APAAR ID</th>
                      <th className='py-3 font-semibold'>Student Name</th>
                      <th className='py-3 font-semibold'>Institution Involved</th>
                      <th className='py-3 font-semibold'>Anomaly Type</th>
                      <th className='py-3 font-semibold'>Action</th>
                    </tr>
                  </thead>
                  <tbody className='divide-y divide-neutral-100 dark:divide-neutral-800/60'>
                    {students.filter((s) => s.status === 'Flagged').map((flagged) => (
                      <tr key={flagged.id} className='hover:bg-neutral-50/50 dark:hover:bg-neutral-800/40'>
                        <td className='py-3 font-mono text-xs font-bold text-red-600'>{flagged.apaarId}</td>
                        <td className='py-3 font-medium'>{flagged.name}</td>
                        <td className='py-3 text-xs text-neutral-600 dark:text-neutral-400'>{flagged.institution}</td>
                        <td className='py-3 text-xs text-red-600 font-semibold'>{flagged.flagReason}</td>
                        <td className='py-3'>
                          <button
                            type='button'
                            onClick={() => alert(`Issued Show-Cause Notice to institution for ${flagged.apaarId}`)}
                            className='px-3 py-1 bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 rounded-lg text-xs font-semibold hover:opacity-90 transition cursor-pointer'
                          >
                            Issue Notice
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* 3. PUBLIC VERIFICATION PORTAL (EMPLOYERS & REGULATORS)   */}
        {/* ======================================================== */}
        {activeRole === 'verifier' && (
          <div className='max-w-2xl mx-auto space-y-6'>
            <div className='text-center space-y-2'>
              <div className='size-12 mx-auto rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 flex items-center justify-center border border-blue-200 dark:border-blue-800'>
                <QrCode className='size-6' />
              </div>
              <h1 className='text-2xl font-bold'>Authorized Credential Verification Portal</h1>
              <p className='text-xs text-neutral-500 leading-relaxed max-w-md mx-auto'>
                Instantly verify the authenticity of student credentials and degrees issued by AICTE-approved institutions using the national APAAR ID.
              </p>
            </div>

            {/* Search Input Bar */}
            <div className='bg-white dark:bg-neutral-900 p-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-md flex items-center gap-2'>
              <Search className='size-5 text-neutral-400 ml-2' />
              <input
                type='text'
                value={verifyInput}
                onChange={(e) => setVerifyInput(e.target.value)}
                placeholder='Enter 12-digit APAAR ID (e.g. 9420-1845-6712)'
                className='w-full px-2 py-2 text-sm bg-transparent focus:outline-hidden font-mono'
              />
              <button
                onClick={handleVerify}
                className='bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition shrink-0 cursor-pointer shadow-xs'
              >
                Verify Record
              </button>
            </div>

            {/* Verification Result Card */}
            {verifySearched && verifiedRecord && (
              <div className='bg-white dark:bg-neutral-900 rounded-2xl border border-emerald-200 dark:border-emerald-950 p-6 shadow-lg space-y-4 animate-fade-in'>
                <div className='flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-4'>
                  <div className='flex items-center gap-2'>
                    <div className='size-8 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 flex items-center justify-center'>
                      <CheckCircle2 className='size-5' />
                    </div>
                    <div>
                      <h3 className='font-bold text-sm'>AICTE Authenticated Academic Record</h3>
                      <p className='text-[10px] text-neutral-400'>Cryptographically anchored with Academic Bank of Credits</p>
                    </div>
                  </div>
                  <span className='text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 dark:bg-emerald-950 px-2.5 py-1 rounded-full'>
                    Genuine Record
                  </span>
                </div>

                <div className='grid grid-cols-2 gap-4 text-xs'>
                  <div>
                    <span className='text-neutral-400'>Student Name</span>
                    <p className='font-semibold text-sm mt-0.5'>{verifiedRecord.name}</p>
                  </div>
                  <div>
                    <span className='text-neutral-400'>APAAR ID</span>
                    <p className='font-mono font-bold text-sm text-blue-600 dark:text-blue-400 mt-0.5'>
                      {verifiedRecord.apaarId}
                    </p>
                  </div>
                  <div>
                    <span className='text-neutral-400'>Approved Institution</span>
                    <p className='font-semibold mt-0.5'>{verifiedRecord.institution}</p>
                  </div>
                  <div>
                    <span className='text-neutral-400'>Branch / Degree</span>
                    <p className='font-semibold mt-0.5'>{verifiedRecord.course}</p>
                  </div>
                  <div>
                    <span className='text-neutral-400'>Admission Year</span>
                    <p className='font-semibold mt-0.5'>{verifiedRecord.admissionYear}</p>
                  </div>
                  <div>
                    <span className='text-neutral-400'>Admission Category</span>
                    <p className='font-semibold mt-0.5'>{verifiedRecord.category}</p>
                  </div>
                </div>

                <div className='pt-2 flex items-center justify-between border-t border-neutral-100 dark:border-neutral-800'>
                  <span className='text-[11px] text-neutral-400'>Digital Stamp: AICTE-VER-2026-X8912</span>
                  <button
                    type='button'
                    onClick={() => alert('Downloaded Official AICTE Verification Certificate (PDF)')}
                    className='text-xs text-blue-600 font-semibold hover:underline flex items-center gap-1 cursor-pointer'
                  >
                    <Download className='size-3.5' /> Download Certificate
                  </button>
                </div>
              </div>
            )}

            {verifySearched && !verifiedRecord && (
              <div className='bg-white dark:bg-neutral-900 rounded-2xl border border-red-200 dark:border-red-950 p-6 text-center space-y-2'>
                <XCircle className='size-8 text-red-500 mx-auto' />
                <h3 className='font-bold text-sm'>No Authenticated Record Found</h3>
                <p className='text-xs text-neutral-500'>
                  The APAAR ID provided does not correspond to any active verified enrolment in the AICTE national repository.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ======================================================== */}
        {/* 4. STUDENT ACADEMIC PASSPORT CARD                        */}
        {/* ======================================================== */}
        {activeRole === 'student' && (
          <div className='max-w-xl mx-auto space-y-6'>
            <div className='text-center space-y-1'>
              <h1 className='text-2xl font-bold'>Student Academic Identity Card</h1>
              <p className='text-xs text-neutral-500'>
                National Academic Identity linked with APAAR ID and Academic Bank of Credits (ABC)
              </p>
            </div>

            {/* Smart Digital ID Card */}
            <div className='bg-linear-to-tr from-slate-900 via-indigo-950 to-blue-900 rounded-3xl p-6 text-white shadow-2xl relative overflow-hidden border border-white/10'>
              <div className='absolute -right-10 -bottom-10 size-48 rounded-full bg-blue-500/10 blur-2xl pointer-events-none' />

              <div className='flex items-center justify-between border-b border-white/10 pb-4'>
                <div className='flex items-center gap-2.5'>
                  <ShieldCheck className='size-7 text-amber-400' />
                  <div>
                    <h3 className='font-bold text-sm tracking-wide'>ALL INDIA COUNCIL FOR TECHNICAL EDUCATION</h3>
                    <p className='text-[10px] text-blue-200 uppercase tracking-widest'>Ministry of Education, Govt. of India</p>
                  </div>
                </div>
                <span className='text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-2 py-0.5 rounded-full font-semibold'>
                  Active
                </span>
              </div>

              <div className='mt-6 flex flex-col sm:flex-row items-center sm:items-start justify-between gap-6'>
                <div className='space-y-3 text-center sm:text-left'>
                  <div>
                    <span className='text-[10px] uppercase tracking-wider text-blue-300'>Student Name</span>
                    <p className='text-xl font-bold'>{mockStudents[0].name}</p>
                  </div>
                  <div>
                    <span className='text-[10px] uppercase tracking-wider text-blue-300'>National APAAR ID</span>
                    <p className='text-base font-mono font-bold tracking-wider text-amber-300'>
                      {mockStudents[0].apaarId}
                    </p>
                  </div>
                  <div>
                    <span className='text-[10px] uppercase tracking-wider text-blue-300'>Institution</span>
                    <p className='text-xs font-medium text-white/90'>{mockStudents[0].institution}</p>
                  </div>
                  <div>
                    <span className='text-[10px] uppercase tracking-wider text-blue-300'>Programme</span>
                    <p className='text-xs font-medium text-white/90'>{mockStudents[0].course}</p>
                  </div>
                </div>

                {/* QR Code Block */}
                <div className='bg-white p-3 rounded-2xl shadow-lg shrink-0 text-center'>
                  <div className='size-24 bg-neutral-900 rounded-lg flex items-center justify-center text-white'>
                    <QrCode className='size-18' />
                  </div>
                  <span className='text-[9px] text-neutral-600 font-bold block mt-1'>Scan to Verify</span>
                </div>
              </div>

              <div className='mt-6 pt-3 border-t border-white/10 flex items-center justify-between text-[10px] text-blue-200/80'>
                <span>Valid for Academic Session 2026-2030</span>
                <span>DigiLocker Verified</span>
              </div>
            </div>

            <div className='flex items-center justify-center gap-3'>
              <button
                type='button'
                onClick={() => alert('Downloading Verified Digital APAAR ID Card...')}
                className='bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition flex items-center gap-2 cursor-pointer shadow-sm'
              >
                <Download className='size-4' />
                Download Verified ID Card (PDF)
              </button>
            </div>
          </div>
        )}
      </main>

      {/* ======================================================== */}
      {/* ADD STUDENT MODAL                                        */}
      {/* ======================================================== */}
      {isAddModalOpen && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4'>
          <div className='bg-white dark:bg-neutral-900 rounded-3xl max-w-md w-full p-6 border border-neutral-200 dark:border-neutral-800 shadow-2xl space-y-4'>
            <div className='flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-3'>
              <div className='flex items-center gap-2'>
                <UserPlus className='size-5 text-blue-600' />
                <h3 className='font-bold text-base'>Add Verified Student Record</h3>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className='text-neutral-400 hover:text-neutral-600 cursor-pointer'
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddStudentSubmit} className='space-y-3.5 text-xs'>
              {addError && (
                <div className='p-2.5 bg-red-50 text-red-600 rounded-xl text-xs flex items-center gap-1.5'>
                  <AlertTriangle className='size-4' />
                  {addError}
                </div>
              )}

              <div>
                <label className='block font-semibold mb-1'>Student Full Name *</label>
                <input
                  type='text'
                  value={newStudent.name}
                  onChange={(e) => setNewStudent({ ...newStudent, name: e.target.value })}
                  placeholder='e.g. Ananya Deshmukh'
                  className='w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500'
                />
              </div>

              <div>
                <label className='block font-semibold mb-1'>12-Digit National APAAR ID *</label>
                <input
                  type='text'
                  value={newStudent.apaarId}
                  onChange={(e) => setNewStudent({ ...newStudent, apaarId: e.target.value })}
                  placeholder='e.g. 982144120934'
                  maxLength={14}
                  className='w-full px-3 py-2 font-mono rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500'
                />
                <p className='text-[10px] text-neutral-400 mt-0.5'>Format: 12 numeric digits assigned via DigiLocker / ABC</p>
              </div>

              <div>
                <label className='block font-semibold mb-1'>Department / Course *</label>
                <select
                  value={newStudent.course}
                  onChange={(e) => setNewStudent({ ...newStudent, course: e.target.value })}
                  className='w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 focus:outline-hidden'
                >
                  <option value='Computer Science & Engineering'>Computer Science & Engineering</option>
                  <option value='Artificial Intelligence & Data Science'>Artificial Intelligence & Data Science</option>
                  <option value='Electronics & Communication Eng.'>Electronics & Communication Eng.</option>
                  <option value='Mechanical Engineering'>Mechanical Engineering</option>
                  <option value='MBA - Business Analytics'>MBA - Business Analytics</option>
                </select>
              </div>

              <div>
                <label className='block font-semibold mb-1'>Admission Quota / Category *</label>
                <select
                  value={newStudent.category}
                  onChange={(e) => setNewStudent({ ...newStudent, category: e.target.value as any })}
                  className='w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800 focus:outline-hidden'
                >
                  <option value='Regular'>Regular Intake</option>
                  <option value='Supernumerary (EWS/TFW)'>Supernumerary (EWS / TFW / PMSSS)</option>
                  <option value='NRI'>NRI Category</option>
                  <option value='OCI'>OCI Status</option>
                  <option value='Foreign National (FN)'>Foreign National (FN)</option>
                </select>
              </div>

              <div className='pt-2 flex items-center justify-end gap-2'>
                <button
                  type='button'
                  onClick={() => setIsAddModalOpen(false)}
                  className='px-4 py-2 border border-neutral-200 dark:border-neutral-800 rounded-xl font-medium cursor-pointer'
                >
                  Cancel
                </button>
                <button
                  type='submit'
                  className='px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold cursor-pointer shadow-sm'
                >
                  Verify & Save Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
