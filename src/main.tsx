import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import { ThemeProvider } from './contexts/ThemeContext';
import './index.css';
import { inAndroidApp } from './lib/android-shell';

// Marks the Android app shell so the system-bar insets in index.css apply.
// Detection lives in lib/android-shell because the Play banner needs the same
// answer and the two must not disagree.
//
// Re-checked on resize because the viewport can be short at the moment this
// runs — the keyboard, or a layout that has not settled — and a page that
// starts life misjudged would keep the wrong padding for the whole session.
// The class is only ever added: once the viewport has been seen filling the
// screen, that is a fact about the shell, not about this instant.
if (typeof window !== 'undefined') {
  const markShell = () => {
    if (!inAndroidApp()) return false;
    document.documentElement.classList.add('android-shell');
    return true;
  };

  // Retried, because this file runs before React mounts and the answer can
  // arrive late. capacitor.config.ts points server.url at the live site, so
  // Capacitor injects its bridge into a page that is already running — and on
  // the device that reported this, the bridge was the only check that worked:
  // the Play banner, which asks from inside an effect, was correctly hidden
  // while this, asking at startup, saw nothing and never added the class.
  //
  // Stops as soon as it succeeds, and gives up after three seconds rather
  // than polling a browser forever.
  if (!markShell()) {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (markShell() || Date.now() - started > 3000) window.clearInterval(timer);
    }, 150);
    window.addEventListener('load', markShell, { once: true, passive: true });
  }

  // The viewport can also be short at startup — a keyboard, a layout that has
  // not settled — so a later measurement still counts.
  window.addEventListener('resize', markShell, { passive: true });
  window.addEventListener('orientationchange', markShell, { passive: true });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const isIOS = /iPad|iPhone|iPod/.test(window.navigator.userAgent)
    || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);

  if (isIOS) {
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    const defaultViewport = viewportMeta?.getAttribute('content') ?? 'width=device-width, initial-scale=1.0';
    const focusedViewport = `${defaultViewport}, maximum-scale=1`;

    const isFocusableTextInput = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.tagName === 'TEXTAREA') return true;
      if (target.tagName !== 'INPUT') return false;
      const type = (target as HTMLInputElement).type;
      return type === 'text' || type === 'search' || type === 'email' || type === 'tel' || type === 'url' || type === 'password' || type === 'number';
    };

    document.addEventListener('focusin', (event) => {
      if (viewportMeta && isFocusableTextInput(event.target)) {
        viewportMeta.setAttribute('content', focusedViewport);
      }
    });

    document.addEventListener('focusout', (event) => {
      if (viewportMeta && isFocusableTextInput(event.target)) {
        viewportMeta.setAttribute('content', defaultViewport);
      }
    });
  }
}

// Registered in production only: in dev it would cache a build that Vite is
// about to replace. Failure is swallowed because nothing here is required for
// the app to work — the worker only adds installability and offline HTML.
//
// updateViaCache: 'none' makes the browser fetch sw.js past its own HTTP
// cache on every update check. Pages serves it with max-age=14400, and a
// browser only ignores that cache by itself when max-age is over 24 hours —
// so without this, a fix to a worker that is already on someone's machine
// could take four hours to reach them. Setting it here rather than with a
// _headers rule because Pages does not honour Cache-Control overrides on
// static files: the rule applied and the max-age survived it anyway.
if (import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>
);
