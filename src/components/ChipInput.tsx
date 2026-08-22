import { useState } from 'react';
import { X } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

export default function ChipInput({
  values,
  onChange,
  placeholder = 'Type and press Enter',
  className = '',
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const { isDark } = useTheme();
  const [draft, setDraft] = useState('');

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (!values.some((v) => v.toLowerCase() === trimmed.toLowerCase())) {
      onChange([...values, trimmed]);
    }
    setDraft('');
  }

  function remove(value: string) {
    onChange(values.filter((v) => v !== value));
  }

  return (
    <div className={`rounded-md border p-1.5 ${isDark ? 'border-white/15 bg-[#171a1f]' : 'border-gray-200 bg-white'} ${className}`}>
      {values.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {values.map((value) => (
            <span
              key={value}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${isDark ? 'bg-blue-500/10 text-blue-300' : 'bg-blue-50 text-blue-700'}`}
            >
              {value}
              <button type="button" onClick={() => remove(value)} className="opacity-60 hover:opacity-100" aria-label={`Remove ${value}`}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Backspace' && !draft && values.length > 0) {
            remove(values[values.length - 1]);
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
        className={`w-full border-0 bg-transparent text-[12px] outline-none placeholder:text-gray-400 ${isDark ? 'text-slate-100 placeholder:text-[#64748B]' : 'text-gray-900'}`}
      />
    </div>
  );
}
