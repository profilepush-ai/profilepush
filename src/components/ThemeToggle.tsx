import { MoonStar, SunMedium } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

export default function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[90] inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-2 text-xs font-semibold text-slate-700 shadow-lg shadow-slate-200/70 backdrop-blur transition hover:-translate-y-0.5 hover:shadow-xl sm:right-auto sm:left-4 sm:bottom-4 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100 dark:shadow-slate-950/40"
    >
      {isDark ? <SunMedium size={14} /> : <MoonStar size={14} />}
      <span className="hidden sm:inline">{isDark ? 'Light mode' : 'Dark mode'}</span>
    </button>
  );
}