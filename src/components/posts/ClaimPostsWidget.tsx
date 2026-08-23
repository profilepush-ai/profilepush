import { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, Building2, Eye, MapPin, UserRound, X } from 'lucide-react';
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
  subtitle: string;
  location: string;
  employmentType: string;
  rateLabel: string;
  visaLabel: string;
  skills: string[];
  experienceYears: number | null;
  postContent: string;
  createdAt: string;
}

interface JobRow {
  id: string;
  job_title: string | null;
  company_name: string | null;
  location: string | null;
  employment_type: string | null;
  salary_range: string | null;
  post_content: string | null;
  extracted_skills: string[] | null;
  extracted_experience_years: number | null;
  extracted_visa_types: string[] | null;
  created_at: string;
}

interface HotlistRow {
  id: string;
  role_title: string | null;
  candidate_name: string | null;
  locations: string[] | null;
  employment_type: string | null;
  hourly_rate_min: number | null;
  hourly_rate_max: number | null;
  raw_post_content: string | null;
  core_skills: string[] | null;
  years_experience: number | null;
  visa_type: string | null;
  created_at: string;
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
  const [showModal, setShowModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [bulkClaiming, setBulkClaiming] = useState(false);
  const [previewMatch, setPreviewMatch] = useState<ClaimableMatch | null>(null);

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
        .select('id, job_title, company_name, location, employment_type, salary_range, post_content, extracted_skills, extracted_experience_years, extracted_visa_types, created_at')
        .eq('post_source', 'linkedin_scrape')
        .is('created_by_account_id', null)
        .is('hidden_at', null)
        .eq('poster_email', email)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('social_hotlist')
        .select('id, role_title, candidate_name, locations, employment_type, hourly_rate_min, hourly_rate_max, raw_post_content, core_skills, years_experience, visa_type, created_at')
        .eq('post_source', 'linkedin_scrape')
        .is('created_by_account_id', null)
        .is('hidden_at', null)
        .eq('bench_sales_recruiter_email', email)
        .gte('created_at', thirtyDaysAgo)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    const jobRows = (jobsRes.data ?? []) as JobRow[];
    const hotlistRows = (hotlistRes.data ?? []) as HotlistRow[];

    const jobMatches: ClaimableMatch[] = jobRows.map((row) => ({
      id: row.id,
      kind: 'job',
      title: row.job_title || 'Job Opportunity',
      subtitle: row.company_name || '',
      location: row.location || '',
      employmentType: row.employment_type || '',
      rateLabel: row.salary_range || '',
      visaLabel: (row.extracted_visa_types ?? []).join(', '),
      skills: row.extracted_skills ?? [],
      experienceYears: row.extracted_experience_years,
      postContent: row.post_content || '',
      createdAt: row.created_at,
    }));
    const hotlistMatches: ClaimableMatch[] = hotlistRows.map((row) => ({
      id: row.id,
      kind: 'hotlist',
      title: row.role_title || 'Available Consultant',
      subtitle: row.candidate_name || '',
      location: (row.locations ?? []).join(', '),
      employmentType: row.employment_type || '',
      rateLabel: row.hourly_rate_min != null || row.hourly_rate_max != null
        ? `$${row.hourly_rate_min ?? '?'}-$${row.hourly_rate_max ?? '?'}/hr`
        : '',
      visaLabel: row.visa_type || '',
      skills: row.core_skills ?? [],
      experienceYears: row.years_experience,
      postContent: row.raw_post_content || '',
      createdAt: row.created_at,
    }));

    setMatches([...jobMatches, ...hotlistMatches].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
    setLoaded(true);
  }, [account?.id, user?.email]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visibleMatches = useMemo(() => matches.filter((match) => !dismissedIds.has(match.id)), [matches, dismissedIds]);

  useEffect(() => {
    if (visibleMatches.length === 0) {
      setShowModal(false);
      setSelectedIds(new Set());
    }
  }, [visibleMatches.length]);

  const handleDismiss = useCallback((id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      writeDismissedIds(next);
      return next;
    });
    setSelectedIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => (prev.size === visibleMatches.length ? new Set() : new Set(visibleMatches.map((m) => m.id))));
  }, [visibleMatches]);

  const claimOne = useCallback(async (match: ClaimableMatch): Promise<boolean> => {
    const { error } = await supabase.rpc(
      match.kind === 'job' ? 'claim_scraped_job_post' : 'claim_scraped_hotlist_post',
      { p_id: match.id },
    );
    if (error) return false;
    setMatches((prev) => prev.filter((item) => item.id !== match.id));
    setSelectedIds((prev) => {
      if (!prev.has(match.id)) return prev;
      const next = new Set(prev);
      next.delete(match.id);
      return next;
    });
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

  const claimMany = useCallback(async (targets: ClaimableMatch[]) => {
    setBulkClaiming(true);
    let succeeded = 0;
    let failed = 0;
    for (const match of targets) {
      const ok = await claimOne(match);
      if (ok) succeeded += 1;
      else failed += 1;
    }
    setBulkClaiming(false);
    if (succeeded > 0) onClaimed();
    if (failed === 0) {
      showToast(`Claimed ${succeeded} post${succeeded === 1 ? '' : 's'}`);
    } else if (succeeded === 0) {
      showToast('Could not claim these posts', 'error');
    } else {
      showToast(`Claimed ${succeeded} of ${succeeded + failed} posts — ${failed} could not be claimed`, 'error');
    }
  }, [claimOne, onClaimed, showToast]);

  const handleClaimAll = useCallback(() => { void claimMany(visibleMatches); }, [claimMany, visibleMatches]);
  const handleClaimSelected = useCallback(() => {
    void claimMany(visibleMatches.filter((match) => selectedIds.has(match.id)));
  }, [claimMany, selectedIds, visibleMatches]);

  if (!loaded || visibleMatches.length === 0) return null;

  const allSelected = selectedIds.size > 0 && selectedIds.size === visibleMatches.length;

  return (
    <>
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-[#dfdad2] bg-white px-3 py-2 dark:border-white/10 dark:bg-[#1E2126]">
        <p className="text-[12px] font-medium text-gray-700 dark:text-slate-200">
          We found {visibleMatches.length} post{visibleMatches.length === 1 ? '' : 's'} under your email — claim {visibleMatches.length === 1 ? 'it' : 'them'} to manage here.
        </p>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-blue-200 px-3 py-1 text-[11px] font-semibold text-blue-600 transition-colors hover:bg-blue-50 dark:border-blue-400/30 dark:text-blue-400 dark:hover:bg-blue-500/10"
        >
          Review posts
        </button>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowModal(false)}>
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className={`flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border shadow-xl ${isDark ? 'border-white/10 bg-[#1B1D21]' : 'border-gray-200 bg-white'}`}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-white/10">
              <div className="min-w-0">
                <h2 className="text-[15px] font-semibold text-gray-900 dark:text-slate-100">Claimable posts</h2>
                <p className="text-[11px] text-gray-500 dark:text-[#94A3B8]">{visibleMatches.length} post{visibleMatches.length === 1 ? '' : 's'} found under your email</p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${isDark ? 'text-slate-300 hover:bg-white/10' : 'text-gray-500 hover:bg-gray-100'}`}
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2 dark:border-white/10">
              <label className="flex items-center gap-1.5 text-[12px] text-gray-600 dark:text-slate-300">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="h-3.5 w-3.5 rounded border-gray-300" />
                Select all
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClaimSelected}
                  disabled={selectedIds.size === 0 || bulkClaiming}
                  className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${isDark ? 'border-blue-400/30 text-blue-400 hover:bg-blue-500/10' : 'border-blue-200 text-blue-600 hover:bg-blue-50'}`}
                >
                  Claim selected{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                </button>
                <button
                  type="button"
                  onClick={handleClaimAll}
                  disabled={bulkClaiming}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bulkClaiming ? <LogoSpinner size={11} /> : null}
                  Claim all
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {visibleMatches.map((match) => (
                  <div
                    key={match.id}
                    className="relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-[#dfdad2] bg-white dark:border-white/10 dark:bg-[#1E2126]"
                  >
                    <div className="min-w-0 flex-1 px-3 pt-2.5 pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <label className="flex min-w-0 flex-1 items-start gap-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(match.id)}
                            onChange={() => toggleSelected(match.id)}
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-gray-300"
                          />
                          <span className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold leading-snug text-blue-600 dark:text-blue-400">{match.title}</p>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-[#94A3B8]">
                              <span>Posted {formatAgo(match.createdAt)}</span>
                              {match.subtitle && (
                                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                  <span>•</span>
                                  <Building2 size={10} className="shrink-0 text-gray-400" />
                                  <span>{match.subtitle}</span>
                                </span>
                              )}
                              {match.location && (
                                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                                  <span>•</span>
                                  <MapPin size={10} className="shrink-0 text-gray-400" />
                                  <span className="truncate">{match.location}</span>
                                </span>
                              )}
                            </span>
                          </span>
                        </label>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${isDark ? 'border-white/15 bg-white/5 text-slate-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                            {match.kind === 'job' ? <Briefcase size={9} /> : <UserRound size={9} />}
                            {match.kind === 'job' ? 'Job' : 'Hotlist'}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDismiss(match.id)}
                            title="Not mine"
                            className={`rounded p-0.5 transition-colors ${isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100'}`}
                          >
                            <X size={11} />
                          </button>
                        </div>
                      </div>

                      {(match.employmentType || match.rateLabel || match.visaLabel || match.experienceYears != null) && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {match.employmentType && (
                            <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${isDark ? 'border-white/15 bg-white/5 text-slate-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>{match.employmentType}</span>
                          )}
                          {match.rateLabel && (
                            <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${isDark ? 'border-white/15 bg-white/5 text-slate-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>{match.rateLabel}</span>
                          )}
                          {match.visaLabel && (
                            <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${isDark ? 'border-white/15 bg-white/5 text-slate-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>{match.visaLabel}</span>
                          )}
                          {match.experienceYears != null && (
                            <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${isDark ? 'border-white/15 bg-white/5 text-slate-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>{match.experienceYears}+ yrs</span>
                          )}
                        </div>
                      )}

                      {match.skills.length > 0 && (
                        <p className="mt-1.5 truncate text-[10px] leading-tight text-gray-500 dark:text-[#94A3B8]">
                          {match.skills.slice(0, 6).join(' · ')}
                        </p>
                      )}
                    </div>

                    <div className="mt-auto flex items-center justify-around border-t border-gray-200 dark:border-white/10">
                      <button
                        type="button"
                        onClick={() => setPreviewMatch(match)}
                        title="Preview original post"
                        className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 text-gray-500 transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-white/5"
                      >
                        <Eye size={15} strokeWidth={1.75} />
                        <span className="text-[12px] font-normal">Preview</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleClaimOne(match)}
                        disabled={claimingId === match.id || bulkClaiming}
                        className="inline-flex h-9 flex-1 items-center justify-center text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-500/10"
                      >
                        {claimingId === match.id ? <LogoSpinner size={13} /> : <span className="text-[12px] font-semibold">Claim</span>}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {previewMatch && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onClick={() => setPreviewMatch(null)}>
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className={`flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border shadow-xl ${isDark ? 'border-white/10 bg-[#20242a]' : 'border-gray-200 bg-white'}`}
          >
            <div className="flex items-start gap-2.5 border-b border-gray-100 p-4 dark:border-white/10">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300">
                <Eye size={16} />
              </span>
              <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-gray-900 dark:text-slate-100">{previewMatch.title}</h2>
              <button
                type="button"
                onClick={() => setPreviewMatch(null)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10"
                aria-label="Close preview"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-700 dark:text-slate-300">
                {previewMatch.postContent || 'No post content available.'}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
