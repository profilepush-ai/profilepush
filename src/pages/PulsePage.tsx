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
  Phone,
  Radar,
  RefreshCw,
  Search,
  Shield,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Server,
  Sparkles,
  TableProperties,
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
import { useAuth } from '../contexts/AuthContext';
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

type MatchesTabId = 'all' | 'breakdown' | 'revealed' | 'queued';
type LeadActionType = 'revealed' | 'breakdown';
type EmailDraftTabId = 'pitching' | 'requestDetails';
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
const TOP_PROFILES_PAGE_SIZE = 10;
const MATCHES_PAGE_SIZE = 5;
const DESKTOP_MATCHES_PAGE_SIZE = 12;

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
  return `Posted by ${trimmed.slice(0, 3)}**`;
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


export default function PulsePage() {
  const { account, subscription, user, refreshAccount } = useAuth();
  const navigate = useNavigate();

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
  const [view, setView] = useState<'board' | 'feed'>((searchParams.get('view') === 'feed') ? 'feed' : 'board');

  // Sync view state when URL search params change (e.g. bottom nav tap)
  useEffect(() => {
    setView(searchParams.get('view') === 'feed' ? 'feed' : 'board');
  }, [searchParams]);

  const [profileRangeId, setProfileRangeId] = useState<ProfileRangeOption['id']>('7d');
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
  const [generatedEmailDrafts, setGeneratedEmailDrafts] = useState<{ pitching: string; requestDetails: string }>({
    pitching: '',
    requestDetails: '',
  });
  const [selectedEmailDraftTab, setSelectedEmailDraftTab] = useState<EmailDraftTabId>('pitching');
  const [showGeneratedEmailDraft, setShowGeneratedEmailDraft] = useState(false);
  const [expandedInlineBreakdownLeadIds, setExpandedInlineBreakdownLeadIds] = useState<Set<string>>(new Set());
  const [selectedMatchesTab, setSelectedMatchesTab] = useState<MatchesTabId>('queued');
  const [visibleMatchesCount, setVisibleMatchesCount] = useState(MATCHES_PAGE_SIZE);
  const [desktopRecentVisibleCount, setDesktopRecentVisibleCount] = useState(DESKTOP_MATCHES_PAGE_SIZE);
  const [desktopRevealedVisibleCount, setDesktopRevealedVisibleCount] = useState(DESKTOP_MATCHES_PAGE_SIZE);
  const [revealedLeadIds, setRevealedLeadIds] = useState<Set<string>>(new Set());
  const [breakdownChargedLeadIds, setBreakdownChargedLeadIds] = useState<Set<string>>(new Set());
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
  const mobilePullStartYRef = useRef<number | null>(null);
  const mobilePullArmedRef = useRef(false);
  const appliedSearchParamQueryRef = useRef<string | null>(null);
  const rangeMenuRef = useRef<HTMLDivElement | null>(null);
  const recentSearchesRef = useRef<HTMLDivElement | null>(null);
  const desktopMatchesScrollRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  const REVEAL_CONTACT_COST = 0.10;
  const BREAKDOWN_COST = 0.1;
  const FREE_PLAN_DAILY_REVEAL_LIMIT = 10;
  const isPaidPlan = subscription?.status === 'active' && (subscription.plan_amount_usd ?? 0) > 0;

  const sortedLeaderboard = useMemo(() => {
    return [...leaderboard]
      .sort((a, b) => b.active_watchers - a.active_watchers || a.target_role.localeCompare(b.target_role))
      .map((item, idx) => ({ ...item, rank: idx + 1 }));
  }, [leaderboard]);

  const selectedProfileRange = useMemo(
    () => PROFILE_RANGE_OPTIONS.find((item) => item.id === profileRangeId) ?? PROFILE_RANGE_OPTIONS[2],
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
      .eq('page', '/jobs')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) return;
    setRecentSearches(
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

  const revealedVisibleFeed = useMemo(() => {
    const revealed = dedupedScopedFeed.filter((lead) => revealedLeadIds.has(lead.id));
    return revealed.sort((a, b) => {
      const aTs = revealedAtByLeadId[a.id] ? new Date(revealedAtByLeadId[a.id]).getTime() : 0;
      const bTs = revealedAtByLeadId[b.id] ? new Date(revealedAtByLeadId[b.id]).getTime() : 0;
      if (aTs !== bTs) return bTs - aTs;
      return new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime();
    });
  }, [dedupedScopedFeed, revealedAtByLeadId, revealedLeadIds]);

  const matchesTabCounts = useMemo(() => ({
    all: dedupedScopedFeed.length,
    breakdown: dedupedScopedFeed.filter((lead) => breakdownChargedLeadIds.has(lead.id)).length,
    revealed: revealedVisibleFeed.length,
    queued: recentVisibleFeed.length,
  }), [breakdownChargedLeadIds, dedupedScopedFeed, recentVisibleFeed.length, revealedVisibleFeed.length]);

  const profileViewCounts = useMemo(() => ({
    all: filteredJobsRankedLeaderboard.length,
    watching: orderedJobsRankedLeaderboard.filter((item) => watchingRoles.has(normalize(item.target_role))).length,
  }), [filteredJobsRankedLeaderboard, orderedJobsRankedLeaderboard, watchingRoles]);

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
      setDesktopRecentVisibleCount((prev) => Math.min(recentVisibleFeed.length, prev + DESKTOP_MATCHES_PAGE_SIZE));
    });
  }, [canLoadMoreDesktopRecent, maybeLoadMoreMatches, recentVisibleFeed.length]);

  const handleDesktopRevealedScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    maybeLoadMoreMatches(event.currentTarget, canLoadMoreDesktopRevealed, () => {
      setDesktopRevealedVisibleCount((prev) => Math.min(revealedVisibleFeed.length, prev + DESKTOP_MATCHES_PAGE_SIZE));
    });
  }, [canLoadMoreDesktopRevealed, maybeLoadMoreMatches, revealedVisibleFeed.length]);

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

    if (selectedMatchesTab === 'queued' && canLoadMoreDesktopRecent) {
      setDesktopRecentVisibleCount((prev) => Math.min(recentVisibleFeed.length, prev + DESKTOP_MATCHES_PAGE_SIZE));
    }
  }, [
    canLoadMoreDesktopRecent,
    canLoadMoreDesktopRevealed,
    isMobileViewport,
    recentVisibleFeed.length,
    revealedVisibleFeed.length,
    selectedMatchesTab,
    visibleDesktopRecentFeed.length,
    visibleDesktopRevealedFeed.length,
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
    'border-blue-100 bg-white',
    'border-violet-100 bg-white',
    'border-emerald-100 bg-white',
    'border-amber-100 bg-white',
    'border-rose-100 bg-white',
    'border-cyan-100 bg-white',
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

  const renderLeadCards = (leads: SocialLead[]) => leads.map((lead, idx) => {
    const cardClass = CARD_PALETTE[idx % CARD_PALETTE.length];
    const cardBorderClass = cardClass.split(' ').find((token) => token.startsWith('border-')) ?? 'border-blue-100';
    const buttonToneClass = BUTTON_TONE_BY_BORDER[cardBorderClass] ?? 'bg-blue-100/35 hover:bg-blue-100/55';
    const isLeadRevealed = revealedLeadIds.has(lead.id);
    const inlineBreakdownItems = orderPulseBreakdownItems(buildScoreBreakdownDisplayItems(
      lead.scoreBreakdown as Record<string, number | { score: number; candidate_value: string; job_value: string; rule: string }> | undefined,
      undefined,
      {
        employment_type: lead.employmentType || null,
        work_type: null,
      },
    ).filter((item) => !isRoleLikeBreakdownKey(item.key)));
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

    const shouldForceExpandedBreakdown = isLeadRevealed && selectedMatchesTab !== 'revealed';
    const isExpandedBreakdownVisible = shouldForceExpandedBreakdown || isInlineBreakdownExpanded;

    const maskedEmailHint = (() => {
      const email = (lead.posterEmail || '').trim();
      if (!email) return '***@';
      const localPart = email.split('@')[0] ?? '';
      const prefix = (localPart.slice(0, 3) || '***').replace(/\s+/g, '');
      return `${prefix}**@`;
    })();

    return (
      <div key={lead.id} className={`mb-1.5 break-inside-avoid rounded-lg border-2 px-3 py-2.5 ${cardClass}`}>
        <div className="flex items-start justify-between gap-1.5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold leading-snug text-blue-800">{lead.title || 'Job Opportunity'}</p>
            {lead.company && (
              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-600">
                <Building2 size={10} className="shrink-0 text-gray-400" />
                {isLeadRevealed ? lead.company : `${lead.company.slice(0, 3)}***`}
              </div>
            )}
            <div className="mt-0.5 text-[10px] text-gray-500">
              <span>{isLeadRevealed ? lead.posterName : maskPosterName(lead.posterName)}</span>
              <span> • </span>
              <span>{lead.postedAgo}</span>
            </div>
            {selectedMatchesTab === 'revealed' && revealedAtByLeadId[lead.id] && (
              <div className="mt-0.5 text-[10px] font-medium text-emerald-700">
                Revealed {formatRevealedAt(revealedAtByLeadId[lead.id])}
              </div>
            )}
          </div>
          {lead.platform && (
            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-gray-400">
              {lead.platform}
            </span>
          )}
        </div>
        {inlineBreakdownItems.length > 0 && (
          (isLeadRevealed && selectedMatchesTab !== 'revealed') ? (
            <div className="mt-1.5 w-full overflow-hidden rounded-md border border-gray-200 text-left">
              <table className="w-full table-fixed border-collapse text-left text-[10px]">
                <tbody>
                  {inlineBreakdownItems.map((item) => (
                    <tr key={item.key}>
                      <td className="border-b border-gray-100 bg-white px-2 py-1 break-words whitespace-normal text-gray-700">{formatBreakdownFieldName(item.key)}</td>
                      <td className="border-b border-gray-100 bg-white px-2 py-1 break-words whitespace-normal text-gray-700">{item.detail?.job_value || '-'}</td>
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
              className="mt-1.5 w-full overflow-hidden rounded-md border border-gray-200 text-left relative group focus:outline-none"
            >
              <table className="w-full table-fixed border-collapse text-left text-[10px]">
                <tbody>
                  {(isExpandedBreakdownVisible ? inlineBreakdownItems : collapsedInlineBreakdownItems).map((item, idx) => (
                    <tr key={item.key}>
                      <td className={`border-b border-gray-100 bg-white px-2 py-1 break-words whitespace-normal transition-all duration-200 ${!isExpandedBreakdownVisible && idx >= 2 ? 'blur-sm select-none text-gray-400' : 'text-gray-700'}`}>{formatBreakdownFieldName(item.key)}</td>
                      <td className={`border-b border-gray-100 bg-white px-2 py-1 break-words whitespace-normal transition-all duration-200 ${!isExpandedBreakdownVisible && idx >= 2 ? 'blur-sm select-none text-gray-400' : 'text-gray-700'}`}>{item.detail?.job_value || '-'}</td>
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
        )}
        <div className="mt-1.5 grid grid-cols-10 gap-1.5">
          <div className="col-span-3 inline-flex flex-col items-center justify-center rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-center">
            <span className="text-[11px] font-bold text-gray-700">{revealCountsByLeadId[lead.id] ?? 0}</span>
            <span className="text-[8px] text-gray-400 leading-tight">reveals</span>
            {(revealNamesByLeadId[lead.id]?.length ?? 0) > 0 && (
              <span className="mt-0.5 w-full truncate text-[8px] text-gray-400 leading-tight" title={`Revealed by ${revealNamesByLeadId[lead.id].join(', ')}`}>
                by {revealNamesByLeadId[lead.id].join(', ')}
              </span>
            )}
          </div>
          {isLeadRevealed ? (
            <div className="col-span-7 grid grid-cols-2 gap-1.5">
              <button
                onClick={(e) => { e.stopPropagation(); void copyText(lead.posterEmail, 'Vendor email'); }}
                className={`inline-flex items-center justify-center gap-1 rounded-md border ${cardBorderClass} ${buttonToneClass} px-2 py-1.5 text-[10px] font-semibold text-blue-800 backdrop-blur-md transition`}
              >
                <Copy size={11} />
                Email
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedLead(lead);
                  setGeneratedEmailDrafts({
                    pitching: generateEmailDraft(lead),
                    requestDetails: generateRequestDetailsEmailDraft(lead),
                  });
                  setSelectedEmailDraftTab('pitching');
                  setShowGeneratedEmailDraft(true);
                }}
                className={`inline-flex items-center justify-center gap-1 rounded-md border ${cardBorderClass} ${buttonToneClass} px-2 py-1.5 text-[10px] font-semibold text-blue-800 backdrop-blur-md transition`}
              >
                <Mail size={11} />
                Draft
              </button>
            </div>
          ) : (
            <button
              onClick={() => void handleRevealContact(lead)}
              disabled={processingLeadId === lead.id}
              className={`col-span-7 inline-flex items-center justify-center gap-1 rounded-md border ${cardBorderClass} ${buttonToneClass} px-2.5 py-1.5 text-[10px] font-semibold text-blue-800 backdrop-blur-md transition disabled:opacity-60`}
            >
              {processingLeadId === lead.id ? '...' : `Reveal ${maskedEmailHint}`}
            </button>
          )}
        </div>
      </div>
    );
  });

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
    const { data, error } = await supabase
      .from('pulse_lead_actions')
      .select('lead_id, action_type, created_at')
      .in('action_type', ['revealed', 'breakdown']);

    if (error) {
      return;
    }

    const revealed = new Set<string>();
    const breakdown = new Set<string>();
    const revealedAt: Record<string, string> = {};
    for (const row of (data ?? []) as PulseLeadActionRow[]) {
      if (row.action_type === 'revealed') {
        revealed.add(row.lead_id);
        if (row.created_at) revealedAt[row.lead_id] = row.created_at;
      }
      if (row.action_type === 'breakdown') breakdown.add(row.lead_id);
    }

    setRevealedLeadIds(revealed);
    setBreakdownChargedLeadIds(breakdown);
    setRevealedAtByLeadId(revealedAt);
  }, []);

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
    await Promise.all([loadLeaderboard(), loadWatchingRoles(), loadLeadActionState()]);

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
  }, [loadLeaderboard, loadWatchingRoles, loadLeadActionState]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadGlobalPulseRows = useCallback(async () => {
    const since = '1970-01-01T00:00:00.000Z';

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
              work_type: (extra.work_type as string | null | undefined) ?? (extractedFields?.work_type as string | null | undefined) ?? row.employment_type ?? null,
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
  }, []);

  const loadProfileStats = useCallback(async () => {
    if (sortedLeaderboard.length === 0) {
      setProfileStatsByRole({});
      return;
    }

    setProfileStatsLoading(true);
    let rpcRows: PulseSocialFeedRpcRow[] = [];
    try {
      rpcRows = await loadGlobalPulseRows();
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
  }, [loadGlobalPulseRows, showToast, sortedLeaderboard, zeroStats]);

  useEffect(() => {
    void loadProfileStats();
  }, [loadProfileStats]);

  const loadFeed = useCallback(async (_persona: PulsePersona | null, _personaFilters: PulsePersona[] = []) => {
    setFeedLoading(true);
    let rpcRows: PulseSocialFeedRpcRow[] = [];
    try {
      rpcRows = await loadGlobalPulseRows();
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
    const last24HoursMs = 24 * 60 * 60 * 1000;
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
    const getPostedTimestamp = (row: SocialJobRow) => new Date(row.posted_at || row.created_at || 0).getTime();
    const BREAKDOWN_QUALITY_KEYS = [
      'experience_match',
      'work_type_match',
      'employment_type_match',
      'hourly_rate_match',
      'visa_match',
      'location_match',
      'skills_match',
    ];
    const hasFullyPopulatedFields = (row: SocialJobRow) => {
      const breakdown = newestMatchByJobId.get(row.id)?.score_breakdown;
      const hasRequiredBreakdownValues = BREAKDOWN_QUALITY_KEYS.every((key) => isMeaningfulText(getBreakdownJobValue(breakdown, key)));

      const hasRole = isMeaningfulText(row.job_title) || isMeaningfulText(row.extracted_role_normalized);
      const hasCompany = isMeaningfulText(row.company_name);
      const hasPosterName = isMeaningfulText(row.posted_by_name);
      const hasPosterEmail = /^\S+@\S+\.\S+$/.test((row.poster_email ?? '').trim());
      const hasLocation = isMeaningfulText(row.location);
      const hasEmploymentType = isMeaningfulText(row.employment_type);
      const hasSkills = hasValues(row.core_skills) || hasValues(row.extracted_skills);
      const hasExperience = row.years_experience != null || row.extracted_experience_years != null;
      const hasVisa = hasValues(row.visa_types) || hasValues(row.extracted_visa_types);
      const hasRate = row.hourly_rate_min != null
        || row.hourly_rate_max != null
        || row.extracted_hourly_rate_min != null
        || row.extracted_hourly_rate_max != null
        || isMeaningfulText(row.salary_range);

      return hasRole
        && hasCompany
        && hasPosterName
        && hasPosterEmail
        && hasLocation
        && hasEmploymentType
        && hasSkills
        && hasExperience
        && hasVisa
        && hasRate
        && hasRequiredBreakdownValues;
    };

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

    const isPriorityComplete24hLead = (row: SocialJobRow) => {
      const postedTs = getPostedTimestamp(row);
      if (!Number.isFinite(postedTs) || postedTs <= 0) return false;
      const ageMs = nowMs - postedTs;
      return ageMs >= 0 && ageMs <= last24HoursMs && hasFullyPopulatedFields(row);
    };

    const finalFiltered = socialData
      .filter((row) => newestMatchByJobId.has(row.id) && (row.poster_email ?? '').trim())
      .sort((a, b) => {
        const aPriority = isPriorityComplete24hLead(a);
        const bPriority = isPriorityComplete24hLead(b);
        if (aPriority !== bPriority) return aPriority ? -1 : 1;

        const aCompleteness = getCompletenessScore(a);
        const bCompleteness = getCompletenessScore(b);
        if (aCompleteness !== bCompleteness) return bCompleteness - aCompleteness;

        const aMatchTs = new Date(newestMatchByJobId.get(a.id)?.created_at ?? 0).getTime();
        const bMatchTs = new Date(newestMatchByJobId.get(b.id)?.created_at ?? 0).getTime();
        if (bMatchTs !== aMatchTs) return bMatchTs - aMatchTs;

        return getPostedTimestamp(b) - getPostedTimestamp(a);
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
    setDesktopRecentVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
    setDesktopRevealedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);

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
  }, [loadGlobalPulseRows, showToast]);

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

  const selectPersona = useCallback(async (persona: PulsePersona) => {
    setActivePersona(persona);
    setView('feed');
    await loadFeed(null);
  }, [loadFeed]);

  const refreshFeed = useCallback(async () => {
    setRefreshing(true);
    await loadFeed(null);

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

  const triggerMobilePullToRefresh = useCallback(async () => {
    if (isPullRefreshing || profileStatsLoading || refreshing || feedLoading) return;
    setIsPullRefreshing(true);
    try {
      await Promise.all([loadProfileStats(), refreshFeed()]);
    } finally {
      setIsPullRefreshing(false);
      setPullDistance(0);
      mobilePullArmedRef.current = false;
      mobilePullStartYRef.current = null;
    }
  }, [feedLoading, isPullRefreshing, loadProfileStats, profileStatsLoading, refreshing, refreshFeed]);

  const handleMobilePullStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileViewport || event.currentTarget.scrollTop > 0 || isPullRefreshing) {
      mobilePullStartYRef.current = null;
      return;
    }
    mobilePullStartYRef.current = event.touches[0]?.clientY ?? null;
    mobilePullArmedRef.current = false;
  }, [isMobileViewport, isPullRefreshing]);

  const handleMobilePullMove = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileViewport || isPullRefreshing) return;
    if (event.currentTarget.scrollTop > 0) {
      mobilePullStartYRef.current = null;
      if (pullDistance !== 0) setPullDistance(0);
      return;
    }

    const startY = mobilePullStartYRef.current;
    if (startY == null) return;
    const currentY = event.touches[0]?.clientY ?? startY;
    const drag = Math.max(0, currentY - startY);
    const constrained = Math.min(72, drag * 0.45);
    setPullDistance(constrained);
    mobilePullArmedRef.current = constrained > 36;
  }, [isMobileViewport, isPullRefreshing, pullDistance]);

  const handleMobilePullEnd = useCallback(() => {
    if (!isMobileViewport || isPullRefreshing) return;
    if (mobilePullArmedRef.current) {
      void triggerMobilePullToRefresh();
      return;
    }
    setPullDistance(0);
    mobilePullArmedRef.current = false;
    mobilePullStartYRef.current = null;
  }, [isMobileViewport, isPullRefreshing, triggerMobilePullToRefresh]);

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
      `Hi ${lead.posterName || 'there'},`,
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
    const breakdownItems = orderPulseBreakdownItems(buildScoreBreakdownDisplayItems(
      lead.scoreBreakdown as Record<string, number | { score: number; candidate_value: string; job_value: string; rule: string }> | undefined,
      undefined,
      {
        employment_type: lead.employmentType || null,
        work_type: null,
      },
    ).filter((item) => !isRoleLikeBreakdownKey(item.key)));

    const missingFields = breakdownItems
      .filter((item) => {
        const value = (item.detail?.job_value ?? '').trim().toLowerCase();
        return !value || value === '-' || value === 'unknown' || value === 'not specified' || value === 'n/a';
      })
      .map((item) => formatBreakdownFieldName(item.key));

    const uniqueMissingFields = Array.from(new Set(missingFields));
    const signedInUserName = ((user?.user_metadata?.full_name as string | undefined)?.trim())
      || user?.email?.split('@')[0]
      || 'Your Name';

    const detailsLine = uniqueMissingFields.length > 0
      ? `Could you please share more details on: ${uniqueMissingFields.join(', ')}?`
      : 'Could you please share a few additional details (experience, work type, visa, location, and rate expectations) so I can shortlist the best-fit profile?';

    return [
      `Hi ${lead.posterName || 'there'},`,
      '',
      `Thanks for posting the ${lead.title || 'role'}${lead.company ? ` at ${lead.company}` : ''}.`,
      detailsLine,
      'Once I have that, I can send a tightly matched profile right away.',
      '',
      'Thanks,',
      signedInUserName,
    ].join('\n');
  }, [user?.email, user?.user_metadata?.full_name]);

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
          onConflict: 'account_id,lead_id,action_type',
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
        showToast('Vendor auto-saved to Tracker', 'success');
      }

      setSelectedLead(lead);
      setShowBreakdown(false);
    } finally {
      setProcessingLeadId(null);
    }
  }, [consumeCredits, isFreePlanRevealLimitReached, isPaidPlan, persistLeadAction, revealedLeadIds, saveVendorToTracker, showToast, user]);

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
          page: '/jobs',
          search_query: rawQuery,
        });
      void loadRecentSearches();
    }

    if (!appliedQuery) {
      setVectorSearchLeadIds(null);
      setVectorSearchLoading(false);
      return;
    }

    setVectorSearchLoading(true);
    const { data, error } = await supabase.rpc('search_pulse_social_feed_vector', {
      p_role_query: appliedQuery,
      p_limit: 2000,
      p_similarity_threshold: 0.58,
    } as never);

    if (!error && Array.isArray(data)) {
      const ids = (data as Array<{ lead_id?: string | null }>)
        .map((row) => (row.lead_id ?? '').trim())
        .filter(Boolean);
      setVectorSearchLeadIds(ids.length > 0 ? ids : null);
    } else {
      setVectorSearchLeadIds(null);
    }

    setVectorSearchLoading(false);
  }, [account?.id, loadRecentSearches, pendingFeedSearchQuery, user?.id]);

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
    <div className="h-[100dvh] overflow-hidden overscroll-none bg-white text-gray-900 flex flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0">
      <AppNav />

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className={`h-full w-full flex flex-col overflow-hidden ${isMobileViewport ? 'px-2 pt-0 pb-2' : 'px-2 py-2'}`}>


          {loading ? (
            <div className="flex h-full min-h-0 items-center justify-center rounded-xl border border-gray-200 bg-white">
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
                      void loadProfileStats();
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
              <div className={isMobileViewport ? 'sticky top-0 z-30 bg-white px-0 pt-1.5 pb-1' : 'px-2 py-2'}>
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
                            onClick={() => {
                              setSelectedMatchesTab(tab.id);
                              setVisibleMatchesCount(MATCHES_PAGE_SIZE);
                              if (tab.id === 'revealed') setDesktopRevealedVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
                              if (tab.id === 'queued') setDesktopRecentVisibleCount(DESKTOP_MATCHES_PAGE_SIZE);
                            }}
                            className={`inline-flex items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[10px] font-semibold transition ${isSelected ? 'border border-blue-500 bg-white text-blue-600' : 'border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                          >
                            <span>{tab.label}</span>
                            <span>{count}</span>
                          </button>
                        );
                      })}
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
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-white">

              <div
                className={`min-w-0 h-full flex min-h-0 flex-col ${isMobileViewport ? 'relative isolate overflow-x-hidden overflow-y-auto overscroll-contain bg-white slim-scrollbar' : 'overflow-hidden'}`}
                onScroll={isMobileViewport ? handleMobileRightPaneScroll : undefined}
                onTouchStart={isMobileViewport ? handleMobilePullStart : undefined}
                onTouchMove={isMobileViewport ? handleMobilePullMove : undefined}
                onTouchEnd={isMobileViewport ? handleMobilePullEnd : undefined}
              >
                {isMobileViewport && (pullDistance > 0 || isPullRefreshing) && (
                  <div className="sticky top-0 z-30 flex items-center justify-center bg-white/95 text-[10px] font-medium text-gray-500">
                    <div style={{ height: `${Math.max(18, pullDistance)}px` }} className="flex items-center gap-1">
                      <RefreshCw size={10} className={isPullRefreshing ? 'animate-spin' : ''} />
                      <span>{isPullRefreshing ? 'Refreshing...' : (mobilePullArmedRef.current ? 'Release to refresh' : 'Pull to refresh')}</span>
                    </div>
                  </div>
                )}
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
                      {visibleJobsRankedLeaderboard.map((persona) => {
                        const isWatching = watchingRoles.has(normalize(persona.target_role));
                        const isActivating = activatingRole === persona.target_role;
                        const isSelected = normalize(activePersona?.target_role) === normalize(persona.target_role);
                        const stats = profileStatsByRole[normalize(persona.target_role)] ?? zeroStats;
                        const profilePulseVisual = getMarketPulseVisual(stats.uniqueJobs);
                        const details = getPersonaDetailColumns(persona);
                        const isExpanded = expandedMobileProfileCardIds.has(persona.target_role);
                        const collapsedDetails = [
                          { key: 'experience', value: details.experience !== '-' ? details.experience : '—' },
                          { key: 'rate', value: details.rateRange !== '-' ? details.rateRange : '—' },
                          { key: 'visa', value: details.visaStatus !== '-' ? details.visaStatus : '—' },
                        ];
                        const expandedDetails = [
                          ...collapsedDetails,
                          { key: 'location', value: details.location !== '-' ? details.location : '—' },
                          { key: 'employment', value: details.employmentType !== '-' ? details.employmentType : '—' },
                          { key: 'work', value: details.workType !== '-' ? details.workType : '—' },
                        ];
                        const mobileDetails = isExpanded ? expandedDetails : collapsedDetails;

                        return (
                          <div
                            key={persona.target_role}
                            onClick={() => void selectPersona(persona)}
                            className={`snap-start shrink-0 w-[84%] cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${profilePulseVisual.cardToneClass} ${isSelected ? 'ring-1 ring-gray-300' : ''}`}
                          >
                            <div className="flex items-start justify-between gap-1.5">
                              <p className="text-[11px] font-semibold text-gray-900 leading-snug">{persona.target_role}</p>
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
                                  {item.value}
                                </div>
                              ))}
                            </div>
                            <div className="mt-1 space-y-1.5">
                              <div className="flex items-center gap-1.5">
                                <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[9px] font-bold text-gray-700">{stats.uniqueJobs} Jobs</span>
                                <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[9px] font-bold text-gray-700">{stats.uniqueVendors} Vendors</span>
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
                          {filteredJobsRankedLeaderboard.filter((item) => !watchingRoles.has(normalize(item.target_role))).map((persona) => {
                            const isWatching = watchingRoles.has(normalize(persona.target_role));
                            const isActivating = activatingRole === persona.target_role;
                            const isSelected = normalize(activePersona?.target_role) === normalize(persona.target_role);
                            const stats = profileStatsByRole[normalize(persona.target_role)] ?? zeroStats;
                            const profilePulseVisual = getMarketPulseVisual(stats.uniqueJobs);
                            const details = getPersonaDetailColumns(persona);

                            return (
                              <div
                                key={`all-${persona.target_role}`}
                                onClick={() => void selectPersona(persona)}
                                className={`snap-start shrink-0 w-[clamp(220px,20vw,290px)] cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${profilePulseVisual.cardToneClass} ${isSelected ? 'ring-1 ring-gray-300' : ''}`}
                              >
                                <div className="flex items-center justify-between gap-1.5">
                                  <p className="text-[11px] font-semibold text-gray-900 leading-snug">{persona.target_role}</p>
                                  <div className="flex items-center gap-1">
                                    {renderMarketPulseSymbol(profilePulseVisual.level, profilePulseVisual.badgeClass, stats.uniqueJobs)}
                                  </div>
                                </div>
                                <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] leading-tight">
                                  <div className="min-w-0 truncate rounded border border-gray-200 bg-white px-1.5 py-1 text-gray-600">{details.experience !== '-' ? details.experience : '—'}</div>
                                  <div className="min-w-0 truncate rounded border border-gray-200 bg-white px-1.5 py-1 text-gray-600">{details.location !== '-' ? details.location : '—'}</div>
                                  <div className="min-w-0 truncate rounded border border-gray-200 bg-white px-1.5 py-1 text-gray-600">{details.rateRange !== '-' ? details.rateRange : '—'}</div>
                                  <div className="min-w-0 truncate rounded border border-gray-200 bg-white px-1.5 py-1 text-gray-600">{details.employmentType !== '-' ? details.employmentType : '—'}</div>
                                  <div className="min-w-0 truncate rounded border border-gray-200 bg-white px-1.5 py-1 text-gray-600">{details.workType !== '-' ? details.workType : '—'}</div>
                                  <div className="min-w-0 truncate rounded border border-gray-200 bg-white px-1.5 py-1 text-gray-600">{details.visaStatus !== '-' ? details.visaStatus : '—'}</div>
                                </div>
                                <div className="mt-1 space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[9px] font-bold text-gray-700">{stats.uniqueJobs} Jobs</span>
                                    <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[9px] font-bold text-gray-700">{stats.uniqueVendors} Vendors</span>
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
                          {orderedJobsRankedLeaderboard.filter((item) => watchingRoles.has(normalize(item.target_role))).map((persona) => {
                            const isWatching = watchingRoles.has(normalize(persona.target_role));
                            const isActivating = activatingRole === persona.target_role;
                            const isSelected = normalize(activePersona?.target_role) === normalize(persona.target_role);
                            const stats = profileStatsByRole[normalize(persona.target_role)] ?? zeroStats;
                            const profilePulseVisual = getMarketPulseVisual(stats.uniqueJobs);
                            const details = getPersonaDetailColumns(persona);

                            return (
                              <div
                                key={`watching-${persona.target_role}`}
                                onClick={() => void selectPersona(persona)}
                                className={`snap-start shrink-0 w-[clamp(220px,20vw,290px)] cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${profilePulseVisual.cardToneClass} ${isSelected ? 'ring-1 ring-gray-300' : ''}`}
                              >
                                <div className="flex items-center justify-between gap-1.5">
                                  <p className="text-[11px] font-semibold text-gray-900 leading-snug">{persona.target_role}</p>
                                  <div className="flex items-center gap-1">
                                    {renderMarketPulseSymbol(profilePulseVisual.level, profilePulseVisual.badgeClass, stats.uniqueJobs)}
                                  </div>
                                </div>
                                <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] leading-tight">
                                  <div className="min-w-0 truncate rounded border border-gray-200 bg-white px-1.5 py-1 text-gray-600">{details.experience !== '-' ? details.experience : '—'}</div>
                                  <div className="min-w-0 truncate rounded border border-gray-200 bg-white px-1.5 py-1 text-gray-600">{details.location !== '-' ? details.location : '—'}</div>
                                  <div className="min-w-0 truncate rounded border border-gray-200 bg-white px-1.5 py-1 text-gray-600">{details.rateRange !== '-' ? details.rateRange : '—'}</div>
                                  <div className="min-w-0 truncate rounded border border-gray-200 bg-white px-1.5 py-1 text-gray-600">{details.employmentType !== '-' ? details.employmentType : '—'}</div>
                                  <div className="min-w-0 truncate rounded border border-gray-200 bg-white px-1.5 py-1 text-gray-600">{details.workType !== '-' ? details.workType : '—'}</div>
                                  <div className="min-w-0 truncate rounded border border-gray-200 bg-white px-1.5 py-1 text-gray-600">{details.visaStatus !== '-' ? details.visaStatus : '—'}</div>
                                </div>
                                <div className="mt-1 space-y-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[9px] font-bold text-gray-700">{stats.uniqueJobs} Jobs</span>
                                    <span className="rounded border border-amber-100 bg-white/85 px-1.5 py-0.5 text-[9px] font-bold text-gray-700">{stats.uniqueVendors} Vendors</span>
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
                <div className="sticky top-0 z-40 shrink-0 bg-white/90 px-1.5 pt-0 pb-1 backdrop-blur transform-gpu backface-hidden">
                  <div className="grid w-full grid-cols-2 gap-1">
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
                          className={`inline-flex w-full items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-semibold transition ${isSelected ? 'border border-blue-500 bg-white text-blue-600' : 'border border-transparent bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                        >
                          <span>{tab.label}</span>
                          <span>{count}</span>
                        </button>
                      );
                    })}
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
                          className="min-h-0 h-full overflow-y-auto p-1.5 slim-scrollbar"
                          onScroll={selectedMatchesTab === 'revealed' ? handleDesktopRevealedScroll : handleDesktopRecentScroll}
                        >
                          {selectedMatchesTab === 'revealed' ? (
                            revealedVisibleFeed.length === 0 ? (
                              <div className="flex h-full items-center justify-center px-3 py-6 text-center text-xs text-gray-400">No revealed jobs yet.</div>
                            ) : (
                              <div className="columns-3 gap-1.5">
                                {renderLeadCards(visibleDesktopRevealedFeed)}
                              </div>
                            )
                          ) : (
                            recentVisibleFeed.length === 0 ? (
                              <div className="flex h-full items-center justify-center px-3 py-6 text-center text-xs text-gray-400">No recent jobs.</div>
                            ) : (
                              <div className="columns-3 gap-1.5">
                                {renderLeadCards(visibleDesktopRecentFeed)}
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
                <p className="mt-0.5 text-[11px] text-gray-500">{revealedLeadIds.has(selectedLead.id) ? selectedLead.posterName : 'Posted by hidden'}{selectedLead.postedAgo ? ` • ${selectedLead.postedAgo}` : ''}</p>
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
                onClick={() => void copyText(selectedLead.posterEmail, 'Vendor email')}
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

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
