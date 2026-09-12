import { useEffect, useState } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import Toast from './Toast';

const EXIT_PRESS_WINDOW_MS = 2000;

// Without this listener, Capacitor's default Android back-button behavior
// exits the app immediately the moment there's no more router history to go
// back through (e.g. sitting on the home/feed screen) — a jarring,
// unconfirmed exit that testers flagged. Standard Android convention:
// navigate back through history when possible, otherwise require a second
// back-press within a short window before actually exiting.
export default function AndroidBackButtonHandler() {
  const [showExitToast, setShowExitToast] = useState(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let lastBackPressAt = 0;

    const listenerPromise = App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
        return;
      }

      const now = Date.now();
      if (now - lastBackPressAt < EXIT_PRESS_WINDOW_MS) {
        void App.exitApp();
        return;
      }
      lastBackPressAt = now;
      setShowExitToast(true);
    });

    return () => {
      void listenerPromise.then((listener) => listener.remove());
    };
  }, []);

  if (!showExitToast) return null;
  return <Toast message="Press back again to exit" onClose={() => setShowExitToast(false)} />;
}
