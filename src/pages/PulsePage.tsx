import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
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

type ProfileStats = {
  uniqueCompanies: number;
  uniqueVendors: number;
  uniqueJobs: number;
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

type PulseLeadActionRow = {
  lead_id: string;
  action_type: LeadActionType;
};

const LEADERBOARD_RPC_LIMIT = 500;
const FEED_WINDOW_HOURS = 48;
const TOP_PROFILES_PAGE_SIZE = 10;
const MATCHES_PAGE_SIZE = 10;

const PROFILE_RANGE_OPTIONS: ProfileRangeOption[] = [
  { id: '1h', label: 'Last 1 hour', hours: 1 },
  { id: '24h', label: 'Last 24 hours', hours: 24 },
  { id: '48h', label: 'Last 48 hours', hours: 48 },
  { id: '3d', label: 'Last 3 days', hours: 72 },
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
    label: 'All Categories',
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

function roleMatchesPersona(row: SocialJobRow, personaRole: string, personaSkills: string[]) {
  const roleText = normalize(personaRole);
  const text = normalize(`${row.extracted_role_normalized ?? ''} ${row.job_title} ${row.post_content}`);
  if (!text) return false;

  if (text.includes(roleText)) return true;

  const roleTokens = roleText
    .split(' ')
    .filter((token) => token.length >= 4 && !['engineer', 'developer', 'senior', 'lead'].includes(token));

  const roleHitCount = roleTokens.reduce((count, token) => count + (text.includes(token) ? 1 : 0), 0);
  if (roleTokens.length > 0 && roleHitCount >= Math.min(2, roleTokens.length)) return true;

  const skillHits = personaSkills.reduce((count, skill) => count + (text.includes(normalize(skill)) ? 1 : 0), 0);
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

function buildInsertPayload(accountId: string, targetRole: string, avatarUrl?: string | null) {
  const suggestion = findSuggestionForRole(targetRole);
  const category = inferRoleCategoryId(targetRole, suggestion?.summary);

  if (suggestion) {
    return {
      account_id: accountId,
      target_role: suggestion.title,
      category,
      min_years_exp: suggestion.minYearsExp,
      max_years_exp: suggestion.maxYearsExp,
      visa_status: suggestion.visaStatus,
      employment_type: suggestion.employmentType,
      work_type: suggestion.workType,
      preferred_locations: suggestion.locations,
      min_rate_usd_per_hr: suggestion.minRate,
      max_rate_usd_per_hr: suggestion.maxRate,
      relocation_open: suggestion.relocationOpen,
      priority_skills: suggestion.skills,
      schedule_frequency: 'hourly' as const,
      is_active: true,
      avatar_url: avatarUrl ?? null,
    };
  }

  return {
    account_id: accountId,
    target_role: targetRole,
    category,
    min_years_exp: null,
    max_years_exp: null,
    visa_status: null,
    employment_type: null,
    work_type: null,
    preferred_locations: null,
    min_rate_usd_per_hr: null,
    max_rate_usd_per_hr: null,
    relocation_open: false,
    priority_skills: null,
    schedule_frequency: 'hourly' as const,
    is_active: true,
    avatar_url: avatarUrl ?? null,
  };
}


export default function PulsePage() {
  const { account, user, refreshAccount } = useAuth();
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

  const [profileRangeId, setProfileRangeId] = useState<ProfileRangeOption['id']>('3d');
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [selectedTechStacks, setSelectedTechStacks] = useState<string[]>([]);
  const [profileSearchQuery, setProfileSearchQuery] = useState('');
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
  const [selectedLead, setSelectedLead] = useState<SocialLead | null>(null);
  const [generatedEmailDraft, setGeneratedEmailDraft] = useState('');
  const [showGeneratedEmailDraft, setShowGeneratedEmailDraft] = useState(false);
  const [expandedInlineBreakdownLeadIds, setExpandedInlineBreakdownLeadIds] = useState<Set<string>>(new Set());
  const [selectedMatchesTab, setSelectedMatchesTab] = useState<MatchesTabId>('all');
  const [visibleMatchesCount, setVisibleMatchesCount] = useState(MATCHES_PAGE_SIZE);
  const [revealedLeadIds, setRevealedLeadIds] = useState<Set<string>>(new Set());
  const [breakdownChargedLeadIds, setBreakdownChargedLeadIds] = useState<Set<string>>(new Set());
  const [queuedLeadIds, setQueuedLeadIds] = useState<Set<string>>(new Set());
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [processingLeadId, setProcessingLeadId] = useState<string | null>(null);
  const [processingBreakdownLeadId, setProcessingBreakdownLeadId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

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

  const zeroStats: ProfileStats = useMemo(() => ({
    uniqueCompanies: 0,
    uniqueVendors: 0,
    uniqueJobs: 0,
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
    // Tech stack sub-filter
    const techFiltered = selectedTechStacks.length > 0
      ? categoryFiltered.filter((persona) => {
          const text = normalize(`${persona.target_role} ${persona.summary} ${persona.priority_skills ?? ''}`);
          return selectedTechStacks.some((tech) => text.includes(normalize(tech)));
        })
      : categoryFiltered;
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
  }, [jobsRankedLeaderboard, profileSearchQuery, selectedCategoryId, selectedTechStacks]);

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
  }, [orderedJobsRankedLeaderboard, selectedProfilesView, watchingRoles]);

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

  const matchesTabCounts = useMemo(() => ({
    all: feed.length,
    breakdown: feed.filter((lead) => breakdownChargedLeadIds.has(lead.id)).length,
    revealed: feed.filter((lead) => revealedLeadIds.has(lead.id)).length,
    queued: feed.filter((lead) => !revealedLeadIds.has(lead.id) && !breakdownChargedLeadIds.has(lead.id)).length,
  }), [breakdownChargedLeadIds, feed, revealedLeadIds]);

  const filteredFeed = useMemo(() => {
    if (selectedMatchesTab === 'breakdown') {
      return feed.filter((lead) => breakdownChargedLeadIds.has(lead.id));
    }
    if (selectedMatchesTab === 'revealed') {
      return feed.filter((lead) => revealedLeadIds.has(lead.id));
    }
    if (selectedMatchesTab === 'queued') {
      return feed.filter((lead) => !revealedLeadIds.has(lead.id) && !breakdownChargedLeadIds.has(lead.id));
    }
    return feed;
  }, [breakdownChargedLeadIds, feed, revealedLeadIds, selectedMatchesTab]);

  const visibleFeed = useMemo(() => filteredFeed.slice(0, visibleMatchesCount), [filteredFeed, visibleMatchesCount]);
  const canLoadMoreMatches = visibleMatchesCount < filteredFeed.length;

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
    const { data, error } = await supabase
      .from('hotlist_ai_roles')
      .select('target_role, is_active, schedule_frequency')
      .eq('account_id', account.id);

    if (error) {
      showToast('Could not load your watch state', 'error');
      return;
    }

    const active = new Set<string>();
    for (const row of data ?? []) {
      const item = row as Pick<HotlistRoleRow, 'target_role' | 'is_active' | 'schedule_frequency'>;
      if (item.is_active && item.schedule_frequency !== 'disabled') {
        active.add(normalize(item.target_role));
      }
    }
    setWatchingRoles(active);
  }, [account?.id, showToast]);

  const loadLeadActionState = useCallback(async () => {
    if (!account?.id) {
      setRevealedLeadIds(new Set());
      setBreakdownChargedLeadIds(new Set());
      return;
    }

    const { data, error } = await supabase
      .from('pulse_lead_actions')
      .select('lead_id, action_type')
      .eq('account_id', account.id)
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
  }, [account?.id]);

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
    // Fetch latest match timestamp
    const { data: latestMatch } = await supabase
      .from('radar_match_results')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestMatch?.created_at) setLastMatchAt(latestMatch.created_at);
    setLoading(false);
  }, [loadLeaderboard, loadWatchingRoles, loadLeadActionState]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadProfileStats = useCallback(async () => {
    if (sortedLeaderboard.length === 0) {
      setProfileStatsByRole({});
      return;
    }

    setProfileStatsLoading(true);
    const threshold = new Date(Date.now() - selectedProfileRange.hours * 60 * 60 * 1000).toISOString();

    let { data: matchData, error: matchError } = await supabase
      .from('radar_match_results')
      .select('job_id, created_at')
      .eq('job_source', 'social')
      .gte('created_at', threshold)
      .order('created_at', { ascending: false })
      .limit(5000);

    if (!matchError && (!matchData || matchData.length === 0)) {
      const fallback = await supabase
        .from('radar_match_results')
        .select('job_id, created_at')
        .eq('job_source', 'social')
        .order('created_at', { ascending: false })
        .limit(5000);

      matchData = fallback.data;
      matchError = fallback.error;
    }

    if (matchError) {
      showToast('Could not load profile stats', 'error');
      setProfileStatsLoading(false);
      return;
    }

    const jobIds = Array.from(new Set((matchData ?? []).map((row) => String(row.job_id ?? '')).filter(Boolean)));
    if (jobIds.length === 0) {
      const emptyStats = Object.fromEntries(
        sortedLeaderboard.map((item) => [normalize(item.target_role), { ...zeroStats }]),
      ) as Record<string, ProfileStats>;
      setProfileStatsByRole(emptyStats);
      setProfileStatsLoading(false);
      return;
    }

    const { data: socialData, error: socialError } = await supabase
      .from('social_jobs')
      .select('id, company_name, posted_by_name, poster_email, poster_phone, job_title, post_content, extracted_role_normalized')
      .in('id', jobIds);

    if (socialError) {
      showToast('Could not hydrate profile stats', 'error');
      setProfileStatsLoading(false);
      return;
    }

    const rows = (socialData ?? []) as Array<Pick<SocialJobRow, 'id' | 'company_name' | 'posted_by_name' | 'poster_email' | 'poster_phone' | 'job_title' | 'post_content' | 'extracted_role_normalized'>>;
    const stats: Record<string, ProfileStats> = {};

    for (const persona of sortedLeaderboard) {
      const roleKey = normalize(persona.target_role);
      const skills = getPersonaSkillList(persona.target_role, persona.priority_skills);
      const companies = new Set<string>();
      const vendors = new Set<string>();
      const jobs = new Set<string>();

      for (const row of rows) {
        if (!roleMatchesPersona(row as SocialJobRow, persona.target_role, skills)) continue;

        jobs.add(row.id);

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
      };
    }

    setProfileStatsByRole(stats);
    setProfileStatsLoading(false);
  }, [selectedProfileRange.hours, showToast, sortedLeaderboard, zeroStats]);

  useEffect(() => {
    void loadProfileStats();
  }, [loadProfileStats]);

  const loadFeed = useCallback(async (persona: PulsePersona) => {
    setFeedLoading(true);
    const threshold = new Date(Date.now() - selectedProfileRange.hours * 60 * 60 * 1000).toISOString();

    const { data: matchData, error: matchError } = await supabase
      .from('radar_match_results')
      .select('id, profile_id, job_source, job_id, created_at, final_average_score, score_breakdown')
      .eq('job_source', 'social')
      .gte('created_at', threshold)
      .order('created_at', { ascending: false })
      .limit(400);

    if (matchError) {
      showToast('Failed to load social matches', 'error');
      setFeedLoading(false);
      return;
    }

    const radarRows = (matchData ?? []) as RadarSocialMatchRow[];
    const socialJobIds = Array.from(new Set(radarRows.map((row) => row.job_id).filter(Boolean)));

    if (socialJobIds.length === 0) {
      setFeed([]);
      setFeedLoading(false);
      return;
    }

    const { data: socialData, error: socialError } = await supabase
      .from('social_jobs')
      .select('id, platform, posted_by_name, poster_email, poster_phone, created_at, posted_at, job_title, company_name, location, post_content, extracted_role_normalized, employment_type, seniority_level, salary_range, extracted_skills, extracted_experience_years, extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max')
      .in('id', socialJobIds);

    if (socialError) {
      showToast('Failed to hydrate social contacts', 'error');
      setFeedLoading(false);
      return;
    }

    const newestMatchByJobId = new Map<string, RadarSocialMatchRow>();
    for (const row of radarRows) {
      const prev = newestMatchByJobId.get(row.job_id);
      if (!prev || new Date(row.created_at).getTime() > new Date(prev.created_at).getTime()) {
        newestMatchByJobId.set(row.job_id, row);
      }
    }

    const skillList = getPersonaSkillList(persona.target_role, persona.priority_skills);

    const dedupedRows = new Map<string, SocialJobRow>();

    for (const row of (socialData as SocialJobRow[])) {
      if (!newestMatchByJobId.has(row.id)) continue;
      if (!roleMatchesPersona(row, persona.target_role, skillList)) continue;

      const dedupKey = buildSocialLeadDedupKey(row);
      if (!dedupKey) continue;

      const existing = dedupedRows.get(dedupKey);
      if (!existing) {
        dedupedRows.set(dedupKey, row);
        continue;
      }

      const existingMatchTs = new Date(newestMatchByJobId.get(existing.id)?.created_at ?? 0).getTime();
      const nextMatchTs = new Date(newestMatchByJobId.get(row.id)?.created_at ?? 0).getTime();
      if (nextMatchTs > existingMatchTs) {
        dedupedRows.set(dedupKey, row);
      }
    }

    const filtered = Array.from(dedupedRows.values())
      .filter((row) => newestMatchByJobId.has(row.id));

    // Vector-based dedup pass using pgvector cosine similarity
    const textDedupedIds = filtered.map((r) => r.id);
    let vectorDedupedIds: Set<string> | null = null;
    if (textDedupedIds.length > 1) {
      const { data: uniqueIds } = await supabase.rpc('dedup_social_job_ids', {
        job_ids: textDedupedIds,
        similarity_threshold: 0.92,
      });
      if (uniqueIds && Array.isArray(uniqueIds)) {
        vectorDedupedIds = new Set(uniqueIds as string[]);
      }
    }

    const finalFiltered = (vectorDedupedIds ? filtered.filter((r) => vectorDedupedIds!.has(r.id)) : filtered)
      .sort((a, b) => {
        const aMatchTs = new Date(newestMatchByJobId.get(a.id)?.created_at ?? 0).getTime();
        const bMatchTs = new Date(newestMatchByJobId.get(b.id)?.created_at ?? 0).getTime();
        return bMatchTs - aMatchTs;
      })
      .slice(0, 120)
      .map((row) => {
        const matchedAt = newestMatchByJobId.get(row.id)?.created_at;
        const eventTime = matchedAt || row.posted_at || row.created_at;
        return {
          id: row.id,
          title: row.job_title?.trim() || row.extracted_role_normalized?.trim() || row.post_content?.trim().split('\n')[0]?.slice(0, 80) || persona.target_role || 'Untitled Job',
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
          skills: Array.isArray(row.extracted_skills) ? row.extracted_skills : [],
          experienceYears: row.extracted_experience_years ?? null,
          visaTypes: Array.isArray(row.extracted_visa_types) ? row.extracted_visa_types : [],
          hourlyRate: (row.extracted_hourly_rate_min || row.extracted_hourly_rate_max)
            ? `$${row.extracted_hourly_rate_min ?? '?'}–$${row.extracted_hourly_rate_max ?? '?'}/hr`
            : '',
        } as SocialLead;
      });

    setFeed(finalFiltered);
    setVisibleMatchesCount(MATCHES_PAGE_SIZE);
    setFeedLoading(false);
  }, [selectedProfileRange.hours, showToast]);

  useEffect(() => {
    if (visibleJobsRankedLeaderboard.length === 0) {
      if (activePersona) {
        setActivePersona(null);
      }
      setFeed([]);
      return;
    }

    const activeRoleKey = activePersona ? normalize(activePersona.target_role) : '';
    const hasActiveInVisibleList = activeRoleKey
      ? visibleJobsRankedLeaderboard.some((persona) => normalize(persona.target_role) === activeRoleKey)
      : false;

    if (hasActiveInVisibleList) return;

    const firstPersona = visibleJobsRankedLeaderboard[0];
    setActivePersona(firstPersona);
    void loadFeed(firstPersona);
  }, [activePersona, loadFeed, visibleJobsRankedLeaderboard]);

  // Re-fetch matches when date range changes
  useEffect(() => {
    if (activePersona) {
      void loadFeed(activePersona);
    }
  }, [selectedProfileRange.hours]); // eslint-disable-line react-hooks/exhaustive-deps

  const ensureRoleActive = useCallback(async (persona: PulsePersona, avatarUrl?: string | null) => {
    if (!account?.id) throw new Error('No account found');

    const { data: existingRows, error: findError } = await supabase
      .from('hotlist_ai_roles')
      .select('id, avatar_url')
      .eq('account_id', account.id)
      .ilike('target_role', persona.target_role)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (findError) throw findError;

    const existing = (existingRows?.[0] ?? null) as Pick<HotlistRoleRow, 'id' | 'avatar_url'> | null;

    if (existing?.id) {
      const updatePayload: Record<string, unknown> = {
        is_active: true,
        schedule_frequency: 'hourly',
        category: inferRoleCategoryId(persona.target_role, persona.summary),
      };
      if (avatarUrl) updatePayload.avatar_url = avatarUrl;
      const { error: updateError } = await supabase
        .from('hotlist_ai_roles')
        .update(updatePayload)
        .eq('id', existing.id);
      if (updateError) throw updateError;
      return;
    }

    const payload = buildInsertPayload(account.id, persona.target_role, avatarUrl);
    const { error: insertError } = await supabase.from('hotlist_ai_roles').insert(payload);
    if (insertError) throw insertError;
  }, [account?.id]);

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

  const activatePersona = useCallback(async (persona: PulsePersona) => {
    try {
      setActivatingRole(persona.target_role);
      await ensureRoleActive(persona);
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
      await loadFeed(persona);
      void loadLeaderboard();
      showToast(`Watching ${persona.target_role}`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not activate watch', 'error');
    } finally {
      setActivatingRole(null);
    }
  }, [ensureBenchProfileForWatchedRole, ensureRoleActive, loadFeed, loadLeaderboard, showToast]);

  const selectPersona = useCallback(async (persona: PulsePersona) => {
    setActivePersona(persona);
    setView('feed');
    await loadFeed(persona);
  }, [loadFeed]);

  const refreshFeed = useCallback(async () => {
    if (!activePersona) return;
    setRefreshing(true);
    await loadFeed(activePersona);
    const { data: latestMatch } = await supabase
      .from('radar_match_results')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestMatch?.created_at) setLastMatchAt(latestMatch.created_at);
    setRefreshing(false);
  }, [activePersona, loadFeed]);

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
    const activeDetails = activePersona ? getPersonaDetailColumns(activePersona) : null;
    const signedInUserName = ((user?.user_metadata?.full_name as string | undefined)?.trim())
      || user?.email?.split('@')[0]
      || 'Your Name';

    const profileLines = [
      `- Role: ${activePersona?.target_role || '-'}`,
      `- Exp: ${activeDetails?.experience || '-'}`,
      `- Location: ${activeDetails?.location || '-'}`,
      `- Visa: ${activeDetails?.visaStatus || '-'}`,
      `- Rate: ${activeDetails?.rateRange || '-'}`,
      `- Skills: ${activeDetails?.skills || '-'}`,
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

  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  return (
    <div className="h-[100dvh] overflow-hidden overscroll-none bg-white text-gray-900 flex flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0">
      <AppNav />

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full w-full flex flex-col overflow-hidden px-2 py-2 sm:px-6 sm:py-4 lg:px-8">


          {loading ? (
            <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white">
              <LogoSpinner size={24} />
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-2 sm:gap-3 overflow-hidden">
              {/* Category Pills (horizontal scroll) */}
              <div className="shrink-0 hide-scrollbar w-full overflow-x-auto">
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
                        onClick={() => { setSelectedCategoryId(category.id); setSelectedTechStacks([]); }}
                        className={`inline-flex shrink-0 flex-col items-center gap-0.5 rounded-md border px-3 py-1.5 text-[11px] font-medium transition ${isSelected ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-800'}`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <CategoryIcon size={14} />
                          <span>{category.label}</span>
                        </span>
                        <span className={`inline-flex items-center gap-1.5 text-[9px] ${isSelected ? 'text-blue-500' : 'text-gray-400'}`}>
                          <span className="inline-flex items-center gap-0.5"><Building2 size={9} />{vendorsCount}</span>
                          <span className="inline-flex items-center gap-0.5"><Briefcase size={9} />{jobsCount}</span>
                        </span>
                      </button>
                      );
                    })}
                </div>
              </div>

              {selectedCategoryId !== 'all' && CATEGORY_TECH_STACKS[selectedCategoryId] && (
                <div className="shrink-0 hide-scrollbar w-full overflow-x-auto">
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
              <div className="hidden sm:flex flex-wrap items-center gap-2">
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

              {/* Mobile search/filter row */}
              <div className="flex sm:hidden items-center gap-2">
                <button
                  onClick={() => setMobileSearchOpen(!mobileSearchOpen)}
                  className="flex-1 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-[11px] font-medium text-gray-600"
                >
                  <Search size={11} />
                  {profileSearchQuery || 'Search & Filter'}
                </button>
                <select
                  aria-label="Date range"
                  value={profileRangeId}
                  onChange={(e) => setProfileRangeId(e.target.value as ProfileRangeOption['id'])}
                  className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] font-medium text-gray-600"
                >
                  {PROFILE_RANGE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    void loadProfileStats();
                    void refreshFeed();
                  }}
                  disabled={profileStatsLoading || refreshing || feedLoading}
                  className="rounded-full border border-gray-200 bg-gray-50 p-1.5 text-gray-600 disabled:opacity-50"
                >
                  <RefreshCw size={13} className={refreshing || profileStatsLoading ? 'animate-spin' : ''} />
                </button>
              </div>
              {mobileSearchOpen && (
                <div className="flex sm:hidden items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2 py-1.5">
                  <Search size={12} className="text-gray-400" />
                  <input
                    type="text"
                    autoFocus
                    value={profileSearchQuery}
                    onChange={(e) => setProfileSearchQuery(e.target.value)}
                    placeholder="Search by role, skills, location, visa..."
                    className="w-full border-0 bg-transparent text-[11px] text-gray-700 outline-none placeholder:text-gray-400"
                  />
                  <button onClick={() => { setProfileSearchQuery(''); setMobileSearchOpen(false); }} className="text-gray-400">
                    <X size={12} />
                  </button>
                </div>
              )}

              <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,40%)_minmax(0,60%)] sm:grid-cols-[minmax(0,40%)_minmax(0,60%)] gap-0 overflow-hidden border border-gray-200 rounded-lg">
              <section className="min-w-0 flex min-h-0 flex-col overflow-hidden border-r border-gray-200">
                <div className="shrink-0 h-[36px] flex items-center justify-between gap-2 px-2 border-b border-gray-200 bg-white">
                  <div className="inline-flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-bold text-gray-700 uppercase tracking-wider">Profiles</span>
                    <span className="text-[9px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded ring-1 ring-blue-200">{profilesForActiveView.length}</span>
                  </div>
                </div>
                <div className="shrink-0 h-[36px] grid grid-cols-2 gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1">
                    <button
                      type="button"
                      onClick={() => setSelectedProfilesView('all')}
                      className={`rounded-md px-2 py-1 text-[10px] font-semibold transition ${selectedProfilesView === 'all' ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-200' : 'text-gray-600 hover:bg-white/80'}`}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedProfilesView('watching')}
                      className={`rounded-md px-2 py-1 text-[10px] font-semibold transition ${selectedProfilesView === 'watching' ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-200' : 'text-gray-600 hover:bg-white/80'}`}
                    >
                      Watching
                    </button>
                </div>
                {/* Profile list */}
                <div ref={profileListScrollRef} className="min-h-0 flex-1 overflow-y-auto slim-scrollbar">
                  <div className="divide-y divide-gray-100">
                    {visibleJobsRankedLeaderboard.length === 0 && (
                      <div className="px-3 py-8 text-center text-xs text-gray-400">No profiles found.</div>
                    )}
                    {visibleJobsRankedLeaderboard.map((persona) => {
                      const isWatching = watchingRoles.has(normalize(persona.target_role));
                      const isActivating = activatingRole === persona.target_role;
                      const isSelected = normalize(activePersona?.target_role) === normalize(persona.target_role);
                      const stats = profileStatsByRole[normalize(persona.target_role)] ?? zeroStats;
                      const details = getPersonaDetailColumns(persona);

                      return (
                        <div
                          key={persona.target_role}
                          onClick={() => void selectPersona(persona)}
                          className={`px-3 py-2.5 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <p className="text-[11px] font-semibold text-gray-900 leading-snug">{persona.target_role}</p>
                          </div>
                          {details.experience !== '-' && (
                            <div className="mt-0.5 text-[10px] text-gray-500">{details.experience} exp</div>
                          )}
                          {details.location !== '-' && (
                            <div className="mt-0.5 text-[10px] text-gray-500 truncate">{details.location}</div>
                          )}
                          <div className="mt-0.5 text-[10px] text-gray-500">{details.rateRange}</div>
                          {details.visaStatus !== '-' && (
                            <div className="mt-0.5 text-[10px] text-gray-400">{details.visaStatus}</div>
                          )}
                          <div className="mt-1 flex items-center justify-start gap-1.5">
                            <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">{stats.uniqueJobs} Jobs</span>
                            <span className="text-[9px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{stats.uniqueVendors} Vendors</span>
                          </div>
                          <div className="mt-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); void activatePersona(persona); }}
                              disabled={isActivating}
                              className={`w-full rounded-md border px-2 py-1 text-[10px] font-semibold transition ${isWatching ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
                            >
                              {isActivating ? '...' : isWatching ? '✓ Watching' : '+ Watch'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {isMobileViewport && canLoadMoreProfiles && (
                      <div ref={mobileProfilesLoadMoreRef} className="px-3 py-2 text-[10px] text-gray-400">
                        Loading more profiles...
                      </div>
                    )}
                  </div>
                </div>
                <div className="hidden sm:flex shrink-0 items-center justify-between gap-2 border-t border-gray-200 bg-white px-2 py-1.5">
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
              </section>

              <section className="min-w-0 flex min-h-0 flex-col overflow-hidden">
                <div className="shrink-0 h-[36px] flex items-center justify-between gap-2 px-2 border-b border-gray-200 bg-white">
                  <div className="inline-flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-bold text-gray-700 uppercase tracking-wider">Jobs</span>
                    <span className="text-[9px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded ring-1 ring-blue-200">{filteredFeed.length}</span>
                  </div>
                </div>

                <div className="shrink-0 h-[36px] grid grid-cols-3 gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1">
                  {([
                    { id: 'queued', label: 'New' },
                    { id: 'revealed', label: 'Revealed' },
                    { id: 'all', label: 'All' },
                  ] as Array<{ id: MatchesTabId; label: string }>).map((tab) => {
                    const isSelected = selectedMatchesTab === tab.id;
                    const count = matchesTabCounts[tab.id];
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => { setSelectedMatchesTab(tab.id); setVisibleMatchesCount(MATCHES_PAGE_SIZE); }}
                        className={`inline-flex items-center justify-center gap-0.5 rounded-md px-2 py-1 text-[10px] font-semibold transition ${isSelected ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-200' : 'text-gray-600 hover:bg-white/80'}`}
                      >
                        <span>{tab.label}</span>
                        <span className={`text-[9px] font-bold ${isSelected ? 'text-blue-500' : 'text-gray-500'}`}>{count}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto slim-scrollbar">
                  {feedLoading ? (
                    <div className="flex h-full items-center justify-center">
                      <LogoSpinner size={20} />
                    </div>
                  ) : filteredFeed.length === 0 ? (
                    <div className="flex h-full items-center justify-center p-4 text-center">
                      <div>
                        <Radar size={16} className="mx-auto text-gray-300" />
                        <p className="mt-1.5 text-[11px] text-gray-500">No matches yet</p>
                      </div>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {visibleFeed.map((lead) => {
                        const inlineBreakdownItems = buildScoreBreakdownDisplayItems(
                          lead.scoreBreakdown as Record<string, number | { score: number; candidate_value: string; job_value: string; rule: string }> | undefined,
                        );
                        const isInlineBreakdownExpanded = expandedInlineBreakdownLeadIds.has(lead.id);
                        const visibleInlineBreakdownItems = isInlineBreakdownExpanded
                          ? inlineBreakdownItems
                          : inlineBreakdownItems.slice(0, 2);

                        return (
                        <div key={lead.id} className="px-3 py-2.5">
                          <div className="flex items-center justify-between gap-1.5">
                            <p className="text-[11px] font-semibold text-gray-900 leading-snug">{lead.title || 'Job Opportunity'}</p>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {(lead.matchScore !== null && Number.isFinite(lead.matchScore) && lead.matchScore > 0) && (
                                <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">{Math.round(lead.matchScore)}%</span>
                              )}
                              <span className="text-[9px] font-bold uppercase text-gray-400">{lead.platform}</span>
                            </div>
                          </div>
                          {lead.company && (
                            <div className="mt-0.5 text-[10px] text-gray-600">{lead.company}</div>
                          )}
                          {lead.location && (
                            <div className="mt-0.5 text-[10px] text-gray-600">{lead.location}</div>
                          )}
                          <div className="mt-0.5 text-[10px] text-gray-500">
                            <span>{revealedLeadIds.has(lead.id) ? lead.posterName : maskPosterName(lead.posterName)}</span>
                            <span> • </span>
                            <span>{lead.postedAgo}</span>
                          </div>
                          {inlineBreakdownItems.length > 0 && (
                            <div className="mt-1.5 overflow-hidden rounded-md border border-gray-200 sm:hidden">
                              <div>
                                <table className="w-full table-fixed border-collapse text-left text-[10px]">
                                  <thead className="bg-gray-50">
                                    <tr>
                                      <th className="border-b border-gray-200 px-2 py-1 font-semibold uppercase tracking-wide text-gray-500">Rule</th>
                                      <th className="border-b border-gray-200 px-2 py-1 font-semibold uppercase tracking-wide text-gray-500">Profile</th>
                                      <th className="border-b border-gray-200 px-2 py-1 font-semibold uppercase tracking-wide text-gray-500">Job</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {visibleInlineBreakdownItems.map((item) => (
                                      <tr key={item.key}>
                                        <td className="border-b border-gray-100 px-2 py-1 font-semibold text-gray-900 break-words whitespace-normal">{formatBreakdownFieldName(item.key)}</td>
                                        <td className="border-b border-gray-100 px-2 py-1 text-gray-700 break-words whitespace-normal">{item.detail?.candidate_value || '-'}</td>
                                        <td className="border-b border-gray-100 px-2 py-1 text-gray-700 break-words whitespace-normal">{item.detail?.job_value || '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {inlineBreakdownItems.length > 2 && (
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
                                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-[10px] font-semibold text-gray-700 transition hover:bg-gray-50"
                                >
                                  {isInlineBreakdownExpanded ? 'Hide Details' : 'See Details'}
                                </button>
                              )}
                            </div>
                          )}
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <button
                              onClick={() => void handleOpenBreakdown(lead)}
                              disabled={processingBreakdownLeadId === lead.id}
                              className={`hidden sm:inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-semibold transition disabled:opacity-60 ${breakdownChargedLeadIds.has(lead.id) ? 'border-gray-200 text-gray-600' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                            >
                              {breakdownChargedLeadIds.has(lead.id) && <Check size={9} className="text-emerald-600" />}
                              {processingBreakdownLeadId === lead.id ? '...' : 'Breakdown'}
                            </button>
                            {revealedLeadIds.has(lead.id) ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(lead.posterEmail || ''); }}
                                className="inline-flex w-full justify-center items-center gap-1 rounded-md border border-gray-200 bg-gray-100 px-2.5 py-1.5 text-[10px] font-semibold text-gray-600 transition hover:bg-gray-200 sm:w-auto"
                              >
                                <Copy size={9} /> Email <AtSign size={9} />
                              </button>
                            ) : (
                              <button
                                onClick={() => void handleRevealContact(lead)}
                                disabled={processingLeadId === lead.id}
                                className="inline-flex w-full justify-center items-center gap-1 rounded-md border border-blue-600 bg-blue-600 px-2.5 py-1.5 text-[10px] font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60 sm:w-auto"
                              >
                                <AtSign size={9} />
                                {processingLeadId === lead.id ? '...' : 'Reveal'}
                              </button>
                            )}
                          </div>
                        </div>
                        );
                      })}
                      {canLoadMoreMatches && (
                        <div className="px-3 py-2">
                          <button
                            onClick={() => setVisibleMatchesCount((prev) => prev + MATCHES_PAGE_SIZE)}
                            className="w-full rounded border border-gray-300 bg-white py-1.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-50"
                          >
                            Load More ({filteredFeed.length - visibleMatchesCount})
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>
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
