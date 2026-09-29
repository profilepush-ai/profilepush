import { Briefcase, UserRound } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

export default function LeadKindPill({
  kind,
  variant = 'pill',
  onProfilePush = false,
}: {
  kind: 'job' | 'hotlist';
  variant?: 'pill' | 'banner';
  // Banner only: the post was published on ProfilePush, so the logo sits to
  // the left of the kind icon in the same corner tab.
  onProfilePush?: boolean;
}) {
  const { isDark } = useTheme();
  const isHotlist = kind === 'hotlist';
  const Icon = isHotlist ? UserRound : Briefcase;
  const label = isHotlist ? 'Hotlist' : 'Job';

  if (variant === 'banner') {
    // Icon only. The word sat in the corner of every card in a list where
    // every card is the same kind, so it repeated something the reader
    // already knew and took the space the rank now uses. The label stays as
    // the title, for anyone hovering or using a screen reader.
    return (
      <span
        title={label}
        aria-label={label}
        className={`absolute right-0 top-0 z-10 inline-flex h-6 items-center justify-center gap-1 rounded-bl-lg rounded-tr-lg shadow-sm ${onProfilePush ? 'px-1.5' : 'w-6'} ${
          isHotlist
            ? (isDark ? 'bg-purple-500/10 text-purple-300' : 'bg-purple-50 text-purple-600')
            : (isDark ? 'bg-blue-500/10 text-blue-300' : 'bg-blue-50 text-blue-600')
        }`}
      >
        {onProfilePush && (
          <img src="/favicon.svg" width={12} height={12} alt="Posted on ProfilePush" title="Posted on ProfilePush" className="shrink-0 rounded-[3px]" />
        )}
        <Icon size={12} strokeWidth={2.5} />
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
