import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AtSign,
  Brain,
  Briefcase,
  Building2,
  Cloud,
  Code2,
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
const TOP_PROFILES_PAGE_SIZE = 100;
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
    summary: suggestion?.summary ?? PERSONA_SUMMARY_BY_ROLE.get(canonicalKey) ?? 'Profile-based social role matching and watcher analytics.',
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
  if (mins < 60) return `Dropped ${mins} mins ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Dropped ${hrs} hrs ago`;
  return `Dropped ${Math.floor(hrs / 24)} days ago`;
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
  const contentSnippet = dedupeText(row.post_content).slice(0, 180);

  if (email || phone) {
    return [title, company, email || '-', phone || '-'].join('|');
  }

  return [title, company, poster || '-', contentSnippet || '-'].join('|');
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
  const [view, setView] = useState<'board' | 'feed'>('board');
  const [profileRangeId, setProfileRangeId] = useState<ProfileRangeOption['id']>('48h');
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [selectedTechStacks, setSelectedTechStacks] = useState<string[]>([]);
  const [profileSearchQuery, setProfileSearchQuery] = useState('');
  const [visibleProfilesCount, setVisibleProfilesCount] = useState(TOP_PROFILES_PAGE_SIZE);
  const [profileStatsLoading, setProfileStatsLoading] = useState(false);
  const [profileStatsByRole, setProfileStatsByRole] = useState<Record<string, ProfileStats>>({});
  const [selectedLead, setSelectedLead] = useState<SocialLead | null>(null);
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
    return techFiltered.filter((item) => normalize(item.target_role).includes(query) || normalize(item.summary).includes(query));
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

  const visibleJobsRankedLeaderboard = useMemo(
    () => orderedJobsRankedLeaderboard.slice(0, visibleProfilesCount),
    [orderedJobsRankedLeaderboard, visibleProfilesCount],
  );

  const canLoadMoreProfiles = visibleProfilesCount < orderedJobsRankedLeaderboard.length;

  const matchesTabCounts = useMemo(() => ({
    all: feed.length,
    breakdown: feed.filter((lead) => breakdownChargedLeadIds.has(lead.id)).length,
    revealed: feed.filter((lead) => revealedLeadIds.has(lead.id)).length,
    queued: feed.filter((lead) => queuedLeadIds.has(lead.id)).length,
  }), [breakdownChargedLeadIds, feed, queuedLeadIds, revealedLeadIds]);

  const filteredFeed = useMemo(() => {
    if (selectedMatchesTab === 'breakdown') {
      return feed.filter((lead) => breakdownChargedLeadIds.has(lead.id));
    }
    if (selectedMatchesTab === 'revealed') {
      return feed.filter((lead) => revealedLeadIds.has(lead.id));
    }
    if (selectedMatchesTab === 'queued') {
      return feed.filter((lead) => queuedLeadIds.has(lead.id));
    }
    return feed;
  }, [breakdownChargedLeadIds, feed, queuedLeadIds, revealedLeadIds, selectedMatchesTab]);

  const visibleFeed = useMemo(() => filteredFeed.slice(0, visibleMatchesCount), [filteredFeed, visibleMatchesCount]);
  const canLoadMoreMatches = visibleMatchesCount < filteredFeed.length;

  useEffect(() => {
    setVisibleProfilesCount(TOP_PROFILES_PAGE_SIZE);
  }, [profileRangeId, profileSearchQuery, selectedCategoryId]);

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
    const threshold = new Date(Date.now() - FEED_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

    let { data: matchData, error: matchError } = await supabase
      .from('radar_match_results')
      .select('id, profile_id, job_source, job_id, created_at, final_average_score, score_breakdown')
      .eq('job_source', 'social')
      .gte('created_at', threshold)
      .order('created_at', { ascending: false })
      .limit(400);

    if (!matchError && (!matchData || matchData.length === 0)) {
      const fallback = await supabase
        .from('radar_match_results')
        .select('id, profile_id, job_source, job_id, created_at, final_average_score, score_breakdown')
        .eq('job_source', 'social')
        .order('created_at', { ascending: false })
        .limit(400);

      matchData = fallback.data;
      matchError = fallback.error;
    }

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
      .select('id, platform, posted_by_name, poster_email, poster_phone, created_at, posted_at, job_title, company_name, location, post_content, extracted_role_normalized')
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
      .filter((row) => newestMatchByJobId.has(row.id))
      .sort((a, b) => {
        const aMatchTs = new Date(newestMatchByJobId.get(a.id)?.created_at ?? 0).getTime();
        const bMatchTs = new Date(newestMatchByJobId.get(b.id)?.created_at ?? 0).getTime();
        return bMatchTs - aMatchTs;
      })
      .slice(0, 120)
      .map((row) => {
        const matchedAt = newestMatchByJobId.get(row.id)?.created_at;
        const eventTime = row.posted_at || matchedAt || row.created_at;
        return {
          id: row.id,
          title: row.job_title?.trim() || persona.target_role,
          location: row.location?.trim() || 'Location not specified',
          company: row.company_name?.trim() || row.platform?.toUpperCase() || 'Social source',
          posterName: row.posted_by_name?.trim() || 'Vendor contact',
          posterEmail: row.poster_email?.trim() || '',
          posterPhone: row.poster_phone?.trim() || '',
          postedAt: eventTime,
          postedAgo: formatAgo(eventTime),
          platform: row.platform,
          matchScore: newestMatchByJobId.get(row.id)?.final_average_score ?? null,
          profileId: newestMatchByJobId.get(row.id)?.profile_id ?? null,
          scoreBreakdown: newestMatchByJobId.get(row.id)?.score_breakdown ?? null,
        } as SocialLead;
      });

    setFeed(filtered);
    setVisibleMatchesCount(MATCHES_PAGE_SIZE);
    setFeedLoading(false);
  }, [showToast]);

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

  return (
    <div className="h-screen overflow-hidden bg-white text-gray-900 flex flex-col">
      <AppNav />

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full w-full overflow-hidden px-4 py-4 sm:px-6 lg:px-8">
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-1 lg:hidden">
            <button
              onClick={() => setView('board')}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${view === 'board' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}
            >
              Profiles
            </button>
            <button
              onClick={() => setView('feed')}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${view === 'feed' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600'}`}
            >
              Feed
            </button>
          </div>

          {loading ? (
            <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white">
              <LogoSpinner size={24} />
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
              <div className="hide-scrollbar w-full overflow-x-auto">
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
                <div className="hide-scrollbar w-full overflow-x-auto">
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

              <div className="flex flex-wrap items-center gap-2">
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

              <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[minmax(0,70%)_minmax(0,30%)]">
              <section className={`${view === 'board' ? 'flex' : 'hidden'} min-h-0 flex-col overflow-hidden lg:flex`}>
                <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-gray-200">
                  <div className="h-full overflow-y-auto overflow-x-hidden">
                    <table className="w-full table-auto border-collapse text-left">
                      <thead className="sticky top-0 z-10 bg-gray-50">
                        <tr>
                          <th title="Rank" aria-label="Rank" className="w-[4%] cursor-help border-b border-gray-200 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500"><span title="Rank" className="inline-flex items-center"><Hash size={11} /></span></th>
                          <th title="Name" aria-label="Name" className="w-[18%] cursor-help border-b border-gray-200 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500"><span title="Name" className="inline-flex items-center"><User size={11} /></span></th>
                          <th title="Years" aria-label="Years" className="w-[7%] cursor-help border-b border-gray-200 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500"><span title="Years" className="inline-flex items-center"><GraduationCap size={11} /></span></th>
                          <th title="Rate (/hr)" aria-label="Rate (/hr)" className="w-[8%] cursor-help border-b border-gray-200 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500"><span title="Rate (/hr)" className="inline-flex items-center gap-1"><DollarSign size={11} /><span className="text-[9px] font-semibold normal-case tracking-normal text-gray-500">/hr</span></span></th>
                          <th title="Visa / Employment / Work Type" aria-label="Visa / Employment / Work Type" className="w-[16%] cursor-help border-b border-gray-200 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500"><span title="Visa / Employment / Work Type" className="inline-flex items-center"><Check size={11} /></span></th>
                          <th title="Location" aria-label="Location" className="w-[12%] cursor-help border-b border-gray-200 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500"><span title="Location" className="inline-flex items-center"><Building2 size={11} /></span></th>
                          <th title="Skills" aria-label="Skills" className="w-[20%] cursor-help border-b border-gray-200 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500"><span title="Skills" className="inline-flex items-center"><Search size={11} /></span></th>
                          <th title="Watchers" aria-label="Watchers" className="w-[5%] cursor-help border-b border-gray-200 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500"><span title="Watchers" className="inline-flex items-center"><Eye size={11} /></span></th>
                          <th title="Companies" aria-label="Companies" className="w-[5%] cursor-help border-b border-gray-200 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500"><span title="Companies" className="inline-flex items-center"><Building2 size={11} /></span></th>
                          <th title="Vendors" aria-label="Vendors" className="w-[5%] cursor-help border-b border-gray-200 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500"><span title="Vendors" className="inline-flex items-center"><Users size={11} /></span></th>
                          <th title="Jobs" aria-label="Jobs" className="w-[5%] cursor-help border-b border-gray-200 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500"><span title="Jobs" className="inline-flex items-center"><Briefcase size={11} /></span></th>
                          <th title="Actions" aria-label="Actions" className="w-[8%] cursor-help border-b border-gray-200 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500"><span title="Actions" className="inline-flex items-center"><Wrench size={11} /></span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleJobsRankedLeaderboard.filter((persona) => watchingRoles.has(normalize(persona.target_role))).map((persona, index) => {
                          const isWatching = true;
                          const isActivating = activatingRole === persona.target_role;
                          const isSelected = normalize(activePersona?.target_role) === normalize(persona.target_role);
                          const stats = profileStatsByRole[normalize(persona.target_role)] ?? zeroStats;
                          const details = getPersonaDetailColumns(persona);

                          return (
                            <tr
                              key={persona.target_role}
                              onClick={() => void selectPersona(persona)}
                              className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'} cursor-pointer hover:bg-blue-50/50 ${isSelected ? 'bg-blue-50' : ''}`}
                            >
                              <td className="border-b border-gray-100 px-2 py-1.5 text-xs font-semibold text-gray-700 whitespace-nowrap">#{persona.rank}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5">
                                <div className="flex items-center gap-1.5">
                                  <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded border border-gray-200 bg-white">
                                    <img
                                      src={persona.avatar_url || getDefaultPersonaAvatarUrl(persona.target_role)}
                                      alt={persona.target_role}
                                      className="h-full w-full object-cover"
                                      onError={(e) => {
                                        const img = e.currentTarget;
                                        const roleFallback = getRoleFallbackAvatarUrl(persona.target_role);
                                        if (img.dataset.fallbackApplied !== 'role') {
                                          img.src = roleFallback;
                                          img.dataset.fallbackApplied = 'role';
                                          return;
                                        }
                                        if (img.dataset.fallbackApplied !== 'default') {
                                          img.src = PROFESSIONAL_AVATAR_FALLBACK_URL;
                                          img.dataset.fallbackApplied = 'default';
                                        }
                                      }}
                                    />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium leading-tight text-gray-900 whitespace-normal break-words">{persona.target_role}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-xs text-gray-700 whitespace-nowrap">{details.experience}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-xs text-gray-700 whitespace-nowrap">{details.rateRange}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-[10px] leading-tight text-gray-600 whitespace-normal break-words">{details.visaStatus} • {details.employmentType} • {details.workType}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-xs leading-tight text-gray-700 whitespace-normal break-words">{details.location}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-xs leading-tight text-gray-700 whitespace-normal break-words">{details.skills}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-center text-xs text-gray-700">{persona.active_watchers}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-center text-xs text-gray-700">{profileStatsLoading ? '...' : stats.uniqueCompanies}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-center text-xs text-gray-700">{profileStatsLoading ? '...' : stats.uniqueVendors}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-center text-xs text-gray-700">{profileStatsLoading ? '...' : stats.uniqueJobs}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-center">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void activatePersona(persona);
                                    }}
                                    disabled={isActivating}
                                    className={`rounded border px-2 py-0.5 text-[10px] font-semibold transition ${isWatching ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'} ${isActivating ? 'opacity-70' : ''}`}
                                  >
                                    {isActivating ? 'Loading' : isWatching ? 'Watching' : '+ Watch'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {visibleJobsRankedLeaderboard.some((persona) => watchingRoles.has(normalize(persona.target_role))) && visibleJobsRankedLeaderboard.some((persona) => !watchingRoles.has(normalize(persona.target_role))) && (
                          <tr aria-hidden="true">
                            <td colSpan={12} className="px-3 py-2">
                              <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-400">
                                <span className="h-px flex-1 bg-gray-200" />
                                <span>Top Profiles</span>
                                <span className="h-px flex-1 bg-gray-200" />
                              </div>
                            </td>
                          </tr>
                        )}
                        {visibleJobsRankedLeaderboard.filter((persona) => !watchingRoles.has(normalize(persona.target_role))).map((persona, index) => {
                          const isWatching = false;
                          const isActivating = activatingRole === persona.target_role;
                          const isSelected = normalize(activePersona?.target_role) === normalize(persona.target_role);
                          const stats = profileStatsByRole[normalize(persona.target_role)] ?? zeroStats;
                          const details = getPersonaDetailColumns(persona);

                          return (
                            <tr
                              key={persona.target_role}
                              onClick={() => void selectPersona(persona)}
                              className={`${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'} cursor-pointer hover:bg-blue-50/50 ${isSelected ? 'bg-blue-50' : ''}`}
                            >
                              <td className="border-b border-gray-100 px-2 py-1.5 text-xs font-semibold text-gray-700 whitespace-nowrap">#{persona.rank}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5">
                                <div className="flex items-center gap-1.5">
                                  <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded border border-gray-200 bg-white">
                                    <img
                                      src={persona.avatar_url || getDefaultPersonaAvatarUrl(persona.target_role)}
                                      alt={persona.target_role}
                                      className="h-full w-full object-cover"
                                      onError={(e) => {
                                        const img = e.currentTarget;
                                        const roleFallback = getRoleFallbackAvatarUrl(persona.target_role);
                                        if (img.dataset.fallbackApplied !== 'role') {
                                          img.src = roleFallback;
                                          img.dataset.fallbackApplied = 'role';
                                          return;
                                        }
                                        if (img.dataset.fallbackApplied !== 'default') {
                                          img.src = PROFESSIONAL_AVATAR_FALLBACK_URL;
                                          img.dataset.fallbackApplied = 'default';
                                        }
                                      }}
                                    />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium leading-tight text-gray-900 whitespace-normal break-words">{persona.target_role}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-xs text-gray-700 whitespace-nowrap">{details.experience}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-xs text-gray-700 whitespace-nowrap">{details.rateRange}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-[10px] leading-tight text-gray-600 whitespace-normal break-words">{details.visaStatus} • {details.employmentType} • {details.workType}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-xs leading-tight text-gray-700 whitespace-normal break-words">{details.location}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-xs leading-tight text-gray-700 whitespace-normal break-words">{details.skills}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-center text-xs text-gray-700">{persona.active_watchers}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-center text-xs text-gray-700">{profileStatsLoading ? '...' : stats.uniqueCompanies}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-center text-xs text-gray-700">{profileStatsLoading ? '...' : stats.uniqueVendors}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-center text-xs text-gray-700">{profileStatsLoading ? '...' : stats.uniqueJobs}</td>
                              <td className="border-b border-gray-100 px-2 py-1.5 text-center">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void activatePersona(persona);
                                    }}
                                    disabled={isActivating}
                                    className={`rounded border px-2 py-0.5 text-[10px] font-semibold transition ${isWatching ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'} ${isActivating ? 'opacity-70' : ''}`}
                                  >
                                    {isActivating ? 'Loading' : isWatching ? 'Watching' : '+ Watch'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {visibleJobsRankedLeaderboard.length === 0 && (
                          <tr>
                            <td colSpan={12} className="px-3 py-8 text-center text-xs text-gray-500">
                              No profiles found for this time range.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {canLoadMoreProfiles && (
                  <div className="mt-2 flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
                    <p className="text-[11px] text-gray-500">
                      Showing top {visibleJobsRankedLeaderboard.length} of {filteredJobsRankedLeaderboard.length} profiles by jobs.
                    </p>
                    <button
                      onClick={() => setVisibleProfilesCount((prev) => prev + TOP_PROFILES_PAGE_SIZE)}
                      className="rounded border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Load more
                    </button>
                  </div>
                )}
              </section>

              <section className={`${view === 'feed' ? 'flex' : 'hidden'} min-h-0 flex-col overflow-hidden lg:flex`}>
                <div className="mb-2 flex items-center gap-1.5 border-b border-gray-200">
                  {([
                    { id: 'all', label: 'All' },
                    { id: 'breakdown', label: 'Breakdown' },
                    { id: 'revealed', label: 'Revealed' },
                    { id: 'queued', label: 'Queued' },
                  ] as Array<{ id: MatchesTabId; label: string }>).map((tab) => {
                    const isSelected = selectedMatchesTab === tab.id;
                    const count = matchesTabCounts[tab.id];

                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => { setSelectedMatchesTab(tab.id); setVisibleMatchesCount(MATCHES_PAGE_SIZE); }}
                        className={`relative inline-flex items-center gap-1 px-3 pb-2 pt-1 text-[11px] font-medium transition ${isSelected ? 'text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
                      >
                        <span>{tab.label}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${isSelected ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{count}</span>
                        {isSelected && <span className="absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-blue-600" />}
                      </button>
                    );
                  })}
                </div>

                <div className="min-h-0 flex-1 overflow-hidden">
                  {feedLoading ? (
                    <div className="flex h-full items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
                      <LogoSpinner size={20} />
                    </div>
                  ) : filteredFeed.length === 0 ? (
                    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
                      <div>
                        <Radar size={18} className="mx-auto text-gray-400" />
                        <p className="mt-2 text-sm font-medium text-gray-700">No matches in this tab yet</p>
                        <p className="mt-1 text-[11px] text-gray-500">Switch tabs or refresh to pull matching social jobs.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="h-full overflow-y-auto overflow-x-hidden pr-1">
                      <div className="space-y-2">
                        {visibleFeed.map((lead) => (
                          <div
                            key={lead.id}
                            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-900">{lead.title}</p>
                                <p className="mt-0.5 text-[12px] text-gray-600">{lead.company} • {lead.location}</p>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                                  {lead.matchScore !== null ? `${Math.round(lead.matchScore)}%` : 'N/A'}
                                </span>
                                <span className="rounded bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">{lead.platform}</span>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
                              <span>{revealedLeadIds.has(lead.id) ? lead.posterName : maskPosterName(lead.posterName)}</span>
                              <span>•</span>
                              <span>{lead.postedAgo}</span>
                            </div>
                            <div className="mt-2.5 border-t border-gray-100 pt-2">
                              <div className="flex flex-wrap items-center justify-end gap-1.5">
                                <button
                                  onClick={() => void handleOpenBreakdown(lead)}
                                  disabled={processingBreakdownLeadId === lead.id}
                                  className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <TableProperties size={11} />
                                  {processingBreakdownLeadId === lead.id ? 'Processing...' : 'Breakdown'}
                                </button>
                                <button
                                  onClick={() => void handleRevealContact(lead)}
                                  disabled={processingLeadId === lead.id}
                                  className="inline-flex items-center gap-1.5 rounded border border-blue-600 bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <AtSign size={11} />
                                  {processingLeadId === lead.id ? 'Processing...' : 'Reveal Email'}
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                        {canLoadMoreMatches && (
                          <button
                            onClick={() => setVisibleMatchesCount((prev) => prev + MATCHES_PAGE_SIZE)}
                            className="mt-2 w-full rounded-lg border border-gray-300 bg-white py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                          >
                            Load More ({filteredFeed.length - visibleMatchesCount} remaining)
                          </button>
                        )}
                      </div>
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/25 p-3">
          <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-3 shadow-xl">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{selectedLead.company}</p>
                <p className="text-[11px] text-gray-500">{revealedLeadIds.has(selectedLead.id) ? selectedLead.posterName : 'Posted by hidden'} • {selectedLead.postedAgo}</p>
              </div>
              <button
                onClick={() => setSelectedLead(null)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            {showBreakdown && (
              <div className="mb-2 overflow-hidden rounded-md border border-gray-200">
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
                            <th className="border-b border-gray-200 px-2 py-1.5 font-semibold uppercase tracking-wide text-gray-500">Score</th>
                            <th className="border-b border-gray-200 px-2 py-1.5 font-semibold uppercase tracking-wide text-gray-500">Candidate</th>
                            <th className="border-b border-gray-200 px-2 py-1.5 font-semibold uppercase tracking-wide text-gray-500">Job</th>
                          </tr>
                        </thead>
                        <tbody>
                          {breakdownItems.map((item) => (
                            <tr key={item.key}>
                              <td className="border-b border-gray-100 px-2 py-1.5 font-semibold text-gray-900">{Math.round(item.score)}%</td>
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

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                onClick={() => {
                  if (!selectedLead.profileId) return;
                  navigate(`/profile-details/${selectedLead.profileId}`);
                }}
                disabled={!selectedLead.profileId}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2.5 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-500"
              >
                Visit Profile
              </button>

              <button
                onClick={() => void copyText(selectedLead.posterEmail, 'Vendor email')}
                disabled={!revealedLeadIds.has(selectedLead.id) || !selectedLead.posterEmail}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-300 bg-blue-600 px-3 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-200 disabled:text-gray-500"
              >
                <Mail size={14} />
                Copy Email
              </button>

              {selectedLead.posterPhone && (
                <button
                  onClick={() => void copyText(selectedLead.posterPhone, 'WhatsApp number')}
                  disabled={!revealedLeadIds.has(selectedLead.id)}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-500"
                >
                  <Phone size={14} />
                  Copy Phone
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
