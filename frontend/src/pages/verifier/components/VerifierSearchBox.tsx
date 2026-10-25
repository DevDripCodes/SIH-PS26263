import { Search } from 'lucide-react';

interface VerifierSearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  onVerify: () => void;
}

export function VerifierSearchBox({
  value,
  onChange,
  onVerify,
}: VerifierSearchBoxProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onVerify();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className='bg-white dark:bg-neutral-900 p-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 shadow-md flex items-center gap-2'
    >
      <Search className='size-5 text-neutral-400 ml-2' />
      <input
        type='text'
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder='Enter 12-digit APAAR ID (e.g. 9420-1845-6712)'
        className='w-full px-2 py-2 text-sm bg-transparent focus:outline-none font-mono text-neutral-900 dark:text-white'
      />
      <button
        type='submit'
        className='bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold transition shrink-0 cursor-pointer shadow-sm'
      >
        Verify Record
      </button>
    </form>
  );
}
