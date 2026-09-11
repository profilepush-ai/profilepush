import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import PostFormModal from './posts/PostFormModal';
import Toast from './Toast';

const ACTIVE_THRESHOLD_MS = 60_000;
// Retention data showed activation itself (not just return visits) is the
// bigger problem — many first sessions show zero recorded activity at all.
// Brand-new accounts get nudged much sooner than the standard 60s.
const NEW_ACCOUNT_ACTIVE_THRESHOLD_MS = 10_000;
const NEW_ACCOUNT_WINDOW_MS = 60 * 60 * 1000;
const DISMISS_KEY_PREFIX = 'pp_post_nudge_shown_';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Prompts a signed-in user to post (a job for vendors, a consultant for
// bench sales) once they've been actively on the site for 60s — "actively"
// meaning the tab was visible, matching UserActivityTracker's own
// visibility-gated heartbeat rather than counting background-tab time.
// Shows at most once per calendar day (localStorage), and never while the
// user is already on the posting page itself (/posts/*).
//
// Two-step, mirroring MyPostsPage's own landing paste bar: a lightweight
// paste-only box first (just AI, no form fields), and only after that text
// is submitted does the full PostFormModal open (via initialPasteText,
// which makes it run the extraction itself and land pre-filled).
export default function PostPromptNudge() {
  const { account } = useAuth();
  const { isDark } = useTheme();
  const location = useLocation();
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [submittedText, setSubmittedText] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const activeMsRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const persona = account?.active_persona ?? null;
  const onPostsPage = location.pathname.startsWith('/posts/');
  const kind = persona === 'vendor' ? 'job' : 'hotlist';
  const isNewAccount = !!account?.created_at && (Date.now() - new Date(account.created_at).getTime()) < NEW_ACCOUNT_WINDOW_MS;
  const activeThresholdMs = isNewAccount ? NEW_ACCOUNT_ACTIVE_THRESHOLD_MS : ACTIVE_THRESHOLD_MS;

  useEffect(() => {
    if (!persona || onPostsPage) return;

    let alreadyShownToday = false;
    try {
      alreadyShownToday = localStorage.getItem(DISMISS_KEY_PREFIX + todayKey()) === '1';
    } catch {
      alreadyShownToday = false;
    }
    if (alreadyShownToday) return;

    const tick = () => {
      const now = performance.now();
      if (document.visibilityState === 'visible') {
        if (lastTickRef.current !== null) {
          activeMsRef.current += now - lastTickRef.current;
        }
        lastTickRef.current = now;
      } else {
        lastTickRef.current = null;
      }
      if (activeMsRef.current >= activeThresholdMs) {
        setShowPasteBox(true);
        try { localStorage.setItem(DISMISS_KEY_PREFIX + todayKey(), '1'); } catch { /* storage unavailable — worst case it re-prompts */ }
        window.clearInterval(intervalId);
      }
    };

    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [persona, onPostsPage, activeThresholdMs]);

  useEffect(() => {
    if (!showPasteBox) return;
    const id = window.setTimeout(() => textareaRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [showPasteBox]);

  function closeAll() {
    setShowPasteBox(false);
    setPasteText('');
    setSubmittedText(null);
  }

  function handleContinue() {
    if (!pasteText.trim()) return;
    setSubmittedText(pasteText.trim());
    setShowPasteBox(false);
  }

  if (!persona) return null;

  if (submittedText !== null) {
    return (
      <>
        <PostFormModal
          kind={kind}
          existingPost={null}
          initialPasteText={submittedText}
          onClose={closeAll}
          onSaved={() => {
            closeAll();
            setToast({ message: kind === 'job' ? 'Job posted!' : 'Hotlist post created!', type: 'success' });
          }}
          showToast={(message, type = 'success') => setToast({ message, type })}
        />
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </>
    );
  }

  if (!showPasteBox) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={closeAll}>
      <div
        className={`w-full max-w-xl rounded-lg border p-4 text-center shadow-xl ${isDark ? 'border-white/10 bg-[#1B1D21]' : 'border-gray-200 bg-white'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-end">
          <button
            type="button"
            onClick={closeAll}
            className={`rounded-full p-1 transition-colors ${isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <p className={`mb-3 text-[14px] font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>
          {kind === 'job' ? 'Got a requirement to fill?' : 'Got a consultant on the bench?'}
        </p>
        <textarea
          ref={textareaRef}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={8}
          placeholder={kind === 'job' ? "Paste a job requirement here — we'll auto-fill everything ✨" : "Paste a consultant's details here — we'll auto-fill everything ✨"}
          className={`w-full resize-none rounded-2xl border px-5 py-4 text-center text-[14px] outline-none shadow-sm transition focus:ring-2 ${isDark ? 'border-white/10 bg-[#20242a] text-slate-100 placeholder:text-[#94A3B8] focus:ring-blue-500/30' : 'border-[#dfdad2] bg-white text-gray-900 placeholder:text-gray-400 focus:ring-blue-200'}`}
        />
        <button
          type="button"
          onClick={handleContinue}
          disabled={!pasteText.trim()}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-6 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Sparkles size={15} />
          Continue
        </button>
      </div>
    </div>
  );
}
