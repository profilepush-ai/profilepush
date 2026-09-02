import { Briefcase, UserRound } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

export default function LeadKindPill({ kind }: { kind: 'job' | 'hotlist' }) {
  const { isDark } = useTheme();
  const isHotlist = kind === 'hotlist';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
        isHotlist
          ? (isDark ? 'border-amber-400/30 bg-amber-500/10 text-amber-300' : 'border-amber-200 bg-amber-50 text-amber-700')
          : (isDark ? 'border-blue-400/30 bg-blue-500/10 text-blue-300' : 'border-blue-200 bg-blue-50 text-blue-700')
      }`}
    >
      {isHotlist ? <UserRound size={9} strokeWidth={2.5} /> : <Briefcase size={9} strokeWidth={2.5} />}
      {isHotlist ? 'Hotlist' : 'Job'}
    </span>
  );
}
