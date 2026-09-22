import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useNavigate, useParams, useLocation } from 'react-router-dom';
import {
  Activity,
  AtSign,
  Brain,
  Briefcase,
  Building2,
  Cloud,
  Code2,
  Copy,
  Database,
  BadgeCheck,
  Check,
  Clock3,
  DollarSign,
  Eye,
  FileText,
  Video,
  Handshake,
  Hash,
  Laptop,
  Layers,
  LayoutGrid,
  MapPin,
  PanelRight,
  Phone,
  Radar,
  RefreshCw,
  Send,
  Search,
  Share2,
  Shield,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Server,
  Sparkles,
  Paperclip,
  Pencil,
  Mail,
  Table2,
  Gauge,
  GraduationCap,
  Flame,
  Workflow,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import BulkAiSubmitBar from '../components/BulkAiSubmitBar';
import GmailIcon from '../components/GmailIcon';
import GmailConnectPrompt from '../components/GmailConnectPrompt';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase, supabaseAnonKey, supabaseFunctionsUrl, buildSupabaseFunctionHeaders } from '../lib/supabase';
import { HOTLIST_AI_SUGGESTIONS } from '../lib/hotlist-ai-suggestions';
import { buildScoreBreakdownDisplayItems } from '../lib/radar-match-ui';
import { shouldChargeCredits } from '../lib/feature-gates';
import { normalizePostSource, type PostSource } from '../lib/post-source';
import PostSourceBadge from '../components/PostSourceBadge';
import LeadKindPill from '../components/LeadKindPill';
import LeadAvatar from '../components/LeadAvatar';
import LocationChipInput from '../components/LocationChipInput';
import InsufficientCreditsModal from '../components/InsufficientCreditsModal';
import SubmitApplicationModal from '../components/SubmitApplicationModal';

type PulsePersona = {
  target_role: string;
  summary: string;
  active_watchers: number;
  avatar_url: string | null;
  rank: number;
  min_years_exp?: number | null;
  max_years_exp?: number | null;
  visa_status?: string | null;
  employment_type?: string | null;
  work_type?: string | null;
  preferred_locations?: string | null;
  min_rate_usd_per_hr?: number | null;
  max_rate_usd_per_hr?: number | null;
  priority_skills?: string | null;
  relocation_open?: boolean | null;
};

type SocialLead = {
  id: string;
  title: string;
  roleTitle?: string;
  location: string;
  company: string;
  posterName: string;
  posterEmail: string;
  posterPhone: string;
  postedAt: string;
  createdAt: string;
  matchedAt?: string;
  postedAgo: string;
  platform: string;
  matchScore: number | null;
  profileId: string | null;
  scoreBreakdown: Record<string, unknown> | null;
  snippet: string;
  employmentType: string;
  seniority: string;
  salaryRange: string;
  skills: string[];
  experienceYears: number | null;
  visaTypes: string[];
  hourlyRate: string;
  workType: string;
  consultantCount?: number;
  candidateIndex?: number;
  postSource: PostSource;
  authorAccountId: string | null;
  authorUserId: string | null;
  authorName: string | null;
  avatarUrl: string | null;
  kind: 'job' | 'hotlist';
  // Set only on AI Match results: the 1-10 fit score and the model's one-line
  // reason. Absent everywhere else, which is what keeps the badge off the feed.
  aiMatchScore?: number | null;
  aiMatchReason?: string | null;
  // Why the rules capped the score, when they did: a stated fact the two sides
  // disagree on, such as the job being USC-only.
  aiMatchRuleNote?: string | null;
};

function compareDetailsAndPostedDate(a: SocialLead, b: SocialLead): number {
  const hasMeaningfulValue = (value: string | null | undefined) => {
    const normalized = (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    return Boolean(normalized) && ![
      '-',
      'unknown',
      'not specified',
      'not available',
      'location not specified',
      'n/a',
      'na',
      'none',
      'null',
      'tbd',
    ].includes(normalized);
  };
  const rateAvailabilityDelta = Number(Boolean(b.hourlyRate.trim())) - Number(Boolean(a.hourlyRate.trim()));
  if (rateAvailabilityDelta !== 0) return rateAvailabilityDelta;
  const experienceAvailabilityDelta = Number(b.experienceYears != null) - Number(a.experienceYears != null);
  if (experienceAvailabilityDelta !== 0) return experienceAvailabilityDelta;
  const employmentTypeAvailabilityDelta = Number(hasMeaningfulValue(b.employmentType)) - Number(hasMeaningfulValue(a.employmentType));
  if (employmentTypeAvailabilityDelta !== 0) return employmentTypeAvailabilityDelta;
  const locationAvailabilityDelta = Number(hasMeaningfulValue(b.location)) - Number(hasMeaningfulValue(a.location));
  if (locationAvailabilityDelta !== 0) return locationAvailabilityDelta;
  const workTypeAvailabilityDelta = Number(hasMeaningfulValue(getBreakdownJobValue(b.scoreBreakdown, 'work_type_match')))
    - Number(hasMeaningfulValue(getBreakdownJobValue(a.scoreBreakdown, 'work_type_match')));
  if (workTypeAvailabilityDelta !== 0) return workTypeAvailabilityDelta;
  return new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime();
}

function extractPrimaryEmail(raw: string | null | undefined): string {
  // Recruiter posts often list more than one contact address (a primary plus
  // a backup) separated by commas/slashes/whitespace. The whole raw string
  // never matches a single-email pattern, which was silently disabling the
  // Request button for every lead with more than one email on file. Pick the
  // first token that actually looks like a single valid email instead.
  const candidates = (raw ?? '').split(/[,;/|\s]+/).map((part) => part.trim()).filter(Boolean);
  return candidates.find((candidate) => /^\S+@\S+\.\S+$/.test(candidate)) ?? '';
}

// The last AI Match run, per browser tab. sessionStorage rather than
// localStorage: results are a snapshot of a moving 30-day window and shouldn't
// resurface days later as if current. Wrapped because storage can be
// unavailable (private mode, blocked site data) and the page must work anyway.
const AI_MATCH_SESSION_KEY = 'pulse:ai-match:last-run';
// Recents are the descriptions themselves, not their results: results go stale
// as the 30-day window moves, whereas "match this consultant again" is exactly
// what people come back for. localStorage (not session) so they survive a new
// tab, and capped so the row stays a row.
const AI_MATCH_RECENTS_KEY = 'pulse:ai-match:recents';
const AI_MATCH_RECENTS_LIMIT = 8;
// How many matches a rematch keeps on screen across runs.
const AI_MATCH_MAX_KEPT_MATCHES = 50;
const AI_MATCH_MIN_DESCRIPTION_CHARS = 40;
// Mirrors RESULT_LIMIT in the ai-match function: each match returned costs a
// credit, so a full run costs this many.
const AI_MATCH_MAX_CREDITS_PER_RUN = 10;

type AiMatchSession = {
  description: string;
  target: 'jobs' | 'hotlist';
  rows: PulseSocialFeedRpcRow[];
};

// One of the user's own posts, reduced to what the sidebar needs: a label, a
// line of context and the text a match runs on.
type AiMatchOwnPost = { id: string; title: string; subtitle: string; description: string; status: string; createdAt: string };

type AiMatchRecent = {
  description: string;
  title: string;
  // Set when the run started from one of their own posts. Text alone is a poor
  // key: a bulk paste posts several consultants that all share it, and a run on
  // one of them matches on fields rather than on the pasted text.
  postId?: string;
  target: 'jobs' | 'hotlist';
  at: string;
  count: number;
  // The run's own rows, so a rematch can show what it found last time even for
  // matches that have since aged out of the 30-day window.
  rows?: PulseSocialFeedRpcRow[];
};

function readAiMatchRecents(): AiMatchRecent[] {
  try {
    const raw = window.localStorage.getItem(AI_MATCH_RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AiMatchRecent[];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item?.description === 'string') : [];
  } catch {
    return [];
  }
}

function writeAiMatchRecents(items: AiMatchRecent[]) {
  const capped = items.slice(0, AI_MATCH_RECENTS_LIMIT);
  // Rows are by far the bulk of this. On a quota error keep them only for the
  // newest runs, then drop them entirely: a recent without rows still refills
  // the box and rematches, it just can't show the old matches.
  const attempts = [
    capped,
    capped.map((item, index) => (index < 2 ? item : { ...item, rows: undefined })),
    capped.map((item) => ({ ...item, rows: undefined })),
  ];
  for (const attempt of attempts) {
    try {
      window.localStorage.setItem(AI_MATCH_RECENTS_KEY, JSON.stringify(attempt));
      return;
    } catch {
      // Try the next, smaller payload.
    }
  }
}

function readAiMatchSession(): AiMatchSession | null {
  try {
    const raw = window.sessionStorage.getItem(AI_MATCH_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AiMatchSession>;
    if (typeof parsed.description !== 'string' || !Array.isArray(parsed.rows)) return null;
    if (parsed.target !== 'jobs' && parsed.target !== 'hotlist') return null;
    return parsed as AiMatchSession;
  } catch {
    return null;
  }
}

function writeAiMatchSession(session: AiMatchSession) {
  try {
    window.sessionStorage.setItem(AI_MATCH_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Quota or disabled storage: the results are on screen; only restore-on-
    // refresh is lost.
  }
}

// Green for a strong fit, blue for a workable one, grey below that — the same
// three bands the scoring prompt defines.
function aiMatchScoreToneClass(score: number, isDark: boolean): string {
  if (score >= 8) return isDark ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (score >= 5) return isDark ? 'border-blue-400/30 bg-blue-500/10 text-blue-300' : 'border-blue-200 bg-blue-50 text-blue-700';
  return isDark ? 'border-white/15 bg-white/5 text-slate-400' : 'border-gray-200 bg-gray-50 text-gray-500';
}

function compareByRecency(a: SocialLead, b: SocialLead, feedTimeBasis: FeedTimeBasis): number {
  const aTs = new Date(feedTimeBasis === 'created' ? a.createdAt : a.postedAt).getTime();
  const bTs = new Date(feedTimeBasis === 'created' ? b.createdAt : b.postedAt).getTime();
  return bTs - aTs;
}

// The same three bands the scoring prompt defines and the score badge colours.
// Ordering by raw score buries a job posted an hour ago under one from three
// weeks back that scored a point higher, and in staffing the older one is
// often already filled — so recency decides within a band, never across one.
function aiMatchScoreBand(score: number | null | undefined): number {
  const value = Number(score ?? 0);
  if (value >= 8) return 2;
  if (value >= 5) return 1;
  return 0;
}

const AI_MATCH_BAND_LABELS: Record<number, string> = {
  2: 'Strong fit',
  1: 'Workable',
  0: 'Weak fit',
};

function compareByAiMatchScore(a: SocialLead, b: SocialLead, feedTimeBasis: FeedTimeBasis = 'posted'): number {
  const byBand = aiMatchScoreBand(b.aiMatchScore) - aiMatchScoreBand(a.aiMatchScore);
  if (byBand !== 0) return byBand;
  return compareByRecency(a, b, feedTimeBasis);
}

type HotlistRoleRow = {
  id: string;
  target_role: string;
  account_id: string;
  avatar_url: string | null;
  category?: string | null;
  min_years_exp?: number | null;
  max_years_exp?: number | null;
  visa_status?: string | null;
  employment_type?: string | null;
  work_type?: string | null;
  preferred_locations?: string | null;
  min_rate_usd_per_hr?: number | null;
  max_rate_usd_per_hr?: number | null;
  relocation_open?: boolean | null;
  priority_skills?: string | null;
  is_active: boolean;
  schedule_frequency: 'disabled' | 'hourly' | 'daily' | 'twice_daily' | 'weekly';
};

type LeaderboardRpcRow = {
  target_role: string;
  summary: string;
  active_watchers: number;
  avatar_url: string | null;
  rank: number;
};

type FallbackRoleRow = {
  target_role: string;
  category?: string | null;
  is_active: boolean;
  schedule_frequency: 'disabled' | 'hourly' | 'daily' | 'twice_daily' | 'weekly';
  avatar_url?: string | null;
  updated_at: string | null;
  min_years_exp?: number | null;
  max_years_exp?: number | null;
  visa_status?: string | null;
  employment_type?: string | null;
  work_type?: string | null;
  preferred_locations?: string | null;
  min_rate_usd_per_hr?: number | null;
  max_rate_usd_per_hr?: number | null;
  priority_skills?: string | null;
  relocation_open?: boolean | null;
};

type SocialJobRow = {
  id: string;
  platform: string;
  posted_by_name: string;
  poster_email: string;
  poster_phone: string;
  created_at: string;
  posted_at: string | null;
  job_title: string;
  company_name: string;
  location: string;
  post_content: string;
  extracted_role_normalized: string | null;
  employment_type: string;
  seniority_level: string;
  salary_range: string;
  extracted_skills: string[] | null;
  extracted_experience_years: number | null;
  extracted_visa_types: string[] | null;
  extracted_hourly_rate_min: number | null;
  extracted_hourly_rate_max: number | null;
  role_title?: string | null;
  core_skills?: string[] | null;
  years_experience?: number | null;
  visa_types?: string[] | null;
  employment_type_status?: string | null;
  work_type?: string | null;
  locations?: string[] | null;
  hourly_rate_min?: number | null;
  hourly_rate_max?: number | null;
  relocation_required?: boolean | null;
  post_source?: string | null;
  created_by_account_id?: string | null;
  created_by_user_id?: string | null;
  author_display_name?: string | null;
  avatar_url?: string | null;
};

type RadarSocialMatchRow = {
  id: string;
  profile_id: string;
  job_source: string;
  job_id: string;
  created_at: string;
  final_average_score: number | null;
  score_breakdown: Record<string, unknown> | null;
};

type PulseSocialFeedRpcRow = {
  lead_id: string;
  profile_id: string | null;
  match_created_at: string;
  final_average_score: number | null;
  score_breakdown: Record<string, unknown> | null;
  platform: string;
  posted_by_name: string;
  poster_email: string;
  poster_phone: string;
  social_created_at: string;
  posted_at: string | null;
  effective_posted_at?: string;
  job_title: string;
  company_name: string;
  location: string;
  post_content: string;
  extracted_role_normalized: string | null;
  employment_type: string;
  seniority_level: string;
  salary_range: string;
  extracted_skills: string[] | null;
  extracted_experience_years: number | null;
  extracted_visa_types: string[] | null;
  extracted_hourly_rate_min: number | null;
  extracted_hourly_rate_max: number | null;
  role_title?: string | null;
  core_skills?: string[] | null;
  years_experience?: number | null;
  visa_types?: string[] | null;
  employment_type_status?: string | null;
  work_type?: string | null;
  locations?: string[] | null;
  hourly_rate_min?: number | null;
  hourly_rate_max?: number | null;
  relocation_required?: boolean | null;
  post_source?: string | null;
  created_by_account_id?: string | null;
  created_by_user_id?: string | null;
  author_display_name?: string | null;
  avatar_url?: string | null;
  _kind?: 'jobs' | 'hotlist';
  ai_score?: number | null;
  ai_reason?: string | null;
  ai_rule_note?: string | null;
};

type PulseFeedCacheWorkerResponse = {
  rows?: PulseSocialFeedRpcRow[];
  cached?: boolean;
  refreshed_at?: string;
  truncated?: boolean;
  warning?: string;
};

type ProfileStats = {
  uniqueCompanies: number;
  uniqueVendors: number;
  uniqueJobs: number;
  avgMatchScore: number | null;
};

type ProfileRangeOption = {
  id: string;
  label: string;
  hours: number;
};

type ProfileCategoryTab = {
  id: string;
  label: string;
  icon: LucideIcon;
};

type MatchesTabId = 'all' | 'breakdown' | 'previewed' | 'asked' | 'verified' | 'queued';
type FeedTimeBasis = 'posted' | 'created';
type LeadActionType = 'revealed' | 'breakdown' | 'post_content_viewed' | 'ignored';

type AskedJobState = {
  requestedAt: string;
  fulfilledAt: string | null;
};

type GlobalAskedJobState = 'asked' | 'verified';
type AskAIPreview = {
  leadId: string;
  leadType: 'job' | 'hotlist';
  requestId: string;
  vendorName: string;
  vendorEmail: string;
  jobTitle: string;
  company: string;
  missingDetails: string[];
  emailSubject: string;
  emailContent: string;
  isGenerating: boolean;
};
type FeedSearchFilters = {
  experienceRange: string[];
  workType: string[];
  employmentType: string[];
  visaStatus: string[];
  location: string[];
  skillsQuery: string;
  rateMode: 'all' | 'has_rate' | 'range';
  rateMin: string;
  rateMax: string;
};

type FeedFacetCategory = 'experienceRange' | 'workType' | 'employmentType' | 'visaStatus';

// Cursor for the paged feed. Browsing keys off the last row's sort tuple;
// searching orders by FTS rank, which isn't keyset-able, so it pages by offset.
type FeedCursor = { postedAt: string | null; leadId: string | null; offset: number };

// The sidebar filters, in the shape the _v2 RPCs take. Empty means "no filter
// for this category", matching the empty-array short-circuit in
// matchesLeadFilters.
// Sidebar filters <-> query string. The multi-selects use repeated params
// rather than a comma-joined list because location values legitimately contain
// commas ("Austin, TX"), which a split would tear in half.
const FEED_FILTER_URL_KEYS = ['exp', 'work', 'emp', 'visa', 'loc', 'skills', 'rate', 'rmin', 'rmax'] as const;

function readFeedFiltersFromUrl(params: URLSearchParams): FeedSearchFilters {
  const rateMode = params.get('rate');
  return {
    experienceRange: params.getAll('exp'),
    workType: params.getAll('work'),
    employmentType: params.getAll('emp'),
    visaStatus: params.getAll('visa'),
    location: params.getAll('loc'),
    skillsQuery: params.get('skills') ?? '',
    rateMode: rateMode === 'has_rate' || rateMode === 'range' ? rateMode : 'all',
    rateMin: params.get('rmin') ?? '',
    rateMax: params.get('rmax') ?? '',
  };
}

function writeFeedFiltersToUrl(params: URLSearchParams, filters: FeedSearchFilters) {
  for (const key of FEED_FILTER_URL_KEYS) params.delete(key);
  for (const value of filters.experienceRange) params.append('exp', value);
  for (const value of filters.workType) params.append('work', value);
  for (const value of filters.employmentType) params.append('emp', value);
  for (const value of filters.visaStatus) params.append('visa', value);
  for (const value of filters.location) params.append('loc', value);
  if (filters.skillsQuery.trim()) params.set('skills', filters.skillsQuery.trim());
  if (filters.rateMode !== 'all') params.set('rate', filters.rateMode);
  if (filters.rateMode === 'range') {
    if (filters.rateMin) params.set('rmin', filters.rateMin);
    if (filters.rateMax) params.set('rmax', filters.rateMax);
  }
}

function buildFeedFilterArgs(filters: FeedSearchFilters) {
  const rateMin = Number(filters.rateMin);
  const rateMax = Number(filters.rateMax);
  return {
    p_experience_ranges: filters.experienceRange.length > 0 ? filters.experienceRange : null,
    p_work_types: filters.workType.length > 0 ? filters.workType : null,
    p_employment_types: filters.employmentType.length > 0 ? filters.employmentType : null,
    p_visa_statuses: filters.visaStatus.length > 0 ? filters.visaStatus : null,
    p_locations: filters.location.length > 0 ? filters.location : null,
    p_skills_query: filters.skillsQuery.trim() || null,
    p_rate_mode: filters.rateMode === 'all' ? null : filters.rateMode,
    p_rate_min: filters.rateMode === 'range' && Number.isFinite(rateMin) ? rateMin : null,
    p_rate_max: filters.rateMode === 'range' && Number.isFinite(rateMax) ? rateMax : null,
  };
}

async function getFunctionErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null) as { error?: unknown } | null;
      if (typeof payload?.error === 'string' && payload.error.trim()) return payload.error;
    }
  }
  return error instanceof Error && error.message !== 'Edge Function returned a non-2xx status code'
    ? error.message
    : fallback;
}

async function getFunctionErrorCode(error: unknown): Promise<string | null> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null) as { code?: unknown } | null;
      if (typeof payload?.code === 'string') return payload.code;
    }
  }
  return null;
}

const DEFAULT_FEED_SEARCH_FILTERS: FeedSearchFilters = {
  experienceRange: [],
  workType: [],
  employmentType: [],
  visaStatus: [],
  location: [],
  skillsQuery: '',
  rateMode: 'all',
  rateMin: '',
  rateMax: '',
};

type ParsedFeedSearchIntent = {
  roleQuery: string;
  inferred: Partial<FeedSearchFilters>;
};

type ExperienceRangeOption = {
  id: string;
  label: string;
  min: number;
  max: number | null;
};

type PulseLeadActionRow = {
  lead_id: string;
  action_type: LeadActionType;
  created_at?: string;
};

const LEADERBOARD_RPC_LIMIT = 500;
const FEED_WINDOW_HOURS = 48;
// Server page size. The feed no longer drains the window into the browser; it
// asks for this many rows at a time and keys the next request off the last row.
const FEED_PAGE_SIZE = 100;
// Profile stats and the leaderboard aggregate across *every* row in the window
// (buildRowMatchProfile / matchesPersonaProfile run per role, in JS), so
// letting them follow the 30-day picker would re-introduce exactly the
// full-window download the paged feed exists to remove. They stay pinned to
// 72h — the feed's default range before this change — so the numbers they show
// are the ones they show today.
const PROFILE_STATS_WINDOW_HOURS = 72;
const PULSE_ROWS_CACHE_TTL_MS = 30_000;
const PULSE_CACHE_WORKER_URL = (import.meta.env.VITE_PULSE_CACHE_WORKER_URL ?? '').trim();
const PULSE_CACHE_WORKER_TOKEN = (import.meta.env.VITE_PULSE_CACHE_WORKER_TOKEN ?? '').trim();
const TOP_PROFILES_PAGE_SIZE = 10;
const MATCHES_PAGE_SIZE = 5;
const DESKTOP_MATCHES_PAGE_SIZE = 12;

// AI Match takes a whole consultant or requirement, not a search phrase, so its
// examples are short pastes rather than keywords — they double as a hint about
// what to put in (skills, years, visa, rate, location).
const AI_MATCH_PLACEHOLDER_EXAMPLES: Record<'jobs' | 'hotlist', string[]> = {
  // Bench sales paste a consultant to find jobs.
  jobs: [
    'Sr. Java Full Stack Developer — 11 yrs, Spring Boot, React, AWS, Kafka. H1B, relocate, $65/hr C2C',
    'Salesforce Developer — 8 yrs, Apex, LWC, Service Cloud. GC, Dallas TX hybrid, $70/hr',
    'Data Engineer — 9 yrs, Snowflake, dbt, Airflow, Python. USC, remote, $75/hr',
    'DevOps Engineer — 7 yrs, AWS, Terraform, Kubernetes, Jenkins. H1B transfer, $68/hr C2C',
    'Power BI Developer — 6 yrs, DAX, SQL Server, Azure. EAD, Chicago onsite, $55/hr',
  ],
  // Vendors paste a requirement to find consultants.
  hotlist: [
    'Sr. Java Developer — Spring Boot, Microservices, AWS. 10+ yrs, Jersey City NJ hybrid, C2C',
    'Salesforce Developer — Apex, LWC, 8+ yrs, remote, USC/GC only, $70/hr W2',
    'Data Engineer — Snowflake, dbt, Python. 8+ yrs, Austin TX onsite, C2C $75/hr',
    'ServiceNow Developer — ITSM, 6+ yrs, remote, any visa, long term contract',
    'QA Automation Engineer — Selenium, Playwright, 5+ yrs, Charlotte NC, W2',
  ],
};

const SEARCH_PLACEHOLDER_EXAMPLES = [
  'Solutions Architect C2C $45',
  'React Developer remote W2',
  'Java Full Stack Developer C2C',
  'SAP FICO Consultant Texas',
  'DevOps Engineer H1B transfer',
  'Data Engineer Chicago hybrid $60/hr',
  'Salesforce Developer C2C $55',
  'QA Automation Engineer onsite',
  'AWS Cloud Architect contract',
  'Business Analyst OPT remote',
  'Network Engineer C2C Texas',
  'ServiceNow Developer remote',
];

type PulseLayoutMode = 'card' | 'table' | 'swipe' | 'detail';
type LeadTableSortKey = 'role' | 'exp' | 'workType' | 'empType' | 'rate' | 'visa' | 'location' | 'posted';

type PredictCategory = { label: string; earned: number; max: number; note: string };
type PredictResult = { score: number; categories: PredictCategory[]; verdict: string; verdictClass: string };

// Kill switch for the Swipe ("Pass"/"Pitch") layout — the feature is built
// and verified (typecheck/lint/build/tests) but hidden from the UI pending
// a manual pass on real gesture feel. Flip to true to re-expose it; nothing
// else needs to change.
const SWIPE_LAYOUT_ENABLED = false;

const PULSE_LAYOUT_MODE_STORAGE_KEY = 'profilepush-jobs-layout-mode';

function getInitialPulseLayoutMode(): PulseLayoutMode {
  if (typeof window === 'undefined') return 'detail';
  const stored = window.localStorage.getItem(PULSE_LAYOUT_MODE_STORAGE_KEY);
  return stored === 'table' ? 'table' : stored === 'card' ? 'card' : stored === 'swipe' && SWIPE_LAYOUT_ENABLED ? 'swipe' : 'detail';
}

const PROFILE_RANGE_OPTIONS: ProfileRangeOption[] = [
  { id: '24h', label: 'Last 24 hours', hours: 24 },
  { id: '3d', label: 'Last 3 days', hours: 72 },
  { id: '7d', label: 'Last 7 days', hours: 168 },
  { id: '15d', label: 'Last 15 days', hours: 360 },
  { id: '30d', label: 'Last 30 days', hours: 720 },
];

const PROFILE_RANGE_SHORT_LABELS: Record<ProfileRangeOption['id'], string> = {
  '24h': '24h',
  '3d': '3d',
  '7d': '7d',
  '15d': '15d',
  '30d': '30d',
};

const EXPERIENCE_RANGE_OPTIONS: ExperienceRangeOption[] = [
  { id: 'all', label: 'Experience', min: 0, max: null },
  { id: '1-3', label: '1-3', min: 1, max: 3 },
  { id: '3-5', label: '3-5', min: 3, max: 5 },
  { id: '5-7', label: '5-7', min: 5, max: 7 },
  { id: '7-9', label: '7-9', min: 7, max: 9 },
  { id: '9-12', label: '9-12', min: 9, max: 12 },
  { id: '12-15', label: '12-15', min: 12, max: 15 },
  { id: '15+', label: '15+', min: 15, max: null },
];

const WORK_TYPE_OPTIONS = [
  { value: 'all', label: 'Work Type' },
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'Onsite' },
];

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: 'all', label: 'Emp Type' },
  { value: 'full_time', label: 'Full-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'c2c', label: 'C2C' },
  { value: 'w2', label: 'W2' },
  { value: '1099', label: '1099' },
  { value: 'part_time', label: 'Part-time' },
];

const VISA_STATUS_OPTIONS = [
  { value: 'all', label: 'Visa' },
  { value: 'usc', label: 'USC' },
  { value: 'gc', label: 'GC' },
  { value: 'h1b', label: 'H1B' },
  { value: 'ead', label: 'EAD' },
  { value: 'opt', label: 'OPT' },
  { value: 'cpt', label: 'CPT' },
  { value: 'tn', label: 'TN' },
];

const PERSONA_SUMMARY_BY_ROLE = new Map(
  HOTLIST_AI_SUGGESTIONS.map((item) => [normalize(item.title), item.summary]),
);

const ROLE_SUGGESTION_HINTS: Array<{ test: RegExp; suggestionTitle: string }> = [
  { test: /full\s*stack|java|\.net|node|react/, suggestionTitle: 'Senior Full Stack Engineer' },
  { test: /data\s*engineer|data\s*developer|data\s*pipelin|etl|spark|airflow|analytics|sql/, suggestionTitle: 'Data Engineer' },
  { test: /python|fastapi|django|backend|api/, suggestionTitle: 'Backend Python Engineer' },
  { test: /frontend|front\s*end|ui|react|angular|vue/, suggestionTitle: 'Frontend React Engineer' },
  { test: /devops|sre|kubernetes|terraform|aws|cloud/, suggestionTitle: 'DevOps Engineer' },
  { test: /qa|automation|selenium|playwright|cypress/, suggestionTitle: 'QA Automation Engineer' },
  { test: /machine\s*learning|mlops|pytorch|tensorflow|llm|nlp/, suggestionTitle: 'Machine Learning Engineer' },
  { test: /security|iam|soc|cloud security/, suggestionTitle: 'Security Engineer' },
  { test: /solutions\s*architect|architect|system design/, suggestionTitle: 'Solutions Architect' },
  { test: /product\s*manager|roadmap|agile/, suggestionTitle: 'Product Manager' },
];

function normalize(input: string | null | undefined) {
  return (input ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function parseFeedSearchIntent(rawInput: string): ParsedFeedSearchIntent {
  let working = ` ${rawInput ?? ''} `;
  const inferred: Partial<FeedSearchFilters> = {};

  const consume = (pattern: RegExp, onMatch: (match: RegExpMatchArray) => void) => {
    const match = working.match(pattern);
    if (!match) return;
    onMatch(match);
    working = working.replace(match[0], ' ');
  };

  consume(/\b(c2c|corp\s*to\s*corp)\b/i, () => {
    inferred.employmentType = ['c2c'];
  });
  consume(/\b(w2|w-2)\b/i, () => {
    inferred.employmentType = ['w2'];
  });
  consume(/\b1099\b/i, () => {
    inferred.employmentType = ['1099'];
  });
  consume(/\bfull[\s-]?time\b|\bft\b/i, () => {
    inferred.employmentType = ['full_time'];
  });
  consume(/\bpart[\s-]?time\b|\bpt\b/i, () => {
    inferred.employmentType = ['part_time'];
  });
  consume(/\bcontract\b/i, () => {
    inferred.employmentType = ['contract'];
  });

  consume(/\bremote\b/i, () => {
    inferred.workType = ['remote'];
  });
  consume(/\bhybrid\b/i, () => {
    inferred.workType = ['hybrid'];
  });
  consume(/\bonsite\b|\bon\s*site\b|\bon-site\b/i, () => {
    inferred.workType = ['onsite'];
  });

  consume(/\b(usc|us\s*citizen)\b/i, () => {
    inferred.visaStatus = ['usc'];
  });
  consume(/\b(gc|green\s*card)\b/i, () => {
    inferred.visaStatus = ['gc'];
  });
  consume(/\b(h1b|h-1b)\b/i, () => {
    inferred.visaStatus = ['h1b'];
  });
  consume(/\bead\b/i, () => {
    inferred.visaStatus = ['ead'];
  });
  consume(/\bopt\b/i, () => {
    inferred.visaStatus = ['opt'];
  });
  consume(/\bcpt\b/i, () => {
    inferred.visaStatus = ['cpt'];
  });
  consume(/\btn\b/i, () => {
    inferred.visaStatus = ['tn'];
  });

  consume(/\$\s*(\d{2,4})\s*(?:-|to|–|—)\s*\$?\s*(\d{2,4})\b/i, (match) => {
    inferred.rateMode = 'range';
    inferred.rateMin = match[1];
    inferred.rateMax = match[2];
  });

  if (inferred.rateMode !== 'range') {
    consume(/(?:\$\s*)?(\d{2,4})\s*(?:\/\s*hr|per\s*hour|hourly|hr)?\b/i, (match) => {
      inferred.rateMode = 'range';
      inferred.rateMin = match[1];
      inferred.rateMax = '';
    });
  }

  const roleQuery = working
    .replace(/[^a-z0-9+/#\-\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return { roleQuery, inferred };
}

function mergeFeedFiltersWithIntent(base: FeedSearchFilters, inferred: Partial<FeedSearchFilters>): FeedSearchFilters {
  return {
    experienceRange: base.experienceRange,
    workType: base.workType.length > 0 ? base.workType : (inferred.workType ?? []),
    employmentType: base.employmentType.length > 0 ? base.employmentType : (inferred.employmentType ?? []),
    visaStatus: base.visaStatus.length > 0 ? base.visaStatus : (inferred.visaStatus ?? []),
    location: base.location,
    skillsQuery: base.skillsQuery,
    rateMode: base.rateMode !== 'all' ? base.rateMode : (inferred.rateMode ?? 'all'),
    rateMin: base.rateMin || inferred.rateMin || '',
    rateMax: base.rateMax || inferred.rateMax || '',
  };
}

function formatBreakdownFieldName(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/\bmatch\b/gi, '')
    .replace(/\bemployment\b/gi, 'Emp')
    .replace(/\bexperience\b/gi, 'Exp')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

type BreakdownDetail = {
  score?: number;
  candidate_value?: string;
  job_value?: string;
  rule?: string;
};

type PersonaDetailValue = {
  value: string;
  missing: boolean;
};

function getBreakdownJobValue(
  breakdown: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = breakdown?.[key];
  if (!value || typeof value !== 'object') return '';

  const detail = value as BreakdownDetail;
  return (detail.job_value ?? '').trim();
}

function firstMeaningfulValue(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const cleaned = (value ?? '').trim();
    if (cleaned && cleaned !== '-' && cleaned.toLowerCase() !== 'not specified') {
      return cleaned;
    }
  }
  return '-';
}

function formatPersonaDetailValue(value: string): PersonaDetailValue {
  const cleaned = (value ?? '').trim();
  if (!cleaned || cleaned === '-') {
    return { value: '', missing: true };
  }
  return { value: cleaned, missing: false };
}

function PersonaMissingTag() {
  return (
    <span
      className="inline-flex items-center justify-center text-[#64748B]"
      aria-label="Request the missing details by revealing the email"
      title="Request the missing details by revealing the email"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.2" opacity="0.9" />
        <path d="M5 2.8V5.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="5" cy="7.3" r="0.6" fill="currentColor" />
      </svg>
    </span>
  );
}

function parseFirstNumericValue(value: string) {
  const match = value.match(/(\d+(?:,\d{3})*(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseExperienceYears(value: string) {
  const matches = value.match(/\d+(?:\.\d+)?/g);
  if (!matches || matches.length === 0) return null;
  const numbers = matches.map(Number).filter((num) => Number.isFinite(num));
  if (numbers.length === 0) return null;
  if (value.includes('+')) return numbers[0];
  if (value.includes('-') && numbers.length >= 2) return (numbers[0] + numbers[1]) / 2;
  return numbers[0];
}

const CARD_PALETTE = [
  {
    border: 'border-blue-100',
    fill: 'bg-white dark:bg-[#1E2126]',
    titleColor: '#38BDF8',
  },
  {
    border: 'border-violet-100',
    fill: 'bg-white dark:bg-[#1E2126]',
    titleColor: '#FACC15',
  },
  {
    border: 'border-emerald-100',
    fill: 'bg-white dark:bg-[#1E2126]',
    titleColor: '#34D399',
  },
  {
    border: 'border-amber-100',
    fill: 'bg-white dark:bg-[#1E2126]',
    titleColor: '#FB7185',
  },
  {
    border: 'border-rose-100',
    fill: 'bg-white dark:bg-[#1E2126]',
    titleColor: '#C084FC',
  },
  {
    border: 'border-cyan-100',
    fill: 'bg-white dark:bg-[#1E2126]',
    titleColor: '#FB923C',
  },
];

// Pure breakdown-field helpers, hoisted out of PulsePage so the memoized
// LeadCard component (defined below, outside PulsePage) can call them
// without needing PulsePage's closure.
function isRoleLikeBreakdownKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    normalized.includes('role') ||
    normalized.includes('title') ||
    normalized.includes('name_match')
  );
}

function getPulseBreakdownOrder(key: string) {
  const normalized = key.toLowerCase();
  if (normalized.includes('experience') || normalized.includes('exp')) return 0;
  if (normalized.includes('work_type') || normalized.includes('work type')) return 1;
  if (normalized.includes('employment_type') || normalized.includes('employment type')) return 2;
  if (normalized.includes('rate') || normalized.includes('hourly')) return 3;
  if (normalized.includes('visa')) return 4;
  if (normalized.includes('location')) return 5;
  if (normalized.includes('skill')) return 6;
  return 999;
}

function orderPulseBreakdownItems<T extends { key: string }>(items: T[]) {
  return [...items].sort((a, b) => {
    const orderDelta = getPulseBreakdownOrder(a.key) - getPulseBreakdownOrder(b.key);
    if (orderDelta !== 0) return orderDelta;
    return a.key.localeCompare(b.key);
  });
}

// AI-populated fields (radar_match_results job_details, extracted_* columns)
// are occasionally malformed — a nested object instead of a plain number —
// which previously rendered as literal "[object Object]" text once
// string-interpolated. Every experienceYears/hourlyRate mapping site below
// routes raw values through this instead of trusting the declared type.
function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '' && Number.isFinite(Number(trimmed))) return Number(trimmed);
  }
  return null;
}

function normalizeBreakdownDisplayValue(value: string | null | undefined) {
  const cleaned = (value ?? '').trim();
  const normalized = cleaned.toLowerCase().replace(/\s+/g, ' ');
  if (!cleaned) return '-';
  if (
    normalized === 'unknown'
    || normalized === 'not specified'
    || normalized === 'not available'
    || normalized === 'n/a'
    || normalized === 'na'
    || normalized === 'none'
    || normalized === 'null'
    || normalized === '-'
    || normalized === '--'
    || normalized === 'tbd'
  ) {
    return '-';
  }
  return cleaned;
}

function normalizeHotlistWorkType(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[-_]+/g, ' ');
  if (/\bhybrid\b/.test(normalized)) return 'Hybrid';
  if (/\bremote\b/.test(normalized)) return 'Remote';
  if (/\bon\s*site\b|\bonsite\b/.test(normalized)) return 'Onsite';
  return '-';
}

function getLeadBreakdownFieldValues(lead: SocialLead, isHotlistFeed: boolean) {
  const inlineBreakdownItems = orderPulseBreakdownItems(buildScoreBreakdownDisplayItems(
    lead.scoreBreakdown as Record<string, number | { score: number; candidate_value: string; job_value: string; rule: string }> | undefined,
    undefined,
    {
      employment_type: lead.employmentType || null,
      work_type: null,
    },
  ).filter((item) => !isRoleLikeBreakdownKey(item.key)));
  // Self-submitted posts (post_source='user_post') never go through AI
  // matching, so scoreBreakdown is always empty for them — without a
  // fallback to the lead's own stored fields, every chip below would show
  // "-" even though the poster's real data (location, skills, experience,
  // visa, rate) is sitting right there on the lead.
  const getBreakdownValue = (matchers: string[], fallback?: string) => {
    const found = inlineBreakdownItems.find((item) => {
      const key = item.key.toLowerCase();
      return matchers.some((matcher) => key.includes(matcher));
    });
    const breakdownValue = normalizeBreakdownDisplayValue(found?.detail?.job_value);
    if (breakdownValue !== '-') return breakdownValue;
    return fallback ? normalizeBreakdownDisplayValue(fallback) : '-';
  };
  const expValue = getBreakdownValue(['experience', 'exp'], lead.experienceYears != null ? String(lead.experienceYears) : undefined);
  const rawWorkTypeValue = getBreakdownValue(['work_type', 'work type'], lead.workType || undefined);
  const workTypeValue = isHotlistFeed ? normalizeHotlistWorkType(rawWorkTypeValue) : rawWorkTypeValue;
  const employmentTypeValue = getBreakdownValue(['employment_type', 'employment type'], lead.employmentType || undefined);
  const rateValue = getBreakdownValue(['rate', 'hourly'], lead.hourlyRate || undefined);
  const visaValue = getBreakdownValue(['visa'], lead.visaTypes.length > 0 ? lead.visaTypes.join(', ') : undefined);
  const locationValue = getBreakdownValue(['location'], lead.location && lead.location !== 'Location not specified' ? lead.location : undefined);
  const skillsValue = getBreakdownValue(['skill'], lead.skills.length > 0 ? lead.skills.join(', ') : undefined);
  return { inlineBreakdownItems, expValue, workTypeValue, employmentTypeValue, rateValue, visaValue, locationValue, skillsValue };
}

function predictToneClass(score: number, isDark: boolean) {
  if (score >= 80) return isDark ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100';
  if (score >= 60) return isDark ? 'border-blue-400/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100';
  if (score >= 40) return isDark ? 'border-amber-400/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20' : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100';
  return isDark ? 'border-red-400/30 bg-red-500/10 text-red-300 hover:bg-red-500/20' : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100';
}

// A field value clamped to 2 lines with a "+N more"/"less" toggle, used inside
// LeadCard's breakdown grid. Takes isExpanded/onToggle as props (rather than
// closing over PulsePage's expandedFieldKeys state) so LeadCard can stay a
// pure, memoizable component.
function ClampedField({ value, linkClassName, isExpanded, onToggle }: {
  value: string;
  linkClassName: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const isMultiPart = value !== '-' && value.includes(',');
  const parts = isMultiPart ? value.split(',').map((part) => part.trim()).filter(Boolean) : [];
  const itemCap = 2;
  const collapsedParts = isMultiPart ? parts.slice(0, itemCap) : [];
  const hiddenCount = isMultiPart ? parts.length - collapsedParts.length : 0;
  const visibleParts = isExpanded ? parts : collapsedParts;
  const visibleText = isMultiPart ? visibleParts.join(', ') : value;

  // Real overflow detection (scrollHeight vs clientHeight) instead of a
  // fixed character-count guess — see ClampedSkills for why. Also, when
  // overflow does apply, the toggle button is nested INSIDE the clamped
  // span rather than after it as a sibling, since line-clamp's
  // display:-webkit-box always forces a following sibling onto a new line
  // even when the visible text's last line still has room.
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [isTextClamped, setIsTextClamped] = useState(false);
  useLayoutEffect(() => {
    if (isExpanded || value === '-') return;
    const el = textRef.current;
    if (!el) return;
    const measure = () => setIsTextClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isExpanded, visibleText, value]);

  if (value === '-') return <PersonaMissingTag />;
  const isLikelyOverflow = hiddenCount > 0 || isTextClamped;

  if (!isExpanded) {
    return (
      <span ref={textRef} className="line-clamp-2">
        {visibleText}
        {isLikelyOverflow && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(); }} className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}>
            {hiddenCount > 0 ? `+${hiddenCount} more` : 'more'}
          </button>
        )}
      </span>
    );
  }
  return (
    <>
      <span className="block max-h-14 overflow-y-auto">{visibleText}</span>
      {isLikelyOverflow && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onToggle(); }} className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}>
          {isMultiPart ? 'Show less' : 'less'}
        </button>
      )}
    </>
  );
}

// Comma-separated skills list clamped to `itemCap` items with a "+N more"
// toggle. Same isExpanded/onExpand/onCollapse-as-props shape as ClampedField,
// for the same memoization reason.
function ClampedSkills({ skillsValue, itemCap, linkClassName, isExpanded, onExpand, onCollapse }: {
  skillsValue: string;
  itemCap: number;
  linkClassName: string;
  isExpanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const skillsList = skillsValue === '-' ? [] : skillsValue.split(',').map((skill) => skill.trim()).filter(Boolean);
  const collapsedSkills = skillsList.slice(0, itemCap);
  const hiddenCount = skillsList.length - collapsedSkills.length;
  const visibleSkills = isExpanded ? skillsList : collapsedSkills;
  const visibleText = visibleSkills.join(', ');

  // Whether the 2-line clamp is actually cutting text off. A fixed
  // character-count guess doesn't track the card's real width (e.g. it
  // over-triggers once cards get wider, like on a 2-column desktop grid vs
  // 4-column), so measure the rendered span directly instead.
  const textRef = useRef<HTMLSpanElement | null>(null);
  const [isTextClamped, setIsTextClamped] = useState(false);
  useLayoutEffect(() => {
    if (isExpanded) return;
    const el = textRef.current;
    if (!el) return;
    const measure = () => setIsTextClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isExpanded, visibleText]);

  if (skillsList.length === 0) return <PersonaMissingTag />;
  const isLikelyOverflow = hiddenCount > 0 || isTextClamped;
  if (!isExpanded) {
    // The "+N more" link is nested INSIDE the clamped span, not after it as
    // a sibling — line-clamp renders as display:-webkit-box, which acts
    // like a block and always forces a following sibling onto its own new
    // line, even when the last visible line still has room. Keeping it as
    // trailing inline content of the same box lets it sit right at the end
    // of the visible text instead of wasting that leftover space.
    return (
      <span ref={textRef} className="line-clamp-2">
        {visibleText}
        {isLikelyOverflow && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onExpand(); }} className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}>
            {hiddenCount > 0 ? `+${hiddenCount} more` : 'more'}
          </button>
        )}
      </span>
    );
  }
  return (
    <>
      {/* Capped + scrollable when expanded so revealing a long skills list on
          one card can never grow that card's height — with the sibling
          grid row set to stretch-to-tallest, an uncapped reveal would
          visually inflate every other card in the same row too. */}
      <span className="block max-h-14 overflow-y-auto">{visibleText}</span>
      {isLikelyOverflow && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onCollapse(); }} className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}>
          Show less
        </button>
      )}
    </>
  );
}

function getLeadShareUrl(lead: SocialLead): string {
  return `${window.location.origin}/${lead.kind === 'hotlist' ? 'hotlist' : 'job'}/${lead.id}`;
}

// Records that this account shared this lead, for the Posts page's Shares
// column — same "one row per (account, lead, action)" convention as
// revealed/breakdown/post_content_viewed, so a repeat share by the same
// account doesn't inflate the count.
function recordLeadShare(leadId: string, accountId: string | null | undefined, userId: string | null | undefined) {
  if (!accountId) return;
  void supabase
    .from('pulse_lead_actions')
    .upsert(
      { account_id: accountId, user_id: userId ?? null, lead_id: leadId, action_type: 'shared' },
      { onConflict: 'account_id,user_id,lead_id,action_type', ignoreDuplicates: true },
    );
}

// Shared by both the card and table views — uses the native share sheet
// where available (mobile, some desktop browsers), otherwise copies the
// link and reports success via the returned boolean so the caller can show
// its own brief "Copied" feedback.
async function shareLead(lead: SocialLead, accountId: string | null | undefined, userId: string | null | undefined): Promise<boolean> {
  const url = getLeadShareUrl(lead);
  const title = lead.kind === 'hotlist' ? (lead.roleTitle || lead.title || 'Available Consultant') : (lead.title || 'Job Opportunity');
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      recordLeadShare(lead.id, accountId, userId);
      return false;
    } catch {
      // AbortError (user cancelled) or unsupported — fall through to copy.
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    recordLeadShare(lead.id, accountId, userId);
    return true;
  } catch {
    return false;
  }
}

interface LeadCardProps {
  lead: SocialLead;
  accountId: string | null | undefined;
  userId: string | null | undefined;
  paletteIndex: number;
  isDark: boolean;
  isHotlistFeed: boolean;
  feedTimeBasis: FeedTimeBasis;
  isLeadRevealed: boolean;
  globalAskedJobState: GlobalAskedJobState | undefined;
  predictResult: PredictResult | undefined;
  askedRequestedAt: string | undefined;
  askedFulfilledAt: string | null | undefined;
  revealedAt: string | undefined;
  isInlineBreakdownExpanded: boolean;
  isSkillsExpanded: boolean;
  isExpFieldExpanded: boolean;
  isWorkTypeFieldExpanded: boolean;
  isEmpTypeFieldExpanded: boolean;
  isRateFieldExpanded: boolean;
  isVisaFieldExpanded: boolean;
  isLocationFieldExpanded: boolean;
  isLoadingPreview: boolean;
  isProcessingAskAI: boolean;
  onPreview: (lead: SocialLead) => void;
  onAskAI: (lead: SocialLead) => void;
  onApply: (lead: SocialLead) => void;
  onToggleInlineBreakdown: (leadId: string) => void;
  onExpandSkills: (leadId: string) => void;
  onCollapseSkills: (leadId: string) => void;
  onToggleField: (cellKey: string) => void;
  // Detail-panel layout only: renders the exact same card content (skills,
  // chips, badges — nothing reinvented) but with the action bar swapped out
  // for the whole card being clickable, opening that lead in the panel.
  hideActions?: boolean;
  isSelected?: boolean;
  onSelect?: (lead: SocialLead) => void;
  // Bulk selection for AI Match results. Separate from isSelected, which is
  // the detail panel's "which lead is open" state.
  bulkSelectable?: boolean;
  isBulkSelected?: boolean;
  onToggleBulkSelect?: (lead: SocialLead) => void;
}

// Extracted out of PulsePage's renderLeadCards loop and wrapped in memo() so a
// card only re-renders when ITS OWN props change — previously every card in
// the visible list recomputed its full breakdown/palette/badges on every
// PulsePage render, including ones triggered by unrelated interactions
// elsewhere on the page (typing in search, hovering, etc).
const LeadCard = memo(function LeadCard({
  lead, accountId, userId, paletteIndex, isDark, isHotlistFeed, feedTimeBasis, isLeadRevealed, globalAskedJobState,
  predictResult, askedRequestedAt, askedFulfilledAt, revealedAt, isSkillsExpanded,
  isExpFieldExpanded, isWorkTypeFieldExpanded, isEmpTypeFieldExpanded, isRateFieldExpanded, isVisaFieldExpanded, isLocationFieldExpanded,
  isLoadingPreview, isProcessingAskAI,
  onPreview, onAskAI, onApply, onToggleInlineBreakdown, onExpandSkills, onCollapseSkills, onToggleField,
  hideActions, isSelected, onSelect,
  bulkSelectable, isBulkSelected, onToggleBulkSelect,
}: LeadCardProps) {
  const cardPalette = CARD_PALETTE[paletteIndex % CARD_PALETTE.length];
  const cardFillClass = cardPalette.fill;
  const titleToneStyle = { color: isDark ? '#FFFFFF' : '#2563EB' };
  const [justCopiedShare, setJustCopiedShare] = useState(false);
  const isAskPending = globalAskedJobState === 'asked';
  const isVerified = globalAskedJobState === 'verified';
  const canAskAI = !isAskPending && !isVerified && Boolean(extractPrimaryEmail(lead.posterEmail));
  const {
    expValue,
    workTypeValue,
    employmentTypeValue,
    rateValue,
    visaValue,
    locationValue,
    skillsValue,
  } = getLeadBreakdownFieldValues(lead, isHotlistFeed);
  const skillsValueClass = isDark ? 'text-[#CBD5E1]' : 'text-slate-700';
  const linkClassName = isDark ? 'text-blue-300' : 'text-blue-600';

  const actionButtonsBar = (
    <div className="mt-auto flex items-stretch divide-x divide-gray-200 border-t border-gray-200 dark:divide-white/10 dark:border-white/10">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); void shareLead(lead, accountId, userId).then((copied) => { if (copied) { setJustCopiedShare(true); setTimeout(() => setJustCopiedShare(false), 1500); } }); }}
        title="Share this post"
        className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 bg-gray-50 text-gray-600 transition-colors hover:bg-gray-100 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/5"
      >
        {justCopiedShare ? <Check size={17} strokeWidth={1.75} /> : <Share2 size={17} strokeWidth={1.75} />}
        <span className="text-[12px] font-normal">{justCopiedShare ? 'Copied' : 'Share'}</span>
      </button>
      {lead.kind === 'job' && lead.postSource === 'user_post' ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onApply(lead); }}
          title="Submit a consultant to this job"
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 bg-blue-50 text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20"
        >
          <Mail size={15} strokeWidth={1.75} />
          <span className="text-[12px] font-normal">AI Submit</span>
        </button>
      ) : isAskPending || isVerified ? (
        <span
          title={isVerified ? 'Verified' : (isHotlistFeed ? 'Requested' : 'Submitted')}
          className={`inline-flex h-9 flex-1 items-center justify-center ${isVerified ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'}`}
        >
          {isVerified ? <BadgeCheck size={17} strokeWidth={1.75} /> : <Check size={17} strokeWidth={1.75} />}
        </span>
      ) : (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onAskAI(lead); }}
          disabled={!canAskAI || isProcessingAskAI}
          title={!lead.posterEmail ? 'No email' : (lead.postSource === 'user_post' ? 'Request' : isHotlistFeed ? 'AI Invite for Video Screening' : 'AI Submit')}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 bg-blue-50 text-blue-600 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20"
        >
          {isProcessingAskAI ? <LogoSpinner size={14} /> : lead.postSource === 'user_post' ? (
            <>
              <FileText size={15} strokeWidth={1.75} />
              <span className="text-[12px] font-normal">Request</span>
            </>
          ) : (
            <>
              {/* A hotlist action now invites the consultant to a video
                  screening rather than asking for a resume, so it carries the
                  video icon; a job gets the email icon, since AI Submit sends
                  the recruiter an email. */}
              {isHotlistFeed ? <Video size={15} strokeWidth={1.75} /> : <Mail size={15} strokeWidth={1.75} />}
              <span className="text-[12px] font-normal">{isHotlistFeed ? 'AI Invite' : 'AI Submit'}</span>
            </>
          )}
        </button>
      )}
    </div>
  );

  return (
    <div
      role={hideActions ? 'button' : undefined}
      tabIndex={hideActions ? 0 : undefined}
      onClick={hideActions ? () => onSelect?.(lead) : undefined}
      onKeyDown={hideActions ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(lead); } } : undefined}
      className={`relative flex ${hideActions ? 'h-auto' : 'h-full'} min-w-0 flex-col overflow-hidden rounded-lg border ${isSelected ? 'border-blue-400 ring-1 ring-blue-200' : 'border-[#dfdad2] dark:border-white/10'} ${cardFillClass} ${hideActions ? 'cursor-pointer' : ''}`}
    >
      <LeadKindPill kind={lead.kind} variant="banner" />
      <div className="min-w-0 flex-1 px-3 pt-2.5 pb-2">
      <div className={bulkSelectable ? 'flex items-stretch gap-2' : undefined}>
        {bulkSelectable && (
          // Top left, ahead of the title, and stretched so it stands against
          // both the title row and the score/summary row beneath it. Away from
          // the action bar on purpose: a mis-tap down there fires AI Submit
          // and spends a credit.
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleBulkSelect?.(lead); }}
            aria-pressed={Boolean(isBulkSelected)}
            title={isBulkSelected ? 'Selected for bulk send' : 'Select for bulk send'}
            className={`flex w-8 shrink-0 items-center justify-center self-stretch rounded-md border transition-colors ${
              isBulkSelected
                ? 'border-blue-500 bg-blue-500 text-white'
                : 'border-gray-300 bg-white/60 text-gray-300 hover:border-blue-400 hover:text-blue-500 dark:border-white/15 dark:bg-white/[0.03] dark:text-gray-500'
            }`}
          >
            <Check size={15} strokeWidth={2.5} />
          </button>
        )}
        <div className="min-w-0 flex-1 pr-14">
          {hideActions ? (
            // Detail layout: the whole card selects the lead and the post opens
            // in the pane beside it, so the title stays plain text there.
            <p className="text-[13px] font-semibold leading-snug" style={titleToneStyle}>{lead.title || (isHotlistFeed ? 'Available Consultant' : 'Job Opportunity')}</p>
          ) : (
            // The title is the way to open the original post; it replaced the
            // separate Preview button and calls the same handler, so the
            // one-time preview charge and the modal behave exactly as before.
            lead.kind === 'hotlist' ? (
              // A consultant's original post is a bulk hotlist of ten people;
              // the card's own parsed fields are the useful view.
              <p className="text-[13px] font-semibold leading-snug" style={titleToneStyle}>
                {lead.title || 'Available Consultant'}
              </p>
            ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onPreview(lead); }}
              disabled={isLoadingPreview}
              title="Open post"
              className="text-left text-[13px] font-semibold leading-snug underline-offset-2 hover:underline disabled:cursor-wait"
              style={titleToneStyle}
            >
              {lead.title || (isHotlistFeed ? 'Available Consultant' : 'Job Opportunity')}
              {isLoadingPreview && <span className="ml-1.5 inline-block align-middle"><LogoSpinner size={11} /></span>}
            </button>
            )
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1">
              {lead.aiMatchScore != null && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${aiMatchScoreToneClass(lead.aiMatchScore, isDark)}`}
                  title="AI fit score"
                >
                  <Sparkles size={9} strokeWidth={2.5} />
                  {lead.aiMatchScore}/10
                </span>
              )}
              {lead.aiMatchReason && (
                // Beside the score and in the product's gradient, so the
                // sentence reads as the AI's verdict on this card rather than
                // as more of the post's own text.
                <span className="inline-flex min-w-0 items-center gap-1 text-[11px] leading-snug">
                  <Sparkles size={10} strokeWidth={2.5} className="shrink-0 text-indigo-500 dark:text-indigo-300" />
                  <span className="min-w-0 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text font-medium text-transparent dark:from-blue-300 dark:via-indigo-300 dark:to-violet-300">
                    {lead.aiMatchReason}
                  </span>
                </span>
              )}
              {lead.postSource === 'user_post' && <PostSourceBadge source={lead.postSource} />}
              {predictResult && (
                <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${predictToneClass(predictResult.score, isDark)}`}>
                  <Gauge size={9} strokeWidth={2.5} />
                  {isHotlistFeed ? 'Match' : 'Predicted'} {predictResult.score}%
                </span>
              )}
              {(isAskPending || isVerified) && (
                <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${isVerified ? (isDark ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700') : (isDark ? 'border-blue-400/30 bg-blue-500/10 text-blue-300' : 'border-blue-200 bg-blue-50 text-blue-700')}`}>
                  {isVerified ? <BadgeCheck size={9} strokeWidth={2.5} /> : <Check size={9} strokeWidth={2.5} />}
                  {(() => {
                    const stampIso = isVerified ? (askedFulfilledAt ?? askedRequestedAt) : askedRequestedAt;
                    const label = isVerified ? 'Verified' : (isHotlistFeed ? 'Asked' : 'Submitted');
                    return stampIso ? `${label} ${formatAgoCompact(stampIso)}` : label;
                  })()}
                </span>
              )}
              {isLeadRevealed && (
                <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${isDark ? 'border-white/15 bg-white/5 text-slate-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                  <AtSign size={9} strokeWidth={2.5} />
                  Revealed{revealedAt ? ` ${formatAgoCompact(revealedAt)}` : ''}
                </span>
              )}
            </div>
          {lead.aiMatchRuleNote && (
            // The score was capped by a stated fact, not by the model's read of
            // the text, so it is called out rather than folded into the reason.
            <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              <Shield size={9} strokeWidth={2.5} />
              {lead.aiMatchRuleNote}
            </p>
          )}
        </div>
      </div>
      {(() => {
        const chipFields = [
          { key: 'exp', value: expValue, isExpanded: isExpFieldExpanded, icon: GraduationCap, title: 'Experience' },
          { key: 'workType', value: workTypeValue, isExpanded: isWorkTypeFieldExpanded, icon: Laptop, title: 'Work type' },
          { key: 'empType', value: employmentTypeValue, isExpanded: isEmpTypeFieldExpanded, icon: Briefcase, title: 'Employment type' },
          { key: 'rate', value: rateValue, isExpanded: isRateFieldExpanded, icon: DollarSign, title: 'Rate' },
          { key: 'visa', value: visaValue, isExpanded: isVisaFieldExpanded, icon: Shield, title: 'Visa' },
          { key: 'location', value: locationValue, isExpanded: isLocationFieldExpanded, icon: MapPin, title: 'Location' },
        ].filter((field) => field.value !== '-');
        if (chipFields.length === 0 && skillsValue === '-') return null;
        return (
        <div className="mt-1.5 min-w-0 rounded-md px-2.5 py-2 text-left bg-transparent">
          {(() => {
            if (chipFields.length === 0) return null;
            return (
              <div className="flex flex-wrap items-center gap-1">
                {chipFields.map((field) => (
                  <span
                    key={field.key}
                    title={field.title}
                    className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] leading-tight ${isDark ? 'border-white/10 bg-white/5 text-[#CBD5E1]' : 'border-gray-200 bg-gray-50 text-slate-700'}`}
                  >
                    <field.icon size={10} className={isDark ? 'shrink-0 text-[#94A3B8]' : 'shrink-0 text-gray-400'} />
                    <ClampedField value={field.value} linkClassName={linkClassName} isExpanded={field.isExpanded} onToggle={() => onToggleField(`${lead.id}:${field.key}`)} />
                  </span>
                ))}
              </div>
            );
          })()}
          {skillsValue !== '-' && (
            <button
              type="button"
              onClick={() => onToggleInlineBreakdown(lead.id)}
              title="Skills"
              className="mt-2 w-full rounded-md py-1.5 text-left focus:outline-none bg-transparent"
            >
              <div className={`text-[10px] leading-tight break-words ${skillsValueClass}`}>
                <ClampedSkills
                  skillsValue={skillsValue}
                  itemCap={8}
                  linkClassName={linkClassName}
                  isExpanded={isSkillsExpanded}
                  onExpand={() => onExpandSkills(lead.id)}
                  onCollapse={() => onCollapseSkills(lead.id)}
                />
              </div>
            </button>
          )}
        </div>
        );
      })()}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-[#94A3B8]">
        <span className="inline-flex items-center gap-1">
          <LeadAvatar avatarUrl={lead.avatarUrl} name={lead.posterName} size={14} />
          {lead.posterName}
        </span>
        {lead.company && (
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <span>•</span>
            <Building2 size={10} className="shrink-0 text-gray-400" />
            <span className="text-[#94A3B8]">{lead.company}</span>
          </span>
        )}
        <span className="whitespace-nowrap">•</span>
        <span className="whitespace-nowrap">{feedTimeBasis === 'created' ? 'Added ' : ''}{formatAgo(feedTimeBasis === 'created' ? lead.createdAt : lead.postedAt)}</span>
      </div>
      </div>
      {!hideActions && actionButtonsBar}
    </div>
  );
});

const SWIPE_COMMIT_THRESHOLD_PX = 120;
const SWIPE_FLY_OFF_MS = 240;

interface SwipeDeckProps {
  leads: SocialLead[];
  buildLeadCardProps: (lead: SocialLead, paletteIndex: number) => LeadCardProps;
  isHotlistFeed: boolean;
  onPass: (lead: SocialLead) => void;
  onPitch: (lead: SocialLead) => void;
}

// Single-card "Pass"/"Pitch" view: always shows leads[0]. Acting on the top
// lead (ignoring it, or asking/chatting about it) removes it from the
// caller's feed array on the next render, so the next lead surfaces
// automatically — no separate queue-index state needed here.
const SwipeDeck = memo(function SwipeDeck({ leads, buildLeadCardProps, isHotlistFeed, onPass, onPitch }: SwipeDeckProps) {
  const [dragging, setDragging] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [leavingCard, setLeavingCard] = useState<{ lead: SocialLead; direction: 'left' | 'right' } | null>(null);
  const dragStartXRef = useRef<number | null>(null);

  useEffect(() => {
    if (!leavingCard) return;
    const timer = setTimeout(() => setLeavingCard(null), SWIPE_FLY_OFF_MS + 20);
    return () => clearTimeout(timer);
  }, [leavingCard]);

  const commit = (lead: SocialLead, direction: 'left' | 'right') => {
    setLeavingCard({ lead, direction });
    setDragX(0);
    if (direction === 'left') onPass(lead);
    else onPitch(lead);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (leavingCard) return;
    dragStartXRef.current = event.clientX;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || dragStartXRef.current == null) return;
    const delta = event.clientX - dragStartXRef.current;
    if (Math.abs(delta) < 4) return;
    setDragX(delta);
  };

  const endDrag = (displayLead: SocialLead | undefined) => {
    if (!dragging) return;
    setDragging(false);
    dragStartXRef.current = null;
    if (displayLead && Math.abs(dragX) >= SWIPE_COMMIT_THRESHOLD_PX) {
      commit(displayLead, dragX > 0 ? 'right' : 'left');
    } else {
      setDragX(0);
    }
  };

  if (leads.length === 0 && !leavingCard) {
    return (
      <div className="flex h-full flex-col items-center justify-center py-16 text-center text-gray-400">
        <CheckSquare size={22} className="mb-2 opacity-40" />
        <p className="text-[13px] font-medium">{isHotlistFeed ? 'No consultants waiting' : 'No jobs waiting'}</p>
        <p className="mt-0.5 text-[12px] opacity-70">You're all caught up</p>
      </div>
    );
  }

  const displayLead = leavingCard?.lead ?? leads[0];
  const cardProps = displayLead ? buildLeadCardProps(displayLead, 0) : null;

  const transform = leavingCard
    ? `translateX(${leavingCard.direction === 'right' ? '160%' : '-160%'}) rotate(${leavingCard.direction === 'right' ? 24 : -24}deg)`
    : `translateX(${dragX}px) rotate(${dragX / 20}deg)`;
  const transition = leavingCard
    ? `transform ${SWIPE_FLY_OFF_MS}ms ease-in, opacity ${SWIPE_FLY_OFF_MS}ms ease-in`
    : dragging ? 'none' : 'transform 200ms ease-out';
  const passOpacity = !leavingCard && dragX < 0 ? Math.min(1, Math.abs(dragX) / SWIPE_COMMIT_THRESHOLD_PX) : 0;
  const pitchOpacity = !leavingCard && dragX > 0 ? Math.min(1, dragX / SWIPE_COMMIT_THRESHOLD_PX) : 0;

  return (
    <div className="mx-auto flex h-full w-full max-w-md flex-col items-center justify-center gap-4 py-2">
      <div
        className="relative w-full touch-none select-none"
        style={{ transform, transition, opacity: leavingCard ? 0 : 1 }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => endDrag(displayLead)}
        onPointerCancel={() => { setDragging(false); dragStartXRef.current = null; setDragX(0); }}
      >
        <div
          className="pointer-events-none absolute left-3 top-3 z-10 -rotate-12 rounded border-2 border-red-500 px-2 py-0.5 text-[15px] font-extrabold uppercase tracking-wide text-red-500"
          style={{ opacity: passOpacity }}
        >
          Pass
        </div>
        <div
          className="pointer-events-none absolute right-3 top-3 z-10 rotate-12 rounded border-2 border-emerald-500 px-2 py-0.5 text-[15px] font-extrabold uppercase tracking-wide text-emerald-500"
          style={{ opacity: pitchOpacity }}
        >
          Pitch
        </div>
        {cardProps && <LeadCard {...cardProps} />}
      </div>

      {displayLead && (
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => commit(displayLead, 'left')}
            disabled={Boolean(leavingCard)}
            aria-label="Pass"
            className="inline-flex h-14 w-14 items-center justify-center rounded-full border-2 border-red-200 bg-white text-red-500 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-400/30 dark:bg-[#1E2126] dark:text-red-400 dark:hover:bg-red-500/10"
          >
            <X size={24} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => commit(displayLead, 'right')}
            disabled={Boolean(leavingCard)}
            aria-label="Pitch"
            className="inline-flex h-14 w-14 items-center justify-center rounded-full border-2 border-emerald-200 bg-white text-emerald-500 shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-400/30 dark:bg-[#1E2126] dark:text-emerald-400 dark:hover:bg-emerald-500/10"
          >
            <Handshake size={22} strokeWidth={2.5} />
          </button>
        </div>
      )}
    </div>
  );
});

function matchesExperienceRange(years: number | null, rangeId: string) {
  if (rangeId === 'all') return true;
  if (years == null) return false;

  const range = EXPERIENCE_RANGE_OPTIONS.find((item) => item.id === rangeId);
  if (!range) return true;
  if (range.max == null) return years >= range.min;
  return years >= range.min && years <= range.max;
}

function canonicalizeRoleForUniqueness(role: string) {
  return normalize(role)
    .replace(/\b(senior|sr\.?|junior|jr\.?|lead|principal|staff|ii|iii|iv)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getStablePortraitUrl(seed: string) {
  return `https://i.pravatar.cc/120?u=${encodeURIComponent(seed)}`;
}

function RecommendedBadge() {
  const [played, setPlayed] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setPlayed(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border border-blue-200 bg-white/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-700 transition-all duration-700 ${played ? 'translate-y-0 scale-100 opacity-100' : '-translate-y-1 scale-95 opacity-0'}`}
    >
      <span className={`inline-flex items-center transition-transform duration-700 ${played ? 'rotate-0' : '-rotate-12'}`}>
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="2.4" cy="3.2" r="1.1" fill="#facc15" />
          <circle cx="2.4" cy="7.4" r="1.1" fill="#f97316" />
          <polyline points="5.1,2.4 8.8,5.5 5.1,8.6" stroke="#2563eb" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span>Recommended</span>
    </span>
  );
}

const DEFAULT_PERSONA_AVATARS: Record<string, string> = {
  'senior full stack engineer': 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=120&h=120&q=80',
  'backend python engineer': 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&h=120&q=80',
  'data engineer': 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=120&h=120&q=80',
  'devops engineer': 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=120&h=120&q=80',
  'qa automation engineer': 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=120&h=120&q=80',
  'product manager': 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=120&h=120&q=80',
  'frontend react engineer': 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=120&h=120&q=80',
  'machine learning engineer': 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=120&h=120&q=80',
  'security engineer': 'https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=120&h=120&q=80',
  'solutions architect': 'https://images.unsplash.com/photo-1544723795-3fb6469f5b39?auto=format&fit=crop&w=120&h=120&q=80',
};

const PROFESSIONAL_AVATAR_FALLBACK_URL = getStablePortraitUrl('profilepush-default');

const PROFILE_CATEGORY_TABS: ProfileCategoryTab[] = [
  {
    id: 'all',
    label: 'All',
    icon: Radar,
  },
  {
    id: 'front-end',
    label: 'Front-End',
    icon: Code2,
  },
  {
    id: 'backend',
    label: 'Backend',
    icon: Server,
  },
  {
    id: 'data',
    label: 'Data',
    icon: Database,
  },
  {
    id: 'security',
    label: 'Security',
    icon: Shield,
  },
  {
    id: 'crm',
    label: 'CRM',
    icon: Handshake,
  },
  {
    id: 'qa',
    label: 'QA',
    icon: CheckSquare,
  },
  {
    id: 'biz-dev',
    label: 'Biz Dev',
    icon: Workflow,
  },
  {
    id: 'ai',
    label: 'AI',
    icon: Sparkles,
  },
  {
    id: 'ml',
    label: 'ML',
    icon: Brain,
  },
  {
    id: 'devops',
    label: 'DevOps',
    icon: Cloud,
  },
];

const CATEGORY_ACCENT_CLASSES: Record<string, { text: string; textMuted: string; border: string; borderMuted: string; bg: string; bgMuted: string }> = {
  all: { text: 'text-slate-200', textMuted: 'text-slate-400', border: 'border-slate-600/70', borderMuted: 'border-slate-700/80', bg: 'bg-slate-500/10', bgMuted: 'bg-slate-950/40' },
  'front-end': { text: 'text-blue-300', textMuted: 'text-blue-400/80', border: 'border-blue-500/30', borderMuted: 'border-blue-500/40', bg: 'bg-blue-500/10', bgMuted: 'bg-blue-950/20' },
  backend: { text: 'text-violet-300', textMuted: 'text-violet-400/80', border: 'border-violet-500/30', borderMuted: 'border-violet-500/40', bg: 'bg-violet-500/10', bgMuted: 'bg-violet-950/20' },
  data: { text: 'text-emerald-300', textMuted: 'text-emerald-400/80', border: 'border-emerald-500/30', borderMuted: 'border-emerald-500/40', bg: 'bg-emerald-500/10', bgMuted: 'bg-emerald-950/20' },
  security: { text: 'text-rose-300', textMuted: 'text-rose-400/80', border: 'border-rose-500/30', borderMuted: 'border-rose-500/40', bg: 'bg-rose-500/10', bgMuted: 'bg-rose-950/20' },
  crm: { text: 'text-cyan-300', textMuted: 'text-cyan-400/80', border: 'border-cyan-500/30', borderMuted: 'border-cyan-500/40', bg: 'bg-cyan-500/10', bgMuted: 'bg-cyan-950/20' },
  qa: { text: 'text-amber-300', textMuted: 'text-amber-400/80', border: 'border-amber-500/30', borderMuted: 'border-amber-500/40', bg: 'bg-amber-500/10', bgMuted: 'bg-amber-950/20' },
  'biz-dev': { text: 'text-orange-300', textMuted: 'text-orange-400/80', border: 'border-orange-500/30', borderMuted: 'border-orange-500/40', bg: 'bg-orange-500/10', bgMuted: 'bg-orange-950/20' },
  ai: { text: 'text-fuchsia-300', textMuted: 'text-fuchsia-400/80', border: 'border-fuchsia-500/30', borderMuted: 'border-fuchsia-500/40', bg: 'bg-fuchsia-500/10', bgMuted: 'bg-fuchsia-950/20' },
  ml: { text: 'text-teal-300', textMuted: 'text-teal-400/80', border: 'border-teal-500/30', borderMuted: 'border-teal-500/40', bg: 'bg-teal-500/10', bgMuted: 'bg-teal-950/20' },
  devops: { text: 'text-cyan-300', textMuted: 'text-cyan-400/80', border: 'border-cyan-500/30', borderMuted: 'border-cyan-500/40', bg: 'bg-cyan-500/10', bgMuted: 'bg-cyan-950/20' },
};

function isPersonaInCategory(persona: PulsePersona, categoryId: string) {
  if (categoryId === 'all') return true;
  return inferRoleCategoryId(persona.target_role) === categoryId;
}

function getCategoryAccent(categoryId: string) {
  return CATEGORY_ACCENT_CLASSES[categoryId] ?? CATEGORY_ACCENT_CLASSES.all;
}

function getCategoryTabClass(categoryId: string, selected: boolean, darkMode: boolean) {
  if (!darkMode) {
    return selected
      ? 'border-blue-200 bg-blue-50/80 text-gray-900 shadow-[0_0_0_1px_rgba(37,99,235,0.16)]'
      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-800';
  }

  switch (categoryId) {
    case 'front-end':
      return selected
        ? 'border-blue-500/40 bg-blue-950/30 text-blue-300 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]'
        : 'border-blue-500/30 bg-blue-500/10 text-blue-400/80 hover:border-blue-500/40 hover:text-blue-300';
    case 'backend':
      return selected
        ? 'border-violet-500/40 bg-violet-950/30 text-violet-300 shadow-[0_0_0_1px_rgba(139,92,246,0.18)]'
        : 'border-violet-500/30 bg-violet-500/10 text-violet-400/80 hover:border-violet-500/40 hover:text-violet-300';
    case 'data':
      return selected
        ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300 shadow-[0_0_0_1px_rgba(16,185,129,0.18)]'
        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400/80 hover:border-emerald-500/40 hover:text-emerald-300';
    case 'security':
      return selected
        ? 'border-rose-500/40 bg-rose-950/30 text-rose-300 shadow-[0_0_0_1px_rgba(244,63,94,0.18)]'
        : 'border-rose-500/30 bg-rose-500/10 text-rose-400/80 hover:border-rose-500/40 hover:text-rose-300';
    case 'crm':
      return selected
        ? 'border-cyan-500/40 bg-cyan-950/30 text-cyan-300 shadow-[0_0_0_1px_rgba(34,211,238,0.18)]'
        : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400/80 hover:border-cyan-500/40 hover:text-cyan-300';
    case 'qa':
      return selected
        ? 'border-amber-500/40 bg-amber-950/30 text-amber-300 shadow-[0_0_0_1px_rgba(245,158,11,0.18)]'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-400/80 hover:border-amber-500/40 hover:text-amber-300';
    case 'biz-dev':
      return selected
        ? 'border-orange-500/40 bg-orange-950/30 text-orange-300 shadow-[0_0_0_1px_rgba(249,115,22,0.18)]'
        : 'border-orange-500/30 bg-orange-500/10 text-orange-400/80 hover:border-orange-500/40 hover:text-orange-300';
    case 'ai':
      return selected
        ? 'border-fuchsia-500/40 bg-fuchsia-950/30 text-fuchsia-300 shadow-[0_0_0_1px_rgba(217,70,239,0.18)]'
        : 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-400/80 hover:border-fuchsia-500/40 hover:text-fuchsia-300';
    case 'ml':
      return selected
        ? 'border-teal-500/40 bg-teal-950/30 text-teal-300 shadow-[0_0_0_1px_rgba(20,184,166,0.18)]'
        : 'border-teal-500/30 bg-teal-500/10 text-teal-400/80 hover:border-teal-500/40 hover:text-teal-300';
    case 'devops':
      return selected
        ? 'border-cyan-500/40 bg-cyan-950/30 text-cyan-300 shadow-[0_0_0_1px_rgba(34,211,238,0.18)]'
        : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400/80 hover:border-cyan-500/40 hover:text-cyan-300';
    case 'all':
    default:
      return selected
        ? 'border-slate-600/70 bg-slate-950/60 text-slate-200 shadow-[0_0_0_1px_rgba(100,116,139,0.16)]'
        : 'border-slate-700/80 bg-slate-950/40 text-slate-400 hover:border-slate-600/80 hover:text-slate-200';
  }
}

function getTechStackClass(categoryId: string, active: boolean, darkMode: boolean) {
  if (!darkMode) {
    return active
      ? 'border-blue-300 bg-blue-50 text-blue-700'
      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-800';
  }

  switch (categoryId) {
    case 'front-end':
      return active
        ? 'border-blue-500/40 bg-blue-950/30 text-blue-300'
        : 'border-blue-500/30 bg-blue-500/10 text-blue-400/80 hover:border-blue-500/40 hover:text-blue-300';
    case 'backend':
      return active
        ? 'border-violet-500/40 bg-violet-950/30 text-violet-300'
        : 'border-violet-500/30 bg-violet-500/10 text-violet-400/80 hover:border-violet-500/40 hover:text-violet-300';
    case 'data':
      return active
        ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300'
        : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400/80 hover:border-emerald-500/40 hover:text-emerald-300';
    case 'security':
      return active
        ? 'border-rose-500/40 bg-rose-950/30 text-rose-300'
        : 'border-rose-500/30 bg-rose-500/10 text-rose-400/80 hover:border-rose-500/40 hover:text-rose-300';
    case 'crm':
      return active
        ? 'border-cyan-500/40 bg-cyan-950/30 text-cyan-300'
        : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400/80 hover:border-cyan-500/40 hover:text-cyan-300';
    case 'qa':
      return active
        ? 'border-amber-500/40 bg-amber-950/30 text-amber-300'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-400/80 hover:border-amber-500/40 hover:text-amber-300';
    case 'biz-dev':
      return active
        ? 'border-orange-500/40 bg-orange-950/30 text-orange-300'
        : 'border-orange-500/30 bg-orange-500/10 text-orange-400/80 hover:border-orange-500/40 hover:text-orange-300';
    case 'ai':
      return active
        ? 'border-fuchsia-500/40 bg-fuchsia-950/30 text-fuchsia-300'
        : 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-400/80 hover:border-fuchsia-500/40 hover:text-fuchsia-300';
    case 'ml':
      return active
        ? 'border-teal-500/40 bg-teal-950/30 text-teal-300'
        : 'border-teal-500/30 bg-teal-500/10 text-teal-400/80 hover:border-teal-500/40 hover:text-teal-300';
    case 'devops':
      return active
        ? 'border-cyan-500/40 bg-cyan-950/30 text-cyan-300'
        : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400/80 hover:border-cyan-500/40 hover:text-cyan-300';
    case 'all':
    default:
      return active
        ? 'border-slate-600/70 bg-slate-950/60 text-slate-200'
        : 'border-slate-700/80 bg-slate-950/40 text-slate-400 hover:border-slate-600/80 hover:text-slate-200';
  }
}

function getRoleRowAccentClass(index: number, darkMode: boolean) {
  if (!darkMode) return 'text-gray-900';

  switch (index % 6) {
    case 0: return 'text-blue-300';
    case 1: return 'text-violet-300';
    case 2: return 'text-emerald-300';
    case 3: return 'text-amber-300';
    case 4: return 'text-rose-300';
    default: return 'text-cyan-300';
  }
}

// Tech stacks per category for second-level filtering
const CATEGORY_TECH_STACKS: Record<string, string[]> = {
  'front-end': ['React', 'Angular', 'Vue', 'TypeScript', 'Next.js', 'Tailwind', 'Svelte'],
  'backend': ['Node.js', 'Python', 'Java', '.NET', 'Go', 'Ruby', 'Spring Boot', 'FastAPI'],
  'data': ['SQL', 'Spark', 'Airflow', 'Snowflake', 'Databricks', 'Kafka', 'ETL', 'Power BI'],
  'security': ['Cloud Security', 'IAM', 'SOC', 'Penetration Testing', 'SIEM', 'Zero Trust'],
  'crm': ['Salesforce', 'HubSpot', 'Dynamics 365', 'Zoho', 'ServiceNow'],
  'qa': ['Selenium', 'Playwright', 'Cypress', 'JUnit', 'TestNG', 'Appium', 'SDET'],
  'biz-dev': ['Agile', 'Scrum', 'JIRA', 'Roadmapping', 'Analytics', 'Stakeholder Mgmt'],
  'ai': ['LLM', 'GPT', 'NLP', 'Prompt Engineering', 'RAG', 'LangChain', 'OpenAI'],
  'ml': ['PyTorch', 'TensorFlow', 'MLOps', 'Scikit-learn', 'Deep Learning', 'Computer Vision'],
  'devops': ['AWS', 'Kubernetes', 'Terraform', 'Docker', 'CI/CD', 'Azure', 'GCP', 'Jenkins'],
};

function getDefaultPersonaAvatarUrl(role: string) {
  const key = normalize(role);
  return DEFAULT_PERSONA_AVATARS[key] ?? getStablePortraitUrl(`role-${key || 'unknown'}`);
}

function getRoleFallbackAvatarUrl(role: string) {
  return getStablePortraitUrl(`role-fallback-${normalize(role) || 'unknown'}`);
}

function inferRoleCategoryId(role: string, summary?: string | null) {
  const text = normalize(`${role} ${summary ?? ''}`);
  if (/front\s*end|frontend|react|ui|angular|vue/.test(text)) return 'front-end';
  if (/backend|api|node|python|fastapi|django/.test(text)) return 'backend';
  if (/data|spark|airflow|etl|analytics|sql/.test(text)) return 'data';
  if (/security|iam|soc|cloud security/.test(text)) return 'security';
  if (/crm|salesforce|hubspot|zoho|customer relationship/.test(text)) return 'crm';
  if (/qa|automation|selenium|playwright|cypress/.test(text)) return 'qa';
  if (/business development|biz dev|partnership|sales|account executive|revenue/.test(text)) return 'biz-dev';
  if (/machine learning|mlops|pytorch|tensorflow|model/.test(text)) return 'ml';
  if (/\bai\b|llm|nlp|prompt/.test(text)) return 'ai';
  if (/devops|sre|kubernetes|terraform|aws|cloud/.test(text)) return 'devops';
  return 'all';
}

function findSuggestionForRole(role: string) {
  const roleKey = normalize(role);
  const exact = HOTLIST_AI_SUGGESTIONS.find((item) => normalize(item.title) === roleKey);
  if (exact) return exact;

  const inferred = ROLE_SUGGESTION_HINTS.find((item) => item.test.test(roleKey));
  if (!inferred) return null;

  return HOTLIST_AI_SUGGESTIONS.find((item) => normalize(item.title) === normalize(inferred.suggestionTitle)) ?? null;
}

function getPersonaDisplayTitle(role: string) {
  const suggestion = findSuggestionForRole(role);
  if (suggestion) return suggestion.title;

  return role
    .replace(/\b(multiple|various|several|seeking|candidate|resume|roles?)\b/gi, ' ')
    .replace(/[\[\]{}()/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(it)\b/gi, 'IT');
}

function getPersonaBucket(role: string) {
  const inferredSuggestion = findSuggestionForRole(role);
  if (inferredSuggestion) {
    return {
      title: inferredSuggestion.title,
      key: normalize(inferredSuggestion.title),
      summary: inferredSuggestion.summary,
    };
  }

  const canonicalTitle = getPersonaDisplayTitle(role);
  const canonicalKey = normalize(canonicalTitle);
  const suggestion = HOTLIST_AI_SUGGESTIONS.find((item) => normalize(item.title) === canonicalKey);
  return {
    title: suggestion?.title ?? canonicalTitle,
    key: canonicalKey,
    summary: suggestion?.summary ?? PERSONA_SUMMARY_BY_ROLE.get(canonicalKey) ?? '',
  };
}

function getPersonaDetailColumns(persona: PulsePersona) {
  const minYears = persona.min_years_exp;
  const maxYears = persona.max_years_exp;
  const minRate = persona.min_rate_usd_per_hr;
  const maxRate = persona.max_rate_usd_per_hr;

  const rateRange = (minRate || maxRate)
    ? `$${minRate ?? '?'}-$${maxRate ?? '?'}`
    : '-';

  return {
    experience: (minYears != null && maxYears != null)
      ? `${minYears}-${maxYears} yrs`
      : '-',
    visaStatus: persona.visa_status ?? '-',
    employmentType: persona.employment_type ?? '-',
    workType: persona.work_type ?? '-',
    location: persona.preferred_locations ?? '-',
    rateRange,
    relocation: persona.relocation_open ? 'Yes' : 'No',
    skills: persona.priority_skills ?? '-',
  };
}

function formatAgo(dateIso: string) {
  const ts = new Date(dateIso).getTime();
  if (Number.isNaN(ts)) return 'just now';
  const diffMs = Date.now() - ts;
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} mins ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hrs ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

function formatAgoCompact(dateIso: string) {
  const ts = new Date(dateIso).getTime();
  if (Number.isNaN(ts)) return 'now';
  const diffMs = Date.now() - ts;
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatRevealedAt(dateIso: string) {
  const ts = new Date(dateIso);
  if (Number.isNaN(ts.getTime())) return '';
  return ts.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function removeNameFromEmail(text: string, name: string) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return text;
  const escapedName = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escapedName, 'gi'), 'there');
}

function hasDirectContact(row: SocialJobRow) {
  return Boolean((row.poster_email ?? '').trim() || (row.poster_phone ?? '').trim());
}

function dedupeText(input: string | null | undefined) {
  return normalize(input ?? '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSocialLeadDedupKey(row: SocialJobRow) {
  const title = dedupeText(row.job_title);
  const company = dedupeText(row.company_name);
  const poster = dedupeText(row.posted_by_name);
  const email = dedupeText(row.poster_email);
  const phone = dedupeText(row.poster_phone);
  const location = dedupeText(row.location);

  if (email || phone) {
    return [title, company, email || '-', phone || '-'].join('|');
  }

  return [title, company, location || '-', poster || '-'].join('|');
}

function buildPulseLeadDedupKey(lead: SocialLead, isHotlistFeed: boolean) {
  const title = dedupeText(lead.title);
  const company = dedupeText(lead.company);
  const location = dedupeText(lead.location);
  const platform = dedupeText(lead.platform);

  if (isHotlistFeed) {
    // Hotlist posts routinely share the same role/company/location across many
    // different consultants (e.g. a staffing company posting several distinct
    // "Network Engineer" candidates in the same day) — collapsing on those
    // fields alone silently hides genuinely different candidates. A single
    // "HOTLIST" post can also list several consultants at once; those rows
    // share identical post content and poster identity but carry a distinct
    // candidate_index per consultant, so that's the real differentiator
    // between candidates named in the same post. Fold in poster identity and
    // candidate index so only true reposts of the same candidate collapse.
    const email = dedupeText(lead.posterEmail);
    const poster = dedupeText(lead.posterName);
    const candidateSlot = lead.candidateIndex != null ? String(lead.candidateIndex) : lead.id;
    return [title, company, location || '-', platform || '-', email || poster || '-', candidateSlot].join('|');
  }

  return [title, company, location || '-', platform || '-'].join('|');
}

// roleMatchesPersona used to re-normalize the SAME persona role/skills (and,
// at its worst call site, the SAME row's title/content) on every single
// iteration of an O(personas x rows) loop — this was the single largest
// contributor to a multi-second blocking task on every page load (profiled:
// ~2.5s in normalize() alone, ~1s in this function, ~1s in the regex it
// uses internally). Split into profile-builders (run once per persona and
// once per row) plus a cheap comparison, so a caller looping over many
// personas x rows can hoist both sides out of the inner loop. The original
// signature is kept as a thin wrapper for callers that only ever check one
// persona against one row, where hoisting wouldn't matter.
type PersonaMatchProfile = { roleText: string; personaBucketKey: string; roleTokens: string[]; normalizedSkills: string[] };
type RowMatchProfile = { titleText: string; fullText: string; rowBucketKey: string };

function buildPersonaMatchProfile(personaRole: string, personaSkills: string[]): PersonaMatchProfile {
  return {
    roleText: normalize(personaRole),
    personaBucketKey: getPersonaBucket(personaRole).key,
    roleTokens: canonicalizeRoleForUniqueness(personaRole)
      .split(' ')
      .filter((token) => token.length >= 3 && !['engineer', 'developer', 'senior', 'lead', 'staff', 'principal'].includes(token)),
    normalizedSkills: personaSkills.map((skill) => normalize(skill)),
  };
}

function buildRowMatchProfile(row: SocialJobRow): RowMatchProfile {
  const titleText = normalize(`${row.extracted_role_normalized ?? ''} ${row.job_title ?? ''}`);
  return {
    titleText,
    fullText: normalize(`${titleText} ${row.post_content ?? ''}`),
    rowBucketKey: getPersonaBucket(`${row.extracted_role_normalized ?? ''} ${row.job_title ?? ''}`).key,
  };
}

function matchesPersonaProfile(row: RowMatchProfile, persona: PersonaMatchProfile): boolean {
  if (!row.fullText) return false;
  if (row.fullText.includes(persona.roleText)) return true;
  if (persona.personaBucketKey && row.rowBucketKey && persona.personaBucketKey === row.rowBucketKey) return true;

  const { roleTokens } = persona;
  const titleRoleHits = roleTokens.reduce((count, token) => count + (row.titleText.includes(token) ? 1 : 0), 0);
  const fullRoleHits = roleTokens.reduce((count, token) => count + (row.fullText.includes(token) ? 1 : 0), 0);
  const skillHits = persona.normalizedSkills.reduce((count, skill) => count + (row.fullText.includes(skill) ? 1 : 0), 0);

  if (roleTokens.length > 0) {
    if (titleRoleHits >= Math.min(2, roleTokens.length)) return true;
    if (fullRoleHits >= Math.min(2, roleTokens.length) && skillHits >= 1) return true;
    return false;
  }

  return skillHits >= 2;
}

function roleMatchesPersona(row: SocialJobRow, personaRole: string, personaSkills: string[]) {
  return matchesPersonaProfile(buildRowMatchProfile(row), buildPersonaMatchProfile(personaRole, personaSkills));
}

function getPersonaSkillList(role: string, personaSkills?: string | null) {
  const skillStr = personaSkills ?? findSuggestionForRole(role)?.skills;
  if (!skillStr) return [];
  return skillStr.split(',').map((item) => item.trim()).filter(Boolean);
}

// Same shape/logic as buildRowMatchProfile above, adapted to SocialLead's
// field names (title/roleTitle/snippet/skills) instead of the raw
// social_jobs row's (job_title/extracted_role_normalized/post_content) —
// lets a feed lead be matched against a market_pulse persona/snapshot row
// with the exact same cheap comparison function.



function buildSeedLeaderboard(): PulsePersona[] {
  return HOTLIST_AI_SUGGESTIONS
    .map((item, idx) => ({
      target_role: item.title,
      summary: item.summary,
      active_watchers: 0,
      avatar_url: null,
      rank: idx + 1,
      min_years_exp: item.minYearsExp,
      max_years_exp: item.maxYearsExp,
      visa_status: item.visaStatus,
      employment_type: item.employmentType,
      work_type: item.workType,
      preferred_locations: item.locations,
      min_rate_usd_per_hr: item.minRate,
      max_rate_usd_per_hr: item.maxRate,
      priority_skills: item.skills,
      relocation_open: item.relocationOpen,
    }));
}

function buildFallbackLeaderboardFromRoles(
  rows: FallbackRoleRow[] | null | undefined,
): PulsePersona[] {
  const counts = new Map<string, number>();
  const avatarByRole = new Map<string, { url: string; updatedAt: number }>();
  const titleByKey = new Map<string, string>();
  const summaryByKey = new Map<string, string>();
  const detailsByKey = new Map<string, Omit<FallbackRoleRow, 'target_role' | 'category' | 'is_active' | 'schedule_frequency' | 'avatar_url' | 'updated_at'>>();

  for (const row of rows ?? []) {
    const bucket = getPersonaBucket(row.target_role);
    if (!bucket.key) continue;
    titleByKey.set(bucket.key, bucket.title);
    summaryByKey.set(bucket.key, bucket.summary);

    if (row.is_active && row.schedule_frequency !== 'disabled') {
      counts.set(bucket.key, (counts.get(bucket.key) ?? 0) + 1);
    }

    const avatar = (row.avatar_url ?? '').trim();
    if (avatar) {
      const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : 0;
      const prev = avatarByRole.get(bucket.key);
      if (!prev || updatedAt >= prev.updatedAt) {
        avatarByRole.set(bucket.key, { url: avatar, updatedAt });
      }
    }

    if (!detailsByKey.has(bucket.key) && (row.min_years_exp != null || row.visa_status != null || row.priority_skills != null)) {
      detailsByKey.set(bucket.key, {
        min_years_exp: row.min_years_exp,
        max_years_exp: row.max_years_exp,
        visa_status: row.visa_status,
        employment_type: row.employment_type,
        work_type: row.work_type,
        preferred_locations: row.preferred_locations,
        min_rate_usd_per_hr: row.min_rate_usd_per_hr,
        max_rate_usd_per_hr: row.max_rate_usd_per_hr,
        priority_skills: row.priority_skills,
        relocation_open: row.relocation_open,
      });
    }
  }

  const seenKeys = new Set<string>();
  const result: PulsePersona[] = [];

  for (const row of rows ?? []) {
    const bucket = getPersonaBucket(row.target_role);
    if (!bucket.key || seenKeys.has(bucket.key)) continue;
    seenKeys.add(bucket.key);

    const details = detailsByKey.get(bucket.key);
    result.push({
      target_role: bucket.title,
      summary: summaryByKey.get(bucket.key) ?? PERSONA_SUMMARY_BY_ROLE.get(bucket.key) ?? bucket.summary,
      active_watchers: counts.get(bucket.key) ?? 0,
      avatar_url: avatarByRole.get(bucket.key)?.url ?? null,
      rank: 0,
      ...details,
    });
  }

  for (const suggestion of HOTLIST_AI_SUGGESTIONS) {
    const key = normalize(suggestion.title);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    result.push({
      target_role: suggestion.title,
      summary: suggestion.summary,
      active_watchers: 0,
      avatar_url: null,
      rank: 0,
      min_years_exp: suggestion.minYearsExp,
      max_years_exp: suggestion.maxYearsExp,
      visa_status: suggestion.visaStatus,
      employment_type: suggestion.employmentType,
      work_type: suggestion.workType,
      preferred_locations: suggestion.locations,
      min_rate_usd_per_hr: suggestion.minRate,
      max_rate_usd_per_hr: suggestion.maxRate,
      priority_skills: suggestion.skills,
      relocation_open: suggestion.relocationOpen,
    });
  }

  return result
    .sort((a, b) => b.active_watchers - a.active_watchers || a.target_role.localeCompare(b.target_role))
    .map((item, idx) => ({ ...item, rank: idx + 1 }));
}

function buildWatchlistPayloadFromRole(accountId: string, role: HotlistRoleRow, userId?: string | null) {
  const roleTitle = role.target_role.trim();

  return {
    account_id: accountId,
    source_hotlist_role_id: role.id,
    target_role: roleTitle,
    category: role.category,
    min_years_exp: role.min_years_exp,
    max_years_exp: role.max_years_exp,
    visa_status: role.visa_status,
    employment_type: role.employment_type,
    work_type: role.work_type,
    preferred_locations: role.preferred_locations,
    min_rate_usd_per_hr: role.min_rate_usd_per_hr,
    max_rate_usd_per_hr: role.max_rate_usd_per_hr,
    relocation_open: role.relocation_open,
    priority_skills: role.priority_skills,
    avatar_url: role.avatar_url,
    schedule_frequency: role.schedule_frequency,
    is_watching: true,
    created_by: userId ?? null,
    updated_at: new Date().toISOString(),
  };
}

function buildHotlistRolePayloadFromPersona(accountId: string, persona: PulsePersona) {
  const suggestion = findSuggestionForRole(persona.target_role);
  const roleTitle = persona.target_role.trim();
  const minYears = persona.min_years_exp ?? suggestion?.minYearsExp ?? 3;
  const maxYears = persona.max_years_exp ?? suggestion?.maxYearsExp ?? Math.max(minYears + 3, 6);

  return {
    account_id: accountId,
    target_role: roleTitle,
    category: inferRoleCategoryId(roleTitle, persona.summary ?? suggestion?.summary ?? ''),
    min_years_exp: minYears,
    max_years_exp: maxYears,
    visa_status: persona.visa_status ?? suggestion?.visaStatus ?? 'USC',
    employment_type: persona.employment_type ?? suggestion?.employmentType ?? 'Full Time',
    work_type: persona.work_type ?? suggestion?.workType ?? 'Remote',
    preferred_locations: persona.preferred_locations ?? suggestion?.locations ?? 'Remote',
    min_rate_usd_per_hr: persona.min_rate_usd_per_hr ?? suggestion?.minRate ?? 60,
    max_rate_usd_per_hr: persona.max_rate_usd_per_hr ?? suggestion?.maxRate ?? 95,
    relocation_open: persona.relocation_open ?? suggestion?.relocationOpen ?? false,
    priority_skills: persona.priority_skills ?? suggestion?.skills ?? '',
    avatar_url: persona.avatar_url,
    schedule_frequency: 'daily' as const,
    is_active: true,
  };
}


type PulsePageProps = {
  feedKind?: 'jobs' | 'hotlist' | 'feed';
  // AI Match mode: the same page, cards and actions, but the list comes from
  // the ai-match function (a pasted description scored against the last 30
  // days) instead of the paged feed.
  aiMatch?: boolean;
};

export default function PulsePage({ feedKind = 'jobs', aiMatch = false }: PulsePageProps) {
  const { account, user, refreshAccount } = useAuth();
  const { isDark } = useTheme();
  const isHotlistFeed = feedKind === 'hotlist';
  // Where this page's own routes live: opening, closing and auto-selecting a
  // lead must stay inside AI Match rather than bouncing the user to /feed.
  const feedBasePath = aiMatch ? '/match' : '/feed';
  const isCombinedFeed = feedKind === 'feed';
  // Per-lead kind check: in combined mode every lead carries its own
  // job/hotlist kind, so callers acting on a specific lead must derive from
  // it instead of the page-level isHotlistFeed flag (which only applies to
  // the standalone /jobs and /hotlist modes).
  const leadIsHotlist = useCallback(
    (lead: SocialLead) => (isCombinedFeed ? lead.kind === 'hotlist' : isHotlistFeed),
    [isCombinedFeed, isHotlistFeed],
  );
  const canSelectFeedTimeBasis = user?.email?.toLowerCase() === 'poornapotluri27@gmail.com';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activatingRole, setActivatingRole] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<PulsePersona[]>([]);
  const [watchingRoles, setWatchingRoles] = useState<Set<string>>(new Set());
  const [activePersona, setActivePersona] = useState<PulsePersona | null>(null);
  const [feed, setFeed] = useState<SocialLead[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  // Paging state for the server-side feed. feedCursorRef is a ref, not state,
  // because appending a page must not race a second "load more" triggered by
  // the same scroll gesture — the guard has to be readable synchronously.
  const feedCursorRef = useRef<FeedCursor | null>(null);
  const feedPageInFlightRef = useRef(false);
  // The scroll handlers are declared ~2000 lines above loadMoreFeedPage (which
  // can't move, because it depends on loadFeed). They call it through this ref
  // rather than closing over a binding that is still in its temporal dead zone
  // at that point in the render.
  // One cursor per page start, so Previous can re-fetch an earlier page.
  // Index 0 is always null (the first page needs no cursor).
  const feedCursorStackRef = useRef<Array<FeedCursor | null>>([null]);
  // The pagination bar renders far above where these are defined (they depend
  // on loadFeed), so it calls them through refs rather than closing over
  // bindings still in their temporal dead zone at that point in the render.
  const goToNextFeedPageRef = useRef<() => Promise<void>>(async () => {});
  const goToPrevFeedPageRef = useRef<() => Promise<void>>(async () => {});
  const [feedPageIndex, setFeedPageIndex] = useState(0);
  // Read once on mount and consumed by the feed loader effect. A ref, not
  // state, because it must not itself trigger a render or a second fetch.
  const pendingRestorePageRef = useRef<number | null>((() => {
    const raw = Number(new URLSearchParams(window.location.search).get('page'));
    return Number.isFinite(raw) && raw > 1 ? Math.floor(raw) - 1 : null;
  })());
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedPageLoading, setFeedPageLoading] = useState(false);
  // AI Match. The description is kept per tab so a refresh keeps what was
  // typed; the last run's results are restored the same way (see
  // AI_MATCH_SESSION_KEY) so reloading the page never costs a second credit.
  const [aiMatchDescription, setAiMatchDescription] = useState(
    () => readAiMatchSession()?.description ?? '',
  );
  const [aiMatchRunning, setAiMatchRunning] = useState(false);
  // Live progress from the streaming ai-match run, so a ~13s wait shows real
  // counts instead of a bare spinner.
  const [aiMatchProgress, setAiMatchProgress] = useState<string | null>(null);
  // What the last run did, shown above the results: without it people see a
  // list of cards with no idea what was searched or how many came back.
  const [aiMatchSummary, setAiMatchSummary] = useState<{ returned: number; fresh: number | null; scanned: number; best: number | null; credits: number; posted: number; matchedFor: string | null; saved?: boolean } | null>(null);
  // Which of the account's own posts this run was started from, when it was
  // started from one at all. A screening invitation needs a job to attach to,
  // and a run from pasted text has none.
  const [aiMatchRunPostId, setAiMatchRunPostId] = useState<string | null>(null);
  const [aiMatchFromTitle, setAiMatchFromTitle] = useState('');
  const [aiMatchRecents, setAiMatchRecents] = useState<AiMatchRecent[]>(() => readAiMatchRecents());
  const [aiMatchOwnPosts, setAiMatchOwnPosts] = useState<AiMatchOwnPost[]>([]);
  const [aiMatchOwnPostsLoading, setAiMatchOwnPostsLoading] = useState(false);
  // Phones get the rail as a second tab instead of a column: same list, but it
  // takes the screen only while they are looking at it.
  const [aiMatchMobileTab, setAiMatchMobileTab] = useState<'match' | 'recent'>('match');
  const [aiMatchFileReading, setAiMatchFileReading] = useState(false);
  const [aiMatchFileName, setAiMatchFileName] = useState('');
  const aiMatchFileInputRef = useRef<HTMLInputElement | null>(null);
  const [aiMatchOwnPostsReloadKey, setAiMatchOwnPostsReloadKey] = useState(0);
  const [aiMatchError, setAiMatchError] = useState<string | null>(null);
  const [aiMatchHasRun, setAiMatchHasRun] = useState(false);
  // Collapsed to a one-line summary once there are results, so the list gets
  // the screen — the textarea is most of a phone's viewport otherwise.
  const [aiMatchComposerOpen, setAiMatchComposerOpen] = useState(true);
  const [lastMatchAt, setLastMatchAt] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const routerLocation = useLocation();
  // Set when arriving from a post's "Matches" button: that post's text seeds the
  // box, ready to run. It is not auto-run, because a run spends a credit.
  const aiMatchSeed = typeof (routerLocation.state as { aiMatchDescription?: unknown } | null)?.aiMatchDescription === 'string'
    ? ((routerLocation.state as { aiMatchDescription: string }).aiMatchDescription).trim()
    : '';
  // The post's title, when arriving from a post's Matches button, so the page
  // can say what it is about to match rather than showing a bare box.
  const aiMatchSeedTitle = typeof (routerLocation.state as { aiMatchFrom?: unknown } | null)?.aiMatchFrom === 'string'
    ? ((routerLocation.state as { aiMatchFrom: string }).aiMatchFrom).trim()
    : '';
  const navigate = useNavigate();
    const breakdownBorderClass = 'border-slate-600/45 dark:border-slate-500/40';

  const [profileRangeId, setProfileRangeId] = useState<ProfileRangeOption['id']>(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('range');
    return PROFILE_RANGE_OPTIONS.some((option) => option.id === fromUrl)
      ? (fromUrl as ProfileRangeOption['id'])
      : '30d';
  });
  // Derived from the account's global persona, not a user toggle — a Vendor
  // only ever browses Hotlist (to request consultants), Bench Sales only
  // ever browses Jobs (to apply). No in-page peeking at the other kind.
  const feedKindFilter: 'all' | 'job' | 'hotlist' = isCombinedFeed
    ? (account?.active_persona === 'bench_sales' ? 'job' : 'hotlist')
    : 'all';
  const [animatedSearchPlaceholder, setAnimatedSearchPlaceholder] = useState(SEARCH_PLACEHOLDER_EXAMPLES[0]);
  const [animatedAiMatchPlaceholder, setAnimatedAiMatchPlaceholder] = useState('');

  // Typewriter-cycles the search bar's placeholder through example queries —
  // types a phrase out, pauses, deletes it, then moves to the next one.
  useEffect(() => {
    let cancelled = false;
    let phraseIndex = 0;
    let charCount = 0;
    let isDeleting = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const TYPE_MS = 55;
    const DELETE_MS = 28;
    const PAUSE_AFTER_TYPE_MS = 1700;
    const PAUSE_AFTER_DELETE_MS = 300;

    const tick = () => {
      if (cancelled) return;
      const phrase = SEARCH_PLACEHOLDER_EXAMPLES[phraseIndex];

      if (!isDeleting) {
        charCount += 1;
        setAnimatedSearchPlaceholder(phrase.slice(0, charCount));
        if (charCount >= phrase.length) {
          isDeleting = true;
          timeoutId = setTimeout(tick, PAUSE_AFTER_TYPE_MS);
          return;
        }
        timeoutId = setTimeout(tick, TYPE_MS);
        return;
      }

      charCount -= 1;
      setAnimatedSearchPlaceholder(phrase.slice(0, charCount));
      if (charCount <= 0) {
        isDeleting = false;
        phraseIndex = (phraseIndex + 1) % SEARCH_PLACEHOLDER_EXAMPLES.length;
        timeoutId = setTimeout(tick, PAUSE_AFTER_DELETE_MS);
        return;
      }
      timeoutId = setTimeout(tick, DELETE_MS);
    };

    timeoutId = setTimeout(tick, TYPE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [selectedTechStacks, setSelectedTechStacks] = useState<string[]>([]);
  const [profileSearchQuery, setProfileSearchQuery] = useState('');
  const [isRangeMenuOpen, setIsRangeMenuOpen] = useState(false);
  const [isRecentSearchesOpen, setIsRecentSearchesOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [feedSearchQuery, setFeedSearchQuery] = useState('');
  // The raw text the user searched for, as opposed to feedSearchQuery which is
  // the parsed role. Kept because it is what belongs in ?q=, and because the
  // URL is written from state by a single effect rather than by each handler:
  // react-router's setSearchParams closes over the params of the render that
  // created it, so several handlers writing their own snapshots race, and the
  // last stale one wins -- which is what was dropping ?q=.
  const [appliedRawSearchQuery, setAppliedRawSearchQuery] = useState(
    () => (new URLSearchParams(window.location.search).get('q') ?? '').trim(),
  );
  const [feedSearchFilters, setFeedSearchFilters] = useState<FeedSearchFilters>(
    () => readFeedFiltersFromUrl(new URLSearchParams(window.location.search)),
  );
  // Filters are sent to the server now, so the free-text boxes inside them
  // (skillsQuery, rate bounds) need a beat before they turn into a request.
  const [appliedFeedFilters, setAppliedFeedFilters] = useState<FeedSearchFilters>(
    () => readFeedFiltersFromUrl(new URLSearchParams(window.location.search)),
  );
  const [serverFacetCounts, setServerFacetCounts] = useState<Record<FeedFacetCategory, Record<string, number>>>({
    experienceRange: {}, workType: {}, employmentType: {}, visaStatus: {},
  });
  // Total matching the current window + filters, which the client can no
  // longer derive from feed.length now that feed holds only loaded pages.
  const [feedTotalCount, setFeedTotalCount] = useState<number | null>(null);
  // Free-text/numeric filter fields (skills, rate range) apply on
  // blur/Enter/an explicit Apply click rather than live per-keystroke —
  // scopedFeed re-filters the whole (potentially thousand-plus-row) feed on
  // every feedSearchFilters change, so live-typing straight into it would
  // reintroduce the same per-keystroke perf issue fixed elsewhere this
  // session. Dropdown/checkbox filters (experience/workType/employmentType/
  // visa/rate mode) are discrete clicks and apply immediately, no staging
  // needed; location commits only when a place is picked/added (its own
  // typing lives in LocationChipInput's internal draft state), so it
  // doesn't need pending/apply staging either.
  const [pendingSkillsFilter, setPendingSkillsFilter] = useState(feedSearchFilters.skillsQuery);
  const [pendingRateMin, setPendingRateMin] = useState(feedSearchFilters.rateMin);
  const [pendingRateMax, setPendingRateMax] = useState(feedSearchFilters.rateMax);
  const [pendingFeedSearchQuery, setPendingFeedSearchQuery] = useState('');
  const [selectedProfilesView, setSelectedProfilesView] = useState<'all' | 'watching'>('all');
  const [profilePage, setProfilePage] = useState(1);
  const visibleProfilesCount = profilePage * TOP_PROFILES_PAGE_SIZE;
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 639px)').matches;
  });
  const profileListScrollRef = useRef<HTMLDivElement | null>(null);
  const mobileProfilesLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const [profileStatsLoading, setProfileStatsLoading] = useState(false);
  const [profileStatsByRole, setProfileStatsByRole] = useState<Record<string, ProfileStats>>({});
  // Small, independent table (one row per curated market-pulse role) —
  // fetched once, unrelated to the heavier live persona-stats pipeline
  // above, so feed cards get a market-pulse insight even when that
  // leaderboard panel is never opened.
  const [expandedMobileProfileCardIds, setExpandedMobileProfileCardIds] = useState<Set<string>>(new Set());
  const [selectedLead, setSelectedLead] = useState<SocialLead | null>(null);
  const [processingAskAILeadId, setProcessingAskAILeadId] = useState<string | null>(null);
  const [processingChatLeadId, setProcessingChatLeadId] = useState<string | null>(null);
  const [askAIPreview, setAskAIPreview] = useState<AskAIPreview | null>(null);
  const [gmailIntegrationStatus, setGmailIntegrationStatus] = useState<'connected' | 'not_connected' | null>(null);
  // Bulk selection for AI Match results. Empty means "all of them", so the
  // bar works without anyone having to tick sixteen boxes first — ticking is
  // for narrowing it down, not for opting in.
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const toggleBulkSelect = useCallback((lead: SocialLead) => {
    setBulkSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(lead.id)) next.delete(lead.id);
      else next.add(lead.id);
      return next;
    });
  }, []);
  const [sendingViaGmail, setSendingViaGmail] = useState(false);
  const [showGmailConnectPrompt, setShowGmailConnectPrompt] = useState(false);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [pendingGmailReopen, setPendingGmailReopen] = useState<{ leadId: string; leadType: 'job' | 'hotlist' } | null>(null);
  const [showOutOfCreditsModal, setShowOutOfCreditsModal] = useState(false);
  const [expandedInlineBreakdownLeadIds, setExpandedInlineBreakdownLeadIds] = useState<Set<string>>(new Set());
  const [selectedMatchesTab, setSelectedMatchesTab] = useState<MatchesTabId>('queued');
  const [feedTimeBasis] = useState<FeedTimeBasis>('posted');
  const [layoutMode, setLayoutMode] = useState<PulseLayoutMode>(getInitialPulseLayoutMode);
  // Hotlist posts from social are bulk: one scraped post carries ten
  // consultants, and every sibling row stores the same raw text. The parsed
  // fields on the card are per-consultant and correct; the original post is
  // not worth showing, so hotlist feeds are cards only and no hotlist lead
  // opens a post preview anywhere.
  const hotlistOnlyFeed = feedKind === 'hotlist';
  // The mobile Recent tab replaces the composer and the results, so both have
  // to leave the flex column entirely — hiding only the results *inside* their
  // wrapper left the wrapper claiming flex-1, which halved the list's height
  // and cut the last card in two.
  const aiMatchRecentTabActive = aiMatch && isMobileViewport && aiMatchMobileTab === 'recent';
  // Cards whatever is saved: a table row or a detail pane of a consultant is
  // mostly the fields the card already shows, minus the layout that makes them
  // readable. The stored preference is left alone, so other feeds keep it.
  const effectiveLayoutMode: PulseLayoutMode = hotlistOnlyFeed ? 'card' : layoutMode;
  const isTableLayout = effectiveLayoutMode === 'table' && !isMobileViewport;
  const isDetailLayout = effectiveLayoutMode === 'detail' && !isMobileViewport;
  const isSwipeLayout = SWIPE_LAYOUT_ENABLED && effectiveLayoutMode === 'swipe';
  // Selected post for the detail-panel layout — a real path param (not just
  // component state) so a post has a genuine, shareable, back/forward-able
  // URL while browsing. Ignored entirely outside detail mode and on mobile
  // (the switcher that reaches this mode is already hidden there).
  const { kind: routeLeadKind, id: routeLeadId } = useParams<{ kind?: string; id?: string }>();
  const [tableSortKey, setTableSortKey] = useState<LeadTableSortKey | null>('posted');
  const [tableSortDirection, setTableSortDirection] = useState<'asc' | 'desc'>('desc');
  const [expandedSkillsLeadIds, setExpandedSkillsLeadIds] = useState<Set<string>>(new Set());
  const [expandedFieldKeys, setExpandedFieldKeys] = useState<Set<string>>(new Set());
  const [predictResultByLeadId, setPredictResultByLeadId] = useState<Record<string, PredictResult>>({});
  const [bulkPredictLeadIds, setBulkPredictLeadIds] = useState<Set<string>>(new Set());
  const [isBulkPredictModalOpen, setIsBulkPredictModalOpen] = useState(false);
  const [bulkPredictInput, setBulkPredictInput] = useState('');
  const [bulkPredictSubmitting, setBulkPredictSubmitting] = useState(false);
  const [bulkPredictCompletedCount, setBulkPredictCompletedCount] = useState(0);
  const [visibleMatchesCount, setVisibleMatchesCount] = useState(MATCHES_PAGE_SIZE);
  const [desktopRecentVisibleCount, setDesktopRecentVisibleCount] = useState(DESKTOP_MATCHES_PAGE_SIZE);
  const [desktopPreviewedVisibleCount, setDesktopPreviewedVisibleCount] = useState(DESKTOP_MATCHES_PAGE_SIZE);
  const [desktopAskedVisibleCount, setDesktopAskedVisibleCount] = useState(DESKTOP_MATCHES_PAGE_SIZE);
  const [desktopVerifiedVisibleCount, setDesktopVerifiedVisibleCount] = useState(DESKTOP_MATCHES_PAGE_SIZE);
  const [revealedLeadIds, setRevealedLeadIds] = useState<Set<string>>(new Set());
  const [askedJobStateByLeadId, setAskedJobStateByLeadId] = useState<Record<string, AskedJobState>>({});
  const [globalAskedJobStateByLeadId, setGlobalAskedJobStateByLeadId] = useState<Record<string, GlobalAskedJobState>>({});
  const [askedLeadsById, setAskedLeadsById] = useState<Record<string, SocialLead>>({});
  const [breakdownChargedLeadIds, setBreakdownChargedLeadIds] = useState<Set<string>>(new Set());
  const [postContentViewedLeadIds, setPostContentViewedLeadIds] = useState<Set<string>>(new Set());
  const [postContentViewedAtByLeadId, setPostContentViewedAtByLeadId] = useState<Record<string, string>>({});
  const [postContentPreview, setPostContentPreview] = useState<{ leadId: string; title: string; content: string } | null>(null);
  const [applyModalLead, setApplyModalLead] = useState<SocialLead | null>(null);
  const [loadingPostContentLeadId, setLoadingPostContentLeadId] = useState<string | null>(null);
  const [detailPanelContent, setDetailPanelContent] = useState<{ leadId: string; content: string } | null>(null);
  const [loadingDetailPanelLeadId, setLoadingDetailPanelLeadId] = useState<string | null>(null);
  const [ignoredLeadIds, setIgnoredLeadIds] = useState<Set<string>>(new Set());
  const [revealedAtByLeadId, setRevealedAtByLeadId] = useState<Record<string, string>>({});
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [processingBreakdownLeadId, setProcessingBreakdownLeadId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isMobileTopCollapsed, setIsMobileTopCollapsed] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const mobileRightPaneLastScrollTopRef = useRef(0);
  const mobileTopCollapsedRef = useRef(false);
  const mobileScrollUpAccumRef = useRef(0);
  const mobileScrollDownAccumRef = useRef(0);
  const mobileCollapseLockUntilRef = useRef(0);
  const mobileTouchStartXRef = useRef<number | null>(null);
  const mobileTouchStartYRef = useRef<number | null>(null);
  const mobileSwipeDeltaXRef = useRef(0);
  const mobileSwipeDeltaYRef = useRef(0);
  const mobileHorizontalSwipeRef = useRef(false);
  const mobilePullStartYRef = useRef<number | null>(null);
  const mobilePullArmedRef = useRef(false);
  const appliedSearchParamQueryRef = useRef<string | null>(null);
  const rangeMenuRef = useRef<HTMLDivElement | null>(null);
  const recentSearchesRef = useRef<HTMLDivElement | null>(null);
  const desktopMatchesScrollRef = useRef<HTMLDivElement | null>(null);
  const pulseRowsCacheRef = useRef<PulseSocialFeedRpcRow[] | null>(null);
  const pulseRowsCacheAtRef = useRef(0);
  const pulseRowsCacheRangeHoursRef = useRef<number | null>(null);
  const pulseRowsCacheTimeBasisRef = useRef<FeedTimeBasis | null>(null);
  const pulseRowsRequestRef = useRef<{ hours: number; timeBasis: FeedTimeBasis; request: Promise<PulseSocialFeedRpcRow[]> } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  const PREDICT_COST = 0.01;
  const MAX_BULK_PREDICT = 5;

  const sortedLeaderboard = useMemo(() => {
    return [...leaderboard]
      .sort((a, b) => b.active_watchers - a.active_watchers || a.target_role.localeCompare(b.target_role))
      .map((item, idx) => ({ ...item, rank: idx + 1 }));
  }, [leaderboard]);

  const selectedProfileRange = useMemo(
    () => PROFILE_RANGE_OPTIONS.find((item) => item.id === profileRangeId) ?? PROFILE_RANGE_OPTIONS[0],
    [profileRangeId],
  );

  useEffect(() => {
    if (!isRangeMenuOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (rangeMenuRef.current && target && !rangeMenuRef.current.contains(target)) {
        setIsRangeMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isRangeMenuOpen]);

  useEffect(() => {
    if (!isRecentSearchesOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (recentSearchesRef.current && target && !recentSearchesRef.current.contains(target)) {
        setIsRecentSearchesOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [isRecentSearchesOpen]);

  const loadRecentSearches = useCallback(async () => {
    if (!user?.id) {
      setRecentSearches([]);
      return;
    }

    const { data, error } = await supabase
      .from('job_search_history')
      .select('search_query')
      .eq('user_id', user.id)
      .eq('page', isHotlistFeed ? '/hotlist' : isCombinedFeed ? '/feed' : '/jobs')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) return;
    setRecentSearches(
      ((data ?? []) as Array<{ search_query: string | null }>)
        .map((row) => (row.search_query ?? '').trim())
        .filter(Boolean),
    );
  }, [isCombinedFeed, isHotlistFeed, user?.id]);

  const zeroStats: ProfileStats = useMemo(() => ({
    uniqueCompanies: 0,
    uniqueVendors: 0,
    uniqueJobs: 0,
    avgMatchScore: null,
  }), []);

  const jobsRankedLeaderboard = useMemo(() => {
    const sortedByJobs = [...sortedLeaderboard]
      .sort((a, b) => {
        const aJobs = profileStatsByRole[normalize(a.target_role)]?.uniqueJobs ?? 0;
        const bJobs = profileStatsByRole[normalize(b.target_role)]?.uniqueJobs ?? 0;
        return bJobs - aJobs || b.active_watchers - a.active_watchers || a.target_role.localeCompare(b.target_role);
      });

    const seenRoleKeys = new Set<string>();
    const uniqueProfiles: PulsePersona[] = [];

    for (const item of sortedByJobs) {
      const canonicalKey = canonicalizeRoleForUniqueness(item.target_role) || normalize(item.target_role);
      if (seenRoleKeys.has(canonicalKey)) continue;
      seenRoleKeys.add(canonicalKey);
      uniqueProfiles.push(item);
    }

    return uniqueProfiles.map((item, idx) => ({ ...item, rank: idx + 1 }));
  }, [profileStatsByRole, sortedLeaderboard]);

  const filteredJobsRankedLeaderboard = useMemo(() => {
    const selectedCategory = PROFILE_CATEGORY_TABS.find((item) => item.id === selectedCategoryId) ?? PROFILE_CATEGORY_TABS[0];
    const categoryFiltered = jobsRankedLeaderboard.filter((persona) => isPersonaInCategory(persona, selectedCategory.id));
    const hasStatsLoaded = Object.keys(profileStatsByRole).length > 0;
    const rangeAlignedProfiles = hasStatsLoaded
      ? categoryFiltered.filter((persona) => (profileStatsByRole[normalize(persona.target_role)]?.uniqueJobs ?? 0) > 0)
      : categoryFiltered;
    // Tech stack sub-filter
    const techFiltered = selectedTechStacks.length > 0
      ? rangeAlignedProfiles.filter((persona) => {
          const text = normalize(`${persona.target_role} ${persona.summary} ${persona.priority_skills ?? ''}`);
          return selectedTechStacks.some((tech) => text.includes(normalize(tech)));
        })
      : rangeAlignedProfiles;
    const query = normalize(profileSearchQuery);
    if (!query) return techFiltered;
    return techFiltered.filter((item) => {
      const d = getPersonaDetailColumns(item);
      return normalize(item.target_role).includes(query)
        || normalize(item.summary).includes(query)
        || normalize(d.skills).includes(query)
        || normalize(d.location).includes(query)
        || normalize(d.visaStatus).includes(query)
        || normalize(d.employmentType).includes(query)
        || normalize(d.workType).includes(query)
        || normalize(d.experience).includes(query)
        || normalize(d.rateRange).includes(query);
    });
  }, [jobsRankedLeaderboard, profileSearchQuery, profileStatsByRole, selectedCategoryId, selectedTechStacks]);

  const orderedJobsRankedLeaderboard = useMemo(() => {
    const watched: PulsePersona[] = [];
    const unwatched: PulsePersona[] = [];

    for (const item of filteredJobsRankedLeaderboard) {
      if (watchingRoles.has(normalize(item.target_role))) {
        watched.push(item);
      } else {
        unwatched.push(item);
      }
    }

    return [...watched, ...unwatched].map((item, idx) => ({ ...item, rank: idx + 1 }));
  }, [filteredJobsRankedLeaderboard, watchingRoles]);

  const profilesForActiveView = useMemo(() => {
    if (selectedProfilesView === 'watching') {
      return orderedJobsRankedLeaderboard.filter((item) => watchingRoles.has(normalize(item.target_role)));
    }
    return orderedJobsRankedLeaderboard;
  }, [filteredJobsRankedLeaderboard, orderedJobsRankedLeaderboard, selectedProfilesView, watchingRoles]);

  const visibleJobsRankedLeaderboard = useMemo(
    () => {
      if (isMobileViewport) {
        return profilesForActiveView.slice(0, visibleProfilesCount);
      }
      return profilesForActiveView.slice((profilePage - 1) * TOP_PROFILES_PAGE_SIZE, profilePage * TOP_PROFILES_PAGE_SIZE);
    },
    [isMobileViewport, profilePage, profilesForActiveView, visibleProfilesCount],
  );

  const totalProfilePages = Math.max(1, Math.ceil(profilesForActiveView.length / TOP_PROFILES_PAGE_SIZE));
  const canLoadMoreProfiles = profilePage < totalProfilePages;

  const baseScopedFeed = useMemo(() => {
    let next = feed;

    if (selectedCategoryId !== 'all') {
      next = next.filter((lead) => {
        const category = inferRoleCategoryId(`${lead.title} ${lead.snippet}`);
        if (category !== selectedCategoryId) return false;

        if (selectedTechStacks.length === 0) return true;
        const haystack = normalize(`${lead.title} ${lead.snippet} ${lead.skills.join(' ')}`);
        return selectedTechStacks.some((tech) => haystack.includes(normalize(tech)));
      });
    }

    if (activePersona) {
      const personaSkills = getPersonaSkillList(activePersona.target_role, activePersona.priority_skills);
      next = next.filter((lead) => {
        const row = {
          id: lead.id,
          platform: lead.platform,
          posted_by_name: lead.posterName,
          poster_email: lead.posterEmail,
          poster_phone: lead.posterPhone,
          created_at: lead.postedAt,
          posted_at: lead.postedAt,
          job_title: lead.title,
          company_name: lead.company,
          location: lead.location,
          post_content: lead.snippet,
          extracted_role_normalized: lead.title,
          employment_type: lead.employmentType,
          seniority_level: lead.seniority,
          salary_range: lead.salaryRange,
          extracted_skills: lead.skills,
          extracted_experience_years: lead.experienceYears,
          extracted_visa_types: lead.visaTypes,
          extracted_hourly_rate_min: null,
          extracted_hourly_rate_max: null,
        } as SocialJobRow;

        return roleMatchesPersona(row, activePersona.target_role, personaSkills);
      });
    }

    return next;
  }, [activePersona, feed, selectedCategoryId, selectedTechStacks]);

  const getLeadFilterContext = useCallback((lead: SocialLead) => {
    const breakdown = lead.scoreBreakdown as Record<string, unknown> | null | undefined;
    const experienceText = firstMeaningfulValue(
      getBreakdownJobValue(breakdown, 'experience_match'),
      lead.experienceYears != null ? `${lead.experienceYears} years` : '',
      lead.seniority,
    );
    const experienceYears = lead.experienceYears ?? parseExperienceYears(experienceText);

    const workTypeText = firstMeaningfulValue(
      getBreakdownJobValue(breakdown, 'work_type_match'),
      '',
    );
    const normalizedWorkType = normalize(workTypeText);
    const workType = normalizedWorkType.includes('remote')
      ? 'remote'
      : normalizedWorkType.includes('hybrid')
        ? 'hybrid'
        : normalizedWorkType.includes('onsite') || normalizedWorkType.includes('on site') || normalizedWorkType.includes('on-site')
          ? 'onsite'
          : 'other';

    const employmentTypeText = firstMeaningfulValue(
      getBreakdownJobValue(breakdown, 'employment_type_match'),
      lead.employmentType,
    );
    const normalizedEmployment = normalize(employmentTypeText);
    const employmentType = normalizedEmployment.includes('full')
      ? 'full_time'
      : normalizedEmployment.includes('contract')
        ? 'contract'
        : normalizedEmployment.includes('c2c')
          ? 'c2c'
          : normalizedEmployment.includes('w2')
            ? 'w2'
            : normalizedEmployment.includes('1099')
              ? '1099'
              : normalizedEmployment.includes('part')
                ? 'part_time'
                : 'other';

    const visaText = firstMeaningfulValue(
      getBreakdownJobValue(breakdown, 'visa_match'),
      Array.isArray(lead.visaTypes) ? lead.visaTypes.join(', ') : '',
    );
    const normalizedVisa = normalize(visaText);
    const visaStatus = normalizedVisa.includes('usc') || normalizedVisa.includes('us citizen')
      ? 'usc'
      : normalizedVisa.includes('green card') || normalizedVisa === 'gc' || normalizedVisa.includes(' gc ')
        ? 'gc'
        : normalizedVisa.includes('h1b') || normalizedVisa.includes('h-1')
          ? 'h1b'
          : normalizedVisa.includes('ead')
            ? 'ead'
            : normalizedVisa.includes('opt')
              ? 'opt'
              : normalizedVisa.includes('cpt')
                ? 'cpt'
                : normalizedVisa.includes('tn')
                  ? 'tn'
                  : 'other';

    const rateText = firstMeaningfulValue(
      getBreakdownJobValue(breakdown, 'hourly_rate_match'),
      lead.hourlyRate,
      lead.salaryRange,
      '',
    );
    const location = firstMeaningfulValue(
      getBreakdownJobValue(breakdown, 'location_match'),
      lead.location,
      '',
    );
    const skills = firstMeaningfulValue(
      getBreakdownJobValue(breakdown, 'skills_match'),
      Array.isArray(lead.skills) ? lead.skills.join(', ') : '',
      '',
    );

    const rateValue = parseFirstNumericValue(rateText);
    const hasRate = rateText !== '-' && normalize(rateText) !== 'unknown';

    return {
      experienceYears,
      workType,
      employmentType,
      visaStatus,
      location,
      skills,
      rateValue,
      hasRate,
    };
  }, []);

  // Feed after the free-text search box only, before the sidebar's category
  // filters — this is the base both scopedFeed (full filter) and the
  // sidebar's per-option counts (filter minus the one category being
  // counted, so picking more options within a category never shrinks its
  // own option counts) are computed from.
  const queryScopedFeed = useMemo(() => {
    let next = baseScopedFeed;

    if (isCombinedFeed && feedKindFilter !== 'all') {
      next = next.filter((lead) => lead.kind === feedKindFilter);
    }

    // No query filtering here any more. The rows in `feed` are whatever
    // get_*_feed_page_v2 returned for p_query, already ranked by FTS relevance
    // across the full window. Re-running a client-side match over them would
    // only be able to remove rows the server deliberately matched — silently
    // shrinking pages, since it has no way to fetch replacements.

    return next;
  }, [baseScopedFeed, feedKindFilter, isCombinedFeed]);

  const matchesLeadFilters = useCallback((lead: SocialLead, excludeCategory?: FeedFacetCategory) => {
    const fields = getLeadFilterContext(lead);

    if (excludeCategory !== 'experienceRange' && feedSearchFilters.experienceRange.length > 0) {
      if (!feedSearchFilters.experienceRange.some((rangeId) => matchesExperienceRange(fields.experienceYears, rangeId))) return false;
    }
    if (excludeCategory !== 'workType' && feedSearchFilters.workType.length > 0 && !feedSearchFilters.workType.includes(fields.workType)) return false;
    if (excludeCategory !== 'employmentType' && feedSearchFilters.employmentType.length > 0 && !feedSearchFilters.employmentType.includes(fields.employmentType)) return false;
    if (excludeCategory !== 'visaStatus' && feedSearchFilters.visaStatus.length > 0 && !feedSearchFilters.visaStatus.includes(fields.visaStatus)) return false;

    if (feedSearchFilters.location.length > 0) {
      const normalizedFieldLocation = normalize(fields.location);
      if (!feedSearchFilters.location.some((loc) => normalizedFieldLocation.includes(normalize(loc)))) return false;
    }

    if (feedSearchFilters.skillsQuery.trim()) {
      const skillsQuery = normalize(feedSearchFilters.skillsQuery);
      if (!normalize(fields.skills).includes(skillsQuery)) return false;
    }

    if (feedSearchFilters.rateMode === 'has_rate' && !fields.hasRate) return false;

    if (feedSearchFilters.rateMode === 'range') {
      const min = Number(feedSearchFilters.rateMin);
      const max = Number(feedSearchFilters.rateMax);
      if (fields.rateValue == null) return false;
      if (Number.isFinite(min) && fields.rateValue < min) return false;
      if (Number.isFinite(max) && fields.rateValue > max) return false;
    }

    return true;
  }, [feedSearchFilters, getLeadFilterContext]);

  const scopedFeed = useMemo(
    () => queryScopedFeed.filter((lead) => matchesLeadFilters(lead)),
    [queryScopedFeed, matchesLeadFilters],
  );

  // Facet counts come from the server now. They used to be tallied from
  // queryScopedFeed, which only worked while the browser held the entire
  // window — with 100-row pages that would have counted the current page and
  // reported "Remote 7" for a window holding hundreds. The RPC counts the
  // whole window, and each category is counted with its own selection
  // excluded, exactly as matchesLeadFilters(lead, category) did.
  const feedFacetCounts = serverFacetCounts;

  const toggleFeedFacetOption = useCallback((category: FeedFacetCategory, optionValue: string) => {
    setFeedSearchFilters((prev) => {
      const current = prev[category];
      const next = current.includes(optionValue)
        ? current.filter((v) => v !== optionValue)
        : [...current, optionValue];
      return { ...prev, [category]: next };
    });
  }, []);

  const dedupedScopedFeed = useMemo(() => {
    const byKey = new Map<string, SocialLead>();

    for (const lead of scopedFeed) {
      const key = buildPulseLeadDedupKey(lead, leadIsHotlist(lead));
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, lead);
        continue;
      }

      const existingTs = new Date(feedTimeBasis === 'created' ? existing.createdAt : existing.postedAt).getTime();
      const nextTs = new Date(feedTimeBasis === 'created' ? lead.createdAt : lead.postedAt).getTime();
      if (nextTs > existingTs) {
        byKey.set(key, lead);
      }
    }

    return Array.from(byKey.values()).filter((lead) => !ignoredLeadIds.has(lead.id));
  }, [feedTimeBasis, ignoredLeadIds, leadIsHotlist, scopedFeed]);

  const recentVisibleFeed = useMemo(() => {
    // Recent should only hold leads you haven't already acted on — once a
    // request/submission has been sent (by anyone on the account), it moves
    // to the Requested/Submitted tab instead of lingering here with its
    // action button disabled.
    const recent = dedupedScopedFeed.filter((lead) => !revealedLeadIds.has(lead.id) && !globalAskedJobStateByLeadId[lead.id]);
    // AI Match: best score first. That's the whole point of the view.
    if (aiMatch) return [...recent].sort((a, b) => compareByAiMatchScore(a, b, feedTimeBasis));
    // While searching, the server returns rows ranked by FTS relevance and
    // pages by offset within that ranking. Re-sorting here would scramble the
    // order the cursor is walking, so page 2 would interleave with page 1.
    if (feedSearchQuery.trim()) return recent;
    return recent.sort((a, b) => {
      if (isCombinedFeed || isHotlistFeed) return compareByRecency(a, b, feedTimeBasis);
      const aTs = new Date(!isHotlistFeed && a.matchedAt
        ? a.matchedAt
        : (feedTimeBasis === 'created' ? a.createdAt : a.postedAt)).getTime();
      const bTs = new Date(!isHotlistFeed && b.matchedAt
        ? b.matchedAt
        : (feedTimeBasis === 'created' ? b.createdAt : b.postedAt)).getTime();
      return bTs - aTs;
    });
  }, [aiMatch, dedupedScopedFeed, feedSearchQuery, feedTimeBasis, globalAskedJobStateByLeadId, isCombinedFeed, isHotlistFeed, revealedLeadIds]);

  const previewedVisibleFeed = useMemo(() => {
    // Same reasoning as Recent: once a lead has been requested/submitted, it
    // belongs in the Requested/Submitted tab, not lingering here with a
    // disabled action button.
    const previewed = dedupedScopedFeed.filter((lead) => postContentViewedLeadIds.has(lead.id) && !globalAskedJobStateByLeadId[lead.id]);
    return previewed.sort((a, b) => {
      const aTs = postContentViewedAtByLeadId[a.id] ? new Date(postContentViewedAtByLeadId[a.id]).getTime() : 0;
      const bTs = postContentViewedAtByLeadId[b.id] ? new Date(postContentViewedAtByLeadId[b.id]).getTime() : 0;
      if (aTs !== bTs) return bTs - aTs;
      return new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime();
    });
  }, [dedupedScopedFeed, globalAskedJobStateByLeadId, postContentViewedAtByLeadId, postContentViewedLeadIds]);

  const askedVisibleFeed = useMemo(() => {
    const scopedById = new Map(dedupedScopedFeed.map((lead) => [lead.id, lead]));
    return Object.keys(askedJobStateByLeadId)
      .map((leadId) => scopedById.get(leadId) ?? askedLeadsById[leadId])
      .filter((lead): lead is SocialLead => Boolean(lead))
      .sort((a, b) => new Date(askedJobStateByLeadId[b.id].requestedAt).getTime() - new Date(askedJobStateByLeadId[a.id].requestedAt).getTime());
  }, [askedJobStateByLeadId, askedLeadsById, dedupedScopedFeed]);

  const verifiedVisibleFeed = useMemo(() => {
    const scopedById = new Map(dedupedScopedFeed.map((lead) => [lead.id, lead]));
    return Object.entries(globalAskedJobStateByLeadId)
      .filter(([, state]) => state === 'verified')
      .map(([leadId]) => scopedById.get(leadId) ?? askedLeadsById[leadId])
      .filter((lead): lead is SocialLead => Boolean(lead))
      .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
  }, [askedLeadsById, dedupedScopedFeed, globalAskedJobStateByLeadId]);


  const allLoadedLeadsById = useMemo(() => {
    const map = new Map<string, SocialLead>();
    for (const lead of dedupedScopedFeed) map.set(lead.id, lead);
    for (const lead of Object.values(askedLeadsById)) map.set(lead.id, lead);
    return map;
  }, [askedLeadsById, dedupedScopedFeed]);

  const matchesTabCounts = useMemo(() => ({
    // The browse tabs count the whole window, from the facets RPC — not the
    // pages that happen to be loaded. Counting `feed` here is what made a
    // 30-day window report 85: that was one server page of 100, minus the
    // rows client-side dedupe collapses. feedTotalCount is null only until the
    // first facets response lands, and the loaded count stands in until then.
    all: feedTotalCount ?? dedupedScopedFeed.length,
    breakdown: dedupedScopedFeed.filter((lead) => breakdownChargedLeadIds.has(lead.id)).length,
    // These three are driven by the account's own actions rather than by the
    // window, so they stay local.
    previewed: previewedVisibleFeed.length,
    asked: askedVisibleFeed.length,
    verified: verifiedVisibleFeed.length,
    queued: feedTotalCount ?? recentVisibleFeed.length,
  }), [askedVisibleFeed.length, breakdownChargedLeadIds, dedupedScopedFeed, feedTotalCount, previewedVisibleFeed.length, recentVisibleFeed.length, verifiedVisibleFeed.length]);

  const matchesTabDefinitions = useMemo((): Array<{ id: MatchesTabId; label: string; icon: LucideIcon }> => {
    const tabs: Array<{ id: MatchesTabId; label: string; icon: LucideIcon }> = isCombinedFeed
      ? [
        { id: 'queued', label: 'Recent', icon: Clock3 },
        { id: 'previewed', label: 'Previewed', icon: Eye },
        { id: 'asked', label: 'Sent', icon: Send },
      ]
      : isHotlistFeed
      ? [
        { id: 'queued', label: 'Recent', icon: Clock3 },
        { id: 'previewed', label: 'Previewed', icon: Eye },
        { id: 'asked', label: 'Requested', icon: Send },
      ]
      : [
        { id: 'queued', label: 'Recent', icon: Clock3 },
        { id: 'previewed', label: 'Previewed', icon: Eye },
        { id: 'asked', label: 'Submitted', icon: Send },
      ];
    // In AI Match the first tab holds the ranked shortlist, not recent posts.
    return aiMatch
      ? tabs.map((tab) => (tab.id === 'queued' ? { ...tab, label: 'Matches', icon: Sparkles } : tab))
      : tabs;
  }, [aiMatch, isCombinedFeed, isHotlistFeed]);

  const profileViewCounts = useMemo(() => ({
    all: filteredJobsRankedLeaderboard.length,
    watching: orderedJobsRankedLeaderboard.filter((item) => watchingRoles.has(normalize(item.target_role))).length,
  }), [filteredJobsRankedLeaderboard, orderedJobsRankedLeaderboard, watchingRoles]);

  const filteredFeed = useMemo(() => {
    let selectedFeed: SocialLead[];
    if (selectedMatchesTab === 'breakdown') {
      selectedFeed = dedupedScopedFeed.filter((lead) => breakdownChargedLeadIds.has(lead.id));
    } else if (selectedMatchesTab === 'previewed') {
      selectedFeed = previewedVisibleFeed;
    } else if (selectedMatchesTab === 'asked') {
      selectedFeed = askedVisibleFeed;
    } else if (selectedMatchesTab === 'verified') {
      selectedFeed = verifiedVisibleFeed;
    } else if (selectedMatchesTab === 'queued') {
      selectedFeed = recentVisibleFeed;
    } else {
      selectedFeed = dedupedScopedFeed;
    }
    if (aiMatch) return [...selectedFeed].sort((a, b) => compareByAiMatchScore(a, b, feedTimeBasis));
    // Same reasoning as recentVisibleFeed: preserve the server's ranking while
    // a search is active.
    if (feedSearchQuery.trim()) return selectedFeed;
    // The browse feed is newest-first now. It used to rank by completeness
    // (compareDetailsAndPostedDate), which can't be paged server-side — no
    // index can serve a computed rank, and the client only holds the pages it
    // has fetched. The other tabs are driven by the account's own actions, are
    // small, and keep the completeness ordering.
    if (isCombinedFeed || selectedMatchesTab === 'queued') {
      return [...selectedFeed].sort((a, b) => compareByRecency(a, b, feedTimeBasis));
    }
    return [...selectedFeed].sort(compareDetailsAndPostedDate);
  }, [aiMatch, askedVisibleFeed, breakdownChargedLeadIds, dedupedScopedFeed, feedSearchQuery, feedTimeBasis, isCombinedFeed, isHotlistFeed, previewedVisibleFeed, recentVisibleFeed, selectedMatchesTab, verifiedVisibleFeed]);

  const visibleFeed = useMemo(() => filteredFeed.slice(0, visibleMatchesCount), [filteredFeed, visibleMatchesCount]);

  // Pagination bar for the browse feed. The feed is paged on the server now,
  // so the end of a page is a real boundary the user has to be able to cross —
  // and to come back from, which is what the cursor stack is for.
  const renderFeedPagingFooter = useCallback(() => {
    // AI Match returns one scored shortlist; there is no next page to fetch.
    if (aiMatch) return null;
    const pageRowCount = feed.length;
    if (pageRowCount === 0 && feedPageIndex === 0) return null;

    const firstOnPage = feedPageIndex * FEED_PAGE_SIZE + 1;
    const lastOnPage = feedPageIndex * FEED_PAGE_SIZE + pageRowCount;
    const totalPages = feedTotalCount != null && feedTotalCount > 0
      ? Math.max(1, Math.ceil(feedTotalCount / FEED_PAGE_SIZE))
      : null;

    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 px-3 py-3 dark:border-gray-700">
        <span className="text-[12px] text-gray-500">
          {feedTotalCount != null
            ? `Showing ${firstOnPage.toLocaleString()}-${lastOnPage.toLocaleString()} of ${feedTotalCount.toLocaleString()}`
            : `Showing ${firstOnPage.toLocaleString()}-${lastOnPage.toLocaleString()}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void goToPrevFeedPageRef.current()}
            disabled={feedPageIndex === 0 || feedPageLoading}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-[12px] tabular-nums text-gray-500">
            {totalPages != null ? `Page ${feedPageIndex + 1} of ${totalPages.toLocaleString()}` : `Page ${feedPageIndex + 1}`}
          </span>
          <button
            type="button"
            onClick={() => void goToNextFeedPageRef.current()}
            disabled={!feedHasMore || feedPageLoading}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-[12px] font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {feedPageLoading ? 'Loading...' : 'Next'}
          </button>
        </div>
      </div>
    );
  }, [aiMatch, feed.length, feedHasMore, feedPageIndex, feedPageLoading, feedTotalCount]);
  const canLoadMoreMatches = visibleMatchesCount < filteredFeed.length;

  const visibleDesktopRecentFeed = useMemo(
    () => (
      // AI Match arrives already ordered by fit score (recentVisibleFeed sorts
      // it). Re-sorting here by recency is what made the desktop card, table
      // and detail lists show matches newest-first instead of best-first.
      aiMatch
        ? [...recentVisibleFeed]
        : [...recentVisibleFeed]
          .sort((a, b) => ((isCombinedFeed || isHotlistFeed) ? compareByRecency(a, b, feedTimeBasis) : compareDetailsAndPostedDate(a, b)))
    ).slice(0, desktopRecentVisibleCount),
    [aiMatch, desktopRecentVisibleCount, feedTimeBasis, isCombinedFeed, isHotlistFeed, recentVisibleFeed],
  );
  const visibleDesktopPreviewedFeed = useMemo(
    () => [...previewedVisibleFeed].sort(compareDetailsAndPostedDate).slice(0, desktopPreviewedVisibleCount),
    [desktopPreviewedVisibleCount, previewedVisibleFeed],
  );
  const visibleDesktopAskedFeed = useMemo(
    () => [...askedVisibleFeed].sort(compareDetailsAndPostedDate).slice(0, desktopAskedVisibleCount),
    [askedVisibleFeed, desktopAskedVisibleCount],
  );
  const visibleDesktopVerifiedFeed = useMemo(
    () => [...verifiedVisibleFeed].sort(compareDetailsAndPostedDate).slice(0, desktopVerifiedVisibleCount),
    [desktopVerifiedVisibleCount, verifiedVisibleFeed],
  );

  // Whichever list the detail pane is currently showing.
  const detailLeadsForActiveTab = useMemo(() => (
    selectedMatchesTab === 'previewed' ? visibleDesktopPreviewedFeed
      : selectedMatchesTab === 'asked' ? visibleDesktopAskedFeed
        : selectedMatchesTab === 'verified' ? visibleDesktopVerifiedFeed
          : visibleDesktopRecentFeed
  ), [selectedMatchesTab, visibleDesktopAskedFeed, visibleDesktopPreviewedFeed, visibleDesktopRecentFeed, visibleDesktopVerifiedFeed]);
  const canLoadMoreDesktopRecent = desktopRecentVisibleCount < recentVisibleFeed.length;
  const canLoadMoreDesktopPreviewed = desktopPreviewedVisibleCount < previewedVisibleFeed.length;
  const canLoadMoreDesktopAsked = desktopAskedVisibleCount < askedVisibleFeed.length;
  const canLoadMoreDesktopVerified = desktopVerifiedVisibleCount < verifiedVisibleFeed.length;

  // Same tab -> list mapping the detail-split render below uses, so the
  // auto-selected lead always matches what's actually on screen.
  const currentDetailFeed = selectedMatchesTab === 'previewed' ? visibleDesktopPreviewedFeed
    : selectedMatchesTab === 'asked' ? visibleDesktopAskedFeed
    : selectedMatchesTab === 'verified' ? visibleDesktopVerifiedFeed
    : visibleDesktopRecentFeed;
  // Checked against the full deduped feed, not the paginated
  // currentDetailFeed — a direct/shared link (getLeadShareUrl) to a lead
  // that exists but hasn't been paginated into the current tab's slice yet
  // is still a valid selection and must not be redirected away from.
  const hasValidDetailSelection = Boolean(
    routeLeadId && dedupedScopedFeed.some((lead) => lead.id === routeLeadId && lead.kind === routeLeadKind),
  );

  // Detail-split layout with nothing selected — a fresh /feed load, or a
  // routeLeadId that doesn't match any lead at all — would otherwise show
  // two empty columns. Auto-select the first visible lead instead, same as
  // Posts' 3-column layout.
  //
  // Guarded to fire at most once per tab: dedupedScopedFeed/currentDetailFeed
  // keep changing reference as this feed streams in more data in the
  // background (confirmed live — a fresh load can produce 900+ leads
  // arriving over several seconds), so re-running this on every list change
  // would re-navigate every time the "first" item shifts — verified via
  // Playwright this produced 78 client-side navigations before settling.
  // Firing once and then leaving the selection alone avoids that churn; the
  // tradeoff (an early, not-fully-sorted "first" item once data is more
  // complete) is preferable to constant flicker.
  const autoSelectedTabRef = useRef<MatchesTabId | null>(null);
  useEffect(() => {
    if (!isDetailLayout || hasValidDetailSelection) return;
    if (autoSelectedTabRef.current === selectedMatchesTab) return;
    const first = currentDetailFeed[0];
    if (!first) return;
    autoSelectedTabRef.current = selectedMatchesTab;
    const search = searchParams.toString();
    navigate(
      { pathname: `${feedBasePath}/${first.kind}/${first.id}`, search: search ? `?${search}` : '' },
      { replace: true },
    );
  }, [isDetailLayout, hasValidDetailSelection, currentDetailFeed, selectedMatchesTab, navigate, feedBasePath, searchParams]);

  const maybeLoadMoreMatches = useCallback((container: HTMLDivElement, canLoadMore: boolean, onLoadMore: () => void) => {
    if (!canLoadMore) return;
    const nearBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 96;
    if (nearBottom) onLoadMore();
  }, []);

  const handleMobileRightPaneScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const nextTop = event.currentTarget.scrollTop;
    const prevTop = mobileRightPaneLastScrollTopRef.current;
    const delta = nextTop - prevTop;
    const now = Date.now();

    if (nextTop <= 0) {
      mobileScrollUpAccumRef.current = 0;
      mobileScrollDownAccumRef.current = 0;
      if (mobileTopCollapsedRef.current) {
        mobileTopCollapsedRef.current = false;
        setIsMobileTopCollapsed(false);
      }
    } else if (now >= mobileCollapseLockUntilRef.current) {
      if (delta > 1) {
        mobileScrollUpAccumRef.current += delta;
        mobileScrollDownAccumRef.current = 0;
        if (!mobileTopCollapsedRef.current && nextTop > 40 && mobileScrollUpAccumRef.current > 16) {
          mobileTopCollapsedRef.current = true;
          setIsMobileTopCollapsed(true);
          mobileCollapseLockUntilRef.current = now + 140;
          mobileScrollUpAccumRef.current = 0;
        }
      } else if (delta < -1) {
        mobileScrollDownAccumRef.current += Math.abs(delta);
        mobileScrollUpAccumRef.current = 0;
        if (mobileTopCollapsedRef.current && mobileScrollDownAccumRef.current > 10) {
          mobileTopCollapsedRef.current = false;
          setIsMobileTopCollapsed(false);
          mobileCollapseLockUntilRef.current = now + 140;
          mobileScrollDownAccumRef.current = 0;
        }
      }
    }

    mobileRightPaneLastScrollTopRef.current = Math.max(0, nextTop);

    maybeLoadMoreMatches(event.currentTarget, canLoadMoreMatches, () => {
      setVisibleMatchesCount((prev) => Math.min(filteredFeed.length, prev + MATCHES_PAGE_SIZE));
    });
  }, [canLoadMoreMatches, filteredFeed.length, maybeLoadMoreMatches]);

  const handleDesktopRecentScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    maybeLoadMoreMatches(event.currentTarget, canLoadMoreDesktopRecent, () => {
      setDesktopRecentVisibleCount((prev) => Math.min(recentVisibleFeed.length, prev + DESKTOP_MATCHES_PAGE_SIZE));
    });
  }, [canLoadMoreDesktopRecent, maybeLoadMoreMatches, recentVisibleFeed.length]);

  const handleDesktopPreviewedScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    maybeLoadMoreMatches(event.currentTarget, canLoadMoreDesktopPreviewed, () => {
      setDesktopPreviewedVisibleCount((prev) => Math.min(previewedVisibleFeed.length, prev + DESKTOP_MATCHES_PAGE_SIZE));
    });
  }, [canLoadMoreDesktopPreviewed, maybeLoadMoreMatches, previewedVisibleFeed.length]);

  const handleDesktopAskedScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    maybeLoadMoreMatches(event.currentTarget, canLoadMoreDesktopAsked, () => {
      setDesktopAskedVisibleCount((prev) => Math.min(askedVisibleFeed.length, prev + DESKTOP_MATCHES_PAGE_SIZE));
    });
  }, [askedVisibleFeed.length, canLoadMoreDesktopAsked, maybeLoadMoreMatches]);

  const handleDesktopVerifiedScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    maybeLoadMoreMatches(event.currentTarget, canLoadMoreDesktopVerified, () => {
      setDesktopVerifiedVisibleCount((prev) => Math.min(verifiedVisibleFeed.length, prev + DESKTOP_MATCHES_PAGE_SIZE));
    });
  }, [canLoadMoreDesktopVerified, maybeLoadMoreMatches, verifiedVisibleFeed.length]);

  useEffect(() => {
    if (isMobileViewport) return;
    const container = desktopMatchesScrollRef.current;
    if (!container) return;

    const hasOverflow = container.scrollHeight > container.clientHeight + 1;
    if (hasOverflow) return;

    if (selectedMatchesTab === 'previewed' && canLoadMoreDesktopPreviewed) {
      setDesktopPreviewedVisibleCount((prev) => Math.min(previewedVisibleFeed.length, prev + DESKTOP_MATCHES_PAGE_SIZE));
      return;
    }

    if (selectedMatchesTab === 'asked' && canLoadMoreDesktopAsked) {
      setDesktopAskedVisibleCount((prev) => Math.min(askedVisibleFeed.length, prev + DESKTOP_MATCHES_PAGE_SIZE));
      return;
    }

    if (selectedMatchesTab === 'verified' && canLoadMoreDesktopVerified) {
      setDesktopVerifiedVisibleCount((prev) => Math.min(verifiedVisibleFeed.length, prev + DESKTOP_MATCHES_PAGE_SIZE));
      return;
    }

    if (selectedMatchesTab === 'queued' && canLoadMoreDesktopRecent) {
      setDesktopRecentVisibleCount((prev) => Math.min(recentVisibleFeed.length, prev + DESKTOP_MATCHES_PAGE_SIZE));
    }
  }, [
    askedVisibleFeed.length,
    canLoadMoreDesktopAsked,
    canLoadMoreDesktopPreviewed,
    canLoadMoreDesktopRecent,
    canLoadMoreDesktopVerified,
    isMobileViewport,
    isTableLayout,
    previewedVisibleFeed.length,
    recentVisibleFeed.length,
    selectedMatchesTab,
    visibleDesktopRecentFeed.length,
    visibleDesktopPreviewedFeed.length,
    visibleDesktopAskedFeed.length,
    visibleDesktopVerifiedFeed.length,
    verifiedVisibleFeed.length,
  ]);

  function getScoreVisual(score: number | null) {
    const rounded = typeof score === 'number' && Number.isFinite(score) && score > 0
      ? Math.round(score)
      : null;

    if (rounded === null) {
      return {
        rounded: null,
        isRecommended: false,
        cardToneClass: 'border-amber-200 bg-amber-50/55',
        badgeClass: 'text-gray-700 bg-white border border-gray-200',
      };
    }
    if (rounded < 60) {
      return {
        rounded,
        isRecommended: false,
        cardToneClass: 'border-red-200 bg-red-50/70',
        badgeClass: 'text-red-700 bg-red-100 border border-red-200',
      };
    }
    if (rounded < 70) {
      return {
        rounded,
        isRecommended: false,
        cardToneClass: 'border-yellow-200 bg-yellow-50/80',
        badgeClass: 'text-amber-800 bg-yellow-100 border border-yellow-200',
      };
    }
    if (rounded < 80) {
      return {
        rounded,
        isRecommended: false,
        cardToneClass: 'border-emerald-200 bg-emerald-50/75',
        badgeClass: 'text-emerald-700 bg-emerald-100 border border-emerald-200',
      };
    }
    return {
      rounded,
      isRecommended: true,
      cardToneClass: 'border-blue-200 bg-gradient-to-br from-emerald-50 via-blue-50 to-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]',
      badgeClass: 'text-blue-700 bg-white/90 border border-blue-200 shadow-sm',
    };
  }

  function getMarketPulseVisual(uniqueJobs: number) {
    const jobs = Number.isFinite(uniqueJobs) ? Math.max(0, Math.round(uniqueJobs)) : 0;

    if (jobs >= 15) {
      return {
        level: 'High',
        cardToneClass: 'border-emerald-200 bg-emerald-50/75',
        badgeClass: 'text-emerald-700 bg-emerald-100 border border-emerald-200',
      };
    }
    if (jobs >= 6) {
      return {
        level: 'Medium',
        cardToneClass: 'border-yellow-200 bg-yellow-50/80',
        badgeClass: 'text-amber-800 bg-yellow-100 border border-yellow-200',
      };
    }
    return {
      level: 'Low',
      cardToneClass: 'border-red-200 bg-red-50/70',
      badgeClass: 'text-red-700 bg-red-100 border border-red-200',
    };
  }

  function renderMarketPulseSymbol(level: string, badgeClass: string, uniqueJobs: number) {
    const shortLevel = level === 'Medium' ? 'Med' : level;
    return (
      <span
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${badgeClass}`}
        title={`Market Pulse ${level} (${uniqueJobs} jobs)`}
        aria-label={`Market Pulse ${level}`}
      >
        <Activity size={10} />
        <span>{shortLevel}</span>
      </span>
    );
  }

  const BUTTON_TONE_BY_BORDER: Record<string, string> = {
    'border-blue-100': 'bg-blue-100/35 hover:bg-blue-100/55',
    'border-violet-100': 'bg-violet-100/35 hover:bg-violet-100/55',
    'border-emerald-100': 'bg-emerald-100/35 hover:bg-emerald-100/55',
    'border-amber-100': 'bg-amber-100/35 hover:bg-amber-100/55',
    'border-rose-100': 'bg-rose-100/35 hover:bg-rose-100/55',
    'border-cyan-100': 'bg-cyan-100/35 hover:bg-cyan-100/55',
  };

  const getMissingJobDetails = (lead: SocialLead) => {
    const breakdownItems = orderPulseBreakdownItems(buildScoreBreakdownDisplayItems(
      lead.scoreBreakdown as Record<string, number | { score: number; candidate_value: string; job_value: string; rule: string }> | undefined,
      undefined,
      {
        employment_type: lead.employmentType || null,
        work_type: null,
      },
    ).filter((item) => !isRoleLikeBreakdownKey(item.key)));

    return Array.from(new Set(breakdownItems
      .filter((item) => {
        const value = (item.detail?.job_value ?? '').trim().toLowerCase();
        return !value || value === '-' || value === 'unknown' || value === 'not specified' || value === 'n/a';
      })
      .map((item) => formatBreakdownFieldName(item.key))));
  };

  const renderClampedSkills = (leadId: string, skillsValue: string, itemCap: number, linkClassName: string) => {
    const skillsList = skillsValue === '-' ? [] : skillsValue.split(',').map((skill) => skill.trim()).filter(Boolean);
    if (skillsList.length === 0) return <PersonaMissingTag />;
    const isExpanded = expandedSkillsLeadIds.has(leadId);
    const visibleSkills = isExpanded ? skillsList : skillsList.slice(0, itemCap);
    const hiddenCount = skillsList.length - visibleSkills.length;
    return (
      <>
        <span className={isExpanded ? '' : 'line-clamp-2'}>{visibleSkills.join(', ')}</span>
        {!isExpanded && hiddenCount > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpandedSkillsLeadIds((prev) => new Set(prev).add(leadId));
            }}
            className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}
          >
            +{hiddenCount} more
          </button>
        )}
        {isExpanded && skillsList.length > itemCap && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpandedSkillsLeadIds((prev) => {
                const next = new Set(prev);
                next.delete(leadId);
                return next;
              });
            }}
            className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}
          >
            Show less
          </button>
        )}
      </>
    );
  };

  const renderClampedField = (leadId: string, fieldKey: string, value: string, linkClassName: string) => {
    if (value === '-') return <PersonaMissingTag />;
    const cellKey = `${leadId}:${fieldKey}`;
    const isExpanded = expandedFieldKeys.has(cellKey);
    const toggleExpanded = () => {
      setExpandedFieldKeys((prev) => {
        const next = new Set(prev);
        if (next.has(cellKey)) next.delete(cellKey);
        else next.add(cellKey);
        return next;
      });
    };
    const parts = value.split(',').map((part) => part.trim()).filter(Boolean);

    if (parts.length > 1) {
      const itemCap = 2;
      const visibleParts = isExpanded ? parts : parts.slice(0, itemCap);
      const hiddenCount = parts.length - visibleParts.length;
      return (
        <>
          <span className={isExpanded ? '' : 'line-clamp-2'}>{visibleParts.join(', ')}</span>
          {!isExpanded && hiddenCount > 0 && (
            <button type="button" onClick={(e) => { e.stopPropagation(); toggleExpanded(); }} className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}>
              +{hiddenCount} more
            </button>
          )}
          {isExpanded && parts.length > itemCap && (
            <button type="button" onClick={(e) => { e.stopPropagation(); toggleExpanded(); }} className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}>
              Show less
            </button>
          )}
        </>
      );
    }

    const isLikelyOverflow = value.length > 36;
    return (
      <>
        <span className={isExpanded ? '' : 'line-clamp-2'}>{value}</span>
        {isLikelyOverflow && (
          <button type="button" onClick={(e) => { e.stopPropagation(); toggleExpanded(); }} className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}>
            {isExpanded ? 'less' : 'more'}
          </button>
        )}
      </>
    );
  };

  // Hotlist leads ARE the consultant, so the pasted text is the job to match against —
  // the opposite direction from the jobs feed (job_context=job, consultant_text=pasted candidate).
  // Swap the payload so the worker's fixed "JOB vs CONSULTANT" prompt still lines up correctly.
  const buildPredictMatchFields = (lead: SocialLead, pastedText: string) => {
    const leadHotlist = leadIsHotlist(lead);
    const { expValue, workTypeValue, employmentTypeValue, visaValue, locationValue, skillsValue } = getLeadBreakdownFieldValues(lead, leadHotlist);
    if (!leadHotlist) {
      return {
        consultantText: pastedText,
        jobContext: { skills: skillsValue, exp: expValue, visa: visaValue, workType: workTypeValue, employmentType: employmentTypeValue, location: locationValue },
      };
    }
    const consultantSummary = [
      skillsValue && `Skills: ${skillsValue}`,
      expValue && `Experience: ${expValue}`,
      workTypeValue && `Work type: ${workTypeValue}`,
      employmentTypeValue && `Employment type: ${employmentTypeValue}`,
      visaValue && `Visa: ${visaValue}`,
      locationValue && `Location: ${locationValue}`,
    ].filter(Boolean).join('\n');
    return {
      consultantText: consultantSummary || 'No consultant details available.',
      jobContext: { skills: pastedText, exp: '', visa: '', workType: '', employmentType: '', location: '' },
    };
  };

  const verdictClassForScore = (score: number) => (
    score >= 80 ? 'text-emerald-600' : score >= 60 ? 'text-blue-600' : score >= 40 ? 'text-amber-600' : 'text-red-600'
  );

  const toggleBulkPredictLead = (leadId: string) => {
    setBulkPredictLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) {
        next.delete(leadId);
        return next;
      }
      if (next.size >= MAX_BULK_PREDICT) {
        showToast(`You can predict up to ${MAX_BULK_PREDICT} jobs at a time`, 'error');
        return prev;
      }
      next.add(leadId);
      return next;
    });
  };

  const handleRunBulkPredict = async () => {
    if (!bulkPredictInput.trim() || bulkPredictSubmitting) return;
    const leadIds = Array.from(bulkPredictLeadIds);
    if (leadIds.length === 0) return;

    setBulkPredictSubmitting(true);
    setBulkPredictCompletedCount(0);
    let successCount = 0;

    for (const leadId of leadIds) {
      const lead = allLoadedLeadsById.get(leadId);
      if (!lead) {
        setBulkPredictCompletedCount((count) => count + 1);
        continue;
      }

      try {
        const consumed = await consumeCredits(PREDICT_COST, 'pulse_predict_match', {
          lead_id: lead.id,
          platform: lead.platform,
          title: lead.title,
          bulk: true,
        });
        if (!consumed) break;

        const { consultantText, jobContext } = buildPredictMatchFields(lead, bulkPredictInput);
        const { data, error } = await supabase.functions.invoke('predict-match', {
          body: {
            lead_id: lead.id,
            platform: lead.platform,
            feed_kind: leadIsHotlist(lead) ? 'hotlist' : 'job',
            role_title: lead.title,
            consultant_text: consultantText,
            account_id: account?.id ?? '',
            job_context: jobContext,
          },
        });

        if (error || data?.error) {
          throw new Error(data?.error || await getFunctionErrorMessage(error, 'Could not calculate the match'));
        }

        const score = Math.max(0, Math.min(100, Math.round(Number(data.score) || 0)));
        const categories: PredictCategory[] = Array.isArray(data.categories) ? data.categories : [];
        const verdict = String(data.verdict || '').trim() || 'Submission likely to be accepted';
        const result = { score, categories, verdict, verdictClass: verdictClassForScore(score) };
        setPredictResultByLeadId((prev) => ({ ...prev, [lead.id]: result }));
        successCount += 1;
      } catch (err) {
        showToast(err instanceof Error ? err.message : `Could not predict ${lead.title || 'a job'}`, 'error');
      } finally {
        setBulkPredictCompletedCount((count) => count + 1);
      }
    }

    setBulkPredictSubmitting(false);
    showToast(`${successCount} of ${leadIds.length} predictions complete`, successCount > 0 ? 'success' : 'error');
    setIsBulkPredictModalOpen(false);
    setBulkPredictInput('');
    setBulkPredictLeadIds(new Set());
  };

  const toggleInlineBreakdown = useCallback((leadId: string) => {
    setExpandedInlineBreakdownLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }, []);

  const expandCardSkills = useCallback((leadId: string) => {
    setExpandedSkillsLeadIds((prev) => new Set(prev).add(leadId));
  }, []);

  const collapseCardSkills = useCallback((leadId: string) => {
    setExpandedSkillsLeadIds((prev) => {
      const next = new Set(prev);
      next.delete(leadId);
      return next;
    });
  }, []);

  const toggleCardField = useCallback((cellKey: string) => {
    setExpandedFieldKeys((prev) => {
      const next = new Set(prev);
      if (next.has(cellKey)) next.delete(cellKey);
      else next.add(cellKey);
      return next;
    });
  }, []);

  // setApplyModalLead is a state setter (always referentially stable), so
  // this wrapper only needs to be created once — kept stable so it doesn't
  // defeat LeadCard's memo() for every card on every render.
  const handleApplyLead = useCallback((applyLead: SocialLead) => setApplyModalLead(applyLead), []);

  // Plain function, not useCallback: its dependency array would eagerly
  // reference handlePreviewPost/handleOpenPostChat/handleAskAI before they're
  // declared further down in this component. Its own referential identity
  // doesn't need to be stable anyway — callers spread the returned object
  // into individual JSX props, so LeadCard's memo compares those directly.
  const buildLeadCardProps = (lead: SocialLead, paletteIndex: number): LeadCardProps => {
    const askedState = askedJobStateByLeadId[lead.id];
    return {
      lead,
      accountId: account?.id,
      userId: user?.id,
      paletteIndex,
      isDark,
      isHotlistFeed: leadIsHotlist(lead),
      feedTimeBasis,
      isLeadRevealed: revealedLeadIds.has(lead.id),
      globalAskedJobState: globalAskedJobStateByLeadId[lead.id],
      predictResult: predictResultByLeadId[lead.id],
      askedRequestedAt: askedState?.requestedAt,
      askedFulfilledAt: askedState?.fulfilledAt,
      revealedAt: revealedAtByLeadId[lead.id],
      isInlineBreakdownExpanded: expandedInlineBreakdownLeadIds.has(lead.id),
      isSkillsExpanded: expandedSkillsLeadIds.has(lead.id),
      isExpFieldExpanded: expandedFieldKeys.has(`${lead.id}:exp`),
      isWorkTypeFieldExpanded: expandedFieldKeys.has(`${lead.id}:workType`),
      isEmpTypeFieldExpanded: expandedFieldKeys.has(`${lead.id}:empType`),
      isRateFieldExpanded: expandedFieldKeys.has(`${lead.id}:rate`),
      isVisaFieldExpanded: expandedFieldKeys.has(`${lead.id}:visa`),
      isLocationFieldExpanded: expandedFieldKeys.has(`${lead.id}:location`),
      isLoadingPreview: loadingPostContentLeadId === lead.id,
      isProcessingAskAI: processingAskAILeadId === lead.id,
      onPreview: handlePreviewPost,
      onAskAI: handleAskAI,
      onApply: handleApplyLead,
      onToggleInlineBreakdown: toggleInlineBreakdown,
      onExpandSkills: expandCardSkills,
      onCollapseSkills: collapseCardSkills,
      onToggleField: toggleCardField,
      bulkSelectable: aiMatch && lead.aiMatchScore != null,
      isBulkSelected: bulkSelectedIds.has(lead.id),
      onToggleBulkSelect: toggleBulkSelect,
    };
  };

  const renderLeadCards = (leads: SocialLead[], columns = 1) => leads.map((lead, idx) => {
    const safeColumns = Math.max(1, columns);
    const row = Math.floor(idx / safeColumns);
    const col = idx % safeColumns;
    // Spread palette by row/column so adjacent cards do not share a tone.
    const paletteIndex = (row + (col * 2)) % CARD_PALETTE.length;
    const card = <LeadCard key={lead.id} {...buildLeadCardProps(lead, paletteIndex)} />;
    if (!aiMatch || lead.aiMatchScore == null) return card;
    // Results run newest-first inside each band, so without a heading the
    // score appearing to drop mid-list looks like a sorting bug.
    const band = aiMatchScoreBand(lead.aiMatchScore);
    const previous = idx > 0 ? leads[idx - 1] : null;
    if (previous && previous.aiMatchScore != null && aiMatchScoreBand(previous.aiMatchScore) === band) return card;
    // A fragment, not a wrapper: in the multi-column grid the heading has to
    // be a grid item itself to span the row, and a wrapper would make the card
    // share its cell.
    return (
      <Fragment key={`band-${lead.id}`}>
        <p className={`col-span-full px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500 ${idx > 0 ? 'pt-3' : ''}`}>
          {AI_MATCH_BAND_LABELS[band]}
        </p>
        {card}
      </Fragment>
    );
  });

  const parseLeadingNumber = (value: string): number => {
    const match = value.match(/-?\d+(\.\d+)?/);
    return match ? parseFloat(match[0]) : Number.NaN;
  };

  const handleTableSortClick = (key: LeadTableSortKey) => {
    if (tableSortKey === key) {
      setTableSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setTableSortKey(key);
      setTableSortDirection('asc');
    }
  };

  const renderLeadTable = (leads: SocialLead[]) => {
    const tableRowSurfaceClass = isDark ? 'bg-[#17181C]' : 'bg-white';
    const tableHeadSurfaceClass = isDark ? 'bg-[#1B1D21]' : 'bg-gray-50';
    const tableBorderClass = isDark ? 'border-white/10' : 'border-gray-200';
    const tableValueClass = isDark ? 'text-[#CBD5E1]' : 'text-slate-700';
    const tableMutedClass = isDark ? 'text-[#94A3B8]' : 'text-gray-500';
    const cellClass = `px-2 py-2 align-top whitespace-normal break-words ${tableValueClass}`;
    const linkClass = isDark ? 'text-blue-300 hover:text-blue-200' : 'text-blue-600 hover:text-blue-700';
    const askButtonClass = 'inline-flex h-7 w-7 shrink-0 items-center justify-center text-gray-500 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400';
    const predictButtonClass = 'inline-flex h-7 w-7 shrink-0 items-center justify-center text-gray-500 transition-opacity hover:opacity-70 dark:text-gray-400';
    const submitStatusClass = 'inline-flex h-7 w-7 shrink-0 items-center justify-center text-blue-600 dark:text-blue-400';
    const previewButtonUsedClass = 'inline-flex h-7 w-7 shrink-0 items-center justify-center text-cyan-600 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-cyan-400';
    const postedLabel = feedTimeBasis === 'created' ? 'Added' : 'Posted';

    const rows = leads.map((lead) => {
      const globalAskedJobState = globalAskedJobStateByLeadId[lead.id];
      const isAskPending = globalAskedJobState === 'asked';
      const isVerified = globalAskedJobState === 'verified';
      const canAskAI = !isAskPending && !isVerified && Boolean(extractPrimaryEmail(lead.posterEmail));
      const leadHotlist = leadIsHotlist(lead);
      const { expValue, workTypeValue, employmentTypeValue, rateValue, visaValue, locationValue, skillsValue } = getLeadBreakdownFieldValues(lead, leadHotlist);
      const postedTimestamp = new Date(feedTimeBasis === 'created' ? lead.createdAt : lead.postedAt).getTime();

      const sortValues: Record<LeadTableSortKey, string | number> = {
        role: (lead.title || '').toLowerCase(),
        exp: parseLeadingNumber(expValue),
        workType: workTypeValue.toLowerCase(),
        empType: employmentTypeValue.toLowerCase(),
        rate: parseLeadingNumber(rateValue),
        visa: visaValue.toLowerCase(),
        location: locationValue.toLowerCase(),
        posted: Number.isNaN(postedTimestamp) ? Number.NEGATIVE_INFINITY : postedTimestamp,
      };

      return {
        lead, isAskPending, isVerified, canAskAI, leadHotlist,
        expValue, workTypeValue, employmentTypeValue, rateValue, visaValue, locationValue, skillsValue,
        sortValues,
      };
    });

    if (tableSortKey) {
      rows.sort((a, b) => {
        const aValue = a.sortValues[tableSortKey];
        const bValue = b.sortValues[tableSortKey];
        let delta: number;
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          const aIsMissing = Number.isNaN(aValue);
          const bIsMissing = Number.isNaN(bValue);
          if (aIsMissing && bIsMissing) delta = 0;
          else if (aIsMissing) delta = 1;
          else if (bIsMissing) delta = -1;
          else delta = aValue - bValue;
        } else {
          delta = String(aValue).localeCompare(String(bValue));
        }
        return tableSortDirection === 'asc' ? delta : -delta;
      });
    }

    const renderSortableHeader = (label: string, key: LeadTableSortKey) => (
      <th className="px-2 py-2 whitespace-normal">
        <button
          type="button"
          onClick={() => handleTableSortClick(key)}
          className={`inline-flex items-center gap-0.5 transition-colors ${tableSortKey === key ? (isDark ? 'text-blue-300' : 'text-blue-700') : 'hover:text-gray-700 dark:hover:text-slate-200'}`}
        >
          <span>{label}</span>
          {tableSortKey === key && (tableSortDirection === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
        </button>
      </th>
    );

    return (
      <>
        {bulkPredictLeadIds.size > 0 && (
          <div className={`sticky top-0 z-[3] mb-1.5 flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-[12px] font-semibold ${isDark ? 'border-orange-400/30 bg-[#1B1D21]' : 'border-orange-200 bg-orange-50'}`}>
            <span className={isDark ? 'text-orange-300' : 'text-orange-700'}>{bulkPredictLeadIds.size} of {MAX_BULK_PREDICT} selected for bulk predict</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBulkPredictLeadIds(new Set())}
                className={isDark ? 'text-slate-400 hover:text-slate-200' : 'text-gray-500 hover:text-gray-700'}
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setIsBulkPredictModalOpen(true)}
                className="inline-flex items-center gap-1 font-bold text-orange-600 transition-opacity hover:opacity-70 dark:text-orange-400"
              >
                <Gauge size={11} strokeWidth={2.5} />
                {!isCombinedFeed && isHotlistFeed ? 'Match Selected' : 'Predict Selected'}
              </button>
            </div>
          </div>
        )}
        <table className="w-full table-fixed border-collapse border-spacing-0 text-left text-[12px]">
        <colgroup>
          <col style={{ width: '3%' }} />
          <col style={{ width: '17%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '5%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '13%' }} />
        </colgroup>
        <thead className={`sticky top-0 z-[2] ${tableHeadSurfaceClass}`}>
          <tr className={`border-b ${tableBorderClass} text-[11px] uppercase tracking-wide ${tableMutedClass}`}>
            <th className="px-2 py-2 whitespace-normal" aria-label="Select for bulk predict" />
            {renderSortableHeader('Role', 'role')}
            {renderSortableHeader('Exp', 'exp')}
            {renderSortableHeader('Work Type', 'workType')}
            {renderSortableHeader('Emp Type', 'empType')}
            {renderSortableHeader('Rate', 'rate')}
            {renderSortableHeader('Visa', 'visa')}
            {renderSortableHeader('Location', 'location')}
            <th className="px-2 py-2 whitespace-normal">Skills</th>
            {renderSortableHeader(postedLabel, 'posted')}
            <th className="px-2 py-2 whitespace-normal">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ lead, isAskPending, isVerified, canAskAI, leadHotlist, expValue, workTypeValue, employmentTypeValue, rateValue, visaValue, locationValue, skillsValue }) => {
            return (
              <tr key={lead.id} className={`border-b ${tableBorderClass} ${tableRowSurfaceClass} hover:bg-gray-50 dark:hover:bg-white/5`}>
                <td className="px-2 py-2 align-top">
                  <input
                    type="checkbox"
                    checked={bulkPredictLeadIds.has(lead.id)}
                    onChange={(e) => { e.stopPropagation(); toggleBulkPredictLead(lead.id); }}
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Select for bulk predict"
                    className="h-3.5 w-3.5 accent-orange-600"
                  />
                </td>
                <td className="px-2 py-2 align-top whitespace-normal break-words font-medium text-gray-900 dark:text-slate-100">
                  <div className="mb-0.5"><LeadKindPill kind={lead.kind} /></div>
                  {renderClampedField(lead.id, 'role', lead.title || (leadHotlist ? 'Available Consultant' : 'Job Opportunity'), linkClass)}
                </td>
                <td className={cellClass}>{renderClampedField(lead.id, 'exp', expValue, linkClass)}</td>
                <td className={cellClass}>{renderClampedField(lead.id, 'workType', workTypeValue, linkClass)}</td>
                <td className={cellClass}>{renderClampedField(lead.id, 'empType', employmentTypeValue, linkClass)}</td>
                <td className={cellClass}>{renderClampedField(lead.id, 'rate', rateValue, linkClass)}</td>
                <td className={cellClass}>{renderClampedField(lead.id, 'visa', visaValue, linkClass)}</td>
                <td className={cellClass}>{renderClampedField(lead.id, 'location', locationValue, linkClass)}</td>
                <td className={cellClass}>
                  {renderClampedSkills(lead.id, skillsValue, 4, linkClass)}
                </td>
                <td className={`px-2 py-2 align-top whitespace-normal break-words ${tableMutedClass}`}>
                  {formatAgo(feedTimeBasis === 'created' ? lead.createdAt : lead.postedAt)}
                </td>
                <td className="px-1.5 py-2 align-top">
                  <div className="flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void shareLead(lead, account?.id, user?.id).then((copied) => { if (copied) showToast('Link copied', 'success'); }); }}
                      title="Share this post"
                      className={askButtonClass}
                    >
                      <Share2 size={12} strokeWidth={2} />
                    </button>
                    {lead.kind === 'job' && lead.postSource === 'user_post' ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setApplyModalLead(lead); }}
                        title="AI Submit — submit a consultant to this job"
                        className={askButtonClass}
                      >
                        <Mail size={12} strokeWidth={2} />
                      </button>
                    ) : isAskPending || isVerified ? (
                      <span
                        title={(() => {
                          const stampIso = isVerified ? (askedJobStateByLeadId[lead.id]?.fulfilledAt ?? askedJobStateByLeadId[lead.id]?.requestedAt) : askedJobStateByLeadId[lead.id]?.requestedAt;
                          const label = isVerified ? 'Verified' : (leadHotlist ? 'Resume already requested' : 'Submission already sent');
                          return stampIso ? `${label} — ${formatAgoCompact(stampIso)}` : label;
                        })()}
                        className={submitStatusClass}
                      >
                        {isVerified ? <BadgeCheck size={14} strokeWidth={2} /> : <Check size={14} strokeWidth={2} />}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleAskAI(lead); }}
                        disabled={!canAskAI || processingAskAILeadId === lead.id}
                        title={!lead.posterEmail ? 'No email' : (lead.postSource === 'user_post' ? 'Request' : 'Send Email')}
                        className={askButtonClass}
                      >
                        {processingAskAILeadId === lead.id ? <span>...</span> : leadHotlist ? <FileText size={12} strokeWidth={2} /> : <Mail size={12} strokeWidth={2} />}
                      </button>
                    )}
                    {!leadHotlist && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handlePreviewPost(lead); }}
                        disabled={loadingPostContentLeadId === lead.id}
                        title="Preview original post"
                        className={postContentViewedLeadIds.has(lead.id) ? previewButtonUsedClass : predictButtonClass}
                      >
                        {loadingPostContentLeadId === lead.id ? <span>...</span> : <Eye size={12} strokeWidth={2} />}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </>
    );
  };

  // Detail-panel layout: a plain, button-free list on the left (click a row
  // to open it) and the full post — structured fields, raw content, and the
  // same actions the cards/table use, now in a sticky footer — on the right.
  // The list column intentionally stays lightweight (title/company/time
  // only); the point of this layout is that the rich detail lives in one
  // place, not duplicated in every row.
  // Stable across renders (navigate itself is stable) so it doesn't defeat
  // LeadCard's memo() for every card in the list — an inline arrow here
  // previously forced all 30+ cards to re-render on every selection change,
  // not just the newly- and previously-selected ones.
  const handleSelectDetailLead = useCallback((selected: SocialLead) => {
    // Carry the query string across: the feed's search, range, page and
    // filters live there now, and a bare path would drop all of them the
    // moment a card is opened.
    const search = searchParams.toString();
    navigate(
      { pathname: `${feedBasePath}/${selected.kind}/${selected.id}`, search: search ? `?${search}` : '' },
      { replace: true },
    );
  }, [feedBasePath, navigate, searchParams]);

  const renderDetailSplitView = (leads: SocialLead[], showPaging = false) => {
    // Fall back to the first result rather than leaving the detail pane blank.
    // The URL's lead only survives while it is still in the list; a search, a
    // filter change or paging forward all replace the list with rows that
    // don't include it, and the pane would otherwise sit empty next to a full
    // column of results.
    const routedLead = routeLeadId
      ? leads.find((lead) => lead.id === routeLeadId && lead.kind === routeLeadKind) ?? null
      : null;
    const selectedLead = routedLead ?? leads[0] ?? null;
    const selectedIsHotlist = selectedLead ? leadIsHotlist(selectedLead) : false;
    const selectedGlobalState = selectedLead ? globalAskedJobStateByLeadId[selectedLead.id] : undefined;
    const selectedIsAskPending = selectedGlobalState === 'asked';
    const selectedIsVerified = selectedGlobalState === 'verified';
    const selectedCanAskAI = selectedLead
      ? !selectedIsAskPending && !selectedIsVerified && Boolean(extractPrimaryEmail(selectedLead.posterEmail))
      : false;
    const selectedIsProcessingAskAI = selectedLead ? processingAskAILeadId === selectedLead.id : false;
    const selectedContent = selectedLead && detailPanelContent?.leadId === selectedLead.id ? detailPanelContent.content : null;
    const selectedContentLoading = selectedLead ? loadingDetailPanelLeadId === selectedLead.id : false;

    return (
      <div className="grid h-full min-h-0 grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-3">
        {/* Deliberately plain block stacking, not CSS grid/flex, for this
            single list column: a grid's "auto" row-track sizing pass
            measures each LeadCard (itself a nested flex column) using its
            min-content contribution, which can land well below its actual
            rendered height — every row collapsed to ~58px regardless of
            real content and cards overlapped. Normal block flow has no such
            pre-sizing pass; each card just takes its own height. */}
        <div className="min-h-0 space-y-1.5 overflow-y-auto pr-1">
          {leads.map((lead, idx) => (
            <LeadCard
              key={lead.id}
              {...buildLeadCardProps(lead, idx)}
              hideActions
              isSelected={selectedLead?.id === lead.id}
              onSelect={handleSelectDetailLead}
            />
          ))}
          {/* Paging belongs to the list, not to the split view: spanning both
              columns would put it under the detail pane it has nothing to do
              with, and inside this scroller it lands at the end of the posts. */}
          {showPaging ? renderFeedPagingFooter() : null}
        </div>

        <aside className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white">
          {!selectedLead ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center">
              <p className="text-[13px] text-gray-400">Select a post to preview</p>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2.5 border-b border-gray-100 p-4">
                <div className="min-w-0 flex-1">
                  <LeadKindPill kind={selectedLead.kind} />
                  <p className="mt-1 text-[15px] font-semibold text-gray-900">
                    {selectedLead.title || (selectedIsHotlist ? 'Available Consultant' : 'Job Opportunity')}
                  </p>
                  {(selectedLead.company || selectedLead.location) && (
                    <p className="mt-0.5 truncate text-[13px] text-gray-500">
                      {selectedLead.company}{selectedLead.company && selectedLead.location ? ' · ' : ''}{selectedLead.location}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const search = searchParams.toString();
                    navigate({ pathname: feedBasePath, search: search ? `?${search}` : '' }, { replace: true });
                  }}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                  aria-label="Close preview"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {selectedLead.experienceYears != null && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{selectedLead.experienceYears}+ yrs</span>
                  )}
                  {selectedLead.hourlyRate && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{selectedLead.hourlyRate}</span>
                  )}
                  {selectedLead.employmentType && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{selectedLead.employmentType}</span>
                  )}
                  {selectedLead.workType && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{selectedLead.workType}</span>
                  )}
                  {selectedLead.visaTypes.map((visa) => (
                    <span key={visa} className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{visa}</span>
                  ))}
                </div>
                {selectedLead.skills.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                    {selectedLead.skills.map((skill) => (
                      <span key={skill} className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-600">{skill}</span>
                    ))}
                  </div>
                )}
                {(selectedLead.posterName || selectedLead.posterEmail) && (
                  <p className="mt-3 text-[12px] text-gray-500">
                    Posted by {selectedLead.posterName || 'Unknown'}{selectedLead.posterEmail ? ` · ${selectedLead.posterEmail}` : ''}
                  </p>
                )}
                {!selectedIsHotlist && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  {selectedContentLoading ? (
                    <div className="flex items-center justify-center py-6"><LogoSpinner size={20} /></div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-700">
                      {selectedContent ?? ''}
                    </p>
                  )}
                </div>
                )}
              </div>

              <div className="flex items-center gap-2 border-t border-gray-100 p-3">
                <button
                  type="button"
                  onClick={() => void shareLead(selectedLead, account?.id, user?.id)}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-gray-50 text-[12px] font-semibold text-gray-600 hover:bg-gray-100"
                >
                  <Share2 size={14} />
                  Share
                </button>
                {selectedLead.kind === 'job' && selectedLead.postSource === 'user_post' ? (
                  <button
                    type="button"
                    onClick={() => setApplyModalLead(selectedLead)}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-blue-600 text-[12px] font-semibold text-white hover:bg-blue-700"
                  >
                    <Mail size={14} />
                    AI Submit
                  </button>
                ) : selectedIsAskPending || selectedIsVerified ? (
                  <span
                    className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-[12px] font-semibold ${selectedIsVerified ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}
                  >
                    {selectedIsVerified ? <BadgeCheck size={14} /> : <Check size={14} />}
                    {selectedIsVerified ? 'Verified' : (selectedIsHotlist ? 'Requested' : 'Submitted')}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleAskAI(selectedLead)}
                    disabled={!selectedCanAskAI || selectedIsProcessingAskAI}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-blue-600 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {selectedIsProcessingAskAI ? <LogoSpinner size={14} /> : selectedLead.postSource === 'user_post' ? (
                      <><FileText size={14} />Request</>
                    ) : (
                      <>{selectedIsHotlist ? <Video size={14} /> : <Mail size={14} />}{selectedIsHotlist ? 'AI Invite' : 'AI Submit'}</>
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    );
  };

  useEffect(() => {
    try { localStorage.setItem(PULSE_LAYOUT_MODE_STORAGE_KEY, layoutMode); } catch {}
  }, [layoutMode]);

  useEffect(() => {
    if (isSwipeLayout && selectedMatchesTab !== 'queued') {
      setSelectedMatchesTab('queued');
    }
  }, [isSwipeLayout, selectedMatchesTab]);

  useEffect(() => {
    setPendingSkillsFilter(feedSearchFilters.skillsQuery);
    setPendingRateMin(feedSearchFilters.rateMin);
    setPendingRateMax(feedSearchFilters.rateMax);
  }, [feedSearchFilters.skillsQuery, feedSearchFilters.rateMin, feedSearchFilters.rateMax]);

  const applyPendingTextFilters = useCallback(() => {
    setFeedSearchFilters((prev) => ({
      ...prev,
      skillsQuery: pendingSkillsFilter,
      rateMin: pendingRateMin,
      rateMax: pendingRateMax,
    }));
  }, [pendingSkillsFilter, pendingRateMin, pendingRateMax]);

  const handleFilterFieldKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') applyPendingTextFilters();
  }, [applyPendingTextFilters]);

  useEffect(() => {
    setProfilePage(1);
  }, [profileRangeId, profileSearchQuery, selectedCategoryId, selectedProfilesView]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 639px)');
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener('change', updateViewport);
    return () => mediaQuery.removeEventListener('change', updateViewport);
  }, []);

  useEffect(() => {
    mobileTopCollapsedRef.current = isMobileTopCollapsed;
  }, [isMobileTopCollapsed]);

  useEffect(() => {
    if (!isMobileViewport) {
      setIsMobileTopCollapsed(false);
      mobileRightPaneLastScrollTopRef.current = 0;
      mobileTopCollapsedRef.current = false;
      mobileScrollUpAccumRef.current = 0;
      mobileScrollDownAccumRef.current = 0;
      mobileCollapseLockUntilRef.current = 0;
    }
  }, [isMobileViewport]);

  useEffect(() => {
    if (!isMobileViewport || !canLoadMoreProfiles) return;
    const root = profileListScrollRef.current;
    const target = mobileProfilesLoadMoreRef.current;
    if (!root || !target) return;

    let requested = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (requested) return;
        if (entries.some((entry) => entry.isIntersecting)) {
          requested = true;
          setProfilePage((prev) => Math.min(totalProfilePages, prev + 1));
        }
      },
      {
        root,
        rootMargin: '0px 0px 120px 0px',
        threshold: 0.1,
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [canLoadMoreProfiles, isMobileViewport, totalProfilePages]);

  const loadWatchingRoles = useCallback(async () => {
    if (!account?.id) return;

    const watchlistResult = await supabase
      .from('watchlist_profiles' as never)
      .select('target_role, is_watching')
      .eq('account_id', account.id);

    if (!watchlistResult.error) {
      const rows = (watchlistResult.data ?? []) as Array<{ target_role: string; is_watching: boolean }>;
      if (rows.length > 0) {
        const active = new Set<string>();
        for (const row of rows) {
          if (row.is_watching) active.add(normalize(row.target_role));
        }
        setWatchingRoles(active);
        return;
      }
    }

    const { data, error } = await supabase
      .from('hotlist_ai_roles')
      .select('id, target_role, is_active, schedule_frequency, category, avatar_url, min_years_exp, max_years_exp, visa_status, employment_type, work_type, preferred_locations, min_rate_usd_per_hr, max_rate_usd_per_hr, relocation_open, priority_skills')
      .eq('account_id', account.id);

    if (error) {
      showToast('Could not load your watch state', 'error');
      return;
    }

    const active = new Set<string>();
    for (const row of data ?? []) {
      const item = row as HotlistRoleRow;
      if (item.is_active && item.schedule_frequency !== 'disabled') {
        active.add(normalize(item.target_role));
      }
    }
    setWatchingRoles(active);
  }, [account?.id, showToast]);

  const loadLeadActionState = useCallback(async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from('pulse_lead_actions')
      .select('lead_id, action_type, created_at')
      .eq('user_id', user.id)
      .in('action_type', ['revealed', 'breakdown', 'post_content_viewed', 'ignored']);

    if (error) {
      return;
    }

    const revealed = new Set<string>();
    const breakdown = new Set<string>();
    const postContentViewed = new Set<string>();
    const ignored = new Set<string>();
    const revealedAt: Record<string, string> = {};
    const postContentViewedAt: Record<string, string> = {};
    for (const row of (data ?? []) as PulseLeadActionRow[]) {
      if (row.action_type === 'revealed') {
        revealed.add(row.lead_id);
        if (row.created_at) revealedAt[row.lead_id] = row.created_at;
      }
      if (row.action_type === 'breakdown') breakdown.add(row.lead_id);
      if (row.action_type === 'post_content_viewed') {
        postContentViewed.add(row.lead_id);
        if (row.created_at) postContentViewedAt[row.lead_id] = row.created_at;
      }
      if (row.action_type === 'ignored') ignored.add(row.lead_id);
    }

    setRevealedLeadIds(revealed);
    setBreakdownChargedLeadIds(breakdown);
    setPostContentViewedLeadIds(postContentViewed);
    setIgnoredLeadIds(ignored);
    setRevealedAtByLeadId(revealedAt);
    setPostContentViewedAtByLeadId(postContentViewedAt);
  }, [user?.id]);

  type AskedStateBundle = {
    stateMap: Record<string, AskedJobState>;
    globalMap: Record<string, GlobalAskedJobState>;
    leadsMap: Record<string, SocialLead>;
  };

  const loadHotlistAskedState = useCallback(async (): Promise<AskedStateBundle> => {
    if (!account?.id || !user?.id) {
      return { stateMap: {}, globalMap: {}, leadsMap: {} };
    }

    const [ownHotlistRequestsResult, hotlistStatesResult] = await Promise.all([
      supabase
        .from('pulse_ask_ai_requests' as never)
        .select('hotlist_id, status, created_at, fulfilled_at')
        .eq('account_id', account.id)
        .eq('user_id', user.id)
        .not('hotlist_id', 'is', null)
        .in('status', ['completed', 'fulfilled'])
        .order('created_at', { ascending: false }),
      supabase.rpc('get_hotlist_asked_states' as never, { p_account_id: account.id }),
    ]);

    if (ownHotlistRequestsResult.error) return { stateMap: {}, globalMap: {}, leadsMap: {} };

    const nextState: Record<string, AskedJobState> = {};
    for (const row of (ownHotlistRequestsResult.data ?? []) as Array<{ hotlist_id: string; created_at: string; fulfilled_at: string | null }>) {
      if (!nextState[row.hotlist_id]) {
        nextState[row.hotlist_id] = { requestedAt: row.created_at, fulfilledAt: row.fulfilled_at };
      }
    }

    const nextHotlistGlobalState: Record<string, GlobalAskedJobState> = {};
    if (!hotlistStatesResult.error) {
      for (const row of (hotlistStatesResult.data ?? []) as Array<{ hotlist_id: string; state: GlobalAskedJobState }>) {
        if (row.state === 'asked' || row.state === 'verified') nextHotlistGlobalState[row.hotlist_id] = row.state;
      }
    }

    const hotlistIds = Array.from(new Set([...Object.keys(nextState), ...Object.keys(nextHotlistGlobalState)]));
    if (hotlistIds.length === 0) {
      return { stateMap: nextState, globalMap: nextHotlistGlobalState, leadsMap: {} };
    }

    const { data: hotlistRows, error: hotlistRowsError } = await supabase
      .from('social_hotlist')
      .select('id, platform, bench_sales_recruiter_name, bench_sales_recruiter_email, bench_sales_recruiter_phone, bench_sales_recruiter_avatar_url, bench_sales_company_name, role_title, core_skills, years_experience, visa_type, employment_type, work_type, locations, hourly_rate_min, hourly_rate_max, raw_post_content, posted_at, created_at, post_source, created_by_account_id, created_by_user_id')
      .in('id', hotlistIds);
    if (hotlistRowsError) return { stateMap: nextState, globalMap: nextHotlistGlobalState, leadsMap: {} };

    const nextHotlistLeads: Record<string, SocialLead> = {};
    for (const row of (hotlistRows ?? []) as Array<{
      id: string; platform: string; bench_sales_recruiter_name: string | null; bench_sales_recruiter_email: string | null;
      bench_sales_recruiter_phone: string | null; bench_sales_recruiter_avatar_url: string | null; bench_sales_company_name: string | null; role_title: string | null;
      core_skills: string[] | null; years_experience: number | null; visa_type: string | null; employment_type: string | null; work_type: string | null;
      locations: string[] | null; hourly_rate_min: number | null; hourly_rate_max: number | null; raw_post_content: string | null;
      posted_at: string | null; created_at: string; post_source: string | null; created_by_account_id: string | null; created_by_user_id: string | null;
    }>) {
      const eventTime = row.posted_at || row.created_at;
      nextHotlistLeads[row.id] = {
        id: row.id,
        title: row.role_title?.trim() || 'Available Consultant',
        roleTitle: row.role_title?.trim() || '',
        location: Array.isArray(row.locations) && row.locations.length > 0 ? row.locations.join(', ') : 'Location not specified',
        company: row.bench_sales_company_name?.trim() || '',
        posterName: row.bench_sales_recruiter_name?.trim() || 'Bench Sales Recruiter',
        posterEmail: row.bench_sales_recruiter_email?.trim() || '',
        posterPhone: row.bench_sales_recruiter_phone?.trim() || '',
        postedAt: eventTime,
        createdAt: row.created_at,
        postedAgo: formatAgo(eventTime),
        platform: row.platform,
        matchScore: null,
        profileId: null,
        scoreBreakdown: null,
        snippet: row.raw_post_content?.trim().slice(0, 150) || '',
        employmentType: row.employment_type?.trim() || '',
        seniority: '',
        salaryRange: '',
        skills: Array.isArray(row.core_skills) ? row.core_skills : [],
        experienceYears: safeNumber(row.years_experience),
        visaTypes: row.visa_type ? [row.visa_type] : [],
        hourlyRate: (safeNumber(row.hourly_rate_min) != null || safeNumber(row.hourly_rate_max) != null)
          ? `$${safeNumber(row.hourly_rate_min) ?? '?'}–$${safeNumber(row.hourly_rate_max) ?? '?'}/hr`
          : '',
        workType: row.work_type?.trim() || '',
        postSource: normalizePostSource(row.post_source),
        authorAccountId: row.created_by_account_id ?? null,
        authorUserId: row.created_by_user_id ?? null,
        authorName: null,
        avatarUrl: row.bench_sales_recruiter_avatar_url?.trim() || null,
        kind: 'hotlist',
      };
    }
    return { stateMap: nextState, globalMap: nextHotlistGlobalState, leadsMap: nextHotlistLeads };
  }, [account?.id, user?.id]);

  const loadJobsAskedState = useCallback(async (): Promise<AskedStateBundle> => {
    if (!account?.id || !user?.id) {
      return { stateMap: {}, globalMap: {}, leadsMap: {} };
    }

    const [ownRequestsResult, globalStatesResult] = await Promise.all([
      supabase
        .from('pulse_ask_ai_requests' as never)
        .select('job_id, status, created_at, fulfilled_at')
        .eq('account_id', account.id)
        .eq('user_id', user.id)
        .in('status', ['completed', 'fulfilled'])
        .order('created_at', { ascending: false }),
      supabase.rpc('get_pulse_asked_job_states' as never, { p_account_id: account.id }),
    ]);

    if (ownRequestsResult.error) return { stateMap: {}, globalMap: {}, leadsMap: {} };

    const nextState: Record<string, AskedJobState> = {};
    for (const row of (ownRequestsResult.data ?? []) as Array<{ job_id: string; created_at: string; fulfilled_at: string | null }>) {
      if (!nextState[row.job_id]) {
        nextState[row.job_id] = { requestedAt: row.created_at, fulfilledAt: row.fulfilled_at };
      }
    }

    const nextGlobalState: Record<string, GlobalAskedJobState> = {};
    if (!globalStatesResult.error) {
      for (const row of (globalStatesResult.data ?? []) as Array<{ job_id: string; state: GlobalAskedJobState }>) {
        if (row.state === 'asked' || row.state === 'verified') nextGlobalState[row.job_id] = row.state;
      }
    }

    const jobIds = Array.from(new Set([...Object.keys(nextState), ...Object.keys(nextGlobalState)]));
    if (jobIds.length === 0) {
      return { stateMap: nextState, globalMap: nextGlobalState, leadsMap: {} };
    }

    const { data: jobRows, error: jobsError } = await supabase
      .from('social_jobs')
      .select('id, platform, posted_by_name, poster_email, poster_phone, avatar_url, created_at, posted_at, job_title, company_name, location, post_content, extracted_role_normalized, employment_type, seniority_level, salary_range, extracted_skills, extracted_experience_years, extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max, post_source, created_by_account_id, created_by_user_id')
      .in('id', jobIds);
    if (jobsError) return { stateMap: nextState, globalMap: nextGlobalState, leadsMap: {} };

    const nextLeads: Record<string, SocialLead> = {};
    for (const row of (jobRows ?? []) as SocialJobRow[]) {
      const eventTime = row.posted_at || row.created_at;
      nextLeads[row.id] = {
        id: row.id,
        title: row.job_title?.trim() || row.extracted_role_normalized?.trim() || row.post_content?.trim().split('\n')[0]?.slice(0, 80) || 'Untitled Job',
        roleTitle: row.job_title?.trim() || row.extracted_role_normalized?.trim() || '',
        location: row.location?.trim() || 'Location not specified',
        company: row.company_name?.trim() || '',
        posterName: row.posted_by_name?.trim() || 'Vendor contact',
        posterEmail: row.poster_email?.trim() || '',
        posterPhone: row.poster_phone?.trim() || '',
        postedAt: eventTime,
        createdAt: row.created_at,
        postedAgo: formatAgo(eventTime),
        platform: row.platform,
        matchScore: null,
        profileId: null,
        scoreBreakdown: null,
        snippet: row.post_content?.trim().slice(0, 150) || '',
        employmentType: row.employment_type?.trim() || '',
        seniority: row.seniority_level?.trim() || '',
        salaryRange: row.salary_range?.trim() || '',
        skills: Array.isArray(row.extracted_skills) ? row.extracted_skills : [],
        experienceYears: safeNumber(row.extracted_experience_years),
        visaTypes: Array.isArray(row.extracted_visa_types) ? row.extracted_visa_types : [],
        hourlyRate: (safeNumber(row.extracted_hourly_rate_min) != null || safeNumber(row.extracted_hourly_rate_max) != null)
          ? `$${safeNumber(row.extracted_hourly_rate_min) ?? '?'}–$${safeNumber(row.extracted_hourly_rate_max) ?? '?'}/hr`
          : '',
        workType: '',
        postSource: normalizePostSource(row.post_source),
        authorAccountId: row.created_by_account_id ?? null,
        authorUserId: row.created_by_user_id ?? null,
        authorName: null,
        avatarUrl: row.avatar_url?.trim() || null,
        kind: 'job',
      };
    }
    return { stateMap: nextState, globalMap: nextGlobalState, leadsMap: nextLeads };
  }, [account?.id, user?.id]);

  const loadAskedJobState = useCallback(async () => {
    if (isCombinedFeed) {
      const [jobs, hotlist] = await Promise.all([loadJobsAskedState(), loadHotlistAskedState()]);
      setAskedJobStateByLeadId({ ...jobs.stateMap, ...hotlist.stateMap });
      setGlobalAskedJobStateByLeadId({ ...jobs.globalMap, ...hotlist.globalMap });
      setAskedLeadsById({ ...jobs.leadsMap, ...hotlist.leadsMap });
      return;
    }
    const result = isHotlistFeed ? await loadHotlistAskedState() : await loadJobsAskedState();
    setAskedJobStateByLeadId(result.stateMap);
    setGlobalAskedJobStateByLeadId(result.globalMap);
    setAskedLeadsById(result.leadsMap);
  }, [isCombinedFeed, isHotlistFeed, loadHotlistAskedState, loadJobsAskedState]);

  const loadPredictedJobState = useCallback(async () => {
    if (!account?.id || !user?.id) {
      setPredictResultByLeadId({});
      return;
    }

    const predictLogQuery = supabase
      .from('pulse_predict_logs' as never)
      .select('lead_id, feed_kind, score, verdict, categories, created_at')
      .eq('account_id', account.id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    const { data, error } = isCombinedFeed
      ? await predictLogQuery.in('feed_kind', ['job', 'hotlist'])
      : await predictLogQuery.eq('feed_kind', isHotlistFeed ? 'hotlist' : 'job');
    if (error) return;

    const nextResults: Record<string, PredictResult> = {};
    const kindByLeadId: Record<string, 'job' | 'hotlist'> = {};
    for (const row of (data ?? []) as Array<{ lead_id: string; feed_kind: 'job' | 'hotlist' | null; score: number | null; verdict: string | null; categories: PredictCategory[] | null; created_at: string }>) {
      if (!row.lead_id || nextResults[row.lead_id]) continue;
      const score = Math.max(0, Math.min(100, Math.round(Number(row.score) || 0)));
      nextResults[row.lead_id] = {
        score,
        categories: Array.isArray(row.categories) ? row.categories : [],
        verdict: row.verdict?.trim() || 'Submission likely to be accepted',
        verdictClass: verdictClassForScore(score),
      };
      kindByLeadId[row.lead_id] = row.feed_kind === 'hotlist' ? 'hotlist' : 'job';
    }
    setPredictResultByLeadId(nextResults);

    const leadIds = Object.keys(nextResults);
    if (leadIds.length === 0) return;
    if (isHotlistFeed && !isCombinedFeed) return;

    const jobLeadIds = isCombinedFeed ? leadIds.filter((id) => kindByLeadId[id] !== 'hotlist') : leadIds;
    if (jobLeadIds.length === 0) return;

    const { data: jobRows, error: jobsError } = await supabase
      .from('social_jobs')
      .select('id, platform, posted_by_name, poster_email, poster_phone, avatar_url, created_at, posted_at, job_title, company_name, location, post_content, extracted_role_normalized, employment_type, seniority_level, salary_range, extracted_skills, extracted_experience_years, extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max, post_source, created_by_account_id, created_by_user_id')
      .in('id', jobLeadIds);
    if (jobsError) return;

    const nextLeads: Record<string, SocialLead> = {};
    for (const row of (jobRows ?? []) as SocialJobRow[]) {
      const eventTime = row.posted_at || row.created_at;
      nextLeads[row.id] = {
        id: row.id,
        title: row.job_title?.trim() || row.extracted_role_normalized?.trim() || row.post_content?.trim().split('\n')[0]?.slice(0, 80) || 'Untitled Job',
        roleTitle: row.job_title?.trim() || row.extracted_role_normalized?.trim() || '',
        location: row.location?.trim() || 'Location not specified',
        company: row.company_name?.trim() || '',
        posterName: row.posted_by_name?.trim() || 'Vendor contact',
        posterEmail: row.poster_email?.trim() || '',
        posterPhone: row.poster_phone?.trim() || '',
        postedAt: eventTime,
        createdAt: row.created_at,
        postedAgo: formatAgo(eventTime),
        platform: row.platform,
        matchScore: null,
        profileId: null,
        scoreBreakdown: null,
        snippet: row.post_content?.trim().slice(0, 150) || '',
        employmentType: row.employment_type?.trim() || '',
        seniority: row.seniority_level?.trim() || '',
        salaryRange: row.salary_range?.trim() || '',
        skills: Array.isArray(row.extracted_skills) ? row.extracted_skills : [],
        experienceYears: safeNumber(row.extracted_experience_years),
        visaTypes: Array.isArray(row.extracted_visa_types) ? row.extracted_visa_types : [],
        hourlyRate: (safeNumber(row.extracted_hourly_rate_min) != null || safeNumber(row.extracted_hourly_rate_max) != null)
          ? `$${safeNumber(row.extracted_hourly_rate_min) ?? '?'}–$${safeNumber(row.extracted_hourly_rate_max) ?? '?'}/hr`
          : '',
        workType: '',
        postSource: normalizePostSource(row.post_source),
        authorAccountId: row.created_by_account_id ?? null,
        authorUserId: row.created_by_user_id ?? null,
        authorName: null,
        avatarUrl: row.avatar_url?.trim() || null,
        kind: 'job',
      };
    }
    setAskedLeadsById((prev) => ({ ...prev, ...nextLeads }));
  }, [account?.id, isCombinedFeed, isHotlistFeed, user?.id]);

  const loadLeaderboard = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_pulse_persona_leaderboard', { limit_count: LEADERBOARD_RPC_LIMIT });

    if (!error) {
      const rows = (data ?? []) as LeaderboardRpcRow[];
      const rpcLeaderboard = rows.map((row) => ({
        target_role: row.target_role,
        summary: row.summary,
        active_watchers: Number(row.active_watchers ?? 0),
        avatar_url: row.avatar_url,
        rank: row.rank,
      }));

      const { data: rolesData, error: rolesError } = await supabase
        .from('hotlist_ai_roles')
        .select('target_role, is_active, schedule_frequency, avatar_url, updated_at, min_years_exp, max_years_exp, visa_status, employment_type, work_type, preferred_locations, min_rate_usd_per_hr, max_rate_usd_per_hr, priority_skills, relocation_open');

      if (!rolesError) {
        const allRolesLeaderboard = buildFallbackLeaderboardFromRoles((rolesData ?? []) as FallbackRoleRow[]);
        const mergedByRole = new Map<string, PulsePersona>();

        for (const item of allRolesLeaderboard) {
          mergedByRole.set(normalize(item.target_role), item);
        }

        for (const item of rpcLeaderboard) {
          const bucket = getPersonaBucket(item.target_role);
          const key = bucket.key;
          const existing = mergedByRole.get(key);
          mergedByRole.set(key, {
            target_role: bucket.title,
            summary: item.summary || existing?.summary || bucket.summary,
            active_watchers: item.active_watchers,
            avatar_url: item.avatar_url || existing?.avatar_url || null,
            rank: 0,
            min_years_exp: existing?.min_years_exp,
            max_years_exp: existing?.max_years_exp,
            visa_status: existing?.visa_status,
            employment_type: existing?.employment_type,
            work_type: existing?.work_type,
            preferred_locations: existing?.preferred_locations,
            min_rate_usd_per_hr: existing?.min_rate_usd_per_hr,
            max_rate_usd_per_hr: existing?.max_rate_usd_per_hr,
            priority_skills: existing?.priority_skills,
            relocation_open: existing?.relocation_open,
          });
        }

        setLeaderboard(Array.from(mergedByRole.values()));
      } else {
        setLeaderboard(rpcLeaderboard);
      }
      return;
    }

    const { data: rolesData, error: rolesError } = await supabase
      .from('hotlist_ai_roles')
      .select('target_role, is_active, schedule_frequency, updated_at, min_years_exp, max_years_exp, visa_status, employment_type, work_type, preferred_locations, min_rate_usd_per_hr, max_rate_usd_per_hr, priority_skills, relocation_open');

    if (!rolesError) {
      setLeaderboard(buildFallbackLeaderboardFromRoles((rolesData ?? []) as FallbackRoleRow[]));
      return;
    }

    setLeaderboard(buildSeedLeaderboard());
    showToast('Could not load market board yet', 'error');
  }, [showToast]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadLeaderboard(), loadWatchingRoles(), loadLeadActionState(), loadAskedJobState(), loadPredictedJobState()]);

    try {
      const { data: latestRows } = await supabase.rpc(
        (!isCombinedFeed && isHotlistFeed) ? 'get_social_hotlist_feed_page' : 'get_pulse_social_feed',
        (!isCombinedFeed && isHotlistFeed)
          ? { p_since: '1970-01-01T00:00:00.000Z', p_before_posted_at: null, p_before_lead_id: null, p_limit: 1 }
          : { p_since: '1970-01-01T00:00:00.000Z', p_limit: 1 } as never,
      );
      const latest = (latestRows?.[0] as PulseSocialFeedRpcRow | undefined)?.match_created_at;
      if (latest) setLastMatchAt(latest);
    } catch {
      // Leave lastMatchAt unchanged on failure.
    }

    setLoading(false);
  }, [isCombinedFeed, isHotlistFeed, loadAskedJobState, loadLeaderboard, loadWatchingRoles, loadLeadActionState, loadPredictedJobState]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadGlobalPulseRowsFromCacheWorker = useCallback(async (rangeHours: number, kind: 'jobs' | 'hotlist') => {
    if (kind === 'hotlist') return null;
    if (!PULSE_CACHE_WORKER_URL) return null;

    try {
      const url = new URL(PULSE_CACHE_WORKER_URL);
      url.searchParams.set('hours', String(rangeHours));
      url.searchParams.set('limit', '25000');

      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      if (PULSE_CACHE_WORKER_TOKEN) {
        headers.Authorization = `Bearer ${PULSE_CACHE_WORKER_TOKEN}`;
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers,
      });
      if (!response.ok) return null;

      const payload = (await response.json()) as PulseFeedCacheWorkerResponse;
      if (!Array.isArray(payload.rows)) return null;
      return payload.rows;
    } catch {
      return null;
    }
  }, []);

  const loadGlobalPulseRows = useCallback(async (rangeHours: number, kind: 'jobs' | 'hotlist') => {
    const isHotlistFeed = kind === 'hotlist';
    const useCreatedTime = canSelectFeedTimeBasis && feedTimeBasis === 'created';
    const workerRows = useCreatedTime ? null : await loadGlobalPulseRowsFromCacheWorker(rangeHours, kind);
    if (workerRows) {
      return workerRows;
    }

    const since = new Date(Date.now() - (rangeHours * 60 * 60 * 1000)).toISOString();
    const rpcSince = useCreatedTime ? '1970-01-01T00:00:00.000Z' : since;
    const filterBySelectedTime = (rows: PulseSocialFeedRpcRow[]) => useCreatedTime
      ? rows.filter((row) => new Date(row.social_created_at).getTime() >= new Date(since).getTime())
      : rows;

    const pagedRows: PulseSocialFeedRpcRow[] = [];
    let beforePostedAt: string | null = null;
    let beforeLeadId: string | null = null;
    let pagedRpcAvailable = true;

    while (pagedRows.length < 25000) {
      const pageResult = await supabase.rpc(isHotlistFeed ? 'get_social_hotlist_feed_page' : 'get_pulse_social_feed_page', {
        p_since: rpcSince,
        p_before_posted_at: beforePostedAt,
        p_before_lead_id: beforeLeadId,
        p_limit: 1000,
      } as never);
      if (pageResult.error) {
        pagedRpcAvailable = false;
        break;
      }

      const page = (pageResult.data ?? []) as PulseSocialFeedRpcRow[];
      pagedRows.push(...page);
      if (page.length < 1000) return filterBySelectedTime(pagedRows);

      const last = page[page.length - 1];
      if (!last?.effective_posted_at || !last.lead_id) break;
      beforePostedAt = last.effective_posted_at;
      beforeLeadId = last.lead_id;
    }

    if (pagedRpcAvailable) return filterBySelectedTime(pagedRows);
    if (isHotlistFeed) return [];

    // Preferred path: global SECURITY DEFINER RPC (all-account feed).
    const rpcResult = await supabase.rpc('get_pulse_social_feed', {
      p_since: rpcSince,
      p_limit: 5000,
    } as never);
    if (!rpcResult.error) {
      const rows = filterBySelectedTime((rpcResult.data ?? []) as PulseSocialFeedRpcRow[]);
      if (rows.length > 0) {
        const socialLeadIds = rows.map((row) => row.lead_id).filter(Boolean);
        const { data: matchRows, error: matchError } = await supabase
          .from('radar_match_results')
          .select('job_id, job_source, role_title, core_skills, years_experience, visa_types, employment_type, work_type, locations, hourly_rate_min, hourly_rate_max, relocation_required, extracted_fields')
          .eq('job_source', 'social')
          .in('job_id', socialLeadIds)
          .order('created_at', { ascending: false });

        if (!matchError && Array.isArray(matchRows) && matchRows.length > 0) {
          const latestByJobId = new Map<string, Record<string, unknown>>();
          for (const matchRow of matchRows as Array<Record<string, unknown>>) {
            const jobId = String(matchRow.job_id ?? '');
            if (!jobId) continue;
            const current = latestByJobId.get(jobId);
            if (!current) {
              latestByJobId.set(jobId, matchRow);
              continue;
            }
            const currentTs = new Date(String(current.created_at ?? '1970-01-01T00:00:00.000Z')).getTime();
            const nextTs = new Date(String(matchRow.created_at ?? '1970-01-01T00:00:00.000Z')).getTime();
            if (nextTs > currentTs) latestByJobId.set(jobId, matchRow);
          }

          return rows.map((row) => {
            const extra = latestByJobId.get(row.lead_id);
            if (!extra) return row;
            const extractedFields = (extra.extracted_fields as Record<string, unknown> | null | undefined) ?? null;
            const normalizedSkills = Array.isArray(extra.core_skills)
              ? (extra.core_skills as string[])
              : Array.isArray(extractedFields?.core_skills)
                ? (extractedFields.core_skills as string[])
                : null;
            const normalizedVisaTypes = Array.isArray(extra.visa_types)
              ? (extra.visa_types as string[])
              : Array.isArray(extractedFields?.visa_types)
                ? (extractedFields.visa_types as string[])
                : null;
            const normalizedLocations = Array.isArray(extra.locations)
              ? (extra.locations as string[])
              : Array.isArray(extractedFields?.locations)
                ? (extractedFields.locations as string[])
                : null;

            return {
              ...row,
              role_title: (extra.role_title as string | null | undefined) ?? row.role_title ?? row.job_title ?? null,
              core_skills: normalizedSkills,
              years_experience: (extra.years_experience as number | null | undefined) ?? (extractedFields?.years_experience as number | null | undefined) ?? row.extracted_experience_years ?? null,
              visa_types: normalizedVisaTypes,
              employment_type: (extra.employment_type as string | null | undefined) ?? (extractedFields?.employment_type as string | null | undefined) ?? row.employment_type ?? null,
              work_type: (extra.work_type as string | null | undefined) ?? (extractedFields?.work_type as string | null | undefined) ?? row.work_type ?? null,
              locations: normalizedLocations,
              hourly_rate_min: (extra.hourly_rate_min as number | null | undefined) ?? (extractedFields?.hourly_rate_min as number | null | undefined) ?? row.extracted_hourly_rate_min ?? null,
              hourly_rate_max: (extra.hourly_rate_max as number | null | undefined) ?? (extractedFields?.hourly_rate_max as number | null | undefined) ?? row.extracted_hourly_rate_max ?? null,
              relocation_required: (extra.relocation_required as boolean | null | undefined) ?? (extractedFields?.relocation_required as boolean | null | undefined) ?? null,
            } as PulseSocialFeedRpcRow;
          });
        }
      }
      return rows;
    }

    // Fallback path: direct table reads (subject to project RLS).
    const { data: matchData, error: matchError } = await supabase
      .from('radar_match_results')
      .select('profile_id, job_source, job_id, created_at, final_average_score, score_breakdown')
      .eq('job_source', 'social')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000);

    if (matchError) {
      throw rpcResult.error;
    }

    const latestByJobKey = new Map<string, {
      profile_id: string | null;
      job_source: string;
      job_id: string;
      created_at: string;
      final_average_score: number | null;
      score_breakdown: Record<string, unknown> | null;
    }>();

    for (const row of (matchData ?? []) as Array<{
      profile_id: string | null;
      job_source: string;
      job_id: string;
      created_at: string;
      final_average_score: number | null;
      score_breakdown: Record<string, unknown> | null;
    }>) {
      const source = (row.job_source ?? '').trim() || 'unknown';
      if (!row.job_id) continue;
      const jobKey = `${source}:${row.job_id}`;
      const prev = latestByJobKey.get(jobKey);
      if (!prev || new Date(row.created_at).getTime() > new Date(prev.created_at).getTime()) {
        latestByJobKey.set(jobKey, {
          profile_id: row.profile_id,
          job_source: source,
          job_id: row.job_id,
          created_at: row.created_at,
          final_average_score: row.final_average_score,
          score_breakdown: row.score_breakdown,
        });
      }
    }

    const latestMatches = Array.from(latestByJobKey.values());
    if (latestMatches.length === 0) return [];

    const socialJobIds = latestMatches
      .filter((row) => row.job_source === 'social')
      .map((row) => row.job_id);

    const socialById = new Map<string, SocialJobRow>();
    if (socialJobIds.length > 0) {
      const { data: socialData, error: socialError } = await supabase
        .from('social_jobs')
        .select('id, platform, posted_by_name, poster_email, poster_phone, avatar_url, created_at, posted_at, job_title, company_name, location, post_content, extracted_role_normalized, employment_type, seniority_level, salary_range, extracted_skills, extracted_experience_years, extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max')
        .in('id', socialJobIds);

      if (socialError) {
        throw rpcResult.error;
      }

      for (const row of (socialData ?? []) as SocialJobRow[]) {
        socialById.set(row.id, row);
      }
    }

    return latestMatches.map((match) => {
      const social = match.job_source === 'social' ? socialById.get(match.job_id) : null;
      const leadId = social ? social.id : `${match.job_source}:${match.job_id}`;

      return {
        lead_id: leadId,
        profile_id: match.profile_id,
        match_created_at: match.created_at,
        final_average_score: match.final_average_score,
        score_breakdown: match.score_breakdown,
        platform: social?.platform ?? match.job_source,
        posted_by_name: social?.posted_by_name ?? 'Unknown poster',
        poster_email: social?.poster_email ?? '',
        poster_phone: social?.poster_phone ?? '',
        social_created_at: social?.created_at ?? match.created_at,
        posted_at: social?.posted_at ?? null,
        job_title: social?.job_title ?? `${match.job_source.toUpperCase()} Job`,
        company_name: social?.company_name ?? '',
        location: social?.location ?? 'Location not specified',
        post_content: social?.post_content ?? '',
        extracted_role_normalized: social?.extracted_role_normalized ?? null,
        employment_type: social?.employment_type ?? '',
        seniority_level: social?.seniority_level ?? '',
        salary_range: social?.salary_range ?? '',
        extracted_skills: social?.extracted_skills ?? [],
        extracted_experience_years: social?.extracted_experience_years ?? null,
        extracted_visa_types: social?.extracted_visa_types ?? [],
        extracted_hourly_rate_min: social?.extracted_hourly_rate_min ?? null,
        extracted_hourly_rate_max: social?.extracted_hourly_rate_max ?? null,
        avatar_url: social?.avatar_url ?? null,
      } as PulseSocialFeedRpcRow;
    });
  }, [canSelectFeedTimeBasis, feedTimeBasis, loadGlobalPulseRowsFromCacheWorker]);

  const getGlobalPulseRows = useCallback(async (rangeHours: number, forceRefresh = false) => {
    const now = Date.now();
    const hasFreshCache = pulseRowsCacheRef.current
      && pulseRowsCacheRangeHoursRef.current === rangeHours
      && pulseRowsCacheTimeBasisRef.current === feedTimeBasis
      && (now - pulseRowsCacheAtRef.current) <= PULSE_ROWS_CACHE_TTL_MS;

    if (!forceRefresh && hasFreshCache) {
      return pulseRowsCacheRef.current;
    }

    if (!forceRefresh && pulseRowsRequestRef.current
      && pulseRowsRequestRef.current.hours === rangeHours
      && pulseRowsRequestRef.current.timeBasis === feedTimeBasis) {
      return pulseRowsRequestRef.current.request;
    }

    // Combined feed used to fetch both kinds and merge — now the account's
    // persona always pins feedKindFilter to exactly one kind (Vendor →
    // hotlist, Bench Sales → job), so only fetch that one and skip the
    // wasted RPC call for the kind nobody can see anyway.
    const request = (
      isCombinedFeed
        ? loadGlobalPulseRows(rangeHours, feedKindFilter === 'hotlist' ? 'hotlist' : 'jobs')
          .then((rows) => rows.map((row) => ({ ...row, _kind: feedKindFilter === 'hotlist' ? 'hotlist' as const : 'jobs' as const })))
        : loadGlobalPulseRows(rangeHours, isHotlistFeed ? 'hotlist' : 'jobs')
    )
      .then((rows) => {
        pulseRowsCacheRef.current = rows;
        pulseRowsCacheAtRef.current = Date.now();
        pulseRowsCacheRangeHoursRef.current = rangeHours;
        pulseRowsCacheTimeBasisRef.current = feedTimeBasis;
        return rows;
      })
      .finally(() => {
        pulseRowsRequestRef.current = null;
      });

    pulseRowsRequestRef.current = { hours: rangeHours, timeBasis: feedTimeBasis, request };
    return request;
  }, [feedKindFilter, feedTimeBasis, isCombinedFeed, isHotlistFeed, loadGlobalPulseRows]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedFeedFilters(feedSearchFilters), 300);
    return () => window.clearTimeout(timer);
  }, [feedSearchFilters]);

  // Facet counts + the total, for the whole window rather than the loaded pages.
  useEffect(() => {
    // AI Match shows a scored shortlist, not the window; its count is simply
    // the number of results, which the tab falls back to when this is null.
    if (aiMatch) return;
    let cancelled = false;
    const facetKind: 'jobs' | 'hotlist' = isCombinedFeed
      ? (feedKindFilter === 'hotlist' ? 'hotlist' : 'jobs')
      : (isHotlistFeed ? 'hotlist' : 'jobs');
    const since = new Date(Date.now() - (selectedProfileRange.hours * 60 * 60 * 1000)).toISOString();
    const query = feedSearchQuery.trim();

    const countArgs = {
      p_since: since,
      p_query: query || null,
      ...buildFeedFilterArgs(appliedFeedFilters),
    };

    // The total is fetched on its own, ahead of the breakdown. It is the number
    // the Recent tab shows, and it has to be right: deriving it from the facet
    // RPC meant that whenever that slower query timed out, the tab quietly fell
    // back to counting loaded rows and reported the page size (100) as though
    // it were the whole window.
    void (async () => {
      const { data, error } = await supabase.rpc(
        facetKind === 'hotlist' ? 'get_social_hotlist_feed_total' : 'get_pulse_social_feed_total',
        countArgs as never,
      );
      if (cancelled || error) return;
      const total = Number(data);
      setFeedTotalCount(Number.isFinite(total) ? total : null);
    })();

    void (async () => {
      const { data, error } = await supabase.rpc(
        facetKind === 'hotlist' ? 'get_social_hotlist_feed_facets' : 'get_pulse_social_feed_facets',
        countArgs as never,
      );
      // Counts are decoration: a failure leaves the previous numbers rather
      // than blanking the sidebar or surfacing a toast for something the user
      // didn't ask for.
      if (cancelled || error || !Array.isArray(data)) return;

      const nextCounts: Record<FeedFacetCategory, Record<string, number>> = {
        experienceRange: {}, workType: {}, employmentType: {}, visaStatus: {},
      };
      for (const row of data as Array<{ facet_category: string; facet_value: string; facet_count: number }>) {
        // The RPC still returns a 'total' row; it is owned by the dedicated
        // total RPC above now, so it is ignored here rather than racing it.
        if (row.facet_category === 'total') continue;
        const bucket = nextCounts[row.facet_category as FeedFacetCategory];
        if (!bucket) continue;
        bucket[row.facet_value] = Number(row.facet_count) || 0;
      }
      setServerFacetCounts(nextCounts);
    })();

    return () => { cancelled = true; };
  }, [aiMatch, appliedFeedFilters, feedKindFilter, feedSearchQuery, isCombinedFeed, isHotlistFeed, selectedProfileRange.hours]);

  // One page of the feed, straight from the _v2 RPCs. Browsing pages by keyset
  // on (effective_posted_at, lead_id); searching orders by FTS rank, so it
  // pages by offset instead. Filters go with the request either way, so a page
  // never arrives pre-filtered on the server and then thinned again here.
  const fetchFeedPage = useCallback(async (options: {
    rangeHours: number;
    kind: 'jobs' | 'hotlist';
    query: string;
    filters: FeedSearchFilters;
    cursor: FeedCursor | null;
  }): Promise<{ rows: PulseSocialFeedRpcRow[]; nextCursor: FeedCursor | null }> => {
    const since = new Date(Date.now() - (options.rangeHours * 60 * 60 * 1000)).toISOString();
    const query = options.query.trim();
    const isSearching = query.length > 0;

    const { data, error } = await supabase.rpc(
      options.kind === 'hotlist' ? 'get_social_hotlist_feed_page_v2' : 'get_pulse_social_feed_page_v2',
      {
        p_since: since,
        p_before_posted_at: options.cursor?.postedAt ?? null,
        p_before_lead_id: options.cursor?.leadId ?? null,
        p_limit: FEED_PAGE_SIZE,
        p_query: isSearching ? query : null,
        // Honoured by the RPC whenever no keyset cursor is sent, which is how a
        // refreshed ?page=3 lands on page three without walking the chain.
        p_offset: options.cursor?.offset ?? 0,
        ...buildFeedFilterArgs(options.filters),
      } as never,
    );
    if (error) throw error;

    const rows = (data ?? []) as PulseSocialFeedRpcRow[];
    // A short page means the window is exhausted. A full one might be the last
    // page exactly, in which case the next request simply comes back empty.
    if (rows.length < FEED_PAGE_SIZE) return { rows, nextCursor: null };

    const last = rows[rows.length - 1];
    const nextCursor: FeedCursor = isSearching
      ? { postedAt: null, leadId: null, offset: (options.cursor?.offset ?? 0) + rows.length }
      : { postedAt: last?.effective_posted_at ?? null, leadId: last?.lead_id ?? null, offset: 0 };
    // Without both keyset parts the cursor can't advance; stop rather than
    // re-request the same page forever.
    if (!isSearching && (!nextCursor.postedAt || !nextCursor.leadId)) return { rows, nextCursor: null };
    return { rows, nextCursor };
  }, []);

  const loadProfileStats = useCallback(async (rowsOverride?: PulseSocialFeedRpcRow[]) => {
    if (sortedLeaderboard.length === 0) {
      setProfileStatsByRole({});
      return;
    }

    setProfileStatsLoading(true);
    let rpcRows: PulseSocialFeedRpcRow[] = [];
    try {
      rpcRows = rowsOverride ?? await getGlobalPulseRows(PROFILE_STATS_WINDOW_HOURS);
    } catch {
      showToast('Could not load profile stats', 'error');
      setProfileStatsLoading(false);
      return;
    }

    if (rpcRows.length === 0) {
      const emptyStats = Object.fromEntries(
        sortedLeaderboard.map((item) => [normalize(item.target_role), { ...zeroStats }]),
      ) as Record<string, ProfileStats>;
      setProfileStatsByRole(emptyStats);
      setProfileStatsLoading(false);
      return;
    }

    const rows = rpcRows.map((row) => ({
      id: row.lead_id,
      company_name: row.company_name,
      posted_by_name: row.posted_by_name,
      poster_email: row.poster_email,
      poster_phone: row.poster_phone,
      job_title: row.job_title,
      post_content: row.post_content,
      extracted_role_normalized: row.extracted_role_normalized,
      match_score: typeof row.final_average_score === 'number' && Number.isFinite(row.final_average_score) && row.final_average_score > 0
        ? row.final_average_score
        : null,
    })) as Array<Pick<SocialJobRow, 'id' | 'company_name' | 'posted_by_name' | 'poster_email' | 'poster_phone' | 'job_title' | 'post_content' | 'extracted_role_normalized'> & { match_score: number | null }>;
    const stats: Record<string, ProfileStats> = {};
    // Each row's title/content normalization is identical across every
    // persona in the leaderboard — hoisting it out of the persona loop turns
    // an O(personas x rows) normalize-heavy cost into O(rows) once, reused
    // by every persona below.
    const rowProfiles = rows.map((row) => buildRowMatchProfile(row as SocialJobRow));

    for (const persona of sortedLeaderboard) {
      const roleKey = normalize(persona.target_role);
      const skills = getPersonaSkillList(persona.target_role, persona.priority_skills);
      const personaProfile = buildPersonaMatchProfile(persona.target_role, skills);
      const companies = new Set<string>();
      const vendors = new Set<string>();
      const jobs = new Set<string>();
      let matchScoreSum = 0;
      let matchScoreCount = 0;

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        if (!matchesPersonaProfile(rowProfiles[rowIndex], personaProfile)) continue;

        jobs.add(row.id);
        if (typeof row.match_score === 'number') {
          matchScoreSum += row.match_score;
          matchScoreCount += 1;
        }

        const company = (row.company_name ?? '').trim();
        if (company) companies.add(normalize(company));

        const vendorKey = (row.poster_email ?? '').trim()
          || (row.poster_phone ?? '').trim()
          || normalize((row.posted_by_name ?? '').trim());
        if (vendorKey) vendors.add(vendorKey);
      }

      stats[roleKey] = {
        uniqueCompanies: companies.size,
        uniqueVendors: vendors.size,
        uniqueJobs: jobs.size,
        avgMatchScore: matchScoreCount > 0 ? (matchScoreSum / matchScoreCount) : null,
      };
    }

    setProfileStatsByRole(stats);
    setProfileStatsLoading(false);
  }, [getGlobalPulseRows, selectedProfileRange.hours, showToast, sortedLeaderboard, zeroStats]);

  useEffect(() => {
    void loadProfileStats();
  }, [loadProfileStats]);

  const loadFeed = useCallback(async (
    _persona: PulsePersona | null,
    _personaFilters: PulsePersona[] = [],
    rowsOverride?: PulseSocialFeedRpcRow[],
    options?: { cursor?: FeedCursor | null },
  ) => {
    setFeedLoading(true);

    const feedRowKind: 'jobs' | 'hotlist' = isCombinedFeed
      ? (feedKindFilter === 'hotlist' ? 'hotlist' : 'jobs')
      : (isHotlistFeed ? 'hotlist' : 'jobs');

    let rpcRows: PulseSocialFeedRpcRow[] = [];
    try {
      if (rowsOverride) {
        rpcRows = rowsOverride;
      } else {
        const page = await fetchFeedPage({
          rangeHours: selectedProfileRange.hours,
          kind: feedRowKind,
          query: feedSearchQuery,
          filters: appliedFeedFilters,
          cursor: options?.cursor ?? null,
        });
        rpcRows = isCombinedFeed
          ? page.rows.map((row) => ({ ...row, _kind: feedRowKind }))
          : page.rows;
        feedCursorRef.current = page.nextCursor;
        setFeedHasMore(page.nextCursor != null);
      }
    } catch {
      showToast('Failed to load social matches', 'error');
      setFeedLoading(false);
      return;
    }

    if (rpcRows.length === 0) {
      setFeed([]);
      setFeedLoading(false);
      return;
    }

    const socialData: SocialJobRow[] = rpcRows.map((row) => ({
      id: row.lead_id,
      platform: row.platform,
      posted_by_name: row.posted_by_name,
      poster_email: row.poster_email,
      poster_phone: row.poster_phone,
      created_at: row.social_created_at,
      posted_at: row.posted_at,
      job_title: row.job_title,
      company_name: row.company_name,
      location: row.location,
      post_content: row.post_content,
      extracted_role_normalized: row.extracted_role_normalized,
      employment_type: row.employment_type,
      seniority_level: row.seniority_level,
      salary_range: row.salary_range,
      extracted_skills: row.extracted_skills,
      extracted_experience_years: row.extracted_experience_years,
      extracted_visa_types: row.extracted_visa_types,
      extracted_hourly_rate_min: row.extracted_hourly_rate_min,
      extracted_hourly_rate_max: row.extracted_hourly_rate_max,
      role_title: row.role_title ?? null,
      core_skills: row.core_skills ?? null,
      years_experience: row.years_experience ?? null,
      visa_types: row.visa_types ?? null,
      employment_type_status: row.employment_type ?? null,
      work_type: row.work_type ?? null,
      locations: row.locations ?? null,
      hourly_rate_min: row.hourly_rate_min ?? null,
      hourly_rate_max: row.hourly_rate_max ?? null,
      relocation_required: row.relocation_required ?? null,
      post_source: row.post_source ?? null,
      created_by_account_id: row.created_by_account_id ?? null,
      created_by_user_id: row.created_by_user_id ?? null,
      author_display_name: row.author_display_name ?? null,
      avatar_url: row.avatar_url ?? null,
      _kind: row._kind,
      ai_score: row.ai_score ?? null,
      ai_reason: row.ai_reason ?? null,
      ai_rule_note: row.ai_rule_note ?? null,
    } as SocialJobRow & Record<string, unknown>));

    const newestMatchByJobId = new Map<string, RadarSocialMatchRow>();
    for (const row of rpcRows) {
      newestMatchByJobId.set(row.lead_id, {
        id: row.lead_id,
        profile_id: row.profile_id ?? '',
        job_source: 'social',
        job_id: row.lead_id,
        created_at: row.match_created_at,
        final_average_score: row.final_average_score,
        score_breakdown: row.score_breakdown,
      });
    }

    const nowMs = Date.now();
    const NON_MEANINGFUL_TEXT = new Set([
      'unknown',
      'not specified',
      'not available',
      'n/a',
      'na',
      'none',
      'null',
      '-',
      '--',
      'tbd',
    ]);
    const isMeaningfulText = (value: string | null | undefined) => {
      const normalized = (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (normalized.length === 0) return false;
      if (NON_MEANINGFUL_TEXT.has(normalized)) return false;
      if (normalized.includes('unknown')) return false;
      if (normalized.includes('not specified')) return false;
      if (normalized.includes('not available')) return false;
      if (normalized.includes('tbd')) return false;
      return true;
    };
    const hasValues = (value: string[] | null | undefined) => Array.isArray(value) && value.some((item) => isMeaningfulText(item));
    const getPostedTimestamp = (row: SocialJobRow) => new Date(
      feedTimeBasis === 'created' ? row.created_at : (row.posted_at || row.created_at || 0),
    ).getTime();
    const BREAKDOWN_QUALITY_KEYS = [
      'experience_match',
      'work_type_match',
      'employment_type_match',
      'hourly_rate_match',
      'visa_match',
      'location_match',
      'skills_match',
    ];

    const getCompletenessScore = (row: SocialJobRow) => {
      let score = 0;
      const breakdown = newestMatchByJobId.get(row.id)?.score_breakdown;

      if (isMeaningfulText(row.job_title) || isMeaningfulText(row.extracted_role_normalized)) score += 3;
      if (isMeaningfulText(row.company_name)) score += 2;
      if (isMeaningfulText(row.posted_by_name)) score += 2;
      if (/^\S+@\S+\.\S+$/.test((row.poster_email ?? '').trim())) score += 3;
      if (isMeaningfulText(row.location)) score += 2;
      if (isMeaningfulText(row.employment_type)) score += 2;
      if (hasValues(row.core_skills) || hasValues(row.extracted_skills)) score += 3;
      if (row.years_experience != null || row.extracted_experience_years != null) score += 2;
      if (hasValues(row.visa_types) || hasValues(row.extracted_visa_types)) score += 2;
      if (
        row.hourly_rate_min != null
        || row.hourly_rate_max != null
        || row.extracted_hourly_rate_min != null
        || row.extracted_hourly_rate_max != null
        || isMeaningfulText(row.salary_range)
      ) score += 2;

      for (const key of BREAKDOWN_QUALITY_KEYS) {
        if (isMeaningfulText(getBreakdownJobValue(breakdown, key))) score += 2;
      }

      return score;
    };

    // AI Match results are already windowed to 30 days by the server, and the
    // range picker (which may hold e.g. ?range=3d from the feed) isn't shown
    // in that mode — applying it here would silently drop scored matches.
    const rangeCutoffMs = aiMatch ? 0 : nowMs - (selectedProfileRange.hours * 60 * 60 * 1000);
    const finalFiltered = socialData
      .filter((row) => {
        const postedTs = getPostedTimestamp(row);
        return newestMatchByJobId.has(row.id)
          && ((row.poster_email ?? '').trim() || row.post_source === 'user_post')
          && Number.isFinite(postedTs)
          && postedTs >= rangeCutoffMs;
      })
      .sort((a, b) => {
        const aMatchTs = new Date(newestMatchByJobId.get(a.id)?.created_at ?? 0).getTime();
        const bMatchTs = new Date(newestMatchByJobId.get(b.id)?.created_at ?? 0).getTime();
        if (bMatchTs !== aMatchTs) return bMatchTs - aMatchTs;

        const aCompleteness = getCompletenessScore(a);
        const bCompleteness = getCompletenessScore(b);
        if (aCompleteness !== bCompleteness) return bCompleteness - aCompleteness;

        return getPostedTimestamp(b) - getPostedTimestamp(a);
      })
      .map((row) => {
        const matchedAt = newestMatchByJobId.get(row.id)?.created_at;
        const breakdown = newestMatchByJobId.get(row.id)?.score_breakdown;
        const hotlistSource = breakdown?.hotlist_source && typeof breakdown.hotlist_source === 'object'
          ? breakdown.hotlist_source as Record<string, unknown>
          : null;
        const eventTime = row.posted_at || row.created_at || matchedAt;
        const rowKind = (row as SocialJobRow & Record<string, unknown>)._kind as 'jobs' | 'hotlist' | undefined;
        const rowIsHotlist = rowKind ? rowKind === 'hotlist' : isHotlistFeed;
        return {
          id: row.id,
          title: row.job_title?.trim() || row.extracted_role_normalized?.trim() || row.post_content?.trim().split('\n')[0]?.slice(0, 80) || (rowIsHotlist ? 'Available Consultant' : 'Untitled Job'),
          roleTitle: (row as SocialJobRow & Record<string, unknown>).role_title?.trim() || row.job_title?.trim() || row.extracted_role_normalized?.trim() || '',
          location: row.location?.trim() || 'Location not specified',
          company: row.company_name?.trim() || '',
          posterName: row.posted_by_name?.trim() || (rowIsHotlist ? 'Bench Sales Recruiter' : 'Vendor contact'),
          posterEmail: row.poster_email?.trim() || '',
          posterPhone: row.poster_phone?.trim() || '',
          postedAt: eventTime,
          createdAt: row.created_at || matchedAt || eventTime,
          matchedAt,
          postedAgo: formatAgo(eventTime),
          platform: row.platform,
          matchScore: (() => { const s = newestMatchByJobId.get(row.id)?.final_average_score; return (typeof s === 'number' && Number.isFinite(s) && s > 0) ? s : null; })(),
          profileId: newestMatchByJobId.get(row.id)?.profile_id ?? null,
          scoreBreakdown: newestMatchByJobId.get(row.id)?.score_breakdown ?? null,
          snippet: row.post_content?.trim().slice(0, 150) || '',
          employmentType: row.employment_type?.trim() || '',
          seniority: row.seniority_level?.trim() || '',
          salaryRange: row.salary_range?.trim() || '',
          skills: Array.isArray((row as SocialJobRow & Record<string, unknown>).core_skills)
            ? ((row as SocialJobRow & Record<string, unknown>).core_skills as string[])
            : (Array.isArray(row.extracted_skills) ? row.extracted_skills : []),
          experienceYears: safeNumber((row as SocialJobRow & Record<string, unknown>).years_experience) ?? safeNumber(row.extracted_experience_years),
          visaTypes: Array.isArray((row as SocialJobRow & Record<string, unknown>).visa_types)
            ? ((row as SocialJobRow & Record<string, unknown>).visa_types as string[])
            : (Array.isArray(row.extracted_visa_types) ? row.extracted_visa_types : []),
          hourlyRate: (safeNumber((row as SocialJobRow & Record<string, unknown>).hourly_rate_min) != null || safeNumber((row as SocialJobRow & Record<string, unknown>).hourly_rate_max) != null)
            ? `$${safeNumber((row as SocialJobRow & Record<string, unknown>).hourly_rate_min) ?? safeNumber(row.extracted_hourly_rate_min) ?? '?'}–$${safeNumber((row as SocialJobRow & Record<string, unknown>).hourly_rate_max) ?? safeNumber(row.extracted_hourly_rate_max) ?? '?'}/hr`
            : ((safeNumber(row.extracted_hourly_rate_min) != null || safeNumber(row.extracted_hourly_rate_max) != null)
              ? `$${safeNumber(row.extracted_hourly_rate_min) ?? '?'}–$${safeNumber(row.extracted_hourly_rate_max) ?? '?'}/hr`
              : ''),
          consultantCount: hotlistSource && Number.isInteger(Number(hotlistSource.consultant_count))
            ? Number(hotlistSource.consultant_count)
            : undefined,
          candidateIndex: hotlistSource && Number.isInteger(Number(hotlistSource.candidate_index))
            ? Number(hotlistSource.candidate_index)
            : undefined,
          workType: row.work_type?.trim() || '',
          postSource: normalizePostSource(row.post_source),
          authorAccountId: row.created_by_account_id ?? null,
          authorUserId: row.created_by_user_id ?? null,
          authorName: row.author_display_name ?? null,
          avatarUrl: row.avatar_url?.trim() || null,
          kind: rowIsHotlist ? 'hotlist' : 'job',
          aiMatchScore: safeNumber((row as SocialJobRow & Record<string, unknown>).ai_score),
          aiMatchReason: ((row as SocialJobRow & Record<string, unknown>).ai_reason as string | null) ?? null,
          aiMatchRuleNote: ((row as SocialJobRow & Record<string, unknown>).ai_rule_note as string | null) ?? null,
        } as SocialLead;
      });

    setFeed(finalFiltered);

    // A page is a page: reveal all of it rather than trickling it out, so the
    // pagination bar sits at the end of 100 results and not after the first 12.
    setVisibleMatchesCount(FEED_PAGE_SIZE);
    setDesktopRecentVisibleCount(FEED_PAGE_SIZE);
    // The action-driven tabs are unaffected by feed paging and keep their own
    // incremental reveal.
    setDesktopPreviewedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
    setDesktopAskedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
    setDesktopVerifiedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);

    setFeedLoading(false);
  }, [aiMatch, appliedFeedFilters, feedKindFilter, feedSearchQuery, feedTimeBasis, fetchFeedPage, isCombinedFeed, isHotlistFeed, selectedProfileRange.hours, showToast]);

  const goToNextFeedPage = useCallback(async () => {
    const cursor = feedCursorRef.current;
    if (cursor == null || feedPageInFlightRef.current) return;
    feedPageInFlightRef.current = true;
    setFeedPageLoading(true);
    try {
      feedCursorStackRef.current[feedPageIndex + 1] = cursor;
      await loadFeed(null, [], undefined, { cursor });
      setFeedPageIndex((current) => current + 1);
    } finally {
      feedPageInFlightRef.current = false;
      setFeedPageLoading(false);
    }
  }, [feedPageIndex, loadFeed]);

  const goToPrevFeedPage = useCallback(async () => {
    if (feedPageIndex === 0 || feedPageInFlightRef.current) return;
    feedPageInFlightRef.current = true;
    setFeedPageLoading(true);
    try {
      await loadFeed(null, [], undefined, { cursor: feedCursorStackRef.current[feedPageIndex - 1] ?? null });
      setFeedPageIndex((current) => current - 1);
    } finally {
      feedPageInFlightRef.current = false;
      setFeedPageLoading(false);
    }
  }, [feedPageIndex, loadFeed]);

  useEffect(() => {
    goToNextFeedPageRef.current = goToNextFeedPage;
    goToPrevFeedPageRef.current = goToPrevFeedPage;
  }, [goToNextFeedPage, goToPrevFeedPage]);

  // Bench sales match their consultant against jobs; vendors match their job
  // against hotlists — the same persona split the feed itself uses.
  const aiMatchTarget: 'jobs' | 'hotlist' = account?.active_persona === 'bench_sales' ? 'jobs' : 'hotlist';
  // Recents are persisted, so this survives a refresh and restoring results
  // from the rail. The run-time value wins while a run is in flight, before
  // the recent has been written.
  const aiMatchSourcePostId = useMemo(() => {
    if (aiMatchRunPostId) return aiMatchRunPostId;
    const description = aiMatchDescription.trim();
    if (!description) return null;
    const run = aiMatchRecents.find((item) => item.target === aiMatchTarget && item.description === description);
    return run?.postId ?? null;
  }, [aiMatchRunPostId, aiMatchDescription, aiMatchRecents, aiMatchTarget]);

  // The overrides let the sidebar run one of their own posts without a detour
  // through state — setState is async, so reading the box back would run the
  // previous post's text.
  const runAiMatch = useCallback(async (overrideDescription?: string, overrideTitle?: string, overridePostId?: string) => {
    setAiMatchRunPostId(overridePostId ?? null);
    const description = (overrideDescription ?? aiMatchDescription).trim();
    const runTitle = overrideTitle ?? (overrideDescription !== undefined ? '' : aiMatchFromTitle);
    if (description.length < AI_MATCH_MIN_DESCRIPTION_CHARS) {
      setAiMatchError(`Add a bit more detail — at least ${AI_MATCH_MIN_DESCRIPTION_CHARS} characters.`);
      return;
    }
    // A rematch of text that has run before keeps that run's matches on screen
    // and tells the server not to charge for them again.
    const previousRun = aiMatchRecents.find((item) => item.target === aiMatchTarget && item.description === description);
    const previousRows = previousRun?.rows ?? [];
    if (overrideDescription !== undefined) {
      setAiMatchDescription(overrideDescription);
      setAiMatchFromTitle(runTitle);
      // Started from the rail or the Recent tab: the progress and the results
      // are on the match side.
      setAiMatchMobileTab('match');
    }
    setAiMatchRunning(true);
    setAiMatchError(null);
    setAiMatchProgress('Starting');
    setAiMatchSummary(null);
    try {
      // A direct fetch, not functions.invoke: invoke buffers the whole
      // response, which would discard the progress events.
      // buildSupabaseFunctionHeaders returns Authorization only when there is a
      // session, and that optional-property union isn't assignable to
      // HeadersInit, so it is set conditionally.
      const authHeaders = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession()) as { Authorization?: string };
      const headers: Record<string, string> = {
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      };
      if (authHeaders.Authorization) headers.Authorization = authHeaders.Authorization;
      const response = await fetch(`${supabaseFunctionsUrl}/ai-match`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ target: aiMatchTarget, description, stream: true, seen_ids: previousRows.map((row) => row.lead_id) }),
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        setAiMatchError(payload?.error ?? 'AI Match failed. You have not been charged.');
        return;
      }

      const noun = aiMatchTarget === 'jobs' ? 'jobs' : 'consultants';
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let data: { results?: unknown; post?: unknown; credits_charged?: number; new_count?: number; matched_for?: string | null } | null = null;
      let streamError: string | null = null;
      let scanned = 0;

      // Newline-delimited JSON: one event per line, the last carrying results.
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (event.phase === 'found') scanned = Number(event.found ?? 0);
          if (event.phase === 'preparing') setAiMatchProgress('Reading what you pasted');
          else if (event.phase === 'searching') setAiMatchProgress(`Searching ${noun} from the last 30 days`);
          else if (event.phase === 'found') setAiMatchProgress(`Found ${Number(event.found ?? 0)} ${noun} to score`);
          else if (event.phase === 'split') {
            const posted = Number(event.posted ?? 0);
            setAiMatchProgress(`Saved ${posted} consultants · matching ${String(event.matched_for ?? 'the last one')}`);
          }
          else if (event.phase === 'scoring') setAiMatchProgress(`Scoring ${Number(event.scored ?? 0)} of ${Number(event.total ?? 0)} ${noun}`);
          else if (event.phase === 'error') streamError = String(event.error ?? 'AI Match failed');
          else if (event.phase === 'done') data = event as { results?: unknown; post?: unknown };
        }
      }

      if (streamError || !data) {
        setAiMatchError(streamError ?? 'AI Match failed. You have not been charged.');
        return;
      }

      const freshRows = ((data?.results ?? []) as PulseSocialFeedRpcRow[])
        .map((row) => ({ ...row, _kind: aiMatchTarget }));
      // This run's version of a row wins — the score is from the current
      // scoring pass — and anything only the old run had is kept below it.
      const mergedById = new Map<string, PulseSocialFeedRpcRow>();
      for (const row of [...freshRows, ...previousRows]) {
        if (!mergedById.has(row.lead_id)) mergedById.set(row.lead_id, row);
      }
      const similarityOf = (row: PulseSocialFeedRpcRow) => Number((row as { similarity?: number }).similarity ?? 0);
      // Capped so repeated rematches can't grow the list (or the stored recent,
      // or the seen_ids the next run sends) without bound.
      const rows = [...mergedById.values()]
        .sort((a, b) => (Number(b.ai_score ?? 0) - Number(a.ai_score ?? 0)) || (similarityOf(b) - similarityOf(a)))
        .slice(0, AI_MATCH_MAX_KEPT_MATCHES);
      const newCount = Number(data?.new_count ?? freshRows.length);
      // The run also publishes the pasted description as the user's own post.
      // Only a new post is worth a word; a duplicate or a skipped extraction
      // stays quiet rather than adding noise to every run.
      const post = data?.post as { status?: string; count?: number; reason?: string } | undefined;
      setAiMatchSummary({
        returned: rows.length,
        fresh: previousRows.length > 0 ? newCount : null,
        scanned,
        best: rows.reduce((top, row) => Math.max(top, Number(row.ai_score ?? 0)), 0) || null,
        credits: Number(data?.credits_charged ?? 0),
        posted: post?.status === 'created' ? (post.count ?? 1) : 0,
        matchedFor: (data?.matched_for ?? null) || null,
      });
      if (post?.status === 'created') {
        const where = aiMatchTarget === 'jobs' ? 'My Hotlist' : 'My Jobs';
        showToast(post.count && post.count > 1 ? `${post.count} posts added to ${where}` : `Posted to ${where}`, 'success');
        // The rail is loaded once; without this the posts just created aren't
        // there to match the rest of the batch from.
        setAiMatchOwnPostsReloadKey((key) => key + 1);
      } else if (post?.status === 'failed' || post?.status === 'skipped') {
        // Silence here is what hid auto-posting failing entirely: the matches
        // arrived, nothing was posted, and nobody could tell why.
        showToast(`Matches ready, but the post wasn't created${post.reason ? `: ${post.reason}` : ''}`, 'error');
      }
      if (data?.matched_for) setAiMatchFromTitle(String(data.matched_for));
      await loadFeed(null, [], rows);
      setAiMatchHasRun(true);
      setAiMatchComposerOpen(rows.length === 0);
      writeAiMatchSession({ description, target: aiMatchTarget, rows });
      setAiMatchRecents((previous) => {
        // Same text moves to the front rather than piling up.
        const rest = previous.filter((item) => item.description !== description);
        const next = [{ description, title: runTitle, postId: overridePostId, target: aiMatchTarget, at: new Date().toISOString(), count: rows.length, rows }, ...rest]
          .slice(0, AI_MATCH_RECENTS_LIMIT);
        writeAiMatchRecents(next);
        return next;
      });
      // The run cost a credit (or was refunded if nothing matched); either way
      // the header balance should reflect the server's number.
      void refreshAccount();
    } catch (error) {
      setAiMatchError(error instanceof Error ? error.message : 'AI Match failed. You have not been charged.');
    } finally {
      setAiMatchRunning(false);
      setAiMatchProgress(null);
    }
  }, [aiMatchDescription, aiMatchFromTitle, aiMatchRecents, aiMatchTarget, loadFeed, refreshAccount, showToast]);

  // Seed the box from the post that sent us here, once, then drop the router
  // state so a refresh doesn't put it back over anything typed since.
  const aiMatchSeedAppliedRef = useRef(false);
  useEffect(() => {
    if (!aiMatch || !aiMatchSeed || aiMatchSeedAppliedRef.current) return;
    aiMatchSeedAppliedRef.current = true;
    aiMatchRestoredRef.current = true;
    setAiMatchDescription(aiMatchSeed);
    setAiMatchFromTitle(aiMatchSeedTitle);
    // Open, not collapsed: the collapsed bar has no Find matches button, and
    // arriving from a post the whole point is that the next step is obvious.
    setAiMatchComposerOpen(true);
    setAiMatchSummary(null);
    navigate(`${routerLocation.pathname}${routerLocation.search}`, { replace: true, state: null });
  }, [aiMatch, aiMatchSeed, aiMatchSeedTitle, navigate, routerLocation.pathname, routerLocation.search]);

  // Same typewriter as the feed's search bar, on the AI Match box. It only runs
  // while the box is empty and open: once there is text the placeholder is
  // hidden anyway, and animating offscreen work is wasted.
  const aiMatchPlaceholderActive = aiMatch && aiMatchComposerOpen && aiMatchDescription.length === 0 && !aiMatchRunning;
  useEffect(() => {
    if (!aiMatchPlaceholderActive) return;
    const phrases = AI_MATCH_PLACEHOLDER_EXAMPLES[aiMatchTarget];
    let cancelled = false;
    let phraseIndex = 0;
    let charCount = 0;
    let isDeleting = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const TYPE_MS = 28;
    const DELETE_MS = 12;
    const PAUSE_AFTER_TYPE_MS = 2200;
    const PAUSE_AFTER_DELETE_MS = 300;

    const tick = () => {
      if (cancelled) return;
      const phrase = phrases[phraseIndex];
      if (!isDeleting) {
        charCount += 1;
        setAnimatedAiMatchPlaceholder(phrase.slice(0, charCount));
        if (charCount >= phrase.length) {
          isDeleting = true;
          timeoutId = setTimeout(tick, PAUSE_AFTER_TYPE_MS);
          return;
        }
        timeoutId = setTimeout(tick, TYPE_MS);
        return;
      }
      charCount -= 1;
      setAnimatedAiMatchPlaceholder(phrase.slice(0, charCount));
      if (charCount <= 0) {
        isDeleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
        timeoutId = setTimeout(tick, PAUSE_AFTER_DELETE_MS);
        return;
      }
      timeoutId = setTimeout(tick, DELETE_MS);
    };

    timeoutId = setTimeout(tick, 400);
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [aiMatchPlaceholderActive, aiMatchTarget]);

  // A consultant's name beats the first words of a pasted block, so prefer the
  // title the run was seeded with.
  const aiMatchRecentLabel = (item: AiMatchRecent) => {
    const base = (item.title || item.description).trim().replace(/\s+/g, ' ');
    return base.length > 34 ? `${base.slice(0, 33)}\u2026` : base;
  };

  const aiMatchRecentsForTarget = useMemo(
    () => aiMatchRecents.filter((item) => item.target === aiMatchTarget),
    [aiMatchRecents, aiMatchTarget],
  );

  // Most bench sales already have the consultant as a file; retyping it into
  // the box was the main reason not to bother. This reads the document and
  // drops its text in — the run then treats it exactly like a paste, including
  // publishing it as their own post.
  const AI_MATCH_FILE_TYPES = '.pdf,.docx,.rtf,.txt';
  const handleAiMatchFile = useCallback(async (file: File) => {
    setAiMatchFileReading(true);
    setAiMatchError(null);
    setAiMatchFileName(file.name);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const formData = new FormData();
      formData.append('resume', file, file.name);
      // Text only: no model runs here, so the upload costs nothing.
      formData.append('text_only', 'true');
      const headers: Record<string, string> = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const response = await fetch(`${supabaseFunctionsUrl}/parse-resume`, { method: 'POST', headers, body: formData });
      const payload = await response.json().catch(() => null) as { plain_text?: string; error?: string } | null;
      if (!response.ok) {
        setAiMatchFileName('');
        setAiMatchError(payload?.error ?? "Couldn't read that file. Try a PDF, DOCX, RTF or TXT.");
        return;
      }
      const text = (payload?.plain_text ?? '').trim();
      if (!text) {
        setAiMatchFileName('');
        setAiMatchError('That file had no readable text — it may be a scan. Paste the text instead.');
        return;
      }
      // The box caps at 8000 characters and the server truncates anyway; a long
      // resume's opening pages are the part worth matching on.
      setAiMatchDescription(text.slice(0, 8000));
      // Filename minus extension is a better label than nothing, and they can
      // edit it out; the auto-posted version gets a proper title from
      // extract-post-fields.
      setAiMatchFromTitle(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim());
      setAiMatchComposerOpen(true);
      setAiMatchMobileTab('match');
    } catch (error) {
      setAiMatchFileName('');
      setAiMatchError((error as Error).message || "Couldn't read that file");
    } finally {
      setAiMatchFileReading(false);
    }
  }, []);

  const selectAiMatchText = useCallback((description: string, title: string) => {
    setAiMatchMobileTab('match');
    setAiMatchDescription(description);
    setAiMatchFromTitle(title);
    setAiMatchComposerOpen(true);
    setAiMatchError(null);
  }, []);

  // Clicking a row used to only refill the box, which read as nothing having
  // happened when results from another run were still on screen. A row whose
  // run was saved now puts those matches back, free — the credits were spent
  // when they were found.
  const showSavedRun = useCallback((item: AiMatchRecent | undefined) => {
    const rows = item?.rows ?? [];
    if (!item || rows.length === 0) return;
    void loadFeed(null, [], rows).then(() => {
      setAiMatchHasRun(true);
      // On a phone the restored matches are the point; the box that produced
      // them collapses to the compact card above them.
      if (isMobileViewport) setAiMatchComposerOpen(false);
      setAiMatchSummary({
        returned: rows.length,
        fresh: null,
        scanned: 0,
        best: rows.reduce((top, row) => Math.max(top, Number(row.ai_score ?? 0)), 0) || null,
        credits: 0,
        posted: 0,
        matchedFor: item.title || null,
        saved: true,
      });
    });
  }, [isMobileViewport, loadFeed]);

  const selectAiMatchRecent = useCallback((item: AiMatchRecent) => {
    selectAiMatchText(item.description, item.title ?? '');
    showSavedRun(item);
  }, [selectAiMatchText, showSavedRun]);

  // What a post's last run returned, so a row can say "8 matches · Rematch"
  // rather than offering a blind Match. A run is recognised by the post it came
  // from, the text it ran on, or the consultant it named: a bulk paste matches
  // on the last consultant's fields, so text alone would leave that consultant
  // looking unmatched a second after matching them. Newest wins.
  const aiMatchRunIndex = useMemo(() => {
    const byPost = new Map<string, AiMatchRecent>();
    const byText = new Map<string, AiMatchRecent>();
    const byTitle = new Map<string, AiMatchRecent>();
    for (const item of aiMatchRecents) {
      if (item.target !== aiMatchTarget) continue;
      if (item.postId && !byPost.has(item.postId)) byPost.set(item.postId, item);
      if (!byText.has(item.description)) byText.set(item.description, item);
      const title = item.title.trim().toLowerCase();
      if (title && !byTitle.has(title)) byTitle.set(title, item);
    }
    return { byPost, byText, byTitle };
  }, [aiMatchRecents, aiMatchTarget]);

  const selectAiMatchPost = useCallback((post: AiMatchOwnPost, lastRun: AiMatchRecent | undefined) => {
    // A post with no stored body would otherwise fill the box with nothing and
    // leave the button disabled.
    const text = post.description.trim() || [post.title, post.subtitle].filter(Boolean).join('\n');
    selectAiMatchText(text, post.title);
    showSavedRun(lastRun);
  }, [selectAiMatchText, showSavedRun]);

  const aiMatchLastRunForPost = useCallback((post: AiMatchOwnPost) => (
    aiMatchRunIndex.byPost.get(post.id)
      ?? aiMatchRunIndex.byText.get(post.description)
      ?? aiMatchRunIndex.byTitle.get(post.title.trim().toLowerCase())
  ), [aiMatchRunIndex]);

  // Ad-hoc pastes only: anything that came from a post is already a row above.
  const aiMatchLooseRecents = useMemo(() => {
    const shownAbove = new Set<AiMatchRecent>();
    for (const post of aiMatchOwnPosts) {
      const item = aiMatchRunIndex.byPost.get(post.id)
        ?? aiMatchRunIndex.byText.get(post.description)
        ?? aiMatchRunIndex.byTitle.get(post.title.trim().toLowerCase());
      if (item) shownAbove.add(item);
    }
    return aiMatchRecents.filter((item) => item.target === aiMatchTarget && !shownAbove.has(item));
  }, [aiMatchOwnPosts, aiMatchRecents, aiMatchRunIndex, aiMatchTarget]);

  const aiMatchOwnPostsLabel = aiMatchTarget === 'jobs' ? 'My Hotlist' : 'My Jobs';
  const aiMatchOwnPostsPath = aiMatchTarget === 'jobs' ? '/posts/hotlist' : '/posts/jobs';

  // Back to a clean page: the results, the summary and the restored session all
  // go, so a reload doesn't bring the old run back. The recents stay.
  const clearAiMatchResults = useCallback(() => {
    setFeed([]);
    setAiMatchSummary(null);
    setAiMatchHasRun(false);
    setAiMatchComposerOpen(true);
    setAiMatchDescription('');
    setAiMatchFromTitle('');
    setAiMatchMobileTab('match');
    try {
      window.sessionStorage.removeItem(AI_MATCH_SESSION_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
    // A detail URL names a row that no longer exists on the page.
    if (routeLeadId) navigate(feedBasePath, { replace: true });
  }, [feedBasePath, navigate, routeLeadId]);

  const aiMatchEmptyMessage = !aiMatch
    ? null
    : aiMatchHasRun
      ? 'No close matches in 30 days'
      : '';

  // Landing on /match starts clean: the last run's results used to reappear and
  // fill the page, which buried the thing the page is for and left no way back
  // to an empty box. Recents below the composer are how you return to a
  // previous match, and they cost nothing to show.
  //
  // The one exception is a refresh on /match/:kind/:id — that URL names a row
  // from the last run, so without the restore the detail pane would be empty.
  const aiMatchRestoredRef = useRef(false);
  useEffect(() => {
    if (!aiMatch || aiMatchRestoredRef.current || !account) return;
    // A seeded description wins over the previous run's results.
    if (aiMatchSeed) return;
    aiMatchRestoredRef.current = true;
    if (!routeLeadId) return;
    const saved = readAiMatchSession();
    if (!saved || saved.target !== aiMatchTarget || saved.rows.length === 0) return;
    void loadFeed(null, [], saved.rows).then(() => {
      setAiMatchHasRun(true);
      setAiMatchDescription(saved.description);
      // Open, not collapsed: a one-line bar above the results hides the fact
      // that this is where you start a match.
      setAiMatchComposerOpen(true);
    });
  }, [account, aiMatch, aiMatchSeed, aiMatchTarget, loadFeed, routeLeadId]);

  // Arriving at /match starts on the composer, every time.
  //
  // The restore below is gated on a lead id, but results were still showing up
  // on arrival: tapping the nav icon while already on /match is a navigation
  // that does not remount this page, so the previous run's results simply
  // stayed on screen — as they do when the Android shell resumes a page it
  // never unloaded. Keying this on the location means every arrival clears
  // them, however the page got here.
  //
  // The pasted text is deliberately kept: it is what a rematch needs, and it
  // sits in the box where it can be edited or cleared.
  const aiMatchEntryKeyRef = useRef<string | null>(null);
  const aiMatchPreviousPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!aiMatch || aiMatchRunning) return;
    const previousPath = aiMatchPreviousPathRef.current;
    aiMatchPreviousPathRef.current = routerLocation.pathname;
    // A lead permalink is asking for that run, and a seed is a fresh paste
    // from My Posts; neither is a plain arrival.
    if (routeLeadId || aiMatchSeed) return;
    if (aiMatchEntryKeyRef.current === routerLocation.key) return;
    aiMatchEntryKeyRef.current = routerLocation.key;
    // Closing a result's detail pane navigates from /match/:kind/:id back to
    // /match. That is the same visit, not a new one, so the results it came
    // from stay.
    if (previousPath && previousPath !== routerLocation.pathname && previousPath.startsWith(`${feedBasePath}/`)) return;
    setFeed([]);
    setAiMatchSummary(null);
    setAiMatchHasRun(false);
    setAiMatchComposerOpen(true);
    setAiMatchMobileTab('match');
    try {
      window.sessionStorage.removeItem(AI_MATCH_SESSION_KEY);
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  }, [aiMatch, aiMatchRunning, aiMatchSeed, feedBasePath, routeLeadId, routerLocation.key, routerLocation.pathname]);

  // The sidebar runs off the user's own posts, so load them once on /match.
  // Same rows My Hotlist / My Jobs shows (own account, user_post, not hidden),
  // trimmed to the columns a list row and a match run need.
  useEffect(() => {
    if (!aiMatch || !account?.id) return;
    let cancelled = false;
    const ownKind: 'hotlist' | 'job' = aiMatchTarget === 'jobs' ? 'hotlist' : 'job';
    setAiMatchOwnPostsLoading(true);
    void (async () => {
      const query = ownKind === 'hotlist'
        ? supabase
          .from('social_hotlist')
          .select('id, role_title, candidate_name, core_skills, years_experience, visa_type, employment_type, work_type, locations, availability, candidate_summary, raw_post_content, post_status, created_at')
        : supabase
          .from('social_jobs')
          .select('id, job_title, company_name, location, employment_type, seniority_level, extracted_skills, extracted_experience_years, extracted_visa_types, job_description, post_content, post_status, created_at');
      const { data, error } = await query
        .eq('created_by_account_id', account.id)
        .eq('post_source', 'user_post')
        .is('hidden_at', null)
        .order('created_at', { ascending: false })
        .limit(50);
      if (cancelled) return;
      setAiMatchOwnPostsLoading(false);
      if (error || !data) return;
      const rows = data as Array<Record<string, unknown>>;
      setAiMatchOwnPosts(rows.map((row): AiMatchOwnPost => {
        const str = (key: string) => (typeof row[key] === 'string' ? (row[key] as string).trim() : '');
        const list = (key: string) => (Array.isArray(row[key]) ? (row[key] as string[]).filter(Boolean) : []);
        const title = ownKind === 'hotlist'
          ? (str('candidate_name') || str('role_title'))
          : str('job_title');
        const skills = list(ownKind === 'hotlist' ? 'core_skills' : 'extracted_skills');
        const subtitle = ownKind === 'hotlist'
          ? (str('role_title') && str('candidate_name') ? str('role_title') : skills.slice(0, 3).join(' · '))
          : (str('company_name') || skills.slice(0, 3).join(' \u00b7 '));
        // Built from this row's own fields rather than from raw_post_content:
        // a bulk paste stores the same raw text on every consultant it created,
        // so the raw version would match one consultant against all ten. The
        // raw paste is the fallback for posts that have nothing structured.
        const num = (key: string) => {
          const value = Number(row[key]);
          return Number.isFinite(value) && value > 0 ? value : null;
        };
        const composed = ownKind === 'hotlist'
          ? [
            str('role_title'),
            str('candidate_name') ? `Consultant: ${str('candidate_name')}` : '',
            skills.length ? `Skills: ${skills.join(', ')}` : '',
            num('years_experience') ? `Experience: ${num('years_experience')} years` : '',
            str('visa_type') ? `Visa: ${str('visa_type')}` : '',
            str('employment_type') ? `Employment: ${str('employment_type')}` : '',
            str('work_type') ? `Work type: ${str('work_type')}` : '',
            list('locations').length ? `Locations: ${list('locations').join(', ')}` : '',
            str('availability') ? `Availability: ${str('availability')}` : '',
            str('candidate_summary'),
          ].filter(Boolean).join('\n')
          : [
            str('job_title'),
            str('company_name') ? `Company: ${str('company_name')}` : '',
            str('location') ? `Location: ${str('location')}` : '',
            skills.length ? `Skills: ${skills.join(', ')}` : '',
            num('extracted_experience_years') ? `Experience: ${num('extracted_experience_years')} years` : '',
            list('extracted_visa_types').length ? `Visa: ${list('extracted_visa_types').join(', ')}` : '',
            str('employment_type') ? `Employment: ${str('employment_type')}` : '',
            str('seniority_level') ? `Seniority: ${str('seniority_level')}` : '',
            str('job_description'),
          ].filter(Boolean).join('\n');
        const raw = ownKind === 'hotlist' ? str('raw_post_content') : str('post_content');
        // Long enough to match on: a bare title would be rejected by the run's
        // own minimum.
        const description = composed.length >= 40 ? composed : (raw || composed || title);
        return {
          id: String(row.id),
          title: title || 'Untitled',
          subtitle,
          description,
          status: str('post_status') || 'open',
          createdAt: str('created_at'),
        };
      }));
    })();
    return () => { cancelled = true; };
  }, [account?.id, aiMatch, aiMatchOwnPostsReloadKey, aiMatchTarget]);

  // loadFeed's dependencies now include the range, the applied search query and
  // the applied filters, so this single effect re-runs (and resets the cursor,
  // because append defaults to false) whenever any of them change.
  useEffect(() => {
    // AI Match fills the list from runAiMatch, not the paged feed.
    if (aiMatch) return;
    const restoreToPage = pendingRestorePageRef.current;
    pendingRestorePageRef.current = null;

    if (restoreToPage != null && restoreToPage > 0) {
      // Rebuild the cursor stack as offsets so Previous works immediately from
      // a restored page, rather than dead-ending because pages 1..N-1 were
      // never fetched in this session.
      feedCursorStackRef.current = Array.from({ length: restoreToPage + 1 }, (_unused, index) => (
        index === 0 ? null : { postedAt: null, leadId: null, offset: index * FEED_PAGE_SIZE }
      ));
      feedCursorRef.current = null;
      setFeedPageIndex(restoreToPage);
      void loadFeed(null, [], undefined, { cursor: feedCursorStackRef.current[restoreToPage] });
      return;
    }

    feedCursorRef.current = null;
    feedCursorStackRef.current = [null];
    setFeedPageIndex(0);
    void loadFeed(null);
  }, [aiMatch, loadFeed]);

  // Mirror the range and page into the URL so a refresh or a shared link comes
  // back to the same view. Defaults are omitted to keep ordinary URLs clean.
  useEffect(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (appliedRawSearchQuery) next.set('q', appliedRawSearchQuery);
      else next.delete('q');
      if (profileRangeId === '30d') next.delete('range');
      else next.set('range', profileRangeId);
      if (feedPageIndex === 0) next.delete('page');
      else next.set('page', String(feedPageIndex + 1));
      writeFeedFiltersToUrl(next, appliedFeedFilters);
      return next;
    }, { replace: true });
  }, [appliedFeedFilters, appliedRawSearchQuery, feedPageIndex, profileRangeId, setSearchParams]);

  useEffect(() => {
    setVisibleMatchesCount(MATCHES_PAGE_SIZE);
    setDesktopRecentVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
    setDesktopPreviewedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
    setDesktopAskedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
    setDesktopVerifiedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
  }, [activePersona?.target_role, selectedCategoryId, selectedMatchesTab, selectedTechStacks]);

  const ensureBenchProfileForWatchedRole = useCallback(async (persona: PulsePersona) => {
    if (!account?.id) return;

    const { data: existingProfile, error: existingError } = await supabase
      .from('profiles')
      .select('id')
      .eq('account_id', account.id)
      .ilike('target_role', persona.target_role)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existingProfile?.id) {
      return;
    }

    const skills = getPersonaSkillList(persona.target_role, persona.priority_skills);

    const { error: insertError } = await supabase.from('profiles').insert({
      account_id: account.id,
      candidate_name: `${persona.target_role} Watch Profile`,
      target_role: persona.target_role,
      core_skills: skills.join(', '),
    });

    if (insertError) {
      throw insertError;
    }
  }, [account?.id]);

  const syncWatchlistProfileFromHotlistRole = useCallback(async (persona: PulsePersona) => {
    if (!account?.id) return;

    const { data: roleRows, error: roleError } = await supabase
      .from('hotlist_ai_roles')
      .select('id, target_role, category, min_years_exp, max_years_exp, visa_status, employment_type, work_type, preferred_locations, min_rate_usd_per_hr, max_rate_usd_per_hr, relocation_open, priority_skills, avatar_url, schedule_frequency')
      .eq('account_id', account.id)
      .ilike('target_role', persona.target_role)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (roleError) throw roleError;

    let role = (roleRows?.[0] ?? null) as HotlistRoleRow | null;
    if (!role) {
      const createPayload = buildHotlistRolePayloadFromPersona(account.id, persona);
      const { data: createdRole, error: createRoleError } = await supabase
        .from('hotlist_ai_roles')
        .insert(createPayload)
        .select('id, target_role, account_id, category, min_years_exp, max_years_exp, visa_status, employment_type, work_type, preferred_locations, min_rate_usd_per_hr, max_rate_usd_per_hr, relocation_open, priority_skills, avatar_url, schedule_frequency, is_active')
        .single();

      if (createRoleError) {
        throw new Error(`Could not create Hotlist AI role for ${persona.target_role}: ${createRoleError.message}`);
      }

      role = createdRole as HotlistRoleRow;
    }

    const payload = buildWatchlistPayloadFromRole(account.id, role, user?.id ?? null);
    const { error: upsertError } = await supabase
      .from('watchlist_profiles' as never)
      .upsert(payload as never, { onConflict: 'account_id,target_role_key' } as never);

    if (upsertError) throw upsertError;
  }, [account?.id, user?.id]);

  const activatePersona = useCallback(async (persona: PulsePersona) => {
    try {
      setActivatingRole(persona.target_role);
      try {
        await syncWatchlistProfileFromHotlistRole(persona);
      } catch (watchlistSyncError) {
        showToast(
          watchlistSyncError instanceof Error
            ? watchlistSyncError.message
            : 'Could not create watchlist profile',
          'error',
        );
        return;
      }
      try {
        await ensureBenchProfileForWatchedRole(persona);
      } catch (benchSyncError) {
        showToast(benchSyncError instanceof Error ? `Watching enabled but Bench sync failed: ${benchSyncError.message}` : 'Watching enabled but Bench sync failed', 'error');
      }
      setWatchingRoles((prev) => {
        const next = new Set(prev);
        next.add(normalize(persona.target_role));
        return next;
      });
      setActivePersona(persona);
      await loadFeed(null);
      void loadLeaderboard();
      showToast(`Watching ${persona.target_role}`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not activate watch', 'error');
    } finally {
      setActivatingRole(null);
    }
  }, [ensureBenchProfileForWatchedRole, loadFeed, loadLeaderboard, showToast, syncWatchlistProfileFromHotlistRole]);

  const selectPersona = useCallback(async (persona: PulsePersona) => {
    setActivePersona(persona);
    await loadFeed(null);
  }, [loadFeed]);

  const refreshFeed = useCallback(async () => {
    setRefreshing(true);
    let rows: PulseSocialFeedRpcRow[] = [];
    try {
      rows = await getGlobalPulseRows(selectedProfileRange.hours, true);
      await Promise.all([loadFeed(null, [], rows), loadProfileStats(rows)]);
    } catch {
      showToast('Failed to refresh Pulse data', 'error');
    }

    const latest = rows.length > 0 ? rows[0]?.match_created_at : null;
    if (latest) setLastMatchAt(latest);

    setRefreshing(false);
  }, [getGlobalPulseRows, loadFeed, loadProfileStats, selectedProfileRange.hours, showToast]);

  const triggerMobilePullToRefresh = useCallback(async () => {
    if (isPullRefreshing || profileStatsLoading || refreshing || feedLoading) return;
    setIsPullRefreshing(true);
    try {
      await refreshFeed();
    } finally {
      setIsPullRefreshing(false);
      setPullDistance(0);
      mobilePullArmedRef.current = false;
      mobilePullStartYRef.current = null;
    }
  }, [feedLoading, isPullRefreshing, profileStatsLoading, refreshing, refreshFeed]);

  const handleMobilePullStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileViewport || isPullRefreshing) {
      return;
    }

    const startX = event.touches[0]?.clientX ?? null;
    const startY = event.touches[0]?.clientY ?? null;
    mobileTouchStartXRef.current = startX;
    mobileTouchStartYRef.current = startY;
    mobileSwipeDeltaXRef.current = 0;
    mobileSwipeDeltaYRef.current = 0;
    mobileHorizontalSwipeRef.current = false;

    mobilePullStartYRef.current = event.currentTarget.scrollTop > 0 ? null : startY;
    mobilePullArmedRef.current = false;
  }, [isMobileViewport, isPullRefreshing]);

  const handleMobilePullMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileViewport || isPullRefreshing) return;

    const startX = mobileTouchStartXRef.current;
    const startY = mobileTouchStartYRef.current;
    if (startX != null && startY != null) {
      const currentX = event.touches[0]?.clientX ?? startX;
      const currentY = event.touches[0]?.clientY ?? startY;
      const deltaX = currentX - startX;
      const deltaY = currentY - startY;
      mobileSwipeDeltaXRef.current = deltaX;
      mobileSwipeDeltaYRef.current = deltaY;

      if (!mobileHorizontalSwipeRef.current && Math.abs(deltaX) > 18 && Math.abs(deltaX) > Math.abs(deltaY)) {
        mobileHorizontalSwipeRef.current = true;
        mobilePullStartYRef.current = null;
        mobilePullArmedRef.current = false;
        if (pullDistance !== 0) setPullDistance(0);
      }
    }

    if (mobileHorizontalSwipeRef.current) {
      return;
    }

    if (event.currentTarget.scrollTop > 0) {
      mobilePullStartYRef.current = null;
      if (pullDistance !== 0) setPullDistance(0);
      return;
    }

    const pullStartY = mobilePullStartYRef.current;
    if (pullStartY == null) return;
    const currentY = event.touches[0]?.clientY ?? pullStartY;
    const drag = Math.max(0, currentY - pullStartY);
    const constrained = Math.min(72, drag * 0.45);
    setPullDistance(constrained);
    mobilePullArmedRef.current = constrained > 36;
  }, [isMobileViewport, isPullRefreshing, pullDistance]);

  const handleMobilePullEnd = useCallback(() => {
    if (!isMobileViewport || isPullRefreshing) return;

    const deltaX = mobileSwipeDeltaXRef.current;
    const deltaY = mobileSwipeDeltaYRef.current;
    const isHorizontalSwipe = mobileHorizontalSwipeRef.current
      && Math.abs(deltaX) > 52
      && Math.abs(deltaX) > Math.abs(deltaY);

    if (isHorizontalSwipe) {
      const nextTab: MatchesTabId = deltaX < 0 ? 'previewed' : 'queued';
      if (nextTab !== selectedMatchesTab) {
        setSelectedMatchesTab(nextTab);
        setVisibleMatchesCount(MATCHES_PAGE_SIZE);
      }
      setPullDistance(0);
      mobileHorizontalSwipeRef.current = false;
      mobileSwipeDeltaXRef.current = 0;
      mobileSwipeDeltaYRef.current = 0;
      mobileTouchStartXRef.current = null;
      mobileTouchStartYRef.current = null;
      mobilePullArmedRef.current = false;
      mobilePullStartYRef.current = null;
      return;
    }

    if (mobilePullArmedRef.current) {
      void triggerMobilePullToRefresh();
      return;
    }
    setPullDistance(0);
    mobileHorizontalSwipeRef.current = false;
    mobileSwipeDeltaXRef.current = 0;
    mobileSwipeDeltaYRef.current = 0;
    mobileTouchStartXRef.current = null;
    mobileTouchStartYRef.current = null;
    mobilePullArmedRef.current = false;
    mobilePullStartYRef.current = null;
  }, [isHotlistFeed, isMobileViewport, isPullRefreshing, selectedMatchesTab, triggerMobilePullToRefresh]);

  const copyText = useCallback(async (value: string, label: string) => {
    if (!value.trim()) {
      showToast(`${label} is not available on this lead`, 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(value.trim());
      showToast(`${label} copied`, 'success');
    } catch {
      showToast(`Could not copy ${label.toLowerCase()}`, 'error');
    }
  }, [showToast]);


  const handleOpenPostChat = useCallback(async (lead: SocialLead) => {
    if (!account?.id || processingChatLeadId) return;
    setProcessingChatLeadId(lead.id);
    try {
      const { data, error } = await supabase.rpc('start_post_chat_thread' as never, {
        p_post_kind: leadIsHotlist(lead) ? 'hotlist' : 'job',
        p_post_id: lead.id,
      } as never);
      if (error || !data) throw new Error(error?.message || 'Could not start the conversation');
      navigate(`/inbox/${data as string}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start the conversation', 'error');
    } finally {
      setProcessingChatLeadId(null);
    }
  }, [account?.id, leadIsHotlist, navigate, processingChatLeadId, showToast]);

  const handleAskAI = useCallback(async (lead: SocialLead) => {
    if (!account?.id || processingAskAILeadId) return;

    const leadType: 'job' | 'hotlist' = leadIsHotlist(lead) ? 'hotlist' : 'job';
    // A job with every field already detected still has a valid "ask" — re-confirming
    // rate is always a safe, relevant question, so we never block sending outreach.
    const detectedMissingDetails = leadType === 'hotlist' ? ['video screening'] : getMissingJobDetails(lead);
    const missingDetails = detectedMissingDetails.length > 0 ? detectedMissingDetails : ['Rate'];
    const primaryEmail = extractPrimaryEmail(lead.posterEmail);
    if (!primaryEmail) {
      showToast(leadType === 'hotlist' ? 'This consultant does not have a valid recruiter email' : 'This job does not have a valid vendor email', 'error');
      return;
    }

    const requestId = crypto.randomUUID();
    setAskAIPreview({
      leadId: lead.id,
      leadType,
      requestId,
      vendorName: lead.posterName || 'the vendor',
      vendorEmail: primaryEmail,
      jobTitle: lead.title || lead.roleTitle || '',
      company: lead.company || '',
      missingDetails,
      emailSubject: '',
      emailContent: '',
      isGenerating: true,
    });
    setProcessingAskAILeadId(lead.id);
    try {
      const { data, error } = await supabase.functions.invoke('ask-ai-vendor-email', {
        body: {
          action: 'preview',
          request_id: requestId,
          account_id: account.id,
          job_id: lead.id,
          lead_type: leadType,
          missing_details: missingDetails,
        },
      });

      if (error || !data?.ok) {
        const code = await getFunctionErrorCode(error);
        if (code === 'insufficient_credits') {
          const insufficientCreditsError = new Error('insufficient_credits');
          insufficientCreditsError.name = 'InsufficientCreditsError';
          throw insufficientCreditsError;
        }
        throw new Error(data?.error || await getFunctionErrorMessage(error, 'Could not generate the request'));
      }

      const vendorName = data.vendor_name || lead.posterName || 'the vendor';
      const vendorEmail = primaryEmail;
      const generatedSubject = removeNameFromEmail(data.email_subject || '', vendorName);
      let generatedContent = removeNameFromEmail(data.email_content || '', vendorName);

      // The draft says "link below", so the link has to be in the draft. It is
      // minted here rather than at send time so the preview shows exactly what
      // goes out — invisible until send reads as a broken invite. The RPC is
      // idempotent per job and consultant, so regenerating or resending never
      // creates a second screening.
      if (leadType === 'hotlist' && aiMatchSourcePostId) {
        const { data: invite } = await supabase.rpc('invite_consultant_to_screening' as never, {
          p_social_job_id: aiMatchSourcePostId,
          p_hotlist_id: lead.id,
        } as never);
        const row = Array.isArray(invite) ? invite[0] : invite;
        const token = (row as { screening_token?: string } | null)?.screening_token;
        if (token) {
          generatedContent += `\n\nStart the screening here — no account needed, about five minutes:\n${window.location.origin}/screen/${token}`;
        }
      }
      setAskAIPreview((current) => ({
        leadId: lead.id,
        leadType,
        requestId,
        vendorName,
        vendorEmail: current?.vendorEmail ?? vendorEmail,
        jobTitle: current?.jobTitle ?? (lead.title || lead.roleTitle || ''),
        company: current?.company ?? (lead.company || ''),
        missingDetails,
        emailSubject: generatedSubject,
        emailContent: generatedContent,
        isGenerating: false,
      }));

      // Log every generated email to the Inbox — nothing currently gets sent
      // (Gmail Sync isn't wired up), so this is the only record of it. One
      // row per (user, lead): regenerating just refreshes it.
      if (user?.id) {
        void supabase.from('pulse_ask_ai_previews' as never).upsert({
          account_id: account.id,
          user_id: user.id,
          job_id: leadType === 'job' ? lead.id : null,
          hotlist_id: leadType === 'hotlist' ? lead.id : null,
          vendor_name: vendorName,
          vendor_email: vendorEmail,
          subject: generatedSubject,
          email_content: generatedContent,
          updated_at: new Date().toISOString(),
        } as never, { onConflict: 'user_id,lead_key' } as never).then(({ error: previewError }) => {
          if (previewError) {
            console.error('Could not log generated email to Inbox', previewError);
            showToast('Email generated, but could not be saved to Inbox', 'error');
          }
        });
      }
    } catch (error) {
      setAskAIPreview(null);
      if (error instanceof Error && error.name === 'InsufficientCreditsError') {
        setShowOutOfCreditsModal(true);
      } else {
        showToast(error instanceof Error ? error.message : 'Could not generate the vendor email request', 'error');
      }
    } finally {
      setProcessingAskAILeadId(null);
    }
  }, [account?.id, leadIsHotlist, processingAskAILeadId, showToast, user?.id]);

  useEffect(() => {
    supabase
      .from('gmail_integration_status' as never)
      .select('status')
      .maybeSingle()
      .then(({ data }: { data: { status?: string } | null }) => {
        setGmailIntegrationStatus(data?.status === 'connected' ? 'connected' : 'not_connected');
      });
  }, []);

  // Consumes the one-time gmail=connected/error (+ reopen target) query
  // params left behind by gmail-oauth-callback's redirect back here, then
  // clears them from the URL so a refresh doesn't replay the toast/restore.
  useEffect(() => {
    const gmailResult = searchParams.get('gmail');
    if (!gmailResult) return;

    if (gmailResult === 'connected') showToast('Gmail connected.', 'success');
    else if (searchParams.get('gmail_error') === 'gmail_send_scope_not_granted') showToast('Gmail wasn\'t connected — the "Send email on your behalf" permission was not granted. Reconnect and make sure that permission stays checked on Google\'s screen.', 'error');
    else if (gmailResult === 'error') showToast('Could not connect Gmail. Please try again.', 'error');

    const reopenLeadId = searchParams.get('gmail_reopen_lead');
    const reopenLeadType = searchParams.get('gmail_reopen_type');
    if (reopenLeadId && (reopenLeadType === 'job' || reopenLeadType === 'hotlist')) {
      setPendingGmailReopen({ leadId: reopenLeadId, leadType: reopenLeadType });
    }

    const nextParams = new URLSearchParams(searchParams);
    for (const key of ['gmail', 'gmail_error', 'gmail_reopen_lead', 'gmail_reopen_type']) nextParams.delete(key);
    navigate({ pathname: location.pathname, search: nextParams.toString() ? `?${nextParams.toString()}` : '' }, { replace: true });
    // Runs once on mount only — searchParams/navigate would otherwise
    // re-trigger this after the replace() above changes the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restores the modal once the reopened lead is actually present in the
  // loaded feed (which arrives asynchronously) — prefers the draft already
  // persisted in pulse_ask_ai_previews so reconnecting doesn't burn another
  // credit, falling back to a fresh generate if that row is somehow gone.
  useEffect(() => {
    if (!pendingGmailReopen || !user?.id) return;
    const lead = feed.find((item) => item.id === pendingGmailReopen.leadId);
    if (!lead) return;
    const { leadId, leadType } = pendingGmailReopen;
    setPendingGmailReopen(null);

    void (async () => {
      const { data } = await supabase
        .from('pulse_ask_ai_previews' as never)
        .select('vendor_name, vendor_email, subject, email_content')
        .eq('user_id', user.id)
        .eq(leadType === 'hotlist' ? 'hotlist_id' : 'job_id', leadId)
        .maybeSingle();
      const row = data as { vendor_name?: string; vendor_email?: string; subject?: string; email_content?: string } | null;

      if (!row?.subject || !row?.email_content) {
        void handleAskAI(lead);
        return;
      }

      const detectedMissingDetails = leadType === 'hotlist' ? ['video screening'] : getMissingJobDetails(lead);
      const missingDetails = detectedMissingDetails.length > 0 ? detectedMissingDetails : ['Rate'];
      setAskAIPreview({
        leadId,
        leadType,
        requestId: crypto.randomUUID(),
        vendorName: row.vendor_name || lead.posterName || 'the vendor',
        vendorEmail: row.vendor_email || extractPrimaryEmail(lead.posterEmail) || '',
        jobTitle: lead.title || lead.roleTitle || '',
        company: lead.company || '',
        missingDetails,
        emailSubject: row.subject,
        emailContent: row.email_content,
        isGenerating: false,
      });
    })();
  }, [feed, pendingGmailReopen, user?.id, handleAskAI]);

  // Mirrors AccountSettings.connectGmail — full-page redirect to Google's
  // consent screen, so the in-progress draft in askAIPreview is lost from
  // memory. return_to (this page + which lead to reopen) rides through the
  // signed OAuth state and back; the restore effect below uses it to
  // reopen the modal with the draft pulled back from pulse_ask_ai_previews
  // (or regenerated if that row is somehow gone) once we're back here.
  // The bulk bar can offer Gmail before any draft exists, so it cannot reuse
  // handleConnectGmail, which returns the user to a specific lead's modal.
  async function handleConnectGmailStandalone() {
    if (!account?.id || connectingGmail) return;
    setConnectingGmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('gmail-oauth-start', {
        body: { account_id: account.id, return_to: window.location.pathname },
      });
      if (error || !data?.url) throw new Error(data?.error || 'Could not start Gmail connection');
      window.location.href = data.url;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start Gmail connection', 'error');
      setConnectingGmail(false);
    }
  }

  async function handleConnectGmail() {
    if (!account?.id || connectingGmail || !askAIPreview) return;
    setConnectingGmail(true);
    try {
      const returnTo = `${window.location.pathname}?gmail_reopen_lead=${encodeURIComponent(askAIPreview.leadId)}&gmail_reopen_type=${askAIPreview.leadType}`;
      const { data, error } = await supabase.functions.invoke('gmail-oauth-start', { body: { account_id: account.id, return_to: returnTo } });
      if (error || !data?.url) throw new Error(data?.error || 'Could not start Gmail connection');
      window.location.href = data.url;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start Gmail connection', 'error');
      setConnectingGmail(false);
    }
  }

  async function handleSendViaGmail() {
    if (!askAIPreview || !account?.id || sendingViaGmail) return;
    setSendingViaGmail(true);
    try {
      // An invite without the link is just an email. Minted at send time
      // rather than when the draft is generated, so a draft the user abandons
      // does not leave a screening record behind.
      let emailContent = askAIPreview.emailContent;
      if (askAIPreview.leadType === 'hotlist' && aiMatchSourcePostId && !emailContent.includes('/screen/')) {
        const { data: invite } = await supabase.rpc('invite_consultant_to_screening' as never, {
          p_social_job_id: aiMatchSourcePostId,
          p_hotlist_id: askAIPreview.leadId,
        } as never);
        const row = Array.isArray(invite) ? invite[0] : invite;
        const token = (row as { screening_token?: string } | null)?.screening_token;
        if (token) {
          emailContent += `\n\nBook the screening here — no account needed, it takes about five minutes:\n${window.location.origin}/screen/${token}`;
        }
      }

      const { data, error } = await supabase.functions.invoke('ask-ai-vendor-email', {
        body: {
          action: 'send',
          request_id: askAIPreview.requestId,
          account_id: account.id,
          job_id: askAIPreview.leadId,
          lead_type: askAIPreview.leadType,
          missing_details: askAIPreview.missingDetails,
          email_subject: askAIPreview.emailSubject,
          email_content: emailContent,
          channel: 'gmail',
        },
      });
      if (error || !data?.ok) {
        if (data?.error === 'gmail_not_connected') {
          setGmailIntegrationStatus('not_connected');
          throw new Error('Gmail is no longer connected — reconnect and try again');
        }
        throw new Error(data?.error || await getFunctionErrorMessage(error, 'Could not send via Gmail'));
      }
      setAskAIPreview(null);
      showToast('Sent via Gmail', 'success');
      if (data.conversation_id) navigate(`/inbox/${data.conversation_id}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not send via Gmail', 'error');
    } finally {
      setSendingViaGmail(false);
    }
  }

  const consumeCreditsLegacy = useCallback(async (
    amount: number,
    feature: 'pulse_predict_match',
  ) => {
    if (!account?.id) return false;

    const roundedAmount = Number(amount.toFixed(4));

    const { data: accountRow, error: accountError } = await supabase
      .from('accounts')
      .select('credits_balance')
      .eq('id', account.id)
      .maybeSingle();

    if (accountError) {
      showToast('Could not load credits balance', 'error');
      return false;
    }

    const currentBalance = Number(accountRow?.credits_balance ?? 0);
    if (currentBalance < roundedAmount) {
      showToast('Insufficient credits', 'error');
      return false;
    }

    const nextBalance = Number((currentBalance - roundedAmount).toFixed(4));

    const { error: updateError } = await supabase
      .from('accounts')
      .update({ credits_balance: nextBalance })
      .eq('id', account.id);

    if (updateError) {
      showToast('Could not update credits balance', 'error');
      return false;
    }

    const { error: txError } = await supabase.from('credit_transactions').insert({
      account_id: account.id,
      user_id: user?.id ?? null,
      type: 'usage',
      amount: -roundedAmount,
      description: `Pulse: ${feature}`,
    });

    if (txError) {
      showToast('Credits deducted but usage log entry failed', 'error');
    }

    await refreshAccount();
    return true;
  }, [account?.id, refreshAccount, showToast, user?.id]);

  const consumeCredits = useCallback(async (
    amount: number,
    feature: 'pulse_predict_match',
    metadata: Record<string, unknown>,
  ) => {
    if (!shouldChargeCredits()) return true;
    if (!account?.id) {
      showToast('No account found for credit deduction', 'error');
      return false;
    }

    const { data, error } = await supabase.rpc('consume_feature_credit', {
      p_account_id: account.id,
      p_amount: amount,
      p_feature: feature,
      p_metadata: metadata,
    });

    let rpcData = data;
    let rpcError = error;

    // Compatibility retry for environments that deployed a 3-arg version.
    if (rpcError) {
      const retry = await supabase.rpc('consume_feature_credit', {
        p_account_id: account.id,
        p_amount: amount,
        p_feature: feature,
      });
      rpcData = retry.data;
      rpcError = retry.error;
    }

    if (rpcError) {
      const usedLegacy = await consumeCreditsLegacy(amount, feature);
      if (!usedLegacy) {
        showToast(rpcError.message || 'Could not consume credits right now', 'error');
      }
      return usedLegacy;
    }

    const row = Array.isArray(rpcData) ? rpcData[0] : null;
    const success = Boolean(row?.success);
    if (!success) {
      showToast(String(row?.message ?? 'Insufficient credits'), 'error');
      return false;
    }

    await refreshAccount();
    return true;
  }, [account?.id, consumeCreditsLegacy, refreshAccount, showToast]);

  const persistLeadAction = useCallback(async (leadId: string, actionType: LeadActionType) => {
    if (!account?.id) return;

    const { error } = await supabase
      .from('pulse_lead_actions')
      .upsert(
        {
          account_id: account.id,
          user_id: user?.id ?? null,
          lead_id: leadId,
          action_type: actionType,
        },
        {
          onConflict: 'account_id,user_id,lead_id,action_type',
          ignoreDuplicates: true,
        },
      );

    if (error) {
      showToast('Could not sync action state', 'error');
    }
  }, [account?.id, showToast, user?.id]);

  const handleSwipePass = useCallback((lead: SocialLead) => {
    void persistLeadAction(lead.id, 'ignored');
    setIgnoredLeadIds((prev) => new Set(prev).add(lead.id));
  }, [persistLeadAction]);

  const handleSwipePitch = useCallback((lead: SocialLead) => {
    if (lead.postSource === 'user_post') {
      void handleOpenPostChat(lead);
    } else {
      void handleAskAI(lead);
    }
  }, [handleOpenPostChat, handleAskAI]);

  // Shared by the card/table "Preview" button (unchanged) and the detail-panel
  // layout's auto-fetch-on-select — same one-time credit charge either way,
  // just triggered by a different UI entry point. Returns null only when the
  // credit charge itself couldn't be completed (consumeCredits already shows
  // its own UI for that, e.g. an out-of-credits prompt), so callers should
  // treat null as "silently stop", not as an error to surface.
  const fetchLeadRawContent = useCallback(async (lead: SocialLead): Promise<string | null> => {
    const alreadyViewed = postContentViewedLeadIds.has(lead.id);
    if (!alreadyViewed) {
      setPostContentViewedLeadIds((prev) => {
        const next = new Set(prev);
        next.add(lead.id);
        return next;
      });
      setPostContentViewedAtByLeadId((prev) => ({ ...prev, [lead.id]: new Date().toISOString() }));
      void persistLeadAction(lead.id, 'post_content_viewed');
    }

    const previewIsHotlist = leadIsHotlist(lead);
    const { data, error } = await supabase
      .from(previewIsHotlist ? 'social_hotlist' : 'social_jobs')
      .select(previewIsHotlist ? 'raw_post_content' : 'post_content')
      .eq('id', lead.id)
      .maybeSingle();
    if (error || !data) throw new Error(error?.message || 'Could not load the post');

    const content = String((previewIsHotlist ? (data as { raw_post_content: string | null }).raw_post_content : (data as { post_content: string | null }).post_content) ?? '').trim();
    return content || 'No post content available.';
  }, [leadIsHotlist, persistLeadAction, postContentViewedLeadIds]);

  const handlePreviewPost = useCallback(async (lead: SocialLead) => {
    if (!user || loadingPostContentLeadId) return;
    // Consultants have no post worth opening, and this path is what charges
    // the one-time preview credit — a bulk blob is not something to bill for.
    if (leadIsHotlist(lead)) return;
    setLoadingPostContentLeadId(lead.id);
    try {
      const content = await fetchLeadRawContent(lead);
      if (content == null) return;
      setPostContentPreview({
        leadId: lead.id,
        title: lead.title || (leadIsHotlist(lead) ? 'Available Consultant' : 'Job Opportunity'),
        content,
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load the post', 'error');
    } finally {
      setLoadingPostContentLeadId(null);
    }
  }, [fetchLeadRawContent, leadIsHotlist, loadingPostContentLeadId, showToast, user]);

  // Detail-panel layout: opening a post's panel is the new trigger for the
  // same one-time credit charge the "Preview" button always charged — same
  // cost, same postContentViewedLeadIds tracking, just fired by selecting a
  // post instead of clicking a dedicated button.
  useEffect(() => {
    if (!isDetailLayout || !routeLeadId || !user) return;
    if (detailPanelContent?.leadId === routeLeadId) return;
    if (loadingDetailPanelLeadId === routeLeadId) return;

    const lead = dedupedScopedFeed.find((candidate) => candidate.id === routeLeadId && candidate.kind === routeLeadKind);
    if (!lead) return;
    // Same rule as the preview: no raw post for a consultant, so no fetch and
    // no charge. The pane's parsed fields above still describe them.
    if (leadIsHotlist(lead)) return;

    setLoadingDetailPanelLeadId(routeLeadId);
    void fetchLeadRawContent(lead)
      .then((content) => {
        if (content != null) setDetailPanelContent({ leadId: routeLeadId, content });
      })
      .catch((error) => {
        showToast(error instanceof Error ? error.message : 'Could not load the post', 'error');
      })
      .finally(() => setLoadingDetailPanelLeadId(null));
  }, [isDetailLayout, routeLeadId, routeLeadKind, user, detailPanelContent, leadIsHotlist, loadingDetailPanelLeadId, dedupedScopedFeed, fetchLeadRawContent, showToast]);

  // Keep a lead selected in the detail layout. Searching, filtering or paging
  // replaces the list with rows that don't include whatever was open, and the
  // pane would sit empty beside a full column of results. This routes through
  // handleSelectDetailLead rather than just picking leads[0] for display,
  // because the panel's content loader keys off the routed lead id — deriving
  // a selection without navigating renders the header and leaves the body
  // permanently blank.
  useEffect(() => {
    if (!isDetailLayout || feedLoading) return;
    const routedLeadIsVisible = Boolean(routeLeadId)
      && detailLeadsForActiveTab.some((lead) => lead.id === routeLeadId && lead.kind === routeLeadKind);
    if (routedLeadIsVisible) return;
    const firstLead = detailLeadsForActiveTab[0];
    if (!firstLead) return;
    handleSelectDetailLead(firstLead);
  }, [detailLeadsForActiveTab, feedLoading, handleSelectDetailLead, isDetailLayout, routeLeadId, routeLeadKind]);


  const handleOpenBreakdown = useCallback(async (lead: SocialLead) => {
    setProcessingBreakdownLeadId(lead.id);
    try {
      const alreadyCharged = breakdownChargedLeadIds.has(lead.id);
      if (!alreadyCharged) {
        setBreakdownChargedLeadIds((prev) => {
          const next = new Set(prev);
          next.add(lead.id);
          return next;
        });
        void persistLeadAction(lead.id, 'breakdown');
      }

      setSelectedLead(lead);
      setShowBreakdown(true);
    } finally {
      setProcessingBreakdownLeadId(null);
    }
  }, [breakdownChargedLeadIds, persistLeadAction]);

  const applyFeedSearch = useCallback(async (
    queryOverride?: string,
    options?: { filtersOverride?: FeedSearchFilters },
  ) => {
    const rawQuery = (queryOverride ?? pendingFeedSearchQuery).trim();
    const parsed = parseFeedSearchIntent(rawQuery);
    const appliedQuery = parsed.roleQuery;
    // A fresh search resets the sidebar to whatever the query text implies.
    // Restoring from a URL is the exception: the link carries its own filters
    // and they must survive, or opening a shared link would drop every filter
    // the sender had set.
    const appliedFilters = options?.filtersOverride
      ?? mergeFeedFiltersWithIntent(DEFAULT_FEED_SEARCH_FILTERS, parsed.inferred);

    setFeedSearchQuery(appliedQuery);
    setFeedSearchFilters(appliedFilters);
    setIsRecentSearchesOpen(false);

    // Keep the query in the URL so a refresh (or a shared link) restores the
    // search instead of dropping back to an unfiltered feed. Marking the ref
    // first stops the ?q= effect below treating our own write as a new
    // incoming search and re-running it — which would log a duplicate entry
    // in job_search_history. replace: true so searching doesn't stack history
    // entries the user has to click back through.
    appliedSearchParamQueryRef.current = rawQuery || null;
    setAppliedRawSearchQuery(rawQuery);

    if (rawQuery && user?.id) {
      await supabase
        .from('job_search_history')
        .insert({
          user_id: user.id,
          account_id: account?.id ?? null,
          page: isHotlistFeed ? '/hotlist' : isCombinedFeed ? '/feed' : '/jobs',
          search_query: rawQuery,
        });
      void loadRecentSearches();
    }

    // Search itself is server-side now: feedSearchQuery is a loadFeed
    // dependency, so setting it above refetches page 1 with p_query set, across
    // the whole window rather than across whatever happened to be downloaded.
  }, [account?.id, isCombinedFeed, isHotlistFeed, loadRecentSearches, pendingFeedSearchQuery, user?.id]);

  useEffect(() => {
    const queryFromParams = (searchParams.get('q') ?? '').trim();
    if (!queryFromParams) {
      appliedSearchParamQueryRef.current = null;
      return;
    }
    if (appliedSearchParamQueryRef.current === queryFromParams) return;
    appliedSearchParamQueryRef.current = queryFromParams;
    setPendingFeedSearchQuery(queryFromParams);
    const filtersFromUrl = readFeedFiltersFromUrl(searchParams);
    const urlCarriesFilters = JSON.stringify(filtersFromUrl) !== JSON.stringify(DEFAULT_FEED_SEARCH_FILTERS);
    void applyFeedSearch(queryFromParams, urlCarriesFilters ? { filtersOverride: filtersFromUrl } : undefined);
  }, [applyFeedSearch, searchParams]);

  const leaderboardJobsLabel = isCombinedFeed ? 'Leads' : isHotlistFeed ? 'Consultants' : 'Jobs';
  const leaderboardVendorsLabel = isCombinedFeed ? 'Recruiters' : isHotlistFeed ? 'Bench Recruiters' : 'Vendors';

  // One list, two homes: the desktop left rail and the mobile Recent tab.
  const renderAiMatchRailItems = () => (
    <>
                {aiMatchOwnPostsLoading && aiMatchOwnPosts.length === 0 ? (
                  <div className="flex justify-center py-6"><LogoSpinner size={18} /></div>
                ) : aiMatchOwnPosts.length === 0 ? (
                  <div className="px-1 py-5 text-center">
                    <p className="text-[12px] text-gray-500 dark:text-slate-400">
                      {aiMatchTarget === 'jobs' ? 'No consultants posted yet.' : 'No jobs posted yet.'}
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate(aiMatchOwnPostsPath)}
                      className="mt-2 text-[11px] font-semibold text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                    >
                      {aiMatchTarget === 'jobs' ? 'Add a consultant' : 'Add a job'}
                    </button>
                  </div>
                ) : (
                  aiMatchOwnPosts.map((post) => {
                    const lastRun = aiMatchLastRunForPost(post);
                    const isActive = post.description === aiMatchDescription;
                    return (
                      // The whole card is the target — a name is a small thing
                      // to hit — with Match as the one nested control.
                      <div
                        key={post.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectAiMatchPost(post, lastRun)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAiMatchPost(post, lastRun); }
                        }}
                        title={post.title}
                        className={`cursor-pointer rounded-xl border p-2.5 transition-colors ${
                          isActive
                            ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-400/50 dark:bg-indigo-500/10'
                            : 'border-gray-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/40 dark:border-white/10 dark:bg-[#1B1E24] dark:hover:border-indigo-400/30 dark:hover:bg-white/5'
                        }`}
                      >
                        {/* Two lines, not an ellipsis: these are people's names
                            and a truncated one is not recognisable. */}
                        <p className="line-clamp-2 break-words text-[12px] font-semibold leading-snug text-gray-900 dark:text-slate-100">
                          {post.title}
                        </p>
                        {post.subtitle && (
                          <p className="mt-0.5 line-clamp-1 break-words text-[11px] leading-snug text-gray-500 dark:text-slate-400">
                            {post.subtitle}
                          </p>
                        )}
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="min-w-0 truncate text-[10px] text-gray-400 dark:text-slate-500">
                            {lastRun
                              ? `${lastRun.count} ${lastRun.count === 1 ? 'match' : 'matches'}`
                              : 'Not matched yet'}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void runAiMatch(post.description, post.title, post.id); }}
                            disabled={aiMatchRunning}
                            title={lastRun ? `Up to ${AI_MATCH_MAX_CREDITS_PER_RUN} credits \u00b7 1 per new match` : `Up to ${AI_MATCH_MAX_CREDITS_PER_RUN} credits \u00b7 1 per match`}
                            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-lg bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 px-2 text-[10px] font-semibold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Sparkles size={10} />
                            {lastRun ? 'Rematch' : 'Match'}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}

                {aiMatchLooseRecents.length > 0 && (
                  <div className="pt-2">
                    <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-slate-500">Recent pastes</p>
                    {aiMatchLooseRecents.map((item) => (
                      // Same shape as a post row: these have all run before, so
                      // they always show their count and always say Rematch.
                      <div
                        key={`${item.at}-${item.description.slice(0, 24)}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => selectAiMatchRecent(item)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectAiMatchRecent(item); }
                        }}
                        title={item.description.slice(0, 300)}
                        className={`mb-1.5 cursor-pointer rounded-xl border p-2.5 transition-colors ${
                          item.description === aiMatchDescription
                            ? 'border-indigo-400 bg-indigo-50 dark:border-indigo-400/50 dark:bg-indigo-500/10'
                            : 'border-gray-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/40 dark:border-white/10 dark:bg-[#1B1E24] dark:hover:border-indigo-400/30 dark:hover:bg-white/5'
                        }`}
                      >
                        <p className="line-clamp-2 break-words text-[12px] font-semibold leading-snug text-gray-900 dark:text-slate-100">
                          {aiMatchRecentLabel(item)}
                        </p>
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <span className="truncate text-[10px] text-gray-400 dark:text-slate-500">
                            {item.count} {item.count === 1 ? 'match' : 'matches'}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void runAiMatch(item.description, item.title, item.postId); }}
                            disabled={aiMatchRunning}
                            title={`Up to ${AI_MATCH_MAX_CREDITS_PER_RUN} credits \u00b7 1 per new match`}
                            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 px-2 py-1 text-[10px] font-semibold text-white transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Sparkles size={10} />
                            Rematch
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
    </>
  );

  return (
    <div className="h-[100dvh] overflow-hidden overscroll-none bg-[#f3f2ee] text-gray-900 flex flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0 dark:bg-[#1B1D21] dark:text-slate-100">
      <AppNav />

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className={`h-full w-full flex flex-col overflow-hidden ${isMobileViewport ? 'px-2 pt-0 pb-2' : 'px-2 py-2'}`}>


          {loading ? (
            <div className="flex h-full min-h-0 items-center justify-center">
              <LogoSpinner size={24} />
            </div>
          ) : (
            <div className="flex h-full min-h-0 gap-2.5 overflow-hidden">
            {aiMatch && !isMobileViewport && (
              // The left rail is the whole point of coming back: their own
              // consultants (or jobs), each one tap from a fresh run. Desktop
              // only — on a phone the same list is the recents row under the
              // box, because a rail would eat the screen the composer needs.
              <aside className="flex w-64 shrink-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white xl:w-72 dark:border-white/10 dark:bg-[#171A1F]">
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-3 py-2.5 dark:border-white/10">
                  <span className="text-[12px] font-semibold text-gray-900 dark:text-slate-100">
                    {aiMatchOwnPostsLabel}
                    {aiMatchOwnPosts.length > 0 && <span className="ml-1 text-gray-400 dark:text-slate-500">{aiMatchOwnPosts.length}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => navigate(aiMatchOwnPostsPath)}
                    className="text-[11px] text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                  >
                    Manage
                  </button>
                </div>

                <div className="slim-scrollbar min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 py-2">
                  {renderAiMatchRailItems()}
                </div>

                <div className="shrink-0 border-t border-gray-100 px-2 py-2 dark:border-white/10">
                  <button
                    type="button"
                    onClick={clearAiMatchResults}
                    className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                  >
                    New match
                  </button>
                </div>
              </aside>
            )}
            <div className="flex h-full min-w-0 min-h-0 flex-1 flex-col gap-2 overflow-hidden">
              {/* Category Pills (desktop horizontal scroll) */}
              <div className="hidden shrink-0 hide-scrollbar w-full overflow-x-auto">
                <div className="flex w-max min-w-full gap-1.5">
                  {[...PROFILE_CATEGORY_TABS]
                    .map((category) => {
                      const categoryProfiles = jobsRankedLeaderboard.filter((p) => isPersonaInCategory(p, category.id));
                      const vendorsCount = categoryProfiles.reduce((s, p) => s + (profileStatsByRole[normalize(p.target_role)]?.uniqueVendors ?? 0), 0);
                      const jobsCount = categoryProfiles.reduce((s, p) => s + (profileStatsByRole[normalize(p.target_role)]?.uniqueJobs ?? 0), 0);
                      return { category, vendorsCount, jobsCount };
                    })
                    .sort((a, b) => {
                      if (a.category.id === 'all') return -1;
                      if (b.category.id === 'all') return 1;
                      return b.jobsCount - a.jobsCount || a.category.label.localeCompare(b.category.label);
                    })
                    .map(({ category, vendorsCount, jobsCount }) => {
                      const isSelected = selectedCategoryId === category.id;
                      const CategoryIcon = category.icon;

                      return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => { setSelectedCategoryId(category.id); setSelectedTechStacks([]); setActivePersona(null); }}
                        className={`inline-flex shrink-0 flex-col items-center gap-0.5 rounded-md border px-3 py-1.5 text-[12px] font-medium transition ${getCategoryTabClass(category.id, isSelected, isDark)}`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <CategoryIcon size={14} className={isSelected ? 'text-slate-200' : 'text-slate-400'} />
                          <span>{category.label}</span>
                        </span>
                        <span className={`inline-flex items-center gap-1.5 text-[10px] ${isSelected ? 'text-slate-400' : 'text-slate-500'}`}>
                          <span className={`inline-flex items-center gap-0.5 ${isSelected ? 'text-slate-200' : ''}`}><Building2 size={9} />{vendorsCount}</span>
                          <span className={`inline-flex items-center gap-0.5 ${isSelected ? 'text-slate-200' : ''}`}><Briefcase size={9} />{jobsCount}</span>
                        </span>
                      </button>
                      );
                    })}
                </div>
              </div>

              {selectedCategoryId !== 'all' && CATEGORY_TECH_STACKS[selectedCategoryId] && (
                <div className="hidden shrink-0 hide-scrollbar w-full overflow-x-auto">
                  <div className="flex w-max min-w-full gap-1.5 pb-1">
                    {CATEGORY_TECH_STACKS[selectedCategoryId].map((tech) => {
                      const isActive = selectedTechStacks.includes(tech);
                      return (
                        <button
                          key={tech}
                          type="button"
                          onClick={() => setSelectedTechStacks((prev) => isActive ? prev.filter((t) => t !== tech) : [...prev, tech])}
                          className={`shrink-0 rounded-full border px-3 py-1 text-[12px] font-medium transition ${getTechStackClass(selectedCategoryId, isActive, isDark)}`}
                        >
                          {tech}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Search & Filter: collapsed pill on mobile, inline bar on desktop */}
              <div className="hidden flex-wrap items-center gap-2">
                  <div className="min-w-[240px] flex-1">
                    <label htmlFor="profile-search" className="sr-only">Search profiles</label>
                    <div className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2 py-1.5">
                      <Search size={12} className="text-gray-400" />
                      <input
                        id="profile-search"
                        type="text"
                        value={profileSearchQuery}
                        onChange={(e) => setProfileSearchQuery(e.target.value)}
                        placeholder="Search profiles"
                        className="w-full border-0 bg-transparent text-[12px] text-gray-700 outline-none placeholder:text-gray-400"
                      />
                    </div>
                  </div>
                  <select
                    id="profile-range-filter"
                    aria-label="Date range"
                    value={profileRangeId}
                    onChange={(e) => setProfileRangeId(e.target.value as ProfileRangeOption['id'])}
                    className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[12px] font-medium text-gray-700"
                  >
                    {PROFILE_RANGE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                  {lastMatchAt && (
                    <span className="text-[11px] italic text-gray-400">Last refreshed {formatAgo(lastMatchAt)}</span>
                  )}
                  <button
                    onClick={() => {
                      void refreshFeed();
                    }}
                    disabled={profileStatsLoading || refreshing || feedLoading}
                    className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <span className="inline-flex items-center gap-1">
                      <RefreshCw size={11} className={refreshing || profileStatsLoading ? 'animate-spin' : ''} />
                      Refresh
                    </span>
                  </button>
                </div>

              {aiMatch && isMobileViewport && (aiMatchOwnPosts.length > 0 || aiMatchRecentsForTarget.length > 0) && (
                <div className="shrink-0 px-1 pt-1.5">
                  <div className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-white/5">
                    {([
                      { id: 'match' as const, label: 'Match' },
                      { id: 'recent' as const, label: 'Recent', count: aiMatchOwnPosts.length + aiMatchLooseRecents.length },
                    ]).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setAiMatchMobileTab(tab.id)}
                        className={`flex-1 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                          aiMatchMobileTab === tab.id
                            ? 'bg-white text-gray-900 shadow-sm dark:bg-[#22262c] dark:text-slate-100'
                            : 'text-gray-500 dark:text-slate-400'
                        }`}
                      >
                        {tab.label}
                        {tab.count ? <span className="ml-1 text-gray-400 dark:text-slate-500">{tab.count}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {aiMatchRecentTabActive && (
                <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-1.5 pb-6 pt-2">
                  {renderAiMatchRailItems()}
                </div>
              )}

              {aiMatch && !aiMatchRecentTabActive && (
                <div className={isMobileViewport ? 'shrink-0 px-1 pt-1.5 pb-1' : 'shrink-0 px-2 py-2'}>
                  {aiMatchComposerOpen ? (
                    // Two shapes. On a phone, before the first run, this is the
                    // page: centred and about half the screen. On desktop it is
                    // a full-width bar with the action on the right, where a
                    // half-screen hero would just be a lot of empty space.
                    <div className={!isMobileViewport || aiMatchHasRun ? '' : 'flex min-h-[55vh] flex-col justify-center py-4'}>
                      <div className={isMobileViewport ? 'mx-auto w-full max-w-3xl' : 'w-full'}>
                        {isMobileViewport && !aiMatchHasRun && (
                          <div className="mb-4 flex items-center justify-center gap-2.5">
                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30">
                              <Sparkles size={20} />
                            </span>
                            <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100">AI Match</h1>
                          </div>
                        )}
                        <div
                          onDragOver={(e) => { e.preventDefault(); }}
                          onDrop={(e) => {
                            const file = e.dataTransfer.files?.[0];
                            if (!file) return;
                            e.preventDefault();
                            void handleAiMatchFile(file);
                          }}
                          className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 dark:border-white/10 dark:bg-[#171A1F]"
                        >
                          <div className={isMobileViewport ? '' : 'flex items-start gap-3'}>
                            <textarea
                              value={aiMatchDescription}
                              onChange={(e) => {
                                setAiMatchDescription(e.target.value);
                                if (aiMatchFileName) setAiMatchFileName('');
                                if (aiMatchError) setAiMatchError(null);
                              }}
                              onKeyDown={(e) => {
                                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                  e.preventDefault();
                                  void runAiMatch();
                                }
                              }}
                              maxLength={8000}
                              autoFocus={!isMobileViewport && !aiMatchHasRun}
                              placeholder={animatedAiMatchPlaceholder || (aiMatchTarget === 'jobs' ? 'Paste consultant hotlist' : 'Paste job description')}
                              aria-label={aiMatchTarget === 'jobs' ? 'Consultant hotlist' : 'Job description'}
                              className={`w-full resize-none border-0 bg-transparent px-1 py-1 text-[15px] leading-relaxed text-gray-800 outline-none placeholder:text-gray-400 dark:text-slate-100 ${
                                isMobileViewport
                                  ? (aiMatchHasRun ? 'min-h-[7.5rem]' : 'min-h-[30vh]')
                                  : 'max-h-56 min-h-[3.25rem] flex-1'
                              }`}
                            />
                            {!isMobileViewport && (
                              <button
                                type="button"
                                onClick={() => void runAiMatch()}
                                disabled={aiMatchRunning || aiMatchDescription.trim().length === 0}
                                className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 px-6 text-[14px] font-semibold text-white shadow-md shadow-indigo-500/30 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Sparkles size={17} />
                                {aiMatchRunning ? 'Matching...' : 'Find matches'}
                              </button>
                            )}
                          </div>
                          <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center justify-center gap-2 sm:justify-start">
                              <input
                                ref={aiMatchFileInputRef}
                                type="file"
                                accept={AI_MATCH_FILE_TYPES}
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  // Cleared so picking the same file twice still fires.
                                  e.target.value = '';
                                  if (file) void handleAiMatchFile(file);
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => aiMatchFileInputRef.current?.click()}
                                disabled={aiMatchFileReading || aiMatchRunning}
                                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-2 text-[11px] font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                              >
                                <Paperclip size={12} />
                                {aiMatchFileReading ? 'Reading\u2026' : aiMatchTarget === 'jobs' ? 'Upload resume' : 'Upload JD'}
                              </button>
                              <span className={`min-w-0 truncate text-[12px] ${aiMatchError ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
                                {aiMatchError ?? (
                                  aiMatchDescription.trim().length > 0 && aiMatchDescription.trim().length < AI_MATCH_MIN_DESCRIPTION_CHARS
                                    ? `${AI_MATCH_MIN_DESCRIPTION_CHARS - aiMatchDescription.trim().length} more characters`
                                    : aiMatchFileName
                                      ? `From ${aiMatchFileName}`
                                      : `Up to ${AI_MATCH_MAX_CREDITS_PER_RUN} credits · 1 per match · last 30 days`
                                )}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              {aiMatchHasRun && (
                                <button
                                  type="button"
                                  onClick={() => setAiMatchComposerOpen(false)}
                                  className={`rounded-xl px-5 text-[15px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5 ${isMobileViewport ? 'h-12' : 'h-9 text-[13px]'}`}
                                >
                                  Hide
                                </button>
                              )}
                              {isMobileViewport && (
                                <button
                                  type="button"
                                  onClick={() => void runAiMatch()}
                                  disabled={aiMatchRunning || aiMatchDescription.trim().length === 0}
                                  className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 px-7 text-[15px] font-semibold text-white shadow-md shadow-indigo-500/30 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  <Sparkles size={18} />
                                  {aiMatchRunning ? 'Matching...' : 'Find matches'}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex w-full items-start gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-left dark:border-white/10 dark:bg-[#171A1F]">
                      <Sparkles size={13} className="mt-0.5 shrink-0 text-indigo-500" />
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={() => setAiMatchComposerOpen(true)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAiMatchComposerOpen(true); } }}
                        className="min-w-0 flex-1 cursor-pointer"
                      >
                        {(aiMatchFromTitle || isMobileViewport) && (
                          <span className="block truncate text-[12px] font-semibold text-gray-900 dark:text-slate-100">
                            {aiMatchFromTitle || aiMatchDescription.trim().split('\n').map((line) => line.trim()).find((line) => line.length >= 3)?.slice(0, 60) || 'Your paste'}
                          </span>
                        )}
                        {isMobileViewport ? (
                          // One line of counts instead of two of pasted text:
                          // the results below are what the screen is for.
                          <span className="block text-[11px] leading-snug text-gray-500 dark:text-slate-400">
                            {aiMatchSummary
                              ? `${aiMatchSummary.returned} ${aiMatchSummary.returned === 1 ? 'match' : 'matches'}${aiMatchSummary.best != null ? ` · best ${aiMatchSummary.best}/10` : ''}`
                              : 'Tap to edit'}
                          </span>
                        ) : (
                          /* Two lines of the description, whitespace collapsed so a
                             pasted hotlist's line breaks don't waste them. */
                          <span className="line-clamp-2 block text-[12px] leading-snug text-gray-700 dark:text-slate-300">
                            {aiMatchDescription.trim().replace(/\s+/g, ' ')}
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => setAiMatchComposerOpen(true)}
                        title="Edit"
                        aria-label="Edit"
                        className="mt-0.5 shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
                      >
                        <Pencil size={12} />
                      </button>
                      {isMobileViewport && (
                        <button
                          type="button"
                          onClick={clearAiMatchResults}
                          title="Clear results"
                          aria-label="Clear results"
                          className="mt-0.5 shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/5"
                        >
                          <X size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void runAiMatch()}
                        disabled={aiMatchRunning}
                        className="shrink-0 rounded-lg bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white transition active:scale-95 disabled:opacity-40"
                      >
                        {aiMatchRunning ? 'Matching' : 'Rematch'}
                      </button>
                    </div>
                  )}

                  {(aiMatchSummary || aiMatchHasRun) && !aiMatchRunning && !(isMobileViewport && !aiMatchComposerOpen) && (
                    // Results with no explanation read as a random list. This
                    // says what was searched, how much of it, and what it cost.
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 px-1 text-[11px] text-gray-500 dark:text-slate-400">
                      {aiMatchSummary && (
                        <>
                      <span className="font-semibold text-gray-900 dark:text-slate-100">
                        {aiMatchSummary.returned} {aiMatchSummary.returned === 1 ? 'match' : 'matches'}
                      </span>
                      {aiMatchSummary.fresh != null && (
                        <span className={aiMatchSummary.fresh > 0 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : ''}>
                          · {aiMatchSummary.fresh} new
                        </span>
                      )}
                      {aiMatchSummary.saved && <span>· saved</span>}
                      {/* Only when the box is hidden: with it open, its first
                          line already says who this is for. */}
                      {aiMatchSummary.matchedFor && !aiMatchComposerOpen && (
                        <span>· for <span className="font-semibold text-gray-900 dark:text-slate-100">{aiMatchSummary.matchedFor}</span></span>
                      )}
                      {aiMatchSummary.best != null && <span>· best {aiMatchSummary.best}/10</span>}
                      {aiMatchSummary.scanned > 0 && <span>· from {aiMatchSummary.scanned.toLocaleString()} scanned</span>}
                      {aiMatchSummary.credits > 0 && <span>· {aiMatchSummary.credits} credits</span>}
                      {aiMatchSummary.posted > 0 && (
                        <button
                          type="button"
                          onClick={() => navigate(aiMatchTarget === 'jobs' ? '/posts/hotlist' : '/posts/jobs')}
                          className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                        >
                          · {aiMatchSummary.posted > 1 ? `${aiMatchSummary.posted} posted to ` : 'posted to '}
                          {aiMatchTarget === 'jobs' ? 'My Hotlist' : 'My Jobs'}
                        </button>
                      )}
                        </>
                      )}
                      <button
                        type="button"
                        onClick={clearAiMatchResults}
                        className="text-gray-500 underline-offset-2 hover:underline dark:text-slate-400"
                      >
                        {aiMatchSummary ? '· Clear' : 'Clear results'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Mobile search/filter row — controls job feed search */}
              <div
                className={aiMatch ? 'hidden' : isMobileViewport ? `sticky top-0 z-30 shrink-0 bg-[#f3f2ee] px-0 transition-[max-height,opacity,transform] duration-200 ease-out dark:bg-[#1B1D21] ${isRangeMenuOpen || isRecentSearchesOpen ? 'overflow-visible' : 'overflow-hidden'}` : 'px-2 py-2'}
                style={isMobileViewport ? {
                  maxHeight: isMobileTopCollapsed ? '0px' : '52px',
                  opacity: isMobileTopCollapsed ? 0 : 1,
                  transform: isMobileTopCollapsed ? 'translateY(-8px)' : 'translateY(0)',
                  pointerEvents: isMobileTopCollapsed ? 'none' : 'auto',
                  paddingTop: isMobileTopCollapsed ? 0 : '0.375rem',
                  paddingBottom: isMobileTopCollapsed ? 0 : '0.25rem',
                } : undefined}
              >
                <div className="flex items-center gap-2">
                  <div ref={recentSearchesRef} className="relative flex flex-1 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5">
                    <Search size={11} className="text-gray-400" />
                    <input
                      type="text"
                      value={pendingFeedSearchQuery}
                      onChange={(e) => setPendingFeedSearchQuery(e.target.value)}
                      onFocus={() => {
                        setIsRecentSearchesOpen(true);
                        void loadRecentSearches();
                      }}
                      onClick={() => {
                        setIsRecentSearchesOpen(true);
                        void loadRecentSearches();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void applyFeedSearch();
                        }
                      }}
                      placeholder={animatedSearchPlaceholder}
                      className="w-full border-0 bg-transparent text-[12px] text-gray-700 outline-none placeholder:text-gray-400"
                    />
                    {pendingFeedSearchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setPendingFeedSearchQuery('');
                          setFeedSearchQuery('');
                          setFeedSearchFilters(DEFAULT_FEED_SEARCH_FILTERS);
                          setIsRecentSearchesOpen(false);
                          // Mark the query that is still in the URL as already
                          // applied, rather than nulling the ref. The URL is
                          // rewritten by an effect a render later, and until
                          // then the ?q= effect would read the stale param,
                          // see a ref that doesn't match, and "restore" the
                          // search we are in the middle of clearing.
                          appliedSearchParamQueryRef.current = (searchParams.get('q') ?? '').trim() || null;
                          setAppliedRawSearchQuery('');
                        }}
                        className="rounded-full p-0.5 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-600"
                        aria-label="Clear search field"
                      >
                        <X size={11} />
                      </button>
                    )}

                    {isRecentSearchesOpen && recentSearches.length > 0 && (
                      <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                        {recentSearches.map((search, idx) => (
                          <button
                            key={`${search}-${idx}`}
                            type="button"
                            onClick={() => {
                              setPendingFeedSearchQuery(search);
                              void applyFeedSearch(search);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-medium text-gray-700 transition hover:bg-gray-50"
                          >
                            <Clock3 size={10} className="text-gray-400" />
                            <span className="truncate">{search}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      void applyFeedSearch();
                    }}
                    className="rounded-full border border-blue-600 bg-blue-600 p-1.5 text-white transition hover:bg-blue-700 disabled:opacity-60"
                    disabled={feedLoading}
                    aria-label="Search"
                  >
                    <Search size={12} className={feedLoading ? 'animate-pulse' : ''} />
                  </button>

                  {SWIPE_LAYOUT_ENABLED && isMobileViewport && (
                    <button
                      type="button"
                      onClick={() => setLayoutMode(isSwipeLayout ? 'card' : 'swipe')}
                      className="shrink-0 rounded-full border border-gray-200 bg-gray-50 p-1.5 text-gray-600 transition hover:bg-gray-100 dark:border-white/10 dark:bg-[#20242a] dark:text-[#94A3B8] dark:hover:bg-white/5"
                      aria-label={isSwipeLayout ? 'Switch to list view' : 'Switch to swipe view'}
                    >
                      {isSwipeLayout ? <LayoutGrid size={12} /> : <Layers size={12} />}
                    </button>
                  )}

                  {/* AI Match is one ranked list; the action tabs are feed furniture. */}
                  {!isMobileViewport && !isSwipeLayout && !aiMatch && (
                    <div className="flex shrink-0 items-center gap-1">
                      {matchesTabDefinitions.map((tab) => {
                        const isSelected = selectedMatchesTab === tab.id;
                        const count = matchesTabCounts[tab.id];
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => {
                              setSelectedMatchesTab(tab.id);
                              setVisibleMatchesCount(MATCHES_PAGE_SIZE);
                              if (tab.id === 'previewed') setDesktopPreviewedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
                              if (tab.id === 'asked') setDesktopAskedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
                              if (tab.id === 'verified') setDesktopVerifiedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
                              if (tab.id === 'queued') setDesktopRecentVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
                            }}
                            title={tab.label}
                            aria-label={tab.label}
                            className={`inline-flex items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${isSelected ? (isDark ? 'border border-white/25 bg-[#2A2E35] text-slate-100' : 'border border-blue-600 bg-blue-600 text-white') : (isDark ? 'border border-transparent bg-[#171a1f] text-[#94A3B8] hover:bg-[#1e2228] hover:text-slate-300' : 'border border-transparent bg-white text-gray-500 hover:text-gray-700')}`}
                          >
                            <tab.icon size={13} strokeWidth={2.25} />
                            <span>{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {!isMobileViewport && !hotlistOnlyFeed && (
                    <div className="flex shrink-0 items-center rounded-md border border-gray-200 bg-gray-50 p-0.5" aria-label="Layout view">
                      {([
                        { id: 'card' as PulseLayoutMode, label: 'Cards', icon: LayoutGrid },
                        { id: 'table' as PulseLayoutMode, label: 'Table', icon: Table2 },
                        { id: 'detail' as PulseLayoutMode, label: 'Detail', icon: PanelRight },
                        ...(SWIPE_LAYOUT_ENABLED ? [{ id: 'swipe' as PulseLayoutMode, label: 'Swipe', icon: Layers }] : []),
                      ]).map((view) => (
                        <button
                          key={view.id}
                          type="button"
                          onClick={() => {
                            setLayoutMode(view.id);
                            if (view.id !== 'detail' && routeLeadId) {
                              const search = searchParams.toString();
                              navigate({ pathname: feedBasePath, search: search ? `?${search}` : '' }, { replace: true });
                            }
                          }}
                          title={view.label}
                          aria-label={view.label}
                          className={`inline-flex items-center justify-center rounded px-2 py-1 text-[11px] font-semibold transition ${layoutMode === view.id ? 'bg-white text-blue-700 shadow-sm dark:bg-[#2A2E35] dark:text-blue-300' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                          <view.icon size={13} />
                        </button>
                      ))}
                    </div>
                  )}

                  <div ref={rangeMenuRef} className="relative shrink-0">
                    <button
                      onClick={() => {
                        setIsRangeMenuOpen((prev) => !prev);
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-100"
                      aria-label="Change date range"
                    >
                      <Clock3 size={11} />
                      <span>{PROFILE_RANGE_SHORT_LABELS[profileRangeId]}</span>
                    </button>

                    {isRangeMenuOpen && (
                      <div className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-[116px] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                        {PROFILE_RANGE_OPTIONS.map((option) => {
                          const isActive = option.id === profileRangeId;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                setProfileRangeId(option.id);
                                setIsRangeMenuOpen(false);
                              }}
                              className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${isActive ? (isDark ? 'bg-[#2A2E35] text-slate-100' : 'bg-gray-100 text-gray-800') : 'text-gray-600 hover:bg-gray-50'}`}
                            >
                              <span>{option.label}</span>
                              {isActive ? <Check size={11} /> : null}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className={`flex min-h-0 flex-1 gap-3 ${aiMatchRecentTabActive ? 'hidden' : ''}`}>
              {!isMobileViewport && !aiMatch && (
                <aside className="flex h-full w-56 shrink-0 flex-col rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-[#171A1F]">
                  <div className="flex shrink-0 items-center justify-between border-b border-gray-100 p-3 pb-2.5 dark:border-white/10">
                    <span className="text-[12px] font-bold text-gray-900 dark:text-slate-100">Filters</span>
                    {JSON.stringify(feedSearchFilters) !== JSON.stringify(DEFAULT_FEED_SEARCH_FILTERS) && (
                      <button
                        type="button"
                        onClick={() => setFeedSearchFilters(DEFAULT_FEED_SEARCH_FILTERS)}
                        className="text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
                  {([
                    { category: 'experienceRange' as FeedFacetCategory, title: 'Experience', options: EXPERIENCE_RANGE_OPTIONS.filter((opt) => opt.id !== 'all').map((opt) => ({ value: opt.id, label: `${opt.label} yrs` })) },
                    { category: 'workType' as FeedFacetCategory, title: 'Work Type', options: WORK_TYPE_OPTIONS.filter((opt) => opt.value !== 'all') },
                    { category: 'employmentType' as FeedFacetCategory, title: 'Employment Type', options: EMPLOYMENT_TYPE_OPTIONS.filter((opt) => opt.value !== 'all') },
                    { category: 'visaStatus' as FeedFacetCategory, title: 'Visa', options: VISA_STATUS_OPTIONS.filter((opt) => opt.value !== 'all') },
                  ]).map(({ category, title, options }) => (
                    <div key={category}>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#64748B]">{title}</div>
                      <div className="flex flex-col gap-0.5">
                        {options.map((opt) => {
                          const count = feedFacetCounts[category][opt.value] ?? 0;
                          const isChecked = feedSearchFilters[category].includes(opt.value);
                          return (
                            <label
                              key={opt.value}
                              className={`flex cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 text-[12px] transition ${isChecked ? (isDark ? 'bg-blue-500/10 text-blue-300' : 'bg-blue-50 text-blue-700') : (isDark ? 'text-slate-300 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50')} ${count === 0 && !isChecked ? 'opacity-40' : ''}`}
                            >
                              <span className="flex min-w-0 items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleFeedFacetOption(category, opt.value)}
                                  disabled={count === 0 && !isChecked}
                                  className="h-3 w-3 shrink-0 accent-blue-600"
                                />
                                <span className="truncate">{opt.label}</span>
                              </span>
                              <span className="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-[#64748B]">{count}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}

                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#64748B]">Location</label>
                    <LocationChipInput
                      values={feedSearchFilters.location}
                      onChange={(next) => setFeedSearchFilters((prev) => ({ ...prev, location: next }))}
                      placeholder="Search a city/state"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#64748B]">Skills</label>
                    <input
                      type="text"
                      value={pendingSkillsFilter}
                      onChange={(e) => setPendingSkillsFilter(e.target.value)}
                      onBlur={applyPendingTextFilters}
                      onKeyDown={handleFilterFieldKeyDown}
                      placeholder="e.g. React"
                      className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[12px] text-gray-700 outline-none placeholder:text-gray-400 dark:border-white/10 dark:bg-[#20242a] dark:text-slate-200 dark:placeholder:text-[#64748B]"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#64748B]">Rate</label>
                    <select
                      value={feedSearchFilters.rateMode}
                      onChange={(e) => setFeedSearchFilters((prev) => ({ ...prev, rateMode: e.target.value as FeedSearchFilters['rateMode'] }))}
                      className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[12px] text-gray-700 dark:border-white/10 dark:bg-[#20242a] dark:text-slate-200"
                    >
                      <option value="all">Any</option>
                      <option value="has_rate">Has a rate listed</option>
                      <option value="range">Within range</option>
                    </select>
                    {feedSearchFilters.rateMode === 'range' && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <input
                          type="number"
                          value={pendingRateMin}
                          onChange={(e) => setPendingRateMin(e.target.value)}
                          onBlur={applyPendingTextFilters}
                          onKeyDown={handleFilterFieldKeyDown}
                          placeholder="Min"
                          className="w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[12px] text-gray-700 outline-none placeholder:text-gray-400 dark:border-white/10 dark:bg-[#20242a] dark:text-slate-200 dark:placeholder:text-[#64748B]"
                        />
                        <span className="shrink-0 text-[11px] text-gray-400">–</span>
                        <input
                          type="number"
                          value={pendingRateMax}
                          onChange={(e) => setPendingRateMax(e.target.value)}
                          onBlur={applyPendingTextFilters}
                          onKeyDown={handleFilterFieldKeyDown}
                          placeholder="Max"
                          className="w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[12px] text-gray-700 outline-none placeholder:text-gray-400 dark:border-white/10 dark:bg-[#20242a] dark:text-slate-200 dark:placeholder:text-[#64748B]"
                        />
                      </div>
                    )}
                  </div>
                  </div>

                  <div className="shrink-0 border-t border-gray-100 p-3 pt-2.5 dark:border-white/10">
                    <button
                      type="button"
                      onClick={applyPendingTextFilters}
                      className="w-full rounded-md bg-blue-600 px-2 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700"
                    >
                      Apply
                    </button>
                  </div>
                </aside>
              )}
              <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-transparent">

              <div
                className={`min-w-0 h-full flex min-h-0 flex-col ${isMobileViewport ? 'relative isolate overflow-x-hidden overflow-y-auto overscroll-contain bg-transparent slim-scrollbar' : 'overflow-hidden'}`}
                onScroll={isMobileViewport ? handleMobileRightPaneScroll : undefined}
                onTouchStart={isMobileViewport && !isSwipeLayout ? handleMobilePullStart : undefined}
                onTouchMove={isMobileViewport && !isSwipeLayout ? handleMobilePullMove : undefined}
                onTouchEnd={isMobileViewport && !isSwipeLayout ? handleMobilePullEnd : undefined}
              >
                {false && isMobileViewport ? (
                  <div className="sticky top-0 z-20 shrink-0 flex items-center gap-2 bg-white/90 px-1.5 py-2 backdrop-blur">
                    <div className="inline-flex items-center gap-2 min-w-0 shrink-0 rounded-full bg-blue-50/70 px-2 py-1">
                      <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-blue-700">Profiles</span>
                    </div>
                    <div className="ml-auto grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedProfilesView('all')}
                        className={`inline-flex items-center justify-center gap-0.5 rounded-full px-2 py-1 text-[11px] font-semibold transition ${selectedProfilesView === 'all' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        <span>All</span>
                        <span className={`text-[10px] font-bold ${selectedProfilesView === 'all' ? 'text-white/90' : 'text-gray-500'}`}>{profileViewCounts.all}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedProfilesView('watching')}
                        className={`inline-flex items-center justify-center gap-0.5 rounded-full px-2 py-1 text-[11px] font-semibold transition ${selectedProfilesView === 'watching' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        <span>Watching</span>
                        <span className={`text-[10px] font-bold ${selectedProfilesView === 'watching' ? 'text-white/90' : 'text-gray-500'}`}>{profileViewCounts.watching}</span>
                      </button>
                    </div>
                  </div>
                ) : null}

              {false && <section className="min-w-0 shrink-0 overflow-hidden">
                {!isMobileViewport ? (
                  <div className="shrink-0 flex items-center gap-2 bg-white/90 px-1.5 py-2 backdrop-blur">
                    <div className="inline-flex items-center gap-2 min-w-0 shrink-0 rounded-full bg-blue-50/70 px-2 py-1">
                      <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-blue-700">Profiles</span>
                    </div>
                  </div>
                ) : null}
                {/* Profile list */}
                {isMobileViewport ? (
                  <div ref={profileListScrollRef} className="overflow-x-auto overflow-y-hidden pb-1 slim-scrollbar">
                    <div className="flex gap-2 px-1.5 py-2 snap-x snap-mandatory">
                      {visibleJobsRankedLeaderboard.length === 0 && (
                        <div className="px-3 py-8 text-center text-[13px] text-gray-400">No profiles found.</div>
                      )}
                          {visibleJobsRankedLeaderboard.map((persona, index) => {
                        const isWatching = watchingRoles.has(normalize(persona.target_role));
                        const isActivating = activatingRole === persona.target_role;
                        const isSelected = normalize(activePersona?.target_role) === normalize(persona.target_role);
                        const stats = profileStatsByRole[normalize(persona.target_role)] ?? zeroStats;
                        const profilePulseVisual = getMarketPulseVisual(stats.uniqueJobs);
                        const details = getPersonaDetailColumns(persona);
                        const isExpanded = expandedMobileProfileCardIds.has(persona.target_role);
                        const collapsedDetails = [
                          { key: 'experience', detail: formatPersonaDetailValue(details.experience) },
                          { key: 'rate', detail: formatPersonaDetailValue(details.rateRange) },
                          { key: 'visa', detail: formatPersonaDetailValue(details.visaStatus) },
                        ];
                        const expandedDetails = [
                          ...collapsedDetails,
                          { key: 'location', detail: formatPersonaDetailValue(details.location) },
                          { key: 'employment', detail: formatPersonaDetailValue(details.employmentType) },
                          { key: 'work', detail: formatPersonaDetailValue(details.workType) },
                        ];
                        const mobileDetails = isExpanded ? expandedDetails : collapsedDetails;

                        return (
                              <div
                            key={persona.target_role}
                            onClick={() => void selectPersona(persona)}
                            className={`snap-start shrink-0 w-[84%] cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${profilePulseVisual.cardToneClass} ${isSelected ? 'ring-1 ring-gray-300' : ''}`}
                          >
                              <div className="flex items-start justify-between gap-1.5">
                              <p className={`text-[12px] font-semibold leading-snug ${getRoleRowAccentClass(index, isDark)}`}>{persona.target_role}</p>
                              <div className="ml-auto flex items-center gap-1">
                                {renderMarketPulseSymbol(profilePulseVisual.level, profilePulseVisual.badgeClass, stats.uniqueJobs)}
                              </div>
                            </div>
                            <div className={`mt-1 grid grid-cols-3 gap-1 text-[11px] leading-tight ${isExpanded ? '' : ''}`}>
                              {mobileDetails.map((item) => (
                                <div
                                  key={item.key}
                                  className="min-w-0 truncate rounded border border-gray-200 bg-white px-1.5 py-1 text-gray-600"
                                >
                                  {item.detail.missing ? <PersonaMissingTag /> : item.detail.value}
                                </div>
                              ))}
                            </div>
                            <div className="mt-1 space-y-1.5">
                              <div className="flex items-center gap-1.5">
                                <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[10px] font-bold text-gray-700">{stats.uniqueJobs} {leaderboardJobsLabel}</span>
                                <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[10px] font-bold text-gray-700">{stats.uniqueVendors} {leaderboardVendorsLabel}</span>
                              </div>
                              <div className="grid grid-cols-10 gap-1.5">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedMobileProfileCardIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(persona.target_role)) next.delete(persona.target_role);
                                      else next.add(persona.target_role);
                                      return next;
                                    });
                                  }}
                                  className="col-span-3 inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-2 py-1 text-gray-600 transition hover:bg-gray-50"
                                  aria-label={isExpanded ? 'Collapse profile details' : 'Expand profile details'}
                                >
                                  {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); void activatePersona(persona); }}
                                  disabled={isActivating}
                                  className={`col-span-7 inline-flex items-center justify-center rounded-md border px-2 py-1 text-[10px] font-semibold transition ${isWatching ? 'border-blue-300 bg-blue-100 text-blue-700' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                                >
                                  {isActivating ? '...' : isWatching ? '✓ Watching' : '+ Watch'}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {canLoadMoreProfiles && (
                        <div ref={mobileProfilesLoadMoreRef} className="flex w-[84%] shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-[11px] text-gray-400 snap-start">
                          Loading more profiles...
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 px-2 py-2">
                    <div className="min-w-0 rounded-md bg-transparent">
                      <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-gray-600">All ({profileViewCounts.all})</div>
                      <div className="overflow-x-auto overflow-y-hidden pb-1 slim-scrollbar">
                        <div className="flex gap-2 px-1.5 py-2 snap-x snap-mandatory">
                          {filteredJobsRankedLeaderboard.filter((item) => !watchingRoles.has(normalize(item.target_role))).length === 0 && (
                            <div className="px-3 py-6 text-center text-[13px] text-gray-400">No profiles found.</div>
                          )}
                          {filteredJobsRankedLeaderboard.filter((item) => !watchingRoles.has(normalize(item.target_role))).map((persona, index) => {
                            const isWatching = watchingRoles.has(normalize(persona.target_role));
                            const isActivating = activatingRole === persona.target_role;
                            const isSelected = normalize(activePersona?.target_role) === normalize(persona.target_role);
                            const stats = profileStatsByRole[normalize(persona.target_role)] ?? zeroStats;
                            const profilePulseVisual = getMarketPulseVisual(stats.uniqueJobs);
                            const details = getPersonaDetailColumns(persona);
                            const experience = formatPersonaDetailValue(details.experience);
                            const location = formatPersonaDetailValue(details.location);
                            const rateRange = formatPersonaDetailValue(details.rateRange);
                            const employmentType = formatPersonaDetailValue(details.employmentType);
                            const workType = formatPersonaDetailValue(details.workType);
                            const visaStatus = formatPersonaDetailValue(details.visaStatus);

                            return (
                              <div
                                key={`all-${persona.target_role}`}
                                onClick={() => void selectPersona(persona)}
                                className={`snap-start shrink-0 w-[clamp(220px,20vw,290px)] cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${profilePulseVisual.cardToneClass} ${isSelected ? 'ring-1 ring-gray-300' : ''}`}
                              >
                                <div className="flex items-center justify-between gap-1.5">
                                  <p className={`text-[12px] font-semibold leading-snug ${getRoleRowAccentClass(index, isDark)}`}>{persona.target_role}</p>
                                  <div className="flex items-center gap-1">
                                    {renderMarketPulseSymbol(profilePulseVisual.level, profilePulseVisual.badgeClass, stats.uniqueJobs)}
                                  </div>
                                </div>
                                <div className="mt-1 grid grid-cols-3 gap-1 text-[11px] leading-tight">
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{experience.missing ? <PersonaMissingTag /> : experience.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{location.missing ? <PersonaMissingTag /> : location.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{rateRange.missing ? <PersonaMissingTag /> : rateRange.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{employmentType.missing ? <PersonaMissingTag /> : employmentType.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{workType.missing ? <PersonaMissingTag /> : workType.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{visaStatus.missing ? <PersonaMissingTag /> : visaStatus.value}</div>
                                </div>
                                <div className="mt-1 space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[10px] font-bold text-gray-700">{stats.uniqueJobs} {leaderboardJobsLabel}</span>
                                    <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[10px] font-bold text-gray-700">{stats.uniqueVendors} {leaderboardVendorsLabel}</span>
                                  </div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); void activatePersona(persona); }}
                                    disabled={isActivating}
                                    className={`inline-flex w-full items-center justify-center rounded-md border px-2 py-1 text-[10px] font-semibold transition ${isWatching ? 'border-blue-300 bg-blue-100 text-blue-700' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                                  >
                                    {isActivating ? '...' : isWatching ? '✓ Watching' : '+ Watch'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0 rounded-md bg-transparent">
                      <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-gray-600">Watching ({profileViewCounts.watching})</div>
                      <div className="overflow-x-auto overflow-y-hidden pb-1 slim-scrollbar">
                        <div className="flex gap-2 px-1.5 py-2 snap-x snap-mandatory">
                          {orderedJobsRankedLeaderboard.filter((item) => watchingRoles.has(normalize(item.target_role))).length === 0 && (
                            <div className="px-3 py-6 text-center text-[13px] text-gray-400">No watching profiles yet.</div>
                          )}
                          {orderedJobsRankedLeaderboard.filter((item) => watchingRoles.has(normalize(item.target_role))).map((persona, index) => {
                            const isWatching = watchingRoles.has(normalize(persona.target_role));
                            const isActivating = activatingRole === persona.target_role;
                            const isSelected = normalize(activePersona?.target_role) === normalize(persona.target_role);
                            const stats = profileStatsByRole[normalize(persona.target_role)] ?? zeroStats;
                            const profilePulseVisual = getMarketPulseVisual(stats.uniqueJobs);
                            const details = getPersonaDetailColumns(persona);
                            const experience = formatPersonaDetailValue(details.experience);
                            const location = formatPersonaDetailValue(details.location);
                            const rateRange = formatPersonaDetailValue(details.rateRange);
                            const employmentType = formatPersonaDetailValue(details.employmentType);
                            const workType = formatPersonaDetailValue(details.workType);
                            const visaStatus = formatPersonaDetailValue(details.visaStatus);

                            return (
                              <div
                                key={`watching-${persona.target_role}`}
                                onClick={() => void selectPersona(persona)}
                                className={`snap-start shrink-0 w-[clamp(220px,20vw,290px)] cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${profilePulseVisual.cardToneClass} ${isSelected ? 'ring-1 ring-gray-300' : ''}`}
                              >
                                <div className="flex items-center justify-between gap-1.5">
                                  <p className={`text-[12px] font-semibold leading-snug ${getRoleRowAccentClass(index, isDark)}`}>{persona.target_role}</p>
                                  <div className="flex items-center gap-1">
                                    {renderMarketPulseSymbol(profilePulseVisual.level, profilePulseVisual.badgeClass, stats.uniqueJobs)}
                                  </div>
                                </div>
                                <div className="mt-1 grid grid-cols-3 gap-1 text-[11px] leading-tight">
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{experience.missing ? <PersonaMissingTag /> : experience.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{location.missing ? <PersonaMissingTag /> : location.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{rateRange.missing ? <PersonaMissingTag /> : rateRange.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{employmentType.missing ? <PersonaMissingTag /> : employmentType.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{workType.missing ? <PersonaMissingTag /> : workType.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{visaStatus.missing ? <PersonaMissingTag /> : visaStatus.value}</div>
                                </div>
                                <div className="mt-1 space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[10px] font-bold text-gray-700">{stats.uniqueJobs} {leaderboardJobsLabel}</span>
                                    <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[10px] font-bold text-gray-700">{stats.uniqueVendors} {leaderboardVendorsLabel}</span>
                                  </div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); void activatePersona(persona); }}
                                    disabled={isActivating}
                                    className={`inline-flex w-full items-center justify-center rounded-md border px-2 py-1 text-[10px] font-semibold transition ${isWatching ? 'border-blue-300 bg-blue-100 text-blue-700' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                                  >
                                    {isActivating ? '...' : isWatching ? '✓ Watching' : '+ Watch'}
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                <div className="hidden shrink-0 items-center justify-between gap-2 border-t border-gray-200 bg-white px-2 py-1.5">
                  <p className="text-[11px] text-gray-500">
                    {profilePage}/{totalProfilePages}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setProfilePage((p) => Math.max(1, p - 1))}
                      disabled={profilePage <= 1}
                      className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    >
                      ‹
                    </button>
                    <button
                      onClick={() => setProfilePage((p) => Math.min(totalProfilePages, p + 1))}
                      disabled={profilePage >= totalProfilePages}
                      className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    >
                      ›
                    </button>
                  </div>
                </div>
              </section>}

              {isMobileViewport && !isSwipeLayout && !aiMatch && (
                <div
                  className="sticky top-0 z-40 shrink-0 overflow-hidden bg-[#f3f2ee] px-1.5 transition-[max-height,opacity,transform] duration-200 ease-out transform-gpu backface-hidden dark:bg-[#1B1D21]"
                  style={{
                    maxHeight: isMobileTopCollapsed ? '0px' : '40px',
                    opacity: isMobileTopCollapsed ? 0 : 1,
                    transform: isMobileTopCollapsed ? 'translateY(-8px)' : 'translateY(0)',
                    pointerEvents: isMobileTopCollapsed ? 'none' : 'auto',
                    paddingBottom: isMobileTopCollapsed ? 0 : '0.25rem',
                  }}
                >
                  <div className="flex w-full items-stretch gap-1">
                    {matchesTabDefinitions.map((tab) => {
                      const isSelected = selectedMatchesTab === tab.id;
                      const count = matchesTabCounts[tab.id];
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => { setSelectedMatchesTab(tab.id); setVisibleMatchesCount(MATCHES_PAGE_SIZE); }}
                          title={tab.label}
                          aria-label={tab.label}
                          className={`inline-flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition ${isSelected ? (isDark ? 'border border-white/25 bg-[#22262c] text-slate-100' : 'border border-blue-600 bg-blue-600 text-white') : (isDark ? 'border border-transparent bg-[#171a1f] text-[#94A3B8] hover:bg-[#1e2228] hover:text-slate-300' : 'border border-transparent bg-white text-gray-500 hover:text-gray-700')}`}
                        >
                          <tab.icon size={13} strokeWidth={2.25} />
                          <span>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {isMobileViewport && (pullDistance > 0 || isPullRefreshing) && (
                <div className="shrink-0 flex items-center justify-center bg-[rgba(255,255,255,0.95)] text-[10px] font-medium text-gray-500 dark:bg-transparent dark:text-[#94A3B8]">
                  <div style={{ height: `${Math.max(14, Math.min(24, pullDistance))}px` }} className="flex items-center gap-1 py-0.5">
                    <RefreshCw size={9} className={isPullRefreshing ? 'animate-spin' : ''} />
                    <span>{isPullRefreshing ? 'Refreshing...' : (mobilePullArmedRef.current ? 'Release to refresh' : 'Pull to refresh')}</span>
                  </div>
                </div>
              )}

              {/* One mount above the results section: the mobile list and the
                  desktop tabbed columns are different branches below, and
                  putting it inside either one hid it on the other layout. */}
              {aiMatch && account?.id && filteredFeed.length > 0 && (
                <div className="shrink-0 pt-1">
                  <BulkAiSubmitBar
                    targets={filteredFeed
                      .filter((lead) => lead.aiMatchScore != null
                        && (bulkSelectedIds.size === 0 || bulkSelectedIds.has(lead.id)))
                      .map((lead) => ({
                        id: lead.id,
                        title: lead.title || lead.roleTitle || 'Untitled',
                        company: lead.company || '',
                        hasEmail: Boolean(extractPrimaryEmail(lead.posterEmail)),
                        kind: leadIsHotlist(lead) ? 'hotlist' as const : 'job' as const,
                      }))}
                    accountId={account.id}
                    sourceJobId={aiMatchSourcePostId}
                    gmailConnected={gmailIntegrationStatus === 'connected'}
                    isNarrowed={bulkSelectedIds.size > 0}
                    onClearSelection={() => setBulkSelectedIds(new Set())}
                    onConnectGmail={() => { void handleConnectGmailStandalone(); }}
                    onDone={() => { void refreshFeed(); }}
                  />
                </div>
              )}

              <section className={`min-w-0 flex min-h-0 flex-col ${isMobileViewport ? 'flex-none' : 'flex-1 overflow-hidden'}`}>
                <div className={`min-h-0 ${isMobileViewport ? '' : 'flex-1 overflow-hidden'}`}>
                  {aiMatchRunning ? (
                    <div className="flex min-h-[40vh] w-full flex-col items-center justify-center gap-3">
                      <LogoSpinner size={22} />
                      <p className="px-6 text-center text-[12px] text-gray-500">{aiMatchProgress ?? 'Matching'}</p>
                    </div>
                  ) : feedLoading ? (
                    <div className={`${isMobileViewport ? 'flex min-h-[50vh] w-full' : 'flex h-full min-h-0 w-full'} items-center justify-center`}>
                      <LogoSpinner size={20} />
                    </div>
                  ) : (
                    isMobileViewport ? (
                      <div>
                        {isSwipeLayout ? (
                          <SwipeDeck
                            leads={recentVisibleFeed}
                            buildLeadCardProps={buildLeadCardProps}
                            isHotlistFeed={isCombinedFeed ? (recentVisibleFeed[0] ? leadIsHotlist(recentVisibleFeed[0]) : false) : isHotlistFeed}
                            onPass={handleSwipePass}
                            onPitch={handleSwipePitch}
                          />
                        ) : filteredFeed.length === 0 ? (
                          // Before a first AI Match run the input panel above is
                          // the whole page; an empty-state icon under it is noise.
                          aiMatchEmptyMessage === '' ? null : (
                          <div className="flex items-center justify-center p-6 text-center">
                            <div>
                              <Radar size={16} className="mx-auto text-gray-300" />
                              <p className="mt-1.5 text-[12px] text-gray-500">{aiMatchEmptyMessage ?? 'No matches yet'}</p>
                            </div>
                          </div>
                          )
                        ) : (
                          <div className="space-y-2 bg-[#f3f2ee] px-1.5 pt-1 pb-4 dark:bg-[#1B1D21]">
                            {renderLeadCards(visibleFeed)}
                            {renderFeedPagingFooter()}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="min-h-0 h-full rounded-md bg-transparent p-1">
                        <div
                          ref={desktopMatchesScrollRef}
                          className={`min-h-0 h-full overflow-y-auto slim-scrollbar ${isTableLayout ? 'px-1.5 pb-1.5' : 'p-1.5'}`}
                          onScroll={selectedMatchesTab === 'previewed' ? handleDesktopPreviewedScroll : selectedMatchesTab === 'asked' ? handleDesktopAskedScroll : selectedMatchesTab === 'verified' ? handleDesktopVerifiedScroll : handleDesktopRecentScroll}
                        >
                          {isSwipeLayout ? (
                            <SwipeDeck
                              leads={recentVisibleFeed}
                              buildLeadCardProps={buildLeadCardProps}
                              isHotlistFeed={isCombinedFeed ? (recentVisibleFeed[0] ? leadIsHotlist(recentVisibleFeed[0]) : false) : isHotlistFeed}
                              onPass={handleSwipePass}
                              onPitch={handleSwipePitch}
                            />
                          ) : selectedMatchesTab === 'previewed' ? (
                            previewedVisibleFeed.length === 0 ? (
                              <div className="flex h-full items-center justify-center px-3 py-6 text-center text-[13px] text-gray-400">{isCombinedFeed ? 'No previewed leads yet.' : isHotlistFeed ? 'No previewed consultants yet.' : 'No previewed jobs yet.'}</div>
                            ) : isTableLayout ? (
                              renderLeadTable(visibleDesktopPreviewedFeed)
                            ) : isDetailLayout ? (
                              renderDetailSplitView(visibleDesktopPreviewedFeed)
                            ) : (
                              <div className="grid grid-cols-2 items-stretch gap-1.5 bg-[#f3f2ee] p-1.5 dark:bg-[#1B1D21]">
                                {renderLeadCards(visibleDesktopPreviewedFeed, 2)}
                              </div>
                            )
                          ) : selectedMatchesTab === 'asked' ? (
                            askedVisibleFeed.length === 0 ? (
                              <div className="flex h-full items-center justify-center px-3 py-6 text-center text-[13px] text-gray-400">{isCombinedFeed ? 'Nothing sent yet.' : isHotlistFeed ? 'No requested consultants yet.' : 'No submissions yet.'}</div>
                            ) : isTableLayout ? (
                              renderLeadTable(visibleDesktopAskedFeed)
                            ) : isDetailLayout ? (
                              renderDetailSplitView(visibleDesktopAskedFeed)
                            ) : (
                              <div className="grid grid-cols-2 items-stretch gap-1.5 bg-[#f3f2ee] p-1.5 dark:bg-[#1B1D21]">
                                {renderLeadCards(visibleDesktopAskedFeed, 2)}
                              </div>
                            )
                          ) : selectedMatchesTab === 'verified' ? (
                            verifiedVisibleFeed.length === 0 ? (
                              <div className="flex h-full items-center justify-center px-3 py-6 text-center text-[13px] text-gray-400">{isCombinedFeed ? 'No replies yet.' : isHotlistFeed ? 'No verified jobs yet.' : 'No replies yet.'}</div>
                            ) : isTableLayout ? (
                              renderLeadTable(visibleDesktopVerifiedFeed)
                            ) : isDetailLayout ? (
                              renderDetailSplitView(visibleDesktopVerifiedFeed)
                            ) : (
                              <div className="grid grid-cols-2 items-stretch gap-1.5 bg-[#f3f2ee] p-1.5 dark:bg-[#1B1D21]">
                                {renderLeadCards(visibleDesktopVerifiedFeed, 2)}
                              </div>
                            )
                          ) : (
                            recentVisibleFeed.length === 0 ? (
                              aiMatchEmptyMessage === '' ? null :
                              <div className="flex h-full items-center justify-center px-3 py-6 text-center text-[13px] text-gray-400">{aiMatchEmptyMessage ?? (isCombinedFeed ? 'No recent leads.' : isHotlistFeed ? 'No recent consultants.' : 'No recent jobs.')}</div>
                            ) : isTableLayout ? (
                              <>
                                {renderLeadTable(visibleDesktopRecentFeed)}
                                {renderFeedPagingFooter()}
                              </>
                            ) : isDetailLayout ? (
                              renderDetailSplitView(visibleDesktopRecentFeed, true)
                            ) : (
                              <div className="bg-[#f3f2ee] dark:bg-[#1B1D21]">
                                <div className="grid grid-cols-2 items-stretch gap-1.5 p-1.5">
                                  {renderLeadCards(visibleDesktopRecentFeed, 2)}
                                </div>
                                {renderFeedPagingFooter()}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </section>

              </div>
              </div>
              </div>
            </div>
            </div>
          )}
        </div>
      </main>

      {askAIPreview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => !processingAskAILeadId && setAskAIPreview(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ask-ai-preview-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
          >
            <div className="flex items-start gap-2.5">
              <div className="min-w-0 flex-1">
                <h2 id="ask-ai-preview-title" className="text-[15px] font-semibold text-gray-900">{askAIPreview.isGenerating ? (askAIPreview.leadType === 'hotlist' ? 'Generating screening invite' : 'Generating email draft for submission') : (askAIPreview.leadType === 'hotlist' ? 'Review screening invite' : 'Review submission')}</h2>
                {!askAIPreview.isGenerating && (askAIPreview.jobTitle || askAIPreview.company) && (
                  <p className="mt-0.5 truncate text-[13px] text-gray-500">
                    {askAIPreview.jobTitle}{askAIPreview.jobTitle && askAIPreview.company ? ' · ' : ''}{askAIPreview.company}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setAskAIPreview(null)}
                disabled={Boolean(processingAskAILeadId)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                aria-label="Close email preview"
              >
                <X size={14} />
              </button>
            </div>
            {askAIPreview.isGenerating ? (
              <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
                <LogoSpinner size={28} />
                <p className="mt-4 text-[13px] leading-relaxed text-gray-500">{askAIPreview.leadType === 'hotlist' ? 'Generating email draft for request' : 'Generating email draft for submission'}</p>
              </div>
            ) : <>
            <div className="mt-3 divide-y divide-gray-100 border-y border-gray-100 text-[13px]">
              <div className="flex items-center gap-2 py-2">
                <span className="w-14 shrink-0 text-gray-400">To</span>
                <span className="min-w-0 flex-1 truncate text-gray-900">{askAIPreview.vendorEmail || 'No email on file'}</span>
                <button
                  type="button"
                  onClick={() => void copyText(askAIPreview.vendorEmail, 'Email ID')}
                  disabled={!askAIPreview.vendorEmail}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Copy email ID"
                >
                  <Copy size={12} />
                </button>
              </div>
              <div className="flex items-center gap-2 py-2">
                <span className="w-14 shrink-0 text-gray-400">Subject</span>
                <input
                  value={askAIPreview.emailSubject}
                  onChange={(event) => setAskAIPreview((current) => current ? { ...current, emailSubject: event.target.value } : current)}
                  disabled={Boolean(processingAskAILeadId)}
                  placeholder="Subject"
                  className="min-w-0 flex-1 bg-transparent font-medium text-gray-900 outline-none"
                />
                <button
                  type="button"
                  onClick={() => void copyText(askAIPreview.emailSubject, 'Subject')}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  aria-label="Copy subject"
                >
                  <Copy size={12} />
                </button>
              </div>
              <div className="relative py-2">
                <textarea
                  value={askAIPreview.emailContent}
                  onChange={(event) => setAskAIPreview((current) => current ? { ...current, emailContent: event.target.value } : current)}
                  disabled={Boolean(processingAskAILeadId)}
                  rows={6}
                  placeholder="Write your message..."
                  className="w-full resize-none bg-transparent pr-7 leading-relaxed text-gray-900 outline-none"
                />
                <button
                  type="button"
                  onClick={() => void copyText(askAIPreview.emailContent, 'Email body')}
                  className="absolute right-0 top-2 inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  aria-label="Copy email body"
                >
                  <Copy size={12} />
                </button>
              </div>
            </div>
            {gmailIntegrationStatus === 'connected' ? (
              <button
                type="button"
                onClick={() => void handleSendViaGmail()}
                disabled={sendingViaGmail || !askAIPreview.vendorEmail || !askAIPreview.emailSubject.trim() || !askAIPreview.emailContent.trim()}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sendingViaGmail ? <LogoSpinner size={13} /> : <GmailIcon size={14} />}
                {sendingViaGmail ? 'Sending…' : 'Send via Gmail'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowGmailConnectPrompt(true)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700"
              >
                <GmailIcon size={14} />
                Connect Gmail to Send (takes 30 seconds)
              </button>
            )}
            </>}
          </div>
        </div>
      )}

      {showGmailConnectPrompt && (
        <GmailConnectPrompt
          connecting={connectingGmail}
          onClose={() => setShowGmailConnectPrompt(false)}
          onConnect={() => void handleConnectGmail()}
        />
      )}

      <InsufficientCreditsModal
        open={showOutOfCreditsModal}
        onClose={() => setShowOutOfCreditsModal(false)}
        balance={account?.credits_balance ?? 0}
        actionLabel={isCombinedFeed ? 'generate this outreach' : isHotlistFeed ? 'generate this request' : 'generate this submission email'}
      />

      {applyModalLead && (
        <SubmitApplicationModal
          jobId={applyModalLead.id}
          jobTitle={applyModalLead.title || 'this job'}
          onClose={() => setApplyModalLead(null)}
          onSaved={() => setApplyModalLead(null)}
          showToast={showToast}
        />
      )}

      {isBulkPredictModalOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
          onClick={() => { if (!bulkPredictSubmitting) { setIsBulkPredictModalOpen(false); setBulkPredictInput(''); } }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Bulk predict submission chance"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold uppercase tracking-wide text-gray-500">{!isCombinedFeed && isHotlistFeed ? `Match ${bulkPredictLeadIds.size} consultants` : `Predict ${bulkPredictLeadIds.size} leads`}</span>
              <button
                type="button"
                onClick={() => { if (!bulkPredictSubmitting) { setIsBulkPredictModalOpen(false); setBulkPredictInput(''); } }}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                aria-label="Close bulk predict modal"
              >
                <X size={14} />
              </button>
            </div>

            {!bulkPredictSubmitting ? (
              <>
                <div className="mt-2">
                  <textarea
                    value={bulkPredictInput}
                    onChange={(event) => setBulkPredictInput(event.target.value)}
                    rows={6}
                    placeholder={!isCombinedFeed && isHotlistFeed ? "Paste the job details or requirements here — we'll match all selected consultants against it..." : "Paste a resume, job description, or quick summary here — we'll run it against all selected leads..."}
                    className="w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-[13px] leading-relaxed text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleRunBulkPredict()}
                  disabled={!bulkPredictInput.trim()}
                  className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 text-[15px] font-bold uppercase tracking-wide text-orange-600 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-orange-400"
                >
                  <Gauge size={16} strokeWidth={2.5} />
                  {!isCombinedFeed && isHotlistFeed
                    ? `Match Score for ${bulkPredictLeadIds.size} Consultants${shouldChargeCredits() ? ` ($${(bulkPredictLeadIds.size * PREDICT_COST).toFixed(2)})` : ''}`
                    : `Predict ${bulkPredictLeadIds.size} Leads${shouldChargeCredits() ? ` ($${(bulkPredictLeadIds.size * PREDICT_COST).toFixed(2)})` : ''}`}
                </button>
              </>
            ) : (
              <div className="mt-2 py-4">
                <p className="text-center text-[13px] font-semibold text-gray-500">
                  Predicting {bulkPredictCompletedCount} of {bulkPredictLeadIds.size}...
                </p>
                <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 transition-all"
                    style={{ width: `${(bulkPredictCompletedCount / Math.max(1, bulkPredictLeadIds.size)) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}


      {postContentPreview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setPostContentPreview(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="post-content-preview-title"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-gray-200 bg-white shadow-xl"
          >
            <div className="flex items-start gap-2.5 border-b border-gray-100 p-4">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-500">
                <Eye size={16} />
              </span>
              <h2 id="post-content-preview-title" className="min-w-0 flex-1 truncate text-[15px] font-semibold text-gray-900">{postContentPreview.title}</h2>
              <button
                type="button"
                onClick={() => setPostContentPreview(null)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                aria-label="Close post preview"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-700">{postContentPreview.content}</p>
            </div>
          </div>
        </div>
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
