import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import { ThemeProvider } from './contexts/ThemeContext';
import './index.css';

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
