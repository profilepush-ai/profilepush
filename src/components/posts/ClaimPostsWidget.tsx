import { useCallback, useEffect, useState } from 'react';
import { Briefcase, Sparkles, UserRound, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import LogoSpinner from '../LogoSpinner';

const CLAIMABLE_POSTS_DISMISSED_KEY = 'profilepush-claimable-posts-dismissed';

function readDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(CLAIMABLE_POSTS_DISMISSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((id): id is string => typeof id === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

function writeDismissedIds(ids: Set<string>) {
  try {
    localStorage.setItem(CLAIMABLE_POSTS_DISMISSED_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Best-effort only — a failed write just means the dismiss doesn't persist.
  }
}

function formatAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface ClaimableMatch {
  id: string;
  kind: 'job' | 'hotlist';
  title: string;
  createdAt: string;
}

export default function ClaimPostsWidget({ onClaimed, showToast }: {
  onClaimed: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
}) {
  const { account, user } = useAuth();
  const { isDark } = useTheme();
  const [matches, setMatches] = useState<ClaimableMatch[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => readDismissedIds());
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimingAll, setClaimingAll] = useState(false);

  const refresh = useCallback(async () => {
    const email = user?.email?.trim().toLowerCase();
    if (!account?.id || !email) {
      setMatches([]);
      setLoaded(true);
      return;
    }

    // 30-day window here is display-only and filters by created_at (ingestion
    // time) since PostgREST can't express COALESCE(posted_at, created_at) in a
    // .gte() filter — the claim_scraped_*_post RPC re-validates the true
    // window server-side with that COALESCE form, so a row that's very
    // slightly stale here just fails loudly with a toast on claim, never
    // silently succeeds.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [jobsRes, hotlistRes] = await Promise.all([
      supabase
        .from('social_jobs')
        .select('id, job_title, created_at')
        .eq('post_source', 'linkedin_scrape')
        .is('created_by_account_id', null)
        .is('hidden_at', null)
        .eq('poster_email', email)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('social_hotlist')
        .select('id, role_title, created_at')
        .eq('post_source', 'linkedin_scrape')
        .is('created_by_account_id', null)
        .is('hidden_at', null)
        .eq('bench_sales_recruiter_email', email)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    const jobRows = (jobsRes.data ?? []) as Array<{ id: string; job_title: string | null; created_at: string }>;
    const hotlistRows = (hotlistRes.data ?? []) as Array<{ id: string; role_title: string | null; created_at: string }>;

    const jobMatches: ClaimableMatch[] = jobRows.map((row) => ({
      id: row.id,
      kind: 'job',
      title: row.job_title || 'Job Opportunity',
      createdAt: row.created_at,
    }));
    const hotlistMatches: ClaimableMatch[] = hotlistRows.map((row) => ({
      id: row.id,
      kind: 'hotlist',
      title: row.role_title || 'Available Consultant',
      createdAt: row.created_at,
    }));

    setMatches([...jobMatches, ...hotlistMatches].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
    setLoaded(true);
  }, [account?.id, user?.email]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleMatches = matches.filter((match) => !dismissedIds.has(match.id));

  const handleDismiss = useCallback((id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      writeDismissedIds(next);
      return next;
    });
  }, []);

  const claimOne = useCallback(async (match: ClaimableMatch): Promise<boolean> => {
    const { error } = await supabase.rpc(
      match.kind === 'job' ? 'claim_scraped_job_post' : 'claim_scraped_hotlist_post',
      { p_id: match.id },
    );
    if (error) return false;
    setMatches((prev) => prev.filter((item) => item.id !== match.id));
    return true;
  }, []);

  const handleClaimOne = useCallback(async (match: ClaimableMatch) => {
    setClaimingId(match.id);
    try {
      const ok = await claimOne(match);
      if (ok) {
        showToast('Post claimed');
        onClaimed();
      } else {
        showToast('This post is no longer available to claim', 'error');
      }
    } finally {
      setClaimingId(null);
    }
  }, [claimOne, onClaimed, showToast]);

  const handleClaimAll = useCallback(async () => {
    setClaimingAll(true);
    let succeeded = 0;
    let failed = 0;
    for (const match of visibleMatches) {
      const ok = await claimOne(match);
      if (ok) succeeded += 1;
      else failed += 1;
    }
    setClaimingAll(false);
    if (succeeded > 0) onClaimed();
    if (failed === 0) {
      showToast(`Claimed ${succeeded} post${succeeded === 1 ? '' : 's'}`);
    } else if (succeeded === 0) {
      showToast('Could not claim these posts', 'error');
    } else {
      showToast(`Claimed ${succeeded} of ${succeeded + failed} posts — ${failed} could not be claimed`, 'error');
    }
  }, [claimOne, onClaimed, showToast, visibleMatches]);

  if (!loaded || visibleMatches.length === 0) return null;

  return (
    <div className="mb-2 shrink-0 overflow-hidden rounded-lg border border-[#dfdad2] bg-white dark:border-white/10 dark:bg-[#1E2126]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <p className="text-[12px] font-medium text-gray-700 dark:text-slate-200">
          We found {visibleMatches.length} post{visibleMatches.length === 1 ? '' : 's'} under your email — claim {visibleMatches.length === 1 ? 'it' : 'them'} to manage here.
        </p>
        <button
          type="button"
          onClick={() => void handleClaimAll()}
          disabled={claimingAll || claimingId !== null}
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {claimingAll ? <LogoSpinner size={11} /> : <Sparkles size={11} />}
          Claim all
        </button>
      </div>
      <div className="divide-y divide-[#dfdad2] border-t border-[#dfdad2] dark:divide-white/10 dark:border-white/10">
        {visibleMatches.map((match) => (
          <div key={match.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              {match.kind === 'job' ? <Briefcase size={11} className="shrink-0 text-gray-400" /> : <UserRound size={11} className="shrink-0 text-gray-400" />}
              <span className="truncate text-[12px] text-gray-800 dark:text-slate-200">{match.title}</span>
              <span className="shrink-0 text-[11px] text-[#94A3B8]">· Posted {formatAgo(match.createdAt)}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => void handleClaimOne(match)}
                disabled={claimingId === match.id || claimingAll}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isDark ? 'border-blue-400/30 text-blue-400 hover:bg-blue-500/10' : 'border-blue-200 text-blue-600 hover:bg-blue-50'}`}
              >
                {claimingId === match.id ? <LogoSpinner size={10} /> : 'Claim'}
              </button>
              <button
                type="button"
                onClick={() => handleDismiss(match.id)}
                disabled={claimingAll}
                title="Not mine"
                className={`rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100'}`}
              >
                <X size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
