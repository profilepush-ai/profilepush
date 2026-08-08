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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>
);
