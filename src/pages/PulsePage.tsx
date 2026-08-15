import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  Handshake,
  Hash,
  LayoutGrid,
  Mail,
  Paperclip,
  Phone,
  Radar,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Server,
  Sparkles,
  Table2,
  Gauge,
  GraduationCap,
  Flame,
  Workflow,
  User,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import GmailConnectPrompt from '../components/GmailConnectPrompt';
import GmailIcon from '../components/GmailIcon';
import { isPulseAdmin } from '../lib/pulse-admin';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { HOTLIST_AI_SUGGESTIONS } from '../lib/hotlist-ai-suggestions';
import { buildScoreBreakdownDisplayItems } from '../lib/radar-match-ui';
import { matchesPulseFeedSearch } from '../lib/pulse-feed-search';

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
  consultantCount?: number;
  candidateIndex?: number;
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

type MatchesTabId = 'all' | 'breakdown' | 'revealed' | 'asked' | 'verified' | 'queued' | 'predicted';
type FeedTimeBasis = 'posted' | 'created';
type LeadActionType = 'revealed' | 'breakdown' | 'post_content_viewed' | 'ignored';

type AskedJobState = {
  requestedAt: string;
  fulfilledAt: string | null;
};

type GlobalAskedJobState = 'asked' | 'verified';
type EmailDraftTabId = 'pitching' | 'requestDetails';
type AskAIPreview = {
  leadId: string;
  leadType: 'job' | 'hotlist';
  requestId: string;
  vendorName: string;
  jobTitle: string;
  company: string;
  missingDetails: string[];
  emailSubject: string;
  emailContent: string;
  isGenerating: boolean;
  resumeUrl?: string;
  resumeFileName?: string;
  channel: 'mailgun' | 'gmail';
};
type FeedSearchFilters = {
  experienceRange: string;
  workType: string;
  employmentType: string;
  visaStatus: string;
  location: string;
  skillsQuery: string;
  rateMode: 'all' | 'has_rate' | 'range';
  rateMin: string;
  rateMax: string;
};

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

