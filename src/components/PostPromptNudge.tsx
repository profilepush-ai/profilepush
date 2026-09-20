import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';

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

// Points a signed-in user at AI Match once they've been actively on the site
// for 60s — "actively" meaning the tab was visible, matching
// UserActivityTracker's own visibility-gated heartbeat rather than counting
// background-tab time. Shows at most once per calendar day (localStorage).
//
// It used to open a paste box and then the full post form. AI Match is the
// better first thing to try: it posts what you paste anyway, and it comes back
// with ranked matches rather than just a saved post. So the nudge now just
// sends them there, and never fires while they are already on /match (or the
// posting page).
export default function PostPromptNudge() {
  const { account } = useAuth();
  const { isDark } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const activeMsRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);

  const persona = account?.active_persona ?? null;
  // Nothing to nudge toward if they are already there.
  const onPostsPage = location.pathname.startsWith('/posts/') || location.pathname.startsWith('/match');
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
        setIsOpen(true);
        try { localStorage.setItem(DISMISS_KEY_PREFIX + todayKey(), '1'); } catch { /* storage unavailable — worst case it re-prompts */ }
        window.clearInterval(intervalId);
      }
    };

    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [persona, onPostsPage, activeThresholdMs]);

  function closeAll() {
    setIsOpen(false);
  }

  if (!persona) return null;
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={closeAll}>
      <div
        className={`w-full max-w-sm rounded-2xl border p-5 text-center shadow-xl ${isDark ? 'border-white/10 bg-[#1B1D21]' : 'border-gray-200 bg-white'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-end">
          <button
            type="button"
            onClick={closeAll}
            className={`-mr-1 -mt-1 rounded-full p-1 transition-colors ${isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30">
          <Sparkles size={22} />
        </span>
        <p className={`text-[16px] font-semibold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>Try AI Match</p>
        <p className={`mt-1.5 text-[13px] leading-snug ${isDark ? 'text-[#94A3B8]' : 'text-gray-500'}`}>
          {kind === 'job'
            ? 'Paste a job requirement and get consultants from the last 30 days, ranked 1 to 10.'
            : 'Paste a consultant and get jobs from the last 30 days, ranked 1 to 10.'}
        </p>
        <button
          type="button"
          onClick={() => { closeAll(); navigate('/match'); }}
          className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 px-6 py-3 text-[14px] font-semibold text-white shadow-md shadow-indigo-500/30 transition active:scale-[0.98]"
        >
          <Sparkles size={16} />
          Try AI Match
        </button>
      </div>
    </div>
  );
}
