import { Megaphone } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import type { PostSource } from '../lib/post-source';

export default function PostSourceBadge({ source }: { source: PostSource }) {
  const { isDark } = useTheme();
  if (source !== 'user_post') return null;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${
        isDark ? 'border-indigo-400/30 bg-indigo-500/10 text-indigo-300' : 'border-indigo-200 bg-indigo-50 text-indigo-700'
      }`}
    >
      <Megaphone size={9} strokeWidth={2.5} />
      ProfilePush
    </span>
  );
}
