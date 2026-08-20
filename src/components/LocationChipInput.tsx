import { useState } from 'react';
import { X } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import LocationAutosuggestInput from './LocationAutosuggestInput';

export default function LocationChipInput({
  values,
  onChange,
  placeholder = 'Type a city/state/country and pick',
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const { isDark } = useTheme();
  const [draft, setDraft] = useState('');

  function add(value: string) {
    const trimmed = value.trim();
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
    <div className={`rounded-md border p-1.5 ${isDark ? 'border-white/15 bg-[#171a1f]' : 'border-gray-200 bg-white'}`}>
      {values.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {values.map((value) => (
            <span
              key={value}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${isDark ? 'bg-blue-500/10 text-blue-300' : 'bg-blue-50 text-blue-700'}`}
            >
              {value}
              <button type="button" onClick={() => remove(value)} className="opacity-60 hover:opacity-100" aria-label={`Remove ${value}`}>
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <LocationAutosuggestInput
          value={draft}
          onChange={setDraft}
          onSelectPlace={(place) => add(place.formatted || draft)}
          scope="any"
          placeholder={placeholder}
          className="flex-1"
          inputClassName={isDark ? '!border-white/15 !bg-[#20242a] !text-slate-100 placeholder:!text-[#64748B]' : ''}
        />
        <button
          type="button"
          onClick={() => add(draft)}
          className={`h-[30px] shrink-0 rounded-md border px-2 text-[10px] font-semibold transition-colors ${isDark ? 'border-white/15 text-[#94A3B8] hover:bg-white/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          Add
        </button>
      </div>
    </div>
  );
}
