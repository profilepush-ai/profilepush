import { useEffect, useState } from 'react';
import { Apple, ArrowLeft, Check, Copy, Download, Smartphone, X } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';

const APP_URL = 'https://profilepush.ai';
const DISMISS_KEY = 'pp_hide_add_to_home_prompt';

type Platform = 'ios' | 'android';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// No browser lets a link "auto-install" a PWA on a different device — both
// iOS and Android require the install/add-to-home-screen action to happen
// as a user gesture inside that device's own browser session (an anti-spam
// restriction, not something any URL can bypass). Chrome on Android does
// expose a real one-tap native install via `beforeinstallprompt` once the
// page is actually loaded there, so we use it when available instead of
// menu-hunting instructions. iOS has no equivalent API at all (an Apple
// restriction) — Share > Add to Home Screen stays manual there permanently.
const ANDROID_FALLBACK_STEPS = [
  'Open the link above in Chrome on your Android phone.',
  "Open the menu and tap 'Install app' or 'Add to Home screen' (exact wording varies by Chrome version).",
];

const IOS_STEPS = [
  'Open the link above in Safari on your iPhone or iPad.',
  'Tap the Share icon at the bottom of the screen.',
  "Tap 'Add to Home Screen', then tap Add.",
];

export default function AddToHomeScreenPrompt() {
  const { isDark } = useTheme();
  const [dismissed, setDismissed] = useState(true);
  const isAndroidUA = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  const isIOSUA = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/i.test(navigator.userAgent);
  const [platform, setPlatform] = useState<Platform | null>(isAndroidUA ? 'android' : isIOSUA ? 'ios' : null);
  const [copied, setCopied] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => setInstalled(true);
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  if (dismissed || installed) return null;

  function handleDismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // localStorage unavailable — dismiss for this session only
    }
    setDismissed(true);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(APP_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable — the URL is still visible to select manually
    }
  }

  async function handleInstallClick() {
    if (!installEvent) return;
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setInstallEvent(null);
  }

  const showUrlBox = !(isAndroidUA || isIOSUA);

  return (
    <div
      className={`fixed bottom-20 right-3 z-40 w-[290px] animate-slide-up rounded-xl border p-4 shadow-xl sm:bottom-4 sm:right-4 ${
        isDark ? 'border-white/10 bg-[#20242a]' : 'border-gray-200 bg-white'
      }`}
    >
      {!platform ? (
        <>
          <div className="flex items-start gap-2.5">
            <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isDark ? 'bg-blue-500/10 text-blue-300' : 'bg-blue-50 text-blue-600'}`}>
              <Smartphone size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-[13px] font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>Add as an App</p>
              <p className={`mt-0.5 text-[11px] leading-snug ${isDark ? 'text-[#94A3B8]' : 'text-gray-500'}`}>
                Get quick access on your phone — install ProfilePush like a native app.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDismiss}
              className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${isDark ? 'text-slate-400 hover:bg-white/10' : 'text-gray-400 hover:bg-gray-100'}`}
              aria-label="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlatform('ios')}
              className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
                isDark ? 'border-white/15 text-slate-200 hover:bg-white/5' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Apple size={13} />
              iOS
            </button>
            <button
              type="button"
              onClick={() => setPlatform('android')}
              className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-semibold transition-colors ${
                isDark ? 'border-white/15 text-slate-200 hover:bg-white/5' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Smartphone size={13} />
              Android
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlatform(null)}
              className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${isDark ? 'text-slate-400 hover:bg-white/10' : 'text-gray-400 hover:bg-gray-100'}`}
              aria-label="Back"
            >
              <ArrowLeft size={13} />
            </button>
            <p className={`min-w-0 flex-1 text-[13px] font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
              Add to Home Screen — {platform === 'ios' ? 'iOS' : 'Android'}
            </p>
            <button
              type="button"
              onClick={handleDismiss}
              className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${isDark ? 'text-slate-400 hover:bg-white/10' : 'text-gray-400 hover:bg-gray-100'}`}
              aria-label="Dismiss"
            >
              <X size={13} />
            </button>
          </div>

          {platform === 'android' && installEvent ? (
            <>
              <p className={`mt-3 text-[12px] leading-snug ${isDark ? 'text-[#94A3B8]' : 'text-gray-500'}`}>
                Your browser supports one-tap install — no menus needed.
              </p>
              <button
                type="button"
                onClick={() => void handleInstallClick()}
                className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700"
              >
                <Download size={14} />
                Install App
              </button>
            </>
          ) : (
            <>
              {showUrlBox && (
                <>
                  <p className={`mb-1.5 mt-3 text-[11px] font-semibold uppercase tracking-wide ${isDark ? 'text-[#64748B]' : 'text-gray-400'}`}>
                    Open this on your phone
                  </p>
                  <div className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 ${isDark ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}>
                    <span className={`min-w-0 flex-1 truncate text-[12px] ${isDark ? 'text-slate-200' : 'text-gray-700'}`}>{APP_URL}</span>
                    <button
                      type="button"
                      onClick={() => void handleCopy()}
                      className={`inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-semibold transition-colors ${
                        copied ? 'text-emerald-600' : isDark ? 'text-blue-300 hover:bg-white/10' : 'text-blue-600 hover:bg-blue-50'
                      }`}
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </>
              )}

              <ol className={`space-y-1.5 text-[11px] leading-snug ${showUrlBox ? 'mt-3' : 'mt-2'} ${isDark ? 'text-[#94A3B8]' : 'text-gray-500'}`}>
                {(platform === 'ios' ? IOS_STEPS : ANDROID_FALLBACK_STEPS).map((step, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span className="shrink-0 font-semibold">{i + 1}.</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
              {platform === 'ios' && (
                <p className={`mt-2 text-[10px] italic leading-snug ${isDark ? 'text-[#64748B]' : 'text-gray-400'}`}>
                  iOS doesn't allow apps to trigger this automatically — Safari always requires this manual step.
                </p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
