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
  Handshake,
  Hash,
  Mail,
  MessageSquare,
  Percent,
  Phone,
  Radar,
  RefreshCw,
  Search,
  Send,
  Shield,
  CheckSquare,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Server,
  Sparkles,
  Target,
  GraduationCap,
  Flame,
  Workflow,
  User,
  UserRound,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { HOTLIST_AI_SUGGESTIONS } from '../lib/hotlist-ai-suggestions';
import { buildScoreBreakdownDisplayItems } from '../lib/radar-match-ui';
import { matchesPulseFeedSearch, type PulseFeedSearchScope } from '../lib/pulse-feed-search';

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
};

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

type ProfileStats = {
  uniqueCompanies: number;
  uniqueVendors: number;
  uniqueHotlists: number;
  uniqueJobs: number;
  avgRate: number | null;
  avgMatchScore: number | null;
};

type PulseDirectorySnapshot = {
  cachedAt: number;
  rangeId: ProfileRangeOption['id'];
  leaderboard: PulsePersona[];
  stats: Record<string, ProfileStats>;
};

type PulseDashboardUserRow = {
  user_id: string;
  display_name: string;
  submissions_today: number;
  jobs_submitted_today: number;
  avg_prediction_score_today: number;
  predictions_made_today: number;
  replies_today: number;
};
type PulseDashboardStats = {
  submissions_today: number;
  avg_prediction_score_today: number;
  predictions_made_today: number;
  replies_today: number;
  total_vendors_today: number;
  by_user: PulseDashboardUserRow[];
};

type PulseDirectoryReadModelRow = {
  target_role: string;
  summary: string;
  active_watchers: number;
  avatar_url: string | null;
  rank: number;
  min_years_exp: number | null;
  max_years_exp: number | null;
  visa_status: string | null;
  employment_type: string | null;
  work_type: string | null;
  preferred_locations: string | null;
  min_rate_usd_per_hr: number | null;
  max_rate_usd_per_hr: number | null;
  priority_skills: string | null;
  relocation_open: boolean | null;
  unique_hotlists: number;
  unique_jobs: number;
  unique_vendors: number;
  avg_rate: number | null;
  refreshed_at: string;
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

type MatchesTabId = 'all' | 'breakdown' | 'revealed' | 'queued';
type LeadActionType = 'revealed' | 'breakdown';

type DomainLeaderboardRow = {
  id: string;
  label: string;
  icon: LucideIcon;
  rank: number;
  uniqueHotlists: number;
  uniqueJobs: number;
  uniqueVendors: number;
};

type PulseLeadActionRow = {
  lead_id: string;
  action_type: LeadActionType;
};

type PulseFeedCacheWorkerResponse = {
  rows: PulseSocialFeedRpcRow[];
  cached?: boolean;
  cacheKey?: string;
  rangeHours?: number;
  rowCount?: number;
  refreshedAt?: string;
};

const LEADERBOARD_RPC_LIMIT = 500;
const FEED_WINDOW_HOURS = 48;
const PULSE_ROWS_CACHE_TTL_MS = 30_000;
const PULSE_DIRECTORY_CACHE_KEY = 'profilepush:pulse-directory:v2:30d';
const PULSE_DIRECTORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PULSE_CACHE_WORKER_URL = (import.meta.env.VITE_PULSE_CACHE_WORKER_URL ?? '').trim();
const PULSE_CACHE_WORKER_TOKEN = (import.meta.env.VITE_PULSE_CACHE_WORKER_TOKEN ?? '').trim();
const MOBILE_ROLES_BATCH_SIZE = 30;
const MATCHES_PAGE_SIZE = 5;

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

function readPulseDirectorySnapshot(): PulseDirectorySnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const snapshot = JSON.parse(window.localStorage.getItem(PULSE_DIRECTORY_CACHE_KEY) ?? '') as PulseDirectorySnapshot;
    if (snapshot.rangeId !== '30d' || !Array.isArray(snapshot.leaderboard) || !snapshot.stats || typeof snapshot.cachedAt !== 'number') {
      return null;
    }
    return snapshot;
  } catch {
    return null;
  }
}

function writePulseDirectorySnapshot(leaderboard: PulsePersona[], stats: Record<string, ProfileStats>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PULSE_DIRECTORY_CACHE_KEY, JSON.stringify({
      cachedAt: Date.now(),
      rangeId: '30d',
      leaderboard,
      stats,
    } satisfies PulseDirectorySnapshot));
  } catch {
    // Cache storage is best-effort.
  }
}

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

