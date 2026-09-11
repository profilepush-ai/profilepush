import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';

type Status = { browsed: boolean; posted: boolean; ai_outreach: boolean };

const DISMISS_KEY_PREFIX = 'pp_onboarding_dismissed_';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Persistent floating checklist nudging a new account through the three
// actions retention data showed most accounts never take at all: browsing a
// listing, posting one, and trying AI outreach. Fully unmounts once all
// three are done (or the account is more than 14 days old — this is an
// activation nudge, not a permanent fixture). The close button only hides
// it for the rest of the day, not forever, since the whole point is
// nudging toward actions that are still missing.
export default function OnboardingChecklist() {
  const { account } = useAuth();
  const { isDark } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status | null>(null);
  const [dismissedToday, setDismissedToday] = useState(false);

  const persona = account?.active_persona ?? null;
  const accountAgeMs = account?.created_at ? Date.now() - new Date(account.created_at).getTime() : Infinity;
  const isRecentAccount = accountAgeMs < 14 * 24 * 60 * 60 * 1000;

  useEffect(() => {
    try {
      setDismissedToday(localStorage.getItem(DISMISS_KEY_PREFIX + todayKey()) === '1');
    } catch {
      setDismissedToday(false);
    }
  }, []);

  useEffect(() => {
    if (!persona || !isRecentAccount) return;
    void supabase.rpc('get_my_onboarding_status').then(({ data, error }) => {
      if (!error && data) setStatus(data as Status);
    });
    // Re-check whenever the route changes — the most likely moment a step
    // just got completed (posted, browsed, asked AI) is right after
    // navigating away from the page where it happened.
  }, [persona, isRecentAccount, location.pathname]);

  if (!persona || !isRecentAccount || !status || dismissedToday) return null;
  if (status.browsed && status.posted && status.ai_outreach) return null;

  const browseRoute = persona === 'vendor' ? '/feed/hotlist' : '/feed/jobs';
  const postRoute = persona === 'vendor' ? '/posts/jobs' : '/posts/hotlist';

  const steps: Array<{ key: keyof Status; label: string; onClick: () => void }> = [
    {
      key: 'browsed',
      label: persona === 'vendor' ? 'Browse available consultants' : 'Browse open requirements',
      onClick: () => navigate(browseRoute),
    },
    {
      key: 'posted',
      label: persona === 'vendor' ? 'Post a job requirement' : 'Post a consultant',
      onClick: () => navigate(postRoute),
    },
    {
      key: 'ai_outreach',
      label: 'Try AI outreach on a listing',
      onClick: () => navigate(browseRoute),
    },
  ];
  const doneCount = steps.filter((s) => status[s.key]).length;

  function dismissForToday() {
    try { localStorage.setItem(DISMISS_KEY_PREFIX + todayKey(), '1'); } catch { /* storage unavailable */ }
    setDismissedToday(true);
  }

  return (
    <div
      className={`fixed bottom-20 left-3 z-40 w-[270px] rounded-xl border p-3.5 shadow-xl sm:bottom-4 sm:left-4 ${isDark ? 'border-white/10 bg-[#1B1D21]' : 'border-gray-200 bg-white'}`}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className={`text-[12px] font-bold ${isDark ? 'text-slate-100' : 'text-gray-900'}`}>Getting started ({doneCount}/3)</p>
        <button
          type="button"
          onClick={dismissForToday}
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${isDark ? 'text-slate-400 hover:bg-white/10' : 'text-gray-400 hover:bg-gray-100'}`}
          aria-label="Hide for today"
        >
          <X size={13} />
        </button>
      </div>
      <div className="space-y-1.5">
        {steps.map((step) => {
          const done = status[step.key];
          return (
            <button
              key={step.key}
              type="button"
              onClick={step.onClick}
              disabled={done}
              className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12px] transition-colors ${done ? 'cursor-default' : isDark ? 'hover:bg-white/5' : 'hover:bg-gray-50'}`}
            >
              {done ? (
                <CheckCircle2 size={16} className="shrink-0 text-green-500" />
              ) : (
                <Circle size={16} className={`shrink-0 ${isDark ? 'text-slate-600' : 'text-gray-300'}`} />
              )}
              <span className={done ? (isDark ? 'text-slate-500 line-through' : 'text-gray-400 line-through') : (isDark ? 'text-slate-200' : 'text-gray-700')}>
                {step.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
