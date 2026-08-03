import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Radar, RefreshCw, User, Briefcase, MapPin, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, XCircle, Zap,
  Search, Target, Loader2, Users, Check, Clock,
  Eye, EyeOff, Sparkles, ExternalLink, Info, Power, Save, Pencil,
  Bookmark, BookmarkCheck, PenLine, Ban, X, ArrowUpRight,
  FileText, Activity, Download, Lock, Copy, Link2,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { PlanModal } from '../components/PlanModal';
import LocationAutosuggestInput from '../components/LocationAutosuggestInput';
import { loadRazorpay, TIERS, INR_PER_USD, fmtINR, getBillingErrorMessage } from '../lib/billing-plan';
import { buildSupabaseFunctionHeaders, supabase } from '../lib/supabase';
import { triggerProfileEmbedding, triggerRoleEmbedding } from '../lib/embeddings';
import { normalizeProfileLocationFields, splitPreferredLocations } from '../lib/location-normalization';
import { getMatchHealthPercent } from '../lib/match-health';
import { buildDemoRolePayload, getCreatedAtTimestamp, getDemoRoleDisplayMatchCount, getLiveMatchActionLabel, getWatchListDisplayMatchCount } from '../lib/demo-role-utils';
import { buildScoreBreakdownDisplayItems, getDisplayJobDescription, getDisplayJobTitle, getSourceBadgeDisplayName, getSourceCategoryLabel } from '../lib/radar-match-ui';
import { normalizeRadarMatchResults } from '../lib/radar-results';
import { useAuth } from '../contexts/AuthContext';
import type { Profile, ResumeFile, ActivityLog, EducationEntry, ExperienceEntry } from '../types/database';

interface RadarMatchResult {
  id: string;
  profile_id: string;
  job_source: string;
  job_id: string;
  final_average_score: number;
  score_breakdown: Record<string, { score: number; candidate_value: string; job_value: string; rule: string } | number>;
  ai_notes: string;
  disqualified: boolean;
  disqualify_reason: string | null;
  created_at: string;
}

interface JobInfo {
  id: string;
  job_title: string | null;
  company_name: string | null;
  location: string | null;
  job_url: string | null;
  job_description?: string | null;
  post_content?: string | null;
  platform?: string | null;
  posted_at?: string | null;
  employment_type?: string | null;
  posted_by_name?: string | null;
  profile_link?: string | null;
  poster_email?: string | null;
}

type EditableMatchProfile = Profile & {
  work_authorization?: string | null;
  relocation_open?: boolean | null;
};

type SortField = 'score' | 'date' | 'profile';
type SortDir = 'asc' | 'desc';

type SourceTab = 'all' | 'new' | 'reviewed' | 'queued';

const JOB_BOARD_SOURCES = new Set(['linkedin', 'dice', 'indeed', 'monster', 'careerbuilder']);
const SOCIAL_GROUP_PLATFORMS = new Set(['facebook', 'linkedin']);
const CHAT_GROUP_PLATFORMS = new Set(['whatsapp']);
const LIVE_MATCH_COOLDOWN_KEY = 'radar_live_match_cooldowns';

const EMPTY_EXPERIENCE: ExperienceEntry = {
  company: '',
  title: '',
  location: '',
  start_date: '',
  end_date: '',
  current: false,
  description: '',
};

const EMPTY_EDUCATION: EducationEntry = {
  institution: '',
  degree: '',
  field: '',
  start_year: '',
  end_year: '',
  gpa: '',
};

type PipelineStep = 'idle' | 'matching' | 'done';

interface WatchSchedule {
  id: string;
  account_id: string;
  profile_id: string | null;
  external_job_post_id?: string | null;
  boards: string[];
  frequency: 'hourly' | 'daily' | 'twice_daily' | 'weekly';
  is_active: boolean;
  last_run_at: string | null;
  run_status: 'idle' | 'scraping' | 'matching' | 'completed' | 'error';
  created_at: string;
  updated_at: string;
}

interface HotlistRow { profile_id: string; created_at: string | null; }

interface DemoRoleRow {
  id: string;
  account_id: string;
  target_role: string;
  years_exp: number | null;
  min_years_exp: number | null;
  max_years_exp: number | null;
  visa_status: string | null;
  employment_type: string | null;
  work_type: string | null;
  preferred_locations: string | null;
  min_rate_usd_per_hr: number | null;
  max_rate_usd_per_hr: number | null;
  relocation_open: boolean | null;
  priority_skills: string | null;
  schedule_frequency: 'disabled' | 'hourly' | 'daily' | 'twice_daily' | 'weekly';
  is_active: boolean;
  last_run_at: string | null;
  last_result_summary: string | null;
  created_at: string;
  updated_at: string;
  match_count?: number;
}

interface DemoRoleMatchRow {
  id: string;
  profile_id: string;
  score: number;
  ai_notes: string | null;
  score_breakdown: Record<string, unknown> | null;
  created_at: string;
}

const DEFAULT_WATCH_BOARDS = ['linkedin', 'dice', 'indeed', 'monster'];
const HOTLIST_RETENTION_DAYS = 15;
const FREE_PLAN_MATCH_LIMIT = 5;
const FREE_PLAN_MATCH_TOTAL_LIMIT = 5;
const PAID_PLAN_MATCH_TOTAL_LIMIT = Number.MAX_SAFE_INTEGER;
const FREE_PLAN_MATCH_CANDIDATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const FREE_PLAN_LIVE_MATCH_TOTAL_LIMIT = 5;
const FREE_PLAN_LIVE_MATCH_CANDIDATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAID_PLAN_MATCH_CANDIDATE_WINDOW_MS = 60 * 60 * 1000;
const LIVE_MATCH_ATTEMPT_LOG_KEY = 'radar_live_match_attempts';
const LIVE_MATCH_TOTAL_WINDOW_MS = 24 * 60 * 60 * 1000;

export function shouldLockMatchCard({ isPaidPlan, streamRank, freePlanMatchLimit = FREE_PLAN_MATCH_LIMIT }: { isPaidPlan: boolean; streamRank: number; freePlanMatchLimit?: number }) {
  return !isPaidPlan && streamRank >= freePlanMatchLimit;
}

function isHotlistEligible(profile: Profile): boolean {
  const createdAt = profile.created_at ? new Date(profile.created_at) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return true;
  const ageDays = (Date.now() - createdAt.getTime()) / 86_400_000;
  return ageDays <= HOTLIST_RETENTION_DAYS;
}

function getScoreColor(score: number) {
  if (score >= 80) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
  if (score >= 60) return 'text-sky-600 bg-sky-50 border-sky-200';
  if (score >= 40) return 'text-amber-600 bg-amber-50 border-amber-200';
  return 'text-red-600 bg-red-50 border-red-200';
}

function getScoreBg(score: number) {
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-sky-500';
  if (score >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}

function getScoreTextClass(score: number) {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 60) return 'text-sky-600';
  if (score >= 40) return 'text-amber-600';
  return 'text-red-600';
}

function getSourceLogoPath(source: string, platform?: string | null): string | null {
  if (source === 'social') {
    const value = (platform ?? '').toLowerCase();
    if (value.includes('facebook')) return '/logos/facebook.png';
    if (value.includes('linkedin')) return '/logos/linkedin.png';
    if (value.includes('twitter') || value.includes('x')) return '/logos/x.png';
    if (value.includes('whatsapp')) return '/logos/whatsapp.png';
    return null;
  }

  const logoMap: Record<string, string> = {
    'linkedin': '/logos/linkedin.png',
    'dice': '/logos/dice.png',
    'indeed': '/logos/indeed.png',
    'monster': '/logos/monster.png',
    'careerbuilder': '/logos/careerbuilder.png',
  };

  return logoMap[source] ?? null;
}

function renderSourceBadgeIcon(source: string, platform?: string | null) {
  const logoPath = getSourceLogoPath(source, platform);
  if (!logoPath) return <Briefcase size={12} className="shrink-0 text-slate-600" />;

  return (
    <img
      src={logoPath}
      alt={getSourceBadgeDisplayName(source, platform)}
      className="shrink-0 h-3 w-3 object-contain"
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = 'none';
      }}
    />
  );
}

function formatScoreLabel(key: string) {
  const labelMap: Record<string, string> = {
    role_match: 'Role',
    name_match: 'Role',
    title_match: 'Role',
    job_title_match: 'Role',
    candidate_name_match: 'Role',
    skills_match: 'Skills',
    experience_match: 'Experience',
    visa_match: 'Visa',
    employment_type_match: 'Employment Type',
    work_type_match: 'Work Type',
    location_match: 'Location',
    rate_match: 'Rate',
  };

  if (labelMap[key]) return labelMap[key];

  return key
    .replace(/_/g, ' ')
    .replace(/\bmatch\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, c => c.toUpperCase());
}

function shouldClampScoreValue(key: string) {
  return /skill/i.test(key);
}

function normalizeMatchText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeMatchUrl(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch {
    return raw.split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase();
  }
}

function getMatchDedupeKey(result: RadarMatchResult, job: JobInfo | undefined): string {
  const titleKey = normalizeMatchText(job?.job_title);
  const companyKey = normalizeMatchText(job?.company_name);
  const locationKey = normalizeMatchText(job?.location);

  // Prefer the same visible identity users see on cards.
  // This collapses duplicate ingests from the same board even when URLs differ.
  if (titleKey || companyKey || locationKey) {
    return `${result.profile_id}|${result.job_source}|meta|${titleKey}|${companyKey}|${locationKey}`;
  }

  const urlKey = normalizeMatchUrl(job?.job_url);
  if (urlKey) {
    return `${result.profile_id}|${result.job_source}|url|${urlKey}`;
  }

  return `${result.profile_id}|${result.job_source}|fallback|${result.job_id}`;
}

function dedupeMatchResults(items: RadarMatchResult[], jobMap: Map<string, JobInfo>): RadarMatchResult[] {
  const byKey = new Map<string, RadarMatchResult>();

  for (const item of items) {
    const key = getMatchDedupeKey(item, jobMap.get(item.job_id));
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }

    const existingTime = new Date(existing.created_at).getTime();
    const currentTime = new Date(item.created_at).getTime();
    if (item.final_average_score > existing.final_average_score || (item.final_average_score === existing.final_average_score && currentTime > existingTime)) {
      byKey.set(key, item);
    }
  }

  return Array.from(byKey.values());
}

function normalizeScoreBreakdownPayload(raw: unknown): Record<string, { score: number; candidate_value: string; job_value: string; rule: string } | number> {
  if (!raw) return {};

  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }

  if (typeof value !== 'object' || value === null) return {};

  const canonicalizeKey = (input: string) => {
    const normalized = input.trim().toLowerCase().replace(/\s+/g, '_');
    const aliases: Record<string, string> = {
      role: 'role_match',
      title: 'role_match',
      name: 'role_match',
      skills: 'skills_match',
      experience: 'experience_match',
      visa: 'visa_match',
      employment_type: 'employment_type_match',
      work_type: 'work_type_match',
      location: 'location_match',
      rate: 'rate_match',
    };
    if (aliases[normalized]) return aliases[normalized];
    return normalized.endsWith('_match') ? normalized : `${normalized}_match`;
  };

  const normalized: Record<string, { score: number; candidate_value: string; job_value: string; rule: string } | number> = {};

  const addEntry = (rawKey: string, entry: unknown) => {
    const key = canonicalizeKey(rawKey);
    if (typeof entry === 'number') {
      normalized[key] = entry;
      return;
    }

    if (typeof entry === 'object' && entry !== null) {
      const detail = entry as Record<string, unknown>;
      const score = Number(detail.score ?? detail.value ?? detail.match_score ?? detail.percentage);
      normalized[key] = {
        score: Number.isFinite(score) ? score : 0,
        candidate_value: String(detail.candidate_value ?? detail.candidate ?? detail.profile_value ?? ''),
        job_value: String(detail.job_value ?? detail.job ?? detail.requirement ?? ''),
        rule: String(detail.rule ?? detail.reason ?? detail.explanation ?? ''),
      };
    }
  };

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const detail = item as Record<string, unknown>;
      const rawKey = String(detail.key ?? detail.rule_key ?? detail.name ?? detail.rule ?? '').trim();
      if (!rawKey) continue;
      addEntry(rawKey, detail);
    }
    return normalized;
  }

  const obj = value as Record<string, unknown>;
  const nestedCandidate = obj.score_breakdown ?? obj.breakdown ?? obj.rules ?? obj.items;
  if (nestedCandidate && nestedCandidate !== value) {
    return normalizeScoreBreakdownPayload(nestedCandidate);
  }

  for (const [key, entry] of Object.entries(obj)) {
    addEntry(key, entry);
  }

  return normalized;
}

function scoreBreakdownRuleCount(breakdown: RadarMatchResult['score_breakdown'] | undefined) {
  return Object.keys(breakdown ?? {}).length;
}

function mergeMatchRows(primary: RadarMatchResult, secondary: RadarMatchResult): RadarMatchResult {
  const primaryRules = scoreBreakdownRuleCount(primary.score_breakdown);
  const secondaryRules = scoreBreakdownRuleCount(secondary.score_breakdown);

  return {
    ...primary,
    final_average_score: primary.final_average_score || secondary.final_average_score,
    score_breakdown: secondaryRules > primaryRules ? secondary.score_breakdown : primary.score_breakdown,
    ai_notes: primary.ai_notes?.trim() ? primary.ai_notes : secondary.ai_notes,
  };
}

