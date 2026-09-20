import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  theme: ThemeMode;
  isDark: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

const THEME_STORAGE_KEY = 'profilepush-theme';

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  isDark: false,
  setTheme: () => {},
  toggleTheme: () => {},
});

// The app is light-only. Dark mode was never finished — whole screens were
// unreadable in it — and with no stored preference it followed the operating
// system, so an incognito window on a dark-themed machine opened straight into
// the broken version.
//
// The context is kept rather than deleted: `isDark` is read in hundreds of
// places to choose a class, and it now always answers false. The `dark:`
// variants throughout the app are inert on their own, because Tailwind is
// configured with darkMode: 'class' and nothing ever adds that class.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme] = useState<ThemeMode>('light');

  useEffect(() => {
    const root = document.documentElement;
    // Clears the class and the stored 'dark' for anyone who set it before.
    root.classList.remove('dark');
    root.style.colorScheme = 'light';
    try {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      // Private windows can refuse storage; nothing here depends on it.
    }
  }, []);

  const setTheme = useCallback(() => {}, []);
  const toggleTheme = useCallback(() => {}, []);

  const value = useMemo(() => ({
    theme,
    isDark: false,
    setTheme,
    toggleTheme,
  }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}