import { Briefcase, UserRound } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

export default function LeadKindPill({ kind, variant = 'pill' }: { kind: 'job' | 'hotlist'; variant?: 'pill' | 'banner' }) {
  const { isDark } = useTheme();
  const isHotlist = kind === 'hotlist';
  const Icon = isHotlist ? UserRound : Briefcase;
  const label = isHotlist ? 'Hotlist' : 'Job';

  if (variant === 'banner') {
    return (
      <span
        className={`absolute right-0 top-0 z-10 inline-flex items-center gap-1 rounded-bl-lg rounded-tr-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide shadow-sm ${
          isHotlist
            ? (isDark ? 'bg-amber-500/15 text-amber-300' : 'bg-amber-100 text-amber-800')
            : (isDark ? 'bg-blue-500/15 text-blue-300' : 'bg-blue-100 text-blue-800')
        }`}
      >
        <Icon size={10} strokeWidth={2.5} />
        {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
        isHotlist
          ? (isDark ? 'border-amber-400/30 bg-amber-500/10 text-amber-300' : 'border-amber-200 bg-amber-50 text-amber-700')
          : (isDark ? 'border-blue-400/30 bg-blue-500/10 text-blue-300' : 'border-blue-200 bg-blue-50 text-blue-700')
      }`}
    >
      <Icon size={9} strokeWidth={2.5} />
      {label}
    </span>
  );
}