const DEFAULT_FEED_SEARCH_FILTERS: FeedSearchFilters = {
  experienceRange: 'all',
  workType: 'all',
  employmentType: 'all',
  visaStatus: 'all',
  location: '',
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

type PulseRevealNamesRow = {
  lead_id: string;
  revealer_names: string[] | null;
};

const LEADERBOARD_RPC_LIMIT = 500;
const FEED_WINDOW_HOURS = 48;
const PULSE_ROWS_CACHE_TTL_MS = 30_000;
const PULSE_CACHE_WORKER_URL = (import.meta.env.VITE_PULSE_CACHE_WORKER_URL ?? '').trim();
const PULSE_CACHE_WORKER_TOKEN = (import.meta.env.VITE_PULSE_CACHE_WORKER_TOKEN ?? '').trim();
const TOP_PROFILES_PAGE_SIZE = 10;
const MATCHES_PAGE_SIZE = 5;
const DESKTOP_MATCHES_PAGE_SIZE = 12;

type PulseLayoutMode = 'card' | 'table';
type LeadTableSortKey = 'role' | 'exp' | 'workType' | 'empType' | 'rate' | 'visa' | 'location' | 'posted';

type PredictCategory = { label: string; earned: number; max: number; note: string };
type PredictResult = { score: number; categories: PredictCategory[]; verdict: string; verdictClass: string };

const PREDICT_PROCESSING_LABELS = ['Skills', 'Experience', 'Visa', 'Work Type', 'Location', 'Employment Type'];

const PREDICT_MIN_PROCESSING_MS = 2300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PULSE_LAYOUT_MODE_STORAGE_KEY = 'profilepush-jobs-layout-mode';

function getInitialPulseLayoutMode(): PulseLayoutMode {
  if (typeof window === 'undefined') return 'card';
  const stored = window.localStorage.getItem(PULSE_LAYOUT_MODE_STORAGE_KEY);
  return stored === 'table' ? 'table' : 'card';
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
    inferred.employmentType = 'c2c';
  });
  consume(/\b(w2|w-2)\b/i, () => {
    inferred.employmentType = 'w2';
  });
  consume(/\b1099\b/i, () => {
    inferred.employmentType = '1099';
  });
  consume(/\bfull[\s-]?time\b|\bft\b/i, () => {
    inferred.employmentType = 'full_time';
  });
  consume(/\bpart[\s-]?time\b|\bpt\b/i, () => {
    inferred.employmentType = 'part_time';
  });
  consume(/\bcontract\b/i, () => {
    inferred.employmentType = 'contract';
  });

  consume(/\bremote\b/i, () => {
    inferred.workType = 'remote';
  });
  consume(/\bhybrid\b/i, () => {
    inferred.workType = 'hybrid';
  });
  consume(/\bonsite\b|\bon\s*site\b|\bon-site\b/i, () => {
    inferred.workType = 'onsite';
  });

  consume(/\b(usc|us\s*citizen)\b/i, () => {
    inferred.visaStatus = 'usc';
  });
  consume(/\b(gc|green\s*card)\b/i, () => {
    inferred.visaStatus = 'gc';
  });
  consume(/\b(h1b|h-1b)\b/i, () => {
    inferred.visaStatus = 'h1b';
  });
  consume(/\bead\b/i, () => {
    inferred.visaStatus = 'ead';
  });
  consume(/\bopt\b/i, () => {
    inferred.visaStatus = 'opt';
  });
  consume(/\bcpt\b/i, () => {
    inferred.visaStatus = 'cpt';
  });
  consume(/\btn\b/i, () => {
    inferred.visaStatus = 'tn';
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
    workType: base.workType !== 'all' ? base.workType : (inferred.workType ?? 'all'),
    employmentType: base.employmentType !== 'all' ? base.employmentType : (inferred.employmentType ?? 'all'),
    visaStatus: base.visaStatus !== 'all' ? base.visaStatus : (inferred.visaStatus ?? 'all'),
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

function getBreakdownCandidateValue(
  breakdown: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = breakdown?.[key];
  if (!value || typeof value !== 'object') return '';

  const detail = value as BreakdownDetail;
  return (detail.candidate_value ?? '').trim();
}

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

function hexToRgbChannels(hex: string): string {
  const cleaned = hex.replace('#', '').trim();
  const normalized = cleaned.length === 3
    ? cleaned.split('').map((char) => `${char}${char}`).join('')
    : cleaned;
  const value = Number.parseInt(normalized, 16);
  if (Number.isNaN(value)) return '56 189 248';
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

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
      className={`inline-flex items-center gap-1 rounded border border-blue-200 bg-white/90 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-blue-700 transition-all duration-700 ${played ? 'translate-y-0 scale-100 opacity-100' : '-translate-y-1 scale-95 opacity-0'}`}
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

function maskPosterName(name: string) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'Posted by hidden';
  return `Posted by ${trimmed.slice(0, 3)}***`;
}

function maskName(name: string) {
  const trimmed = (name ?? '').trim();
  return trimmed ? `${trimmed.slice(0, 3)}***` : 'Hidden';
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

function buildPulseLeadDedupKey(lead: SocialLead) {
  const title = dedupeText(lead.title);
  const company = dedupeText(lead.company);
  const location = dedupeText(lead.location);
  const platform = dedupeText(lead.platform);

  return [title, company, location || '-', platform || '-'].join('|');
}

function roleMatchesPersona(row: SocialJobRow, personaRole: string, personaSkills: string[]) {
  const roleText = normalize(personaRole);
  const titleText = normalize(`${row.extracted_role_normalized ?? ''} ${row.job_title ?? ''}`);
  const fullText = normalize(`${titleText} ${row.post_content ?? ''}`);
  if (!fullText) return false;

  if (fullText.includes(roleText)) return true;

  const personaBucketKey = getPersonaBucket(personaRole).key;
  const rowBucketKey = getPersonaBucket(`${row.extracted_role_normalized ?? ''} ${row.job_title ?? ''}`).key;
  if (personaBucketKey && rowBucketKey && personaBucketKey === rowBucketKey) return true;

  const roleTokens = canonicalizeRoleForUniqueness(personaRole)
    .split(' ')
    .filter((token) => token.length >= 3 && !['engineer', 'developer', 'senior', 'lead', 'staff', 'principal'].includes(token));

  const titleRoleHits = roleTokens.reduce((count, token) => count + (titleText.includes(token) ? 1 : 0), 0);
  const fullRoleHits = roleTokens.reduce((count, token) => count + (fullText.includes(token) ? 1 : 0), 0);
  const skillHits = personaSkills.reduce((count, skill) => count + (fullText.includes(normalize(skill)) ? 1 : 0), 0);

  if (roleTokens.length > 0) {
    if (titleRoleHits >= Math.min(2, roleTokens.length)) return true;
    if (fullRoleHits >= Math.min(2, roleTokens.length) && skillHits >= 1) return true;
    return false;
  }

  return skillHits >= 2;
}

function getPersonaSkillList(role: string, personaSkills?: string | null) {
  const skillStr = personaSkills ?? findSuggestionForRole(role)?.skills;
  if (!skillStr) return [];
  return skillStr.split(',').map((item) => item.trim()).filter(Boolean);
}

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
  feedKind?: 'jobs' | 'hotlist';
};

export default function PulsePage({ feedKind = 'jobs' }: PulsePageProps) {
  const { account, subscription, user, refreshAccount } = useAuth();
  const { isDark } = useTheme();
  const isHotlistFeed = feedKind === 'hotlist';
  const canSelectFeedTimeBasis = user?.email?.toLowerCase() === 'poornapotluri27@gmail.com';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activatingRole, setActivatingRole] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<PulsePersona[]>([]);
  const [watchingRoles, setWatchingRoles] = useState<Set<string>>(new Set());
  const [activePersona, setActivePersona] = useState<PulsePersona | null>(null);
  const [feed, setFeed] = useState<SocialLead[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [lastMatchAt, setLastMatchAt] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
    const breakdownBorderClass = 'border-slate-600/45 dark:border-slate-500/40';

  const [profileRangeId, setProfileRangeId] = useState<ProfileRangeOption['id']>('24h');
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [selectedTechStacks, setSelectedTechStacks] = useState<string[]>([]);
  const [profileSearchQuery, setProfileSearchQuery] = useState('');
  const [isRangeMenuOpen, setIsRangeMenuOpen] = useState(false);
  const [isRecentSearchesOpen, setIsRecentSearchesOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [feedSearchQuery, setFeedSearchQuery] = useState('');
  const [feedSearchFilters, setFeedSearchFilters] = useState<FeedSearchFilters>(DEFAULT_FEED_SEARCH_FILTERS);
  const [pendingFeedSearchQuery, setPendingFeedSearchQuery] = useState('');
  const [vectorSearchLeadIds, setVectorSearchLeadIds] = useState<string[] | null>(null);
  const [vectorSearchLoading, setVectorSearchLoading] = useState(false);
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
  const [expandedMobileProfileCardIds, setExpandedMobileProfileCardIds] = useState<Set<string>>(new Set());
  const [selectedLead, setSelectedLead] = useState<SocialLead | null>(null);
  const [processingAskAILeadId, setProcessingAskAILeadId] = useState<string | null>(null);
  const [askAIPreview, setAskAIPreview] = useState<AskAIPreview | null>(null);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [showGmailConnectPrompt, setShowGmailConnectPrompt] = useState(false);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [generatedEmailDrafts, setGeneratedEmailDrafts] = useState<{ pitching: string; requestDetails: string }>({
    pitching: '',
    requestDetails: '',
  });
  const [selectedEmailDraftTab, setSelectedEmailDraftTab] = useState<EmailDraftTabId>('pitching');
  const [showGeneratedEmailDraft, setShowGeneratedEmailDraft] = useState(false);
  const [expandedInlineBreakdownLeadIds, setExpandedInlineBreakdownLeadIds] = useState<Set<string>>(new Set());
  const [selectedMatchesTab, setSelectedMatchesTab] = useState<MatchesTabId>('queued');
  const [feedTimeBasis, setFeedTimeBasis] = useState<FeedTimeBasis>('posted');
  const [layoutMode, setLayoutMode] = useState<PulseLayoutMode>(getInitialPulseLayoutMode);
  const isTableLayout = layoutMode === 'table' && !isMobileViewport;
  const [tableSortKey, setTableSortKey] = useState<LeadTableSortKey | null>('posted');
  const [tableSortDirection, setTableSortDirection] = useState<'asc' | 'desc'>('desc');
  const [expandedSkillsLeadIds, setExpandedSkillsLeadIds] = useState<Set<string>>(new Set());
  const [expandedFieldKeys, setExpandedFieldKeys] = useState<Set<string>>(new Set());
  const [predictLead, setPredictLead] = useState<SocialLead | null>(null);
  const [predictInput, setPredictInput] = useState('');
  const [predictResult, setPredictResult] = useState<PredictResult | null>(null);
  const [predictResultByLeadId, setPredictResultByLeadId] = useState<Record<string, PredictResult>>({});
  const [predictedAtByLeadId, setPredictedAtByLeadId] = useState<Record<string, string>>({});
  const [predictSubmitting, setPredictSubmitting] = useState(false);
  const [predictProcessingStep, setPredictProcessingStep] = useState(0);
  const [recentPredictTexts, setRecentPredictTexts] = useState<string[]>([]);
  const [bulkPredictLeadIds, setBulkPredictLeadIds] = useState<Set<string>>(new Set());
  const [isBulkPredictModalOpen, setIsBulkPredictModalOpen] = useState(false);
  const [bulkPredictInput, setBulkPredictInput] = useState('');
  const [bulkPredictSubmitting, setBulkPredictSubmitting] = useState(false);
  const [bulkPredictCompletedCount, setBulkPredictCompletedCount] = useState(0);
  const [visibleMatchesCount, setVisibleMatchesCount] = useState(MATCHES_PAGE_SIZE);
  const [desktopRecentVisibleCount, setDesktopRecentVisibleCount] = useState(DESKTOP_MATCHES_PAGE_SIZE);
  const [desktopRevealedVisibleCount, setDesktopRevealedVisibleCount] = useState(DESKTOP_MATCHES_PAGE_SIZE);
  const [desktopAskedVisibleCount, setDesktopAskedVisibleCount] = useState(DESKTOP_MATCHES_PAGE_SIZE);
  const [desktopVerifiedVisibleCount, setDesktopVerifiedVisibleCount] = useState(DESKTOP_MATCHES_PAGE_SIZE);
  const [desktopPredictedVisibleCount, setDesktopPredictedVisibleCount] = useState(DESKTOP_MATCHES_PAGE_SIZE);
  const [revealedLeadIds, setRevealedLeadIds] = useState<Set<string>>(new Set());
  const [askedJobStateByLeadId, setAskedJobStateByLeadId] = useState<Record<string, AskedJobState>>({});
  const [globalAskedJobStateByLeadId, setGlobalAskedJobStateByLeadId] = useState<Record<string, GlobalAskedJobState>>({});
  const [askedLeadsById, setAskedLeadsById] = useState<Record<string, SocialLead>>({});
  const [breakdownChargedLeadIds, setBreakdownChargedLeadIds] = useState<Set<string>>(new Set());
  const [postContentViewedLeadIds, setPostContentViewedLeadIds] = useState<Set<string>>(new Set());
  const [postContentPreview, setPostContentPreview] = useState<{ leadId: string; title: string; content: string } | null>(null);
  const [loadingPostContentLeadId, setLoadingPostContentLeadId] = useState<string | null>(null);
  const [ignoredLeadIds, setIgnoredLeadIds] = useState<Set<string>>(new Set());
  const [processingIgnoreLeadId, setProcessingIgnoreLeadId] = useState<string | null>(null);
  const [queuedLeadIds, setQueuedLeadIds] = useState<Set<string>>(new Set());
  const [revealCountsByLeadId, setRevealCountsByLeadId] = useState<Record<string, number>>({});
  const [revealNamesByLeadId, setRevealNamesByLeadId] = useState<Record<string, string[]>>({});
  const [revealedAtByLeadId, setRevealedAtByLeadId] = useState<Record<string, string>>({});
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [processingLeadId, setProcessingLeadId] = useState<string | null>(null);
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

  const connectGmail = useCallback(async () => {
    if (!account?.id || connectingGmail) return;
    setConnectingGmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('gmail-oauth-start', { body: { account_id: account.id } });
      if (error || !data?.url) throw new Error(data?.error || 'Could not start Gmail connection');
      window.location.href = data.url;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start Gmail connection', 'error');
      setConnectingGmail(false);
    }
  }, [account?.id, connectingGmail, showToast]);

  const REVEAL_CONTACT_COST = 0.05;
  const BREAKDOWN_COST = 0.1;
  const PREDICT_COST = 0.01;
  const POST_CONTENT_COST = 0.1;
  const isAdminUser = isPulseAdmin(user?.email);
  // Display-only — the actual submit charge is computed server-side in the
  // ask-ai-vendor-email edge function's JOB_SUBMIT_COST constant.
  const SUBMIT_COST_DISPLAY = 0.05;
  // Display-only — mirrors ask-ai-vendor-email edge function's ASK_AI_COST for the hotlist "Ask Resume" action.
  const ASK_RESUME_COST_DISPLAY = 0.05;
  const MAX_BULK_PREDICT = 5;
  const formatCentsCost = (amount: number) => `${Math.round(amount * 100)}c`;
  const FREE_PLAN_DAILY_REVEAL_LIMIT = 10;
  const isPaidPlan = subscription?.status === 'active' && (subscription.plan_amount_usd ?? 0) > 0;

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
      .eq('page', isHotlistFeed ? '/hotlist' : '/jobs')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) return;
    setRecentSearches(
      ((data ?? []) as Array<{ search_query: string | null }>)
        .map((row) => (row.search_query ?? '').trim())
        .filter(Boolean),
    );
  }, [isHotlistFeed, user?.id]);

  const loadRecentPredictTexts = useCallback(async () => {
    if (!user?.id) {
      setRecentPredictTexts([]);
      return;
    }

    const { data, error } = await supabase
      .from('job_search_history')
      .select('search_query')
      .eq('user_id', user.id)
      .eq('page', '/predict')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) return;
    setRecentPredictTexts(
      ((data ?? []) as Array<{ search_query: string | null }>)
        .map((row) => (row.search_query ?? '').trim())
        .filter(Boolean),
    );
  }, [user?.id]);

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

  const scopedFeed = useMemo(() => {
    let next = baseScopedFeed;

    if (feedSearchQuery.trim()) {
      if (Array.isArray(vectorSearchLeadIds) && vectorSearchLeadIds.length > 0) {
        const rankById = new Map<string, number>();
        vectorSearchLeadIds.forEach((id, idx) => rankById.set(id, idx));
        next = next
          .filter((lead) => rankById.has(lead.id))
          .sort((a, b) => (rankById.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rankById.get(b.id) ?? Number.MAX_SAFE_INTEGER));
      } else {
        next = next.filter((lead) => matchesPulseFeedSearch({
          title: lead.title,
          roleTitle: lead.roleTitle,
          company: lead.company,
          location: lead.location,
          posterName: lead.posterName,
          employmentType: lead.employmentType,
          seniority: lead.seniority,
          salaryRange: lead.salaryRange,
          hourlyRate: lead.hourlyRate,
          snippet: lead.snippet,
          skills: lead.skills,
          experienceYears: lead.experienceYears,
          visaTypes: lead.visaTypes,
        }, feedSearchQuery, 'all'));
      }
    }

    next = next.filter((lead) => {
      const fields = getLeadFilterContext(lead);

      if (!matchesExperienceRange(fields.experienceYears, feedSearchFilters.experienceRange)) return false;
      if (feedSearchFilters.workType !== 'all' && fields.workType !== feedSearchFilters.workType) return false;
      if (feedSearchFilters.employmentType !== 'all' && fields.employmentType !== feedSearchFilters.employmentType) return false;
      if (feedSearchFilters.visaStatus !== 'all' && fields.visaStatus !== feedSearchFilters.visaStatus) return false;

      if (feedSearchFilters.location.trim()) {
        const locationQuery = normalize(feedSearchFilters.location);
        if (!normalize(fields.location).includes(locationQuery)) return false;
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
    });

    return next;
  }, [baseScopedFeed, feedSearchFilters, feedSearchQuery, getLeadFilterContext, vectorSearchLeadIds]);

  const dedupedScopedFeed = useMemo(() => {
    const byKey = new Map<string, SocialLead>();

    for (const lead of scopedFeed) {
      const key = buildPulseLeadDedupKey(lead);
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
  }, [feedTimeBasis, ignoredLeadIds, scopedFeed]);

  const recentVisibleFeed = useMemo(() => {
    const recent = dedupedScopedFeed.filter((lead) => !revealedLeadIds.has(lead.id));
    return recent.sort((a, b) => {
      if (isHotlistFeed) return compareDetailsAndPostedDate(a, b);
      const aTs = new Date(!isHotlistFeed && a.matchedAt
        ? a.matchedAt
        : (feedTimeBasis === 'created' ? a.createdAt : a.postedAt)).getTime();
      const bTs = new Date(!isHotlistFeed && b.matchedAt
        ? b.matchedAt
        : (feedTimeBasis === 'created' ? b.createdAt : b.postedAt)).getTime();
      return bTs - aTs;
    });
  }, [dedupedScopedFeed, feedTimeBasis, isHotlistFeed, revealedLeadIds]);

  const revealedVisibleFeed = useMemo(() => {
    const revealed = dedupedScopedFeed.filter((lead) => revealedLeadIds.has(lead.id));
    return revealed.sort((a, b) => {
      if (isHotlistFeed) return compareDetailsAndPostedDate(a, b);
      const aTs = revealedAtByLeadId[a.id] ? new Date(revealedAtByLeadId[a.id]).getTime() : 0;
      const bTs = revealedAtByLeadId[b.id] ? new Date(revealedAtByLeadId[b.id]).getTime() : 0;
      if (aTs !== bTs) return bTs - aTs;
      return new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime();
    });
  }, [dedupedScopedFeed, revealedAtByLeadId, revealedLeadIds]);

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

  const predictedVisibleFeed = useMemo(() => {
    const scopedById = new Map(dedupedScopedFeed.map((lead) => [lead.id, lead]));
    return Object.keys(predictResultByLeadId)
      .map((leadId) => scopedById.get(leadId) ?? askedLeadsById[leadId])
      .filter((lead): lead is SocialLead => Boolean(lead))
      .sort((a, b) => {
        const aTs = predictedAtByLeadId[a.id] ? new Date(predictedAtByLeadId[a.id]).getTime() : 0;
        const bTs = predictedAtByLeadId[b.id] ? new Date(predictedAtByLeadId[b.id]).getTime() : 0;
        return bTs - aTs;
      });
  }, [askedLeadsById, dedupedScopedFeed, predictResultByLeadId, predictedAtByLeadId]);

  const allLoadedLeadsById = useMemo(() => {
    const map = new Map<string, SocialLead>();
    for (const lead of dedupedScopedFeed) map.set(lead.id, lead);
    for (const lead of Object.values(askedLeadsById)) map.set(lead.id, lead);
    return map;
  }, [askedLeadsById, dedupedScopedFeed]);

  const matchesTabCounts = useMemo(() => ({
    all: dedupedScopedFeed.length,
    breakdown: dedupedScopedFeed.filter((lead) => breakdownChargedLeadIds.has(lead.id)).length,
    revealed: revealedVisibleFeed.length,
    asked: askedVisibleFeed.length,
    verified: verifiedVisibleFeed.length,
    queued: recentVisibleFeed.length,
    predicted: predictedVisibleFeed.length,
  }), [askedVisibleFeed.length, breakdownChargedLeadIds, dedupedScopedFeed, predictedVisibleFeed.length, recentVisibleFeed.length, revealedVisibleFeed.length, verifiedVisibleFeed.length]);

  const matchesTabDefinitions = useMemo((): Array<{ id: MatchesTabId; label: string }> => (
    isHotlistFeed
      ? [
        { id: 'queued', label: 'Recent' },
        { id: 'predicted', label: 'Predicted' },
        { id: 'revealed', label: 'Revealed' },
        { id: 'asked', label: 'Asked' },
      ]
      : [
        { id: 'queued', label: 'Recent' },
        { id: 'predicted', label: 'Predicted' },
        { id: 'revealed', label: 'Revealed' },
        { id: 'asked', label: 'Submitted' },
      ]
  ), [isHotlistFeed]);

  const profileViewCounts = useMemo(() => ({
    all: filteredJobsRankedLeaderboard.length,
    watching: orderedJobsRankedLeaderboard.filter((item) => watchingRoles.has(normalize(item.target_role))).length,
  }), [filteredJobsRankedLeaderboard, orderedJobsRankedLeaderboard, watchingRoles]);

  const filteredFeed = useMemo(() => {
    let selectedFeed: SocialLead[];
    if (selectedMatchesTab === 'breakdown') {
      selectedFeed = dedupedScopedFeed.filter((lead) => breakdownChargedLeadIds.has(lead.id));
    } else if (selectedMatchesTab === 'revealed') {
      selectedFeed = revealedVisibleFeed;
    } else if (selectedMatchesTab === 'asked') {
      selectedFeed = askedVisibleFeed;
    } else if (selectedMatchesTab === 'verified') {
      selectedFeed = verifiedVisibleFeed;
    } else if (selectedMatchesTab === 'queued') {
      selectedFeed = recentVisibleFeed;
    } else if (selectedMatchesTab === 'predicted') {
      selectedFeed = predictedVisibleFeed;
    } else {
      selectedFeed = dedupedScopedFeed;
    }
    return [...selectedFeed].sort(compareDetailsAndPostedDate);
  }, [askedVisibleFeed, breakdownChargedLeadIds, dedupedScopedFeed, predictedVisibleFeed, recentVisibleFeed, revealedVisibleFeed, selectedMatchesTab, verifiedVisibleFeed]);

  const visibleFeed = useMemo(() => filteredFeed.slice(0, visibleMatchesCount), [filteredFeed, visibleMatchesCount]);
  const canLoadMoreMatches = visibleMatchesCount < filteredFeed.length;

  const visibleDesktopRecentFeed = useMemo(
    () => [...recentVisibleFeed].sort(compareDetailsAndPostedDate).slice(0, desktopRecentVisibleCount),
    [desktopRecentVisibleCount, recentVisibleFeed],
  );
  const visibleDesktopRevealedFeed = useMemo(
    () => [...revealedVisibleFeed].sort(compareDetailsAndPostedDate).slice(0, desktopRevealedVisibleCount),
    [desktopRevealedVisibleCount, revealedVisibleFeed],
  );
  const visibleDesktopAskedFeed = useMemo(
    () => [...askedVisibleFeed].sort(compareDetailsAndPostedDate).slice(0, desktopAskedVisibleCount),
    [askedVisibleFeed, desktopAskedVisibleCount],
  );
  const visibleDesktopVerifiedFeed = useMemo(
    () => [...verifiedVisibleFeed].sort(compareDetailsAndPostedDate).slice(0, desktopVerifiedVisibleCount),
    [desktopVerifiedVisibleCount, verifiedVisibleFeed],
  );
  const visibleDesktopPredictedFeed = useMemo(
    () => [...predictedVisibleFeed].sort(compareDetailsAndPostedDate).slice(0, desktopPredictedVisibleCount),
    [desktopPredictedVisibleCount, predictedVisibleFeed],
  );
  const canLoadMoreDesktopRecent = desktopRecentVisibleCount < recentVisibleFeed.length;
  const canLoadMoreDesktopRevealed = desktopRevealedVisibleCount < revealedVisibleFeed.length;
  const canLoadMoreDesktopAsked = desktopAskedVisibleCount < askedVisibleFeed.length;
  const canLoadMoreDesktopVerified = desktopVerifiedVisibleCount < verifiedVisibleFeed.length;
  const canLoadMoreDesktopPredicted = desktopPredictedVisibleCount < predictedVisibleFeed.length;

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

  const handleDesktopRevealedScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    maybeLoadMoreMatches(event.currentTarget, canLoadMoreDesktopRevealed, () => {
      setDesktopRevealedVisibleCount((prev) => Math.min(revealedVisibleFeed.length, prev + DESKTOP_MATCHES_PAGE_SIZE));
    });
  }, [canLoadMoreDesktopRevealed, maybeLoadMoreMatches, revealedVisibleFeed.length]);

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

  const handleDesktopPredictedScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    maybeLoadMoreMatches(event.currentTarget, canLoadMoreDesktopPredicted, () => {
      setDesktopPredictedVisibleCount((prev) => Math.min(predictedVisibleFeed.length, prev + DESKTOP_MATCHES_PAGE_SIZE));
    });
  }, [canLoadMoreDesktopPredicted, maybeLoadMoreMatches, predictedVisibleFeed.length]);

  useEffect(() => {
    if (isMobileViewport) return;
    const container = desktopMatchesScrollRef.current;
    if (!container) return;

    const hasOverflow = container.scrollHeight > container.clientHeight + 1;
    if (hasOverflow) return;

    if (selectedMatchesTab === 'revealed' && canLoadMoreDesktopRevealed) {
      setDesktopRevealedVisibleCount((prev) => Math.min(revealedVisibleFeed.length, prev + DESKTOP_MATCHES_PAGE_SIZE));
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
      return;
    }

    if (selectedMatchesTab === 'predicted' && canLoadMoreDesktopPredicted) {
      setDesktopPredictedVisibleCount((prev) => Math.min(predictedVisibleFeed.length, prev + DESKTOP_MATCHES_PAGE_SIZE));
    }
  }, [
    askedVisibleFeed.length,
    canLoadMoreDesktopAsked,
    canLoadMoreDesktopPredicted,
    canLoadMoreDesktopRecent,
    canLoadMoreDesktopRevealed,
    canLoadMoreDesktopVerified,
    isMobileViewport,
    isTableLayout,
    predictedVisibleFeed.length,
    recentVisibleFeed.length,
    revealedVisibleFeed.length,
    selectedMatchesTab,
    visibleDesktopRecentFeed.length,
    visibleDesktopRevealedFeed.length,
    visibleDesktopAskedFeed.length,
    visibleDesktopVerifiedFeed.length,
    visibleDesktopPredictedFeed.length,
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
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold ${badgeClass}`}
        title={`Market Pulse ${level} (${uniqueJobs} jobs)`}
        aria-label={`Market Pulse ${level}`}
      >
        <Activity size={10} />
        <span>{shortLevel}</span>
      </span>
    );
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

  const BUTTON_TONE_BY_BORDER: Record<string, string> = {
    'border-blue-100': 'bg-blue-100/35 hover:bg-blue-100/55',
    'border-violet-100': 'bg-violet-100/35 hover:bg-violet-100/55',
    'border-emerald-100': 'bg-emerald-100/35 hover:bg-emerald-100/55',
    'border-amber-100': 'bg-amber-100/35 hover:bg-amber-100/55',
    'border-rose-100': 'bg-rose-100/35 hover:bg-rose-100/55',
    'border-cyan-100': 'bg-cyan-100/35 hover:bg-cyan-100/55',
  };

  const isRoleLikeBreakdownKey = (key: string) => {
    const normalized = key.toLowerCase();
    return (
      normalized.includes('role') ||
      normalized.includes('title') ||
      normalized.includes('name_match')
    );
  };

  const getPulseBreakdownOrder = (key: string) => {
    const normalized = key.toLowerCase();
    if (normalized.includes('experience') || normalized.includes('exp')) return 0;
    if (normalized.includes('work_type') || normalized.includes('work type')) return 1;
    if (normalized.includes('employment_type') || normalized.includes('employment type')) return 2;
    if (normalized.includes('rate') || normalized.includes('hourly')) return 3;
    if (normalized.includes('visa')) return 4;
    if (normalized.includes('location')) return 5;
    if (normalized.includes('skill')) return 6;
    return 999;
  };

  const orderPulseBreakdownItems = <T extends { key: string }>(items: T[]) => {
    return [...items].sort((a, b) => {
      const orderDelta = getPulseBreakdownOrder(a.key) - getPulseBreakdownOrder(b.key);
      if (orderDelta !== 0) return orderDelta;
      return a.key.localeCompare(b.key);
    });
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

  const normalizeBreakdownDisplayValue = (value: string | null | undefined) => {
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
  };

  const normalizeHotlistWorkType = (value: string) => {
    const normalized = value.trim().toLowerCase().replace(/[-_]+/g, ' ');
    if (/\bhybrid\b/.test(normalized)) return 'Hybrid';
    if (/\bremote\b/.test(normalized)) return 'Remote';
    if (/\bon\s*site\b|\bonsite\b/.test(normalized)) return 'Onsite';
    return '-';
  };

  const renderMissingAwareValue = (value: string) => {
    if (value === '-') {
      return <PersonaMissingTag />;
    }
    return value;
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

  const getLeadBreakdownFieldValues = (lead: SocialLead) => {
    const inlineBreakdownItems = orderPulseBreakdownItems(buildScoreBreakdownDisplayItems(
      lead.scoreBreakdown as Record<string, number | { score: number; candidate_value: string; job_value: string; rule: string }> | undefined,
      undefined,
      {
        employment_type: lead.employmentType || null,
        work_type: null,
      },
    ).filter((item) => !isRoleLikeBreakdownKey(item.key)));
    const getBreakdownValue = (matchers: string[]) => {
      const found = inlineBreakdownItems.find((item) => {
        const key = item.key.toLowerCase();
        return matchers.some((matcher) => key.includes(matcher));
      });
      return normalizeBreakdownDisplayValue(found?.detail?.job_value);
    };
    const expValue = getBreakdownValue(['experience', 'exp']);
    const rawWorkTypeValue = getBreakdownValue(['work_type', 'work type']);
    const workTypeValue = isHotlistFeed ? normalizeHotlistWorkType(rawWorkTypeValue) : rawWorkTypeValue;
    const employmentTypeValue = getBreakdownValue(['employment_type', 'employment type']);
    const rateValue = getBreakdownValue(['rate', 'hourly']);
    const visaValue = getBreakdownValue(['visa']);
    const locationValue = getBreakdownValue(['location']);
    const skillsValue = getBreakdownValue(['skill']);
    return { inlineBreakdownItems, expValue, workTypeValue, employmentTypeValue, rateValue, visaValue, locationValue, skillsValue };
  };

  // Hotlist leads ARE the consultant, so the pasted text is the job to match against —
  // the opposite direction from the jobs feed (job_context=job, consultant_text=pasted candidate).
  // Swap the payload so the worker's fixed "JOB vs CONSULTANT" prompt still lines up correctly.
  const buildPredictMatchFields = (lead: SocialLead, pastedText: string) => {
    const { expValue, workTypeValue, employmentTypeValue, visaValue, locationValue, skillsValue } = getLeadBreakdownFieldValues(lead);
    if (!isHotlistFeed) {
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

  const predictToneClass = (score: number) => {
    if (score >= 80) return isDark ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100';
    if (score >= 60) return isDark ? 'border-blue-400/30 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100';
    if (score >= 40) return isDark ? 'border-amber-400/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20' : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100';
    return isDark ? 'border-red-400/30 bg-red-500/10 text-red-300 hover:bg-red-500/20' : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100';
  };

  const openPredictModal = (lead: SocialLead) => {
    setPredictLead(lead);
    setPredictInput('');
    setPredictResult(predictResultByLeadId[lead.id] ?? null);
    void loadRecentPredictTexts();
  };

  const closePredictModal = () => {
    if (predictSubmitting) return;
    setPredictLead(null);
    setPredictInput('');
    setPredictResult(null);
  };

  const handleRunAnotherPrediction = () => {
    setPredictInput('');
    setPredictResult(null);
  };

  const handleRetryPredict = (lead: SocialLead) => {
    setPredictLead(lead);
    setPredictInput('');
    setPredictResult(null);
    void loadRecentPredictTexts();
  };

  const handleCalculateMatch = async () => {
    if (!predictLead || !predictInput.trim() || predictSubmitting) return;
    setPredictSubmitting(true);
    const startedAt = Date.now();
    try {
      const consumed = await consumeCredits(PREDICT_COST, 'pulse_predict_match', {
        lead_id: predictLead.id,
        platform: predictLead.platform,
        title: predictLead.title,
      });
      if (!consumed) return;

      if (user?.id) {
        void supabase
          .from('job_search_history')
          .insert({
            user_id: user.id,
            account_id: account?.id ?? null,
            page: '/predict',
            search_query: predictInput.trim(),
          })
          .then(() => loadRecentPredictTexts());
      }

      const { consultantText, jobContext } = buildPredictMatchFields(predictLead, predictInput);
      const { data, error } = await supabase.functions.invoke('predict-match', {
        body: {
          lead_id: predictLead.id,
          platform: predictLead.platform,
          feed_kind: isHotlistFeed ? 'hotlist' : 'job',
          role_title: predictLead.title,
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

      const elapsed = Date.now() - startedAt;
      if (elapsed < PREDICT_MIN_PROCESSING_MS) await sleep(PREDICT_MIN_PROCESSING_MS - elapsed);

      const result = { score, categories, verdict, verdictClass: verdictClassForScore(score) };
      setPredictResult(result);
      setPredictResultByLeadId((prev) => ({ ...prev, [predictLead.id]: result }));
      setPredictedAtByLeadId((prev) => ({ ...prev, [predictLead.id]: new Date().toISOString() }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not calculate the match', 'error');
    } finally {
      setPredictSubmitting(false);
    }
  };

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
            feed_kind: isHotlistFeed ? 'hotlist' : 'job',
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
        setPredictedAtByLeadId((prev) => ({ ...prev, [lead.id]: new Date().toISOString() }));
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

  const renderLeadCards = (leads: SocialLead[], columns = 1) => leads.map((lead, idx) => {
    const safeColumns = Math.max(1, columns);
    const row = Math.floor(idx / safeColumns);
    const col = idx % safeColumns;
    // Spread palette by row/column so adjacent cards do not share a tone.
    const paletteIndex = (row + (col * 2)) % CARD_PALETTE.length;
    const cardPalette = CARD_PALETTE[paletteIndex];
    const cardBorderClass = cardPalette.border;
    const cardFillClass = cardPalette.fill;
    const accentColor = cardPalette.titleColor;
    const accentRgb = hexToRgbChannels(accentColor);
    const cardBorderColor = `rgb(${accentRgb} / 0.45)`;
    const titleToneStyle = { color: isDark ? '#FFFFFF' : '#2563EB' };
    const isLeadRevealed = revealedLeadIds.has(lead.id);
    const globalAskedJobState = globalAskedJobStateByLeadId[lead.id];
    const isAskPending = globalAskedJobState === 'asked';
    const isVerified = globalAskedJobState === 'verified';
    const canAskAI = !isAskPending && !isVerified && /^\S+@\S+\.\S+$/.test(lead.posterEmail.trim());
    const {
      inlineBreakdownItems,
      expValue,
      workTypeValue,
      employmentTypeValue,
      rateValue,
      visaValue,
      locationValue,
      skillsValue,
    } = getLeadBreakdownFieldValues(lead);
    const isInlineBreakdownExpanded = expandedInlineBreakdownLeadIds.has(lead.id);
    const experienceInlineItem = inlineBreakdownItems.find((item) => {
      const key = item.key.toLowerCase();
      return key.includes('experience') || key.includes('exp');
    });
    const workTypeInlineItem = inlineBreakdownItems.find((item) => {
      const key = item.key.toLowerCase();
      return key.includes('work_type') || key.includes('work type');
    });
    const employmentTypeInlineItem = inlineBreakdownItems.find((item) => {
      const key = item.key.toLowerCase();
      return key.includes('employment_type') || key.includes('employment type');
    });
    const collapsedInlineBreakdownItems = [experienceInlineItem, workTypeInlineItem, employmentTypeInlineItem]
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item, idx, arr) => arr.findIndex((other) => other.key === item.key) === idx);

    if (collapsedInlineBreakdownItems.length < 3) {
      for (const item of inlineBreakdownItems) {
        if (collapsedInlineBreakdownItems.some((existing) => existing.key === item.key)) continue;
        collapsedInlineBreakdownItems.push(item);
        if (collapsedInlineBreakdownItems.length >= 3) break;
      }
    }

    const useFourColumnBreakdown = true;

    const shouldForceExpandedBreakdown = isLeadRevealed && selectedMatchesTab !== 'revealed';
    const isExpandedBreakdownVisible = shouldForceExpandedBreakdown || isInlineBreakdownExpanded;
    const metaSurfaceClass = 'bg-transparent';
    const metaLabelClass = isDark ? 'text-[#64748B]' : 'text-slate-500';
    const metaValueClass = isDark ? 'text-[#CBD5E1]' : 'text-slate-700';
    const skillsValueClass = isDark ? 'text-[#CBD5E1]' : 'text-slate-700';
    const revealedTableSurfaceClass = isDark
      ? 'bg-[#272B31]/70 ring-white/10'
      : 'bg-transparent ring-slate-200';
    const revealedTableLabelClass = isDark ? 'text-[#64748B]' : 'text-slate-500';
    const revealedTableValueClass = isDark ? 'text-[#CBD5E1]' : 'text-slate-700';

    const costLabelClass = 'text-[8px] font-medium leading-none text-gray-400/80 dark:text-slate-600';
    const actionButtonsRail = (
      <div className="flex w-9 shrink-0 flex-col gap-1">
        {(() => {
          const cachedPredict = predictResultByLeadId[lead.id];
          return cachedPredict ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleRetryPredict(lead); }}
              title="Retry prediction"
              className="flex h-9 w-9 shrink-0 flex-col items-center justify-center gap-0.5 text-[11px] font-extrabold text-orange-600 transition-opacity hover:opacity-70 dark:text-orange-400"
            >
              {cachedPredict.score}
              <span className={costLabelClass}>{formatCentsCost(PREDICT_COST)}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openPredictModal(lead); }}
              title={isHotlistFeed ? 'Match' : 'Predict score'}
              className="flex h-9 w-9 shrink-0 flex-col items-center justify-center gap-0.5 text-gray-500 transition-opacity hover:opacity-70 dark:text-gray-400"
            >
              <Gauge size={16} strokeWidth={2} />
              <span className={costLabelClass}>{formatCentsCost(PREDICT_COST)}</span>
            </button>
          );
        })()}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); isLeadRevealed ? void copyText(lead.posterEmail, isHotlistFeed ? 'Bench Sales Recruiter email' : 'Vendor email') : void handleRevealContact(lead); }}
          disabled={processingLeadId === lead.id}
          title={isLeadRevealed ? 'Copy email' : 'Reveal email'}
          className={`flex h-9 w-9 shrink-0 flex-col items-center justify-center gap-0.5 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 ${isLeadRevealed ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}
        >
          {processingLeadId === lead.id ? '...' : isLeadRevealed ? <Copy size={15} strokeWidth={2} /> : <AtSign size={16} strokeWidth={2} />}
          {!isLeadRevealed && <span className={costLabelClass}>{formatCentsCost(REVEAL_CONTACT_COST)}</span>}
        </button>
        {isAskPending || isVerified ? (
          <span
            title={isVerified ? 'Verified' : (isHotlistFeed ? 'Asked' : 'Submitted')}
            className="flex h-9 w-9 shrink-0 flex-col items-center justify-center gap-0.5 text-blue-600 dark:text-blue-400"
          >
            {isVerified ? <BadgeCheck size={16} strokeWidth={2} /> : <Check size={16} strokeWidth={2} />}
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void handleAskAI(lead); }}
            disabled={!canAskAI || processingAskAILeadId === lead.id}
            title={!lead.posterEmail ? 'No email' : isHotlistFeed ? 'Ask for resume' : 'Submit candidate'}
            className="flex h-9 w-9 shrink-0 flex-col items-center justify-center gap-0.5 text-gray-500 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400"
          >
            {processingAskAILeadId === lead.id ? '...' : isHotlistFeed ? <FileText size={16} strokeWidth={2} /> : <Mail size={16} strokeWidth={2} />}
            <span className={costLabelClass}>{formatCentsCost(isHotlistFeed ? ASK_RESUME_COST_DISPLAY : SUBMIT_COST_DISPLAY)}</span>
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void handlePreviewPost(lead); }}
          disabled={loadingPostContentLeadId === lead.id}
          title="Preview original post"
          className={`flex h-9 w-9 shrink-0 flex-col items-center justify-center gap-0.5 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 ${postContentViewedLeadIds.has(lead.id) ? 'text-cyan-600 dark:text-cyan-400' : 'text-gray-500 dark:text-gray-400'}`}
        >
          {loadingPostContentLeadId === lead.id ? '...' : <Eye size={16} strokeWidth={2} />}
          {!postContentViewedLeadIds.has(lead.id) && <span className={costLabelClass}>{formatCentsCost(POST_CONTENT_COST)}</span>}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); void handleIgnoreLead(lead); }}
          disabled={processingIgnoreLeadId === lead.id}
          title={isAdminUser ? 'Hide from platform (spam)' : 'Ignore — remove from my feed'}
          className="flex h-9 w-9 shrink-0 flex-col items-center justify-center gap-0.5 text-gray-500 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400"
        >
          {processingIgnoreLeadId === lead.id ? '...' : <X size={16} strokeWidth={2.5} />}
        </button>
      </div>
    );
    return (
      <div key={lead.id} className="mb-1.5 flex items-start gap-0.5 break-inside-avoid">
      <div className={`relative min-w-0 flex-1 rounded-lg border px-3 py-2.5 ${cardFillClass}`} style={{ borderColor: cardBorderColor }}>
        <div>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold leading-snug" style={titleToneStyle}>{lead.title || (isHotlistFeed ? 'Available Consultant' : 'Job Opportunity')}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] text-[#94A3B8]">
              <span>{feedTimeBasis === 'created' ? 'Added' : 'Posted'} {formatAgo(feedTimeBasis === 'created' ? lead.createdAt : lead.postedAt)}</span>
              <span>•</span>
              <span>{isLeadRevealed ? `Posted by ${lead.posterName}` : maskPosterName(lead.posterName)}</span>
              {(lead.company || lead.platform) && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  <span>•</span>
                  {lead.company && (
                    <>
                      <Building2 size={10} className="shrink-0" style={{ color: accentColor }} />
                      <span className="text-[#94A3B8]">{isLeadRevealed ? lead.company : `${lead.company.slice(0, 3)}***`}</span>
                    </>
                  )}
                  {lead.company && lead.platform && <span>•</span>}
                  {lead.platform && <span className="font-bold uppercase text-[#64748B]">{lead.platform}</span>}
                </span>
              )}
            </div>
            {(predictResultByLeadId[lead.id] || isAskPending || isVerified || isLeadRevealed) && (
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {predictResultByLeadId[lead.id] && (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${predictToneClass(predictResultByLeadId[lead.id].score)}`}>
                    <Gauge size={9} strokeWidth={2.5} />
                    {isHotlistFeed ? 'Match' : 'Predicted'} {predictResultByLeadId[lead.id].score}%
                  </span>
                )}
                {(isAskPending || isVerified) && (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${isVerified ? (isDark ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700') : (isDark ? 'border-blue-400/30 bg-blue-500/10 text-blue-300' : 'border-blue-200 bg-blue-50 text-blue-700')}`}>
                    {isVerified ? <BadgeCheck size={9} strokeWidth={2.5} /> : <Check size={9} strokeWidth={2.5} />}
                    {(() => {
                      const stampIso = isVerified ? (askedJobStateByLeadId[lead.id]?.fulfilledAt ?? askedJobStateByLeadId[lead.id]?.requestedAt) : askedJobStateByLeadId[lead.id]?.requestedAt;
                      const label = isVerified ? 'Verified' : (isHotlistFeed ? 'Asked' : 'Submitted');
                      return stampIso ? `${label} ${formatAgoCompact(stampIso)}` : label;
                    })()}
                  </span>
                )}
                {isLeadRevealed && (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${isDark ? 'border-white/15 bg-white/5 text-slate-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                    <AtSign size={9} strokeWidth={2.5} />
                    Revealed{revealedAtByLeadId[lead.id] ? ` ${formatAgoCompact(revealedAtByLeadId[lead.id])}` : ''}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        {inlineBreakdownItems.length > 0 && (
          useFourColumnBreakdown ? (
                <div className={`mt-1.5 min-w-0 rounded-md px-2.5 py-2 text-left ${metaSurfaceClass}`}>
                  <div className="grid grid-cols-3 gap-x-3 gap-y-2">
                    <div className="min-w-0">
                      <div className={`text-[9px] uppercase tracking-wide ${metaLabelClass}`}>Exp</div>
                      <div className={`text-[9px] leading-tight break-words ${metaValueClass}`}>{renderClampedField(lead.id, 'exp', expValue, isDark ? 'text-blue-300' : 'text-blue-600')}</div>
                    </div>
                    <div className="min-w-0">
                      <div className={`text-[9px] uppercase tracking-wide ${metaLabelClass}`}>Work Type</div>
                      <div className={`text-[9px] leading-tight break-words ${metaValueClass}`}>{renderClampedField(lead.id, 'workType', workTypeValue, isDark ? 'text-blue-300' : 'text-blue-600')}</div>
                    </div>
                    <div className="min-w-0">
                      <div className={`text-[9px] uppercase tracking-wide ${metaLabelClass}`}>Emp Type</div>
                      <div className={`text-[9px] leading-tight break-words ${metaValueClass}`}>{renderClampedField(lead.id, 'empType', employmentTypeValue, isDark ? 'text-blue-300' : 'text-blue-600')}</div>
                    </div>
                    <div className="min-w-0">
                      <div className={`text-[9px] uppercase tracking-wide ${metaLabelClass}`}>Rate</div>
                      <div className={`text-[9px] leading-tight break-words ${metaValueClass}`}>{renderClampedField(lead.id, 'rate', rateValue, isDark ? 'text-blue-300' : 'text-blue-600')}</div>
                    </div>
                    <div className="min-w-0">
                      <div className={`text-[9px] uppercase tracking-wide ${metaLabelClass}`}>Visa</div>
                      <div className={`text-[9px] leading-tight break-words ${metaValueClass}`}>{renderClampedField(lead.id, 'visa', visaValue, isDark ? 'text-blue-300' : 'text-blue-600')}</div>
                    </div>
                    <div className="min-w-0">
                      <div className={`text-[9px] uppercase tracking-wide ${metaLabelClass}`}>Location</div>
                      <div className={`text-[9px] leading-tight break-words ${metaValueClass}`}>{renderClampedField(lead.id, 'location', locationValue, isDark ? 'text-blue-300' : 'text-blue-600')}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedInlineBreakdownLeadIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(lead.id)) next.delete(lead.id);
                        else next.add(lead.id);
                        return next;
                      });
                    }}
                    className={`mt-2 w-full rounded-md py-1.5 text-left focus:outline-none ${metaSurfaceClass}`}
                  >
                    <div className={`text-[9px] uppercase tracking-wide ${metaLabelClass}`}>Skills</div>
                    <div className={`text-[9px] leading-tight break-words ${skillsValueClass}`}>
                      {renderClampedSkills(lead.id, skillsValue, 8, isDark ? 'text-blue-300' : 'text-blue-600')}
                    </div>
                  </button>
                </div>
          ) : (
          (isLeadRevealed && selectedMatchesTab !== 'revealed') ? (
            <div className={`mt-1.5 w-full overflow-hidden rounded-md text-left ring-1 ring-inset ${revealedTableSurfaceClass}`}>
              <table className="w-full table-fixed border-collapse text-left text-[10px]">
                <tbody>
                  {inlineBreakdownItems.map((item) => (
                    <tr key={item.key}>
                      <td className={`bg-transparent px-2 py-1 break-words whitespace-normal ${revealedTableLabelClass}`}>{formatBreakdownFieldName(item.key)}</td>
                      <td className={`bg-transparent px-2 py-1 break-words whitespace-normal ${revealedTableValueClass}`}>{renderMissingAwareValue(normalizeBreakdownDisplayValue(item.detail?.job_value))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setExpandedInlineBreakdownLeadIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(lead.id)) next.delete(lead.id);
                  else next.add(lead.id);
                  return next;
                });
              }}
              className={`mt-1.5 w-full overflow-hidden rounded-md border ${cardBorderClass} text-left relative group focus:outline-none`}
            >
              <table className="w-full table-fixed border-collapse text-left text-[10px]">
                <tbody>
                  {(isExpandedBreakdownVisible ? inlineBreakdownItems : collapsedInlineBreakdownItems).map((item, idx) => (
                    <tr key={item.key}>
                      <td className={`px-2 py-1 break-words whitespace-normal transition-all duration-200 ${!isExpandedBreakdownVisible && idx >= 2 ? 'blur-sm select-none text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>{formatBreakdownFieldName(item.key)}</td>
                      <td className={`px-2 py-1 break-words whitespace-normal transition-all duration-200 ${!isExpandedBreakdownVisible && idx >= 2 ? 'blur-sm select-none text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>{renderMissingAwareValue(normalizeBreakdownDisplayValue(item.detail?.job_value))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!isExpandedBreakdownVisible && (
                <div className="absolute bottom-0 left-0 right-0 h-7 flex items-center justify-center pointer-events-none">
                  <ChevronDown size={12} className="text-blue-500" />
                </div>
              )}
            </button>
          )
        ))}
      </div>
      {actionButtonsRail}
      </div>
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
    const askButtonClass = 'inline-flex h-7 w-full items-center justify-center gap-1 text-[10px] font-semibold leading-none text-gray-500 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400';
    const predictButtonClass = 'inline-flex h-7 w-full items-center justify-center gap-1 text-[10px] font-semibold leading-none text-gray-500 transition-opacity hover:opacity-70 dark:text-gray-400';
    const predictButtonUsedClass = 'inline-flex h-7 w-full items-center justify-center gap-1 text-[10px] font-semibold leading-none text-orange-600 transition-opacity hover:opacity-70 dark:text-orange-400';
    const emailButtonClass = 'inline-flex h-7 w-full items-center justify-center gap-1 text-[10px] font-semibold leading-none text-gray-500 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400';
    const emailButtonUsedClass = 'inline-flex h-7 w-full items-center justify-center gap-1 text-[10px] font-semibold leading-none text-blue-600 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-blue-400';
    const submitStatusClass = 'inline-flex h-7 w-full items-center justify-center gap-1 text-[10px] font-semibold leading-none text-blue-600 dark:text-blue-400';
    const previewButtonUsedClass = 'inline-flex h-7 w-full items-center justify-center gap-1 text-[10px] font-semibold leading-none text-cyan-600 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-cyan-400';
    const postedLabel = feedTimeBasis === 'created' ? 'Added' : 'Posted';

    const rows = leads.map((lead) => {
      const globalAskedJobState = globalAskedJobStateByLeadId[lead.id];
      const isAskPending = globalAskedJobState === 'asked';
      const isVerified = globalAskedJobState === 'verified';
      const canAskAI = !isAskPending && !isVerified && /^\S+@\S+\.\S+$/.test(lead.posterEmail.trim());
      const { expValue, workTypeValue, employmentTypeValue, rateValue, visaValue, locationValue, skillsValue } = getLeadBreakdownFieldValues(lead);
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
        lead, isAskPending, isVerified, canAskAI,
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
          <div className={`sticky top-0 z-[3] mb-1.5 flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-[11px] font-semibold ${isDark ? 'border-orange-400/30 bg-[#1B1D21]' : 'border-orange-200 bg-orange-50'}`}>
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
                {isHotlistFeed ? 'Match Selected' : 'Predict Selected'}
              </button>
            </div>
          </div>
        )}
        <table className="w-full table-fixed border-collapse border-spacing-0 text-left text-[11px]">
        <colgroup>
          <col style={{ width: '3%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '5%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '5%' }} />
          <col style={{ width: '6%' }} />
        </colgroup>
        <thead className={`sticky top-0 z-[2] ${tableHeadSurfaceClass}`}>
          <tr className={`border-b ${tableBorderClass} text-[10px] uppercase tracking-wide ${tableMutedClass}`}>
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
            <th className="px-2 py-2 whitespace-normal">{isHotlistFeed ? 'Match' : 'Predict'}</th>
            <th className="px-2 py-2 whitespace-normal">{isHotlistFeed ? 'Reveal' : 'Email'}</th>
            <th className="px-2 py-2 whitespace-normal">{isHotlistFeed ? 'Ask Resume' : 'Submit'}</th>
            <th className="px-2 py-2 whitespace-normal">Post</th>
            <th className="px-2 py-2 whitespace-normal" aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {rows.map(({ lead, isAskPending, isVerified, canAskAI, expValue, workTypeValue, employmentTypeValue, rateValue, visaValue, locationValue, skillsValue }) => {
            const isLeadRevealed = revealedLeadIds.has(lead.id);
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
                  {renderClampedField(lead.id, 'role', lead.title || (isHotlistFeed ? 'Available Consultant' : 'Job Opportunity'), linkClass)}
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
                  {(() => {
                    const cachedPredict = predictResultByLeadId[lead.id];
                    return cachedPredict ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleRetryPredict(lead); }}
                        title={`${isHotlistFeed ? 'Match' : 'Predicted'} ${cachedPredict.score}% — click to retry`}
                        className={predictButtonUsedClass}
                      >
                        <span className="font-extrabold">{cachedPredict.score}%</span>
                        <RotateCcw size={11} strokeWidth={2.5} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openPredictModal(lead); }}
                        className={predictButtonClass}
                      >
                        <Gauge size={12} strokeWidth={2} />
                        <span>{isHotlistFeed ? 'Match' : 'Predict'}</span>
                      </button>
                    );
                  })()}
                </td>
                <td className="px-1.5 py-2 align-top">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); isLeadRevealed ? void copyText(lead.posterEmail, isHotlistFeed ? 'Bench Sales Recruiter email' : 'Vendor email') : void handleRevealContact(lead); }}
                    disabled={processingLeadId === lead.id}
                    title={isLeadRevealed ? 'Copy email' : 'Reveal email'}
                    className={isLeadRevealed ? emailButtonUsedClass : emailButtonClass}
                  >
                    {processingLeadId === lead.id ? (
                      <span>...</span>
                    ) : isLeadRevealed ? (
                      <>
                        <Copy size={11} strokeWidth={2} />
                        <span>Copy</span>
                      </>
                    ) : (
                      <>
                        <AtSign size={12} strokeWidth={2} />
                        <span>{isHotlistFeed ? 'Reveal' : 'Email'}</span>
                      </>
                    )}
                  </button>
                </td>
                <td className="px-1.5 py-2 align-top">
                  {isAskPending || isVerified ? (
                    <span
                      title={isVerified ? 'Verified' : (isHotlistFeed ? 'Resume already requested' : 'Submission already sent')}
                      className={submitStatusClass}
                    >
                      {isVerified ? <BadgeCheck size={12} strokeWidth={2} className="shrink-0" /> : <Check size={12} strokeWidth={2} className="shrink-0" />}
                      <span className="truncate">
                        {(() => {
                          const stampIso = isVerified ? (askedJobStateByLeadId[lead.id]?.fulfilledAt ?? askedJobStateByLeadId[lead.id]?.requestedAt) : askedJobStateByLeadId[lead.id]?.requestedAt;
                          const label = isVerified ? 'Verified' : (isHotlistFeed ? 'Asked' : 'Submitted');
                          return stampIso ? `${label} ${formatAgoCompact(stampIso)}` : label;
                        })()}
                      </span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void handleAskAI(lead); }}
                      disabled={!canAskAI || processingAskAILeadId === lead.id}
                      title={!lead.posterEmail ? 'No email' : isHotlistFeed ? "Ask for the consultant's resume" : 'Submit a candidate for this role'}
                      className={`${askButtonClass} truncate`}
                    >
                      <Mail size={12} strokeWidth={2} className="shrink-0" />
                      <span className="truncate">{processingAskAILeadId === lead.id ? '...' : (isHotlistFeed ? 'Ask Resume' : 'Submit')}</span>
                    </button>
                  )}
                </td>
                <td className="px-1.5 py-2 align-top">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void handlePreviewPost(lead); }}
                    disabled={loadingPostContentLeadId === lead.id}
                    title="Preview original post"
                    className={postContentViewedLeadIds.has(lead.id) ? previewButtonUsedClass : predictButtonClass}
                  >
                    <Eye size={12} strokeWidth={2} />
                    <span>{loadingPostContentLeadId === lead.id ? '...' : 'Preview'}</span>
                  </button>
                </td>
                <td className="px-1.5 py-2 align-top">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void handleIgnoreLead(lead); }}
                    disabled={processingIgnoreLeadId === lead.id}
                    title={isAdminUser ? 'Hide from platform (spam)' : 'Ignore — remove from my feed'}
                    className="inline-flex h-7 w-full items-center justify-center text-gray-500 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400"
                  >
                    {processingIgnoreLeadId === lead.id ? <span className="text-[10px]">...</span> : <X size={14} strokeWidth={2.5} />}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </>
    );
  };

  useEffect(() => {
    try { localStorage.setItem(PULSE_LAYOUT_MODE_STORAGE_KEY, layoutMode); } catch {}
  }, [layoutMode]);

  useEffect(() => {
    if (!predictSubmitting) {
      setPredictProcessingStep(0);
      return;
    }
    const interval = setInterval(() => {
      setPredictProcessingStep((step) => (step < PREDICT_PROCESSING_LABELS.length - 1 ? step + 1 : step));
    }, 320);
    return () => clearInterval(interval);
  }, [predictSubmitting]);

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
    for (const row of (data ?? []) as PulseLeadActionRow[]) {
      if (row.action_type === 'revealed') {
        revealed.add(row.lead_id);
        if (row.created_at) revealedAt[row.lead_id] = row.created_at;
      }
      if (row.action_type === 'breakdown') breakdown.add(row.lead_id);
      if (row.action_type === 'post_content_viewed') postContentViewed.add(row.lead_id);
      if (row.action_type === 'ignored') ignored.add(row.lead_id);
    }

    setRevealedLeadIds(revealed);
    setBreakdownChargedLeadIds(breakdown);
    setPostContentViewedLeadIds(postContentViewed);
    setIgnoredLeadIds(ignored);
    setRevealedAtByLeadId(revealedAt);
  }, [user?.id]);

  const loadAskedJobState = useCallback(async () => {
    if (isHotlistFeed) {
      if (!account?.id || !user?.id) {
        setAskedJobStateByLeadId({});
        setGlobalAskedJobStateByLeadId({});
        setAskedLeadsById({});
        return;
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

      if (ownHotlistRequestsResult.error) return;

      const nextState: Record<string, AskedJobState> = {};
      for (const row of (ownHotlistRequestsResult.data ?? []) as Array<{ hotlist_id: string; created_at: string; fulfilled_at: string | null }>) {
        if (!nextState[row.hotlist_id]) {
          nextState[row.hotlist_id] = { requestedAt: row.created_at, fulfilledAt: row.fulfilled_at };
        }
      }
      setAskedJobStateByLeadId(nextState);

      const nextHotlistGlobalState: Record<string, GlobalAskedJobState> = {};
      if (!hotlistStatesResult.error) {
        for (const row of (hotlistStatesResult.data ?? []) as Array<{ hotlist_id: string; state: GlobalAskedJobState }>) {
          if (row.state === 'asked' || row.state === 'verified') nextHotlistGlobalState[row.hotlist_id] = row.state;
        }
      }
      setGlobalAskedJobStateByLeadId(nextHotlistGlobalState);

      const hotlistIds = Array.from(new Set([...Object.keys(nextState), ...Object.keys(nextHotlistGlobalState)]));
      if (hotlistIds.length === 0) {
        setAskedLeadsById({});
        return;
      }

      const { data: hotlistRows, error: hotlistRowsError } = await supabase
        .from('social_hotlist')
        .select('id, platform, bench_sales_recruiter_name, bench_sales_recruiter_email, bench_sales_recruiter_phone, bench_sales_company_name, role_title, core_skills, years_experience, visa_type, employment_type, locations, hourly_rate_min, hourly_rate_max, raw_post_content, posted_at, created_at')
        .in('id', hotlistIds);
      if (hotlistRowsError) return;

      const nextHotlistLeads: Record<string, SocialLead> = {};
      for (const row of (hotlistRows ?? []) as Array<{
        id: string; platform: string; bench_sales_recruiter_name: string | null; bench_sales_recruiter_email: string | null;
        bench_sales_recruiter_phone: string | null; bench_sales_company_name: string | null; role_title: string | null;
        core_skills: string[] | null; years_experience: number | null; visa_type: string | null; employment_type: string | null;
        locations: string[] | null; hourly_rate_min: number | null; hourly_rate_max: number | null; raw_post_content: string | null;
        posted_at: string | null; created_at: string;
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
          experienceYears: row.years_experience ?? null,
          visaTypes: row.visa_type ? [row.visa_type] : [],
          hourlyRate: (row.hourly_rate_min != null || row.hourly_rate_max != null)
            ? `$${row.hourly_rate_min ?? '?'}–$${row.hourly_rate_max ?? '?'}/hr`
            : '',
        };
      }
      setAskedLeadsById(nextHotlistLeads);
      return;
    }
    if (!account?.id || !user?.id) {
      setAskedJobStateByLeadId({});
      setGlobalAskedJobStateByLeadId({});
      setAskedLeadsById({});
      return;
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

    if (ownRequestsResult.error) return;

    const nextState: Record<string, AskedJobState> = {};
    for (const row of (ownRequestsResult.data ?? []) as Array<{ job_id: string; created_at: string; fulfilled_at: string | null }>) {
      if (!nextState[row.job_id]) {
        nextState[row.job_id] = { requestedAt: row.created_at, fulfilledAt: row.fulfilled_at };
      }
    }
    setAskedJobStateByLeadId(nextState);

    const nextGlobalState: Record<string, GlobalAskedJobState> = {};
    if (!globalStatesResult.error) {
      for (const row of (globalStatesResult.data ?? []) as Array<{ job_id: string; state: GlobalAskedJobState }>) {
        if (row.state === 'asked' || row.state === 'verified') nextGlobalState[row.job_id] = row.state;
      }
    }
    setGlobalAskedJobStateByLeadId(nextGlobalState);

    const jobIds = Array.from(new Set([...Object.keys(nextState), ...Object.keys(nextGlobalState)]));
    if (jobIds.length === 0) {
      setAskedLeadsById({});
      return;
    }

    const { data: jobRows, error: jobsError } = await supabase
      .from('social_jobs')
      .select('id, platform, posted_by_name, poster_email, poster_phone, created_at, posted_at, job_title, company_name, location, post_content, extracted_role_normalized, employment_type, seniority_level, salary_range, extracted_skills, extracted_experience_years, extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max')
      .in('id', jobIds);
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
        experienceYears: row.extracted_experience_years ?? null,
        visaTypes: Array.isArray(row.extracted_visa_types) ? row.extracted_visa_types : [],
        hourlyRate: (row.extracted_hourly_rate_min != null || row.extracted_hourly_rate_max != null)
          ? `$${row.extracted_hourly_rate_min ?? '?'}–$${row.extracted_hourly_rate_max ?? '?'}/hr`
          : '',
      };
    }
    setAskedLeadsById(nextLeads);
  }, [account?.id, isHotlistFeed, user?.id]);

  const loadPredictedJobState = useCallback(async () => {
    if (!account?.id || !user?.id) {
      setPredictResultByLeadId({});
      setPredictedAtByLeadId({});
      return;
    }

    const { data, error } = await supabase
      .from('pulse_predict_logs' as never)
      .select('lead_id, score, verdict, categories, created_at')
      .eq('account_id', account.id)
      .eq('user_id', user.id)
      .eq('feed_kind', isHotlistFeed ? 'hotlist' : 'job')
      .order('created_at', { ascending: false });
    if (error) return;

    const nextResults: Record<string, PredictResult> = {};
    const nextAt: Record<string, string> = {};
    for (const row of (data ?? []) as Array<{ lead_id: string; score: number | null; verdict: string | null; categories: PredictCategory[] | null; created_at: string }>) {
      if (!row.lead_id || nextResults[row.lead_id]) continue;
      const score = Math.max(0, Math.min(100, Math.round(Number(row.score) || 0)));
      nextResults[row.lead_id] = {
        score,
        categories: Array.isArray(row.categories) ? row.categories : [],
        verdict: row.verdict?.trim() || 'Submission likely to be accepted',
        verdictClass: verdictClassForScore(score),
      };
      nextAt[row.lead_id] = row.created_at;
    }
    setPredictResultByLeadId(nextResults);
    setPredictedAtByLeadId(nextAt);

    const leadIds = Object.keys(nextResults);
    if (leadIds.length === 0) return;
    if (isHotlistFeed) return;

    const { data: jobRows, error: jobsError } = await supabase
      .from('social_jobs')
      .select('id, platform, posted_by_name, poster_email, poster_phone, created_at, posted_at, job_title, company_name, location, post_content, extracted_role_normalized, employment_type, seniority_level, salary_range, extracted_skills, extracted_experience_years, extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max')
      .in('id', leadIds);
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
        experienceYears: row.extracted_experience_years ?? null,
        visaTypes: Array.isArray(row.extracted_visa_types) ? row.extracted_visa_types : [],
        hourlyRate: (row.extracted_hourly_rate_min != null || row.extracted_hourly_rate_max != null)
          ? `$${row.extracted_hourly_rate_min ?? '?'}–$${row.extracted_hourly_rate_max ?? '?'}/hr`
          : '',
      };
    }
    setAskedLeadsById((prev) => ({ ...prev, ...nextLeads }));
  }, [account?.id, isHotlistFeed, user?.id]);

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
        isHotlistFeed ? 'get_social_hotlist_feed_page' : 'get_pulse_social_feed',
        isHotlistFeed
          ? { p_since: '1970-01-01T00:00:00.000Z', p_before_posted_at: null, p_before_lead_id: null, p_limit: 1 }
          : { p_since: '1970-01-01T00:00:00.000Z', p_limit: 1 } as never,
      );
      const latest = (latestRows?.[0] as PulseSocialFeedRpcRow | undefined)?.match_created_at;
      if (latest) setLastMatchAt(latest);
    } catch {
      // Leave lastMatchAt unchanged on failure.
    }

    setLoading(false);
  }, [isHotlistFeed, loadAskedJobState, loadLeaderboard, loadWatchingRoles, loadLeadActionState, loadPredictedJobState]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadGlobalPulseRowsFromCacheWorker = useCallback(async (rangeHours: number) => {
    if (isHotlistFeed) return null;
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
  }, [isHotlistFeed]);

  const loadGlobalPulseRows = useCallback(async (rangeHours: number) => {
    const useCreatedTime = canSelectFeedTimeBasis && feedTimeBasis === 'created';
    const workerRows = useCreatedTime ? null : await loadGlobalPulseRowsFromCacheWorker(rangeHours);
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
        .select('id, platform, posted_by_name, poster_email, poster_phone, created_at, posted_at, job_title, company_name, location, post_content, extracted_role_normalized, employment_type, seniority_level, salary_range, extracted_skills, extracted_experience_years, extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max')
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
      } as PulseSocialFeedRpcRow;
    });
  }, [canSelectFeedTimeBasis, feedTimeBasis, isHotlistFeed, loadGlobalPulseRowsFromCacheWorker]);

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

    const request = loadGlobalPulseRows(rangeHours)
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
  }, [feedTimeBasis, loadGlobalPulseRows]);

  const loadProfileStats = useCallback(async (rowsOverride?: PulseSocialFeedRpcRow[]) => {
    if (sortedLeaderboard.length === 0) {
      setProfileStatsByRole({});
      return;
    }

    setProfileStatsLoading(true);
    let rpcRows: PulseSocialFeedRpcRow[] = [];
    try {
      rpcRows = rowsOverride ?? await getGlobalPulseRows(selectedProfileRange.hours);
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

    for (const persona of sortedLeaderboard) {
      const roleKey = normalize(persona.target_role);
      const skills = getPersonaSkillList(persona.target_role, persona.priority_skills);
      const companies = new Set<string>();
      const vendors = new Set<string>();
      const jobs = new Set<string>();
      let matchScoreSum = 0;
      let matchScoreCount = 0;

      for (const row of rows) {
        if (!roleMatchesPersona(row as SocialJobRow, persona.target_role, skills)) continue;

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
  ) => {
    setFeedLoading(true);
    let rpcRows: PulseSocialFeedRpcRow[] = [];
    try {
      rpcRows = rowsOverride ?? await getGlobalPulseRows(selectedProfileRange.hours);
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

    const rangeCutoffMs = nowMs - (selectedProfileRange.hours * 60 * 60 * 1000);
    const finalFiltered = socialData
      .filter((row) => {
        const postedTs = getPostedTimestamp(row);
        return newestMatchByJobId.has(row.id)
          && (row.poster_email ?? '').trim()
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
        return {
          id: row.id,
          title: row.job_title?.trim() || row.extracted_role_normalized?.trim() || row.post_content?.trim().split('\n')[0]?.slice(0, 80) || (isHotlistFeed ? 'Available Consultant' : 'Untitled Job'),
          roleTitle: (row as SocialJobRow & Record<string, unknown>).role_title?.trim() || row.job_title?.trim() || row.extracted_role_normalized?.trim() || '',
          location: row.location?.trim() || 'Location not specified',
          company: row.company_name?.trim() || '',
          posterName: row.posted_by_name?.trim() || (isHotlistFeed ? 'Bench Sales Recruiter' : 'Vendor contact'),
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
          experienceYears: (row as SocialJobRow & Record<string, unknown>).years_experience ?? row.extracted_experience_years ?? null,
          visaTypes: Array.isArray((row as SocialJobRow & Record<string, unknown>).visa_types)
            ? ((row as SocialJobRow & Record<string, unknown>).visa_types as string[])
            : (Array.isArray(row.extracted_visa_types) ? row.extracted_visa_types : []),
          hourlyRate: ((row as SocialJobRow & Record<string, unknown>).hourly_rate_min != null || (row as SocialJobRow & Record<string, unknown>).hourly_rate_max != null)
            ? `$${(row as SocialJobRow & Record<string, unknown>).hourly_rate_min ?? (row.extracted_hourly_rate_min ?? '?')}–$${(row as SocialJobRow & Record<string, unknown>).hourly_rate_max ?? (row.extracted_hourly_rate_max ?? '?')}/hr`
            : ((row.extracted_hourly_rate_min || row.extracted_hourly_rate_max)
              ? `$${row.extracted_hourly_rate_min ?? '?'}–$${row.extracted_hourly_rate_max ?? '?'}/hr`
              : ''),
          consultantCount: hotlistSource && Number.isInteger(Number(hotlistSource.consultant_count))
            ? Number(hotlistSource.consultant_count)
            : undefined,
          candidateIndex: hotlistSource && Number.isInteger(Number(hotlistSource.candidate_index))
            ? Number(hotlistSource.candidate_index)
            : undefined,
        } as SocialLead;
      });

    setFeed(finalFiltered);
    setVisibleMatchesCount(MATCHES_PAGE_SIZE);
    setDesktopRecentVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
    setDesktopRevealedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
    setDesktopAskedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
    setDesktopVerifiedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);

    if (finalFiltered.length > 0) {
      const leadIds = finalFiltered.map((l) => l.id);
      const { data: revealRows } = await supabase.rpc('get_pulse_reveal_counts', {
        p_lead_ids: leadIds,
      });
      if (Array.isArray(revealRows)) {
        const counts: Record<string, number> = {};
        for (const row of revealRows as Array<{ lead_id: string; reveal_count: number | string | null }>) {
          const nextCount = Number(row.reveal_count ?? 0);
          counts[row.lead_id] = Number.isFinite(nextCount) ? nextCount : 0;
        }
        setRevealCountsByLeadId(counts);
      }

      const { data: revealNameRows } = await supabase.rpc('get_pulse_reveal_names', {
        p_lead_ids: leadIds,
      });
      if (Array.isArray(revealNameRows)) {
        const namesByLead: Record<string, string[]> = {};
        for (const row of revealNameRows as PulseRevealNamesRow[]) {
          const names = Array.isArray(row.revealer_names)
            ? row.revealer_names.filter((name) => typeof name === 'string' && name.trim().length > 0)
            : [];
          namesByLead[row.lead_id] = names;
        }
        setRevealNamesByLeadId(namesByLead);
      }
    } else {
      setRevealCountsByLeadId({});
      setRevealNamesByLeadId({});
    }

    setFeedLoading(false);
  }, [feedTimeBasis, getGlobalPulseRows, isHotlistFeed, selectedProfileRange.hours, showToast]);

  useEffect(() => {
    void loadFeed(null);
  }, [loadFeed]);

  // Re-fetch matches when date range changes
  useEffect(() => {
    void loadFeed(null);
  }, [loadFeed, selectedProfileRange.hours]);

  useEffect(() => {
    setVisibleMatchesCount(MATCHES_PAGE_SIZE);
    setDesktopRecentVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
    setDesktopRevealedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
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
      const nextTab: MatchesTabId = deltaX < 0 ? 'predicted' : 'queued';
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

  const generateEmailDraft = useCallback((lead: SocialLead) => {
    const roleFromBreakdown = getBreakdownCandidateValue(lead.scoreBreakdown, 'role_match');
    const activeRole = activePersona?.target_role ?? '';
    const useActivePersona = Boolean(
      activePersona
      && (
        !roleFromBreakdown
        || normalize(roleFromBreakdown).includes(normalize(activeRole))
        || normalize(activeRole).includes(normalize(roleFromBreakdown))
      ),
    );

    const activeDetails = useActivePersona && activePersona ? getPersonaDetailColumns(activePersona) : null;
    const signedInUserName = ((user?.user_metadata?.full_name as string | undefined)?.trim())
      || user?.email?.split('@')[0]
      || 'Your Name';

    const profileRole = firstMeaningfulValue(activePersona?.target_role, roleFromBreakdown);
    const profileExperience = firstMeaningfulValue(
      activeDetails?.experience,
      getBreakdownCandidateValue(lead.scoreBreakdown, 'experience_match'),
      lead.experienceYears != null ? `${lead.experienceYears} years` : '',
    );
    const profileLocation = firstMeaningfulValue(
      activeDetails?.location,
      getBreakdownCandidateValue(lead.scoreBreakdown, 'location_match'),
      lead.location,
    );
    const profileVisa = firstMeaningfulValue(
      activeDetails?.visaStatus,
      getBreakdownCandidateValue(lead.scoreBreakdown, 'visa_match'),
      Array.isArray(lead.visaTypes) ? lead.visaTypes.join(', ') : '',
    );
    const profileRate = firstMeaningfulValue(
      activeDetails?.rateRange,
      getBreakdownCandidateValue(lead.scoreBreakdown, 'hourly_rate_match'),
      lead.hourlyRate,
    );
    const profileSkills = firstMeaningfulValue(
      activeDetails?.skills,
      getBreakdownCandidateValue(lead.scoreBreakdown, 'skills_match'),
      Array.isArray(lead.skills) ? lead.skills.join(', ') : '',
    );

    const profileLines = [
      `- Role: ${profileRole}`,
      `- Exp: ${profileExperience}`,
      `- Location: ${profileLocation}`,
      `- Visa: ${profileVisa}`,
      `- Rate: ${profileRate}`,
      `- Skills: ${profileSkills}`,
    ];

    return [
      'Hi there,',
      '',
      `Saw your post about the ${lead.title || 'requirement'}${lead.company ? ` at ${lead.company}` : ''}.`,
      'I have a profile that looks highly relevant to this requirement.',
      '',
      'Profile Highlights:',
      ...profileLines,
      '',
      'If this looks relevant, I can share the full profile and coordinate next steps.',
      '',
      'Thanks,',
      signedInUserName,
    ].join('\n');
  }, [activePersona, user?.email, user?.user_metadata?.full_name]);

  const generateRequestDetailsEmailDraft = useCallback((lead: SocialLead) => {
    const uniqueMissingFields = getMissingJobDetails(lead);
    const signedInUserName = ((user?.user_metadata?.full_name as string | undefined)?.trim())
      || user?.email?.split('@')[0]
      || 'Your Name';

    const detailsLine = `${signedInUserName} is requesting the following missing details regarding your job post: ${uniqueMissingFields.join(', ')}.`;

    return [
      'Hi there,',
      '',
      `Thanks for posting the ${lead.title || 'role'}${lead.company ? ` at ${lead.company}` : ''}.`,
      detailsLine,
      'Please reply with these details so the best-fit profiles can be shortlisted.',
      '',
      'Thanks,',
      'ProfilePush AI',
    ].join('\n');
  }, [user?.email, user?.user_metadata?.full_name]);

  const handleResumeFileSelected = useCallback(async (file: File) => {
    if (!account?.id) return;
    setResumeUploading(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150);
      const path = `pulse-submit/${account.id}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from('resumes').upload(path, file, {
        contentType: file.type || 'application/octet-stream',
      });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('resumes').getPublicUrl(path);
      setAskAIPreview((current) => (current ? { ...current, resumeUrl: urlData.publicUrl, resumeFileName: file.name } : current));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not upload resume', 'error');
    } finally {
      setResumeUploading(false);
    }
  }, [account?.id, showToast]);

  const handleRemoveResume = useCallback(() => {
    setAskAIPreview((current) => (current ? { ...current, resumeUrl: undefined, resumeFileName: undefined } : current));
  }, []);

  const handleAskAI = useCallback(async (lead: SocialLead) => {
    if (!account?.id || processingAskAILeadId) return;

    const leadType: 'job' | 'hotlist' = isHotlistFeed ? 'hotlist' : 'job';
    // A job with every field already detected still has a valid "ask" — re-confirming
    // rate is always a safe, relevant question, so we never block sending outreach.
    const detectedMissingDetails = leadType === 'hotlist' ? ['resume'] : getMissingJobDetails(lead);
    const missingDetails = detectedMissingDetails.length > 0 ? detectedMissingDetails : ['Rate'];
    if (!/^\S+@\S+\.\S+$/.test(lead.posterEmail.trim())) {
      showToast(leadType === 'hotlist' ? 'This consultant does not have a valid recruiter email' : 'This job does not have a valid vendor email', 'error');
      return;
    }

    const requestId = crypto.randomUUID();
    setAskAIPreview({
      leadId: lead.id,
      leadType,
      requestId,
      vendorName: lead.posterName || 'the vendor',
      jobTitle: lead.title || lead.roleTitle || '',
      company: lead.company || '',
      missingDetails,
      emailSubject: '',
      emailContent: '',
      isGenerating: true,
      channel: 'mailgun',
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
        throw new Error(data?.error || await getFunctionErrorMessage(error, 'Could not generate the request'));
      }

      const vendorName = data.vendor_name || lead.posterName || 'the vendor';
      const signedInUserName = ((user?.user_metadata?.full_name as string | undefined)?.trim())
        || user?.email?.split('@')[0]
        || '';
      setAskAIPreview((current) => ({
        leadId: lead.id,
        leadType,
        requestId,
        vendorName,
        jobTitle: current?.jobTitle ?? (lead.title || lead.roleTitle || ''),
        company: current?.company ?? (lead.company || ''),
        missingDetails,
        emailSubject: removeNameFromEmail(data.email_subject || '', vendorName),
        emailContent: removeNameFromEmail(data.email_content || '', vendorName),
        isGenerating: false,
        channel: current?.channel ?? 'mailgun',
      }));
    } catch (error) {
      setAskAIPreview(null);
      showToast(error instanceof Error ? error.message : 'Could not generate the vendor email request', 'error');
    } finally {
      setProcessingAskAILeadId(null);
    }
  }, [account?.id, isHotlistFeed, processingAskAILeadId, showToast, user?.email, user?.user_metadata?.full_name]);

  const handleSubmitAskAI = useCallback(async () => {
    if (!account?.id || !askAIPreview || processingAskAILeadId) return;

    const leadType = askAIPreview.leadType;
    const emailSubject = askAIPreview.emailSubject.trim();
    const emailContent = askAIPreview.emailContent.trim();
    const emailWordCount = emailContent.split(/\s+/).filter(Boolean).length;
    if (!emailSubject || !emailContent || emailWordCount >= 40) {
      showToast('Email subject and content are required, and the email must be under 40 words', 'error');
      return;
    }

    setProcessingAskAILeadId(askAIPreview.leadId);
    try {
      const { data, error } = await supabase.functions.invoke('ask-ai-vendor-email', {
        body: {
          action: 'send',
          request_id: askAIPreview.requestId,
          account_id: account.id,
          job_id: askAIPreview.leadId,
          lead_type: askAIPreview.leadType,
          missing_details: askAIPreview.missingDetails,
          email_subject: emailSubject,
          email_content: emailContent,
          channel: askAIPreview.channel,
          ...(askAIPreview.resumeUrl ? { resume_url: askAIPreview.resumeUrl, resume_file_name: askAIPreview.resumeFileName } : {}),
        },
      });

      if (data?.error === 'gmail_not_connected') {
        setShowGmailConnectPrompt(true);
        return;
      }
      if (error || !data?.ok) {
        throw new Error(data?.error || error?.message || 'Could not send the request');
      }

      await refreshAccount();
      setAskedJobStateByLeadId((prev) => ({
        ...prev,
        [askAIPreview.leadId]: { requestedAt: new Date().toISOString(), fulfilledAt: null },
      }));
      setGlobalAskedJobStateByLeadId((prev) => ({ ...prev, [askAIPreview.leadId]: 'asked' }));
      setAskAIPreview(null);
      if (leadType === 'job' && data.conversation_id) {
        showToast('Submitted. Opening the conversation...', 'success');
        navigate(`/inbox/${data.conversation_id}`);
      } else {
        showToast(leadType === 'hotlist' ? 'Request email sent. You will be notified if the recruiter replies in the Inbox.' : 'Submitted. You will be notified if the vendor replies in the Inbox.', 'success');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : (leadType === 'hotlist' ? 'Could not send the recruiter email request' : 'Could not submit to the vendor'), 'error');
    } finally {
      setProcessingAskAILeadId(null);
    }
  }, [account?.id, askAIPreview, navigate, processingAskAILeadId, refreshAccount, showToast]);

  useEffect(() => {
    if (!selectedLead) {
      setGeneratedEmailDrafts({ pitching: '', requestDetails: '' });
      setSelectedEmailDraftTab('pitching');
      setShowGeneratedEmailDraft(false);
      return;
    }
    setGeneratedEmailDrafts({ pitching: '', requestDetails: '' });
    setSelectedEmailDraftTab('pitching');
    setShowGeneratedEmailDraft(false);
  }, [selectedLead?.id]);

  const consumeCreditsLegacy = useCallback(async (
    amount: number,
    feature: 'pulse_reveal_contact' | 'pulse_view_breakdown' | 'pulse_predict_match',
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
    feature: 'pulse_reveal_contact' | 'pulse_view_breakdown' | 'pulse_predict_match',
    metadata: Record<string, unknown>,
  ) => {
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

  const saveVendorToTracker = useCallback(async (lead: SocialLead) => {
    if (isHotlistFeed) return true;
    const email = lead.posterEmail.trim();
    const phone = lead.posterPhone.trim();
    const company = lead.company.trim();
    const contactPerson = lead.posterName.trim();
    const location = lead.location.trim();

    let existingId: string | null = null;

    if (email) {
      const { data } = await supabase
        .from('vendors')
        .select('id')
        .eq('email', email)
        .limit(1)
        .maybeSingle();
      existingId = data?.id ?? null;
    }

    if (!existingId && phone) {
      const { data } = await supabase
        .from('vendors')
        .select('id')
        .eq('contact', phone)
        .limit(1)
        .maybeSingle();
      existingId = data?.id ?? null;
    }

    if (!existingId && company) {
      const { data } = await supabase
        .from('vendors')
        .select('id')
        .ilike('name', company)
        .limit(1)
        .maybeSingle();
      existingId = data?.id ?? null;
    }

    if (existingId) {
      const { error } = await supabase
        .from('vendors')
        .update({
          name: company || contactPerson || 'Unknown Vendor',
          contact_person: contactPerson,
          email,
          contact: phone,
          location,
        })
        .eq('id', existingId);

      if (error) {
        showToast('Contact revealed but vendor sync failed', 'error');
        return false;
      }
      return true;
    }

    const { error } = await supabase.from('vendors').insert({
      name: company || contactPerson || 'Unknown Vendor',
      contact_person: contactPerson,
      email,
      contact: phone,
      location,
    });

    if (error) {
      showToast('Contact revealed but vendor sync failed', 'error');
      return false;
    }

    return true;
  }, [isHotlistFeed, showToast]);

  const isFreePlanRevealLimitReached = useCallback(async () => {
    if (!account?.id || isPaidPlan) return false;

    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabase
      .from('pulse_lead_actions')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', account.id)
      .eq('action_type', 'revealed')
      .gte('created_at', sinceIso);

    if (error) {
      showToast('Could not verify daily reveal limit right now', 'error');
      return true;
    }

    if ((count ?? 0) >= FREE_PLAN_DAILY_REVEAL_LIMIT) {
      showToast(`Free plan limit reached: ${FREE_PLAN_DAILY_REVEAL_LIMIT} reveals per day`, 'error');
      return true;
    }

    return false;
  }, [account?.id, isPaidPlan, showToast]);

  const handleRevealContact = useCallback(async (lead: SocialLead) => {
    if (!user) {
      showToast('Please sign in to reveal contact details', 'error');
      return;
    }

    setProcessingLeadId(lead.id);
    const alreadyRevealed = revealedLeadIds.has(lead.id);

    try {
      if (!alreadyRevealed) {
        if (!isPaidPlan) {
          const limitReached = await isFreePlanRevealLimitReached();
          if (limitReached) return;
        }

        const consumed = await consumeCredits(REVEAL_CONTACT_COST, 'pulse_reveal_contact', {
          lead_id: lead.id,
          platform: lead.platform,
          title: lead.title,
          company: lead.company,
        });
        if (!consumed) return;

        setRevealedLeadIds((prev) => {
          const next = new Set(prev);
          next.add(lead.id);
          return next;
        });
        setRevealedAtByLeadId((prev) => ({
          ...prev,
          [lead.id]: new Date().toISOString(),
        }));
        setRevealCountsByLeadId((prev) => ({
          ...prev,
          [lead.id]: Math.max(1, (prev[lead.id] ?? 0) + 1),
        }));
        const signedInUserName = ((user?.user_metadata?.full_name as string | undefined)?.trim())
          || user?.email?.split('@')[0]
          || 'You';
        setRevealNamesByLeadId((prev) => {
          const existing = prev[lead.id] ?? [];
          if (existing.some((name) => name.toLowerCase() === signedInUserName.toLowerCase())) {
            return prev;
          }
          return {
            ...prev,
            [lead.id]: [signedInUserName, ...existing].slice(0, 3),
          };
        });
        void persistLeadAction(lead.id, 'revealed');
        showToast(`$${REVEAL_CONTACT_COST.toFixed(2)} credits consumed for reveal`, 'success');
      }

      const saved = await saveVendorToTracker(lead);
      if (saved) {
        setQueuedLeadIds((prev) => {
          const next = new Set(prev);
          next.add(lead.id);
          return next;
        });
        showToast(isHotlistFeed ? 'Bench Sales Recruiter contact revealed' : 'Vendor auto-saved to Tracker', 'success');
      }

      setSelectedLead(lead);
      setShowBreakdown(false);
    } finally {
      setProcessingLeadId(null);
    }
  }, [consumeCredits, isFreePlanRevealLimitReached, isHotlistFeed, isPaidPlan, persistLeadAction, revealedLeadIds, saveVendorToTracker, showToast, user]);

  const handlePreviewPost = useCallback(async (lead: SocialLead) => {
    if (!user || loadingPostContentLeadId) return;
    setLoadingPostContentLeadId(lead.id);
    try {
      const alreadyViewed = postContentViewedLeadIds.has(lead.id);
      if (!alreadyViewed) {
        const consumed = await consumeCredits(POST_CONTENT_COST, 'pulse_view_post_content', {
          lead_id: lead.id,
          platform: lead.platform,
          title: lead.title,
          company: lead.company,
        });
        if (!consumed) return;

        setPostContentViewedLeadIds((prev) => {
          const next = new Set(prev);
          next.add(lead.id);
          return next;
        });
        void persistLeadAction(lead.id, 'post_content_viewed');
        showToast(`$${POST_CONTENT_COST.toFixed(2)} credits consumed for post preview`, 'success');
      }

      const { data, error } = await supabase
        .from(isHotlistFeed ? 'social_hotlist' : 'social_jobs')
        .select(isHotlistFeed ? 'raw_post_content' : 'post_content')
        .eq('id', lead.id)
        .maybeSingle();
      if (error || !data) throw new Error(error?.message || 'Could not load the post');

      const content = String((isHotlistFeed ? (data as { raw_post_content: string | null }).raw_post_content : (data as { post_content: string | null }).post_content) ?? '').trim();
      setPostContentPreview({
        leadId: lead.id,
        title: lead.title || (isHotlistFeed ? 'Available Consultant' : 'Job Opportunity'),
        content: content || 'No post content available.',
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load the post', 'error');
    } finally {
      setLoadingPostContentLeadId(null);
    }
  }, [consumeCredits, isHotlistFeed, loadingPostContentLeadId, persistLeadAction, postContentViewedLeadIds, showToast, user]);

  const handleIgnoreLead = useCallback(async (lead: SocialLead) => {
    if (!user || processingIgnoreLeadId) return;
    setProcessingIgnoreLeadId(lead.id);
    try {
      if (isAdminUser) {
        const { data, error } = await supabase.functions.invoke('pulse-hide-lead', {
          body: { lead_id: lead.id, lead_type: isHotlistFeed ? 'hotlist' : 'job' },
        });
        if (error || !data?.ok) throw new Error(data?.error || (error as Error)?.message || 'Could not hide this post');
        showToast('Removed from the platform for everyone', 'success');
      } else {
        showToast('Removed from your feed', 'success');
      }
      void persistLeadAction(lead.id, 'ignored');
      setIgnoredLeadIds((prev) => {
        const next = new Set(prev);
        next.add(lead.id);
        return next;
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not remove this post', 'error');
    } finally {
      setProcessingIgnoreLeadId(null);
    }
  }, [isAdminUser, isHotlistFeed, persistLeadAction, processingIgnoreLeadId, showToast, user]);

  const handleOpenBreakdown = useCallback(async (lead: SocialLead) => {
    setProcessingBreakdownLeadId(lead.id);
    try {
      const alreadyCharged = breakdownChargedLeadIds.has(lead.id);
      if (!alreadyCharged) {
        const consumed = await consumeCredits(BREAKDOWN_COST, 'pulse_view_breakdown', {
          lead_id: lead.id,
          platform: lead.platform,
          title: lead.title,
          company: lead.company,
        });
        if (!consumed) return;

        setBreakdownChargedLeadIds((prev) => {
          const next = new Set(prev);
          next.add(lead.id);
          return next;
        });
        void persistLeadAction(lead.id, 'breakdown');
        showToast(`$${BREAKDOWN_COST.toFixed(2)} credits consumed for breakdown`, 'success');
      }

      setSelectedLead(lead);
      setShowBreakdown(true);
    } finally {
      setProcessingBreakdownLeadId(null);
    }
  }, [breakdownChargedLeadIds, consumeCredits, persistLeadAction, showToast]);

  const applyFeedSearch = useCallback(async (queryOverride?: string) => {
    const rawQuery = (queryOverride ?? pendingFeedSearchQuery).trim();
    const parsed = parseFeedSearchIntent(rawQuery);
    const appliedQuery = parsed.roleQuery;
    const appliedFilters = mergeFeedFiltersWithIntent(DEFAULT_FEED_SEARCH_FILTERS, parsed.inferred);

    setFeedSearchQuery(appliedQuery);
    setFeedSearchFilters(appliedFilters);
    setIsRecentSearchesOpen(false);

    if (rawQuery && user?.id) {
      await supabase
        .from('job_search_history')
        .insert({
          user_id: user.id,
          account_id: account?.id ?? null,
          page: isHotlistFeed ? '/hotlist' : '/jobs',
          search_query: rawQuery,
        });
      void loadRecentSearches();
    }

    if (!appliedQuery) {
      setVectorSearchLeadIds(null);
      setVectorSearchLoading(false);
      return;
    }

    if (isHotlistFeed) {
      setVectorSearchLeadIds(null);
      setVectorSearchLoading(false);
      return;
    }

    setVectorSearchLoading(true);
    const since = new Date(Date.now() - (selectedProfileRange.hours * 60 * 60 * 1000)).toISOString();

    const ftsResult = await supabase.rpc('search_pulse_social_feed_fts', {
      p_query: appliedQuery,
      p_since: since,
      p_limit: 2000,
      p_offset: 0,
    } as never);

    if (!ftsResult.error && Array.isArray(ftsResult.data)) {
      const ftsIds = (ftsResult.data as Array<{ lead_id?: string | null }>)
        .map((row) => (row.lead_id ?? '').trim())
        .filter(Boolean);

      if (ftsIds.length > 0) {
        setVectorSearchLeadIds(ftsIds);
        setVectorSearchLoading(false);
        return;
      }
    }

    const vectorResult = await supabase.rpc('search_pulse_social_feed_vector', {
      p_role_query: appliedQuery,
      p_limit: 2000,
      p_similarity_threshold: 0.58,
    } as never);

    if (!vectorResult.error && Array.isArray(vectorResult.data)) {
      const ids = (vectorResult.data as Array<{ lead_id?: string | null }>)
        .map((row) => (row.lead_id ?? '').trim())
        .filter(Boolean);
      setVectorSearchLeadIds(ids.length > 0 ? ids : null);
    } else {
      setVectorSearchLeadIds(null);
    }

    setVectorSearchLoading(false);
  }, [account?.id, isHotlistFeed, loadRecentSearches, pendingFeedSearchQuery, selectedProfileRange.hours, user?.id]);

  useEffect(() => {
    const queryFromParams = (searchParams.get('q') ?? '').trim();
    if (!queryFromParams) {
      appliedSearchParamQueryRef.current = null;
      return;
    }
    if (appliedSearchParamQueryRef.current === queryFromParams) return;
    appliedSearchParamQueryRef.current = queryFromParams;
    setPendingFeedSearchQuery(queryFromParams);
    void applyFeedSearch(queryFromParams);
  }, [applyFeedSearch, searchParams]);

  return (
    <div className="h-[100dvh] overflow-hidden overscroll-none bg-white text-gray-900 flex flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0 dark:bg-[#1B1D21] dark:text-slate-100">
      <AppNav />

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className={`h-full w-full flex flex-col overflow-hidden ${isMobileViewport ? 'px-2 pt-0 pb-2' : 'px-2 py-2'}`}>


          {loading ? (
            <div className="flex h-full min-h-0 items-center justify-center rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-[#1E293B]">
              <LogoSpinner size={24} />
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
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
                        className={`inline-flex shrink-0 flex-col items-center gap-0.5 rounded-md border px-3 py-1.5 text-[11px] font-medium transition ${getCategoryTabClass(category.id, isSelected, isDark)}`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <CategoryIcon size={14} className={isSelected ? 'text-slate-200' : 'text-slate-400'} />
                          <span>{category.label}</span>
                        </span>
                        <span className={`inline-flex items-center gap-1.5 text-[9px] ${isSelected ? 'text-slate-400' : 'text-slate-500'}`}>
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
                          className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium transition ${getTechStackClass(selectedCategoryId, isActive, isDark)}`}
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
                        className="w-full border-0 bg-transparent text-[11px] text-gray-700 outline-none placeholder:text-gray-400"
                      />
                    </div>
                  </div>
                  <select
                    id="profile-range-filter"
                    aria-label="Date range"
                    value={profileRangeId}
                    onChange={(e) => setProfileRangeId(e.target.value as ProfileRangeOption['id'])}
                    className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-700"
                  >
                    {PROFILE_RANGE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                  {lastMatchAt && (
                    <span className="text-[10px] italic text-gray-400">Last refreshed {formatAgo(lastMatchAt)}</span>
                  )}
                  <button
                    onClick={() => {
                      void refreshFeed();
                    }}
                    disabled={profileStatsLoading || refreshing || feedLoading}
                    className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <span className="inline-flex items-center gap-1">
                      <RefreshCw size={11} className={refreshing || profileStatsLoading ? 'animate-spin' : ''} />
                      Refresh
                    </span>
                  </button>
                </div>

              {/* Mobile search/filter row — controls job feed search */}
              <div
                className={isMobileViewport ? `sticky top-0 z-30 shrink-0 bg-white px-0 transition-[max-height,opacity,transform] duration-200 ease-out dark:bg-[#1B1D21] ${isRangeMenuOpen || isRecentSearchesOpen ? 'overflow-visible' : 'overflow-hidden'}` : 'px-2 py-2'}
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
                  <div ref={recentSearchesRef} className="relative flex flex-1 items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5">
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
                      placeholder="Solutions Architect C2C $45"
                      className="w-full border-0 bg-transparent text-[11px] text-gray-700 outline-none placeholder:text-gray-400"
                    />
                    {pendingFeedSearchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setPendingFeedSearchQuery('');
                          setFeedSearchQuery('');
                          setFeedSearchFilters(DEFAULT_FEED_SEARCH_FILTERS);
                          setVectorSearchLeadIds(null);
                          setIsRecentSearchesOpen(false);
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
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[10px] font-medium text-gray-700 transition hover:bg-gray-50"
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
                    disabled={vectorSearchLoading}
                    aria-label="Search"
                  >
                    <Search size={12} className={vectorSearchLoading ? 'animate-pulse' : ''} />
                  </button>

                  {!isMobileViewport && (
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
                              if (tab.id === 'revealed') setDesktopRevealedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
                              if (tab.id === 'asked') setDesktopAskedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
                              if (tab.id === 'verified') setDesktopVerifiedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
                              if (tab.id === 'queued') setDesktopRecentVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
                              if (tab.id === 'predicted') setDesktopPredictedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
                            }}
                            className={`inline-flex items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[10px] font-semibold transition ${isSelected ? (isDark ? 'border border-white/25 bg-[#2A2E35] text-slate-100' : 'border border-blue-600 bg-blue-600 text-white') : (isDark ? 'border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100' : 'border border-blue-200 bg-white text-blue-600 hover:bg-blue-50')}`}
                          >
                            <span>{tab.label}</span>
                            <span>{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {!isMobileViewport && (
                    <div className="flex shrink-0 items-center rounded-md border border-gray-200 bg-gray-50 p-0.5" aria-label="Layout view">
                      {([
                        { id: 'card' as PulseLayoutMode, label: 'Cards', icon: LayoutGrid },
                        { id: 'table' as PulseLayoutMode, label: 'Table', icon: Table2 },
                      ]).map((view) => (
                        <button
                          key={view.id}
                          type="button"
                          onClick={() => setLayoutMode(view.id)}
                          className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold transition ${layoutMode === view.id ? 'bg-white text-blue-700 shadow-sm dark:bg-[#2A2E35] dark:text-blue-300' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                          <view.icon size={11} />
                          {view.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {!isMobileViewport && canSelectFeedTimeBasis && (
                    <div className="flex shrink-0 items-center rounded-md border border-gray-200 bg-gray-50 p-0.5" aria-label="Feed time basis">
                      {(['posted', 'created'] as FeedTimeBasis[]).map((basis) => (
                        <button
                          key={basis}
                          type="button"
                          onClick={() => setFeedTimeBasis(basis)}
                          className={`rounded px-2 py-1 text-[10px] font-semibold capitalize transition ${feedTimeBasis === basis ? 'bg-white text-blue-700 shadow-sm dark:bg-[#2A2E35] dark:text-blue-300' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                          {basis}
                        </button>
                      ))}
                    </div>
                  )}

                  <div ref={rangeMenuRef} className="relative shrink-0">
                    <button
                      onClick={() => {
                        setIsRangeMenuOpen((prev) => !prev);
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1.5 text-[10px] font-semibold text-gray-600 transition hover:bg-gray-100"
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
                              className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[10px] font-semibold transition ${isActive ? (isDark ? 'bg-[#2A2E35] text-slate-100' : 'bg-gray-100 text-gray-800') : 'text-gray-600 hover:bg-gray-50'}`}
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

              <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-[#ffffff] dark:bg-transparent">

              <div
                className={`min-w-0 h-full flex min-h-0 flex-col ${isMobileViewport ? 'relative isolate overflow-x-hidden overflow-y-auto overscroll-contain bg-[#ffffff] dark:bg-transparent slim-scrollbar' : 'overflow-hidden'}`}
                onScroll={isMobileViewport ? handleMobileRightPaneScroll : undefined}
                onTouchStart={isMobileViewport ? handleMobilePullStart : undefined}
                onTouchMove={isMobileViewport ? handleMobilePullMove : undefined}
                onTouchEnd={isMobileViewport ? handleMobilePullEnd : undefined}
              >
                {false && isMobileViewport ? (
                  <div className="sticky top-0 z-20 shrink-0 flex items-center gap-2 bg-white/90 px-1.5 py-2 backdrop-blur">
                    <div className="inline-flex items-center gap-2 min-w-0 shrink-0 rounded-full bg-blue-50/70 px-2 py-1">
                      <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-700">Profiles</span>
                    </div>
                    <div className="ml-auto grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        onClick={() => setSelectedProfilesView('all')}
                        className={`inline-flex items-center justify-center gap-0.5 rounded-full px-2 py-1 text-[10px] font-semibold transition ${selectedProfilesView === 'all' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        <span>All</span>
                        <span className={`text-[9px] font-bold ${selectedProfilesView === 'all' ? 'text-white/90' : 'text-gray-500'}`}>{profileViewCounts.all}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedProfilesView('watching')}
                        className={`inline-flex items-center justify-center gap-0.5 rounded-full px-2 py-1 text-[10px] font-semibold transition ${selectedProfilesView === 'watching' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        <span>Watching</span>
                        <span className={`text-[9px] font-bold ${selectedProfilesView === 'watching' ? 'text-white/90' : 'text-gray-500'}`}>{profileViewCounts.watching}</span>
                      </button>
                    </div>
                  </div>
                ) : null}

              {false && <section className="min-w-0 shrink-0 overflow-hidden">
                {!isMobileViewport ? (
                  <div className="shrink-0 flex items-center gap-2 bg-white/90 px-1.5 py-2 backdrop-blur">
                    <div className="inline-flex items-center gap-2 min-w-0 shrink-0 rounded-full bg-blue-50/70 px-2 py-1">
                      <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-blue-700">Profiles</span>
                    </div>
                  </div>
                ) : null}
                {/* Profile list */}
                {isMobileViewport ? (
                  <div ref={profileListScrollRef} className="overflow-x-auto overflow-y-hidden pb-1 slim-scrollbar">
                    <div className="flex gap-2 px-1.5 py-2 snap-x snap-mandatory">
                      {visibleJobsRankedLeaderboard.length === 0 && (
                        <div className="px-3 py-8 text-center text-xs text-gray-400">No profiles found.</div>
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
                              <p className={`text-[11px] font-semibold leading-snug ${getRoleRowAccentClass(index, isDark)}`}>{persona.target_role}</p>
                              <div className="ml-auto flex items-center gap-1">
                                {renderMarketPulseSymbol(profilePulseVisual.level, profilePulseVisual.badgeClass, stats.uniqueJobs)}
                              </div>
                            </div>
                            <div className={`mt-1 grid grid-cols-3 gap-1 text-[10px] leading-tight ${isExpanded ? '' : ''}`}>
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
                                <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[9px] font-bold text-gray-700">{stats.uniqueJobs} {isHotlistFeed ? 'Consultants' : 'Jobs'}</span>
                                <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[9px] font-bold text-gray-700">{stats.uniqueVendors} {isHotlistFeed ? 'Bench Recruiters' : 'Vendors'}</span>
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
                                  className={`col-span-7 inline-flex items-center justify-center rounded-md border px-2 py-1 text-[9px] font-semibold transition ${isWatching ? 'border-blue-300 bg-blue-100 text-blue-700' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                                >
                                  {isActivating ? '...' : isWatching ? '✓ Watching' : '+ Watch'}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {canLoadMoreProfiles && (
                        <div ref={mobileProfilesLoadMoreRef} className="flex w-[84%] shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-6 text-[10px] text-gray-400 snap-start">
                          Loading more profiles...
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 px-2 py-2">
                    <div className="min-w-0 rounded-md bg-transparent">
                      <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">All ({profileViewCounts.all})</div>
                      <div className="overflow-x-auto overflow-y-hidden pb-1 slim-scrollbar">
                        <div className="flex gap-2 px-1.5 py-2 snap-x snap-mandatory">
                          {filteredJobsRankedLeaderboard.filter((item) => !watchingRoles.has(normalize(item.target_role))).length === 0 && (
                            <div className="px-3 py-6 text-center text-xs text-gray-400">No profiles found.</div>
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
                                  <p className={`text-[11px] font-semibold leading-snug ${getRoleRowAccentClass(index, isDark)}`}>{persona.target_role}</p>
                                  <div className="flex items-center gap-1">
                                    {renderMarketPulseSymbol(profilePulseVisual.level, profilePulseVisual.badgeClass, stats.uniqueJobs)}
                                  </div>
                                </div>
                                <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] leading-tight">
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{experience.missing ? <PersonaMissingTag /> : experience.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{location.missing ? <PersonaMissingTag /> : location.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{rateRange.missing ? <PersonaMissingTag /> : rateRange.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{employmentType.missing ? <PersonaMissingTag /> : employmentType.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{workType.missing ? <PersonaMissingTag /> : workType.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{visaStatus.missing ? <PersonaMissingTag /> : visaStatus.value}</div>
                                </div>
                                <div className="mt-1 space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[9px] font-bold text-gray-700">{stats.uniqueJobs} {isHotlistFeed ? 'Consultants' : 'Jobs'}</span>
                                    <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[9px] font-bold text-gray-700">{stats.uniqueVendors} {isHotlistFeed ? 'Bench Recruiters' : 'Vendors'}</span>
                                  </div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); void activatePersona(persona); }}
                                    disabled={isActivating}
                                    className={`inline-flex w-full items-center justify-center rounded-md border px-2 py-1 text-[9px] font-semibold transition ${isWatching ? 'border-blue-300 bg-blue-100 text-blue-700' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
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
                      <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">Watching ({profileViewCounts.watching})</div>
                      <div className="overflow-x-auto overflow-y-hidden pb-1 slim-scrollbar">
                        <div className="flex gap-2 px-1.5 py-2 snap-x snap-mandatory">
                          {orderedJobsRankedLeaderboard.filter((item) => watchingRoles.has(normalize(item.target_role))).length === 0 && (
                            <div className="px-3 py-6 text-center text-xs text-gray-400">No watching profiles yet.</div>
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
                                  <p className={`text-[11px] font-semibold leading-snug ${getRoleRowAccentClass(index, isDark)}`}>{persona.target_role}</p>
                                  <div className="flex items-center gap-1">
                                    {renderMarketPulseSymbol(profilePulseVisual.level, profilePulseVisual.badgeClass, stats.uniqueJobs)}
                                  </div>
                                </div>
                                <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] leading-tight">
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{experience.missing ? <PersonaMissingTag /> : experience.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{location.missing ? <PersonaMissingTag /> : location.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{rateRange.missing ? <PersonaMissingTag /> : rateRange.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{employmentType.missing ? <PersonaMissingTag /> : employmentType.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{workType.missing ? <PersonaMissingTag /> : workType.value}</div>
                                  <div className="min-w-0 truncate rounded-md bg-white/6 px-1.5 py-1 text-gray-600 ring-1 ring-inset ring-white/6 dark:bg-white/5 dark:text-gray-300 dark:ring-white/8">{visaStatus.missing ? <PersonaMissingTag /> : visaStatus.value}</div>
                                </div>
                                <div className="mt-1 space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[9px] font-bold text-gray-700">{stats.uniqueJobs} {isHotlistFeed ? 'Consultants' : 'Jobs'}</span>
                                    <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[9px] font-bold text-gray-700">{stats.uniqueVendors} {isHotlistFeed ? 'Bench Recruiters' : 'Vendors'}</span>
                                  </div>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); void activatePersona(persona); }}
                                    disabled={isActivating}
                                    className={`inline-flex w-full items-center justify-center rounded-md border px-2 py-1 text-[9px] font-semibold transition ${isWatching ? 'border-blue-300 bg-blue-100 text-blue-700' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
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
                  <p className="text-[10px] text-gray-500">
                    {profilePage}/{totalProfilePages}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setProfilePage((p) => Math.max(1, p - 1))}
                      disabled={profilePage <= 1}
                      className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    >
                      ‹
                    </button>
                    <button
                      onClick={() => setProfilePage((p) => Math.min(totalProfilePages, p + 1))}
                      disabled={profilePage >= totalProfilePages}
                      className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    >
                      ›
                    </button>
                  </div>
                </div>
              </section>}

              {isMobileViewport && (
                <div
                  className="sticky top-0 z-40 shrink-0 overflow-hidden bg-white px-1.5 transition-[max-height,opacity,transform] duration-200 ease-out transform-gpu backface-hidden dark:bg-[#1B1D21]"
                  style={{
                    maxHeight: isMobileTopCollapsed ? '0px' : (canSelectFeedTimeBasis ? '72px' : '40px'),
                    opacity: isMobileTopCollapsed ? 0 : 1,
                    transform: isMobileTopCollapsed ? 'translateY(-8px)' : 'translateY(0)',
                    pointerEvents: isMobileTopCollapsed ? 'none' : 'auto',
                    paddingBottom: isMobileTopCollapsed ? 0 : '0.25rem',
                  }}
                >
                  <div className="grid w-full grid-cols-4 gap-1">
                    {matchesTabDefinitions.map((tab) => {
                      const isSelected = selectedMatchesTab === tab.id;
                      const count = matchesTabCounts[tab.id];
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => { setSelectedMatchesTab(tab.id); setVisibleMatchesCount(MATCHES_PAGE_SIZE); }}
                          className={`inline-flex w-full items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold transition ${isSelected ? (isDark ? 'border border-white/25 bg-[#22262c] text-slate-100' : 'border border-blue-600 bg-blue-600 text-white') : (isDark ? 'border border-transparent bg-[#171a1f] text-[#94A3B8] hover:bg-[#1e2228] hover:text-slate-300' : 'border border-blue-200 bg-white text-blue-600 hover:bg-blue-50')}`}
                        >
                          <span>{tab.label}</span>
                          <span>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  {canSelectFeedTimeBasis && (
                    <div className="mt-1 flex justify-end">
                      <div className="flex items-center rounded-md border border-gray-200 bg-gray-50 p-0.5" aria-label="Feed time basis">
                        {(['posted', 'created'] as FeedTimeBasis[]).map((basis) => (
                          <button
                            key={basis}
                            type="button"
                            onClick={() => setFeedTimeBasis(basis)}
                            className={`rounded px-2 py-0.5 text-[9px] font-semibold capitalize transition ${feedTimeBasis === basis ? 'bg-white text-blue-700 shadow-sm dark:bg-[#2A2E35] dark:text-blue-300' : 'text-gray-500'}`}
                          >
                            {basis}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {isMobileViewport && (pullDistance > 0 || isPullRefreshing) && (
                <div className="shrink-0 flex items-center justify-center bg-[rgba(255,255,255,0.95)] text-[9px] font-medium text-gray-500 dark:bg-transparent dark:text-[#94A3B8]">
                  <div style={{ height: `${Math.max(14, Math.min(24, pullDistance))}px` }} className="flex items-center gap-1 py-0.5">
                    <RefreshCw size={9} className={isPullRefreshing ? 'animate-spin' : ''} />
                    <span>{isPullRefreshing ? 'Refreshing...' : (mobilePullArmedRef.current ? 'Release to refresh' : 'Pull to refresh')}</span>
                  </div>
                </div>
              )}

              <section className={`min-w-0 flex min-h-0 flex-col ${isMobileViewport ? 'flex-none' : 'flex-1 overflow-hidden'}`}>
                <div className={`min-h-0 ${isMobileViewport ? '' : 'flex-1 overflow-hidden'}`}>
                  {feedLoading ? (
                    <div className={`${isMobileViewport ? 'flex min-h-[50vh] w-full' : 'flex h-full min-h-0 w-full'} items-center justify-center`}>
                      <LogoSpinner size={20} />
                    </div>
                  ) : (
                    isMobileViewport ? (
                      <div>
                        {filteredFeed.length === 0 ? (
                          <div className="flex items-center justify-center p-6 text-center">
                            <div>
                              <Radar size={16} className="mx-auto text-gray-300" />
                              <p className="mt-1.5 text-[11px] text-gray-500">No matches yet</p>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1.5 px-1.5 pt-1 pb-4">
                            {renderLeadCards(visibleFeed)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="min-h-0 h-full rounded-md bg-transparent p-1">
                        <div
                          ref={desktopMatchesScrollRef}
                          className={`min-h-0 h-full overflow-y-auto slim-scrollbar ${isTableLayout ? 'px-1.5 pb-1.5' : 'p-1.5'}`}
                          onScroll={selectedMatchesTab === 'revealed' ? handleDesktopRevealedScroll : selectedMatchesTab === 'asked' ? handleDesktopAskedScroll : selectedMatchesTab === 'verified' ? handleDesktopVerifiedScroll : selectedMatchesTab === 'predicted' ? handleDesktopPredictedScroll : handleDesktopRecentScroll}
                        >
                          {selectedMatchesTab === 'revealed' ? (
                            revealedVisibleFeed.length === 0 ? (
                              <div className="flex h-full items-center justify-center px-3 py-6 text-center text-xs text-gray-400">{isHotlistFeed ? 'No revealed consultants yet.' : 'No revealed jobs yet.'}</div>
                            ) : isTableLayout ? (
                              renderLeadTable(visibleDesktopRevealedFeed)
                            ) : (
                              <div className="columns-3 gap-1.5">
                                {renderLeadCards(visibleDesktopRevealedFeed, 3)}
                              </div>
                            )
                          ) : selectedMatchesTab === 'predicted' ? (
                            predictedVisibleFeed.length === 0 ? (
                              <div className="flex h-full items-center justify-center px-3 py-6 text-center text-xs text-gray-400">No predictions run yet.</div>
                            ) : isTableLayout ? (
                              renderLeadTable(visibleDesktopPredictedFeed)
                            ) : (
                              <div className="columns-3 gap-1.5">
                                {renderLeadCards(visibleDesktopPredictedFeed, 3)}
                              </div>
                            )
                          ) : selectedMatchesTab === 'asked' ? (
                            askedVisibleFeed.length === 0 ? (
                              <div className="flex h-full items-center justify-center px-3 py-6 text-center text-xs text-gray-400">{isHotlistFeed ? 'No asked jobs yet.' : 'No submissions yet.'}</div>
                            ) : isTableLayout ? (
                              renderLeadTable(visibleDesktopAskedFeed)
                            ) : (
                              <div className="columns-3 gap-1.5">
                                {renderLeadCards(visibleDesktopAskedFeed, 3)}
                              </div>
                            )
                          ) : selectedMatchesTab === 'verified' ? (
                            verifiedVisibleFeed.length === 0 ? (
                              <div className="flex h-full items-center justify-center px-3 py-6 text-center text-xs text-gray-400">{isHotlistFeed ? 'No verified jobs yet.' : 'No replies yet.'}</div>
                            ) : isTableLayout ? (
                              renderLeadTable(visibleDesktopVerifiedFeed)
                            ) : (
                              <div className="columns-3 gap-1.5">
                                {renderLeadCards(visibleDesktopVerifiedFeed, 3)}
                              </div>
                            )
                          ) : (
                            recentVisibleFeed.length === 0 ? (
                              <div className="flex h-full items-center justify-center px-3 py-6 text-center text-xs text-gray-400">{isHotlistFeed ? 'No recent consultants.' : 'No recent jobs.'}</div>
                            ) : isTableLayout ? (
                              renderLeadTable(visibleDesktopRecentFeed)
                            ) : (
                              <div className="columns-3 gap-1.5">
                                {renderLeadCards(visibleDesktopRecentFeed, 3)}
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
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                {askAIPreview.leadType === 'hotlist' ? <FileText size={18} /> : <Mail size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="ask-ai-preview-title" className="text-sm font-semibold text-gray-900">{askAIPreview.isGenerating ? (askAIPreview.leadType === 'hotlist' ? 'Generating resume request' : 'Generating submission') : (askAIPreview.leadType === 'hotlist' ? 'Review resume request' : 'Review submission')}</h2>
                {askAIPreview.isGenerating ? (
                  <p className="mt-1 text-xs leading-relaxed text-gray-600">Preparing an email to {maskName(askAIPreview.vendorName)}.</p>
                ) : (askAIPreview.jobTitle || askAIPreview.company) && (
                  <p className="mt-0.5 truncate text-xs text-gray-500">
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
                <p className="mt-4 text-sm font-semibold text-gray-900">Generating your email</p>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-gray-500">{askAIPreview.leadType === 'hotlist' ? "Using the consultant's profile to prepare a resume request." : 'Using the job and missing details to prepare a concise message.'}</p>
              </div>
            ) : <>
            <input
              value={askAIPreview.emailSubject}
              onChange={(event) => setAskAIPreview((current) => current ? { ...current, emailSubject: event.target.value } : current)}
              disabled={Boolean(processingAskAILeadId)}
              placeholder="Subject"
              className="mt-3 w-full rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <div className="relative mt-2">
              <textarea
                value={askAIPreview.emailContent}
                onChange={(event) => setAskAIPreview((current) => current ? { ...current, emailContent: event.target.value } : current)}
                disabled={Boolean(processingAskAILeadId)}
                rows={4}
                placeholder="Write your message..."
                className="w-full resize-none rounded-md border border-gray-200 px-3 py-2 pb-7 text-xs leading-relaxed text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <div className="pointer-events-none absolute inset-x-2 bottom-1.5 flex items-center justify-between">
                {askAIPreview.leadType === 'job' ? (
                  askAIPreview.resumeFileName ? (
                    <span className="pointer-events-auto inline-flex max-w-[65%] items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                      <Paperclip size={10} className="shrink-0" />
                      <span className="min-w-0 truncate">{askAIPreview.resumeFileName}</span>
                      <button
                        type="button"
                        onClick={handleRemoveResume}
                        disabled={Boolean(processingAskAILeadId)}
                        className="shrink-0 text-gray-400 hover:text-gray-600"
                        aria-label="Remove resume"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ) : (
                    <label
                      className={`pointer-events-auto inline-flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 ${resumeUploading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
                      title="Attach resume (optional)"
                    >
                      {resumeUploading ? <LogoSpinner size={12} /> : <Paperclip size={13} />}
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        disabled={resumeUploading || Boolean(processingAskAILeadId)}
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.target.value = '';
                          if (file) void handleResumeFileSelected(file);
                        }}
                      />
                    </label>
                  )
                ) : <span />}
                <span className="text-[10px] text-gray-400">
                  {askAIPreview.emailContent.trim().split(/\s+/).filter(Boolean).length}/39 words
                </span>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 text-[10px] font-medium text-gray-400">
                <GmailIcon size={12} />
                Gmail connector — Coming soon
              </span>
              <button
                type="button"
                onClick={() => void handleSubmitAskAI()}
                disabled={Boolean(processingAskAILeadId) || resumeUploading || !askAIPreview.emailSubject.trim() || !askAIPreview.emailContent.trim() || askAIPreview.emailContent.trim().split(/\s+/).filter(Boolean).length >= 40}
                className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {askAIPreview.leadType === 'hotlist' ? <FileText size={12} /> : <Mail size={12} />}
                {askAIPreview.leadType === 'job'
                  ? (processingAskAILeadId ? 'Submitting...' : 'Submit')
                  : (processingAskAILeadId ? 'Sending...' : 'Send')}
              </button>
            </div>
            </>}
          </div>
        </div>
      )}

      {predictLead && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={closePredictModal}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Predict submission chance"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-5 shadow-xl"
          >
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={closePredictModal}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                aria-label="Close predict modal"
              >
                <X size={14} />
              </button>
            </div>

            {!predictSubmitting && !predictResult && (
              <>
                <div className="mt-1">
                  <textarea
                    value={predictInput}
                    onChange={(event) => setPredictInput(event.target.value)}
                    rows={6}
                    placeholder={isHotlistFeed ? 'Paste the job details or requirements here...' : 'Paste consultant resume, skills, or a quick summary here...'}
                    className="w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-xs leading-relaxed text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                {recentPredictTexts.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Recent</div>
                    <div className="mt-1 flex flex-col gap-1">
                      {recentPredictTexts.map((text, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setPredictInput(text)}
                          className="truncate rounded-md border border-gray-200 px-2 py-1.5 text-left text-[11px] text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                          title={text}
                        >
                          {text.length > 90 ? `${text.slice(0, 90)}…` : text}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void handleCalculateMatch()}
                  disabled={!predictInput.trim()}
                  className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 text-sm font-bold uppercase tracking-wide text-orange-600 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-orange-400"
                >
                  <Gauge size={16} strokeWidth={2.5} />
                  {isHotlistFeed ? 'Match Score' : 'Predict Submission Acceptance'}
                </button>
              </>
            )}

            {predictSubmitting && (
              <div className="mt-1 py-4">
                <p className="text-center text-xs font-semibold text-gray-500">Analyzing submission fit...</p>
                <div className="mt-4 space-y-2.5">
                  {PREDICT_PROCESSING_LABELS.map((label, index) => {
                    const isDone = index < predictProcessingStep || (index === predictProcessingStep && index === PREDICT_PROCESSING_LABELS.length - 1);
                    const isActive = index === predictProcessingStep && !isDone;
                    return (
                      <div key={label} className="flex items-center gap-2.5">
                        {isDone ? (
                          <Check size={14} className="shrink-0 text-emerald-500" />
                        ) : isActive ? (
                          <LogoSpinner size={14} />
                        ) : (
                          <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                            <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
                          </span>
                        )}
                        <span className={`text-xs font-medium ${isDone ? 'text-gray-900' : isActive ? 'text-gray-700' : 'text-gray-400'}`}>
                          Checking {label.toLowerCase()} match
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!predictSubmitting && predictResult && (
              <div className="mt-1">
                <div className="flex flex-col items-center justify-center gap-1 rounded-md bg-gray-50 px-4 py-4">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{isHotlistFeed ? 'Match score' : 'Submission acceptance score'}</span>
                  <div className={`text-4xl font-bold ${predictResult.verdictClass}`}>{predictResult.score}%</div>
                  <div className={`text-xs font-semibold leading-snug ${predictResult.verdictClass}`}>{predictResult.verdict}</div>
                </div>
                <div className="mt-3 space-y-1.5">
                  {predictResult.categories.map((category) => (
                    <div key={category.label} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-500">{category.label}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className={`h-full rounded-full ${category.earned === category.max ? 'bg-emerald-500' : category.earned === 0 ? 'bg-red-400' : 'bg-amber-400'}`}
                          style={{ width: `${(category.earned / category.max) * 100}%` }}
                        />
                      </div>
                      <span className="w-24 shrink-0 truncate text-right text-[10px] text-gray-500" title={category.note}>{category.note}</span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleRunAnotherPrediction}
                  className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-gray-200 px-4 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  {isHotlistFeed ? 'Try another job' : 'Try another candidate'}
                </button>
              </div>
            )}
          </div>
        </div>
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
              <span className="text-xs font-bold uppercase tracking-wide text-gray-500">{isHotlistFeed ? `Match ${bulkPredictLeadIds.size} consultants` : `Predict ${bulkPredictLeadIds.size} jobs`}</span>
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
                    placeholder={isHotlistFeed ? "Paste the job details or requirements here — we'll match all selected consultants against it..." : "Paste consultant resume, skills, or a quick summary here — we'll run it against all selected jobs..."}
                    className="w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-xs leading-relaxed text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleRunBulkPredict()}
                  disabled={!bulkPredictInput.trim()}
                  className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 text-sm font-bold uppercase tracking-wide text-orange-600 transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40 dark:text-orange-400"
                >
                  <Gauge size={16} strokeWidth={2.5} />
                  {isHotlistFeed
                    ? `Match Score for ${bulkPredictLeadIds.size} Consultants ($${(bulkPredictLeadIds.size * PREDICT_COST).toFixed(2)})`
                    : `Predict ${bulkPredictLeadIds.size} Jobs ($${(bulkPredictLeadIds.size * PREDICT_COST).toFixed(2)})`}
                </button>
              </>
            ) : (
              <div className="mt-2 py-4">
                <p className="text-center text-xs font-semibold text-gray-500">
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

      {selectedLead && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-3" onClick={() => setSelectedLead(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-4 sm:p-3 shadow-xl max-h-[85vh] overflow-y-auto"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">{selectedLead.title}</p>
                {selectedLead.company && <p className="text-[12px] text-gray-600">{[selectedLead.company, selectedLead.location].filter(Boolean).join(' • ')}</p>}
                <p className="mt-0.5 text-[11px] text-gray-500">{maskPosterName(selectedLead.posterName)} • {feedTimeBasis === 'created' ? 'Added' : 'Posted'} {formatAgo(feedTimeBasis === 'created' ? selectedLead.createdAt : selectedLead.postedAt)}</p>
              </div>
              <button
                onClick={() => setSelectedLead(null)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            {showBreakdown && (
              <div className="mb-3 overflow-hidden rounded-md border border-slate-700/70 bg-white dark:bg-slate-950/40">
                {(() => {
                  const breakdownItems = orderPulseBreakdownItems(buildScoreBreakdownDisplayItems(
                    selectedLead.scoreBreakdown as Record<string, number | { score: number; candidate_value: string; job_value: string; rule: string }> | undefined,
                    undefined,
                    {
                      employment_type: selectedLead.employmentType || null,
                      work_type: null,
                    },
                  ).filter((item) => !isRoleLikeBreakdownKey(item.key)));

                  if (breakdownItems.length === 0) {
                    return (
                      <div className="px-3 py-2 text-[11px] text-gray-500">
                        No job match rule breakdown available for this lead.
                      </div>
                    );
                  }

                  return (
                    <div className="max-h-52 overflow-y-auto">
                      <table className="min-w-full border-collapse text-left text-[11px]">
                        <tbody>
                          {breakdownItems.map((item) => (
                            <tr key={item.key}>
                              <td className="border-b border-slate-700/70 px-2 py-1.5 font-semibold text-gray-900 dark:border-slate-700/70 dark:text-gray-100">{formatBreakdownFieldName(item.key)}</td>
                              <td className="border-b border-slate-700/70 px-2 py-1.5 text-gray-700 dark:border-slate-700/70 dark:text-gray-300">{item.detail?.candidate_value || <PersonaMissingTag />}</td>
                              <td className="border-b border-slate-700/70 px-2 py-1.5 text-gray-700 dark:border-slate-700/70 dark:text-gray-300">{item.detail?.job_value || <PersonaMissingTag />}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Action buttons — thumb-zone friendly on mobile */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">

              <button
                onClick={() => {
                  setGeneratedEmailDrafts({
                    pitching: generateEmailDraft(selectedLead),
                    requestDetails: generateRequestDetailsEmailDraft(selectedLead),
                  });
                  setSelectedEmailDraftTab('pitching');
                  setShowGeneratedEmailDraft(true);
                }}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-3 sm:py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                <Sparkles size={14} />
                Generate Email
              </button>

              <button
                onClick={() => void copyText(selectedLead.posterEmail, isHotlistFeed ? 'Bench Sales Recruiter email' : 'Vendor email')}
                disabled={!revealedLeadIds.has(selectedLead.id) || !selectedLead.posterEmail}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-300 bg-blue-600 px-3 py-3 sm:py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-200 disabled:text-gray-500"
              >
                <Mail size={14} />
                Copy Email ID
              </button>

            </div>

            {showGeneratedEmailDraft && (
              <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedEmailDraftTab('pitching')}
                      className={`rounded px-2 py-1 text-[10px] font-semibold transition ${selectedEmailDraftTab === 'pitching' ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
                    >
                      Pitching Email
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedEmailDraftTab('requestDetails')}
                      className={`rounded px-2 py-1 text-[10px] font-semibold transition ${selectedEmailDraftTab === 'requestDetails' ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
                    >
                      Request Details
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyText(
                      selectedEmailDraftTab === 'pitching' ? generatedEmailDrafts.pitching : generatedEmailDrafts.requestDetails,
                      selectedEmailDraftTab === 'pitching' ? 'Pitching email draft' : 'Request details email draft',
                    )}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Copy Draft
                  </button>
                </div>
                <textarea
                  value={selectedEmailDraftTab === 'pitching' ? generatedEmailDrafts.pitching : generatedEmailDrafts.requestDetails}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setGeneratedEmailDrafts((prev) => (
                      selectedEmailDraftTab === 'pitching'
                        ? { ...prev, pitching: nextValue }
                        : { ...prev, requestDetails: nextValue }
                    ));
                  }}
                  className="h-48 w-full resize-y rounded-md border border-gray-300 bg-white p-2 text-[11px] leading-relaxed text-gray-700 outline-none focus:border-blue-500"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {showGmailConnectPrompt && (
        <GmailConnectPrompt
          connecting={connectingGmail}
          onClose={() => setShowGmailConnectPrompt(false)}
          onConnect={() => void connectGmail()}
        />
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
              <h2 id="post-content-preview-title" className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{postContentPreview.title}</h2>
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
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-700">{postContentPreview.content}</p>
            </div>
          </div>
        </div>
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