function ScoreBreakdownChart({ items, detailMap, compact = false, expandedKeys, onToggleExpand }: { items: Array<{ key: string; score: number }>; detailMap: Record<string, { candidate_value: string; job_value: string; rule: string } | undefined>; compact?: boolean; expandedKeys?: Set<string>; onToggleExpand?: (key: string) => void }) {
  if (!items.length) return null;

  const sortedItems = [...items].sort((a, b) => b.score - a.score);
  const gridClass = compact ? 'grid-cols-[0.6fr_0.8fr_1.8fr]' : 'grid-cols-[0.6fr_0.8fr_1.2fr_0.9fr]';
  const textClass = compact ? 'text-[10px]' : 'text-[11px]';
  const headerClass = compact ? 'px-2 py-1.5' : 'px-3 py-2';
  const rowClass = compact ? 'px-2 py-1.5' : 'px-3 py-2';

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <div className={`grid ${gridClass} gap-2 border-b border-slate-100 bg-slate-50 ${headerClass} text-[10px] font-semibold uppercase tracking-wide text-slate-500`}>
        <span>Score</span>
        <span>Rule</span>
        {!compact && <span>Candidate</span>}
        <span>Job</span>
      </div>
      <div className="divide-y divide-slate-100">
        {sortedItems.map((item) => {
          const detail = detailMap[item.key];
          const isSkillLike = shouldClampScoreValue(item.key);
          const isExpanded = expandedKeys?.has(item.key) ?? false;
          const canExpand = isSkillLike && Boolean(detail?.job_value);

          return (
            <div key={item.key} className={`grid ${gridClass} gap-2 ${rowClass} ${textClass} text-slate-700`}>
              <div className="flex items-center justify-start gap-2">
                <span className={`min-w-[1.8rem] text-left font-semibold ${getScoreTextClass(item.score)}`}>
                  {Math.round(item.score)}
                </span>
                <div className="h-1.5 flex-1 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${getScoreBg(item.score)}`}
                    style={{ width: `${Math.max(6, Math.min(100, Math.round(item.score)))}%` }}
                  />
                </div>
              </div>
              <div className="min-w-0">
                <div className="font-medium text-slate-800">{formatScoreLabel(item.key)}</div>
              </div>
              {!compact && (
                <div className="min-w-0 text-slate-600 break-words">{detail?.candidate_value || '—'}</div>
              )}
              <div className="min-w-0">
                <div className={`flex items-start justify-between gap-2 text-slate-600 break-words ${canExpand && !isExpanded ? 'line-clamp-2' : ''}`}>
                  <span className="flex-1">{detail?.job_value || '—'}</span>
                  {canExpand && (
                    <button
                      type="button"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); onToggleExpand?.(item.key); }}
                      className="mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-all hover:bg-slate-50 hover:text-slate-700"
                      aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
                    >
                      {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function RadarPage() {
  const { account, user, subscription, refreshAccount } = useAuth();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [hotlistRows, setHotlistRows] = useState<HotlistRow[]>([]);
  const [hotlistProfileIds, setHotlistProfileIds] = useState<Set<string>>(new Set());
  const [demoRoles, setDemoRoles] = useState<DemoRoleRow[]>([]);
  const [demoRoleMatches, setDemoRoleMatches] = useState<DemoRoleMatchRow[]>([]);
  const [sidebarTab, setSidebarTab] = useState<'hotlist' | 'all' | 'demo-roles'>('hotlist');
  const [candidateQuery, setCandidateQuery] = useState('');
  const [watchListQuery, setWatchListQuery] = useState('');
  const [results, setResults] = useState<RadarMatchResult[]>([]);
  const [jobMap, setJobMap] = useState<Map<string, JobInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [runningDemoRoleMatch, setRunningDemoRoleMatch] = useState(false);

  const [pipelineStep, setPipelineStep] = useState<PipelineStep>('idle');
  const [pipelineDetail, setPipelineDetail] = useState('');
  const [pipelineProgress, setPipelineProgress] = useState({ current: 0, total: 0 });
  const abortRef = useRef(false);
  const scanStateKey = 'radar_scan_state';

  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(searchParams.get('profileId'));
  const [selectedDemoRoleId, setSelectedDemoRoleId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedScoreKeys, setExpandedScoreKeys] = useState<Set<string>>(new Set());
  const [insightOpenById, setInsightOpenById] = useState<Record<string, boolean>>({});
  const [insightGeneratingId, setInsightGeneratingId] = useState<string | null>(null);
  const [reviewedMap, setReviewedMap] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem('radar_reviewed') ?? '{}');
    } catch { return {}; }
  });
  const hideDisqualified = false;
  const [sourceTab, setSourceTab] = useState<SourceTab>('all');
  const [jobSearchQuery, setJobSearchQuery] = useState('');
  const [previewResult, setPreviewResult] = useState<RadarMatchResult | null>(null);
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());
  const [savingJobId, setSavingJobId] = useState<string | null>(null);
  const [queuedJobIds, setQueuedJobIds] = useState<Set<string>>(new Set());
  const [queuingJobId, setQueuingJobId] = useState<string | null>(null);
  const [disqualifyingJobId, setDisqualifyingJobId] = useState<string | null>(null);
  const [liveMatchCooldowns, setLiveMatchCooldowns] = useState<Record<string, number>>({});
  const [liveMatchAttempts, setLiveMatchAttempts] = useState<Record<string, number[]>>({});
  const [serverLiveMatchRemaining, setServerLiveMatchRemaining] = useState<number | null>(null);
  const sortField: SortField = 'score';
  const sortDir: SortDir = 'desc';

  // Account-level watch settings
  const [globalWatch, setGlobalWatch] = useState<WatchSchedule | null>(null);
  const [savingWatch, setSavingWatch] = useState(false);
  const isPaidPlan = subscription?.status === 'active' && (subscription.plan_amount_usd ?? 0) > 0;
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedNewTier, setSelectedNewTier] = useState<number>(25);
  const [changingPlan, setChangingPlan] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const hasActiveSub = isPaidPlan;
  const pendingPeriodEnd = subscription?.current_period_end ?? null;

  function openUpgradeModal() {
    const idx = hasActiveSub ? TIERS.indexOf(subscription?.plan_amount_usd ?? 0) : -1;
    setSelectedNewTier(idx >= 0 && idx < TIERS.length - 1 ? TIERS[idx + 1] : 25);
    setShowPlanModal(true);
  }

  async function handleSubscribe() {
    setSubscribing(true);
    try {
      await loadRazorpay();
      const headers = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession());
      const { data, error } = await supabase.functions.invoke('razorpay-create-subscription', {
        body: { plan_amount_usd: selectedNewTier },
        headers,
      });
      if (error || !data?.subscription_id) {
        throw new Error(getBillingErrorMessage(error, 'Failed to create subscription'));
      }
      const rzp = new window.Razorpay({
        key: data.key_id,
        subscription_id: data.subscription_id,
        name: 'ProfilePush',
        description: `Pro Plan – ${fmtINR(selectedNewTier)}/month ($${selectedNewTier} AI credits)`,
        image: '/favicon.svg',
        handler: async () => {
          showToast('Subscription activated! Credits will be added shortly.', 'success');
          await refreshAccount();
          setShowPlanModal(false);
        },
        prefill: { name: user?.user_metadata?.full_name ?? '', email: user?.email ?? '' },
        theme: { color: '#2563eb' },
        modal: { ondismiss: () => setSubscribing(false) },
      });
      rzp.open();
    } catch (err) {
      const msg = getBillingErrorMessage(err, 'Failed to start subscription');
      showToast(msg, 'error');
      setSubscribing(false);
    }
  }

  async function handleChangePlan() {
    if (!subscription || selectedNewTier === subscription.plan_amount_usd) return;
    setChangingPlan(true);
    try {
      const isUpgrade = selectedNewTier > subscription.plan_amount_usd;
      const headers = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession());
      const { data, error } = await supabase.functions.invoke('razorpay-change-plan', {
        body: { new_plan_amount_usd: selectedNewTier },
        headers,
      });
      if (error || !data) {
        throw new Error(getBillingErrorMessage(error, 'Failed to change plan'));
      }
      if (isUpgrade && data.order_id) {
        await loadRazorpay();
        const rzp = new window.Razorpay({
          key: data.key_id, order_id: data.order_id, amount: data.amount_inr_paise, currency: 'INR',
          name: 'ProfilePush',
          description: `Upgrade ₹${data.old_plan_usd * INR_PER_USD} → ₹${data.new_plan_usd * INR_PER_USD}`,
          image: '/favicon.svg',
          handler: async () => {
            showToast(`Upgraded to ${fmtINR(selectedNewTier)}/mo! Extra credits added.`, 'success');
            await refreshAccount();
            setShowPlanModal(false);
          },
          prefill: { email: user?.email ?? '' },
          theme: { color: '#2563eb' },
        });
        rzp.open();
      } else {
        showToast(`Downgrade to ${fmtINR(selectedNewTier)}/mo scheduled for next renewal.`, 'success');
        await refreshAccount();
        setShowPlanModal(false);
      }
    } catch (err) {
      const msg = getBillingErrorMessage(err, 'Failed to change plan');
      showToast(msg, 'error');
      setChangingPlan(false);
    }
  }

  async function handlePlanSubmit() {
    if (hasActiveSub) {
      await handleChangePlan();
    } else {
      await handleSubscribe();
    }
  }

  // Candidate details tabs
  const [detailTab, setDetailTab] = useState<'profile' | 'docs' | 'activity'>('profile');
  const [profileDocs, setProfileDocs] = useState<ResumeFile[]>([]);
  const [profileActivity, setProfileActivity] = useState<ActivityLog[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [savingProfileFields, setSavingProfileFields] = useState(false);
  const [profileForm, setProfileForm] = useState({
    target_role: '',
    priority_skills: '',
    core_skills: '',
    years_experience: '',
    visa_status: '',
    work_authorization: '',
    work_type: '',
    preferred_locations: '',
    desired_salary_min: '',
    desired_salary_max: '',
    relocation_open: false,
  });
  const [profileExperience, setProfileExperience] = useState<ExperienceEntry[]>([]);
  const [profileEducation, setProfileEducation] = useState<EducationEntry[]>([]);
  const [prioritySkillInput, setPrioritySkillInput] = useState('');
  const [preferredLocationInput, setPreferredLocationInput] = useState('');
  const [matchPage, setMatchPage] = useState(1);

  // Boards to scrape

  useEffect(() => {
    if (account?.id) {
      loadData();
      loadHotlist();
      loadDemoRoles();
      loadGlobalWatchSchedule();
      // Recover from interrupted scan — results are already persisted by the edge function
      try {
        const saved = localStorage.getItem(scanStateKey);
        if (saved) {
          const state = JSON.parse(saved);
          if (state.running) {
            localStorage.removeItem(scanStateKey);
          }
        }
      } catch {}
    }
  }, [account?.id]);

  // Poll for watch status updates when running
  useEffect(() => {
    const hasRunning = globalWatch?.run_status === 'scraping' || globalWatch?.run_status === 'matching';
    if (!hasRunning || !account?.id) return;
    const interval = setInterval(() => {
      loadGlobalWatchSchedule();
    }, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalWatch?.run_status, account?.id]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LIVE_MATCH_COOLDOWN_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, number>;
      if (parsed && typeof parsed === 'object') setLiveMatchCooldowns(parsed);
    } catch {
      setLiveMatchCooldowns({});
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LIVE_MATCH_ATTEMPT_LOG_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, number[]>;
      if (parsed && typeof parsed === 'object') setLiveMatchAttempts(parsed);
    } catch {
      setLiveMatchAttempts({});
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadServerLiveMatchRemaining() {
      if (!account?.id || isPaidPlan) {
        setServerLiveMatchRemaining(null);
        return;
      }

      const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('api_usage_log')
        .select('created_at')
        .eq('account_id', account.id)
        .eq('function_name', 'radar-match')
        .gte('created_at', sinceIso);

      if (!ignore) {
        if (error) {
          setServerLiveMatchRemaining(null);
        } else {
          const count = (data ?? []).length;
          setServerLiveMatchRemaining(Math.max(0, FREE_PLAN_LIVE_MATCH_TOTAL_LIMIT - count));
        }
      }
    }

    loadServerLiveMatchRemaining();
    return () => {
      ignore = true;
    };
  }, [account?.id, isPaidPlan]);

  useEffect(() => {
    if (!selectedProfileId && profiles.length > 0 && sidebarTab !== 'demo-roles') {
      const urlProfileId = searchParams.get('profileId');
      const match = urlProfileId ? profiles.find(p => p.id === urlProfileId) : null;
      const mostRecent = [...profiles].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      const hotlistMostRecent = [...profiles]
        .filter(p => hotlistProfileIds.has(p.id))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      setSelectedProfileId(match ? match.id : hotlistMostRecent?.id ?? mostRecent?.id ?? profiles[0].id);
    }
  }, [profiles, selectedProfileId, searchParams, hotlistProfileIds, sidebarTab]);

  useEffect(() => {
    if (sidebarTab === 'demo-roles') {
      if (!selectedDemoRoleId && demoRoles.length > 0) {
        setSelectedDemoRoleId(demoRoles[0].id);
      }
      setSelectedProfileId(null);
    }
  }, [sidebarTab, demoRoles, selectedDemoRoleId]);

  useEffect(() => {
    if (selectedProfileId) {
      loadProfileDocs(selectedProfileId);
      loadProfileActivity(selectedProfileId);
      setMatchPage(1);
      setIsEditingProfile(false);
      setPreferredLocationInput('');
    } else {
      setProfileDocs([]);
      setProfileActivity([]);
      setIsEditingProfile(false);
      setPreferredLocationInput('');
    }
  }, [selectedProfileId]);

  useEffect(() => {
    if (selectedDemoRoleId && sidebarTab === 'demo-roles') {
      const selected = demoRoles.find(role => role.id === selectedDemoRoleId);
      if (!selected) {
        setProfileForm({
          target_role: '',
          priority_skills: '',
          core_skills: '',
          years_experience: '',
          visa_status: '',
          work_authorization: '',
          work_type: '',
          preferred_locations: '',
          desired_salary_min: '',
          desired_salary_max: '',
          relocation_open: false,
        });
        setProfileExperience([]);
        setProfileEducation([]);
        return;
      }

      setProfileForm({
        target_role: selected.target_role ?? '',
        priority_skills: selected.priority_skills ?? '',
        core_skills: '',
        years_experience: selected.min_years_exp != null ? String(selected.min_years_exp) : (selected.years_exp != null ? String(selected.years_exp) : ''),
        visa_status: selected.visa_status ?? '',
        work_authorization: selected.employment_type ?? '',
        work_type: selected.work_type ?? '',
        preferred_locations: selected.preferred_locations ?? '',
        desired_salary_min: selected.min_rate_usd_per_hr != null ? String(selected.min_rate_usd_per_hr) : '',
        desired_salary_max: selected.max_rate_usd_per_hr != null ? String(selected.max_rate_usd_per_hr) : '',
        relocation_open: Boolean(selected.relocation_open),
      });
      setProfileExperience([]);
      setProfileEducation([]);
      return;
    }

    const selected = profiles.find(p => p.id === selectedProfileId) as EditableMatchProfile | undefined;
    if (!selected) {
      setProfileForm({
        target_role: '',
        priority_skills: '',
        core_skills: '',
        years_experience: '',
        visa_status: '',
        work_authorization: '',
        work_type: '',
        preferred_locations: '',
        desired_salary_min: '',
        desired_salary_max: '',
        relocation_open: false,
      });
      setProfileExperience([]);
      setProfileEducation([]);
      return;
    }

    setProfileForm({
      target_role: selected.target_role ?? '',
      priority_skills: selected.priority_skills ?? '',
      core_skills: selected.core_skills ?? '',
      years_experience: selected.years_experience != null ? String(selected.years_experience) : '',
      visa_status: selected.visa_status ?? '',
      work_authorization: selected.work_authorization ?? '',
      work_type: selected.work_type ?? '',
      preferred_locations: selected.preferred_locations ?? '',
      desired_salary_min: selected.desired_salary_min != null ? String(selected.desired_salary_min) : '',
      desired_salary_max: selected.desired_salary_max != null ? String(selected.desired_salary_max) : '',
      relocation_open: Boolean(selected.relocation_open),
    });
    setProfileExperience(Array.isArray(selected.experience) ? selected.experience : []);
    setProfileEducation(Array.isArray(selected.education) ? selected.education : []);
  }, [selectedProfileId, profiles, selectedDemoRoleId, demoRoles, sidebarTab]);

  function updateProfileField(
    field: keyof typeof profileForm,
    value: string | boolean,
  ) {
    setProfileForm(prev => ({ ...prev, [field]: value }));
  }

  function updateExperienceField(index: number, field: keyof ExperienceEntry, value: string | boolean) {
    setProfileExperience(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function addPrioritySkill(skill: string) {
    const trimmed = skill.trim();
    if (!trimmed) return;
    const existing = profileForm.priority_skills
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
    if (existing.includes(trimmed)) return;
    const next = [...existing, trimmed];
    setProfileForm(prev => ({ ...prev, priority_skills: next.join(', ') }));
  }

  function removePrioritySkill(skillToRemove: string) {
    const next = profileForm.priority_skills
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .filter(skill => skill !== skillToRemove);
    setProfileForm(prev => ({ ...prev, priority_skills: next.join(', ') }));
  }

  function joinPreferredLocationItems(items: string[]) {
    return items.map(item => item.trim()).filter(Boolean).join(' | ');
  }

  function addPreferredLocation(value: string) {
    const next = value.trim();
    if (!next) return;
    const current = splitPreferredLocations(profileForm.preferred_locations);
    if (current.some(item => item.toLowerCase() === next.toLowerCase())) {
      setPreferredLocationInput('');
      return;
    }
    updateProfileField('preferred_locations', joinPreferredLocationItems([...current, next]));
    setPreferredLocationInput('');
  }

  function removePreferredLocation(value: string) {
    const next = splitPreferredLocations(profileForm.preferred_locations)
      .filter(item => item.toLowerCase() !== value.toLowerCase());
    updateProfileField('preferred_locations', joinPreferredLocationItems(next));
  }

  function updateEducationField(index: number, field: keyof EducationEntry, value: string) {
    setProfileEducation(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function addExperienceRow() {
    setProfileExperience(prev => [...prev, { ...EMPTY_EXPERIENCE }]);
  }

  function removeExperienceRow(index: number) {
    setProfileExperience(prev => prev.filter((_, i) => i !== index));
  }

  function addEducationRow() {
    setProfileEducation(prev => [...prev, { ...EMPTY_EDUCATION }]);
  }

  function removeEducationRow(index: number) {
    setProfileEducation(prev => prev.filter((_, i) => i !== index));
  }

  async function saveProfileForMatching(profileId: string) {
    setSavingProfileFields(true);
    const rawUpdatePayload = {
      target_role: profileForm.target_role.trim(),
      priority_skills: profileForm.priority_skills.trim(),
      core_skills: profileForm.core_skills.trim(),
      years_experience: profileForm.years_experience.trim() ? Number(profileForm.years_experience.trim()) : null,
      visa_status: profileForm.visa_status.trim(),
      work_authorization: profileForm.work_authorization.trim(),
      work_type: profileForm.work_type.trim(),
      preferred_locations: profileForm.preferred_locations.trim(),
      desired_salary_min: profileForm.desired_salary_min.trim() ? Number(profileForm.desired_salary_min.trim()) : null,
      desired_salary_max: profileForm.desired_salary_max.trim() ? Number(profileForm.desired_salary_max.trim()) : null,
      relocation_open: profileForm.relocation_open,
      experience: profileExperience,
      education: profileEducation,
    };
    const normalizedUpdatePayload = await normalizeProfileLocationFields(rawUpdatePayload);

    const { data, error } = await supabase
      .from('profiles')
      .update(normalizedUpdatePayload as unknown as Record<string, unknown>)
      .eq('id', profileId)
      .select('*')
      .single();

    if (error || !data) {
      showToast('Failed to update candidate details', 'error');
      setSavingProfileFields(false);
      return;
    }

    setProfiles(prev => prev.map(p => (p.id === profileId ? (data as Profile) : p)));
    triggerProfileEmbedding(profileId);
    setIsEditingProfile(false);
    showToast('Profile updated and match rules refreshed', 'success');
    setSavingProfileFields(false);
  }

  async function loadProfileDocs(profileId: string) {
    setDocsLoading(true);
    const { data } = await supabase
      .from('resume_files')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false });
    setProfileDocs(data ?? []);
    setDocsLoading(false);
  }

  async function loadProfileActivity(profileId: string) {
    setActivityLoading(true);
    const { data } = await supabase
      .from('activity_logs')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(50);
    setProfileActivity(data ?? []);
    setActivityLoading(false);
  }

  async function loadGlobalWatchSchedule() {
    if (!account?.id) return;
    const { data, error } = await supabase
      .from('watch_schedules')
      .select('*')
      .eq('account_id', account.id)
      .is('profile_id', null)
      .is('external_job_post_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      showToast('Failed to load watch settings', 'error');
      return;
    }

    if (data) {
      const normalizedFrequency = isPaidPlan
        ? data.frequency
        : 'daily';

      if (!isPaidPlan && data.frequency !== 'daily') {
        await supabase.from('watch_schedules').update({ frequency: 'daily' }).eq('id', data.id);
      }

      setGlobalWatch({ ...data, frequency: normalizedFrequency });
      return;
    }

    const { data: created, error: createError } = await supabase
      .from('watch_schedules')
      .insert({
        account_id: account.id,
        profile_id: null,
        boards: DEFAULT_WATCH_BOARDS,
        frequency: 'daily',
        is_active: true,
      })
      .select('*')
      .single();

    if (createError) {
      showToast('Failed to initialize watch settings', 'error');
      return;
    }

    if (created) setGlobalWatch(created as WatchSchedule);
  }

  async function updateGlobalWatch(patch: Partial<WatchSchedule>) {
    if (!globalWatch?.id) return;
    setSavingWatch(true);
    const { data, error } = await supabase
      .from('watch_schedules')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', globalWatch.id)
      .select('*')
      .single();
    setSavingWatch(false);

    if (error) {
      showToast('Failed to update watch settings', 'error');
      return;
    }
    if (data) setGlobalWatch(data as WatchSchedule);
  }

  async function loadHotlist() {
    if (!account?.id) {
      setHotlistRows([]);
      setHotlistProfileIds(new Set());
      return;
    }

    const { data } = await supabase.from('hotlist').select('profile_id, created_at').eq('account_id', account.id).order('created_at', { ascending: false });
    const rows = (data ?? []) as HotlistRow[];
    setHotlistRows(rows);

    const profileIds = rows.map((row) => row.profile_id).filter(Boolean);
    const nextIds = new Set<string>();

    if (profileIds.length > 0) {
      const { data: profileRows } = await supabase.from('profiles').select('id, created_at').in('id', profileIds);
      const profileMap = new Map((profileRows ?? []).map((profile) => [profile.id, profile]));
      for (const row of rows) {
        const profile = profileMap.get(row.profile_id);
        if (profile && isHotlistEligible(profile as Profile)) nextIds.add(row.profile_id);
      }
    }

    setHotlistProfileIds(nextIds);
  }

  async function loadDemoRoles() {
    try {
      const headers = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession());
      const { data, error } = await supabase.functions.invoke('watch-list-roles', {
        headers,
      });

      if (error) {
        throw error;
      }

      const roles = ((data?.roles ?? []) as DemoRoleRow[]).map((role) => ({
        ...role,
        match_count: getWatchListDisplayMatchCount(role.match_count ?? 0, role.match_count ?? 0),
      }));

      setDemoRoles(roles);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to load watch list roles', 'error');
      setDemoRoles([]);
      setDemoRoleMatches([]);
    }
  }

  async function loadDemoRoleMatches(roleId: string) {
    if (!roleId) {
      setDemoRoleMatches([]);
      return;
    }

    try {
      const headers = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession());
      const { data, error } = await supabase.functions.invoke('watch-list-roles', {
        body: { role_id: roleId },
        headers,
      });

      if (error) {
        throw error;
      }

      const matches = ((data?.matches ?? []) as DemoRoleMatchRow[]).map((match) => ({
        ...match,
        score_breakdown: match.score_breakdown ?? {},
      }));

      setDemoRoleMatches(matches);
    } catch (error) {
      console.error('Failed to load watch-list matches:', error);
      setDemoRoleMatches([]);
    }
  }

  async function saveDemoRoleForMatching(roleId: string) {
    if (!account?.id) return;
    setSavingProfileFields(true);
    try {
      const payload = buildDemoRolePayload(account.id, {
        target_role: profileForm.target_role,
        years_experience: profileForm.years_experience,
        visa_status: profileForm.visa_status,
        work_authorization: profileForm.work_authorization,
        work_type: profileForm.work_type,
        preferred_locations: profileForm.preferred_locations,
        desired_salary_min: profileForm.desired_salary_min,
        desired_salary_max: profileForm.desired_salary_max,
        relocation_open: profileForm.relocation_open,
        priority_skills: profileForm.priority_skills,
      });

      const { data, error } = await supabase
        .from('hotlist_ai_roles')
        .update(payload as unknown as Record<string, unknown>)
        .eq('id', roleId)
        .select('*')
        .single();

      if (error || !data) throw error ?? new Error('Failed to save demo role');

      setDemoRoles(prev => prev.map(role => (role.id === roleId ? (data as DemoRoleRow) : role)));
      void triggerRoleEmbedding(roleId);
      setIsEditingProfile(false);
      showToast('Demo role updated and ready to match', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to update demo role', 'error');
    } finally {
      setSavingProfileFields(false);
    }
  }

  async function runDemoRoleMatch(roleId: string) {
    if (!account?.id || !user?.id) return;
    setScanning(true);
    setPipelineStep('matching');
    setPipelineDetail('Generating watch-list matches...');
    setPipelineProgress({ current: 0, total: 0 });
    setRunningDemoRoleMatch(true);
    try {
      const headers = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession());
      const { data, error } = await supabase.functions.invoke('hotlist-ai-match', {
        body: { role_id: roleId, account_id: account.id },
        headers,
      });
      if (error) {
        const message = error.message || 'Role match failed';
        throw new Error(message.includes('Failed to send a request to the Edge Function')
          ? 'The matching service is currently unavailable. The edge function may not be deployed for this project yet.'
          : message);
      }
      await loadDemoRoles();
      await loadDemoRoleMatches(roleId);
      showToast(data?.summary || 'Live Match completed.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Role match failed', 'error');
    } finally {
      setRunningDemoRoleMatch(false);
      setScanning(false);
      setPipelineStep('done');
      setPipelineDetail('');
      setPipelineProgress({ current: 0, total: 0 });
    }
  }

  async function loadResultsOnly() {
    const { data } = await supabase
      .from('radar_match_results')
      .select('*')
      .order('created_at', { ascending: false });

    const combined = normalizeRadarMatchResults((data ?? []) as Array<Record<string, unknown>>) as RadarMatchResult[];
    setResults(combined);
    await loadJobDetails(combined);
  }

  async function loadData() {
    setLoading(true);
    try {
      const [profilesRes, radarRes] = await Promise.all([
        supabase.from('profiles').select('*').order('candidate_name'),
        supabase.from('radar_match_results').select('*').order('created_at', { ascending: false }),
      ]);

      if (profilesRes.data) setProfiles(profilesRes.data);

      const combined = normalizeRadarMatchResults((radarRes.data ?? []) as Array<Record<string, unknown>>) as RadarMatchResult[];
      setResults(combined);
      await loadJobDetails(combined);
    } catch {
      showToast('Failed to load radar data', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadJobDetails(matches: RadarMatchResult[]) {
    const linkedinIds = matches.filter(m => m.job_source === 'linkedin').map(m => m.job_id);
    const diceIds = matches.filter(m => m.job_source === 'dice').map(m => m.job_id);
    const indeedIds = matches.filter(m => m.job_source === 'indeed').map(m => m.job_id);
    const monsterIds = matches.filter(m => m.job_source === 'monster').map(m => m.job_id);
    const careerbuilderIds = matches.filter(m => m.job_source === 'careerbuilder').map(m => m.job_id);
    const externalIds = matches.filter(m => m.job_source === 'external').map(m => m.job_id);
    const socialIds = matches.filter(m => m.job_source === 'social').map(m => m.job_id);

    const map = new Map<string, JobInfo>();

    if (linkedinIds.length) {
      const { data } = await supabase
        .from('linkedin_jobs')
        .select('id, job_title, company_name, location, job_url, job_description, employment_type, created_at')
        .in('id', linkedinIds);
      data?.forEach(j => map.set(j.id, {
        id: j.id,
        job_title: j.job_title ?? null,
        company_name: j.company_name ?? null,
        location: j.location ?? null,
        job_url: j.job_url ?? null,
        job_description: j.job_description ?? null,
        employment_type: j.employment_type ?? null,
        posted_at: j.created_at ?? null,
      }));
    }
    if (diceIds.length) {
      const { data } = await supabase
        .from('dice_jobs')
        .select('id, job_title, company_name, location, job_url, job_description, employment_type, created_at')
        .in('id', diceIds);
      data?.forEach(j => map.set(j.id, {
        id: j.id,
        job_title: j.job_title ?? null,
        company_name: j.company_name ?? null,
        location: j.location ?? null,
        job_url: j.job_url ?? null,
        job_description: j.job_description ?? null,
        employment_type: j.employment_type ?? null,
        posted_at: j.created_at ?? null,
      }));
    }
    if (indeedIds.length) {
      const { data } = await supabase
        .from('indeed_jobs')
        .select('id, job_title, company_name, location_display, job_url, job_description, employment_type, created_at')
        .in('id', indeedIds);
      data?.forEach(j => map.set(j.id, {
        id: j.id,
        job_title: j.job_title ?? null,
        company_name: j.company_name ?? null,
        location: j.location_display ?? null,
        job_url: j.job_url ?? null,
        job_description: j.job_description ?? null,
        employment_type: j.employment_type ?? null,
        posted_at: j.created_at ?? null,
      }));
    }
    if (monsterIds.length) {
      const { data } = await supabase
        .from('monster_jobs')
        .select('id, job_title, company_name, location_display, apply_url, job_description, employment_type, created_at')
        .in('id', monsterIds);
      data?.forEach(j => map.set(j.id, {
        id: j.id,
        job_title: j.job_title ?? null,
        company_name: j.company_name ?? null,
        location: j.location_display ?? null,
        job_url: j.apply_url ?? null,
        job_description: j.job_description ?? null,
        employment_type: j.employment_type ?? null,
        posted_at: j.created_at ?? null,
      }));
    }
    if (careerbuilderIds.length) {
      const { data } = await supabase
        .from('careerbuilder_jobs')
        .select('id, job_title, company_name, location_display, job_url, job_description, employment_type, created_at')
        .in('id', careerbuilderIds);
      data?.forEach(j => map.set(j.id, {
        id: j.id,
        job_title: j.job_title ?? null,
        company_name: j.company_name ?? null,
        location: j.location_display ?? null,
        job_url: j.job_url ?? null,
        job_description: j.job_description ?? null,
        employment_type: j.employment_type ?? null,
        posted_at: j.created_at ?? null,
      }));
    }
    if (externalIds.length) {
      const { data } = await supabase
        .from('external_job_posts')
        .select('id, title, company, location, raw_description, employment_type, created_at')
        .in('id', externalIds);
      data?.forEach(j => map.set(j.id, {
        id: j.id,
        job_title: j.title ?? null,
        company_name: j.company ?? null,
        location: j.location ?? null,
        job_url: null,
        job_description: j.raw_description ?? null,
        employment_type: j.employment_type ?? null,
        posted_at: j.created_at ?? null,
      }));
    }
    if (socialIds.length) {
      const { data } = await supabase
        .from('social_jobs')
        .select('id, job_title, company_name, location, post_url, job_description, platform, post_content, employment_type, created_at, posted_at, posted_by_name, profile_link, poster_email')
        .in('id', socialIds);
      data?.forEach(j => map.set(j.id, {
        id: j.id,
        job_title: j.job_title ?? null,
        company_name: j.company_name ?? null,
        location: j.location ?? null,
        job_url: j.post_url ?? null,
        job_description: j.job_description ?? null,
        platform: j.platform ?? null,
        post_content: j.post_content ?? null,
        employment_type: j.employment_type ?? null,
        posted_at: j.posted_at ?? j.created_at ?? null,
        posted_by_name: j.posted_by_name ?? null,
        profile_link: j.profile_link ?? null,
        poster_email: j.poster_email ?? null,
      }));
    }

    setJobMap(map);
  }

  function handleExpand(resultId: string, isCurrentlyExpanded: boolean) {
    if (isCurrentlyExpanded) {
      setExpandedId(null);
    } else {
      setExpandedId(resultId);
      const updated = { ...reviewedMap, [resultId]: Date.now() };
      setReviewedMap(updated);
      try { localStorage.setItem('radar_reviewed', JSON.stringify(updated)); } catch {}
    }
  }

  async function generateInsight(result: RadarMatchResult) {
    if (insightGeneratingId === result.id) return;

    setInsightGeneratingId(result.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supportedJobSourceMap: Record<string, Record<string, string | number | null>> = {
        linkedin: { linkedin_job_id: result.job_id },
        dice: { dice_job_id: result.job_id },
        indeed: { indeed_job_id: result.job_id },
        monster: { monster_job_id: result.job_id },
        careerbuilder: { careerbuilder_job_id: result.job_id },
      };

      const jobSourcePayload = supportedJobSourceMap[result.job_source];
      if (!jobSourcePayload) {
        showToast('AI insight is only available for standard job board matches', 'error');
        return;
      }

      const payload: Record<string, string | number | null> = {
        profile_id: result.profile_id,
        account_id: account?.id ?? null,
        ...jobSourcePayload,
      };

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/score-job-match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Unable to generate AI insight');

      const nextInsight = typeof data.summary === 'string' ? data.summary.trim() : '';
      if (!nextInsight) throw new Error('No insight returned');

      setResults(prev => prev.map(item => item.id === result.id ? { ...item, ai_notes: nextInsight } : item));
      setInsightOpenById(prev => ({ ...prev, [result.id]: true }));

      try {
        const radarUpdate = await supabase
          .from('radar_match_results')
          .update({ ai_notes: nextInsight })
          .eq('profile_id', result.profile_id)
          .eq('job_id', result.job_id)
          .eq('job_source', result.job_source);

        if (radarUpdate.error && radarUpdate.error.code !== 'PGRST116') {
          console.error('Failed to persist insight to radar_match_results', radarUpdate.error);
        }

        if (!radarUpdate.data || radarUpdate.data.length === 0) {
          await supabase.from('radar_match_results').insert({
            profile_id: result.profile_id,
            job_source: result.job_source,
            job_id: result.job_id,
            final_average_score: result.final_average_score,
            score_breakdown: result.score_breakdown,
            ai_notes: nextInsight,
            disqualified: result.disqualified,
            disqualify_reason: result.disqualify_reason,
          });
        }

        const jobScoreColumn = result.job_source === 'linkedin'
          ? 'linkedin_job_id'
          : result.job_source === 'dice'
            ? 'dice_job_id'
            : result.job_source === 'indeed'
              ? 'indeed_job_id'
              : result.job_source === 'monster'
                ? 'monster_job_id'
                : result.job_source === 'careerbuilder'
                  ? 'careerbuilder_job_id'
                  : result.job_source === 'external'
                    ? 'external_job_post_id'
                    : result.job_source === 'social'
                      ? 'social_job_id'
                      : null;

        if (jobScoreColumn) {
          const scoreUpdate = await supabase
            .from('job_match_scores')
            .update({ summary: nextInsight })
            .eq('profile_id', result.profile_id)
            .eq(jobScoreColumn, result.job_id);

          if (scoreUpdate.error && scoreUpdate.error.code !== 'PGRST116') {
            console.error('Failed to persist insight to job_match_scores', scoreUpdate.error);
          }
        }
      } catch (persistErr) {
        console.error('Failed to persist AI insight', persistErr);
      }

      showToast('AI insight generated', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to generate AI insight', 'error');
    } finally {
      setInsightGeneratingId(null);
    }
  }

  function formatTimeAgo(ts: number): string {
    const diff = nowTick - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function formatCooldown(ms: number): string {
    if (ms <= 0) return '0m';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.ceil((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours <= 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
  }

  function getLiveMatchAccountScopeKey(): string {
    return `account:${account?.id ?? 'anonymous'}`;
  }

  function getLiveMatchProfileScopeKey(profileId: string): string {
    return `profile:${profileId}`;
  }

  function getRecentLiveMatchCount(scopeKey: string, windowMs: number): number {
    const now = Date.now();
    const timestamps = liveMatchAttempts[scopeKey] ?? [];
    return timestamps.filter(ts => now - ts < windowMs).length;
  }

  function getLiveMatchAccountCount(): number {
    return getRecentLiveMatchCount(getLiveMatchAccountScopeKey(), LIVE_MATCH_TOTAL_WINDOW_MS);
  }

  function getLiveMatchCandidateCooldownRemainingMs(profileId: string): number {
    const now = Date.now();
    const scopeKey = getLiveMatchProfileScopeKey(profileId);
    const windowMs = isPaidPlan ? PAID_PLAN_LIVE_MATCH_CANDIDATE_WINDOW_MS : FREE_PLAN_LIVE_MATCH_CANDIDATE_WINDOW_MS;
    const timestamps = (liveMatchAttempts[scopeKey] ?? [])
      .filter(ts => now - ts < windowMs)
      .sort((a, b) => a - b);
    if (timestamps.length === 0) return 0;
    return Math.max(0, timestamps[0] + windowMs - now);
  }

  function recordLiveMatchAttempt(profileId: string) {
    const now = Date.now();
    const accountScopeKey = getLiveMatchAccountScopeKey();
    const profileScopeKey = getLiveMatchProfileScopeKey(profileId);

    setLiveMatchAttempts(prev => {
      const prune = (timestamps: number[]) => timestamps.filter(ts => now - ts < LIVE_MATCH_TOTAL_WINDOW_MS);
      const next = {
        ...prev,
        [accountScopeKey]: [...prune(prev[accountScopeKey] ?? []), now],
        [profileScopeKey]: [...prune(prev[profileScopeKey] ?? []), now],
      };

      try {
        localStorage.setItem(LIVE_MATCH_ATTEMPT_LOG_KEY, JSON.stringify(next));
      } catch {
        // no-op if storage is unavailable
      }

      return next;
    });
  }

  const cooldownRemainingMs = selectedProfileId
    ? getLiveMatchCandidateCooldownRemainingMs(selectedProfileId)
    : 0;
  const liveMatchAccountCount = getLiveMatchAccountCount();
  const liveMatchRemaining = serverLiveMatchRemaining === null
    ? Math.max(0, FREE_PLAN_LIVE_MATCH_TOTAL_LIMIT - liveMatchAccountCount)
    : Math.max(0, serverLiveMatchRemaining);
  const isLiveMatchCooldownActive = !isPaidPlan
    ? liveMatchAccountCount >= FREE_PLAN_LIVE_MATCH_TOTAL_LIMIT || cooldownRemainingMs > 0
    : cooldownRemainingMs > 0;
  const selectedMatchCooldownStatus = cooldownRemainingMs > 0
    ? `Next refresh available in ${formatCooldown(cooldownRemainingMs)}`
    : null;

  function stampLiveMatchCooldown(profileId: string) {
    const next = { ...liveMatchCooldowns, [profileId]: Date.now() };
    setLiveMatchCooldowns(next);
    try {
      localStorage.setItem(LIVE_MATCH_COOLDOWN_KEY, JSON.stringify(next));
    } catch {
      // no-op if storage is unavailable
    }
  }

  async function runRadarScan() {
    if (!account?.id) return;
    if (!selectedProfileId) {
      showToast('Select a candidate to run Live Match', 'error');
      return;
    }
    const candidateCooldownRemainingMs = getLiveMatchCandidateCooldownRemainingMs(selectedProfileId);
    const accountAttemptCount = getLiveMatchAccountCount();

    if (!isPaidPlan && accountAttemptCount >= FREE_PLAN_LIVE_MATCH_TOTAL_LIMIT) {
      showToast('You have used all 5 live matches in the last 24 hours.', 'error');
      return;
    }

    if (candidateCooldownRemainingMs > 0) {
      showToast(
        isPaidPlan
          ? 'You can refresh this candidate once every hour.'
          : 'You can only try this candidate once every 24 hours.',
        'error',
      );
      return;
    }

    abortRef.current = false;
    setScanning(true);
    localStorage.setItem(scanStateKey, JSON.stringify({ running: true, startedAt: Date.now() }));

    const targetProfiles = profiles.filter(p => p.id === selectedProfileId);

    if (targetProfiles.length === 0) {
      showToast('No active profiles to scan', 'error');
      setScanning(false);
      localStorage.removeItem(scanStateKey);
      return;
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token ?? supabaseKey;

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'Apikey': supabaseKey,
    };

    // ── Match against existing jobs (streamed in batches) ────────────────────
    setPipelineStep('matching');
    setPipelineDetail('Analyzing jobs...');
    setPipelineProgress({ current: 0, total: 0 });

    let totalNewMatches = 0;

    for (let i = 0; i < targetProfiles.length; i++) {
      if (abortRef.current) break;
      const profile = targetProfiles[i];
      setPipelineDetail(`Matching ${profile.candidate_name} against jobs...`);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 145000);
        const response = await fetch(
          `${supabaseUrl}/functions/v1/radar-match`,
          {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify({ profile_id: profile.id, account_id: account.id }),
          }
        );
        clearTimeout(timeoutId);

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          console.error(`Radar match failed for ${profile.candidate_name}:`, errData);
          if (response.status === 402) {
            showToast(errData.error || 'Insufficient credits. Please top up your account.', 'error');
          } else if (response.status === 429) {
            showToast(errData.error || 'Live Match quota reached. Please try again later.', 'error');
            cleanup();
            return;
          }
          const message = errData?.error || errData?.message || `Live Match failed (${response.status}). Please try again.`;
          showToast(message, 'error');
          cleanup();
          return;
        }

        recordLiveMatchAttempt(selectedProfileId);
        stampLiveMatchCooldown(selectedProfileId);

        const contentType = response.headers.get('content-type') ?? '';

        if (contentType.includes('text/plain')) {
          // Streaming response — read line by line
          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const msg = JSON.parse(line);
                if (msg.type === 'batch') {
                  totalNewMatches += (msg.matched ?? 0);
                  setPipelineProgress({ current: msg.progress ?? 0, total: msg.total_jobs ?? 0 });
                  setPipelineDetail(`Matching ${profile.candidate_name} — ${msg.total_so_far} match${msg.total_so_far === 1 ? '' : 'es'} so far...`);
                  if (msg.matched > 0) {
                    await loadResultsOnly();
                  }
                } else if (msg.type === 'error') {
                  showToast(msg.error || 'Live Match failed. Please try again.', 'error');
                  cleanup();
                  return;
                } else if (msg.type === 'done') {
                  // final message for this profile
                }
              } catch {
                if (line.includes('Request idle timeout limit')) {
                  showToast('Live Match timed out while waiting for updates. Please try again.', 'error');
                  cleanup();
                  return;
                }
              }
            }
          }
        } else {
          // Non-streaming fallback (e.g. "No jobs found" JSON responses)
          const matchData = await response.json();
          if (matchData?.error) {
            showToast(matchData.error, 'error');
            cleanup();
            return;
          }
          totalNewMatches += (matchData.matched ?? 0);
          if (matchData.matched > 0) {
            await loadResultsOnly();
          }
        }
      } catch (err) {
        const isTimeout = err instanceof DOMException && err.name === 'AbortError';
        if (isTimeout) {
          showToast('Live Match timed out while starting. Please retry.', 'error');
        } else {
          showToast(`Live Match failed for ${profile.candidate_name}. Please retry.`, 'error');
        }
        console.error(`Radar match error for ${profile.candidate_name}:`, err);
        cleanup();
        return;
      }
    }

    if (abortRef.current) { cleanup(); return; }

    await refreshAccount();

    if (totalNewMatches > 0) {
      setPipelineStep('done');
      setPipelineDetail('');
      showToast(`Found ${totalNewMatches} match${totalNewMatches === 1 ? '' : 'es'} from recent jobs`, 'success');
      await loadResultsOnly();
    } else {
      setPipelineStep('done');
      setPipelineDetail('');
      showToast('No matches found right now. Job Watch will keep checking hotlist candidates automatically.', 'success');
    }
    cleanup();
  }

  function cleanup() {
    setScanning(false);
    setPipelineStep('idle');
    setPipelineDetail('');
    setPipelineProgress({ current: 0, total: 0 });
    localStorage.removeItem(scanStateKey);
  }

  function abortScan() {
    abortRef.current = true;
    showToast('Aborting scan...', 'error');
  }

  function getJobInfoForResult(result: RadarMatchResult): JobInfo | undefined {
    const existing = jobMap.get(result.job_id);
    if (existing) return existing;
    if (result.job_source !== 'watch-list') return undefined;

    const match = demoRoleMatches.find(item => item.id === result.job_id || item.id === result.id);
    if (!match) return undefined;

    const profile = profiles.find(item => item.id === match.profile_id);
    const selectedDemoRole = demoRoles.find(role => role.id === selectedDemoRoleId) ?? null;
    const roleDescription = selectedDemoRole
      ? [
          `Target Role: ${selectedDemoRole.target_role || 'Not specified'}`,
          (selectedDemoRole.min_years_exp != null && selectedDemoRole.max_years_exp != null)
            ? `Years Experience: ${selectedDemoRole.min_years_exp}-${selectedDemoRole.max_years_exp}`
            : (selectedDemoRole.years_exp != null ? `Years Experience: ${selectedDemoRole.years_exp}` : null),
          selectedDemoRole.visa_status ? `Visa Status: ${selectedDemoRole.visa_status}` : null,
          selectedDemoRole.employment_type ? `Employment Type: ${selectedDemoRole.employment_type}` : null,
          selectedDemoRole.work_type ? `Work Type: ${selectedDemoRole.work_type}` : null,
          selectedDemoRole.preferred_locations ? `Preferred Locations: ${selectedDemoRole.preferred_locations}` : null,
          selectedDemoRole.min_rate_usd_per_hr != null ? `Min Rate ($/hr): ${selectedDemoRole.min_rate_usd_per_hr}` : null,
          selectedDemoRole.max_rate_usd_per_hr != null ? `Max Rate ($/hr): ${selectedDemoRole.max_rate_usd_per_hr}` : null,
          selectedDemoRole.relocation_open != null ? `Relocation Open: ${selectedDemoRole.relocation_open ? 'Yes' : 'No'}` : null,
          selectedDemoRole.priority_skills ? `Priority Skills: ${selectedDemoRole.priority_skills}` : null,
        ].filter(Boolean).join('\n')
      : '';

    return {
      id: result.job_id,
      job_title: selectedDemoRole?.target_role ?? 'Role Match',
      company_name: profile?.candidate_name ?? 'Candidate',
      location: profile?.preferred_locations ?? null,
      job_url: null,
      job_description: roleDescription || match.ai_notes || null,
      post_content: match.ai_notes ?? (roleDescription || null),
      platform: 'watch-list' as const,
      posted_at: match.created_at,
      employment_type: profile?.work_authorization ?? null,
      work_type: profile?.work_type ?? null,
    };
  }

  async function addToSubmissionQueue(result: RadarMatchResult) {
    const job = getJobInfoForResult(result);
    if (!job || !result.profile_id) return;
    setSavingJobId(result.job_id);
    const boardMap: Record<string, string> = { linkedin: 'LinkedIn', dice: 'Dice', indeed: 'Indeed', monster: 'Monster', careerbuilder: 'CareerBuilder', external: 'External' };
    const { error } = await supabase.from('wishlisted_jobs').insert({
      profile_id: result.profile_id,
      job_title: job.job_title ?? 'Untitled',
      company: job.company_name ?? 'Unknown',
      board: boardMap[result.job_source] ?? result.job_source,
      location: job.location ?? '',
      job_url: job.job_url ?? null,
      source_job_id: result.job_id,
      status: 'New',
    });
    if (error) {
      showToast('Failed to add to submission queue', 'error');
    } else {
      setSavedJobIds(prev => new Set([...prev, result.job_id]));
      showToast(`Added "${job.job_title}" to submission queue`);
    }
    setSavingJobId(null);
  }

  async function addToResumeAIQueue(result: RadarMatchResult) {
    const job = getJobInfoForResult(result);
    if (!job || !result.profile_id) return;
    setQueuingJobId(result.job_id);
    try {
      const { data: existing } = await supabase
        .from('wishlisted_jobs')
        .select('id, resume_ai_queued')
        .eq('profile_id', result.profile_id)
        .eq('source_job_id', result.job_id)
        .maybeSingle();

      if (existing) {
        if (!existing.resume_ai_queued) {
          await supabase.from('wishlisted_jobs').update({ resume_ai_queued: true }).eq('id', existing.id);
        }
      } else {
        const boardMap: Record<string, string> = { linkedin: 'LinkedIn', dice: 'Dice', indeed: 'Indeed', monster: 'Monster', careerbuilder: 'CareerBuilder', external: 'External' };
        await supabase.from('wishlisted_jobs').insert({
          profile_id: result.profile_id,
          job_title: job.job_title ?? 'Untitled',
          company: job.company_name ?? 'Unknown',
          board: boardMap[result.job_source] ?? result.job_source,
          location: job.location ?? '',
          job_url: job.job_url ?? null,
          source_job_id: result.job_id,
          status: 'New',
          resume_ai_queued: true,
        });
      }
      setQueuedJobIds(prev => new Set([...prev, result.job_id]));
      showToast(`Added to Resume AI Queue`);
    } catch {
      showToast('Failed to add to Resume AI Queue', 'error');
    }
    setQueuingJobId(null);
  }

  async function disqualifyResult(result: RadarMatchResult) {
    setDisqualifyingJobId(result.job_id);
    // Update in radar_match_results if it exists there
    const { error: radarErr } = await supabase
      .from('radar_match_results')
      .update({ disqualified: true, disqualify_reason: 'Manually disqualified by user' })
      .eq('profile_id', result.profile_id)
      .eq('job_id', result.job_id);

    // Also update local state regardless (may be from job_match_scores)
    if (!radarErr || radarErr.code === 'PGRST116') {
      setResults(prev => prev.map(r =>
        r.profile_id === result.profile_id && r.job_id === result.job_id
          ? { ...r, disqualified: true, disqualify_reason: 'Manually disqualified by user' }
          : r
      ));
      showToast('Job moved to disqualified');
    } else {
      showToast('Failed to disqualify', 'error');
    }
    setDisqualifyingJobId(null);
  }

  const allQualifiedResults = dedupeMatchResults(
    results.filter(r => !hideDisqualified || !r.disqualified),
    jobMap,
  );

  const matchCountByProfile = new Map<string, number>();
  for (const row of allQualifiedResults) {
    matchCountByProfile.set(row.profile_id, (matchCountByProfile.get(row.profile_id) ?? 0) + 1);
  }

  const profileResults = allQualifiedResults
    .filter(r => !selectedProfileId || r.profile_id === selectedProfileId);

  const demoRoleTabCounts = {
    all: demoRoleMatches.length,
    new: demoRoleMatches.length,
    reviewed: 0,
    queued: 0,
  };

  const profileTabCounts = {
    all: profileResults.length,
    new: profileResults.filter(r => !reviewedMap[r.id] && !queuedJobIds.has(r.job_id) && !savedJobIds.has(r.job_id)).length,
    reviewed: profileResults.filter(r => Boolean(reviewedMap[r.id])).length,
    queued: profileResults.filter(r => queuedJobIds.has(r.job_id) || savedJobIds.has(r.job_id)).length,
  };

  const activeTabCounts = sidebarTab === 'demo-roles' ? demoRoleTabCounts : profileTabCounts;

  const profileResultsNewestFirst = [...profileResults].sort((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    return tb - ta;
  });

  const unlockedResultIds = new Set(
    (isPaidPlan
      ? profileResultsNewestFirst
      : profileResultsNewestFirst.slice(0, FREE_PLAN_MATCH_LIMIT)
    ).map(r => r.id),
  );

  const progressPercent = pipelineProgress.total > 0
    ? Math.max(0, Math.min(100, Math.round((pipelineProgress.current / pipelineProgress.total) * 100)))
    : (scanning ? 12 : 0);

  const getSourceCategory = (r: { job_source: string; job_id: string }): SourceTab => {
    if (JOB_BOARD_SOURCES.has(r.job_source)) return 'job_boards';
    if (r.job_source === 'social') {
      const job = jobMap.get(r.job_id);
      const platform = job?.platform?.toLowerCase() ?? '';
      if (CHAT_GROUP_PLATFORMS.has(platform)) return 'chat_groups';
      if (SOCIAL_GROUP_PLATFORMS.has(platform)) return 'social_groups';
      return 'others';
    }
    return 'others';
  };

  const filteredResults = profileResults
    .filter(r => {
      if (sourceTab === 'new') {
        return !reviewedMap[r.id] && !queuedJobIds.has(r.job_id) && !savedJobIds.has(r.job_id);
      }
      if (sourceTab === 'reviewed') {
        return Boolean(reviewedMap[r.id]);
      }
      if (sourceTab === 'queued') {
        return queuedJobIds.has(r.job_id) || savedJobIds.has(r.job_id);
      }
      return true;
    })
    .filter(r => {
      if (!jobSearchQuery.trim()) return true;
      const q = jobSearchQuery.toLowerCase();
      const job = jobMap.get(r.job_id);
      if (!job) return false;
      return (job.job_title ?? '').toLowerCase().includes(q)
        || (job.company_name ?? '').toLowerCase().includes(q)
        || (job.location ?? '').toLowerCase().includes(q)
        || r.job_source.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (!isPaidPlan) {
        const aUnlocked = unlockedResultIds.has(a.id);
        const bUnlocked = unlockedResultIds.has(b.id);
        if (aUnlocked !== bUnlocked) return aUnlocked ? -1 : 1;
      }

      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortField) {
        case 'score': return (a.final_average_score - b.final_average_score) * dir;
        case 'date': return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
        case 'profile': {
          const pA = profiles.find(p => p.id === a.profile_id)?.candidate_name ?? '';
          const pB = profiles.find(p => p.id === b.profile_id)?.candidate_name ?? '';
          return pA.localeCompare(pB) * dir;
        }
        default: return 0;
      }
    });

  const MATCH_PAGE_SIZE = 10;
  const totalMatchPages = Math.max(1, Math.ceil(filteredResults.length / MATCH_PAGE_SIZE));
  const paginatedResults = filteredResults.slice((matchPage - 1) * MATCH_PAGE_SIZE, matchPage * MATCH_PAGE_SIZE);

  const benchProfiles = profiles.filter(p => p.bench_stage !== 'Placed' && p.bench_stage !== 'Lost');
  const hotlistProfiles = profiles.filter(p => hotlistProfileIds.has(p.id));
  const sidebarProfiles = (sidebarTab === 'all' ? benchProfiles : hotlistProfiles).filter(p => {
    const q = candidateQuery.toLowerCase();
    if (!q) return true;
    return p.candidate_name.toLowerCase().includes(q) || (p.target_role ?? '').toLowerCase().includes(q);
  }).sort((a, b) => {
    const da = new Date(b.created_at || '').getTime();
    const db = new Date(a.created_at || '').getTime();
    return da - db;
  });

  if (loading) {
    return (
      <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
        <AppNav />
        <div className="flex-1 flex items-center justify-center">
          <LogoSpinner size={32} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100 font-sans overflow-hidden">
      <AppNav />
      {showPlanModal && (
        <PlanModal
          hasActiveSub={hasActiveSub}
          subscription={subscription}
          selectedNewTier={selectedNewTier}
          setSelectedNewTier={setSelectedNewTier}
          pendingPeriodEnd={pendingPeriodEnd}
          changingPlan={changingPlan}
          subscribing={subscribing}
          onClose={() => setShowPlanModal(false)}
          onSubmit={handlePlanSubmit}
          user={user}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Full-width Search Header */}
      <div className="bg-white border-b border-gray-200 px-5 h-[56px] flex items-center gap-3 shrink-0">
        <div className="flex-1 relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search candidates or jobs by name, title, company, location..."
            value={jobSearchQuery}
            onChange={(e) => { setJobSearchQuery(e.target.value); setCandidateQuery(e.target.value); setMatchPage(1); }}
            className="w-full pl-8 pr-8 py-2 text-xs border border-slate-200 rounded-2xl bg-slate-50 shadow-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 focus:bg-white transition-shadow"
          />
          {jobSearchQuery && (
            <button onClick={() => { setJobSearchQuery(''); setCandidateQuery(''); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={12} />
            </button>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-3 shrink-0">
          <div className="flex h-[38px] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 shadow-sm whitespace-nowrap">
            <div className="flex items-center gap-1 text-center">
              {!isPaidPlan ? (
                <>
                  <span className="text-[12px] font-semibold leading-none text-slate-900">{liveMatchRemaining}/{FREE_PLAN_LIVE_MATCH_TOTAL_LIMIT}</span>
                  <span className="text-[10px] font-medium leading-none text-slate-500 normal-case tracking-normal">matches left</span>
                </>
              ) : cooldownRemainingMs > 0 ? (
                <span className="text-[10px] font-semibold text-amber-600">Refresh in {formatCooldown(cooldownRemainingMs)}</span>
              ) : (
                <span className="text-[10px] font-semibold text-gray-400">Hourly refreshes available per candidate</span>
              )}
            </div>
          </div>
          {!isPaidPlan ? (
            <button
              type="button"
              onClick={openUpgradeModal}
              className="flex h-[38px] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 shadow-sm whitespace-nowrap transition-colors hover:bg-blue-50"
            >
              <span className="text-[9px] font-normal leading-none text-slate-400">for unlimited hourly refreshes -</span>
              <span className="text-[11px] font-semibold text-blue-700">Upgrade to Pro</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* ── COL 1: Candidates Sidebar ──────────────────────────────────── */}
        <div className="w-72 flex-shrink-0 hidden lg:flex flex-col overflow-hidden bg-white border-r border-gray-200 min-h-0">
          <div className="h-[44px] flex items-center px-3 border-b border-gray-200 shrink-0">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">Candidates</h3>
          </div>
          <div className="px-3 py-2 border-b border-gray-100 shrink-0">
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              {(['hotlist', 'all', 'demo-roles'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => {
                    setSidebarTab(tab);
                    if (tab !== 'demo-roles') {
                      setSelectedDemoRoleId(null);
                    } else {
                      setSelectedProfileId(null);
                      if (!selectedDemoRoleId && demoRoles.length > 0) {
                        setSelectedDemoRoleId(demoRoles[0].id);
                      }
                    }
                  }}
                  className={`flex-1 text-[11px] font-semibold py-1.5 rounded-md transition-all text-center ${
                    sidebarTab === tab
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab === 'hotlist' ? 'Hotlist' : tab === 'all' ? 'All Bench' : 'Watch List'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {sidebarTab === 'demo-roles' ? (
              <>
                <div className="border-b border-gray-100 px-3 py-2">
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                    <input
                      type="text"
                      value={watchListQuery}
                      onChange={(e) => setWatchListQuery(e.target.value)}
                      placeholder="Search watch list"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-[11px] text-slate-700 outline-none focus:border-blue-400 focus:bg-white"
                    />
                    {watchListQuery ? (
                      <button
                        type="button"
                        onClick={() => setWatchListQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        <X size={11} />
                      </button>
                    ) : null}
                  </div>
                </div>
                {demoRoles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <Target size={18} className="text-gray-300" />
                  <p className="text-xs text-gray-400">No watch list entries yet</p>
                </div>
              ) : (
                <>
                  {demoRoles
                    .filter(role => {
                      const query = watchListQuery.trim().toLowerCase();
                      if (!query) return true;
                      return [role.target_role, role.priority_skills, role.work_type, role.preferred_locations]
                        .filter(Boolean)
                        .some(value => String(value).toLowerCase().includes(query));
                    })
                    .map(role => {
                      const isSelected = selectedDemoRoleId === role.id;
                      return (
                      <button
                        key={role.id}
                        onClick={() => {
                          setSelectedDemoRoleId(isSelected ? null : role.id);
                          setSelectedProfileId(null);
                          void loadDemoRoleMatches(role.id);
                        }}
                        className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-all ${
                          isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50 border-l-2 border-l-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isSelected ? 'bg-blue-100' : 'bg-gray-100'}`}>
                            <Target size={13} className={isSelected ? 'text-blue-600' : 'text-gray-400'} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className={`text-[12px] font-semibold truncate leading-tight ${isSelected ? 'text-blue-900' : 'text-gray-800'}`}>
                              {role.target_role}
                            </p>
                            <p className="text-[10px] text-gray-400 truncate mt-0.5">{role.priority_skills || 'No priority skills yet'}</p>
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${isSelected ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                                Matched <span className="ml-0.5 text-[10px] font-bold">{getWatchListDisplayMatchCount(role.match_count ?? 0, role.match_count ?? 0)}</span>
                              </span>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                    })}
                </>
              )}
            </>
          ) : sidebarProfiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <User size={18} className="text-gray-300" />
                <p className="text-xs text-gray-400">{sidebarTab === 'hotlist' ? 'No hotlisted candidates' : 'No candidates found'}</p>
              </div>
            ) : (
              <>
                {sidebarProfiles.map(profile => {
                  const isSelected = selectedProfileId === profile.id;
                  const matchedCount = matchCountByProfile.get(profile.id) ?? 0;
                  const healthScore = getMatchHealthPercent(profile);
                  const healthTone = healthScore === 0
                    ? { chip: 'bg-gray-50 text-gray-500', label: 'Health' }
                    : healthScore < 60
                    ? { chip: 'bg-red-50 text-red-700', label: 'Health' }
                    : healthScore < 80
                    ? { chip: 'bg-amber-50 text-amber-700', label: 'Health' }
                    : { chip: 'bg-emerald-50 text-emerald-700', label: 'Health' };
                  const matchedTone = matchedCount === 0
                    ? 'bg-gray-50 text-gray-500'
                    : 'bg-violet-50 text-violet-700';
                  return (
                    <button
                      key={profile.id}
                      onClick={() => {
                        setSelectedProfileId(isSelected ? null : profile.id);
                        setSelectedDemoRoleId(null);
                      }}
                      className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-all ${
                        isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50 border-l-2 border-l-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isSelected ? 'bg-blue-100' : 'bg-gray-100'}`}>
                          <User size={13} className={isSelected ? 'text-blue-600' : 'text-gray-400'} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-[12px] font-semibold truncate leading-tight ${isSelected ? 'text-blue-900' : 'text-gray-800'}`}>
                            {profile.candidate_name}
                          </p>
                          <p className="text-[10px] text-gray-400 truncate mt-0.5">{profile.target_role || 'No target role'}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${matchedTone}`}>
                              Matched <span className="ml-0.5 text-[10px] font-bold">{matchedCount}</span>
                            </span>
                            <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${healthTone.chip}`}>
                              {healthTone.label} <span className="ml-0.5 text-[10px] font-bold">{healthScore}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* ── Main Content ────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* Content area */}
        <div className="flex-1 flex overflow-hidden min-h-0">

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* ── COL 2: Candidate Details ───────────────────────────────────── */}
          {(selectedProfileId || selectedDemoRoleId) && (() => {
            const profile = profiles.find(p => p.id === selectedProfileId);
            const demoRole = sidebarTab === 'demo-roles' ? demoRoles.find(role => role.id === selectedDemoRoleId) : null;
            if (!profile && !demoRole) return null;
            return (
              <div className="w-[340px] flex-shrink-0 border-r border-slate-200 overflow-hidden bg-slate-50/50 flex flex-col">
                {/* Col 2 Header */}
                <div className="sticky top-0 z-30 bg-white border-b border-slate-200">
                  <div className="px-3 h-[44px] flex items-center justify-between border-b border-slate-100">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">Details</h3>
                    {detailTab === 'profile' && (
                      <button
                        onClick={() => setIsEditingProfile(prev => !prev)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 transition-colors"
                        title={isEditingProfile ? 'Close edit mode' : 'Edit profile fields'}
                      >
                        <Pencil size={11} />
                        {isEditingProfile ? 'Close' : 'Edit'}
                      </button>
                    )}
                  </div>
                  {!sidebarTab.startsWith('demo') && (
                    <div className="px-3 py-2">
                      <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                        {(['profile', 'docs', 'activity'] as const).map(tab => (
                          <button
                            key={tab}
                            onClick={() => setDetailTab(tab)}
                            className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold rounded-md transition-all ${
                              detailTab === tab
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                            }`}
                          >
                            {tab === 'profile' && 'Profile'}
                            {tab === 'docs' && 'Docs'}
                            {tab === 'activity' && 'Activity'}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Col 2 Body */}
                <div className={`flex-1 p-2.5 ${detailTab === 'profile' && !isEditingProfile ? 'overflow-hidden' : 'overflow-y-auto'}`}>
                {/* ── Profile Tab ── */}
                {detailTab === 'profile' && (
                  <div className={isEditingProfile ? 'space-y-2.5' : 'h-full flex flex-col gap-2'}>
                    {(() => {
                      const hasText = (value: string | null | undefined) => Boolean(value && value.trim().length > 0);
                      const createdAt = getCreatedAtTimestamp(profile?.created_at);
                      const daysSinceCreated = createdAt != null
                        ? Math.max(0, Math.floor((Date.now() - createdAt) / (1000 * 60 * 60 * 24)))
                        : 0;
                      const matches70Plus = profile ? (matchCountByProfile.get(profile.id) ?? 0) : 0;

                      const matchFieldRows = [
                        { label: 'Target Role', value: profileForm.target_role },
                        { label: 'Years Exp', value: profileForm.years_experience },
                        { label: 'Visa Status', value: profileForm.visa_status },
                        { label: 'Employment Type', value: profileForm.work_authorization },
                        { label: 'Work Type', value: profileForm.work_type },
                        { label: 'Preferred Locations', value: profileForm.preferred_locations },
                        { label: 'Min Rate ($/hr)', value: profileForm.desired_salary_min },
                        { label: 'Max Rate ($/hr)', value: profileForm.desired_salary_max },
                        { label: 'Relocation Open', value: profileForm.relocation_open ? 'Yes' : 'No' },
                        { label: 'Priority Skills', value: profileForm.priority_skills },
                      ];

                      return (
                        <>
                          {!isEditingProfile ? (
                            <div className="bg-white rounded-xl border border-slate-200 p-2.5 flex-1 min-h-0 flex flex-col">
                              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Match Rules</p>
                              <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg flex-1 min-h-0 overflow-y-auto">
                                {matchFieldRows.map((row) => {
                                  const hasValue = hasText(row.value);
                                  const isPrioritySkills = row.label === 'Priority Skills';
                                  const skills = isPrioritySkills
                                    ? row.value.split(',').map(skill => skill.trim()).filter(Boolean)
                                    : [];

                                  return (
                                    <div key={row.label} className="grid grid-cols-[104px_1fr] items-start gap-1.5 px-2 py-1.5">
                                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide pt-0.5">{row.label}</p>
                                      {!isPrioritySkills ? (
                                        <p className={`text-[11px] font-medium ${hasValue ? 'text-slate-800' : 'text-slate-400 italic'}`}>
                                          {hasValue ? row.value : 'Empty'}
                                        </p>
                                      ) : skills.length > 0 ? (
                                        <div>
                                          <div className="flex flex-wrap gap-0.5">
                                          {skills.map(skill => (
                                            <span key={skill} className="inline-flex items-center rounded-md bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-700">
                                              {skill}
                                            </span>
                                          ))}
                                          </div>
                                        </div>
                                      ) : (
                                        <p className="text-[11px] font-medium text-slate-400 italic">Empty</p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="space-y-2.5 bg-white rounded-xl border border-slate-200 p-2.5">
                                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Match Rules</p>

                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Target Role</label>
                                  <input
                                    value={profileForm.target_role}
                                    onChange={(e) => updateProfileField('target_role', e.target.value)}
                                    placeholder="Ex: Senior Java Developer"
                                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Priority Skills</label>
                                  <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                                    <div className="flex flex-wrap gap-1.5 mb-2">
                                      {profileForm.priority_skills
                                        .split(',')
                                        .map(item => item.trim())
                                        .filter(Boolean)
                                        .map(skill => (
                                          <span key={skill} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">
                                            {skill}
                                            <button type="button" onClick={() => removePrioritySkill(skill)} className="text-blue-400 hover:text-red-500">
                                              <X size={10} />
                                            </button>
                                          </span>
                                        ))}
                                    </div>
                                    <input
                                      value={prioritySkillInput}
                                      onChange={(e) => setPrioritySkillInput(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' && prioritySkillInput.trim()) {
                                          e.preventDefault();
                                          addPrioritySkill(prioritySkillInput);
                                          setPrioritySkillInput('');
                                        }
                                      }}
                                      placeholder="Type a skill and press Enter"
                                      className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                                    />
                                    <p className="mt-1 text-[10px] text-slate-400">Press Enter to add a skill</p>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">Years Exp</label>
                                    <input
                                      type="number"
                                      min="0"
                                      value={profileForm.years_experience}
                                      onChange={(e) => updateProfileField('years_experience', e.target.value)}
                                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">Visa Status</label>
                                    <select
                                      value={profileForm.visa_status}
                                      onChange={(e) => updateProfileField('visa_status', e.target.value)}
                                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white"
                                    >
                                      <option value="">Select</option>
                                      <option value="US Citizen">US Citizen</option>
                                      <option value="Green Card">Green Card</option>
                                      <option value="H1B">H1B</option>
                                      <option value="H4EAD">H4EAD</option>
                                      <option value="TN">TN</option>
                                      <option value="OPT">OPT</option>
                                      <option value="CPT">CPT</option>
                                      <option value="F1">F1</option>
                                      <option value="EAD">EAD</option>
                                      <option value="Other">Other</option>
                                    </select>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">Employment Type</label>
                                    <select
                                      value={profileForm.work_authorization}
                                      onChange={(e) => updateProfileField('work_authorization', e.target.value)}
                                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white"
                                    >
                                      <option value="">Select</option>
                                      <option value="C2C">C2C</option>
                                      <option value="W2">W2</option>
                                      <option value="1099">1099</option>
                                      <option value="C2C or W2">C2C or W2</option>
                                      <option value="Any">Any</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">Work Type</label>
                                    <select
                                      value={profileForm.work_type}
                                      onChange={(e) => updateProfileField('work_type', e.target.value)}
                                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white"
                                    >
                                      <option value="">Select</option>
                                      <option value="Remote">Remote</option>
                                      <option value="Hybrid">Hybrid</option>
                                      <option value="Onsite">Onsite</option>
                                      <option value="Open">Open</option>
                                    </select>
                                  </div>
                                </div>

                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Preferred Locations</label>
                                  <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                                    <div className="mb-2 flex flex-wrap gap-1.5">
                                      {splitPreferredLocations(profileForm.preferred_locations).map((loc) => (
                                        <span key={loc} className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-[10px] font-semibold text-blue-700">
                                          {loc}
                                          <button
                                            type="button"
                                            onClick={() => removePreferredLocation(loc)}
                                            className="text-blue-400 hover:text-red-500"
                                            aria-label={`Remove ${loc}`}
                                          >
                                            <X size={10} />
                                          </button>
                                        </span>
                                      ))}
                                    </div>
                                    <div className="flex gap-1.5 items-center">
                                      <LocationAutosuggestInput
                                        value={preferredLocationInput}
                                        onChange={setPreferredLocationInput}
                                        onSelectPlace={(place) => addPreferredLocation(place.formatted || preferredLocationInput)}
                                        scope="any"
                                        placeholder="Type city/state/country and pick"
                                        className="flex-1"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => addPreferredLocation(preferredLocationInput)}
                                        className="h-[30px] px-2.5 rounded-md border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                                      >
                                        Add
                                      </button>
                                    </div>
                                    <p className="mt-1 text-[10px] text-slate-400">Use autosuggest to add one or more preferred locations.</p>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">Min Rate ($/hr)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      value={profileForm.desired_salary_min}
                                      onChange={(e) => updateProfileField('desired_salary_min', e.target.value)}
                                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">Max Rate ($/hr)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      value={profileForm.desired_salary_max}
                                      onChange={(e) => updateProfileField('desired_salary_max', e.target.value)}
                                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                                    />
                                  </div>
                                </div>

                                <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                                  <input
                                    type="checkbox"
                                    checked={profileForm.relocation_open}
                                    onChange={(e) => updateProfileField('relocation_open', e.target.checked)}
                                    className="w-3.5 h-3.5 rounded border-slate-300"
                                  />
                                  Open to relocation
                                </label>
                              </div>

                              <div className="space-y-2 bg-white rounded-xl border border-slate-200 p-2.5">
                                <div className="flex items-center justify-between">
                                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Work History</p>
                                  <button
                                    onClick={addExperienceRow}
                                    className="text-[10px] font-semibold text-blue-600 hover:text-blue-700"
                                  >
                                    + Add
                                  </button>
                                </div>
                                {profileExperience.length === 0 ? (
                                  <p className="text-[11px] text-slate-400">No work history added yet.</p>
                                ) : (
                                  <div className="space-y-1.5">
                                    {profileExperience.map((exp, idx) => (
                                      <div key={idx} className="rounded-lg border border-slate-100 bg-slate-50 p-2 space-y-1.5">
                                        <div className="grid grid-cols-2 gap-1.5">
                                          <input value={exp.title} onChange={(e) => updateExperienceField(idx, 'title', e.target.value)} placeholder="Title" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                          <input value={exp.company} onChange={(e) => updateExperienceField(idx, 'company', e.target.value)} placeholder="Company" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-1.5">
                                          <input value={exp.start_date} onChange={(e) => updateExperienceField(idx, 'start_date', e.target.value)} placeholder="Start" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                          <input value={exp.current ? '' : exp.end_date} onChange={(e) => updateExperienceField(idx, 'end_date', e.target.value)} placeholder="End" disabled={exp.current} className="rounded-md border border-slate-200 px-2 py-1 text-xs disabled:bg-slate-100" />
                                        </div>
                                        <input value={exp.location} onChange={(e) => updateExperienceField(idx, 'location', e.target.value)} placeholder="Location" className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                        <textarea value={exp.description} onChange={(e) => updateExperienceField(idx, 'description', e.target.value)} rows={2} placeholder="Summary / achievements" className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                        <div className="flex items-center justify-between">
                                          <label className="text-[10px] text-slate-600 flex items-center gap-1.5">
                                            <input type="checkbox" checked={Boolean(exp.current)} onChange={(e) => updateExperienceField(idx, 'current', e.target.checked)} className="w-3 h-3" />
                                            Current role
                                          </label>
                                          <button onClick={() => removeExperienceRow(idx)} className="text-[10px] font-semibold text-red-500 hover:text-red-600">Remove</button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="space-y-2 bg-white rounded-xl border border-slate-200 p-2.5">
                                <div className="flex items-center justify-between">
                                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Education</p>
                                  <button
                                    onClick={addEducationRow}
                                    className="text-[10px] font-semibold text-blue-600 hover:text-blue-700"
                                  >
                                    + Add
                                  </button>
                                </div>
                                {profileEducation.length === 0 ? (
                                  <p className="text-[11px] text-slate-400">No education added yet.</p>
                                ) : (
                                  <div className="space-y-1.5">
                                    {profileEducation.map((edu, idx) => (
                                      <div key={idx} className="rounded-lg border border-slate-100 bg-slate-50 p-2 space-y-1.5">
                                        <div className="grid grid-cols-2 gap-1.5">
                                          <input value={edu.degree} onChange={(e) => updateEducationField(idx, 'degree', e.target.value)} placeholder="Degree" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                          <input value={edu.field} onChange={(e) => updateEducationField(idx, 'field', e.target.value)} placeholder="Field" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                        </div>
                                        <input value={edu.institution} onChange={(e) => updateEducationField(idx, 'institution', e.target.value)} placeholder="Institution" className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                        <div className="grid grid-cols-3 gap-1.5">
                                          <input value={edu.start_year} onChange={(e) => updateEducationField(idx, 'start_year', e.target.value)} placeholder="Start" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                          <input value={edu.end_year} onChange={(e) => updateEducationField(idx, 'end_year', e.target.value)} placeholder="End" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                          <input value={edu.gpa ?? ''} onChange={(e) => updateEducationField(idx, 'gpa', e.target.value)} placeholder="GPA" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                        </div>
                                        <div className="flex justify-end">
                                          <button onClick={() => removeEducationRow(idx)} className="text-[10px] font-semibold text-red-500 hover:text-red-600">Remove</button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <button
                                onClick={() => (sidebarTab === 'demo-roles' && demoRole ? saveDemoRoleForMatching(demoRole.id) : saveProfileForMatching(profile?.id ?? ''))}
                                disabled={savingProfileFields || (!profile && !demoRole)}
                                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-bold text-white rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-700 hover:to-sky-600 disabled:opacity-50 transition-colors"
                              >
                                {savingProfileFields ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                                {savingProfileFields ? 'Saving...' : sidebarTab === 'demo-roles' ? 'Save Demo Role' : 'Save & Refresh Match Rules'}
                              </button>
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* ── Docs Tab ── */}
                {detailTab === 'docs' && (
                  <div>
                    {docsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 size={18} className="animate-spin text-slate-400" />
                      </div>
                    ) : profileDocs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <FileText size={24} className="text-slate-300 mb-1.5" />
                        <p className="text-xs text-slate-500">No documents uploaded</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {profileDocs.map(doc => (
                          <div key={doc.id} className="flex items-center gap-2 bg-white rounded-lg border border-slate-100 p-2 hover:border-slate-200 transition-colors">
                            <FileText size={14} className="text-slate-400 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-slate-800 truncate">{doc.file_name}</p>
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                {doc.category && <span className="capitalize">{doc.category}</span>}
                                {doc.category && ' · '}
                                {new Date(doc.created_at).toLocaleDateString()}
                              </p>
                            </div>
                            {doc.file_url && (
                              <a
                                href={doc.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                              >
                                <Download size={13} />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Activity Tab ── */}
                {detailTab === 'activity' && (
                  <div>
                    {activityLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 size={18} className="animate-spin text-slate-400" />
                      </div>
                    ) : profileActivity.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <Activity size={24} className="text-slate-300 mb-1.5" />
                        <p className="text-xs text-slate-500">No activity recorded yet</p>
                      </div>
                    ) : (
                      <div className="space-y-0">
                        {profileActivity.map((log, i) => (
                          <div key={log.id} className="relative flex gap-2.5 pb-3">
                            {i < profileActivity.length - 1 && (
                              <div className="absolute left-[7px] top-5 bottom-0 w-px bg-slate-200" />
                            )}
                            <div className="w-[15px] h-[15px] rounded-full bg-slate-100 border-2 border-slate-300 shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-slate-800 leading-snug">{log.description}</p>
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                {log.event_type && <span className="capitalize font-medium">{log.event_type.replace(/_/g, ' ')}</span>}
                                {' · '}
                                {new Date(log.created_at).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                </div>
              </div>
            );
          })()}

          {/* ── COL 3: Match Results ───────────────────────────────────────── */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            {/* Filter Tabs - Sticky Column Header */}
            <div className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
              <div className="flex items-center h-[44px] px-3 gap-3 border-b border-slate-100">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide shrink-0">Matches</h3>
                <div className="hidden md:flex items-center gap-2.5">
                  <button
                    onClick={() => updateGlobalWatch({ is_active: !globalWatch?.is_active })}
                    disabled={!globalWatch || savingWatch}
                    className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full border text-[10px] font-bold transition-colors ${
                      globalWatch?.is_active
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                    title={globalWatch?.is_active ? 'Turn watch off' : 'Turn watch on'}
                  >
                    {savingWatch ? <Loader2 size={11} className="animate-spin" /> : <Power size={11} />}
                    <span>{globalWatch?.is_active ? 'ON' : 'OFF'}</span>
                  </button>
                  {!isPaidPlan && (
                    <div className="relative group">
                      <button
                        type="button"
                        className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
                        aria-label="Free plan watch schedule details"
                      >
                        <Info size={11} />
                      </button>
                      <div className="pointer-events-none absolute left-1/2 top-8 z-20 w-72 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <p className="text-[11px] leading-relaxed text-slate-600">
                          Free accounts are limited to only Daily matches. Upgrade your account to setup hourly match schedules
                        </p>
                        <button
                          onClick={openUpgradeModal}
                          className="pointer-events-auto mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white shadow-sm hover:opacity-90 transition-opacity"
                          style={{ background: 'linear-gradient(135deg, #2563eb 0%, #0ea5e9 100%)' }}
                        >
                          <ArrowUpRight size={11} />
                          Upgrade now
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex-1" />
                <div className="flex items-center gap-2 shrink-0">
                  {selectedMatchCooldownStatus && (
                    <span className="text-[10px] font-medium text-amber-600 whitespace-nowrap">
                      {selectedMatchCooldownStatus}
                    </span>
                  )}
                  <button
                    onClick={() => (sidebarTab === 'demo-roles' && selectedDemoRoleId ? runDemoRoleMatch(selectedDemoRoleId) : runRadarScan())}
                    disabled={scanning || runningDemoRoleMatch || (!selectedProfileId && !selectedDemoRoleId) || (sidebarTab !== 'demo-roles' && isLiveMatchCooldownActive)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 hover:from-blue-700 hover:via-orange-600 hover:to-yellow-500 disabled:from-slate-300 disabled:via-slate-300 disabled:to-slate-300 disabled:cursor-not-allowed text-white text-[11px] font-bold rounded-lg transition-all shadow-sm"
                  >
                    {scanning || runningDemoRoleMatch ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {getLiveMatchActionLabel({ isScanning: scanning, isMatching: runningDemoRoleMatch })}
                  </button>
                </div>
              </div>
              <div className="px-3 py-2">
                <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                  {([
                    { key: 'all' as const, label: 'All', count: activeTabCounts.all },
                    { key: 'new' as const, label: 'New', count: activeTabCounts.new },
                    { key: 'reviewed' as const, label: 'Reviewed', count: activeTabCounts.reviewed },
                    { key: 'queued' as const, label: 'Queued', count: activeTabCounts.queued },
                  ]).map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => { setSourceTab(tab.key); setMatchPage(1); }}
                      className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold rounded-md transition-all ${
                        sourceTab === tab.key
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {tab.label}
                      <span className={`text-[10px] min-w-[16px] px-1 rounded-full font-bold ${
                        sourceTab === tab.key ? 'bg-slate-100 text-slate-700' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {tab.count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {(scanning || pipelineStep === 'matching') && (
                <div className="px-3 pb-2">
                  <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-2.5 py-2">
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px]">
                      <span className="font-semibold text-blue-700">
                        {pipelineDetail || 'Live Match in progress...'}
                      </span>
                      <span className="font-medium text-blue-600">
                        {pipelineProgress.total > 0 ? `${pipelineProgress.current}/${pipelineProgress.total}` : 'starting'}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-blue-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-500 to-teal-500 transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

            {/* Results List */}
            <div className="relative z-0 p-4">
            {sidebarTab === 'demo-roles' ? (
              demoRoleMatches.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
                  <Radar size={48} className="mx-auto text-slate-300 mb-4" />
                  <h3 className="text-lg font-medium text-slate-700 mb-2">No role matches yet</h3>
                  <p className="text-slate-500 text-sm max-w-md mx-auto">
                    Select a demo role and click “Run Role Match” to generate ranked candidate matches.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {demoRoleMatches.map((match) => {
                    const profile = profiles.find((item) => item.id === match.profile_id);
                    const selectedDemoRole = demoRoles.find((role) => role.id === selectedDemoRoleId) ?? null;
                    const demoResult = {
                      id: match.id,
                      profile_id: match.profile_id,
                      job_source: 'watch-list' as const,
                      job_id: match.id,
                      final_average_score: match.score,
                      score_breakdown: (match.score_breakdown ?? {}) as Record<string, { score: number; candidate_value: string; job_value: string; rule: string } | number>,
                      ai_notes: match.ai_notes ?? '',
                      disqualified: false,
                      disqualify_reason: null,
                      created_at: match.created_at,
                    };
                    const demoJob = getJobInfoForResult(demoResult) ?? {
                      id: match.id,
                      job_title: selectedDemoRole?.target_role ?? 'Role Match',
                      company_name: profile?.candidate_name ?? 'Candidate',
                      location: profile?.preferred_locations ?? null,
                      job_url: null,
                      job_description: match.ai_notes ?? null,
                      post_content: match.ai_notes ?? null,
                      platform: 'watch-list' as const,
                      posted_at: match.created_at,
                      employment_type: profile?.work_authorization ?? null,
                      work_type: profile?.work_type ?? null,
                    };
                    const isInsightOpen = insightOpenById[match.id] ?? Boolean(match.ai_notes);
                    const isGenerating = insightGeneratingId === match.id;
                    return (
                      <div key={match.id} className="relative isolate overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all hover:border-slate-300">
                        <div className="w-full px-5 py-4 text-left">
                          <div className="grid gap-3 lg:grid-cols-[1fr_1.15fr] items-start">
                            <div className="min-w-0">
                              <div className="mb-2 flex flex-wrap items-start gap-2">
                                <span className="break-words font-medium text-slate-900">
                                  {getDisplayJobTitle(demoJob ?? undefined)}
                                </span>
                              </div>
                              <div className="mt-2 flex flex-col gap-1.5 text-[11px] text-slate-500">
                                {profile?.candidate_name && (
                                  <span className="inline-flex w-fit items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1">
                                    <User size={11} />
                                    {profile.candidate_name}
                                  </span>
                                )}
                                {profile?.target_role && (
                                  <span className="inline-flex w-fit items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1">
                                    <Briefcase size={11} />
                                    {profile.target_role}
                                  </span>
                                )}
                                {profile?.preferred_locations && (
                                  <span className="inline-flex w-fit items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1">
                                    <MapPin size={11} />
                                    {profile.preferred_locations}
                                  </span>
                                )}
                                <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600">
                                  {renderSourceBadgeIcon('watch-list', demoJob?.platform)}
                                  <span>{getSourceCategoryLabel('watch-list')}</span>
                                </span>
                              </div>

                              <div className="mt-2 w-fit max-w-[320px] min-w-[220px] rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50/80 via-white to-slate-50 p-2.5 shadow-sm">
                                <div className="flex items-center justify-start gap-2">
                                  {match.ai_notes && (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); setInsightOpenById(prev => ({ ...prev, [match.id]: !isInsightOpen })); }}
                                      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-all hover:bg-slate-50 hover:text-slate-700"
                                      aria-label={isInsightOpen ? 'Hide insight' : 'Show insight'}
                                    >
                                      {isInsightOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); void generateInsight(demoResult as RadarMatchResult); }}
                                    disabled={isGenerating}
                                    className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-700 shadow-sm transition-all hover:bg-blue-100 disabled:opacity-60"
                                  >
                                    {isGenerating ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                                    AI Insight
                                  </button>
                                </div>
                                {isInsightOpen && (
                                  <div className="mt-2 rounded-lg border border-slate-200/80 bg-white/90 p-2.5">
                                    {match.ai_notes ? (
                                      <p className="whitespace-pre-line break-words text-[11px] leading-5 text-slate-600">{match.ai_notes}</p>
                                    ) : (
                                      <p className="text-[11px] italic text-slate-400">Generate AI insight to see the summary here.</p>
                                    )}
                                  </div>
                                )}
                              </div>

                              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 font-medium text-slate-500">
                                  {getSourceCategoryLabel('watch-list')}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <Clock size={10} />
                                  matched {formatTimeAgo(new Date(match.created_at).getTime())}
                                </span>
                              </div>
                            </div>

                            <div className="min-w-0">
                              <ScoreBreakdownChart
                                items={buildScoreBreakdownDisplayItems(demoResult.score_breakdown, profile as Profile | undefined, demoJob as JobInfo | undefined).map(item => ({ key: item.key, score: item.score }))}
                                detailMap={Object.fromEntries(
                                  buildScoreBreakdownDisplayItems(demoResult.score_breakdown, profile as Profile | undefined, demoJob as JobInfo | undefined).map(item => [item.key, item.detail])
                                )}
                                compact
                                expandedKeys={expandedScoreKeys}
                                onToggleExpand={(key) => setExpandedScoreKeys(prev => {
                                  const next = new Set(prev);
                                  if (next.has(key)) next.delete(key);
                                  else next.add(key);
                                  return next;
                                })}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="mx-4 mb-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                          <div className="flex flex-wrap items-center gap-2">
                            {savedJobIds.has(demoResult.job_id) ? (
                              <span title="Added to Submission" className="inline-flex items-center justify-center rounded-lg bg-green-50 px-3 py-1.5 text-[11px] font-semibold text-green-600">
                                <BookmarkCheck size={14} className="mr-1.5" />
                                Saved
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); void addToSubmissionQueue(demoResult); }}
                                disabled={savingJobId === demoResult.job_id}
                                title="Submission Queue"
                                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-all hover:bg-slate-100 disabled:opacity-60"
                              >
                                {savingJobId === demoResult.job_id ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Bookmark size={14} className="mr-1.5" />}
                                + Queue
                              </button>
                            )}

                            {queuedJobIds.has(demoResult.job_id) ? (
                              <span title="Queued for Resume AI" className="inline-flex items-center justify-center rounded-lg bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-600">
                                <CheckCircle2 size={14} className="mr-1.5" />
                                Queued
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); void addToResumeAIQueue(demoResult); }}
                                disabled={queuingJobId === demoResult.job_id}
                                title="Resume AI Queue"
                                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-all hover:bg-slate-50 disabled:opacity-60"
                              >
                                {queuingJobId === demoResult.job_id ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <PenLine size={14} className="mr-1.5" />}
                                + Rewrite
                              </button>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void generateInsight(demoResult); }}
                              disabled={isGenerating}
                              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-all hover:bg-slate-100 disabled:opacity-60"
                            >
                              {isGenerating ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Sparkles size={14} className="mr-1.5" />}
                              AI Insight
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewResult(demoResult);
                                setReviewedMap(prev => {
                                  const next = { ...prev, [demoResult.id]: Date.now() };
                                  try { localStorage.setItem('radar_reviewed', JSON.stringify(next)); } catch {}
                                  return next;
                                });
                              }}
                              title="Preview Job"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-all hover:bg-slate-100"
                            >
                              <Eye size={13} />
                              Full JD
                            </button>

                            {!demoResult.disqualified && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); void disqualifyResult(demoResult); }}
                                disabled={disqualifyingJobId === demoResult.job_id}
                                title="Disqualify"
                                className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                              >
                                {disqualifyingJobId === demoResult.job_id ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : filteredResults.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
                <Radar size={48} className="mx-auto text-slate-300 mb-4" />
                <h3 className="text-lg font-medium text-slate-700 mb-2">No match results yet</h3>
                <p className="text-slate-500 text-sm max-w-md mx-auto">
                  Create a watch schedule or click &quot;Live Match&quot; to find and score job matches for this profile.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
            {paginatedResults.map((result, index) => {
              const profile = profiles.find(p => p.id === result.profile_id);
              const job = jobMap.get(result.job_id);
              const isExpanded = expandedId === result.id;
              const isLocked = !isPaidPlan && !unlockedResultIds.has(result.id);

              return (
                <div
                  key={result.id}
                  className={`relative isolate overflow-hidden rounded-xl border shadow-sm transition-all ${
                    result.disqualified ? 'border-red-200 bg-red-50/30' : 'border-slate-200 hover:border-slate-300'
                  } ${isLocked ? 'bg-slate-50/80' : 'bg-white'}`}
                >
                  {isLocked && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-[1px]">
                      <div className="mx-4 flex max-w-sm flex-col items-center rounded-2xl border border-slate-200 bg-white/95 px-4 py-4 text-center shadow-lg">
                        <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                          <Lock size={16} />
                        </div>
                        <p className="text-[11px] font-semibold text-slate-700">Upgrade to unlock all Matched Jobs</p>
                        <button
                          type="button"
                          onClick={openUpgradeModal}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm"
                        >
                          <ArrowUpRight size={11} />
                          Upgrade now
                        </button>
                      </div>
                    </div>
                  )}
                  <div className={`w-full px-5 py-4 text-left ${isLocked ? 'blur-[2px] select-none' : ''}`}>
                    <div className="grid gap-3 lg:grid-cols-[1fr_1.15fr] items-start">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-start gap-2">
                          <span className="break-words font-medium text-slate-900">
                            {getDisplayJobTitle(job ?? undefined)}
                          </span>
                          {result.disqualified && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">
                              <XCircle size={10} />
                              DQ
                            </span>
                          )}
                        </div>

                        <div className="mt-2 flex flex-col gap-1.5 text-[11px] text-slate-500">
                          {job?.company_name && (
                            <span className="inline-flex w-fit items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1">
                              <Briefcase size={11} />
                              {job.company_name}
                            </span>
                          )}
                          {job?.location && (
                            <span className="inline-flex w-fit items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1">
                              <MapPin size={11} />
                              {job.location}
                            </span>
                          )}
                          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600">
                            {renderSourceBadgeIcon(result.job_source, job?.platform)}
                            <span>{getSourceBadgeDisplayName(result.job_source, job?.platform)}</span>
                          </span>
                        </div>

                        {result.job_source === 'social' && (job?.posted_by_name || job?.profile_link || job?.poster_email) && (
                          <div className="mt-2 flex w-fit min-w-[220px] max-w-[320px] flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-2.5 py-2 shadow-sm">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Posted by</p>
                            {job?.posted_by_name && (
                              <div className="w-full">
                                {job.profile_link ? (
                                  <a
                                    href={job.profile_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 transition-all hover:bg-slate-100"
                                    title={job.posted_by_name}
                                  >
                                    <span className="break-words text-left">{job.posted_by_name}</span>
                                    <Link2 size={11} className="shrink-0 text-slate-500" />
                                  </a>
                                ) : (
                                  <span className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700" title={job.posted_by_name}>
                                    <span className="break-words text-left">{job.posted_by_name}</span>
                                  </span>
                                )}
                              </div>
                            )}
                            {job?.poster_email && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigator.clipboard?.writeText(job.poster_email ?? '').catch(() => {});
                                }}
                                className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700 transition-all hover:bg-slate-100"
                                title={job.poster_email}
                              >
                                <span className="break-words text-left">{job.poster_email}</span>
                                <Copy size={11} className="shrink-0 text-slate-500" />
                              </button>
                            )}
                          </div>
                        )}

                        <div className="mt-2 w-fit max-w-[320px] min-w-[220px] rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50/80 via-white to-slate-50 p-2.5 shadow-sm">
                          <div className="flex items-center justify-start gap-2">
                            <div className="flex items-center gap-2">
                              {result.ai_notes && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); setInsightOpenById(prev => ({ ...prev, [result.id]: !(prev[result.id] ?? Boolean(result.ai_notes)) })); }}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-all hover:bg-slate-50 hover:text-slate-700"
                                  aria-label={(insightOpenById[result.id] ?? Boolean(result.ai_notes)) ? 'Hide insight' : 'Show insight'}
                                >
                                  {(insightOpenById[result.id] ?? Boolean(result.ai_notes)) ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); void generateInsight(result); }}
                                disabled={insightGeneratingId === result.id}
                                className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-700 shadow-sm transition-all hover:bg-blue-100 disabled:opacity-60"
                              >
                                {insightGeneratingId === result.id ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                                AI Insight
                              </button>
                            </div>
                          </div>
                          {(insightOpenById[result.id] ?? Boolean(result.ai_notes)) && (
                            <div className="mt-2 rounded-lg border border-slate-200/80 bg-white/90 p-2.5">
                              {result.ai_notes ? (
                                <p className="whitespace-pre-line break-words text-[11px] leading-5 text-slate-600">
                                  {result.ai_notes}
                                </p>
                              ) : (
                                <p className="text-[11px] italic text-slate-400">Generate AI insight to see the summary here.</p>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 font-medium text-slate-500">
                            {getSourceCategoryLabel(result.job_source)}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock size={10} />
                            matched {formatTimeAgo(new Date(result.created_at).getTime())}
                          </span>
                          {job?.posted_at && (
                            <span className="inline-flex items-center gap-1">
                              <Clock size={10} />
                              posted {formatTimeAgo(new Date(job.posted_at).getTime())}
                            </span>
                          )}
                          {reviewedMap[result.id] && (
                            <span className="inline-flex items-center gap-1 italic">
                              reviewed {formatTimeAgo(reviewedMap[result.id])}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="min-w-0">
                        <ScoreBreakdownChart
                          items={buildScoreBreakdownDisplayItems(result.score_breakdown, profile, job).map(item => ({ key: item.key, score: item.score }))}
                          detailMap={Object.fromEntries(
                            buildScoreBreakdownDisplayItems(result.score_breakdown, profile, job).map(item => [item.key, item.detail])
                          )}
                          compact
                          expandedKeys={expandedScoreKeys}
                          onToggleExpand={(key) => setExpandedScoreKeys(prev => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          })}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mx-4 mb-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {savedJobIds.has(result.job_id) ? (
                        <span title="Added to Submission" className="inline-flex items-center justify-center rounded-lg bg-green-50 px-3 py-1.5 text-[11px] font-semibold text-green-600">
                          <BookmarkCheck size={14} className="mr-1.5" />
                          Saved
                        </span>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); addToSubmissionQueue(result); }}
                          disabled={savingJobId === result.job_id}
                          title="Submission Queue"
                          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-all hover:bg-slate-100 disabled:opacity-60"
                        >
                          {savingJobId === result.job_id ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Bookmark size={14} className="mr-1.5" />}
                          + Queue
                        </button>
                      )}

                      {queuedJobIds.has(result.job_id) ? (
                        <span title="Queued for Resume AI" className="inline-flex items-center justify-center rounded-lg bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-600">
                          <CheckCircle2 size={14} className="mr-1.5" />
                          Queued
                        </span>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); addToResumeAIQueue(result); }}
                          disabled={queuingJobId === result.job_id}
                          title="Resume AI Queue"
                          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-all hover:bg-slate-50 disabled:opacity-60"
                        >
                          {queuingJobId === result.job_id ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <PenLine size={14} className="mr-1.5" />}
                          + Rewrite
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {job?.job_url && (
                        <a
                          href={job.job_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Apply Link"
                          className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition-all hover:bg-slate-50"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewResult(result);
                          setReviewedMap(prev => {
                            const next = { ...prev, [result.id]: Date.now() };
                            try { localStorage.setItem('radar_reviewed', JSON.stringify(next)); } catch {}
                            return next;
                          });
                        }}
                        title="Preview Job"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-all hover:bg-slate-100"
                      >
                        <Eye size={13} />
                        Full JD
                      </button>

                      {!result.disqualified && (
                        <button
                          onClick={(e) => { e.stopPropagation(); disqualifyResult(result); }}
                          disabled={disqualifyingJobId === result.job_id}
                          title="Disqualify"
                          className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                        >
                          {disqualifyingJobId === result.job_id ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </div>

        {/* Pagination Footer */}
        {filteredResults.length > MATCH_PAGE_SIZE && (
          <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-2 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">
              {(matchPage - 1) * MATCH_PAGE_SIZE + 1}-{Math.min(matchPage * MATCH_PAGE_SIZE, filteredResults.length)} of {filteredResults.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMatchPage(p => Math.max(1, p - 1))}
                disabled={matchPage === 1}
                className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-default transition-colors"
              >
                Prev
              </button>
              <span className="text-[11px] font-medium text-slate-700 px-2">{matchPage}/{totalMatchPages}</span>
              <button
                onClick={() => setMatchPage(p => Math.min(totalMatchPages, p + 1))}
                disabled={matchPage === totalMatchPages}
                className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-default transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}

        </div> {/* end col3 */}
        </div> {/* end flex wrapper for col2+col3 */}
        </div>
        </div>
      </div>

      </div>

      {/* Preview Modal */}
      {previewResult && (() => {
        const previewJob = getJobInfoForResult(previewResult);
        const desc = getDisplayJobDescription(previewJob);
        return (
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setPreviewResult(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-5 border-b border-gray-100 flex items-start gap-3 shrink-0">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center shrink-0">
                  <Briefcase size={20} className="text-slate-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-bold text-gray-900 text-base leading-tight">{getDisplayJobTitle(previewJob ?? undefined)}</h2>
                  <p className="text-sm font-medium mt-0.5 text-blue-600">{previewJob?.company_name ?? 'Unknown Company'}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                    {previewJob?.location && <span className="flex items-center gap-1 text-xs text-gray-500"><MapPin size={10} />{previewJob.location}</span>}
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      {renderSourceBadgeIcon(previewResult.job_source, previewJob?.platform)}
                      <span>{getSourceBadgeDisplayName(previewResult.job_source, previewJob?.platform)}</span>
                    </span>
                  </div>
                </div>
                <button onClick={() => setPreviewResult(null)} className="text-gray-400 hover:text-gray-600 transition-colors shrink-0 p-1">
                  <X size={18} />
                </button>
              </div>

              {previewResult.job_source === 'social' && (previewJob?.posted_by_name || previewJob?.profile_link || previewJob?.poster_email) && (
                <div className="shrink-0 border-b border-gray-100 bg-slate-50/70 px-5 py-3">
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Posted by</p>
                  <div className="flex flex-col gap-2">
                    {previewJob?.posted_by_name && (
                      <div>
                        {previewJob.profile_link ? (
                          <a
                            href={previewJob.profile_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-100"
                            title={previewJob.posted_by_name}
                          >
                            <span className="break-words text-left">{previewJob.posted_by_name}</span>
                            <Link2 size={13} className="shrink-0 text-slate-500" />
                          </a>
                        ) : (
                          <span className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700" title={previewJob.posted_by_name}>
                            <span className="break-words text-left">{previewJob.posted_by_name}</span>
                          </span>
                        )}
                      </div>
                    )}
                    {previewJob?.poster_email && (
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(previewJob.poster_email ?? '').catch(() => {});
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 transition-all hover:bg-slate-100"
                        title={previewJob.poster_email}
                      >
                        <span className="break-words text-left">{previewJob.poster_email}</span>
                        <Copy size={13} className="shrink-0 text-slate-500" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Score strip */}
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 shrink-0 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                  previewResult.final_average_score >= 80 ? 'bg-emerald-500' :
                  previewResult.final_average_score >= 60 ? 'bg-sky-500' :
                  previewResult.final_average_score >= 40 ? 'bg-amber-500' : 'bg-red-500'
                }`}>
                  {previewResult.final_average_score}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">
                    {previewResult.final_average_score >= 80 ? 'Strong Match' :
                     previewResult.final_average_score >= 60 ? 'Medium Match' :
                     previewResult.final_average_score >= 40 ? 'Weak Match' : 'Poor Match'}
                  </p>
                  {previewResult.ai_notes && <p className="text-xs text-gray-500 mt-0.5">{previewResult.ai_notes}</p>}
                </div>
                {previewResult.disqualified && (
                  <span className="text-xs font-semibold bg-red-100 text-red-700 px-2 py-1 rounded-full">Disqualified</span>
                )}
              </div>

              {/* Description */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {previewJob?.post_content && (
                  <div>
                    <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Original Post</h3>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                      {previewJob.post_content.split('\n').filter(l => l.trim()).map((p, i) => (
                        <p key={i} className="text-sm text-gray-700 leading-relaxed">{p}</p>
                      ))}
                    </div>
                  </div>
                )}

                {desc && desc !== 'No description available.' ? (
                  <div>
                    <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Job Description</h3>
                    {desc.includes('<') && desc.includes('>') ? (
                      <div
                        className="prose prose-sm max-w-none text-gray-700"
                        dangerouslySetInnerHTML={{ __html: desc }}
                      />
                    ) : (
                      <div className="space-y-2">
                        {desc.split('\n').filter(l => l.trim()).map((p, i) => (
                          <p key={i} className="text-sm text-gray-700 leading-relaxed">{p}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No description available.</p>
                )}

                {/* Score breakdown */}
                {previewResult.score_breakdown && Object.keys(previewResult.score_breakdown).length > 0 && (
                  <div>
                    <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Matching Rules</h3>
                    <div className="space-y-3">
                      <ScoreBreakdownChart
                        items={buildScoreBreakdownDisplayItems(previewResult.score_breakdown, previewResult.profile_id ? profiles.find(p => p.id === previewResult.profile_id) : undefined, previewJob).map(item => ({ key: item.key, score: item.score }))}
                        detailMap={Object.fromEntries(
                          buildScoreBreakdownDisplayItems(previewResult.score_breakdown, previewResult.profile_id ? profiles.find(p => p.id === previewResult.profile_id) : undefined, previewJob).map(item => [item.key, item.detail])
                        )}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-gray-100 flex flex-wrap items-center gap-2 shrink-0">
                {previewJob?.job_url && (
                  <a
                    href={previewJob.job_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    {previewResult.job_source === 'social' ? 'View Post' : 'Apply Now'} <ExternalLink size={13} />
                  </a>
                )}

                {savedJobIds.has(previewResult.job_id) ? (
                  <span className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-green-50 border border-green-200 text-green-600 cursor-default">
                    <BookmarkCheck size={13} /> Added
                  </span>
                ) : (
                  <button
                    onClick={() => addToSubmissionQueue(previewResult)}
                    disabled={savingJobId === previewResult.job_id}
                    className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl border border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-50"
                  >
                    {savingJobId === previewResult.job_id ? <Loader2 size={13} className="animate-spin" /> : <Bookmark size={13} />}
                    Submission Queue
                  </button>
                )}

                {queuedJobIds.has(previewResult.job_id) ? (
                  <span className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 cursor-default">
                    <CheckCircle2 size={13} /> Queued
                  </span>
                ) : (
                  <button
                    onClick={() => addToResumeAIQueue(previewResult)}
                    disabled={queuingJobId === previewResult.job_id}
                    className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100 hover:border-violet-300 transition-all disabled:opacity-50"
                  >
                    {queuingJobId === previewResult.job_id ? <Loader2 size={13} className="animate-spin" /> : <PenLine size={13} />}
                    Resume AI Queue
                  </button>
                )}

                {!previewResult.disqualified && (
                  <button
                    onClick={() => { disqualifyResult(previewResult); setPreviewResult(null); }}
                    disabled={disqualifyingJobId === previewResult.job_id}
                    className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-300 transition-all disabled:opacity-50"
                  >
                    <Ban size={13} /> Disqualify
                  </button>
                )}

                <button onClick={() => setPreviewResult(null)} className="ml-auto text-sm text-gray-400 hover:text-gray-600 px-3 py-2 rounded-xl hover:bg-gray-50 transition-colors">
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