function getBreakdownCandidateValue(
  breakdown: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = breakdown?.[key];
  if (!value || typeof value !== 'object') return '';

  const detail = value as BreakdownDetail;
  return (detail.candidate_value ?? '').trim();
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

function isPersonaInCategory(persona: PulsePersona, categoryId: string) {
  if (categoryId === 'all') return true;
  return inferRoleCategoryId(persona.target_role) === categoryId;
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

function maskName(name: string) {
  const trimmed = (name ?? '').trim();
  return trimmed ? `${trimmed.slice(0, 3)}***` : 'Hidden';
}

function maskPosterName(name: string) {
  const trimmed = (name ?? '').trim();
  return trimmed ? `Posted by ${maskName(trimmed)}` : 'Posted by hidden';
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


export default function ProfilesPage() {
  const { account, user, refreshAccount } = useAuth();
  const navigate = useNavigate();
  const [initialDirectorySnapshot] = useState(readPulseDirectorySnapshot);

  const [loading, setLoading] = useState(!initialDirectorySnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [activatingRole, setActivatingRole] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<PulsePersona[]>(initialDirectorySnapshot?.leaderboard ?? []);
  const [watchingRoles, setWatchingRoles] = useState<Set<string>>(new Set());
  const [activePersona, setActivePersona] = useState<PulsePersona | null>(null);
  const [feed, setFeed] = useState<SocialLead[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [lastMatchAt, setLastMatchAt] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<'board' | 'feed'>((searchParams.get('view') === 'feed') ? 'feed' : 'board');

  // Sync view state when URL search params change (e.g. bottom nav tap)
  useEffect(() => {
    setView(searchParams.get('view') === 'feed' ? 'feed' : 'board');
  }, [searchParams]);

  const [profileRangeId, setProfileRangeId] = useState<ProfileRangeOption['id']>('30d');
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [selectedTechStacks, setSelectedTechStacks] = useState<string[]>([]);
  const [isRangeMenuOpen, setIsRangeMenuOpen] = useState(false);
  const [profileSearchQuery, setProfileSearchQuery] = useState('');
  const [pendingProfileSearchQuery, setPendingProfileSearchQuery] = useState('');
  const [feedSearchQuery, setFeedSearchQuery] = useState('');
  const [feedSearchScope, setFeedSearchScope] = useState<PulseFeedSearchScope>('all');
  const [mobileVisibleRolesCount, setMobileVisibleRolesCount] = useState(MOBILE_ROLES_BATCH_SIZE);
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 639px)').matches;
  });
  const [dashboardStats, setDashboardStats] = useState<PulseDashboardStats | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const profileListScrollRef = useRef<HTMLDivElement | null>(null);
  const [profileStatsLoading, setProfileStatsLoading] = useState(false);
  const [profileStatsByRole, setProfileStatsByRole] = useState<Record<string, ProfileStats>>(initialDirectorySnapshot?.stats ?? {});
  const [directoryCachedAt, setDirectoryCachedAt] = useState<number | null>(initialDirectorySnapshot?.cachedAt ?? null);
  const [expandedMobileProfileCardIds, setExpandedMobileProfileCardIds] = useState<Set<string>>(new Set());
  const [selectedLead, setSelectedLead] = useState<SocialLead | null>(null);
  const [generatedEmailDraft, setGeneratedEmailDraft] = useState('');
  const [showGeneratedEmailDraft, setShowGeneratedEmailDraft] = useState(false);
  const [expandedInlineBreakdownLeadIds, setExpandedInlineBreakdownLeadIds] = useState<Set<string>>(new Set());
  const [selectedMatchesTab, setSelectedMatchesTab] = useState<MatchesTabId>('queued');
  const [visibleMatchesCount, setVisibleMatchesCount] = useState(MATCHES_PAGE_SIZE);
  const [desktopRecentVisibleCount, setDesktopRecentVisibleCount] = useState(MATCHES_PAGE_SIZE);
  const [desktopRevealedVisibleCount, setDesktopRevealedVisibleCount] = useState(MATCHES_PAGE_SIZE);
  const [revealedLeadIds, setRevealedLeadIds] = useState<Set<string>>(new Set());
  const [breakdownChargedLeadIds, setBreakdownChargedLeadIds] = useState<Set<string>>(new Set());
  const [queuedLeadIds, setQueuedLeadIds] = useState<Set<string>>(new Set());
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [processingLeadId, setProcessingLeadId] = useState<string | null>(null);
  const [processingBreakdownLeadId, setProcessingBreakdownLeadId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isMobileTopCollapsed, setIsMobileTopCollapsed] = useState(false);
  const mobileRightPaneLastScrollTopRef = useRef(0);
  const mobileTopCollapsedRef = useRef(false);
  const mobileScrollUpAccumRef = useRef(0);
  const mobileScrollDownAccumRef = useRef(0);
  const mobileCollapseLockUntilRef = useRef(0);
  const pulseRowsCacheRef = useRef<PulseSocialFeedRpcRow[] | null>(null);
  const pulseRowsCacheAtRef = useRef(0);
  const pulseRowsCacheRangeHoursRef = useRef<number | null>(null);
  const rangeMenuRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  const REVEAL_CONTACT_COST = 0.25;
  const BREAKDOWN_COST = 0.1;

  const sortedLeaderboard = useMemo(() => {
    return [...leaderboard]
      .sort((a, b) => b.active_watchers - a.active_watchers || a.target_role.localeCompare(b.target_role))
      .map((item, idx) => ({ ...item, rank: idx + 1 }));
  }, [leaderboard]);

  const selectedProfileRange = useMemo(
    () => PROFILE_RANGE_OPTIONS.find((item) => item.id === profileRangeId) ?? PROFILE_RANGE_OPTIONS[2],
    [profileRangeId],
  );

  const applyProfileSearch = useCallback(() => {
    setProfileSearchQuery(pendingProfileSearchQuery);
  }, [pendingProfileSearchQuery]);

  const refreshDashboardStats = useCallback(async () => {
    if (!account?.id) return;
    setDashboardLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_pulse_dashboard_stats', { p_account_id: account.id });
      if (error) throw error;
      setDashboardStats(data as PulseDashboardStats);
    } catch (error) {
      console.error('Could not load Pulse dashboard stats', error);
    } finally {
      setDashboardLoading(false);
    }
  }, [account?.id]);

  useEffect(() => {
    void refreshDashboardStats();
  }, [refreshDashboardStats]);

  useEffect(() => {
    setPendingProfileSearchQuery(profileSearchQuery);
  }, [profileSearchQuery]);

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

  const zeroStats: ProfileStats = useMemo(() => ({
    uniqueCompanies: 0,
    uniqueVendors: 0,
    uniqueHotlists: 0,
    uniqueJobs: 0,
    avgRate: null,
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
    const result = query
      ? techFiltered.filter((item) => {
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
        })
      : techFiltered;
    // Re-rank from 1 after filtering so cards always show sequential ranks.
    return result.map((item, idx) => ({ ...item, rank: idx + 1 }));
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

  const filteredDomainLeaderboard = useMemo(() => {
    const query = normalize(profileSearchQuery);

    const rows = PROFILE_CATEGORY_TABS
      .filter((category) => category.id !== 'all')
      .map((category) => {
        const categoryProfiles = jobsRankedLeaderboard.filter((persona) => isPersonaInCategory(persona, category.id));
        const uniqueHotlists = categoryProfiles.reduce((sum, persona) => sum + (profileStatsByRole[normalize(persona.target_role)]?.uniqueHotlists ?? 0), 0);
        const uniqueJobs = categoryProfiles.reduce((sum, persona) => sum + (profileStatsByRole[normalize(persona.target_role)]?.uniqueJobs ?? 0), 0);
        const uniqueVendors = categoryProfiles.reduce((sum, persona) => sum + (profileStatsByRole[normalize(persona.target_role)]?.uniqueVendors ?? 0), 0);
        return {
          id: category.id,
          label: category.label,
          icon: category.icon,
          rank: 0,
          uniqueHotlists,
          uniqueJobs,
          uniqueVendors,
        } as DomainLeaderboardRow;
      })
      .sort((a, b) => b.uniqueJobs - a.uniqueJobs || b.uniqueVendors - a.uniqueVendors || a.label.localeCompare(b.label));

    const filtered = query
      ? rows.filter((row) => normalize(row.label).includes(query))
      : rows;

    return filtered.map((row, idx) => ({ ...row, rank: idx + 1 }));
  }, [jobsRankedLeaderboard, profileSearchQuery, profileStatsByRole]);

  const domainsForActiveView = useMemo(() => filteredDomainLeaderboard, [filteredDomainLeaderboard]);

  const mobileVisibleRoles = useMemo(
    () => filteredJobsRankedLeaderboard.slice(0, mobileVisibleRolesCount),
    [filteredJobsRankedLeaderboard, mobileVisibleRolesCount],
  );

  const scopedFeed = useMemo(() => {
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

    if (feedSearchQuery.trim()) {
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
      }, feedSearchQuery, feedSearchScope));
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
  }, [activePersona, feed, feedSearchQuery, feedSearchScope, selectedCategoryId, selectedTechStacks]);

  const dedupedScopedFeed = useMemo(() => {
    const byKey = new Map<string, SocialLead>();

    for (const lead of scopedFeed) {
      const key = buildPulseLeadDedupKey(lead);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, lead);
        continue;
      }

      const existingTs = new Date(existing.postedAt).getTime();
      const nextTs = new Date(lead.postedAt).getTime();
      if (nextTs > existingTs) {
        byKey.set(key, lead);
      }
    }

    return Array.from(byKey.values());
  }, [scopedFeed]);

  const recentVisibleFeed = useMemo(
    () => dedupedScopedFeed.filter((lead) => !revealedLeadIds.has(lead.id)),
    [dedupedScopedFeed, revealedLeadIds],
  );

  const revealedVisibleFeed = useMemo(
    () => dedupedScopedFeed.filter((lead) => revealedLeadIds.has(lead.id)),
    [dedupedScopedFeed, revealedLeadIds],
  );

  const matchesTabCounts = useMemo(() => ({
    all: dedupedScopedFeed.length,
    breakdown: dedupedScopedFeed.filter((lead) => breakdownChargedLeadIds.has(lead.id)).length,
    revealed: revealedVisibleFeed.length,
    queued: recentVisibleFeed.length,
  }), [breakdownChargedLeadIds, dedupedScopedFeed, recentVisibleFeed.length, revealedVisibleFeed.length]);

  const filteredFeed = useMemo(() => {
    if (selectedMatchesTab === 'breakdown') {
      return dedupedScopedFeed.filter((lead) => breakdownChargedLeadIds.has(lead.id));
    }
    if (selectedMatchesTab === 'revealed') {
      return revealedVisibleFeed;
    }
    if (selectedMatchesTab === 'queued') {
      return recentVisibleFeed;
    }
    return dedupedScopedFeed;
  }, [breakdownChargedLeadIds, dedupedScopedFeed, recentVisibleFeed, revealedVisibleFeed, selectedMatchesTab]);

  const visibleFeed = useMemo(() => filteredFeed.slice(0, visibleMatchesCount), [filteredFeed, visibleMatchesCount]);
  const canLoadMoreMatches = visibleMatchesCount < filteredFeed.length;

  const visibleDesktopRecentFeed = useMemo(
    () => recentVisibleFeed.slice(0, desktopRecentVisibleCount),
    [desktopRecentVisibleCount, recentVisibleFeed],
  );
  const visibleDesktopRevealedFeed = useMemo(
    () => revealedVisibleFeed.slice(0, desktopRevealedVisibleCount),
    [desktopRevealedVisibleCount, revealedVisibleFeed],
  );
  const canLoadMoreDesktopRecent = desktopRecentVisibleCount < recentVisibleFeed.length;
  const canLoadMoreDesktopRevealed = desktopRevealedVisibleCount < revealedVisibleFeed.length;

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
      setDesktopRecentVisibleCount((prev) => Math.min(recentVisibleFeed.length, prev + MATCHES_PAGE_SIZE));
    });
  }, [canLoadMoreDesktopRecent, maybeLoadMoreMatches, recentVisibleFeed.length]);

  const handleDesktopRevealedScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    maybeLoadMoreMatches(event.currentTarget, canLoadMoreDesktopRevealed, () => {
      setDesktopRevealedVisibleCount((prev) => Math.min(revealedVisibleFeed.length, prev + MATCHES_PAGE_SIZE));
    });
  }, [canLoadMoreDesktopRevealed, maybeLoadMoreMatches, revealedVisibleFeed.length]);

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

  function getMetricHeatmapColor(value: number, maxValue: number) {
    if (value <= 0 || maxValue <= 0) return undefined;
    const palette = ['#C084FC', '#FB7185', '#FB923C', '#FACC15', '#38BDF8', '#34D399'];
    const paletteIndex = Math.min(palette.length - 1, Math.ceil((value / maxValue) * palette.length) - 1);
    return palette[Math.max(0, paletteIndex)];
  }

  const renderProfilesTable = (
    profiles: PulsePersona[],
    emptyMessage: string,
    keyPrefix: string,
    onScroll?: React.UIEventHandler<HTMLDivElement>,
  ) => {
    if (profiles.length === 0) {
      return <div className="px-3 py-6 text-center text-xs text-gray-400">{emptyMessage}</div>;
    }

    const compact = isMobileViewport;
    const visibleStats = profiles.map((persona) => profileStatsByRole[normalize(persona.target_role)] ?? zeroStats);
    const maxRates = Math.max(0, ...visibleStats.map((stats) => stats.avgRate ?? 0));
    const maxHotlists = Math.max(0, ...visibleStats.map((stats) => stats.uniqueHotlists));
    const maxJobs = Math.max(0, ...visibleStats.map((stats) => stats.uniqueJobs));
    const maxVendors = Math.max(0, ...visibleStats.map((stats) => stats.uniqueVendors));

    return (
      <div className={`${compact ? 'min-h-0 flex-1' : 'h-full min-h-0'} flex w-full min-w-0 flex-col overflow-hidden rounded-md border border-gray-200 bg-white`}>
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable] slim-scrollbar" onScroll={onScroll}>
          <table className={`w-full max-w-full table-fixed border-collapse text-left text-[9px] sm:text-[10px] ${compact ? '[&_th]:!border-b-0 [&_td]:!border-b-0' : ''}`}>
            <thead>
              <tr>
                <th className={`sticky top-0 z-20 border-b border-gray-200 bg-[#F3F4F6] dark:bg-[#171A1F] font-semibold uppercase tracking-wide text-gray-500 ${compact ? 'w-[39%] px-1.5 py-1' : 'w-[46%] px-2 py-1.5'}`}>
                  Role
                </th>
                <th className={`sticky top-0 z-20 border-b border-gray-200 bg-[#F3F4F6] dark:bg-[#171A1F] text-center font-semibold uppercase tracking-wide text-gray-500 ${compact ? 'w-[13%] px-0.5 py-1' : 'w-[12%] px-1 py-1.5'}`}>
                  {compact ? <><DollarSign size={11} className="mx-auto" aria-hidden="true" /><span className="sr-only">Average rate</span></> : 'Rate'}
                </th>
                <th className={`sticky top-0 z-20 border-b border-gray-200 bg-[#F3F4F6] dark:bg-[#171A1F] text-center font-semibold uppercase tracking-wide text-gray-500 ${compact ? 'w-[16%] px-0.5 py-1' : 'w-[13%] px-1 py-1.5'}`}>
                  {compact ? <><UserRound size={11} className="mx-auto" aria-hidden="true" /><span className="sr-only">Hotlist</span></> : 'Hotlist'}
                </th>
                <th className={`sticky top-0 z-20 border-b border-gray-200 bg-[#F3F4F6] dark:bg-[#171A1F] text-center font-semibold uppercase tracking-wide text-gray-500 ${compact ? 'w-[12%] px-0.5 py-1' : 'w-[11%] px-1 py-1.5'}`}>
                  {compact ? <><Briefcase size={11} className="mx-auto" aria-hidden="true" /><span className="sr-only">Jobs</span></> : 'Jobs'}
                </th>
                <th className={`sticky top-0 z-20 border-b border-gray-200 bg-[#F3F4F6] dark:bg-[#171A1F] text-center font-semibold uppercase tracking-wide text-gray-500 ${compact ? 'w-[20%] pl-0.5 pr-2 py-1' : 'w-[18%] px-2 py-1.5'}`}>
                  {compact ? <><Handshake size={12} className="mx-auto" aria-hidden="true" /><span className="sr-only">Vendors</span></> : 'Vendors'}
                </th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((persona) => {
                const isSelected = normalize(activePersona?.target_role) === normalize(persona.target_role);
                const stats = profileStatsByRole[normalize(persona.target_role)] ?? zeroStats;

                return (
                  <tr
                    key={`${keyPrefix}-${persona.target_role}`}
                    onClick={() => openJobsForRole(persona.target_role)}
                    className={`cursor-pointer ${isSelected ? 'bg-blue-50/50' : 'bg-white'} hover:bg-gray-50`}
                  >
                    <td className={`border-b border-gray-100 font-semibold leading-tight text-blue-700 dark:text-white break-words whitespace-normal ${compact ? 'px-1.5 py-1' : 'px-2 py-1.5'}`} title={persona.target_role}>
                      <span className="inline-flex w-full items-center justify-between gap-1.5">
                        <span className="min-w-0 break-words whitespace-normal">{persona.target_role}</span>
                        <ChevronRight size={compact ? 11 : 12} className="shrink-0 text-[#6B7280]" aria-hidden="true" />
                      </span>
                    </td>
                    <td className={`border-b border-gray-100 text-center font-semibold text-gray-700 ${compact ? 'px-0.5 py-1' : 'px-1 py-1.5'}`}>
                      <span
                        style={{ color: getMetricHeatmapColor(stats.avgRate ?? 0, maxRates) }}
                        title={stats.avgRate != null ? `Average $${Math.round(stats.avgRate)}/hr` : 'No rate available'}
                      >
                        {stats.avgRate != null ? `$${Math.round(stats.avgRate)}` : '-'}
                      </span>
                    </td>
                    <td className={`border-b border-gray-100 text-center font-semibold text-gray-700 ${compact ? 'px-1 py-1' : 'px-2 py-1.5'}`}>
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); openHotlistForRole(persona.target_role); }}
                        className="w-full hover:underline"
                        style={{ color: getMetricHeatmapColor(stats.uniqueHotlists, maxHotlists) }}
                        aria-label={`Open ${stats.uniqueHotlists} Hotlist candidates for ${persona.target_role}`}
                      >
                        {stats.uniqueHotlists}
                      </button>
                    </td>
                    <td className={`border-b border-gray-100 text-center font-semibold text-gray-700 ${compact ? 'px-1 py-1' : 'px-2 py-1.5'}`}>
                      <span style={{ color: getMetricHeatmapColor(stats.uniqueJobs, maxJobs) }}>{stats.uniqueJobs}</span>
                    </td>
                    <td className={`border-b border-gray-100 text-center font-semibold text-gray-700 ${compact ? 'pl-0.5 pr-2 py-1' : 'px-2 py-1.5'}`}>
                      <span style={{ color: getMetricHeatmapColor(stats.uniqueVendors, maxVendors) }}>{stats.uniqueVendors}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderUsersTable = () => {
    const byUser = dashboardStats?.by_user ?? [];
    if (byUser.length === 0) {
      return <div className="px-3 py-6 text-center text-xs text-gray-400">No user activity yet today.</div>;
    }

    return (
      <div className="h-full min-h-0 flex w-full min-w-0 flex-col overflow-hidden rounded-md border border-gray-200 bg-white dark:border-white/10 dark:bg-[#171A1F]">
        <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain [scrollbar-gutter:stable] slim-scrollbar">
          <table className="w-max min-w-full table-auto border-collapse text-left text-[9px] sm:text-[10px]">
            <thead>
              <tr>
                <th className="sticky top-0 z-20 border-b border-gray-200 bg-[#F3F4F6] px-2 py-1.5 font-semibold uppercase tracking-wide text-gray-500 dark:border-white/10 dark:bg-[#1B1D21] dark:text-[#94A3B8]">User</th>
                <th className="sticky top-0 z-20 border-b border-gray-200 bg-[#F3F4F6] px-2 py-1.5 text-center font-semibold uppercase tracking-wide text-gray-500 dark:border-white/10 dark:bg-[#1B1D21] dark:text-[#94A3B8]">Subs</th>
                <th className="sticky top-0 z-20 border-b border-gray-200 bg-[#F3F4F6] px-2 py-1.5 text-center font-semibold uppercase tracking-wide text-gray-500 dark:border-white/10 dark:bg-[#1B1D21] dark:text-[#94A3B8]">Jobs</th>
                <th className="sticky top-0 z-20 border-b border-gray-200 bg-[#F3F4F6] px-2 py-1.5 text-center font-semibold uppercase tracking-wide text-gray-500 dark:border-white/10 dark:bg-[#1B1D21] dark:text-[#94A3B8]">Avg %</th>
                <th className="sticky top-0 z-20 border-b border-gray-200 bg-[#F3F4F6] px-2 py-1.5 text-center font-semibold uppercase tracking-wide text-gray-500 dark:border-white/10 dark:bg-[#1B1D21] dark:text-[#94A3B8]">Predicts</th>
                <th className="sticky top-0 z-20 border-b border-gray-200 bg-[#F3F4F6] px-2 py-1.5 text-center font-semibold uppercase tracking-wide text-gray-500 dark:border-white/10 dark:bg-[#1B1D21] dark:text-[#94A3B8]">Replies</th>
              </tr>
            </thead>
            <tbody>
              {byUser.map((row) => (
                <tr key={row.user_id}>
                  <td className="border-b border-gray-100 px-2 py-1.5 font-semibold text-gray-900 dark:border-white/10 dark:text-slate-100">{row.display_name}</td>
                  <td className="border-b border-gray-100 px-2 py-1.5 text-center text-gray-700 dark:border-white/10 dark:text-[#CBD5E1]">{row.submissions_today}</td>
                  <td className="border-b border-gray-100 px-2 py-1.5 text-center text-gray-700 dark:border-white/10 dark:text-[#CBD5E1]">{row.jobs_submitted_today}</td>
                  <td className="border-b border-gray-100 px-2 py-1.5 text-center text-gray-700 dark:border-white/10 dark:text-[#CBD5E1]">{row.avg_prediction_score_today}%</td>
                  <td className="border-b border-gray-100 px-2 py-1.5 text-center text-gray-700 dark:border-white/10 dark:text-[#CBD5E1]">{row.predictions_made_today}</td>
                  <td className="border-b border-gray-100 px-2 py-1.5 text-center text-gray-700 dark:border-white/10 dark:text-[#CBD5E1]">{row.replies_today}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderDomainsTable = (
    domains: DomainLeaderboardRow[],
    emptyMessage: string,
    keyPrefix: string,
    onScroll?: React.UIEventHandler<HTMLDivElement>,
  ) => {
    if (domains.length === 0) {
      return <div className="px-3 py-6 text-center text-xs text-gray-400">{emptyMessage}</div>;
    }

    const compact = isMobileViewport;
    const maxHotlists = Math.max(0, ...domains.map((domain) => domain.uniqueHotlists));
    const maxJobs = Math.max(0, ...domains.map((domain) => domain.uniqueJobs));
    const maxVendors = Math.max(0, ...domains.map((domain) => domain.uniqueVendors));

    return (
      <div className={`${compact ? 'h-[150px]' : 'h-full min-h-0'} flex w-full min-w-0 flex-col overflow-hidden rounded-md border border-gray-200 bg-white`}>
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-gutter:stable] slim-scrollbar" onScroll={onScroll}>
          <table className={`w-full max-w-full table-fixed border-collapse text-left text-[9px] sm:text-[10px] ${compact ? '[&_th]:!border-b-0 [&_td]:!border-b-0' : ''}`}>
            <thead>
              <tr>
                <th className={`sticky top-0 z-20 border-b border-gray-200 bg-[#F3F4F6] dark:bg-[#171A1F] font-semibold uppercase tracking-wide text-gray-500 ${compact ? 'w-[44%] px-1.5 py-1' : 'w-[50%] px-2 py-1.5'}`}>
                  Domain
                </th>
                <th className={`sticky top-0 z-20 border-b border-gray-200 bg-[#F3F4F6] dark:bg-[#171A1F] text-center font-semibold uppercase tracking-wide text-gray-500 ${compact ? 'w-[20%] px-0.5 py-1' : 'w-[16%] px-2 py-1.5'}`}>
                  {compact ? <><UserRound size={11} className="mx-auto" aria-hidden="true" /><span className="sr-only">Hotlist</span></> : 'Hotlist'}
                </th>
                <th className={`sticky top-0 z-20 border-b border-gray-200 bg-[#F3F4F6] dark:bg-[#171A1F] text-center font-semibold uppercase tracking-wide text-gray-500 ${compact ? 'w-[14%] px-0.5 py-1' : 'w-[16%] px-2 py-1.5'}`}>
                  {compact ? <><Briefcase size={11} className="mx-auto" aria-hidden="true" /><span className="sr-only">Jobs</span></> : 'Jobs'}
                </th>
                <th className={`sticky top-0 z-20 border-b border-gray-200 bg-[#F3F4F6] dark:bg-[#171A1F] text-center font-semibold uppercase tracking-wide text-gray-500 ${compact ? 'w-[22%] pl-0.5 pr-2 py-1' : 'w-[18%] px-2 py-1.5'}`}>
                  {compact ? <><Handshake size={12} className="mx-auto" aria-hidden="true" /><span className="sr-only">Vendors</span></> : 'Vendors'}
                </th>
              </tr>
            </thead>
            <tbody>
              {domains.map((domain) => {
                const DomainIcon = domain.icon;
                return (
                  <tr
                    key={`${keyPrefix}-${domain.id}`}
                    onClick={() => {
                      setSelectedCategoryId(domain.id);
                      setSelectedTechStacks([]);
                      setActivePersona(null);
                    }}
                    className="cursor-pointer bg-white hover:bg-gray-50"
                  >
                    <td className={`border-b border-gray-100 font-semibold leading-tight text-blue-700 dark:text-white break-words whitespace-normal ${compact ? 'px-1.5 py-1' : 'px-2 py-1.5'}`}>
                      <span className="inline-flex w-full items-center justify-between gap-1.5">
                        <span className="inline-flex min-w-0 items-center gap-1.5">
                          <DomainIcon size={compact ? 11 : 12} className="text-blue-600" />
                          <span className="min-w-0 break-words whitespace-normal">{domain.label}</span>
                        </span>
                        <ChevronRight size={compact ? 11 : 12} className="shrink-0 text-[#6B7280]" aria-hidden="true" />
                      </span>
                    </td>
                    <td className={`border-b border-gray-100 text-center font-semibold text-gray-700 ${compact ? 'px-1 py-1' : 'px-2 py-1.5'}`}>
                      <span style={{ color: getMetricHeatmapColor(domain.uniqueHotlists, maxHotlists) }}>{domain.uniqueHotlists}</span>
                    </td>
                    <td className={`border-b border-gray-100 text-center font-semibold text-gray-700 ${compact ? 'px-1 py-1' : 'px-2 py-1.5'}`}>
                      <span style={{ color: getMetricHeatmapColor(domain.uniqueJobs, maxJobs) }}>{domain.uniqueJobs}</span>
                    </td>
                    <td className={`border-b border-gray-100 text-center font-semibold text-gray-700 ${compact ? 'pl-0.5 pr-2 py-1' : 'px-2 py-1.5'}`}>
                      <span style={{ color: getMetricHeatmapColor(domain.uniqueVendors, maxVendors) }}>{domain.uniqueVendors}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderDomainCards = (domains: DomainLeaderboardRow[], keyPrefix: string) => {
    if (domains.length === 0) {
      return <div className="px-3 py-8 text-center text-xs text-gray-400">No domains found.</div>;
    }

    const maxHotlists = Math.max(0, ...domains.map((domain) => domain.uniqueHotlists));
    const maxJobs = Math.max(0, ...domains.map((domain) => domain.uniqueJobs));
    const maxVendors = Math.max(0, ...domains.map((domain) => domain.uniqueVendors));

    return domains.map((domain) => {
      const DomainIcon = domain.icon;
      return (
        <div
          key={`${keyPrefix}-${domain.id}`}
          className={`rounded-lg border px-3 py-2.5 transition-colors ${domain.rank <= 3 ? 'border-emerald-200 bg-emerald-50/75' : 'border-gray-200 bg-white'}`}
        >
          <div className="flex items-start gap-2">
            <span className={`mt-0.5 shrink-0 text-[9px] font-bold leading-none ${domain.rank <= 3 ? 'text-emerald-600' : 'text-gray-400'}`}>#{domain.rank}</span>
            <p className="flex-1 text-[11px] font-semibold text-blue-700 leading-snug inline-flex items-center gap-1.5">
              <DomainIcon size={13} className="text-blue-600" />
              <span>{domain.label}</span>
            </p>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-1 text-[9px] font-bold text-gray-700"><span style={{ color: getMetricHeatmapColor(domain.uniqueHotlists, maxHotlists) }}>{domain.uniqueHotlists}</span> Hotlist</span>
            <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-1 text-[9px] font-bold text-gray-700"><span style={{ color: getMetricHeatmapColor(domain.uniqueJobs, maxJobs) }}>{domain.uniqueJobs}</span> Jobs</span>
            <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-1 text-[9px] font-bold text-gray-700"><span style={{ color: getMetricHeatmapColor(domain.uniqueVendors, maxVendors) }}>{domain.uniqueVendors}</span> Vendors</span>
          </div>
        </div>
      );
    });
  };

  const renderLeadCards = (leads: SocialLead[]) => leads.map((lead) => {
    const leadScoreVisual = getScoreVisual(lead.matchScore);
    const inlineBreakdownItems = buildScoreBreakdownDisplayItems(
      lead.scoreBreakdown as Record<string, number | { score: number; candidate_value: string; job_value: string; rule: string }> | undefined,
    );
    const isInlineBreakdownExpanded = expandedInlineBreakdownLeadIds.has(lead.id);
    const experienceInlineItem = inlineBreakdownItems.find((item) => {
      const key = item.key.toLowerCase();
      return key.includes('experience') || key.includes('exp');
    });
    const visaInlineItem = inlineBreakdownItems.find((item) => {
      const key = item.key.toLowerCase();
      return key.includes('visa') || key.includes('authorization') || key.includes('work_auth');
    });
    const collapsedInlineBreakdownItems = [experienceInlineItem, visaInlineItem]
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .filter((item, idx, arr) => arr.findIndex((other) => other.key === item.key) === idx);

    if (collapsedInlineBreakdownItems.length < 2) {
      for (const item of inlineBreakdownItems) {
        if (collapsedInlineBreakdownItems.some((existing) => existing.key === item.key)) continue;
        collapsedInlineBreakdownItems.push(item);
        if (collapsedInlineBreakdownItems.length >= 2) break;
      }
    }

    const visibleInlineBreakdownItems = isInlineBreakdownExpanded
      ? inlineBreakdownItems
      : collapsedInlineBreakdownItems;
    const hasDetailsToggle = inlineBreakdownItems.length > 2;
    const maskedEmailHint = (() => {
      const email = (lead.posterEmail || '').trim();
      if (!email) return '***@';
      const localPart = email.split('@')[0] ?? '';
      const prefix = (localPart.slice(0, 3) || '***').replace(/\s+/g, '');
      return `${prefix}**@`;
    })();

    return (
      <div key={lead.id} className={`rounded-lg border px-3 py-2.5 ${leadScoreVisual.cardToneClass}`}>
        <div className="flex items-start justify-between gap-1.5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold leading-snug text-gray-900">{lead.title || 'Job Opportunity'}</p>
            {lead.company && (
              <div className="mt-0.5 text-[10px] text-gray-600">{lead.company}</div>
            )}
            <div className="mt-0.5 text-[10px] text-gray-500">
              <span>{revealedLeadIds.has(lead.id) ? lead.posterName : maskPosterName(lead.posterName)}</span>
              <span> • </span>
              <span>{lead.postedAgo}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-0.5">
            <div className="flex items-center gap-1.5">
              {leadScoreVisual.rounded !== null && (
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${leadScoreVisual.badgeClass}`}>{leadScoreVisual.rounded}%</span>
              )}
              {leadScoreVisual.isRecommended && <RecommendedBadge />}
            </div>
            {lead.platform && (
              <span className="text-[9px] font-bold uppercase tracking-wide text-gray-400">
                {lead.platform}
              </span>
            )}
          </div>
        </div>
        {inlineBreakdownItems.length > 0 && (
          <div className="mt-1.5 overflow-hidden rounded-md border border-gray-200">
            <div>
              <table className="w-full table-fixed border-collapse text-left text-[10px]">
                <thead className="bg-white">
                  <tr>
                    <th className="border-b border-gray-200 bg-white px-2 py-1 font-semibold uppercase tracking-wide text-gray-500">Rule</th>
                    <th className="border-b border-gray-200 bg-white px-2 py-1 font-semibold uppercase tracking-wide text-gray-500">Profile</th>
                    <th className="border-b border-gray-200 bg-white px-2 py-1 font-semibold uppercase tracking-wide text-gray-500">Job</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleInlineBreakdownItems.map((item) => (
                    <tr key={item.key}>
                      <td className="border-b border-gray-100 bg-white px-2 py-1 font-semibold text-gray-900 break-words whitespace-normal">{formatBreakdownFieldName(item.key)}</td>
                      <td className="border-b border-gray-100 bg-white px-2 py-1 text-gray-700 break-words whitespace-normal">{item.detail?.candidate_value || '-'}</td>
                      <td className="border-b border-gray-100 bg-white px-2 py-1 text-gray-700 break-words whitespace-normal">{item.detail?.job_value || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="mt-1.5 grid grid-cols-10 gap-1.5">
          {hasDetailsToggle && (
            <button
              type="button"
              onClick={() => {
                setExpandedInlineBreakdownLeadIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(lead.id)) {
                    next.delete(lead.id);
                  } else {
                    next.add(lead.id);
                  }
                  return next;
                });
              }}
              className="col-span-3 inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-2 py-1.5 text-[10px] font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              {isInlineBreakdownExpanded ? 'Hide Details' : 'Details'}
            </button>
          )}
          <button
            onClick={() => void handleOpenBreakdown(lead)}
            disabled={processingBreakdownLeadId === lead.id}
            className={`hidden items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-semibold transition disabled:opacity-60 ${breakdownChargedLeadIds.has(lead.id) ? 'border-gray-200 text-gray-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            {breakdownChargedLeadIds.has(lead.id) && <Check size={9} className="text-emerald-600" />}
            {processingBreakdownLeadId === lead.id ? '...' : 'Breakdown'}
          </button>
          {revealedLeadIds.has(lead.id) ? (
            <button
              onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(lead.posterEmail || ''); }}
              className={`${hasDetailsToggle ? 'col-span-7' : 'col-span-10'} inline-flex items-center justify-center gap-1 rounded-md border border-gray-200 bg-gray-100 px-2.5 py-1.5 text-[10px] font-semibold text-gray-600 transition hover:bg-gray-200`}
            >
              Email
            </button>
          ) : (
            <button
              onClick={() => void handleRevealContact(lead)}
              disabled={processingLeadId === lead.id}
              className={`${hasDetailsToggle ? 'col-span-7' : 'col-span-10'} inline-flex items-center justify-center gap-1 rounded-md border border-blue-600 bg-blue-600 px-2.5 py-1.5 text-[10px] font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60`}
            >
              {processingLeadId === lead.id ? '...' : `Reveal ${maskedEmailHint}`}
            </button>
          )}
        </div>
      </div>
    );
  });

  useEffect(() => {
    setMobileVisibleRolesCount(MOBILE_ROLES_BATCH_SIZE);
  }, [profileRangeId, profileSearchQuery, selectedCategoryId]);

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
      .select('lead_id, action_type')
      .eq('user_id', user.id)
      .in('action_type', ['revealed', 'breakdown']);

    if (error) {
      return;
    }

    const revealed = new Set<string>();
    const breakdown = new Set<string>();
    for (const row of (data ?? []) as PulseLeadActionRow[]) {
      if (row.action_type === 'revealed') revealed.add(row.lead_id);
      if (row.action_type === 'breakdown') breakdown.add(row.lead_id);
    }

    setRevealedLeadIds(revealed);
    setBreakdownChargedLeadIds(breakdown);
  }, [user?.id]);

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

  const loadDirectoryReadModel = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      const { error: refreshError } = await supabase.rpc(
        'refresh_pulse_directory_30d_snapshot' as never,
        { p_force: true } as never,
      );
      if (refreshError) return false;
    }

    const { data, error } = await supabase
      .from('pulse_directory_30d' as never)
      .select('target_role, summary, active_watchers, avatar_url, rank, min_years_exp, max_years_exp, visa_status, employment_type, work_type, preferred_locations, min_rate_usd_per_hr, max_rate_usd_per_hr, priority_skills, relocation_open, unique_hotlists, unique_jobs, unique_vendors, avg_rate, refreshed_at')
      .order('rank', { ascending: true });

    if (error || !Array.isArray(data) || data.length === 0) return false;

    const rows = data as unknown as PulseDirectoryReadModelRow[];
    const nextLeaderboard: PulsePersona[] = rows.map((row) => {
      const bucket = getPersonaBucket(row.target_role);
      return {
        target_role: row.target_role,
        summary: row.summary || bucket.summary,
        active_watchers: Number(row.active_watchers ?? 0),
        avatar_url: row.avatar_url,
        rank: Number(row.rank ?? 0),
        min_years_exp: row.min_years_exp,
        max_years_exp: row.max_years_exp,
        visa_status: row.visa_status,
        employment_type: row.employment_type,
        work_type: row.work_type,
        preferred_locations: row.preferred_locations,
        min_rate_usd_per_hr: row.min_rate_usd_per_hr,
        max_rate_usd_per_hr: row.max_rate_usd_per_hr,
        priority_skills: row.priority_skills,
        relocation_open: row.relocation_open ?? undefined,
      };
    });
    const nextStats = Object.fromEntries(rows.map((row) => [normalize(row.target_role), {
      uniqueCompanies: 0,
      uniqueVendors: Number(row.unique_vendors ?? 0),
      uniqueHotlists: Number(row.unique_hotlists ?? 0),
      uniqueJobs: Number(row.unique_jobs ?? 0),
      avgRate: row.avg_rate == null ? null : Number(row.avg_rate),
      avgMatchScore: null,
    }])) as Record<string, ProfileStats>;
    const refreshedAt = new Date(rows[0].refreshed_at).getTime();
    const cachedAt = Number.isFinite(refreshedAt) ? refreshedAt : Date.now();

    setLeaderboard(nextLeaderboard);
    setProfileStatsByRole(nextStats);
    setDirectoryCachedAt(cachedAt);
    writePulseDirectorySnapshot(nextLeaderboard, nextStats);
    return true;
  }, []);

  const loadInitial = useCallback(async () => {
    const hasFreshSnapshot = initialDirectorySnapshot
      && Date.now() - initialDirectorySnapshot.cachedAt <= PULSE_DIRECTORY_CACHE_TTL_MS;
    if (!hasFreshSnapshot) setLoading(true);

    const loadedReadModel = hasFreshSnapshot
      ? true
      : await loadDirectoryReadModel();
    await Promise.all([
      ...(!loadedReadModel ? [loadLeaderboard()] : []),
      loadWatchingRoles(),
      loadLeadActionState(),
    ]);

    if (loadedReadModel) {
      setLoading(false);
      return;
    }

    try {
      const { data: latestRows } = await supabase.rpc('get_pulse_social_feed', {
        p_since: '1970-01-01T00:00:00.000Z',
        p_limit: 1,
      } as never);
      const latest = (latestRows?.[0] as PulseSocialFeedRpcRow | undefined)?.match_created_at;
      if (latest) setLastMatchAt(latest);
    } catch {
      // Leave lastMatchAt unchanged on failure.
    }

    setLoading(false);
  }, [initialDirectorySnapshot, loadDirectoryReadModel, loadLeaderboard, loadWatchingRoles, loadLeadActionState]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadGlobalPulseRowsFromCacheWorker = useCallback(async (rangeHours: number) => {
    if (!PULSE_CACHE_WORKER_URL) return null;

    try {
      const url = new URL(PULSE_CACHE_WORKER_URL);
      url.searchParams.set('hours', String(rangeHours));
      url.searchParams.set('limit', '5000');

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

  const loadGlobalPulseRows = useCallback(async (rangeHours: number, forceRefresh = false) => {
    const now = Date.now();
    const hasFreshCache = pulseRowsCacheRef.current
      && pulseRowsCacheRangeHoursRef.current === rangeHours
      && (now - pulseRowsCacheAtRef.current) <= PULSE_ROWS_CACHE_TTL_MS;

    if (!forceRefresh && hasFreshCache) {
      return pulseRowsCacheRef.current;
    }

    if (!forceRefresh) {
      const workerRows = await loadGlobalPulseRowsFromCacheWorker(rangeHours);
      if (workerRows) {
        pulseRowsCacheRef.current = workerRows;
        pulseRowsCacheAtRef.current = Date.now();
        pulseRowsCacheRangeHoursRef.current = rangeHours;
        return workerRows;
      }
    }

    const since = new Date(Date.now() - (rangeHours * 60 * 60 * 1000)).toISOString();

    // Preferred path: global SECURITY DEFINER RPC (all-account feed).
    const rpcResult = await supabase.rpc('get_pulse_social_feed', {
      p_since: since,
      p_limit: 5000,
    } as never);
    if (!rpcResult.error) {
      const rows = (rpcResult.data ?? []) as PulseSocialFeedRpcRow[];
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

          const mergedRows = rows.map((row) => {
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

          pulseRowsCacheRef.current = mergedRows;
          pulseRowsCacheAtRef.current = Date.now();
          pulseRowsCacheRangeHoursRef.current = rangeHours;
          return mergedRows;
        }
      }
      pulseRowsCacheRef.current = rows;
      pulseRowsCacheAtRef.current = Date.now();
      pulseRowsCacheRangeHoursRef.current = rangeHours;
      return rows;
    }

    // Fallback path: direct table reads (subject to project RLS).
    const { data: matchData, error: matchError } = await supabase
      .from('radar_match_results')
      .select('profile_id, job_source, job_id, created_at, final_average_score, score_breakdown')
      .eq('job_source', 'social')
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

    const fallbackRows = latestMatches.map((match) => {
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

    pulseRowsCacheRef.current = fallbackRows;
    pulseRowsCacheAtRef.current = Date.now();
    pulseRowsCacheRangeHoursRef.current = rangeHours;
    return fallbackRows;
  }, [loadGlobalPulseRowsFromCacheWorker]);

  const loadProfileStats = useCallback(async (forceRefresh = false) => {
    if (sortedLeaderboard.length === 0) {
      setProfileStatsByRole({});
      return;
    }

    if (!forceRefresh && profileRangeId === '30d') {
      const snapshot = readPulseDirectorySnapshot();
      if (snapshot && Date.now() - snapshot.cachedAt <= PULSE_DIRECTORY_CACHE_TTL_MS) {
        setProfileStatsByRole(snapshot.stats);
        setDirectoryCachedAt(snapshot.cachedAt);
        return;
      }
    }

    setProfileStatsLoading(true);

    const targetRoles = sortedLeaderboard.map((p) => p.target_role);
    const since = new Date(Date.now() - (selectedProfileRange.hours * 60 * 60 * 1000)).toISOString();
    const commitStats = (stats: Record<string, ProfileStats>) => {
      setProfileStatsByRole(stats);
      if (profileRangeId === '30d') {
        writePulseDirectorySnapshot(leaderboard, stats);
        setDirectoryCachedAt(Date.now());
      }
    };

    const { data: hotlistData } = await supabase
      .from('radar_match_hotlist')
      .select('hotlist_id, role_title, core_skills, hourly_rate_min, hourly_rate_max')
      .gte('created_at', since)
      .limit(5000);
    const { data: radarData } = await supabase
      .from('radar_match_results')
      .select('job_id, job_source, role_title, core_skills, hourly_rate_min, hourly_rate_max')
      .eq('job_source', 'social')
      .gte('created_at', since)
      .limit(5000);
    const hotlistRows = (hotlistData ?? []) as Array<{
      hotlist_id: string;
      role_title: string;
      core_skills: string[] | null;
      hourly_rate_min: number | null;
      hourly_rate_max: number | null;
    }>;
    const radarRows = (radarData ?? []) as Array<{
      job_id: string;
      job_source: string;
      role_title: string;
      core_skills: string[] | null;
      hourly_rate_min: number | null;
      hourly_rate_max: number | null;
    }>;
    const hotlistCountsByRole = new Map<string, number>();
    const avgRatesByRole = new Map<string, number | null>();
    for (const persona of sortedLeaderboard) {
      const skills = getPersonaSkillList(persona.target_role, persona.priority_skills);
      const matchingHotlistRows = hotlistRows.filter((row) => roleMatchesPersona({
        job_title: row.role_title,
        extracted_role_normalized: row.role_title,
        extracted_skills: row.core_skills ?? [],
        post_content: '',
      } as SocialJobRow, persona.target_role, skills));
      const matchingRadarRows = radarRows.filter((row) => roleMatchesPersona({
        job_title: row.role_title,
        extracted_role_normalized: row.role_title,
        extracted_skills: row.core_skills ?? [],
        post_content: '',
      } as SocialJobRow, persona.target_role, skills));
      const uniqueHotlistRows = new Map(matchingHotlistRows.map((row) => [row.hotlist_id, row]));
      const uniqueRadarRows = new Map(matchingRadarRows.map((row) => [`${row.job_source}:${row.job_id}`, row]));
      const rates = [...uniqueHotlistRows.values(), ...uniqueRadarRows.values()].flatMap((row) => {
        const endpoints = [row.hourly_rate_min, row.hourly_rate_max]
          .filter((rate): rate is number => typeof rate === 'number' && Number.isFinite(rate) && rate > 0);
        return endpoints.length > 0
          ? [endpoints.reduce((sum, rate) => sum + rate, 0) / endpoints.length]
          : [];
      });
      const roleKey = normalize(persona.target_role);
      hotlistCountsByRole.set(roleKey, uniqueHotlistRows.size);
      avgRatesByRole.set(
        roleKey,
        rates.length > 0 ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : null,
      );
    }

    // Primary path: vector similarity via hotlist_ai_roles.role_embedding ↔ social_jobs.job_embedding.
    const { data: vectorData, error: vectorError } = await supabase.rpc(
      'get_profile_stats_by_vector',
      { p_target_roles: targetRoles, p_similarity_threshold: 0.65 } as never,
    );

    if (!vectorError && Array.isArray(vectorData) && vectorData.length > 0) {
      const stats: Record<string, ProfileStats> = Object.fromEntries(
        sortedLeaderboard.map((item) => [normalize(item.target_role), { ...zeroStats }]),
      );
      for (const row of vectorData as Array<{ target_role: string; job_count: number; vendor_count: number }>) {
        const key = normalize(row.target_role);
        if (stats[key]) {
          stats[key] = {
            uniqueCompanies: 0,
            uniqueVendors: row.vendor_count ?? 0,
            uniqueHotlists: hotlistCountsByRole.get(key) ?? 0,
            uniqueJobs: row.job_count ?? 0,
            avgRate: avgRatesByRole.get(key) ?? null,
            avgMatchScore: null,
          };
        }
      }
      commitStats(stats);
      setProfileStatsLoading(false);
      return;
    }

    // Fallback: text-based matching against the social feed.
    let rpcRows: PulseSocialFeedRpcRow[] = [];
    try {
      rpcRows = await loadGlobalPulseRows(selectedProfileRange.hours);
    } catch {
      showToast('Could not load profile stats', 'error');
      setProfileStatsLoading(false);
      return;
    }

    if (rpcRows.length === 0) {
      const emptyStats = Object.fromEntries(
        sortedLeaderboard.map((item) => [normalize(item.target_role), { ...zeroStats }]),
      ) as Record<string, ProfileStats>;
      commitStats(emptyStats);
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
        uniqueHotlists: hotlistCountsByRole.get(roleKey) ?? 0,
        uniqueJobs: jobs.size,
        avgRate: avgRatesByRole.get(roleKey) ?? null,
        avgMatchScore: matchScoreCount > 0 ? (matchScoreSum / matchScoreCount) : null,
      };
    }

    commitStats(stats);
    setProfileStatsLoading(false);
  }, [leaderboard, loadGlobalPulseRows, profileRangeId, selectedProfileRange.hours, showToast, sortedLeaderboard, zeroStats]);

  useEffect(() => {
    void loadProfileStats();
  }, [loadProfileStats]);

  const refreshDirectory = useCallback(async () => {
    setRefreshing(true);
    try {
      window.localStorage.removeItem(PULSE_DIRECTORY_CACHE_KEY);
      const loadedReadModel = await loadDirectoryReadModel(true);
      if (!loadedReadModel) await loadProfileStats(true);
      showToast('30-day Pulse numbers refreshed');
    } finally {
      setRefreshing(false);
    }
  }, [loadDirectoryReadModel, loadProfileStats, showToast]);

  const loadFeed = useCallback(async (_persona: PulsePersona | null, _personaFilters: PulsePersona[] = [], forceRefresh = false) => {
    setFeedLoading(true);
    let rpcRows: PulseSocialFeedRpcRow[] = [];
    try {
      rpcRows = await loadGlobalPulseRows(selectedProfileRange.hours, forceRefresh);
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

    const finalFiltered = socialData
      .filter((row) => newestMatchByJobId.has(row.id))
      .sort((a, b) => {
        const aMatchTs = new Date(newestMatchByJobId.get(a.id)?.created_at ?? 0).getTime();
        const bMatchTs = new Date(newestMatchByJobId.get(b.id)?.created_at ?? 0).getTime();
        return bMatchTs - aMatchTs;
      })
      .map((row) => {
        const matchedAt = newestMatchByJobId.get(row.id)?.created_at;
        const eventTime = matchedAt || row.posted_at || row.created_at;
        return {
          id: row.id,
          title: row.job_title?.trim() || row.extracted_role_normalized?.trim() || row.post_content?.trim().split('\n')[0]?.slice(0, 80) || 'Untitled Job',
          roleTitle: (row as SocialJobRow & Record<string, unknown>).role_title?.trim() || row.job_title?.trim() || row.extracted_role_normalized?.trim() || '',
          location: row.location?.trim() || 'Location not specified',
          company: row.company_name?.trim() || '',
          posterName: row.posted_by_name?.trim() || 'Vendor contact',
          posterEmail: row.poster_email?.trim() || '',
          posterPhone: row.poster_phone?.trim() || '',
          postedAt: eventTime,
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
        } as SocialLead;
      });

    setFeed(finalFiltered);
    setVisibleMatchesCount(MATCHES_PAGE_SIZE);
    setDesktopRecentVisibleCount(MATCHES_PAGE_SIZE);
    setDesktopRevealedVisibleCount(MATCHES_PAGE_SIZE);
    setFeedLoading(false);
  }, [loadGlobalPulseRows, selectedProfileRange.hours, showToast]);

  useEffect(() => {
    void loadFeed(null);
  }, [loadFeed]);

  useEffect(() => {
    setVisibleMatchesCount(MATCHES_PAGE_SIZE);
    setDesktopRecentVisibleCount(MATCHES_PAGE_SIZE);
    setDesktopRevealedVisibleCount(MATCHES_PAGE_SIZE);
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
      setView('feed');
      await loadFeed(null);
      void loadLeaderboard();
      showToast(`Watching ${persona.target_role}`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not activate watch', 'error');
    } finally {
      setActivatingRole(null);
    }
  }, [ensureBenchProfileForWatchedRole, loadFeed, loadLeaderboard, showToast, syncWatchlistProfileFromHotlistRole]);

  const openJobsForRole = useCallback((role: string) => {
    const query = role.trim();
    if (!query) return;
    navigate(`/jobs?q=${encodeURIComponent(query)}`);
  }, [navigate]);

  const openHotlistForRole = useCallback((role: string) => {
    const query = role.trim();
    if (!query) return;
    navigate(`/hotlist?q=${encodeURIComponent(query)}`);
  }, [navigate]);

  const refreshFeed = useCallback(async () => {
    setRefreshing(true);
    await loadFeed(null, [], true);

    try {
      const { data: latestRows } = await supabase.rpc('get_pulse_social_feed', {
        p_since: '1970-01-01T00:00:00.000Z',
        p_limit: 1,
      } as never);
      const latest = (latestRows?.[0] as PulseSocialFeedRpcRow | undefined)?.match_created_at;
      if (latest) setLastMatchAt(latest);
    } catch {
      // Keep existing lastMatchAt if timestamp refresh fails.
    }

    setRefreshing(false);
  }, [loadFeed]);

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

  useEffect(() => {
    if (!selectedLead) {
      setGeneratedEmailDraft('');
      setShowGeneratedEmailDraft(false);
      return;
    }
    setGeneratedEmailDraft('');
    setShowGeneratedEmailDraft(false);
  }, [selectedLead?.id]);

  const consumeCreditsLegacy = useCallback(async (
    amount: number,
    feature: 'pulse_reveal_contact' | 'pulse_view_breakdown',
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
    feature: 'pulse_reveal_contact' | 'pulse_view_breakdown',
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
  }, [showToast]);

  const handleRevealContact = useCallback(async (lead: SocialLead) => {
    if (!user) {
      showToast('Please sign in to reveal contact details', 'error');
      return;
    }

    setProcessingLeadId(lead.id);
    const alreadyRevealed = revealedLeadIds.has(lead.id);

    try {
      if (!alreadyRevealed) {
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
        showToast('Vendor auto-saved to Tracker', 'success');
      }

      setSelectedLead(lead);
      setShowBreakdown(false);
    } finally {
      setProcessingLeadId(null);
    }
  }, [consumeCredits, persistLeadAction, revealedLeadIds, saveVendorToTracker, showToast, user]);

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

  return (
    <div className="h-[100dvh] overflow-hidden overscroll-none bg-white text-gray-900 flex flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0">
      <AppNav />

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className={`h-full w-full flex flex-col overflow-hidden ${isMobileViewport ? 'px-2 pt-0 pb-2' : 'px-2 py-2'}`}>


          {loading ? (
            <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white">
              <LogoSpinner size={24} />
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
              {!isMobileViewport && account?.id && (
                <div className="shrink-0">
                  <div className="grid grid-cols-3 lg:grid-cols-5 gap-2">
                    {([
                      { number: 1, label: 'Predictions Made', value: dashboardStats?.predictions_made_today ?? 0, icon: Target, tone: 'emerald' },
                      { number: 2, label: 'Avg Prediction Rate', value: `${dashboardStats?.avg_prediction_score_today ?? 0}%`, icon: Percent, tone: 'violet' },
                      { number: 3, label: 'Submissions Today', value: dashboardStats?.submissions_today ?? 0, icon: Send, tone: 'blue' },
                      { number: 4, label: 'Replies Received', value: dashboardStats?.replies_today ?? 0, icon: MessageSquare, tone: 'pink' },
                      { number: 5, label: 'Total Vendors', value: dashboardStats?.total_vendors_today ?? 0, icon: Users, tone: 'slate' },
                    ] as Array<{ number: number; label: string; value: string | number; icon: LucideIcon; tone: 'blue' | 'orange' | 'violet' | 'emerald' | 'pink' | 'slate' }>).map((card) => {
                      const toneClass = {
                        blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
                        orange: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300',
                        violet: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300',
                        emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
                        pink: 'bg-pink-50 text-pink-700 dark:bg-pink-500/10 dark:text-pink-300',
                        slate: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-300',
                      }[card.tone];
                      return (
                        <div key={card.number} className="relative rounded-lg border border-gray-200 bg-white px-3 py-2.5 dark:border-white/10 dark:bg-[#171A1F]">
                          <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-gray-100 text-[9px] font-bold text-gray-500 dark:bg-white/10 dark:text-slate-300">{card.number}</span>
                          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${toneClass}`}>
                            <card.icon size={14} />
                          </span>
                          <div className="mt-1.5 text-xl font-bold text-gray-900 dark:text-slate-100">
                            {(dashboardLoading || !dashboardStats) ? <span className="inline-block h-5 w-8 animate-pulse rounded bg-gray-200 dark:bg-white/10" /> : card.value}
                          </div>
                          <div className="text-[10px] font-medium text-gray-500 dark:text-[#94A3B8]">{card.label}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

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
                        className={`inline-flex shrink-0 flex-col items-center gap-0.5 rounded-md border px-3 py-1.5 text-[11px] font-medium transition ${isSelected ? 'border-blue-200 bg-blue-50/80 text-gray-900 shadow-[0_0_0_1px_rgba(37,99,235,0.16)]' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-800'}`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <CategoryIcon size={14} className={isSelected ? 'text-blue-600' : 'text-gray-600'} />
                          <span className={isSelected ? 'text-gray-900' : 'text-gray-700'}>{category.label}</span>
                        </span>
                        <span className={`inline-flex items-center gap-1.5 text-[9px] ${isSelected ? 'text-gray-600' : 'text-gray-400'}`}>
                          <span className={`inline-flex items-center gap-0.5 ${isSelected ? 'text-amber-600' : ''}`}><Building2 size={9} />{vendorsCount}</span>
                          <span className={`inline-flex items-center gap-0.5 ${isSelected ? 'text-orange-600' : ''}`}><Briefcase size={9} />{jobsCount}</span>
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
                          className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium transition ${isActive ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-800'}`}
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
                      void loadProfileStats(true);
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

              {/* Mobile search/filter row */}
              <div className={isMobileViewport ? 'sticky top-0 z-30 bg-white px-0 pt-1.5 pb-1' : 'px-2 py-2'}>
                <div className="flex items-center gap-2">
                  <div className="flex flex-1 items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5">
                    <Search size={11} className="text-gray-400" />
                    <input
                      type="text"
                      value={pendingProfileSearchQuery}
                      onChange={(e) => setPendingProfileSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          applyProfileSearch();
                        }
                      }}
                      placeholder="Solutions Architect"
                      className="w-full border-0 bg-transparent text-[11px] text-gray-700 outline-none placeholder:text-gray-400"
                    />
                    {pendingProfileSearchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setPendingProfileSearchQuery('');
                          setProfileSearchQuery('');
                        }}
                        className="rounded-full p-0.5 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-600"
                        aria-label="Clear search field"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={applyProfileSearch}
                    className="rounded-full border border-blue-600 bg-blue-600 p-1.5 text-white transition hover:bg-blue-700"
                    aria-label="Search"
                  >
                    <Search size={12} />
                  </button>

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
                              className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[10px] font-semibold transition ${isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
                            >
                              <span>{option.label}</span>
                              {isActive ? <Check size={11} /> : null}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => void refreshDirectory()}
                    disabled={profileStatsLoading || refreshing}
                    className="inline-flex shrink-0 items-center justify-center rounded-full border border-gray-200 bg-gray-50 p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
                    aria-label="Refresh Pulse numbers"
                    title={directoryCachedAt
                      ? `Refresh 30-day numbers. Cached ${formatAgo(new Date(directoryCachedAt).toISOString())}`
                      : 'Refresh 30-day numbers'}
                  >
                    <RefreshCw size={12} className={profileStatsLoading || refreshing ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-white">
              <div
                ref={isMobileViewport ? profileListScrollRef : undefined}
                className={`min-w-0 h-full flex min-h-0 flex-col ${isMobileViewport ? 'relative isolate overflow-hidden bg-white' : 'overflow-hidden'}`}
                onScroll={isMobileViewport ? handleMobileRightPaneScroll : undefined}
              >
              <section className="min-w-0 flex-1 min-h-0 overflow-hidden flex flex-col">
                {/* Profile list */}
                {isMobileViewport ? (
                  <div className="flex h-full min-h-0 w-full flex-col gap-3 px-1.5 pb-1 pt-1">
                    <div className="min-w-0 flex-none">
                      {renderDomainsTable(
                        domainsForActiveView,
                        'No domains found.',
                        'mobile-domains',
                      )}
                    </div>
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                      {renderProfilesTable(
                        mobileVisibleRoles,
                        'No profiles found.',
                        'mobile-roles',
                        (event) => {
                          const table = event.currentTarget;
                          if (table.scrollTop + table.clientHeight >= table.scrollHeight - 40) {
                            setMobileVisibleRolesCount((count) => Math.min(filteredJobsRankedLeaderboard.length, count + MOBILE_ROLES_BATCH_SIZE));
                          }
                        },
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="grid min-h-0 flex-1 grid-cols-3 gap-3 px-2 pb-2">
                    <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
                      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
                        <Users size={10} /> Business Pulse
                      </span>
                      <div className="min-h-0 flex-1">
                        {renderUsersTable()}
                      </div>
                    </div>
                    <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
                      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                        <Activity size={10} /> Market Pulse — Roles
                      </span>
                      <div className="min-h-0 flex-1">
                        {renderProfilesTable(filteredJobsRankedLeaderboard, 'No profiles found.', 'desktop-roles')}
                      </div>
                    </div>
                    <div className="flex min-h-0 min-w-0 flex-col gap-1.5">
                      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                        <Activity size={10} /> Market Pulse — Domains
                      </span>
                      <div className="min-h-0 flex-1">
                        {renderDomainsTable(domainsForActiveView, 'No domains found.', 'desktop-domains')}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {false && (
                <div className="sticky top-0 z-40 shrink-0 flex items-center gap-2 bg-white/90 px-1.5 py-2 backdrop-blur transform-gpu backface-hidden">
                  <div className="inline-flex items-center gap-2 min-w-0 shrink-0 rounded-full bg-amber-50/80 px-2 py-1">
                    <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-700">Jobs</span>
                  </div>
                  <div className="ml-auto grid grid-cols-2 gap-1">
                    {([
                      { id: 'queued', label: 'Recent' },
                      { id: 'revealed', label: 'Revealed' },
                    ] as Array<{ id: MatchesTabId; label: string }>).map((tab) => {
                      const isSelected = selectedMatchesTab === tab.id;
                      const count = matchesTabCounts[tab.id];
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => { setSelectedMatchesTab(tab.id); setVisibleMatchesCount(MATCHES_PAGE_SIZE); }}
                          className={`inline-flex items-center justify-center gap-0.5 rounded-full px-2 py-1 text-[10px] font-semibold transition ${isSelected ? 'bg-amber-600 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
                          <span>{tab.label}</span>
                          <span className={`text-[9px] font-bold ${isSelected ? 'text-white/90' : 'text-gray-500'}`}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {false && <section className={`min-w-0 flex min-h-0 flex-col ${isMobileViewport ? 'flex-none' : 'flex-1 overflow-hidden'}`}>
                {!isMobileViewport && (
                  <div className="shrink-0 flex items-center gap-2 bg-white/90 px-1.5 py-2 backdrop-blur">
                    <div className="inline-flex items-center gap-2 min-w-0 shrink-0 rounded-full bg-amber-50/80 px-2 py-1">
                      <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-amber-700">Jobs</span>
                    </div>
                  </div>
                )}

                <div className={`min-h-0 ${isMobileViewport ? '' : 'flex-1 overflow-hidden'}`}>
                  <div className="shrink-0 border-b border-gray-200 bg-white px-2 py-2">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <label className="flex-1">
                        <span className="sr-only">Search jobs</span>
                        <div className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-gray-50 px-2 py-1.5">
                          <Search size={12} className="text-gray-400" />
                          <input
                            type="text"
                            value={feedSearchQuery}
                            onChange={(e) => setFeedSearchQuery(e.target.value)}
                            placeholder="Search role, skills, location, visa..."
                            className="w-full border-0 bg-transparent text-[11px] text-gray-700 outline-none placeholder:text-gray-400"
                          />
                        </div>
                      </label>
                      <select
                        aria-label="Feed search scope"
                        value={feedSearchScope}
                        onChange={(e) => setFeedSearchScope(e.target.value as PulseFeedSearchScope)}
                        className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-[11px] font-medium text-gray-700"
                      >
                        <option value="all">All fields</option>
                        <option value="role">Role</option>
                        <option value="skills">Skills</option>
                        <option value="location">Location</option>
                        <option value="visa">Visa</option>
                        <option value="experience">Experience</option>
                        <option value="rate">Rate</option>
                      </select>
                      {(feedSearchQuery || feedSearchScope !== 'all') && (
                        <button
                          type="button"
                          onClick={() => { setFeedSearchQuery(''); setFeedSearchScope('all'); }}
                          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-[11px] font-medium text-gray-600"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                  {feedLoading ? (
                    <div className={`${isMobileViewport ? 'py-10' : 'flex h-full'} items-center justify-center`}>
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
                          <div className="space-y-1.5 px-1.5 pt-2 pb-4">
                            {renderLeadCards(visibleFeed)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="grid min-h-0 h-full grid-cols-2 gap-2 p-1">
                        <div className="min-h-0 rounded-md bg-transparent">
                          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">Recent ({matchesTabCounts.queued})</div>
                          <div className="min-h-0 h-[calc(100%-24px)] overflow-y-auto p-1.5 slim-scrollbar" onScroll={handleDesktopRecentScroll}>
                            {recentVisibleFeed.length === 0 ? (
                              <div className="flex h-full items-center justify-center px-3 py-6 text-center text-xs text-gray-400">No recent jobs.</div>
                            ) : (
                              <div className="space-y-1.5">
                                {renderLeadCards(visibleDesktopRecentFeed)}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="min-h-0 rounded-md bg-transparent">
                          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">Revealed ({matchesTabCounts.revealed})</div>
                          <div className="min-h-0 h-[calc(100%-24px)] overflow-y-auto p-1.5 slim-scrollbar" onScroll={handleDesktopRevealedScroll}>
                            {revealedVisibleFeed.length === 0 ? (
                              <div className="flex h-full items-center justify-center px-3 py-6 text-center text-xs text-gray-400">No revealed jobs yet.</div>
                            ) : (
                              <div className="space-y-1.5">
                                {renderLeadCards(visibleDesktopRevealedFeed)}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </section>}

              </div>
              </div>
            </div>
          )}
        </div>
      </main>

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
                <p className="mt-0.5 text-[11px] text-gray-500">{maskPosterName(selectedLead.posterName)}{selectedLead.postedAgo ? ` • ${selectedLead.postedAgo}` : ''}</p>
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
              <div className="mb-3 overflow-hidden rounded-md border border-gray-200">
                {(() => {
                  const breakdownItems = buildScoreBreakdownDisplayItems(
                    selectedLead.scoreBreakdown as Record<string, number | { score: number; candidate_value: string; job_value: string; rule: string }> | undefined,
                  );

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
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="border-b border-gray-200 px-2 py-1.5 font-semibold uppercase tracking-wide text-gray-500">Rule</th>
                            <th className="border-b border-gray-200 px-2 py-1.5 font-semibold uppercase tracking-wide text-gray-500">Profile</th>
                            <th className="border-b border-gray-200 px-2 py-1.5 font-semibold uppercase tracking-wide text-gray-500">Job</th>
                          </tr>
                        </thead>
                        <tbody>
                          {breakdownItems.map((item) => (
                            <tr key={item.key}>
                              <td className="border-b border-gray-100 px-2 py-1.5 font-semibold text-gray-900">{formatBreakdownFieldName(item.key)}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-gray-700">{item.detail?.candidate_value || '-'}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-gray-700">{item.detail?.job_value || '-'}</td>
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
                  const draft = generateEmailDraft(selectedLead);
                  setGeneratedEmailDraft(draft);
                  setShowGeneratedEmailDraft(true);
                }}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-3 sm:py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                <Sparkles size={14} />
                Generate Email
              </button>

              <button
                onClick={() => void copyText(selectedLead.posterEmail, 'Vendor email')}
                disabled={!revealedLeadIds.has(selectedLead.id) || !selectedLead.posterEmail}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-300 bg-blue-600 px-3 py-3 sm:py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-200 disabled:text-gray-500"
              >
                <Mail size={14} />
                Copy Email ID
              </button>

              {selectedLead.posterPhone && (
                <button
                  onClick={() => void copyText(selectedLead.posterPhone, 'WhatsApp number')}
                  disabled={!revealedLeadIds.has(selectedLead.id)}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-3 sm:py-2.5 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <Phone size={14} />
                  Copy Phone
                </button>
              )}
            </div>

            {showGeneratedEmailDraft && (
              <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold text-gray-700">Generated Email Draft</p>
                  <button
                    type="button"
                    onClick={() => void copyText(generatedEmailDraft, 'Email draft')}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Copy Draft
                  </button>
                </div>
                <textarea
                  value={generatedEmailDraft}
                  onChange={(e) => setGeneratedEmailDraft(e.target.value)}
                  className="h-48 w-full resize-y rounded-md border border-gray-300 bg-white p-2 text-[11px] leading-relaxed text-gray-700 outline-none focus:border-blue-500"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
