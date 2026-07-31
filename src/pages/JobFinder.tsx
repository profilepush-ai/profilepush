import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Search, Bookmark, BookmarkCheck,
  User, X, ExternalLink, Briefcase, MapPin, DollarSign, Clock,
  Users, Zap, ChevronLeft, ChevronRight,
  Building2, AlertCircle, RefreshCw, Sparkles, Eye, PenLine, Download, ChevronDown, Check,
  Lightbulb, ChevronUp, ArrowRight, Info, ThumbsUp, CheckCircle2,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { PlanModal } from '../components/PlanModal';
import LocationAutosuggestInput from '../components/LocationAutosuggestInput';
import { firstPreferredLocation } from '../lib/location-normalization';
import { loadRazorpay, TIERS, INR_PER_USD, fmtINR } from '../lib/billing-plan';
import { buildScoreBreakdownDisplayItems, type RadarScoreBreakdownEntry } from '../lib/radar-match-ui';
import { DEFAULT_AI_SCORING_MAX_ATTEMPTS, DEFAULT_AI_SCORING_POLL_MS, getAiScoringQueueState } from '../lib/ai-scoring-queue';
import { supabase } from '../lib/supabase';
import { throttled, throttledAll } from '../lib/query-throttle';
import { buildProfileBoardStats } from '../lib/job-finder-stats';
import { useAuth } from '../contexts/AuthContext';
import { generateMockJobs, type MockJob } from '../lib/mockJobs';
import type { Profile } from '../types/database';

interface SearchIdea {
  label: string;
  keyword: string;
  location: string;
  jobTypes: string[];
  experienceLevel: string;
  rationale: string;
}

// -- Types -------------------------------------------------------------------

interface LinkedInJob {
  id: string;
  search_id: string;
  job_id: string | null;
  job_url: string | null;
  apply_url: string | null;
  job_title: string | null;
  company_name: string | null;
  company_url: string | null;
  company_logo_url: string | null;
  location: string | null;
  time_posted: string | null;
  num_applicants: string | null;
  salary_range: string | null;
  job_description: string | null;
  seniority_level: string | null;
  employment_type: string | null;
  job_function: string | null;
  industries: string | null;
  easy_apply: boolean;
  created_at: string;
}

interface MatchScore {
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  score_breakdown?: Record<string, RadarScoreBreakdownEntry | number>;
  cached?: boolean;
  queued?: boolean;
  job_id?: string;
}

type PreviewEntry =
  | { source: 'linkedin';      job: LinkedInJob }
  | { source: 'dice';          job: DiceJob }
  | { source: 'indeed';        job: IndeedJob }
  | { source: 'monster';       job: MonsterJob }
  | { source: 'careerbuilder'; job: CareerBuilderJob };

interface LinkedInSearch {
  location: string;
  status: string;
  total_jobs: number;
  compute_units: number | null;
  cost_usd: number | null;
  completed_at: string | null;
  created_at: string;
}

interface DiceJob {
  id: string;
  search_id: string;
  dice_id: string | null;
  job_url: string | null;
  job_title: string | null;
  company_name: string | null;
  company_page_url: string | null;
  company_logo_url: string | null;
  location: string | null;
  salary_range: string | null;
  employment_type: string | null;
  work_setting: string | null;
  easy_apply: boolean;
  willing_to_sponsor: boolean;
  summary: string | null;
  posted: string | null;
  job_description: string | null;
  created_at: string;
}

interface DiceSearch {
  keyword: string;
  status: string;
  total_jobs: number;
  compute_units: number | null;
  cost_usd: number | null;
  completed_at: string | null;
  created_at: string;
}

interface IndeedJob {
  id: string;
  search_id: string;
  indeed_key: string | null;
  job_url: string | null;
  apply_url: string | null;
  job_title: string | null;
  company_name: string | null;
  company_page_url: string | null;
  company_logo_url: string | null;
  location_city: string | null;
  location_state: string | null;
  location_display: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_unit: string | null;
  salary_currency: string | null;
  salary_display: string | null;
  employment_type: string | null;
  is_remote: boolean;
  is_urgent: boolean;
  date_published: string | null;
  job_description: string | null;
  benefits: Record<string, string>;
  attributes: Record<string, string>;
  occupations: Record<string, string>;
  created_at: string;
}

interface IndeedSearch {
  keyword: string;
  status: string;
  total_jobs: number;
  compute_units: number | null;
  cost_usd: number | null;
  completed_at: string | null;
  created_at: string;
}

interface MonsterJob {
  id: string;
  search_id: string;
  monster_key: string | null;
  apply_url: string | null;
  job_title: string | null;
  company_name: string | null;
  company_logo_url: string | null;
  location_city: string | null;
  location_state: string | null;
  location_display: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_unit: string | null;
  salary_currency: string | null;
  employment_type: string | null;
  is_remote: boolean;
  date_published: string | null;
  date_recency: string | null;
  job_description: string | null;
  created_at: string;
}

interface MonsterSearch {
  keyword: string;
  status: string;
  total_jobs: number;
  compute_units: number | null;
  cost_usd: number | null;
  completed_at: string | null;
  created_at: string;
}

interface CareerBuilderJob {
  id: string;
  search_id: string;
  cb_key: string | null;
  job_url: string | null;
  apply_url: string | null;
  job_title: string | null;
  company_name: string | null;
  location_city: string | null;
  location_state: string | null;
  location_display: string | null;
  salary_display: string | null;
  salary_currency: string | null;
  salary_unit: string | null;
  employment_type: string | null;
  is_remote: boolean;
  is_promoted: boolean;
  date_published: string | null;
  date_recency: string | null;
  short_description: string | null;
  job_description: string | null;
  skills: string[];
  benefits_list: string[];
  occupational_category: string | null;
  created_at: string;
}

interface CareerBuilderSearch {
  keyword: string;
  status: string;
  total_jobs: number;
  compute_units: number | null;
  cost_usd: number | null;
  completed_at: string | null;
  created_at: string;
}

interface HistoryJob {
  id: string;
  search_id: string;
  source: 'linkedin' | 'dice' | 'indeed' | 'monster' | 'careerbuilder';
  job_title: string | null;
  company_name: string | null;
  company_logo_url: string | null;
  location: string | null;
  salary: string | null;
  employment_type: string | null;
  apply_url: string | null;
  job_description: string | null;
  created_at: string;
  raw: LinkedInJob | DiceJob | IndeedJob | MonsterJob | CareerBuilderJob;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PORTAL_TABS = [
  { id: 'History',       label: 'Job History',   activeClass: 'bg-gray-800 text-white shadow-sm',    inactiveClass: 'text-gray-500 hover:text-gray-700 hover:bg-gray-100', dotClass: 'bg-gray-400',    cardBorder: 'bg-gray-50 text-gray-700 border-gray-200',       emptyIcon: 'text-gray-300',    emptyBg: 'bg-gray-50'    },
  { id: 'LinkedIn',      label: 'LinkedIn',      activeClass: 'bg-blue-600 text-white shadow-sm',    inactiveClass: 'text-gray-500 hover:text-gray-700 hover:bg-gray-100', dotClass: 'bg-blue-400',    cardBorder: 'bg-blue-50 text-blue-700 border-blue-200',    emptyIcon: 'text-blue-300',    emptyBg: 'bg-blue-50'    },
  { id: 'Dice',          label: 'Dice',          activeClass: 'bg-orange-500 text-white shadow-sm',  inactiveClass: 'text-gray-500 hover:text-gray-700 hover:bg-gray-100', dotClass: 'bg-orange-400',  cardBorder: 'bg-orange-50 text-orange-700 border-orange-200',  emptyIcon: 'text-orange-300',  emptyBg: 'bg-orange-50'  },
  { id: 'Indeed',        label: 'Indeed',        activeClass: 'bg-violet-600 text-white shadow-sm',  inactiveClass: 'text-gray-500 hover:text-gray-700 hover:bg-gray-100', dotClass: 'bg-violet-400',  cardBorder: 'bg-violet-50 text-violet-700 border-violet-200',  emptyIcon: 'text-violet-300',  emptyBg: 'bg-violet-50'  },
  { id: 'Monster',       label: 'Monster',       activeClass: 'bg-green-600 text-white shadow-sm',   inactiveClass: 'text-gray-500 hover:text-gray-700 hover:bg-gray-100', dotClass: 'bg-green-400',   cardBorder: 'bg-green-50 text-green-700 border-green-200',    emptyIcon: 'text-green-300',   emptyBg: 'bg-green-50'   },
] as const;

type PortalId = typeof PORTAL_TABS[number]['id'];

const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Remote', 'Internship'];
const DATE_FILTERS = ['Any time', 'Last 24 hours', 'Last week', 'Last month'];
const EXPERIENCE_LEVELS = ['Entry level', 'Mid level', 'Senior level', 'Executive'];
const RESULT_OPTIONS = [25, 50, 75, 100];
const LINKEDIN_PAGE_SIZE = 10;
const DICE_PAGE_SIZE = 10;
const INDEED_PAGE_SIZE = 10;
const MONSTER_PAGE_SIZE = 10;
const HISTORY_PAGE_SIZE = 10;
const JOB_FINDER_SEARCH_COOLDOWN_KEY = 'job_finder_search_cooldowns';
const JOB_FINDER_REFRESH_TIMESTAMPS_KEY = 'job_finder_refresh_timestamps';
const FREE_PLAN_DAILY_LIMIT = 5;
const FREE_PLAN_PER_CANDIDATE_LIMIT = 1;
const PAID_PLAN_COOLDOWN_MS = 60 * 60 * 1000;       // 1 hour between refreshes
const PAID_PLAN_WINDOW_MS  = 24 * 60 * 60 * 1000;  // rolling 24-hour window

const POSTED_WITHIN_MAP: Record<string, string> = {
  'Any time': 'Any Time',
  'Last 24 hours': 'Past 24 hours',
  'Last week': 'Past Week',
  'Last month': 'Past Month',
};

const EXPERIENCE_MAP: Record<string, string> = {
  'Entry level': 'Junior',
  'Mid level': 'Mid-Senior',
  'Senior level': 'Mid-Senior',
  'Executive': 'Executive',
};

const INDEED_JOB_TYPE_MAP: Record<string, string> = {
  'Full-time': 'fulltime',
  'Part-time': 'parttime',
  'Contract': 'contract',
  'Internship': 'internship',
};

const INDEED_DATE_POSTED_MAP: Record<string, string | undefined> = {
  'Any time': undefined,
  'Last 24 hours': '1',
  'Last week': '7',
  'Last month': '14',
};

const DEBUG_PANEL_EMAILS = new Set([
  'poornapotluri27@gmail.com',
  'chanduchowdary24@gmail.com',
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDelimitedValues(source: string): string[] {
  return source
    .split(/[,|/;\n]+/)
    .map(value => value.trim())
    .filter(Boolean)
    .filter((value, index, arr) => arr.findIndex(entry => entry.toLowerCase() === value.toLowerCase()) === index);
}

function isSearchableSkill(skill: string): boolean {
  if (skill.length < 2 || skill.length > 32) return false;
  if (skill.split(/\s+/).length > 4) return false;
  if (/^(communication|leadership|team player|problem solving|collaboration|agile)$/i.test(skill)) return false;
  return true;
}

function getProfileSearchSkills(profile: Profile | null): { source: 'priority_skills' | 'core_skills' | 'none'; skills: string[] } {
  const prioritySkills = parseDelimitedValues(profile?.priority_skills || '')
    .filter(isSearchableSkill)
    .slice(0, 3);

  if (prioritySkills.length > 0) {
    return { source: 'priority_skills', skills: prioritySkills };
  }

  const coreSkills = parseDelimitedValues(profile?.core_skills || '')
    .filter(isSearchableSkill)
    .slice(0, 2);

  if (coreSkills.length > 0) {
    return { source: 'core_skills', skills: coreSkills };
  }

  return { source: 'none', skills: [] };
}

function escapeIndeedPhrase(value: string): string {
  return value.replace(/"/g, '\\"').trim();
}

function getIndeedSearchFilters(jobTypes: string[]): { jobType: string; remote: string } {
  const nonRemoteType = jobTypes.find(type => type !== 'Remote') ?? '';
  return {
    jobType: INDEED_JOB_TYPE_MAP[nonRemoteType] ?? '',
    remote: jobTypes.includes('Remote') ? 'remote' : '',
  };
}

function buildIndeedKeyword(rawKeyword: string, profile: Profile | null, useProfileFilters: boolean): string {
  const keywordText = rawKeyword.trim();
  if (!profile || !useProfileFilters || !keywordText) return keywordText;

  const titleVariants = [keywordText, profile?.target_role ?? '']
    .map(value => value.trim())
    .filter(Boolean)
    .filter((value, index, arr) => arr.findIndex(entry => entry.toLowerCase() === value.toLowerCase()) === index)
    .slice(0, 2);

  const titleClause = titleVariants.length > 0
    ? `title:(${titleVariants.map(value => `"${escapeIndeedPhrase(value)}"`).join(' or ')})`
    : keywordText;

  return titleClause.trim();
}

function getIndeedApifyTitle(indeedKeyword: string): string {
  const match = indeedKeyword.match(/title:\((.*)\)/i);
  if (!match) return indeedKeyword.trim();

  const inner = match[1] ?? '';
  const quoted = Array.from(inner.matchAll(/"([^"]+)"/g))
    .map(entry => entry[1]?.trim() ?? '')
    .filter(Boolean);

  if (quoted.length > 0) return quoted[0];
  return inner.replace(/[()]/g, ' ').trim();
}

function buildMonsterQuery(rawKeyword: string, profile: Profile | null, jobTypes: string[], useProfileFilters: boolean): string {
  const keywordText = rawKeyword.trim();
  if (!profile || !useProfileFilters || !keywordText) return keywordText;

  const skillTerms = getProfileSearchSkills(profile).skills
    .filter(skill => !keywordText.toLowerCase().includes(skill.toLowerCase()))
    .filter(skill => skill.length <= 30)
    .slice(0, 2);

  const typeTerms = jobTypes.filter(type => type !== 'Full-time');
  return [keywordText, ...skillTerms, ...typeTerms]
    .filter(Boolean)
    .filter((value, index, arr) => arr.findIndex(entry => entry.toLowerCase() === value.toLowerCase()) === index)
    .join(' ');
}

function buildBoardPayloadPreview(
  keywordText: string,
  locationText: string,
  dateText: string,
  experienceText: string,
  jobTypes: string[],
  maxItems: number,
  profile: Profile | null,
  useProfileFilters: boolean,
) {
  const empType = jobTypes.filter(type => type !== 'Remote')[0] ?? '';
  const workArr = jobTypes.includes('Remote') ? 'Remote' : '';
  const indeedKeyword = buildIndeedKeyword(keywordText, profile, useProfileFilters);
  const indeedTitle = getIndeedApifyTitle(indeedKeyword);
  const indeedDatePosted = INDEED_DATE_POSTED_MAP[dateText];
  const { jobType, remote } = getIndeedSearchFilters(jobTypes);
  const monsterKeyword = buildMonsterQuery(keywordText, profile, jobTypes, useProfileFilters);
  const skillContext = getProfileSearchSkills(profile);

  return {
    skillContext,
    boards: {
      LinkedIn: {
        job_title: keywordText,
        location: locationText,
        posted_within: POSTED_WITHIN_MAP[dateText] ?? 'Any Time',
        experience_level: experienceText ? (EXPERIENCE_MAP[experienceText] ?? '') : '',
        employment_type: empType,
        work_arrangement: workArr,
        max_results: maxItems,
      },
      Dice: {
        keyword: keywordText,
        location: locationText,
        posted_date: dateText,
        max_results: maxItems,
      },
      Indeed: {
        title: indeedTitle,
        location: locationText,
        country: 'us',
        datePosted: indeedDatePosted,
        limit: maxItems,
      },
      Monster: {
        keyword: monsterKeyword,
        location: locationText,
        date_posted: dateText,
        max_results: maxItems,
      },
      CareerBuilder: {
        keyword: keywordText,
        location: locationText,
        date_posted: dateText,
        max_results: maxItems,
      },
    },
  };
}

function timeAgo(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr.length < 40 ? dateStr : null;
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function dateMs(s: string | null | undefined): number {
  if (!s) return 0;
  const t = new Date(s).getTime();
  return isNaN(t) ? 0 : t;
}

function scoreColor(score: number): { ring: string; bg: string; text: string; bar: string } {
  if (score >= 80) return { ring: 'ring-green-400', bg: 'bg-green-50', text: 'text-green-700', bar: 'bg-green-500' };
  if (score >= 60) return { ring: 'ring-amber-400', bg: 'bg-amber-50', text: 'text-amber-700', bar: 'bg-amber-400' };
  if (score >= 40) return { ring: 'ring-orange-400', bg: 'bg-orange-50', text: 'text-orange-700', bar: 'bg-orange-400' };
  return { ring: 'ring-red-400', bg: 'bg-red-50', text: 'text-red-600', bar: 'bg-red-400' };
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
  return key.replace(/_/g, ' ').replace(/\bmatch\b/gi, '').replace(/\s+/g, ' ').trim().replace(/^./, c => c.toUpperCase());
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ');
}

function splitTokens(value: string | null | undefined): string[] {
  return normalizeText(value)
    .split(' ')
    .map(t => t.trim())
    .filter(t => t.length > 2);
}

function parseSkills(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(/[,/\n]/)
    .map(s => s.trim())
    .filter(Boolean);
}

function getNormalizedJobLocation(job: PreviewEntry['job']) {
  if ('location_display' in job && job.location_display) return job.location_display;
  if ('location' in job && job.location) return job.location;
  return '';
}

function inferJobWorkType(job: PreviewEntry['job']): string {
  const joined = normalizeText([
    'is_remote' in job && job.is_remote ? 'remote' : '',
    'work_setting' in job ? (job.work_setting ?? '') : '',
    'employment_type' in job ? (job.employment_type ?? '') : '',
    'job_description' in job ? (job.job_description ?? '') : '',
  ].join(' '));
  if (joined.includes('remote')) return 'Remote';
  if (joined.includes('hybrid')) return 'Hybrid';
  if (joined.includes('onsite') || joined.includes('on site')) return 'Onsite';
  return 'Not specified';
}

function inferExperienceYears(job: PreviewEntry['job']): number | null {
  const text = normalizeText([
    'job_description' in job ? (job.job_description ?? '') : '',
    'job_title' in job ? (job.job_title ?? '') : '',
  ].join(' '));
  const matches = Array.from(text.matchAll(/(\d{1,2})\s*\+?\s*(?:years|yrs|year)/g));
  if (!matches.length) return null;
  return Math.max(...matches.map(m => Number(m[1] ?? 0)).filter(n => Number.isFinite(n)));
}

function deriveFinderBreakdown(ms: MatchScore, profile: Profile | null, job: PreviewEntry['job']) {
  if (!profile) return ms.score_breakdown ?? {};
  if (ms.score_breakdown && Object.keys(ms.score_breakdown).length > 0) return ms.score_breakdown;

  const candidateRole = profile.target_role ?? '';
  const jobTitle = ('job_title' in job ? (job.job_title ?? '') : '') || '';
  const roleTokens = splitTokens(candidateRole);
  const titleTokens = new Set(splitTokens(jobTitle));
  const roleOverlap = roleTokens.length === 0 ? 0 : roleTokens.filter(t => titleTokens.has(t)).length / roleTokens.length;
  const roleScore = roleTokens.length ? Math.min(100, Math.round(roleOverlap * 100)) : ms.score;

  const candidateSkills = parseSkills(profile.priority_skills || profile.core_skills || '');
  const jobSkillPool = new Set(splitTokens(('job_description' in job ? (job.job_description ?? '') : '') + ' ' + jobTitle));
  const matchedSkills = candidateSkills.filter(skill => splitTokens(skill).some(tok => jobSkillPool.has(tok)));
  const skillOverlapCount = matchedSkills.length;
  const skillsScore = candidateSkills.length ? Math.min(100, Math.round((skillOverlapCount / candidateSkills.length) * 100)) : ms.score;

  const candidateYears = Number(profile.years_experience ?? 0) || 0;
  const requiredYears = inferExperienceYears(job);
  const experienceScore = requiredYears == null
    ? 70
    : candidateYears >= requiredYears
      ? 100
      : candidateYears >= requiredYears - 2
        ? 65
        : 30;

  const preferredLocations = parseSkills(profile.preferred_locations || '');
  const jobLocation = getNormalizedJobLocation(job);
  const jobLocTokens = new Set(splitTokens(jobLocation));
  const hasRemote = inferJobWorkType(job).toLowerCase() === 'remote';
  const locationMatches = preferredLocations.filter(loc => splitTokens(loc).some(tok => jobLocTokens.has(tok))).length;
  const locationScore = hasRemote
    ? 90
    : preferredLocations.length
      ? Math.min(100, Math.round((locationMatches / preferredLocations.length) * 100))
      : 70;

  return {
    role_match: {
      score: roleScore,
      candidate_value: candidateRole || 'Not specified',
      job_value: jobTitle || 'Not specified',
      rule: 'Compares candidate target role against job title keywords.',
    },
    skills_match: {
      score: skillsScore,
      candidate_value: candidateSkills.join(', ') || 'Not specified',
      job_value: matchedSkills.length ? matchedSkills.join(', ') : 'No strong overlap found',
      rule: 'Measures overlap between candidate priority skills and job requirements.',
    },
    experience_match: {
      score: experienceScore,
      candidate_value: candidateYears ? `${candidateYears} years` : 'Not specified',
      job_value: requiredYears != null ? `${requiredYears}+ years required` : 'Not specified',
      rule: 'Scores candidate experience against years requested in the job post.',
    },
    location_match: {
      score: locationScore,
      candidate_value: (profile.preferred_locations ?? '').trim() || 'Not specified',
      job_value: jobLocation || 'Not specified',
      rule: 'Checks preferred locations against job location, with remote-friendly scoring.',
    },
  } as Record<string, RadarScoreBreakdownEntry | number>;
}

function ScoreBreakdownTable({
  items,
  detailMap,
  showComparison = false,
}: {
  items: Array<{ key: string; score: number }>;
  detailMap: Record<string, { candidate_value: string; job_value: string; rule: string } | undefined>;
  showComparison?: boolean;
}) {
  if (!items.length) return null;

  const sortedItems = [...items].sort((a, b) => b.score - a.score);
  const hiddenInlineRuleKeys = new Set(['role_match', 'name_match', 'title_match', 'job_title_match', 'candidate_name_match']);
  const rows = showComparison
    ? sortedItems
    : sortedItems.filter(item => !hiddenInlineRuleKeys.has(item.key));

  if (!rows.length) return null;
  const gridClass = showComparison
    ? 'grid-cols-[0.65fr_1fr_1.25fr_1.25fr]'
    : 'grid-cols-[0.65fr_1.35fr_1.6fr]';
  const cellClass = 'px-3 py-2 text-[11px]';

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <div className={showComparison ? 'overflow-x-auto' : ''}>
        <div className={showComparison ? 'min-w-[38rem]' : 'w-full'}>
          <div className={`grid ${gridClass} gap-2 border-b border-slate-100 bg-slate-50 px-2 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500`}>
            <span>Score</span>
            <span>Rule</span>
            {showComparison && <span>Candidate</span>}
            <span>Job</span>
          </div>
          <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {rows.map(item => {
              const detail = detailMap[item.key];
              return (
                <div key={item.key} className={`grid ${gridClass} gap-2 ${cellClass} text-slate-700`}>
                  <div className={`font-semibold tabular-nums ${getScoreTextClass(item.score)}`}>{Math.round(item.score)}</div>
                  <div className="font-medium text-slate-800 break-words whitespace-pre-wrap">{formatScoreLabel(item.key)}</div>
                  {showComparison && <div className="min-w-0 text-slate-600 break-words whitespace-pre-wrap">{detail?.candidate_value || '—'}</div>}
                  <div className="min-w-0 text-slate-600 break-all whitespace-pre-wrap">{detail?.job_value || '—'}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function cardClass(id: string, isSaved: boolean, ms: MatchScore | undefined, previewedIds: Set<string>, defaultHover: string): string {
  if (ms && !ms.queued) {
    const s = ms.score;
    if (s >= 80) return 'bg-green-50 border-green-300 hover:shadow-sm';
    if (s >= 60) return 'bg-amber-50 border-amber-300 hover:shadow-sm';
    if (s >= 40) return 'bg-orange-50/70 border-orange-300 hover:shadow-sm';
    return 'bg-red-50 border-red-300 hover:shadow-sm';
  }
  if (isSaved) return 'bg-blue-50 border-blue-200 hover:shadow-sm';
  if (previewedIds.has(id)) return 'bg-slate-100 border-slate-400 hover:shadow-sm';
  return `bg-white border-gray-200 ${defaultHover} hover:shadow-sm`;
}

function looksLikeHtml(s: string) { return /<[a-z][\s\S]*?>/i.test(s); }

function sanitizeJobHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/javascript:/gi, '');
}

function ScoreBadge({
  ms, colors, opened, onToggle, profile, job, showComparison = false, variant = 'inline',
}: {
  ms: MatchScore;
  colors: { ring: string; bg: string; text: string; bar: string };
  opened: boolean;
  onToggle: () => void;
  profile?: Profile | null;
  job?: PreviewEntry['job'];
  showComparison?: boolean;
  variant?: 'inline' | 'popup';
}) {
  if (ms.queued) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg ring-1 ring-gray-200 bg-gray-50">
        <LogoSpinner size={11} />
        <span className="text-[10px] text-gray-500 font-medium">AI scoring queued — processing in background…</span>
      </div>
    );
  }
  const label = ms.score >= 80 ? 'Strong match' : ms.score >= 60 ? 'Good match' : ms.score >= 40 ? 'Moderate' : 'Weak match';
  const breakdownSource = job ? deriveFinderBreakdown(ms, profile ?? null, job) : undefined;
  const breakdownDisplay = breakdownSource
    ? buildScoreBreakdownDisplayItems(
        breakdownSource,
        profile ? { work_authorization: profile.work_authorization, work_type: profile.work_type } : undefined,
        job ? { employment_type: ('employment_type' in job ? (job.employment_type ?? null) : null), work_type: inferJobWorkType(job) } : undefined,
      )
    : [];
  const detailMap = Object.fromEntries(breakdownDisplay.map(item => [item.key, item.detail])) as Record<string, { candidate_value: string; job_value: string; rule: string } | undefined>;
  const isPopup = variant === 'popup';

  return (
    <div className={isPopup ? '' : 'mb-2'}>
      <button
        onClick={onToggle}
        className={isPopup
          ? 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 bg-white transition-all hover:bg-slate-50'
          : `w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg ring-1 ${colors.ring} ${colors.bg} transition-all`}
      >
        <span className={isPopup ? `text-sm font-semibold leading-none tabular-nums ${getScoreTextClass(ms.score)}` : `text-sm font-bold leading-none tabular-nums ${colors.text}`}>{ms.score}</span>
        <div className={isPopup ? 'flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden' : 'flex-1 h-1 bg-white/60 rounded-full overflow-hidden'}>
          <div className={`h-full rounded-full ${colors.bar}`} style={{ width: `${ms.score}%` }} />
        </div>
        <span className={isPopup ? `text-[10px] font-medium ${getScoreTextClass(ms.score)} whitespace-nowrap` : `text-[9px] font-semibold ${colors.text} opacity-70 whitespace-nowrap`}>{label}</span>
      </button>
      {opened && (
        <div className={isPopup ? 'mt-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-2' : 'mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-3 space-y-2'}>
          {ms.summary && <p className={isPopup ? 'text-[11px] text-slate-600 leading-relaxed' : 'text-[11px] text-gray-700 leading-relaxed'}>{ms.summary}</p>}
          {breakdownDisplay.length > 0 ? (
            <ScoreBreakdownTable
              items={breakdownDisplay.map(item => ({ key: item.key, score: item.score }))}
              detailMap={detailMap}
              showComparison={showComparison}
            />
          ) : (
            <div className="flex flex-wrap gap-1">
              {ms.strengths.slice(0, 2).map((s, i) => (
                <span key={i} className="text-[9px] bg-green-50 text-green-700 border border-green-200 px-1.5 py-0.5 rounded-full truncate max-w-[130px]">{s}</span>
              ))}
              {ms.gaps.slice(0, 1).map((g, i) => (
                <span key={i} className="text-[9px] bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded-full truncate max-w-[130px]">{g}</span>
              ))}
            </div>
          )}
          {ms.cached && <span className="text-[9px] text-slate-400 block">cached</span>}
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

const PREVIEW_ACCENT: Record<string, { applyBtn: string; companyText: string; iconBg: string; iconText: string }> = {
  linkedin: { applyBtn: 'bg-blue-600 hover:bg-blue-700 text-white',   companyText: 'text-blue-600',   iconBg: 'bg-blue-50',   iconText: 'text-blue-400'   },
  dice:     { applyBtn: 'bg-orange-500 hover:bg-orange-600 text-white', companyText: 'text-orange-600', iconBg: 'bg-orange-50', iconText: 'text-orange-400' },
  indeed:   { applyBtn: 'bg-violet-600 hover:bg-violet-700 text-white', companyText: 'text-violet-600', iconBg: 'bg-violet-50', iconText: 'text-violet-400' },
  monster:       { applyBtn: 'bg-green-600 hover:bg-green-700 text-white',    companyText: 'text-green-600',   iconBg: 'bg-green-50',   iconText: 'text-green-400'   },
  careerbuilder: { applyBtn: 'bg-emerald-600 hover:bg-emerald-700 text-white', companyText: 'text-emerald-600', iconBg: 'bg-emerald-50', iconText: 'text-emerald-400' },
};

function JobPreviewModal({
  entry, ms, scoringJobId, expandedScore, setExpandedScore,
  onScore, onSave, isSaved, isSaving, onClose, onAddToQueue, addingToQueue, addedToQueue, profile,
}: {
  entry: PreviewEntry;
  ms: MatchScore | null;
  scoringJobId: string | null;
  expandedScore: string | null;
  setExpandedScore: React.Dispatch<React.SetStateAction<string | null>>;
  onScore: () => void;
  onSave: () => void;
  isSaved: boolean;
  isSaving: boolean;
  onClose: () => void;
  onAddToQueue?: () => void;
  addingToQueue?: boolean;
  addedToQueue?: boolean;
  profile?: Profile | null;
}) {
  const { source, job } = entry;
  const jobId = job.id;
  const accent = PREVIEW_ACCENT[source];

  const title    = job.job_title;
  const company  = job.company_name;
  const logoUrl  = job.company_logo_url;
  const description = job.job_description ?? '';

  const location = source === 'indeed'
    ? (job as IndeedJob).location_display
    : source === 'monster'
    ? (job as MonsterJob).location_display
    : source === 'careerbuilder'
    ? (job as CareerBuilderJob).location_display
    : (job as LinkedInJob | DiceJob).location;

  const salary = source === 'linkedin'
    ? (job as LinkedInJob).salary_range
    : source === 'dice'
    ? (job as DiceJob).salary_range
    : source === 'monster'
    ? (() => {
        const m = job as MonsterJob;
        if (m.salary_min) {
          const unit = (m.salary_unit ?? '').toLowerCase().includes('year') ? '/yr' : (m.salary_unit ?? '').toLowerCase().includes('hour') ? '/hr' : '';
          return m.salary_max
            ? `$${Math.round(m.salary_min / 1000)}K–$${Math.round(m.salary_max / 1000)}K${unit}`
            : `From $${Math.round(m.salary_min / 1000)}K${unit}`;
        }
        return null;
      })()
    : source === 'careerbuilder'
    ? ((job as CareerBuilderJob).salary_display ?? null)
    : (() => {
        const j = job as IndeedJob;
        if (j.salary_min) {
          const unit = j.salary_unit === 'YEAR' ? '/yr' : j.salary_unit === 'HOUR' ? '/hr' : '';
          return j.salary_max
            ? `$${Math.round(j.salary_min / 1000)}K–$${Math.round(j.salary_max / 1000)}K${unit}`
            : `From $${Math.round(j.salary_min / 1000)}K${unit}`;
        }
        return j.salary_display ?? null;
      })();

  const applyUrl = source === 'linkedin'
    ? ((job as LinkedInJob).apply_url ?? (job as LinkedInJob).job_url)
    : source === 'dice'
    ? (job as DiceJob).job_url
    : source === 'monster'
    ? (job as MonsterJob).apply_url
    : source === 'careerbuilder'
    ? ((job as CareerBuilderJob).apply_url ?? (job as CareerBuilderJob).job_url)
    : ((job as IndeedJob).apply_url ?? (job as IndeedJob).job_url);

  const empType   = (job as LinkedInJob | DiceJob | IndeedJob | MonsterJob | CareerBuilderJob).employment_type;
  const isRemote  = (source === 'indeed' || source === 'monster' || source === 'careerbuilder') ? (job as IndeedJob | MonsterJob | CareerBuilderJob).is_remote : false;
  const timeLabel = source === 'linkedin'
    ? (job as LinkedInJob).time_posted
    : source === 'dice'
    ? ((job as DiceJob).posted ? new Date((job as DiceJob).posted!).toLocaleDateString() : null)
    : source === 'monster'
    ? ((job as MonsterJob).date_recency ?? ((job as MonsterJob).date_published ? new Date((job as MonsterJob).date_published!).toLocaleDateString() : null))
    : source === 'careerbuilder'
    ? ((job as CareerBuilderJob).date_recency ?? ((job as CareerBuilderJob).date_published ? new Date((job as CareerBuilderJob).date_published!).toLocaleDateString() : null))
    : ((job as IndeedJob).date_published ? new Date((job as IndeedJob).date_published!).toLocaleDateString() : null);

  const colors = ms ? scoreColor(ms.score) : null;
  const isScoring = scoringJobId === jobId;

  const indeedAttrs    = source === 'indeed' ? Object.values((job as IndeedJob).attributes ?? {}) : [];
  const indeedBenefits = source === 'indeed' ? Object.values((job as IndeedJob).benefits ?? {}) : [];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex items-start gap-3 shrink-0">
          {logoUrl
            ? <img src={logoUrl} alt="" className="w-11 h-11 rounded-xl object-cover shrink-0 border border-gray-100" />
            : <div className={`w-11 h-11 rounded-xl ${accent.iconBg} flex items-center justify-center shrink-0`}>
                <Building2 size={20} className={accent.iconText} />
              </div>
          }
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-gray-900 text-base leading-tight">{title ?? '—'}</h2>
            <p className={`text-sm font-medium mt-0.5 ${accent.companyText}`}>{company ?? '—'}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
              {location  && <span className="flex items-center gap-1 text-xs text-gray-500"><MapPin size={10} />{location}</span>}
              {salary    && <span className="flex items-center gap-1 text-xs text-gray-500"><DollarSign size={10} />{salary}</span>}
              {empType   && <span className="flex items-center gap-1 text-xs text-gray-500"><Briefcase size={10} />{empType}</span>}
              {timeLabel && <span className="flex items-center gap-1 text-xs text-gray-400"><Clock size={10} />{timeLabel}</span>}
              {isRemote  && <span className="text-xs text-sky-600 font-medium bg-sky-50 px-1.5 py-0.5 rounded-full">Remote</span>}
              {source === 'linkedin' && (job as LinkedInJob).seniority_level && (
                <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">{(job as LinkedInJob).seniority_level}</span>
              )}
              {source === 'linkedin' && (job as LinkedInJob).easy_apply && (
                <span className="text-xs font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">Easy Apply</span>
              )}
              {source === 'dice' && (job as DiceJob).willing_to_sponsor && (
                <span className="text-xs font-medium text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-full">Sponsors Visa</span>
              )}
              {source === 'careerbuilder' && (job as CareerBuilderJob).is_promoted && (
                <span className="text-xs font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full">Promoted</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors shrink-0 p-1">
            <X size={18} />
          </button>
        </div>

        {/* Match score strip */}
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 shrink-0">
          {ms ? (
            <ScoreBadge
              ms={ms}
              colors={colors!}
              opened={expandedScore === jobId}
              onToggle={() => setExpandedScore(prev => prev === jobId ? null : jobId)}
              profile={profile}
              job={job}
              showComparison
              variant="popup"
            />
          ) : (
            <button
              onClick={onScore}
              disabled={!!scoringJobId}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-gray-300 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40 transition-all font-medium"
            >
              {isScoring ? <LogoSpinner size={14} /> : <Sparkles size={14} />}
              {isScoring ? 'Analyzing…' : 'Get AI Match Score'}
            </button>
          )}
        </div>

        {/* Description */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {description.trim() ? (
            <div>
              <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Job Description</h3>
              {looksLikeHtml(description) ? (
                <div
                  className="job-desc"
                  dangerouslySetInnerHTML={{ __html: sanitizeJobHtml(description) }}
                />
              ) : (
                <div className="space-y-2">
                  {description.split('\n').filter(l => l.trim()).map((p, i) => (
                    <p key={i} className="text-sm text-gray-700 leading-relaxed">{p}</p>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">No description available.</p>
          )}

          {indeedAttrs.length > 0 && (
            <div>
              <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Skills & Requirements</h3>
              <div className="flex flex-wrap gap-1.5">
                {indeedAttrs.map((a, i) => (
                  <span key={i} className="text-xs bg-violet-50 text-violet-700 border border-violet-100 px-2 py-0.5 rounded-full">{a}</span>
                ))}
              </div>
            </div>
          )}

          {indeedBenefits.length > 0 && (
            <div>
              <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Benefits</h3>
              <div className="flex flex-wrap gap-1.5">
                {indeedBenefits.map((b, i) => (
                  <span key={i} className="text-xs bg-green-50 text-green-700 border border-green-100 px-2 py-0.5 rounded-full">{b}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 flex flex-wrap items-center gap-2 shrink-0">
          {applyUrl && (
            <a
              href={applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl transition-colors ${accent.applyBtn}`}
            >
              Apply Now <ExternalLink size={13} />
            </a>
          )}

          {isSaved ? (
            <span className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-green-50 border border-green-200 text-green-600 cursor-default">
              <BookmarkCheck size={13} /> Added
            </span>
          ) : (
            <button
              onClick={onSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl border border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-50"
            >
              {isSaving ? <LogoSpinner size={13} /> : <Bookmark size={13} />}
              Submission Queue
            </button>
          )}

          {onAddToQueue && (
            addedToQueue ? (
              <span className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 cursor-default">
                <CheckCircle2 size={13} /> Queued
              </span>
            ) : (
              <button
                onClick={onAddToQueue}
                disabled={addingToQueue}
                className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100 hover:border-violet-300 transition-all disabled:opacity-50"
              >
                {addingToQueue ? <LogoSpinner size={13} /> : <PenLine size={13} />}
                Resume AI Queue
              </button>
            )
          )}

        </div>
      </div>
    </div>
  );
}

export default function JobFinder() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { account, user, subscription, refreshAccount } = useAuth();

  const paramProfileId = searchParams.get('profileId');
  const paramRole = searchParams.get('role') ?? '';

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [profilePickerOpen, setProfilePickerOpen] = useState(false);
  const [profileQuery, setProfileQuery] = useState('');
  const profilePickerRef = useRef<HTMLDivElement>(null);
  const boardSelectorRef = useRef<HTMLDivElement>(null);
  const [profileSearchIds, setProfileSearchIds] = useState<Set<string> | null>(null);

  // Candidates sidebar
  const [candidateTab, setCandidateTab] = useState<'hotlist' | 'all'>('hotlist');
  const [hotlistProfileIds, setHotlistProfileIds] = useState<string[]>([]);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [profileBoardStats, setProfileBoardStats] = useState<Record<string, { fetched: number; matched: number }>>({});

  // AI search ideas
  const [searchIdeas, setSearchIdeas] = useState<SearchIdea[]>([]);
  const [ideasLoading, setIdeasLoading] = useState(false);
  const [ideasError, setIdeasError] = useState<string | null>(null);
  const [selectedIdeaIndex, setSelectedIdeaIndex] = useState<number | null>(null);
  const [ideasPopupOpen, setIdeasPopupOpen] = useState(false);
  const ideasBtnRef = useRef<HTMLButtonElement>(null);


  const [keyword, setKeyword] = useState(paramRole);
  const [location, setLocation] = useState('');
  const [locationScope, setLocationScope] = useState<'any' | 'city' | 'state' | 'country'>('any');
  const [activeTab, setActiveTab] = useState<PortalId>('LinkedIn');
  const [selectedJobTypes, setSelectedJobTypes] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState('Last 24 hours');
  const [experienceLevel, setExperienceLevel] = useState('');
  const [maxResults, setMaxResults] = useState(25);
  const [, setFiltersFromProfile] = useState(false);
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [selectedNewTier, setSelectedNewTier] = useState<number>(25);
  const [changingPlan, setChangingPlan] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  // Mock jobs state (Dice / Indeed / CareerBuilder)
  const [allJobs, setAllJobs] = useState<MockJob[]>([]);
  const [mockSearching, setMockSearching] = useState(false);
  const [mockHasSearched, setMockHasSearched] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);

  // LinkedIn real jobs state
  const [linkedinJobs, setLinkedinJobs] = useState<LinkedInJob[]>([]);
  const [linkedinSearch, setLinkedinSearch] = useState<LinkedInSearch | null>(null);
  const [linkedinPage, setLinkedinPage] = useState(0);
  const [linkedinSearching, setLinkedinSearching] = useState(false);
  const [linkedinHasSearched, setLinkedinHasSearched] = useState(false);
  const [linkedinError, setLinkedinError] = useState<string | null>(null);
  const [linkedinSavedIds, setLinkedinSavedIds] = useState<Set<string>>(new Set());
  const [linkedinSavingId, setLinkedinSavingId] = useState<string | null>(null);

  // Dice real jobs state
  const [diceJobs, setDiceJobs] = useState<DiceJob[]>([]);
  const [diceSearch, setDiceSearch] = useState<DiceSearch | null>(null);
  const [dicePage, setDicePage] = useState(0);
  const [diceSearching, setDiceSearching] = useState(false);
  const [diceHasSearched, setDiceHasSearched] = useState(false);
  const [diceError, setDiceError] = useState<string | null>(null);
  const [diceSavedIds, setDiceSavedIds] = useState<Set<string>>(new Set());
  const [diceSavingId, setDiceSavingId] = useState<string | null>(null);

  // Indeed real jobs state
  const [indeedJobs, setIndeedJobs] = useState<IndeedJob[]>([]);
  const [indeedSearch, setIndeedSearch] = useState<IndeedSearch | null>(null);
  const [indeedPage, setIndeedPage] = useState(0);
  const [indeedSearching, setIndeedSearching] = useState(false);
  const [indeedHasSearched, setIndeedHasSearched] = useState(false);
  const [indeedError, setIndeedError] = useState<string | null>(null);
  const [indeedSavedIds, setIndeedSavedIds] = useState<Set<string>>(new Set());
  const [indeedSavingId, setIndeedSavingId] = useState<string | null>(null);

  // Monster real jobs state
  const [monsterJobs, setMonsterJobs] = useState<MonsterJob[]>([]);
  const [monsterSearch, setMonsterSearch] = useState<MonsterSearch | null>(null);
  const [monsterPage, setMonsterPage] = useState(0);
  const [monsterSearching, setMonsterSearching] = useState(false);
  const [monsterHasSearched, setMonsterHasSearched] = useState(false);
  const [monsterError, setMonsterError] = useState<string | null>(null);
  const [monsterSavedIds, setMonsterSavedIds] = useState<Set<string>>(new Set());
  const [monsterSavingId, setMonsterSavingId] = useState<string | null>(null);

  // CareerBuilder real jobs state
  const [cbJobs, setCbJobs] = useState<CareerBuilderJob[]>([]);
  const [cbSearch, setCbSearch] = useState<CareerBuilderSearch | null>(null);
  const [cbPage, setCbPage] = useState(0);
  const [cbSearching, setCbSearching] = useState(false);
  const [cbHasSearched, setCbHasSearched] = useState(false);
  const [cbError, setCbError] = useState<string | null>(null);
  const [cbSavedIds, setCbSavedIds] = useState<Set<string>>(new Set());
  const [cbSavingId, setCbSavingId] = useState<string | null>(null);

  // Job History state
  const [historyJobs, setHistoryJobs] = useState<HistoryJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyBoardFilter, setHistoryBoardFilter] = useState<'All' | 'LinkedIn' | 'Dice' | 'Indeed' | 'Monster' | 'CareerBuilder'>('All');
  const [historyDateRange, setHistoryDateRange] = useState<'Last 24 hours' | 'Last 7 days' | 'Last 30 days' | 'All time'>('Last 24 hours');
  const [historySearch, setHistorySearch] = useState('');
  const [collapsedBoards, setCollapsedBoards] = useState<Set<string>>(new Set());
  const [selectedBoards, setSelectedBoards] = useState<Set<string>>(new Set(['LinkedIn', 'Dice', 'Indeed', 'Monster']));
  const [boardSelectorOpen, setBoardSelectorOpen] = useState(false);

  // Per-board history state
  const [boardHistoryVisible, setBoardHistoryVisible] = useState<Record<string, boolean>>({});
  const [boardHistoryLimit, setBoardHistoryLimit] = useState<Record<string, number>>({});
  const BOARD_HISTORY_PAGE = 10;

  // Queue status per board
  const [boardQueueStatus, setBoardQueueStatus] = useState<Record<string, { queued: boolean; queue_id: string; position: number; eta_seconds: number } | null>>({});

  // Refresh popup state
  const [refreshPopupBoard, setRefreshPopupBoard] = useState<string | null>(null);
  const [refreshKeyword, setRefreshKeyword] = useState('');
  const [refreshLocation, setRefreshLocation] = useState('');
  const [refreshDateFilter, setRefreshDateFilter] = useState('Last 24 hours');
  const [refreshExperience, setRefreshExperience] = useState('');
  const [refreshJobType, setRefreshJobType] = useState('');
  const [refreshMaxResults, setRefreshMaxResults] = useState(25);

  // Board vote state
  const [boardVotes, setBoardVotes] = useState<Record<string, { id: string; vote_count: number }>>({});
  const [userVotedBoards, setUserVotedBoards] = useState<Set<string>>(new Set());
  const [votingBoard, setVotingBoard] = useState<string | null>(null);
  const [searchCooldowns, setSearchCooldowns] = useState<Record<string, number>>({});
  // refreshTimestamps: { [scopedKey]: number[] } — timestamps of recent paid-plan refreshes
  const [refreshTimestamps, setRefreshTimestamps] = useState<Record<string, number[]>>({});
  const [serverUsageRemaining, setServerUsageRemaining] = useState<number | null>(null);
  const [linkedinColFilter, setLinkedinColFilter] = useState('');
  const [diceColFilter, setDiceColFilter] = useState('');
  const [indeedColFilter, setIndeedColFilter] = useState('');
  const [monsterColFilter, setMonsterColFilter] = useState('');
  const [cbColFilter, setCbColFilter] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');

  const [rewritingJobId, setRewritingJobId] = useState<string | null>(null);
  const [rewriteStatus, setRewriteStatus] = useState<Record<string, 'queued' | 'done' | 'error'>>({});

  const [matchScores, setMatchScores] = useState<Record<string, MatchScore>>({});
  const [scoringJobId, setScoringJobId] = useState<string | null>(null);
  const [expandedScore, setExpandedScore] = useState<string | null>(null);
  const [previewJob, setPreviewJob] = useState<PreviewEntry | null>(null);
  const [previewedIds, setPreviewedIds] = useState<Set<string>>(new Set());

  // Per-profile board cache so results persist when switching back
  interface ProfileBoardCache {
    linkedinSearch: LinkedInSearch | null; linkedinJobs: LinkedInJob[]; linkedinHasSearched: boolean; linkedinSavedIds: Set<string>;
    diceSearch: DiceSearch | null; diceJobs: DiceJob[]; diceHasSearched: boolean; diceSavedIds: Set<string>;
    indeedSearch: IndeedSearch | null; indeedJobs: IndeedJob[]; indeedHasSearched: boolean; indeedSavedIds: Set<string>;
    monsterSearch: MonsterSearch | null; monsterJobs: MonsterJob[]; monsterHasSearched: boolean; monsterSavedIds: Set<string>;
    cbSearch: CareerBuilderSearch | null; cbJobs: CareerBuilderJob[]; cbHasSearched: boolean; cbSavedIds: Set<string>;
    historyJobs: HistoryJob[]; historyLoaded: boolean; profileSearchIds: Set<string> | null;
    matchScores: Record<string, MatchScore>;
    boardHistoryLoaded: Record<string, boolean>;
  }
  const boardCacheRef = useRef<Record<string, ProfileBoardCache>>({});
  const prevProfileIdRef = useRef<string | null>(null);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  const hasActiveSub = subscription?.status === 'active' && (subscription.plan_amount_usd ?? 0) > 0;
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
      const { data, error } = await supabase.functions.invoke('razorpay-create-subscription', {
        body: { plan_amount_usd: selectedNewTier },
      });
      if (error || !data?.subscription_id) throw new Error(error?.message ?? 'Failed to create subscription');
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
      const msg = err instanceof Error ? err.message : 'Failed to start subscription';
      showToast(msg, 'error');
      setSubscribing(false);
    }
  }

  async function handleChangePlan() {
    if (!subscription || selectedNewTier === subscription.plan_amount_usd) return;
    setChangingPlan(true);
    try {
      const isUpgrade = selectedNewTier > subscription.plan_amount_usd;
      const { data, error } = await supabase.functions.invoke('razorpay-change-plan', {
        body: { new_plan_amount_usd: selectedNewTier },
      });
      if (error || !data) throw new Error(error?.message ?? 'Failed to change plan');
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
      const msg = err instanceof Error ? err.message : 'Failed to change plan';
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

  const isPaidPlan = subscription?.status === 'active' && (subscription.plan_amount_usd ?? 0) > 0;
  const boardCooldownKeyByLabel: Record<string, string> = {
    LinkedIn: 'linkedin',
    Dice: 'dice',
    Indeed: 'indeed',
    Monster: 'monster',
    CareerBuilder: 'careerbuilder',
  };
  const selectedProfileSearchScope = selectedProfile?.id ?? 'global';
  const selectedBoardCooldownKeys = Array.from(selectedBoards)
    .map(board => boardCooldownKeyByLabel[board])
    .filter((boardKey): boardKey is string => Boolean(boardKey))
    .map(boardKey => `${selectedProfileSearchScope}:${boardKey}`);

  function getScopedSearchKey(searchKey: string, profileId: string = selectedProfileSearchScope): string {
    return `${profileId}:${searchKey}`;
  }

  function getFreeRefreshWindowKey(): string {
    const scopeKey = account?.id ?? user?.id ?? 'anonymous';
    return `free:${scopeKey}`;
  }

  function getFreeCandidateWindowKey(): string {
    return `free-candidate:${selectedProfileSearchScope}`;
  }

  function getFreeRefreshCountInWindow(): number {
    return getRefreshCountInWindow(getFreeRefreshWindowKey());
  }

  function getFreeCandidateRefreshCountInWindow(): number {
    return getRefreshCountInWindow(getFreeCandidateWindowKey());
  }

  function getFreeWindowRemainingMs(): number {
    const now = Date.now();
    const timestamps = (refreshTimestamps[getFreeRefreshWindowKey()] ?? [])
      .filter(t => now - t < PAID_PLAN_WINDOW_MS)
      .sort((a, b) => a - b);
    if (timestamps.length < FREE_PLAN_DAILY_LIMIT) return 0;
    const oldestTsInWindow = timestamps[0];
    return Math.max(0, oldestTsInWindow + PAID_PLAN_WINDOW_MS - now);
  }

  function getFreeCandidateWindowRemainingMs(): number {
    const now = Date.now();
    const timestamps = (refreshTimestamps[getFreeCandidateWindowKey()] ?? [])
      .filter(t => now - t < PAID_PLAN_WINDOW_MS)
      .sort((a, b) => a - b);
    if (timestamps.length < FREE_PLAN_PER_CANDIDATE_LIMIT) return 0;
    const oldestTsInWindow = timestamps[0];
    return Math.max(0, oldestTsInWindow + PAID_PLAN_WINDOW_MS - now);
  }

  function recordFreeRefreshTimestamp(): void {
    recordRefreshTimestamp(getFreeRefreshWindowKey());
    recordRefreshTimestamp(getFreeCandidateWindowKey());
  }

  function getCooldownRemainingMs(searchKey: string): number {
    if (!isPaidPlan) return 0;
    const cooldownAt = searchCooldowns[searchKey] ?? 0;
    const windowMs = PAID_PLAN_COOLDOWN_MS;
    return Math.max(0, cooldownAt + windowMs - Date.now());
  }

  function getBoardCooldownRemainingMs(boardKey: string): number {
    if (!isPaidPlan) return getFreeWindowRemainingMs();
    return getCooldownRemainingMs(getScopedSearchKey(boardKey));
  }

  function isBoardCooldownActive(boardKey: string): boolean {
    if (isPaidPlan) {
      const scopedKey = getScopedSearchKey(boardKey);
      return getCooldownRemainingMs(scopedKey) > 0;
    }
    return getFreeRefreshCountInWindow() >= FREE_PLAN_DAILY_LIMIT;
  }

  function getRefreshCountInWindow(searchKey: string): number {
    const now = Date.now();
    const timestamps = refreshTimestamps[searchKey] ?? [];
    return timestamps.filter(t => now - t < PAID_PLAN_WINDOW_MS).length;
  }

  // Adds current timestamp to the rolling window array (prunes old ones)
  function recordRefreshTimestamp(searchKey: string) {
    setRefreshTimestamps(prevState => {
      const now = Date.now();
      const prev = prevState[searchKey] ?? [];
      const pruned = prev.filter(t => now - t < PAID_PLAN_WINDOW_MS);
      const next = { ...prevState, [searchKey]: [...pruned, now] };
      try {
        localStorage.setItem(JOB_FINDER_REFRESH_TIMESTAMPS_KEY, JSON.stringify(next));
      } catch {
        // no-op
      }
      return next;
    });
  }

  const selectedBoardCooldownRemainingMs = selectedBoardCooldownKeys
    .map(getCooldownRemainingMs)
    .filter(ms => ms > 0);
  const freeRefreshesUsedInWindow = getFreeRefreshCountInWindow();
  const freeCandidateRefreshesUsedInWindow = getFreeCandidateRefreshCountInWindow();
  const freeRefreshesRemainingInWindow = serverUsageRemaining === null
    ? Math.max(0, FREE_PLAN_DAILY_LIMIT - freeRefreshesUsedInWindow)
    : Math.max(0, serverUsageRemaining);
  const isFreeDailyLimitReached = !isPaidPlan && freeRefreshesUsedInWindow >= FREE_PLAN_DAILY_LIMIT;
  const isFreeCandidateLimitReached = !isPaidPlan && freeCandidateRefreshesUsedInWindow >= FREE_PLAN_PER_CANDIDATE_LIMIT;
  const searchCooldownRemainingMs = selectedBoardCooldownRemainingMs.length > 0
    ? Math.min(...selectedBoardCooldownRemainingMs)
    : (!isPaidPlan
      ? (isFreeCandidateLimitReached ? getFreeCandidateWindowRemainingMs() : getFreeWindowRemainingMs())
      : 0);
  const hasSelectedBoardCooldown = isPaidPlan
    ? selectedBoardCooldownKeys.some(k => getCooldownRemainingMs(getScopedSearchKey(k)) > 0)
    : isFreeDailyLimitReached || isFreeCandidateLimitReached;
  const isSearchCooldownActive = isPaidPlan
    ? selectedBoardCooldownKeys.length > 0 && selectedBoardCooldownKeys.every(k => getCooldownRemainingMs(getScopedSearchKey(k)) > 0)
    : isFreeDailyLimitReached || isFreeCandidateLimitReached;

  const selectedCandidateCooldownStatus = isPaidPlan
    ? (hasSelectedBoardCooldown && selectedBoardCooldownKeys.length > 0
      ? `Next refresh available in ${formatCooldown(searchCooldownRemainingMs)}`
      : null)
    : (isFreeCandidateLimitReached
      ? `Next refresh available in ${formatCooldown(getFreeCandidateWindowRemainingMs())}`
      : null);

  function formatCooldown(ms: number): string {
    if (ms <= 0) return '0m';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.ceil((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours <= 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
  }

  function stampSearchCooldown(searchKey: string) {
    const next = { ...searchCooldowns, [searchKey]: Date.now() };
    setSearchCooldowns(next);
    try {
      localStorage.setItem(JOB_FINDER_SEARCH_COOLDOWN_KEY, JSON.stringify(next));
    } catch {
      // no-op if storage is unavailable
    }
  }


  useEffect(() => { if (account?.id) loadProfiles(); }, [account?.id]);
  useEffect(() => {
    if (!isPaidPlan && maxResults !== 25) {
      setMaxResults(25);
    }
  }, [isPaidPlan, maxResults]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(JOB_FINDER_SEARCH_COOLDOWN_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, number>;
      if (parsed && typeof parsed === 'object') setSearchCooldowns(parsed);
    } catch {
      setSearchCooldowns({});
    }
  }, []);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(JOB_FINDER_REFRESH_TIMESTAMPS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, number[]>;
      if (parsed && typeof parsed === 'object') setRefreshTimestamps(parsed);
    } catch {
      setRefreshTimestamps({});
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadServerUsageRemaining() {
      if (!account?.id || isPaidPlan) {
        setServerUsageRemaining(null);
        return;
      }

      const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('api_usage_log')
        .select('created_at')
        .eq('account_id', account.id)
        .in('function_name', ['linkedin-search', 'dice-search', 'indeed-search', 'monster-search', 'careerbuilder-search'])
        .gte('created_at', sinceIso);

      if (!ignore) {
        if (error) {
          setServerUsageRemaining(null);
        } else {
          const count = (data ?? []).length;
          setServerUsageRemaining(Math.max(0, FREE_PLAN_DAILY_LIMIT - count));
        }
      }
    }

    loadServerUsageRemaining();
    return () => {
      ignore = true;
    };
  }, [account?.id, isPaidPlan]);
  useEffect(() => {
    if (profiles.length === 0) {
      setProfileBoardStats({});
      return;
    }

    async function loadProfileBoardStats() {
      const boardConfigs = [
        ['linkedin_job_searches', 'linkedin_jobs'],
        ['dice_job_searches', 'dice_jobs'],
        ['indeed_job_searches', 'indeed_jobs'],
        ['monster_job_searches', 'monster_jobs'],
        ['careerbuilder_job_searches', 'careerbuilder_jobs'],
      ] as const;

      const searchRowsByBoard: Array<Array<{ id: string; profile_id: string | null; created_at: string | null }>> = [];
      const jobsByBoard: Array<Array<{ id?: string; search_id: string | null }>> = [];

      for (const [searchTable, jobTable] of boardConfigs) {
        const { data: searches } = await supabase.from(searchTable).select('id, profile_id, created_at');
        const searchRows = (searches ?? []) as Array<{ id: string; profile_id: string | null; created_at: string | null }>;
        searchRowsByBoard.push(searchRows);

        const { data: jobs } = await supabase.from(jobTable).select('id, search_id');
        jobsByBoard.push((jobs ?? []) as Array<{ id?: string; search_id: string | null }>);
      }

      const { data: scoreRows } = await supabase
        .from('job_match_scores')
        .select('profile_id, linkedin_job_id, dice_job_id, indeed_job_id, monster_job_id, careerbuilder_job_id');

      const matchedRows = (scoreRows ?? []) as Array<Record<string, unknown>>;
      const statsByProfile = buildProfileBoardStats({
        profiles,
        boardSearches: searchRowsByBoard,
        boardJobs: jobsByBoard,
        scoreRows: matchedRows.map(row => ({
          profile_id: row.profile_id as string | null,
          linkedin_job_id: row.linkedin_job_id as string | null,
          dice_job_id: row.dice_job_id as string | null,
          indeed_job_id: row.indeed_job_id as string | null,
          monster_job_id: row.monster_job_id as string | null,
          careerbuilder_job_id: row.careerbuilder_job_id as string | null,
        })),
      });

      setProfileBoardStats(statsByProfile);
    }

    loadProfileBoardStats();
  }, [profiles]);

  useEffect(() => {
    supabase.from('hotlist').select('profile_id').then(({ data }) => {
      if (data) setHotlistProfileIds(data.map((r: { profile_id: string }) => r.profile_id));
    });
  }, []);
  useEffect(() => { if (user?.id) setTimeout(() => loadBoardVotes(), 3000); }, [user?.id]);

  useEffect(() => {
    if (!profilePickerOpen) return;
    function handle(e: MouseEvent) {
      if (profilePickerRef.current && !profilePickerRef.current.contains(e.target as Node)) {
        setProfilePickerOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [profilePickerOpen]);


  useEffect(() => {
    if (profiles.length === 0) return;
    if (paramProfileId) {
      const found = profiles.find(p => p.id === paramProfileId);
      if (found) { setSelectedProfile(found); return; }
    }
    setSelectedProfile(prev => prev ?? profiles[0]);
  }, [paramProfileId, profiles]);

  useEffect(() => {
    if (!selectedProfile) return;
    const newId = selectedProfile.id;
    const prevId = prevProfileIdRef.current;

    // Save current board state into cache for the previous profile
    if (prevId && prevId !== newId) {
      boardCacheRef.current[prevId] = {
        linkedinSearch, linkedinJobs, linkedinHasSearched, linkedinSavedIds,
        diceSearch, diceJobs, diceHasSearched, diceSavedIds,
        indeedSearch, indeedJobs, indeedHasSearched, indeedSavedIds,
        monsterSearch, monsterJobs, monsterHasSearched, monsterSavedIds,
        cbSearch, cbJobs, cbHasSearched, cbSavedIds,
        historyJobs, historyLoaded, profileSearchIds, matchScores,
        boardHistoryLoaded,
      };
    }

    prevProfileIdRef.current = newId;
    prefillFromProfile(selectedProfile);

    // Restore from cache if available, otherwise reset
    const cached = boardCacheRef.current[newId];
    if (cached) {
      setLinkedinSearch(cached.linkedinSearch);
      setLinkedinJobs(cached.linkedinJobs);
      setLinkedinHasSearched(cached.linkedinHasSearched);
      setLinkedinSavedIds(cached.linkedinSavedIds);
      setDiceSearch(cached.diceSearch);
      setDiceJobs(cached.diceJobs);
      setDiceHasSearched(cached.diceHasSearched);
      setDiceSavedIds(cached.diceSavedIds);
      setIndeedSearch(cached.indeedSearch);
      setIndeedJobs(cached.indeedJobs);
      setIndeedHasSearched(cached.indeedHasSearched);
      setIndeedSavedIds(cached.indeedSavedIds);
      setMonsterSearch(cached.monsterSearch);
      setMonsterJobs(cached.monsterJobs);
      setMonsterHasSearched(cached.monsterHasSearched);
      setMonsterSavedIds(cached.monsterSavedIds);
      setCbSearch(cached.cbSearch);
      setCbJobs(cached.cbJobs);
      setCbHasSearched(cached.cbHasSearched);
      setCbSavedIds(cached.cbSavedIds);
      setHistoryJobs(cached.historyJobs);
      setHistoryLoaded(cached.historyLoaded);
      setProfileSearchIds(cached.profileSearchIds);
      setMatchScores(cached.matchScores);
      setBoardHistoryLoaded(cached.boardHistoryLoaded);
    } else {
      setLinkedinSearch(null);
      setLinkedinJobs([]);
      setLinkedinHasSearched(false);
      setLinkedinSavedIds(new Set());
      setDiceSearch(null);
      setDiceJobs([]);
      setDiceHasSearched(false);
      setDiceSavedIds(new Set());
      setIndeedSearch(null);
      setIndeedJobs([]);
      setIndeedHasSearched(false);
      setIndeedSavedIds(new Set());
      setMonsterSearch(null);
      setMonsterJobs([]);
      setMonsterHasSearched(false);
      setMonsterSavedIds(new Set());
      setCbSearch(null);
      setCbJobs([]);
      setCbHasSearched(false);
      setCbSavedIds(new Set());
      setHistoryJobs([]);
      setHistoryLoaded(false);
      setProfileSearchIds(null);
      setMatchScores({});
      setBoardHistoryLoaded({});
    }
    // Always reset transient UI state
    setLinkedinError(null);
    setDiceError(null);
    setIndeedError(null);
    setMonsterError(null);
    setCbError(null);
    setBoardHistoryVisible({});
    setBoardHistoryLimit({});
    setSearchIdeas([]);
    setSelectedIdeaIndex(null);
    setIdeasPopupOpen(false);
  }, [selectedProfile]);

  // When selected profile changes and History tab is active, fetch search IDs
  useEffect(() => {
    if (!selectedProfile) {
      setProfileSearchIds(null);
      return;
    }
    if (activeTab === 'History') refreshProfileSearchIds(selectedProfile.id);
  }, [selectedProfile?.id, activeTab]);

  // Load history on-demand when History tab is activated
  useEffect(() => {
    if (activeTab === 'History' && historyJobs.length === 0 && !historyLoading) {
      loadHistoryNow();
    }
  }, [activeTab]);


  async function loadHistoryNow() {
    setHistoryLoading(true);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [linkedinRes, diceRes, indeedRes, monsterRes, cbRes] = await throttledAll([
      () => supabase.from('linkedin_jobs').select('*').gte('created_at', thirtyDaysAgo).order('created_at', { ascending: false }).limit(100),
      () => supabase.from('dice_jobs').select('*').gte('created_at', thirtyDaysAgo).order('created_at', { ascending: false }).limit(100),
      () => supabase.from('indeed_jobs').select('*').gte('created_at', thirtyDaysAgo).order('created_at', { ascending: false }).limit(100),
      () => supabase.from('monster_jobs').select('*').gte('created_at', thirtyDaysAgo).order('created_at', { ascending: false }).limit(100),
      () => supabase.from('careerbuilder_jobs').select('*').gte('created_at', thirtyDaysAgo).order('created_at', { ascending: false }).limit(100),
    ]);

    const normalized: HistoryJob[] = [
      ...(linkedinRes.data ?? []).map(j => ({
        id: j.id,
        search_id: j.search_id,
        source: 'linkedin' as const,
        job_title: j.job_title,
        company_name: j.company_name,
        company_logo_url: j.company_logo_url,
        location: j.location,
        salary: j.salary_range,
        employment_type: j.employment_type,
        apply_url: j.apply_url ?? j.job_url,
        job_description: j.job_description,
        created_at: j.created_at,
        raw: j as LinkedInJob,
      })),
      ...(diceRes.data ?? []).map(j => ({
        id: j.id,
        search_id: j.search_id,
        source: 'dice' as const,
        job_title: j.job_title,
        company_name: j.company_name,
        company_logo_url: j.company_logo_url,
        location: j.location,
        salary: j.salary_range,
        employment_type: j.employment_type,
        apply_url: j.job_url,
        job_description: j.job_description,
        created_at: j.created_at,
        raw: j as DiceJob,
      })),
      ...(indeedRes.data ?? []).map(j => ({
        id: j.id,
        search_id: j.search_id,
        source: 'indeed' as const,
        job_title: j.job_title,
        company_name: j.company_name,
        company_logo_url: j.company_logo_url,
        location: j.location_display,
        salary: j.salary_min && j.salary_max
          ? `$${Math.round(j.salary_min / 1000)}K–$${Math.round(j.salary_max / 1000)}K${j.salary_unit === 'YEAR' ? '/yr' : j.salary_unit === 'HOUR' ? '/hr' : ''}`
          : (j.salary_display ?? null),
        employment_type: j.employment_type,
        apply_url: j.apply_url ?? j.job_url,
        job_description: j.job_description,
        created_at: j.created_at,
        raw: j as IndeedJob,
      })),
      ...(monsterRes.data ?? []).map(j => ({
        id: j.id,
        search_id: j.search_id,
        source: 'monster' as const,
        job_title: j.job_title,
        company_name: j.company_name,
        company_logo_url: j.company_logo_url,
        location: j.location_display,
        salary: j.salary_min && j.salary_max
          ? `$${Math.round(j.salary_min / 1000)}K–$${Math.round(j.salary_max / 1000)}K`
          : null,
        employment_type: j.employment_type,
        apply_url: j.apply_url,
        job_description: j.job_description,
        created_at: j.created_at,
        raw: j as MonsterJob,
      })),
      ...(cbRes.data ?? []).map(j => ({
        id: j.id,
        search_id: j.search_id,
        source: 'careerbuilder' as const,
        job_title: j.job_title,
        company_name: j.company_name,
        company_logo_url: null,
        location: j.location_display,
        salary: j.salary_display ?? null,
        employment_type: j.employment_type,
        apply_url: j.apply_url ?? j.job_url,
        job_description: j.job_description,
        created_at: j.created_at,
        raw: j as CareerBuilderJob,
      })),
    ];

    normalized.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    setHistoryJobs(normalized);
    setHistoryPage(0);
    setHistoryLoading(false);
    setHistoryLoaded(true);
  }

  const [boardHistoryLoading, setBoardHistoryLoading] = useState<Record<string, boolean>>({});
  const [boardHistoryLoaded, setBoardHistoryLoaded] = useState<Record<string, boolean>>({});

  async function loadBoardHistory(board: 'linkedin' | 'dice' | 'indeed' | 'monster') {
    if (!selectedProfile) return;
    setBoardHistoryLoading(prev => ({ ...prev, [board]: true }));

    const searchTable = `${board}_job_searches` as const;
    const jobTable = `${board}_jobs` as const;

    const { data: searches } = await throttled(() =>
      supabase.from(searchTable).select('id').eq('profile_id', selectedProfile.id)
    );

    const searchIds = (searches ?? []).map((s: { id: string }) => s.id);

    if (searchIds.length === 0) {
      setBoardHistoryLoading(prev => ({ ...prev, [board]: false }));
      setBoardHistoryLoaded(prev => ({ ...prev, [board]: true }));
      return;
    }

    const { data: jobs } = await throttled(() =>
      supabase.from(jobTable).select('*').in('search_id', searchIds).order('created_at', { ascending: false }).limit(100)
    );

    if (jobs && jobs.length > 0) {
      const normalized: HistoryJob[] = jobs.map((j: any) => ({
        id: j.id,
        search_id: j.search_id,
        source: board as any,
        job_title: j.job_title,
        company_name: j.company_name,
        company_logo_url: j.company_logo_url ?? null,
        location: board === 'linkedin' ? j.location : j.location_display ?? j.location,
        salary: board === 'linkedin' || board === 'dice' ? j.salary_range :
          (j.salary_min && j.salary_max ? `$${Math.round(j.salary_min / 1000)}K-$${Math.round(j.salary_max / 1000)}K` : (j.salary_display ?? null)),
        employment_type: j.employment_type,
        apply_url: j.apply_url ?? j.job_url,
        job_description: j.job_description,
        created_at: j.created_at,
        raw: j,
      }));

      const boardJobColumn: Record<'linkedin' | 'dice' | 'indeed' | 'monster', string> = {
        linkedin: 'linkedin_job_id',
        dice: 'dice_job_id',
        indeed: 'indeed_job_id',
        monster: 'monster_job_id',
      };
      const jobIds = normalized.map(job => job.id).filter(Boolean);

      if (jobIds.length > 0) {
        const scoreColumn = boardJobColumn[board];
        const { data: existingScores } = await throttled(() =>
          supabase
            .from('job_match_scores')
            .select(`score, summary, strengths, gaps, score_breakdown, ${scoreColumn}`)
            .eq('profile_id', selectedProfile.id)
            .in(scoreColumn, jobIds)
        );

        if (existingScores && existingScores.length > 0) {
          const hydrated = (existingScores as Array<Record<string, any>>).reduce<Record<string, MatchScore>>((acc, row) => {
            const jobId = row[scoreColumn] as string | null;
            if (!jobId) return acc;
            acc[jobId] = {
              score: Number(row.score ?? 0),
              summary: String(row.summary ?? ''),
              strengths: Array.isArray(row.strengths) ? row.strengths : [],
              gaps: Array.isArray(row.gaps) ? row.gaps : [],
              score_breakdown: row.score_breakdown && typeof row.score_breakdown === 'object' ? row.score_breakdown : undefined,
              cached: true,
            };
            return acc;
          }, {});

          if (Object.keys(hydrated).length > 0) {
            setMatchScores(prev => ({ ...prev, ...hydrated }));
          }
        }
      }

      setHistoryJobs(prev => {
        const existing = prev.filter(h => h.source !== board);
        return [...existing, ...normalized].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      });
      if (!historyLoaded) setHistoryLoaded(true);
    }

    setBoardHistoryLoading(prev => ({ ...prev, [board]: false }));
    setBoardHistoryLoaded(prev => ({ ...prev, [board]: true }));
  }

  function getHistoryMatchScore(hJob: HistoryJob) {
    if (hJob.source === 'linkedin') return getMatchScore(hJob.raw as LinkedInJob);
    if (hJob.source === 'dice') return getDiceMatchScore(hJob.raw as DiceJob);
    if (hJob.source === 'monster') return getMonsterMatchScore(hJob.raw as MonsterJob);
    if (hJob.source === 'careerbuilder') return getCbMatchScore(hJob.raw as CareerBuilderJob);
    return getIndeedMatchScore(hJob.raw as IndeedJob);
  }

  function saveHistoryJob(hJob: HistoryJob) {
    if (hJob.source === 'linkedin') return saveLinkedInJob(hJob.raw as LinkedInJob);
    if (hJob.source === 'dice') return saveDiceJob(hJob.raw as DiceJob);
    if (hJob.source === 'monster') return saveMonsterJob(hJob.raw as MonsterJob);
    if (hJob.source === 'careerbuilder') return saveCbJob(hJob.raw as CareerBuilderJob);
    return saveIndeedJob(hJob.raw as IndeedJob);
  }

  function isHistoryJobSaved(hJob: HistoryJob): boolean {
    if (hJob.source === 'linkedin') return linkedinSavedIds.has(hJob.id);
    if (hJob.source === 'dice') return diceSavedIds.has(hJob.id);
    if (hJob.source === 'monster') return monsterSavedIds.has(hJob.id);
    if (hJob.source === 'careerbuilder') return cbSavedIds.has(hJob.id);
    return indeedSavedIds.has(hJob.id);
  }

  function isHistoryJobSaving(hJob: HistoryJob): boolean {
    if (hJob.source === 'linkedin') return linkedinSavingId === hJob.id;
    if (hJob.source === 'dice') return diceSavingId === hJob.id;
    if (hJob.source === 'monster') return monsterSavingId === hJob.id;
    if (hJob.source === 'careerbuilder') return cbSavingId === hJob.id;
    return indeedSavingId === hJob.id;
  }

  function prefillFromProfile(p: Profile) {
    if (p.target_role) setKeyword(p.target_role);
    const loc = p.location ||
      [p.city, p.state].filter(Boolean).join(', ') ||
      (p.preferred_locations ? firstPreferredLocation(p.preferred_locations) : '');
    setLocation(loc);

    setDateFilter('Last 24 hours');
    const yrs = p.years_experience;
    if (yrs != null) {
      if (yrs <= 2) setExperienceLevel('Entry level');
      else if (yrs <= 5) setExperienceLevel('Mid level');
      else if (yrs <= 10) setExperienceLevel('Senior level');
      else setExperienceLevel('Executive');
    }

    const wt = (p.work_type || '').toLowerCase();
    const types: string[] = [];
    if (wt.includes('remote')) types.push('Remote');
    if (wt.includes('full')) types.push('Full-time');
    if (wt.includes('part')) types.push('Part-time');
    if (wt.includes('contract')) types.push('Contract');
    setSelectedJobTypes(types);

    setFiltersFromProfile(true);
  }

  async function loadProfiles() {
    setProfilesLoading(true);
    const { data } = await throttled(() => supabase.from('profiles').select('*').order('updated_at', { ascending: false }));
    setProfiles(data ?? []);
    setProfilesLoading(false);
  }

  async function loadBoardVotes() {
    const { data: requests } = await throttled(() => supabase
      .from('feature_requests')
      .select('id, title, vote_count')
      .like('title', 'Job Board: %'));
    const votes: Record<string, { id: string; vote_count: number }> = {};
    (requests ?? []).forEach((r: { id: string; title: string; vote_count: number }) => {
      const board = r.title.replace('Job Board: ', '');
      votes[board] = { id: r.id, vote_count: r.vote_count };
    });
    setBoardVotes(votes);

    if (!user?.id) return;
    const ids = Object.values(votes).map(v => v.id);
    if (ids.length === 0) return;
    const { data: myVotes } = await throttled(() => supabase
      .from('feature_request_votes')
      .select('request_id')
      .in('request_id', ids)
      .eq('user_id', user.id));
    const voted = new Set<string>();
    (myVotes ?? []).forEach((v: { request_id: string }) => {
      const entry = Object.entries(votes).find(([, val]) => val.id === v.request_id);
      if (entry) voted.add(entry[0]);
    });
    setUserVotedBoards(voted);
  }

  async function voteForBoard(boardName: string) {
    if (!user?.id || userVotedBoards.has(boardName) || votingBoard) return;
    setVotingBoard(boardName);
    try {
      const existing = boardVotes[boardName];
      let requestId: string;

      if (!existing) {
        const { data, error } = await supabase
          .from('feature_requests')
          .insert({ title: `Job Board: ${boardName}`, description: `Add ${boardName} as a job board in Job Finder`, user_id: user.id, vote_count: 1 })
          .select('id, vote_count')
          .single();
        if (error || !data) throw error;
        requestId = data.id;
        setBoardVotes(prev => ({ ...prev, [boardName]: { id: data.id, vote_count: 1 } }));
      } else {
        requestId = existing.id;
        await supabase
          .from('feature_requests')
          .update({ vote_count: existing.vote_count + 1 })
          .eq('id', existing.id);
        setBoardVotes(prev => ({ ...prev, [boardName]: { ...existing, vote_count: existing.vote_count + 1 } }));
      }

      await supabase.from('feature_request_votes').insert({ request_id: requestId, user_id: user.id });
      setUserVotedBoards(prev => new Set([...prev, boardName]));
    } catch {
      // ignore
    } finally {
      setVotingBoard(null);
    }
  }

  async function refreshProfileSearchIds(pid: string) {
    const [li, di, ii, mi, ci] = await throttledAll([
      () => supabase.from('linkedin_job_searches').select('id').eq('profile_id', pid),
      () => supabase.from('dice_job_searches').select('id').eq('profile_id', pid),
      () => supabase.from('indeed_job_searches').select('id').eq('profile_id', pid),
      () => supabase.from('monster_job_searches').select('id').eq('profile_id', pid),
      () => supabase.from('careerbuilder_job_searches').select('id').eq('profile_id', pid),
    ]);
    setProfileSearchIds(new Set<string>([
      ...(li.data ?? []).map((r: { id: string }) => r.id),
      ...(di.data ?? []).map((r: { id: string }) => r.id),
      ...(ii.data ?? []).map((r: { id: string }) => r.id),
      ...(mi.data ?? []).map((r: { id: string }) => r.id),
      ...(ci.data ?? []).map((r: { id: string }) => r.id),
    ]));
  }

  function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (activeTab === 'History') return;
    if (activeTab === 'LinkedIn') {
      triggerBoardSearch('linkedin');
    } else if (activeTab === 'Dice') {
      triggerBoardSearch('dice');
    } else if (activeTab === 'Indeed') {
      triggerBoardSearch('indeed');
    } else if (activeTab === 'Monster') {
      triggerBoardSearch('monster');
    } else if (activeTab === 'CareerBuilder') {
      triggerBoardSearch('careerbuilder');
    } else {
      runMockSearch();
    }
  }

  async function generateSearchIdeas() {
    if (!selectedProfile) return;
    setIdeasLoading(true);
    setIdeasError(null);
    setSearchIdeas([]);
    setSelectedIdeaIndex(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      const res = await fetch(`${supabaseUrl}/functions/v1/generate-search-ideas`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'Apikey': supabaseKey,
        },
        body: JSON.stringify({ profile_id: selectedProfile.id, account_id: account?.id ?? null }),
      });

      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      const ideas = data.ideas;
      if (!Array.isArray(ideas) || ideas.length === 0) throw new Error('No ideas returned');
      setSearchIdeas(ideas);
    } catch (err) {
      setIdeasError(err instanceof Error ? err.message : 'Failed to generate ideas');
    } finally {
      setIdeasLoading(false);
    }
  }

  function applyIdea(idea: SearchIdea, idx: number) {
    setKeyword(idea.keyword);
    setLocation(idea.location);
    setSelectedJobTypes(idea.jobTypes ?? []);
    setExperienceLevel(idea.experienceLevel ?? '');
    setFiltersFromProfile(true);
    setSelectedIdeaIndex(idx);
    // Switch away from History tab so search is runnable
    if (activeTab === 'History') setActiveTab('LinkedIn');
  }

  function getIdeasPopupStyle() {
    const popupWidth = 288;
    const popupMaxHeight = Math.round(window.innerHeight * 0.5);
    const buttonRect = ideasBtnRef.current?.getBoundingClientRect();
    const left = buttonRect ? Math.min(Math.max(12, buttonRect.left), Math.max(12, window.innerWidth - popupWidth - 12)) : 12;
    const top = buttonRect ? Math.min(buttonRect.bottom + 6, Math.max(12, window.innerHeight - popupMaxHeight - 12)) : 12;
    return { top, left };
  }

  function searchAll() {
    if (!isPaidPlan && !beginDailySearch('all-candidates')) {
      return;
    }

    let hasAvailableBoard = false;
    if (selectedBoards.has('LinkedIn') && (isPaidPlan ? getCooldownRemainingMs(getScopedSearchKey('linkedin')) <= 0 : true)) {
      hasAvailableBoard = true;
      triggerBoardSearch('linkedin', false, !isPaidPlan);
    }
    if (selectedBoards.has('Dice') && (isPaidPlan ? getCooldownRemainingMs(getScopedSearchKey('dice')) <= 0 : true)) {
      hasAvailableBoard = true;
      triggerBoardSearch('dice', false, !isPaidPlan);
    }
    if (selectedBoards.has('Indeed') && (isPaidPlan ? getCooldownRemainingMs(getScopedSearchKey('indeed')) <= 0 : true)) {
      hasAvailableBoard = true;
      triggerBoardSearch('indeed', false, !isPaidPlan);
    }
    if (selectedBoards.has('Monster') && (isPaidPlan ? getCooldownRemainingMs(getScopedSearchKey('monster')) <= 0 : true)) {
      hasAvailableBoard = true;
      triggerBoardSearch('monster', false, !isPaidPlan);
    }
    if (selectedBoards.has('CareerBuilder') && (isPaidPlan ? getCooldownRemainingMs(getScopedSearchKey('careerbuilder')) <= 0 : true)) {
      hasAvailableBoard = true;
      triggerBoardSearch('careerbuilder', false, !isPaidPlan);
    }

    if (!hasAvailableBoard && !isPaidPlan) {
      showToast(isFreeCandidateLimitReached
        ? 'This candidate has already used 1 refresh in the last 24 hours.'
        : 'You have used all your refreshes in the last 24 hours, please upgrade to get more.', 'error');
    }
  }

  function beginDailySearch(searchKey: string): boolean {
    const scopedSearchKey = getScopedSearchKey(searchKey);

    if (isPaidPlan) {
      const cooldownRemaining = getCooldownRemainingMs(scopedSearchKey);
      if (cooldownRemaining > 0) {
        showToast(`Please wait ${formatCooldown(cooldownRemaining)} before refreshing again.`, 'error');
        return false;
      }
      stampSearchCooldown(scopedSearchKey);
      return true;
    }

    return true;
  }

  function triggerBoardSearch(
    board: 'linkedin' | 'dice' | 'indeed' | 'monster' | 'careerbuilder',
    forceRefresh = false,
    skipQuotaCheck = false,
  ) {
    if (!skipQuotaCheck && !beginDailySearch(board)) return;
    if (board === 'linkedin') runLinkedInSearch(forceRefresh);
    else if (board === 'dice') runDiceSearch(forceRefresh);
    else if (board === 'indeed') runIndeedSearch(forceRefresh);
    else if (board === 'monster') runMonsterSearch(forceRefresh);
    else runCbSearch(forceRefresh);
  }

  function toggleCollapseBoard(id: string) {
    setCollapsedBoards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleBoardSelection(id: string) {
    setSelectedBoards(prev => {
      const next = new Set(prev);
      if (next.has(id) && next.size > 1) next.delete(id); else next.add(id);
      return next;
    });
  }


  function runMockSearch() {
    setMockSearching(true);
    setMockHasSearched(true);
    setTimeout(() => {
      const generated = generateMockJobs(keyword, location, 48).filter(j => j.board !== 'LinkedIn');
      setAllJobs(generated);
      setMockSearching(false);
    }, 900);
  }

  async function runLinkedInSearch(forceRefresh = false, excludedIds?: string[]) {
    setLinkedinSearching(true);
    setLinkedinHasSearched(true);
    setLinkedinError(null);
    setLinkedinPage(0);
    setLinkedinJobs([]);
    setLinkedinSearch(null);

    try {
      const empType = selectedJobTypes.filter(t => t !== 'Remote')[0] ?? '';
      const workArr = selectedJobTypes.includes('Remote') ? 'Remote' : '';

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      const res = await fetch(`${supabaseUrl}/functions/v1/linkedin-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
          'Apikey': supabaseKey,
        },
        body: JSON.stringify({
          job_title: keyword,
          location,
          posted_within: POSTED_WITHIN_MAP[dateFilter] ?? 'Any Time',
          experience_level: experienceLevel ? (EXPERIENCE_MAP[experienceLevel] ?? '') : '',
          employment_type: empType,
          work_arrangement: workArr,
          account_id: account?.id ?? null,
          user_id: user?.id ?? null,
          force_refresh: forceRefresh,
          excluded_job_ids: excludedIds ?? null,
          max_results: maxResults,
        }),
      });

      const data = await res.json();

      // Handle queue response
      if (res.status === 202 && data.queued) {
        setBoardQueueStatus(prev => ({ ...prev, linkedin: { queued: true, queue_id: data.queue_id, position: data.position, eta_seconds: data.eta_seconds } }));
        setLinkedinSearching(false);
        return;
      }

      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);

      setBoardQueueStatus(prev => ({ ...prev, linkedin: null }));
      setLinkedinJobs(data.jobs ?? []);
      setLinkedinSearch(data.search ?? null);
      if (selectedProfile && data.search?.id) {
        await supabase.from('linkedin_job_searches').update({ profile_id: selectedProfile.id }).eq('id', data.search.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLinkedinError(msg);
      showToast(`LinkedIn search failed: ${msg}`, 'error');
    } finally {
      setLinkedinSearching(false);
    }
  }

  async function runDiceSearch(forceRefresh = false, excludedIds?: string[]) {
    setDiceSearching(true);
    setDiceHasSearched(true);
    setDiceError(null);
    setDicePage(0);
    setDiceJobs([]);
    setDiceSearch(null);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

      const res = await fetch(`${supabaseUrl}/functions/v1/dice-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
          'Apikey': supabaseKey,
        },
        body: JSON.stringify({
          keyword,
          location,
          posted_date: dateFilter,
          account_id: account?.id ?? null,
          user_id: user?.id ?? null,
          force_refresh: forceRefresh,
          excluded_job_ids: excludedIds ?? null,
          max_results: maxResults,
        }),
      });

      const data = await res.json();

      if (res.status === 202 && data.queued) {
        setBoardQueueStatus(prev => ({ ...prev, dice: { queued: true, queue_id: data.queue_id, position: data.position, eta_seconds: data.eta_seconds } }));
        setDiceSearching(false);
        return;
      }

      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);

      setBoardQueueStatus(prev => ({ ...prev, dice: null }));
      setDiceJobs(data.jobs ?? []);
      setDiceSearch(data.search ?? null);
      if (selectedProfile && data.search?.id) {
        await supabase.from('dice_job_searches').update({ profile_id: selectedProfile.id }).eq('id', data.search.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDiceError(msg);
      showToast(`Dice search failed: ${msg}`, 'error');
    } finally {
      setDiceSearching(false);
    }
  }

  async function saveDiceJob(job: DiceJob) {
    if (!selectedProfile) { showToast('Select a source profile first to save jobs', 'error'); return; }
    if (diceSavedIds.has(job.id)) return;
    setDiceSavingId(job.id);
    const { error } = await supabase.from('wishlisted_jobs').insert({
      profile_id: selectedProfile.id,
      job_title: job.job_title ?? 'Untitled',
      company: job.company_name ?? 'Unknown',
      board: 'Dice',
      location: job.location ?? '',
      job_url: job.job_url ?? null,
      source_job_id: job.id,
      status: 'New',
    });
    if (error) { showToast('Failed to save job', 'error'); setDiceSavingId(null); return; }
    await supabase.from('activity_logs').insert({
      profile_id: selectedProfile.id, event_type: 'job_wishlisted',
      description: `Added "${job.job_title ?? 'job'}" at ${job.company_name ?? 'company'} (Dice) to submission queue`,
    });
    setDiceSavedIds(prev => new Set([...prev, job.id]));
    setDiceSavingId(null);
    showToast(`Added "${job.job_title}" to ${selectedProfile.candidate_name}'s queue`);
  }

  function handleQueuedScore(localJobId: string, jobQueueId: string) {
    setMatchScores(prev => ({ ...prev, [localJobId]: { queued: true, job_id: jobQueueId, score: 0, summary: '', strengths: [], gaps: [] } }));
    setScoringJobId(null);
    showToast('AI scoring queued — score will appear automatically when ready.', 'success');

    let attempts = 0;
    const maxAttempts = DEFAULT_AI_SCORING_MAX_ATTEMPTS;
    const poll = window.setInterval(async () => {
      attempts += 1;
      const { data: qj } = await supabase
        .from('llm_job_queue')
        .select('id, status, result, error')
        .eq('id', jobQueueId)
        .maybeSingle();

      const state = getAiScoringQueueState(qj?.status ?? null, attempts, maxAttempts);
      if (state === 'completed' && qj?.result) {
        clearInterval(poll);
        setMatchScores(prev => ({ ...prev, [localJobId]: qj.result as MatchScore }));
        return;
      }

      if (state === 'failed') {
        clearInterval(poll);
        setMatchScores(prev => { const n = { ...prev }; delete n[localJobId]; return n; });
        showToast('AI scoring timed out or failed. Please try again later.', 'error');
      }
    }, DEFAULT_AI_SCORING_POLL_MS);
  }

  async function getDiceMatchScore(job: DiceJob) {
    if (!selectedProfile) { showToast('Select a source profile first to score jobs', 'error'); return; }
    if (scoringJobId) return;
    if (matchScores[job.id] && !matchScores[job.id].queued) { setExpandedScore(prev => prev === job.id ? null : job.id); return; }
    setScoringJobId(job.id);
    setExpandedScore(job.id);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/score-job-match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
          'Apikey': supabaseKey,
        },
        body: JSON.stringify({ profile_id: selectedProfile.id, dice_job_id: job.id, account_id: account?.id ?? null }),
      });
      const data = await res.json();
      if (res.status === 202 && data.queued) { handleQueuedScore(job.id, data.job_id); return; }
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMatchScores(prev => ({ ...prev, [job.id]: data }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Match score failed: ${msg}`, 'error');
      setExpandedScore(null);
    } finally {
      setScoringJobId(null);
    }
  }

  async function runIndeedSearch(forceRefresh = false, excludedIds?: string[]) {
    setIndeedSearching(true);
    setIndeedHasSearched(true);
    setIndeedError(null);
    setIndeedPage(0);
    setIndeedJobs([]);
    setIndeedSearch(null);
    try {
      const indeedKeyword = buildIndeedKeyword(keyword, selectedProfile, Boolean(selectedProfile));
      const { jobType, remote } = getIndeedSearchFilters(selectedJobTypes);
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/indeed-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}`, 'Apikey': supabaseKey },
        body: JSON.stringify({ keyword: indeedKeyword, location, date_posted: dateFilter, job_type: jobType, remote, account_id: account?.id ?? null, user_id: user?.id ?? null, force_refresh: forceRefresh, excluded_job_ids: excludedIds ?? null, max_results: maxResults }),
      });
      const data = await res.json();

      if (res.status === 202 && data.queued) {
        setBoardQueueStatus(prev => ({ ...prev, indeed: { queued: true, queue_id: data.queue_id, position: data.position, eta_seconds: data.eta_seconds } }));
        setIndeedSearching(false);
        return;
      }

      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setBoardQueueStatus(prev => ({ ...prev, indeed: null }));
      setIndeedJobs(data.jobs ?? []);
      setIndeedSearch(data.search ?? null);
      if (selectedProfile && data.search?.id) {
        await supabase.from('indeed_job_searches').update({ profile_id: selectedProfile.id }).eq('id', data.search.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setIndeedError(msg);
      showToast(`Indeed search failed: ${msg}`, 'error');
    } finally {
      setIndeedSearching(false);
    }
  }

  async function saveIndeedJob(job: IndeedJob) {
    if (!selectedProfile) { showToast('Select a source profile first to save jobs', 'error'); return; }
    if (indeedSavedIds.has(job.id)) return;
    setIndeedSavingId(job.id);
    const { error } = await supabase.from('wishlisted_jobs').insert({
      profile_id: selectedProfile.id,
      job_title: job.job_title ?? 'Untitled',
      company: job.company_name ?? 'Unknown',
      board: 'Indeed',
      location: job.location_display ?? '',
      job_url: job.job_url ?? null,
      source_job_id: job.id,
      status: 'New',
    });
    if (error) { showToast('Failed to save job', 'error'); setIndeedSavingId(null); return; }
    await supabase.from('activity_logs').insert({
      profile_id: selectedProfile.id, event_type: 'job_wishlisted',
      description: `Added "${job.job_title ?? 'job'}" at ${job.company_name ?? 'company'} (Indeed) to submission queue`,
    });
    setIndeedSavedIds(prev => new Set([...prev, job.id]));
    setIndeedSavingId(null);
    showToast(`Added "${job.job_title}" to ${selectedProfile.candidate_name}'s queue`);
  }

  async function getIndeedMatchScore(job: IndeedJob) {
    if (!selectedProfile) { showToast('Select a source profile first to score jobs', 'error'); return; }
    if (scoringJobId) return;
    if (matchScores[job.id] && !matchScores[job.id].queued) { setExpandedScore(prev => prev === job.id ? null : job.id); return; }
    setScoringJobId(job.id);
    setExpandedScore(job.id);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/score-job-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}`, 'Apikey': supabaseKey },
        body: JSON.stringify({ profile_id: selectedProfile.id, indeed_job_id: job.id, account_id: account?.id ?? null }),
      });
      const data = await res.json();
      if (res.status === 202 && data.queued) { handleQueuedScore(job.id, data.job_id); return; }
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMatchScores(prev => ({ ...prev, [job.id]: data }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Match score failed: ${msg}`, 'error');
      setExpandedScore(null);
    } finally {
      setScoringJobId(null);
    }
  }

  async function runMonsterSearch(forceRefresh = false, excludedIds?: string[]) {
    setMonsterSearching(true);
    setMonsterHasSearched(true);
    setMonsterError(null);
    setMonsterPage(0);
    setMonsterJobs([]);
    setMonsterSearch(null);
    try {
      const monsterKeyword = buildMonsterQuery(keyword, selectedProfile, selectedJobTypes, Boolean(selectedProfile));
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/monster-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}`, 'Apikey': supabaseKey },
        body: JSON.stringify({ keyword: monsterKeyword, location, date_posted: dateFilter, account_id: account?.id ?? null, user_id: user?.id ?? null, force_refresh: forceRefresh, excluded_job_ids: excludedIds ?? null, max_results: maxResults }),
      });
      const data = await res.json();

      if (res.status === 202 && data.queued) {
        setBoardQueueStatus(prev => ({ ...prev, monster: { queued: true, queue_id: data.queue_id, position: data.position, eta_seconds: data.eta_seconds } }));
        setMonsterSearching(false);
        return;
      }

      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setBoardQueueStatus(prev => ({ ...prev, monster: null }));
      setMonsterJobs(data.jobs ?? []);
      setMonsterSearch(data.search ?? null);
      if (selectedProfile && data.search?.id) {
        await supabase.from('monster_job_searches').update({ profile_id: selectedProfile.id }).eq('id', data.search.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMonsterError(msg);
      showToast(`Monster search failed: ${msg}`, 'error');
    } finally {
      setMonsterSearching(false);
    }
  }

  async function saveMonsterJob(job: MonsterJob) {
    if (!selectedProfile) { showToast('Select a source profile first to save jobs', 'error'); return; }
    if (monsterSavedIds.has(job.id)) return;
    setMonsterSavingId(job.id);
    const { error } = await supabase.from('wishlisted_jobs').insert({
      profile_id: selectedProfile.id,
      job_title: job.job_title ?? 'Untitled',
      company: job.company_name ?? 'Unknown',
      board: 'Monster',
      location: job.location_display ?? '',
      job_url: job.apply_url ?? null,
      source_job_id: job.id,
      status: 'New',
    });
    if (error) { showToast('Failed to save job', 'error'); setMonsterSavingId(null); return; }
    await supabase.from('activity_logs').insert({
      profile_id: selectedProfile.id, event_type: 'job_wishlisted',
      description: `Added "${job.job_title ?? 'job'}" at ${job.company_name ?? 'company'} (Monster) to submission queue`,
    });
    setMonsterSavedIds(prev => new Set([...prev, job.id]));
    setMonsterSavingId(null);
    showToast(`Added "${job.job_title}" to ${selectedProfile.candidate_name}'s queue`);
  }

  async function getMonsterMatchScore(job: MonsterJob) {
    if (!selectedProfile) { showToast('Select a source profile first to score jobs', 'error'); return; }
    if (scoringJobId) return;
    if (matchScores[job.id] && !matchScores[job.id].queued) { setExpandedScore(prev => prev === job.id ? null : job.id); return; }
    setScoringJobId(job.id);
    setExpandedScore(job.id);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/score-job-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}`, 'Apikey': supabaseKey },
        body: JSON.stringify({ profile_id: selectedProfile.id, monster_job_id: job.id, account_id: account?.id ?? null }),
      });
      const data = await res.json();
      if (res.status === 202 && data.queued) { handleQueuedScore(job.id, data.job_id); return; }
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMatchScores(prev => ({ ...prev, [job.id]: data }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Match score failed: ${msg}`, 'error');
      setExpandedScore(null);
    } finally {
      setScoringJobId(null);
    }
  }

  async function runCbSearch(forceRefresh = false, excludedIds?: string[]) {
    setCbSearching(true);
    setCbHasSearched(true);
    setCbError(null);
    setCbPage(0);
    setCbJobs([]);
    setCbSearch(null);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/careerbuilder-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}`, 'Apikey': supabaseKey },
        body: JSON.stringify({ keyword, location, date_posted: dateFilter, account_id: account?.id ?? null, user_id: user?.id ?? null, force_refresh: forceRefresh, excluded_job_ids: excludedIds ?? null, max_results: maxResults }),
      });
      const data = await res.json();

      if (res.status === 202 && data.queued) {
        setBoardQueueStatus(prev => ({ ...prev, careerbuilder: { queued: true, queue_id: data.queue_id, position: data.position, eta_seconds: data.eta_seconds } }));
        setCbSearching(false);
        return;
      }

      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setBoardQueueStatus(prev => ({ ...prev, careerbuilder: null }));
      setCbJobs(data.jobs ?? []);
      setCbSearch(data.search ?? null);
      if (selectedProfile && data.search?.id) {
        await supabase.from('careerbuilder_job_searches').update({ profile_id: selectedProfile.id }).eq('id', data.search.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCbError(msg);
      showToast(`CareerBuilder search failed: ${msg}`, 'error');
    } finally {
      setCbSearching(false);
    }
  }

  function refreshLinkedIn() {
    openRefreshPopup('linkedin');
  }

  function refreshDice() {
    openRefreshPopup('dice');
  }

  function refreshIndeed() {
    openRefreshPopup('indeed');
  }

  function refreshMonster() {
    openRefreshPopup('monster');
  }

  function refreshCb() {
    openRefreshPopup('careerbuilder');
  }

  function openRefreshPopup(board: string) {
    setRefreshKeyword(keyword);
    setRefreshLocation(location);
    setRefreshDateFilter(dateFilter);
    setRefreshExperience(experienceLevel);
    setRefreshJobType(selectedJobTypes[0] ?? '');
    setRefreshMaxResults(maxResults);
    setRefreshPopupBoard(board);
  }

  const refreshPopupScopedKey = refreshPopupBoard ? getScopedSearchKey(refreshPopupBoard) : null;
  const refreshPopupCooldownRemainingMs = refreshPopupBoard ? getBoardCooldownRemainingMs(refreshPopupBoard) : 0;
  const refreshPopupCooldownActive = isPaidPlan
    ? refreshPopupCooldownRemainingMs > 0
    : isFreeDailyLimitReached || isFreeCandidateLimitReached;

  function executeRefresh() {
    if (!refreshPopupBoard) return;
    if (!beginDailySearch(refreshPopupBoard)) {
      setRefreshPopupBoard(null);
      return;
    }
    const board = refreshPopupBoard;
    const k = refreshKeyword;
    const l = refreshLocation;
    const d = refreshDateFilter;
    const exp = refreshExperience;
    const jt = refreshJobType;
    const mr = refreshMaxResults;
    setKeyword(k);
    setLocation(l);
    setDateFilter(d);
    setExperienceLevel(exp);
    setSelectedJobTypes(jt ? [jt] : []);
    setMaxResults(mr);
    setRefreshPopupBoard(null);
    doRefreshSearch(board, k, l, d, exp, jt, mr);
  }

  async function doRefreshSearch(board: string, k: string, l: string, d: string, exp: string, jt: string, mr: number) {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}`, 'Apikey': supabaseKey };
    const baseBody = { keyword: k, location: l, account_id: account?.id ?? null, user_id: user?.id ?? null, force_refresh: false, max_results: mr };

    if (board === 'linkedin') {
      setLinkedinSearching(true); setLinkedinHasSearched(true); setLinkedinError(null);
      try {
        const empType = jt && jt !== 'Remote' ? jt : '';
        const workArr = jt === 'Remote' ? 'Remote' : '';
        const res = await fetch(`${supabaseUrl}/functions/v1/linkedin-search`, { method: 'POST', headers, body: JSON.stringify({ job_title: k, location: l, posted_within: POSTED_WITHIN_MAP[d] ?? 'Any Time', experience_level: exp ? (EXPERIENCE_MAP[exp] ?? '') : '', employment_type: empType, work_arrangement: workArr, account_id: account?.id ?? null, user_id: user?.id ?? null, force_refresh: false, excluded_job_ids: linkedinJobs.map(j => j.id), max_results: mr }) });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        setLinkedinJobs(prev => [...prev, ...(data.jobs ?? [])]);
      } catch (err) { setLinkedinError(err instanceof Error ? err.message : String(err)); } finally { setLinkedinSearching(false); }
    } else if (board === 'dice') {
      setDiceSearching(true); setDiceHasSearched(true); setDiceError(null);
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/dice-search`, { method: 'POST', headers, body: JSON.stringify({ ...baseBody, posted_date: d, excluded_job_ids: diceJobs.map(j => j.id) }) });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        setDiceJobs(prev => [...prev, ...(data.jobs ?? [])]);
      } catch (err) { setDiceError(err instanceof Error ? err.message : String(err)); } finally { setDiceSearching(false); }
    } else if (board === 'indeed') {
      setIndeedSearching(true); setIndeedHasSearched(true); setIndeedError(null);
      try {
        const indeedKeyword = buildIndeedKeyword(k, selectedProfile, Boolean(selectedProfile));
        const { jobType, remote } = getIndeedSearchFilters(jt ? [jt] : []);
        const res = await fetch(`${supabaseUrl}/functions/v1/indeed-search`, { method: 'POST', headers, body: JSON.stringify({ ...baseBody, keyword: indeedKeyword, date_posted: d, job_type: jobType, remote, excluded_job_ids: indeedJobs.map(j => j.id) }) });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        setIndeedJobs(prev => [...prev, ...(data.jobs ?? [])]);
      } catch (err) { setIndeedError(err instanceof Error ? err.message : String(err)); } finally { setIndeedSearching(false); }
    } else if (board === 'monster') {
      setMonsterSearching(true); setMonsterHasSearched(true); setMonsterError(null);
      try {
        const monsterKeyword = buildMonsterQuery(k, selectedProfile, jt ? [jt] : [], Boolean(selectedProfile));
        const res = await fetch(`${supabaseUrl}/functions/v1/monster-search`, { method: 'POST', headers, body: JSON.stringify({ ...baseBody, keyword: monsterKeyword, date_posted: d, excluded_job_ids: monsterJobs.map(j => j.id) }) });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        setMonsterJobs(prev => [...prev, ...(data.jobs ?? [])]);
      } catch (err) { setMonsterError(err instanceof Error ? err.message : String(err)); } finally { setMonsterSearching(false); }
    } else if (board === 'careerbuilder') {
      setCbSearching(true); setCbHasSearched(true); setCbError(null);
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/careerbuilder-search`, { method: 'POST', headers, body: JSON.stringify({ ...baseBody, date_posted: d, excluded_job_ids: cbJobs.map(j => j.id) }) });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        setCbJobs(prev => [...prev, ...(data.jobs ?? [])]);
      } catch (err) { setCbError(err instanceof Error ? err.message : String(err)); } finally { setCbSearching(false); }
    }
  }

  async function saveCbJob(job: CareerBuilderJob) {
    if (!selectedProfile) { showToast('Select a source profile first to save jobs', 'error'); return; }
    if (cbSavedIds.has(job.id)) return;
    setCbSavingId(job.id);
    const { error } = await supabase.from('wishlisted_jobs').insert({
      profile_id: selectedProfile.id,
      job_title: job.job_title ?? 'Untitled',
      company: job.company_name ?? 'Unknown',
      board: 'CareerBuilder',
      location: job.location_display ?? '',
      job_url: job.job_url ?? job.apply_url ?? null,
      source_job_id: job.id,
      status: 'New',
    });
    if (error) { showToast('Failed to save job', 'error'); setCbSavingId(null); return; }
    await supabase.from('activity_logs').insert({
      profile_id: selectedProfile.id, event_type: 'job_wishlisted',
      description: `Added "${job.job_title ?? 'job'}" at ${job.company_name ?? 'company'} (CareerBuilder) to submission queue`,
    });
    setCbSavedIds(prev => new Set([...prev, job.id]));
    setCbSavingId(null);
    showToast(`Added "${job.job_title}" to ${selectedProfile.candidate_name}'s queue`);
  }

  async function getCbMatchScore(job: CareerBuilderJob) {
    if (!selectedProfile) { showToast('Select a source profile first to score jobs', 'error'); return; }
    if (scoringJobId) return;
    if (matchScores[job.id] && !matchScores[job.id].queued) { setExpandedScore(prev => prev === job.id ? null : job.id); return; }
    setScoringJobId(job.id);
    setExpandedScore(job.id);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/score-job-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseKey}`, 'Apikey': supabaseKey },
        body: JSON.stringify({ profile_id: selectedProfile.id, careerbuilder_job_id: job.id, account_id: account?.id ?? null }),
      });
      const data = await res.json();
      if (res.status === 202 && data.queued) { handleQueuedScore(job.id, data.job_id); return; }
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMatchScores(prev => ({ ...prev, [job.id]: data }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Match score failed: ${msg}`, 'error');
      setExpandedScore(null);
    } finally {
      setScoringJobId(null);
    }
  }

  function toggleJobType(type: string) {
    setSelectedJobTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  }

  const tabJobs = allJobs.filter(j => j.board === activeTab);
  const jobCountByBoard: Record<string, number> = {
    History: profileSearchIds !== null
      ? historyJobs.filter(j => profileSearchIds.has(j.search_id)).length
      : historyJobs.length,
    LinkedIn: linkedinJobs.length,
    Dice: diceJobs.length,
    Indeed: indeedJobs.length,
    Monster: monsterJobs.length,
    CareerBuilder: cbJobs.length,
  };

  const filteredHistoryJobs = historyJobs.filter(j => {
    if (profileSearchIds !== null && !profileSearchIds.has(j.search_id)) return false;
    if (historyBoardFilter !== 'All' && j.source !== historyBoardFilter.toLowerCase()) return false;
    if (historySearch.trim()) {
      const q = historySearch.toLowerCase();
      if (!((j.job_title ?? '').toLowerCase().includes(q) || (j.company ?? '').toLowerCase().includes(q) || (j.location ?? '').toLowerCase().includes(q))) return false;
    }
    if (historyDateRange !== 'All time') {
      if (!j.created_at) return true;
      const fetchedAt = new Date(j.created_at).getTime();
      const now = Date.now();
      const cutoff =
        historyDateRange === 'Last 24 hours' ? now - 86_400_000 :
        historyDateRange === 'Last 7 days'   ? now - 7  * 86_400_000 :
                                               now - 30 * 86_400_000;
      if (fetchedAt < cutoff) return false;
    }
    return true;
  });
  function _q(q: string, title: string | null, company: string | null, loc: string | null) {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (title ?? '').toLowerCase().includes(s) || (company ?? '').toLowerCase().includes(s) || (loc ?? '').toLowerCase().includes(s);
  }

  const filteredCandidates = profiles.filter(p => {
    const q = candidateQuery.toLowerCase();
    const matchQ = !q || p.candidate_name.toLowerCase().includes(q) || (p.target_role ?? '').toLowerCase().includes(q);
    if (!matchQ) return false;
    if (candidateTab === 'hotlist') return hotlistProfileIds.includes(p.id);
    return true;
  });

  const globalQ = globalSearch.toLowerCase().trim();
  const colLinkedinJobs = linkedinJobs.filter(j => _q(linkedinColFilter, j.job_title, j.company_name, j.location)).filter(j => _q(globalQ, j.job_title, j.company_name, j.location)).sort((a, b) => dateMs(b.created_at) - dateMs(a.created_at));
  const colDiceJobs = diceJobs.filter(j => _q(diceColFilter, j.job_title, j.company_name, j.location)).filter(j => _q(globalQ, j.job_title, j.company_name, j.location)).sort((a, b) => dateMs(b.posted) - dateMs(a.posted) || dateMs(b.created_at) - dateMs(a.created_at));
  const colIndeedJobs = indeedJobs.filter(j => _q(indeedColFilter, j.job_title, j.company_name, j.location_display)).filter(j => _q(globalQ, j.job_title, j.company_name, j.location_display)).sort((a, b) => dateMs(b.date_published) - dateMs(a.date_published) || dateMs(b.created_at) - dateMs(a.created_at));
  const colMonsterJobs = monsterJobs.filter(j => _q(monsterColFilter, j.job_title, j.company_name, j.location_display)).filter(j => _q(globalQ, j.job_title, j.company_name, j.location_display)).sort((a, b) => dateMs(b.date_published) - dateMs(a.date_published) || dateMs(b.created_at) - dateMs(a.created_at));
  const colCbJobs = cbJobs.filter(j => _q(cbColFilter, j.job_title, j.company_name, j.location_display)).filter(j => _q(globalQ, j.job_title, j.company_name, j.location_display)).sort((a, b) => dateMs(b.date_published) - dateMs(a.date_published) || dateMs(b.created_at) - dateMs(a.created_at));

  // Per-board history: filter historyJobs by source and profileSearchIds
  function getBoardHistory(source: 'linkedin' | 'dice' | 'indeed' | 'monster' | 'careerbuilder'): HistoryJob[] {
    return historyJobs.filter(j => {
      if (j.source !== source) return false;
      if (profileSearchIds !== null && !profileSearchIds.has(j.search_id)) return false;
      return true;
    });
  }

  function getBoardHistoryExcluding(source: 'linkedin' | 'dice' | 'indeed' | 'monster' | 'careerbuilder', currentSearchId: string | null): HistoryJob[] {
    return getBoardHistory(source).filter(j => {
      if (currentSearchId && j.search_id === currentSearchId) return false;
      return true;
    });
  }

  function groupByDate(jobs: HistoryJob[]): { date: string; jobs: HistoryJob[] }[] {
    const groups: Record<string, HistoryJob[]> = {};
    for (const j of jobs) {
      const d = j.created_at ? new Date(j.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';
      if (!groups[d]) groups[d] = [];
      groups[d].push(j);
    }
    return Object.entries(groups).map(([date, jobs]) => ({ date, jobs }));
  }

  const linkedinBoardHistory = getBoardHistoryExcluding('linkedin', linkedinSearch?.id ?? null).filter(j => _q(globalQ, j.job_title, j.company_name, j.location));
  const diceBoardHistory = getBoardHistoryExcluding('dice', diceSearch?.id ?? null).filter(j => _q(globalQ, j.job_title, j.company_name, j.location));
  const indeedBoardHistory = getBoardHistoryExcluding('indeed', indeedSearch?.id ?? null).filter(j => _q(globalQ, j.job_title, j.company_name, j.location));
  const monsterBoardHistory = getBoardHistoryExcluding('monster', monsterSearch?.id ?? null).filter(j => _q(globalQ, j.job_title, j.company_name, j.location));
  const cbBoardHistory = getBoardHistoryExcluding('careerbuilder', cbSearch?.id ?? null).filter(j => _q(globalQ, j.job_title, j.company_name, j.location));

  function getBoardHistorySlice(board: string, history: HistoryJob[]) {
    const limit = boardHistoryLimit[board] ?? BOARD_HISTORY_PAGE;
    return history.slice(0, limit);
  }

  function loadMoreBoardHistory(board: string) {
    setBoardHistoryLimit(prev => ({ ...prev, [board]: (prev[board] ?? BOARD_HISTORY_PAGE) + BOARD_HISTORY_PAGE }));
  }

  function toggleBoardHistory(board: string) {
    setBoardHistoryVisible(prev => ({ ...prev, [board]: !prev[board] }));
  }

  // Whether to show history by default (no search run yet)
  const linkedinShowDefault = !linkedinHasSearched && !linkedinSearching && linkedinBoardHistory.length > 0;
  const diceShowDefault = !diceHasSearched && !diceSearching && diceBoardHistory.length > 0;
  const indeedShowDefault = !indeedHasSearched && !indeedSearching && indeedBoardHistory.length > 0;
  const monsterShowDefault = !monsterHasSearched && !monsterSearching && monsterBoardHistory.length > 0;
  const cbShowDefault = !cbHasSearched && !cbSearching && cbBoardHistory.length > 0;

  const historyPageCount = Math.ceil(filteredHistoryJobs.length / HISTORY_PAGE_SIZE);
  const pagedHistoryJobs = filteredHistoryJobs.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE);
  const linkedinPageCount = Math.ceil(linkedinJobs.length / LINKEDIN_PAGE_SIZE);
  const dicePageCount = Math.ceil(diceJobs.length / DICE_PAGE_SIZE);
  const indeedPageCount = Math.ceil(indeedJobs.length / INDEED_PAGE_SIZE);
  const monsterPageCount = Math.ceil(monsterJobs.length / MONSTER_PAGE_SIZE);
  const cbPageCount = Math.ceil(cbJobs.length / MONSTER_PAGE_SIZE);
  const pagedDiceJobs = diceJobs.slice(dicePage * DICE_PAGE_SIZE, (dicePage + 1) * DICE_PAGE_SIZE);
  const pagedIndeedJobs = indeedJobs.slice(indeedPage * INDEED_PAGE_SIZE, (indeedPage + 1) * INDEED_PAGE_SIZE);
  const pagedMonsterJobs = monsterJobs.slice(monsterPage * MONSTER_PAGE_SIZE, (monsterPage + 1) * MONSTER_PAGE_SIZE);
  const pagedCbJobs = cbJobs.slice(cbPage * MONSTER_PAGE_SIZE, (cbPage + 1) * MONSTER_PAGE_SIZE);
  const pagedLinkedinJobs = linkedinJobs.slice(linkedinPage * LINKEDIN_PAGE_SIZE, (linkedinPage + 1) * LINKEDIN_PAGE_SIZE);
  const searching = activeTab === 'History' ? false : activeTab === 'LinkedIn' ? linkedinSearching : activeTab === 'Dice' ? diceSearching : activeTab === 'Indeed' ? indeedSearching : activeTab === 'Monster' ? monsterSearching : activeTab === 'CareerBuilder' ? cbSearching : mockSearching;

  async function saveToWishlist(job: MockJob) {
    if (!selectedProfile || savedIds.has(job.id)) return;
    setSavingId(job.id);
    const { error } = await supabase.from('wishlisted_jobs').insert({
      profile_id: selectedProfile.id, job_title: job.job_title, company: job.company,
      board: job.board, location: job.location, job_url: job.job_url, status: 'New',
    });
    if (error) { showToast('Failed to save job', 'error'); setSavingId(null); return; }
    await supabase.from('activity_logs').insert({
      profile_id: selectedProfile.id, event_type: 'job_wishlisted',
      description: `Added "${job.job_title}" at ${job.company} (${job.board}) to submission queue`,
    });
    setSavedIds(prev => new Set([...prev, job.id]));
    setSavingId(null);
    showToast(`Added "${job.job_title}" to ${selectedProfile.candidate_name}'s queue`);
  }

  async function saveLinkedInJob(job: LinkedInJob) {
    if (!selectedProfile) { showToast('Select a source profile first to save jobs', 'error'); return; }
    if (linkedinSavedIds.has(job.id)) return;
    setLinkedinSavingId(job.id);
    const { error } = await supabase.from('wishlisted_jobs').insert({
      profile_id: selectedProfile.id,
      job_title: job.job_title ?? 'Untitled',
      company: job.company_name ?? 'Unknown',
      board: 'LinkedIn',
      location: job.location ?? '',
      job_url: job.job_url ?? null,
      source_job_id: job.id,
      status: 'New',
    });
    if (error) { showToast('Failed to save job', 'error'); setLinkedinSavingId(null); return; }
    await supabase.from('activity_logs').insert({
      profile_id: selectedProfile.id, event_type: 'job_wishlisted',
      description: `Added "${job.job_title ?? 'job'}" at ${job.company_name ?? 'company'} (LinkedIn) to submission queue`,
    });
    setLinkedinSavedIds(prev => new Set([...prev, job.id]));
    setLinkedinSavingId(null);
    showToast(`Added "${job.job_title}" to ${selectedProfile.candidate_name}'s queue`);
  }

  async function getMatchScore(job: LinkedInJob) {
    if (!selectedProfile) { showToast('Select a source profile first to score jobs', 'error'); return; }
    if (scoringJobId) return;
    if (matchScores[job.id] && !matchScores[job.id].queued) { setExpandedScore(prev => prev === job.id ? null : job.id); return; }
    setScoringJobId(job.id);
    setExpandedScore(job.id);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
      const res = await fetch(`${supabaseUrl}/functions/v1/score-job-match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
          'Apikey': supabaseKey,
        },
        body: JSON.stringify({ profile_id: selectedProfile.id, linkedin_job_id: job.id, account_id: account?.id ?? null }),
      });
      const data = await res.json();
      if (res.status === 202 && data.queued) { handleQueuedScore(job.id, data.job_id); return; }
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMatchScores(prev => ({ ...prev, [job.id]: data }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Match score failed: ${msg}`, 'error');
      setExpandedScore(null);
    } finally {
      setScoringJobId(null);
    }
  }

  const isSourceMode = selectedProfile !== null;

  async function addToResumeAIQueue(jobId: string) {
    if (!selectedProfile) { showToast('Select a source profile first', 'error'); return; }
    setRewritingJobId(jobId);

    try {
      const { data: existing } = await supabase
        .from('wishlisted_jobs')
        .select('id, resume_ai_queued')
        .eq('profile_id', selectedProfile.id)
        .eq('source_job_id', jobId)
        .maybeSingle();

      if (existing) {
        if (!existing.resume_ai_queued) {
          await supabase.from('wishlisted_jobs').update({ resume_ai_queued: true }).eq('id', existing.id);
        }
        setRewriteStatus(prev => ({ ...prev, [jobId]: 'done' }));
        showToast('Added to Resume AI Queue');
      } else if (previewJob) {
        const j = previewJob.job;
        const src = previewJob.source;
        const boardMap: Record<string, string> = {
          linkedin: 'LinkedIn', dice: 'Dice', indeed: 'Indeed',
          monster: 'Monster', careerbuilder: 'CareerBuilder',
        };
        const loc = src === 'indeed' ? (j as IndeedJob).location_display
          : src === 'monster' ? (j as MonsterJob).location_display
          : src === 'careerbuilder' ? (j as CareerBuilderJob).location_display
          : (j as LinkedInJob | DiceJob).location;

        const { data: saved } = await supabase.from('wishlisted_jobs').insert({
          profile_id: selectedProfile.id,
          job_title: j.job_title ?? 'Untitled',
          company: j.company_name ?? 'Unknown',
          board: boardMap[src] ?? src,
          location: loc ?? '',
          job_url: (j as LinkedInJob).job_url ?? null,
          source_job_id: jobId,
          status: 'New',
          resume_ai_queued: true,
        }).select('id').single();

        if (saved?.id) {
          setRewriteStatus(prev => ({ ...prev, [jobId]: 'done' }));
          showToast(`Added to Resume AI Queue for ${selectedProfile.candidate_name}`);
        } else {
          showToast('Could not add to queue', 'error');
        }
      }
    } catch {
      showToast('Failed to add to Resume AI Queue', 'error');
    } finally {
      setRewritingJobId(null);
    }
  }
  const activePortal = PORTAL_TABS.find(t => t.id === activeTab)!
  const canViewDebugPanel = DEBUG_PANEL_EMAILS.has((user?.email ?? '').toLowerCase());

  const boardPayloadPreview = buildBoardPayloadPreview(
    keyword,
    location,
    dateFilter,
    experienceLevel,
    selectedJobTypes,
    maxResults,
    selectedProfile,
    Boolean(selectedProfile),
  );

  return (
    <div className="h-screen flex flex-col bg-gray-100 font-sans overflow-hidden">
      <AppNav />


      {canViewDebugPanel && debugPanelOpen && (
      <div className="bg-slate-50 border-b border-slate-200 px-3 py-2 shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Info size={12} className="text-slate-500 shrink-0" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Search Payload Preview</span>
          {selectedProfile && boardPayloadPreview.skillContext.source !== 'none' && (
            <span className="text-[10px] text-slate-500">
              Using {boardPayloadPreview.skillContext.source === 'priority_skills' ? 'priority skills' : 'core skills'}: {boardPayloadPreview.skillContext.skills.join(', ')}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2">
          {Object.entries(boardPayloadPreview.boards).map(([board, payload]) => (
            <div key={board} className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm min-h-[128px]">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-[11px] font-bold text-slate-700">{board}</span>
                <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Request</span>
              </div>
              <pre className="text-[10px] leading-4 text-slate-600 whitespace-pre-wrap break-words font-mono">{JSON.stringify(payload, null, 2)}</pre>
            </div>
          ))}
        </div>
      </div>
      )}

      <div className="shrink-0 border-b border-gray-200 bg-white px-3 py-2.5">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              placeholder="Filter visible jobs across all boards…"
              className="w-full h-[40px] rounded-2xl border border-slate-200 bg-slate-50 pl-9 pr-10 text-sm text-gray-700 placeholder:text-gray-400 shadow-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 focus:bg-white transition-shadow"
            />
            {globalSearch && (
              <button
                type="button"
                onClick={() => setGlobalSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <div className="hidden sm:flex flex-col items-end justify-center leading-none whitespace-nowrap text-right shrink-0">
            {!isPaidPlan ? (
              <div className="flex h-[38px] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 shadow-sm whitespace-nowrap">
                <div className="flex items-center gap-1 text-center">
                  <span className="text-[12px] font-semibold leading-none text-slate-900">{freeRefreshesRemainingInWindow}/{FREE_PLAN_DAILY_LIMIT}</span>
                  <span className="text-[10px] font-medium leading-none text-slate-500 normal-case tracking-normal">searches left</span>
                </div>
              </div>
            ) : hasSelectedBoardCooldown && selectedBoardCooldownKeys.length > 0 ? (
              <span className="text-[10px] font-semibold text-amber-600">Next refresh in {formatCooldown(searchCooldownRemainingMs)}</span>
            ) : (
              <span className="text-[10px] font-semibold text-gray-400">Hourly refreshes available for selected candidates</span>
            )}
          </div>
          {!isPaidPlan ? (
            <button
              type="button"
              onClick={openUpgradeModal}
              className="flex h-[40px] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 shadow-sm whitespace-nowrap transition-colors hover:bg-blue-50"
            >
              <span className="text-[9px] font-normal leading-none text-slate-400">for unlimited hourly refreshes -</span>
              <span className="text-[11px] font-semibold text-blue-700">Upgrade to Pro</span>
            </button>
          ) : null}
        </div>
      </div>
      {/* Board selector dropdown portal - outside overflow container */}
      {boardSelectorOpen && (
        <div className="fixed inset-0 z-[100]" onClick={() => setBoardSelectorOpen(false)}>
          <div
            className="absolute bg-white border border-gray-200 rounded-xl shadow-xl w-48 overflow-hidden"
            style={{ top: (boardSelectorRef.current?.getBoundingClientRect().bottom ?? 0) + 6, right: window.innerWidth - (boardSelectorRef.current?.getBoundingClientRect().right ?? 0) }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-3 pt-2 pb-1 border-b border-gray-100">
              <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Boards to search</span>
            </div>
            {[
              { id: 'LinkedIn',      dot: 'bg-blue-500'    },
              { id: 'Dice',          dot: 'bg-orange-500'  },
              { id: 'Indeed',        dot: 'bg-violet-500'  },
              { id: 'Monster',       dot: 'bg-green-500'   },
            ].map(b => (
              <button key={b.id} type="button" onClick={() => toggleBoardSelection(b.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 transition-colors text-left">
                <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${selectedBoards.has(b.id) ? `${b.dot} border-transparent` : 'border-gray-300'}`}>
                  {selectedBoards.has(b.id) && <Check size={8} className="text-white" />}
                </div>
                <span className="text-xs font-medium text-gray-700">{b.id}</span>
              </button>
            ))}
            <div className="px-3 pb-2 pt-1 border-t border-gray-100 flex gap-1.5">
              <button type="button" onClick={() => setSelectedBoards(new Set(['LinkedIn','Dice','Indeed','Monster']))}
                className="flex-1 text-[10px] font-semibold text-blue-600 hover:text-blue-800 transition-colors">All</button>
              <span className="text-gray-300 text-[10px]">·</span>
              <button type="button" onClick={() => setSelectedBoards(new Set(['LinkedIn']))}
                className="flex-1 text-[10px] font-semibold text-gray-500 hover:text-gray-700 transition-colors">Reset</button>
            </div>
          </div>
        </div>
      )}

      {/* AI Ideas popup portal */}
      {ideasPopupOpen && (
        <div className="fixed inset-0 z-[100]" onClick={() => setIdeasPopupOpen(false)}>
          <div
            className="absolute bg-white border border-gray-200 rounded-xl shadow-2xl w-72 max-h-[50vh] overflow-hidden"
            style={getIdeasPopupStyle()}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 pt-2.5 pb-2 border-b border-gray-100">
              <div className="flex items-center gap-1.5">
                <Sparkles size={11} className="text-amber-500" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">AI Search Ideas</span>
              </div>
              <button type="button" onClick={() => { generateSearchIdeas(); }}
                disabled={ideasLoading}
                className="text-[9px] font-semibold text-amber-600 hover:text-amber-800 bg-amber-50 hover:bg-amber-100 px-1.5 py-0.5 rounded-md transition-colors disabled:opacity-50">
                {ideasLoading ? 'Generating...' : 'Regenerate'}
              </button>
            </div>
            {ideasError && <p className="text-[10px] text-red-500 text-center py-2 px-3">{ideasError}</p>}
            {ideasLoading && searchIdeas.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <LogoSpinner size={16} />
              </div>
            )}
            {searchIdeas.length > 0 && (
              <div className="max-h-64 overflow-y-auto py-1">
                {searchIdeas.map((idea, idx) => {
                  const isSel = selectedIdeaIndex === idx;
                  return (
                    <button key={idx} type="button"
                      onClick={() => { applyIdea(idea, idx); setIdeasPopupOpen(false); }}
                      title={`${idea.label}${idea.keyword ? ` · ${idea.keyword}` : ''}${idea.location ? ` in ${idea.location}` : ''}`}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 transition-all text-left border-b border-gray-50 last:border-0 ${
                        isSel ? 'bg-gray-100' : 'hover:bg-amber-50'
                      }`}>
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                        isSel ? 'bg-gray-300' : 'bg-amber-100'
                      }`}>
                        <Search size={10} className={isSel ? 'text-gray-500' : 'text-amber-600'} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`text-[11px] font-semibold truncate leading-tight ${
                          isSel ? 'text-gray-400' : 'text-gray-700'
                        }`}>{idea.label}</p>
                        {(idea.keyword || idea.location) && (
                          <p className={`text-[9px] truncate mt-0.5 ${isSel ? 'text-gray-300' : 'text-gray-400'}`}>
                            {idea.keyword}{idea.location ? ` · ${idea.location}` : ''}
                          </p>
                        )}
                      </div>
                      {isSel && <Check size={10} className="text-gray-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
            {searchIdeas.length === 0 && !ideasLoading && !ideasError && (
              <div className="flex flex-col items-center gap-2 py-6 text-center px-4">
                <Sparkles size={16} className="text-amber-300" />
                <p className="text-[10px] text-gray-400">Generating tailored search strategies...</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── Candidates sidebar ── */}
        <div className="w-72 shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
          <div className="px-3 py-2.5 border-b border-gray-100 shrink-0">
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 mb-2">
              {(['hotlist', 'all'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setCandidateTab(tab)}
                  className={`flex-1 text-[11px] font-semibold py-1.5 rounded-md transition-all text-center ${
                    candidateTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab === 'hotlist' ? 'Hotlist' : 'All Bench'}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search candidates..."
                value={candidateQuery}
                onChange={e => setCandidateQuery(e.target.value)}
                className="w-full pl-7 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 placeholder:text-gray-300"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {profilesLoading ? (
              <div className="flex items-center justify-center py-10"><LogoSpinner size={18} /></div>
            ) : filteredCandidates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <User size={18} className="text-gray-300" />
                <p className="text-xs text-gray-400">{candidateTab === 'hotlist' ? 'No hotlisted candidates' : 'No candidates found'}</p>
              </div>
            ) : filteredCandidates.map(p => {
              const isSelected = selectedProfile?.id === p.id;
              const boardStats = profileBoardStats[p.id] ?? { fetched: 0, matched: 0 };
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedProfile(p)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-all ${
                    isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50/70 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isSelected ? 'bg-blue-100' : 'bg-gray-100'}`}>
                      <User size={13} className={isSelected ? 'text-blue-600' : 'text-gray-400'} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[12px] font-semibold truncate leading-tight ${isSelected ? 'text-blue-900' : 'text-gray-800'}`}>
                        {p.candidate_name}
                      </p>
                      <p className="text-[10px] text-gray-400 truncate mt-0.5">{p.target_role || 'No target role'}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${boardStats.fetched > 0 ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-500'}`}>
                          Fetched <span className="ml-0.5 text-[10px] font-bold">{boardStats.fetched}</span>
                        </span>
                        <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${boardStats.matched > 0 ? 'bg-violet-50 text-violet-700' : 'bg-gray-50 text-gray-500'}`}>
                          Matched <span className="ml-0.5 text-[10px] font-bold">{boardStats.matched}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right panel: board filters + columns ── */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="shrink-0 border-b border-gray-200 bg-gray-50 px-3 py-2.5">
            <div className="flex items-stretch gap-2">
              <div className="flex-1 min-w-0 space-y-2">
                <div className="grid grid-cols-2 gap-x-2">
                  <div className="min-w-0 flex items-center gap-1.5">
                    <label className="text-[10px] font-semibold text-gray-500 whitespace-nowrap">Keyword</label>
                    <div className="relative flex-1 min-w-0">
                      <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      <input
                        type="text"
                        value={keyword}
                        onChange={e => { setKeyword(e.target.value); setFiltersFromProfile(false); }}
                        placeholder="Job title or skill"
                        className="w-full pl-6 pr-2 h-[30px] text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 placeholder:text-gray-300 bg-white"
                      />
                    </div>
                  </div>
                  <div className="min-w-0 flex items-center gap-1.5">
                    <label className="text-[10px] font-semibold text-gray-500 whitespace-nowrap">Location</label>
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                      <select
                        value={locationScope}
                        onChange={(e) => setLocationScope(e.target.value as 'any' | 'city' | 'state' | 'country')}
                        className="h-[30px] text-[10px] border border-gray-200 rounded-lg px-2 text-gray-700 focus:outline-none focus:border-blue-400 bg-white"
                        title="Location scope"
                      >
                        <option value="any">Any</option>
                        <option value="city">City</option>
                        <option value="state">State</option>
                        <option value="country">Country</option>
                      </select>
                      <LocationAutosuggestInput
                        value={location}
                        onChange={(v) => { setLocation(v); setFiltersFromProfile(false); }}
                        onSelectPlace={(place) => {
                          setLocation(place.formatted || place.city || location);
                          setFiltersFromProfile(false);
                        }}
                        scope={locationScope}
                        placeholder="City, State, Country"
                        className="flex-1 min-w-0"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-x-2">
                  <div className="min-w-0 flex items-center gap-1.5">
                    <label className="text-[10px] font-semibold text-gray-500 whitespace-nowrap">Job type</label>
                    <select
                      value={selectedJobTypes[0] ?? ''}
                      onChange={e => setSelectedJobTypes(e.target.value ? [e.target.value] : [])}
                      className="flex-1 min-w-0 h-[30px] text-[11px] border border-gray-200 rounded-lg px-2 text-gray-700 focus:outline-none focus:border-blue-400 bg-white"
                    >
                      <option value="">Any type</option>
                      {JOB_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </div>
                  <div className="min-w-0 flex items-center gap-1.5">
                    <label className="text-[10px] font-semibold text-gray-500 whitespace-nowrap">Posted</label>
                    <select
                      value={dateFilter}
                      onChange={e => setDateFilter(e.target.value)}
                      className="flex-1 min-w-0 h-[30px] text-[11px] border border-gray-200 rounded-lg px-2 text-gray-700 focus:outline-none focus:border-blue-400 bg-white"
                    >
                      {DATE_FILTERS.map(df => <option key={df} value={df}>{df}</option>)}
                    </select>
                  </div>
                  <div className="min-w-0 flex items-center gap-1.5">
                    <label className="text-[10px] font-semibold text-gray-500 whitespace-nowrap">Experience</label>
                    <select
                      value={experienceLevel}
                      onChange={e => setExperienceLevel(e.target.value)}
                      className="flex-1 min-w-0 h-[30px] text-[11px] border border-gray-200 rounded-lg px-2 text-gray-700 focus:outline-none focus:border-blue-400 bg-white"
                    >
                      <option value="">Any level</option>
                      {EXPERIENCE_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
                    </select>
                  </div>
                  <div className="min-w-0 flex items-center gap-1.5">
                    <label className="text-[10px] font-semibold text-gray-500 whitespace-nowrap">Results Per Board</label>
                    <div className="relative group flex-1 min-w-0">
                      <select
                        value={maxResults}
                        onChange={e => {
                          const value = Number(e.target.value);
                          if (!isPaidPlan && value !== 25) {
                            setMaxResults(25);
                            return;
                          }
                          setMaxResults(value);
                        }}
                        className="w-full h-[30px] text-[11px] border border-gray-200 rounded-lg px-2 text-gray-700 focus:outline-none focus:border-blue-400 bg-white"
                      >
                        {RESULT_OPTIONS.map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                      {!isPaidPlan && (
                        <span className="pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow transition-opacity group-hover:opacity-100 z-20">
                          Free plans are limited to 25 results only
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-rows-2 gap-2 shrink-0">
                <div className="flex items-center gap-1.5 h-[30px]">
                  <div ref={boardSelectorRef} className="relative flex h-[30px]">
                    <button
                      type="button"
                      onClick={searchAll}
                      disabled={isSearchCooldownActive}
                      className={`flex items-center gap-1.5 text-[11px] font-bold px-3 h-full rounded-l-lg transition-colors whitespace-nowrap ${
                        hasSelectedBoardCooldown
                          ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      <Search size={11} /> Search ({selectedBoards.size})
                    </button>
                    <button
                      type="button"
                      disabled={isSearchCooldownActive}
                      onClick={e => { e.stopPropagation(); setBoardSelectorOpen(o => !o); }}
                      className={`flex items-center px-2 h-full rounded-r-lg transition-colors border-l ${
                        hasSelectedBoardCooldown
                          ? 'bg-gray-200 text-gray-500 border-gray-300 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-700 text-white border-blue-500'
                      }`}
                    >
                      <ChevronDown size={11} className={`transition-transform ${boardSelectorOpen ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  {selectedProfile && (
                    <button
                      ref={ideasBtnRef}
                      type="button"
                      onClick={() => {
                        if (searchIdeas.length === 0 && !ideasLoading) {
                          generateSearchIdeas();
                        }
                        setIdeasPopupOpen(o => !o);
                      }}
                      disabled={ideasLoading}
                      aria-label="Open AI search ideas"
                      title="AI search ideas"
                      className={`flex items-center gap-1.5 justify-center h-[30px] px-2.5 rounded-lg border text-[10px] font-semibold transition-all shrink-0 whitespace-nowrap ${
                        searchIdeas.length > 0
                          ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'
                          : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white border-transparent'
                      } disabled:opacity-60`}
                    >
                      {ideasLoading ? <LogoSpinner size={10} /> : <Sparkles size={10} />}
                      <span>AI Ideas</span>
                    </button>
                  )}

                  {canViewDebugPanel && (
                    <button
                      type="button"
                      onClick={() => setDebugPanelOpen(open => !open)}
                      aria-label={debugPanelOpen ? 'Hide debug panel' : 'Show debug panel'}
                      title={debugPanelOpen ? 'Hide debug panel' : 'Show debug panel'}
                      className={`flex items-center justify-center h-[30px] w-[30px] rounded-lg border transition-colors shrink-0 ${debugPanelOpen ? 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200' : 'border-gray-200 bg-white text-gray-400 hover:text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}
                    >
                      <Eye size={12} />
                    </button>
                  )}

                </div>
                <div className="h-[30px] flex items-center justify-end pr-1">
                  {selectedCandidateCooldownStatus && (
                    <span className="text-[10px] font-medium whitespace-nowrap text-amber-600">
                      {selectedCandidateCooldownStatus}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Board columns */}
          <div className="flex-1 flex gap-3 px-3 pb-3 overflow-x-auto min-h-0">

          {/* ── LinkedIn column ── */}
          {collapsedBoards.has('LinkedIn') ? (
            <button onClick={() => toggleCollapseBoard('LinkedIn')}
              className="shrink-0 w-10 flex flex-col items-center justify-start rounded-2xl border border-blue-200 bg-blue-50 shadow-sm overflow-hidden hover:bg-blue-100 transition-colors"
              title="Expand LinkedIn">
              <div className="w-full flex items-center justify-center py-3 border-b border-blue-200">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
              </div>
              <div className="flex-1 flex items-center justify-center py-2">
                <span className="text-[10px] font-bold text-blue-600 tracking-wide"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>LinkedIn</span>
              </div>
              {linkedinJobs.length > 0 && (
                <div className="pb-2"><span className="text-[9px] font-bold bg-blue-200 text-blue-700 px-1 py-0.5 rounded-full">{linkedinJobs.length}</span></div>
              )}
            </button>
          ) : (
          <div className="w-72 min-w-[288px] shrink-0 flex flex-col rounded-2xl border border-blue-200 overflow-hidden shadow-sm">
            <div className="bg-blue-600 px-3 py-2.5 flex items-center gap-2 shrink-0">
              <button onClick={() => toggleCollapseBoard('LinkedIn')} title="Collapse"
                className="w-5 h-5 rounded flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0">
                <ChevronRight size={11} />
              </button>
              <span className="text-xs font-bold text-white flex-1">LinkedIn</span>
              {linkedinSearching && <LogoSpinner size={11} />}
              {linkedinError && !linkedinSearching && (
                <button onClick={() => triggerBoardSearch('linkedin', true)} title="Retry" className="text-blue-200 hover:text-white transition-colors"><RefreshCw size={11} /></button>
              )}
              {!linkedinError && (
                <div className="relative group shrink-0">
                  <button
                    onClick={refreshLinkedIn}
                    disabled={isBoardCooldownActive('linkedin')}
                    title={isBoardCooldownActive('linkedin') ? `Refreshes in ${formatCooldown(getBoardCooldownRemainingMs('linkedin'))}, Upgrade` : 'Refresh LinkedIn'}
                    className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                      isBoardCooldownActive('linkedin')
                        ? 'bg-white/5 text-white/40 cursor-not-allowed'
                        : 'bg-white/10 hover:bg-white/20'
                    }`}>
                    <RefreshCw size={10} className="text-white" />
                  </button>
                </div>
              )}
              <span className="text-[10px] font-bold bg-white/20 text-white px-1.5 py-0.5 rounded-full">{linkedinJobs.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto bg-blue-50/30 p-2 flex flex-col gap-2">
              {linkedinSearching && (
                <div className="flex flex-col items-center justify-center gap-2 py-8">
                  <LogoSpinner size={18} />
                  <p className="text-xs text-gray-500">Scraping LinkedIn…</p>
                </div>
              )}
              {!linkedinSearching && boardQueueStatus.linkedin && (
                <div className="flex flex-col items-center gap-2 py-6 text-center px-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                    <Clock size={18} className="text-amber-600" />
                  </div>
                  <p className="text-[11px] font-semibold text-amber-700">High Volume - Queued</p>
                  <p className="text-[10px] text-gray-500 leading-relaxed">Your search is in the queue. Expected wait time: ~{Math.ceil((boardQueueStatus.linkedin.eta_seconds) / 60)} min</p>
                  <button onClick={() => { setBoardQueueStatus(prev => ({ ...prev, linkedin: null })); triggerBoardSearch('linkedin'); }}
                    className="mt-1 text-[10px] font-medium text-blue-600 hover:text-blue-800 underline">Retry now</button>
                </div>
              )}
              {linkedinError && !linkedinSearching && (
                <div className="flex flex-col items-center gap-1 py-6 text-center">
                  <AlertCircle size={16} className="text-red-400" />
                  <p className="text-[11px] text-red-500">{linkedinError}</p>
                </div>
              )}
              {linkedinHasSearched && !linkedinSearching && !linkedinError && linkedinJobs.length === 0 && !linkedinShowDefault && (
                <div className="flex flex-col items-center gap-2 py-8 text-center px-4">
                  <Briefcase size={18} className="text-gray-300" />
                  <p className="text-[11px] text-gray-500 leading-relaxed">We haven't found any results for this filter. Try a different title, expand the date range, or use a broader location.</p>
                </div>
              )}
              {!linkedinHasSearched && !linkedinSearching && !linkedinError && !linkedinShowDefault && !boardQueueStatus.linkedin && (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-4">
                  {!boardHistoryLoaded['linkedin'] ? (
                    <>
                      <Clock size={20} className="text-blue-300" />
                      <p className="text-[11px] text-gray-500">View recent LinkedIn results for this profile</p>
                      <button onClick={() => loadBoardHistory('linkedin')} disabled={!!boardHistoryLoading['linkedin'] || !selectedProfile}
                        className="px-3 py-1.5 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm">
                        {boardHistoryLoading['linkedin'] ? <LogoSpinner size={10} /> : <RefreshCw size={10} />} Load History
                      </button>
                      <button onClick={() => triggerBoardSearch('linkedin')}
                        className="px-3 py-1.5 text-[11px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors flex items-center gap-1.5">
                        <Search size={10} /> Search New Jobs
                      </button>
                    </>
                  ) : (
                    <>
                      <Search size={20} className="text-blue-300" />
                      <p className="text-[11px] text-gray-500">No recent history. Search for new jobs.</p>
                      <button onClick={() => triggerBoardSearch('linkedin')}
                        className="px-3 py-1.5 text-[11px] font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm">
                        <Search size={10} /> Search New Jobs
                      </button>
                    </>
                  )}
                </div>
              )}
              {!linkedinSearching && !linkedinError && colLinkedinJobs.map(job => {
                const isSaved = linkedinSavedIds.has(job.id);
                const isSaving = linkedinSavingId === job.id;
                const isScoring = scoringJobId === job.id;
                const ms = matchScores[job.id];
                const colors = ms ? scoreColor(ms.score) : null;
                return (
                  <div key={job.id} className={`border rounded-xl p-2.5 flex flex-col gap-1.5 ${cardClass(job.id, isSaved, ms, previewedIds, 'hover:border-blue-300')} transition-all`}>
                    <div className="flex items-start gap-2">
                      {job.company_logo_url
                        ? <img src={job.company_logo_url} alt="" className="w-6 h-6 rounded object-cover shrink-0 border border-gray-100" />
                        : <div className="w-6 h-6 rounded bg-blue-50 flex items-center justify-center shrink-0"><Building2 size={10} className="text-blue-400" /></div>}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-1 flex-wrap">
                          <p className="text-[11px] font-semibold text-gray-900 leading-tight truncate flex-1">{job.job_title ?? '—'}</p>
                          {job.easy_apply && <span className="text-[8px] font-bold bg-green-100 text-green-700 px-1 py-0.5 rounded shrink-0">Easy</span>}
                        </div>
                        {job.company_url
                          ? <a href={job.company_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 hover:underline truncate block">{job.company_name ?? '—'}</a>
                          : <p className="text-[10px] text-gray-500 truncate">{job.company_name ?? '—'}</p>}
                      </div>
                    </div>
                    {job.location && <p className="flex items-center gap-1 text-[10px] text-gray-400"><MapPin size={8} />{job.location}</p>}
                    {job.salary_range && <p className="flex items-center gap-1 text-[10px] text-gray-400"><DollarSign size={8} />{job.salary_range}</p>}
                    {job.time_posted && <p className="flex items-center gap-1 text-[10px] text-gray-400"><Clock size={8} />{job.time_posted}</p>}
                    {ms && <ScoreBadge ms={ms} colors={colors!} opened={expandedScore === job.id} onToggle={() => setExpandedScore(prev => prev === job.id ? null : job.id)} profile={selectedProfile} job={job} />}
                    <div className="flex items-center gap-1 pt-1 border-t border-gray-100 mt-auto">
                      {(job.apply_url || job.job_url) && (
                        <a href={job.apply_url ?? job.job_url ?? '#'} target="_blank" rel="noopener noreferrer" title="Apply"
                          className="p-1 rounded-lg text-blue-500 hover:bg-blue-50 transition-colors mr-auto"><ExternalLink size={11} /></a>
                      )}
                      <button onClick={() => { setPreviewedIds(p => { const n = new Set(p); n.add(job.id); return n; }); setPreviewJob({ source: 'linkedin', job }); }} title="Preview"
                        className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"><Eye size={11} /></button>
                      <button
                        onClick={() => {
                          if (ms && !ms.queued) {
                            setExpandedScore(prev => prev === job.id ? null : job.id);
                            return;
                          }
                          getMatchScore(job);
                        }}
                        disabled={!!scoringJobId && scoringJobId !== job.id}
                        title={ms && !ms.queued ? 'Matched - view breakdown' : 'AI Match'}
                        className={`p-1 rounded-lg disabled:opacity-40 transition-colors ${ms && !ms.queued ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100' : 'text-gray-500 hover:bg-blue-50 hover:text-blue-600'}`}
                      >
                        {isScoring ? <LogoSpinner size={11} /> : ms && !ms.queued ? <Check size={11} /> : <Sparkles size={11} />}
                      </button>
                      <button onClick={() => saveLinkedInJob(job)} disabled={isSaved || isSaving} title={isSaved ? 'In Queue' : 'Add to Queue'}
                        className={`p-1 rounded-lg transition-colors ${isSaved ? 'text-green-600 bg-green-50 cursor-default' : 'text-gray-500 hover:bg-blue-50 hover:text-blue-600'}`}>
                        {isSaving ? <LogoSpinner size={11} /> : isSaved ? <BookmarkCheck size={11} /> : <Bookmark size={11} />}
                      </button>
                      {selectedProfile && (
                        <button onClick={() => addToResumeAIQueue(job.id)} disabled={rewritingJobId === job.id || rewriteStatus[job.id] === 'done'} title={rewriteStatus[job.id] === 'done' ? 'In Resume AI Queue' : 'Add to Resume AI Queue'}
                          className={`p-1 rounded-lg transition-colors ${rewriteStatus[job.id] === 'done' ? 'text-emerald-600 bg-emerald-50 cursor-default' : 'text-gray-500 hover:bg-violet-50 hover:text-violet-600 disabled:opacity-40'}`}>
                          {rewritingJobId === job.id ? <LogoSpinner size={11} /> : rewriteStatus[job.id] === 'done' ? <CheckCircle2 size={11} /> : <PenLine size={11} />}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {/* Board history section */}
              {!linkedinSearching && !linkedinError && (() => {
                const showHistoryDefault = linkedinShowDefault;
                const hasSearchResults = linkedinHasSearched && linkedinJobs.length > 0;
                const historyItems = linkedinBoardHistory;
                if (historyItems.length === 0 && !showHistoryDefault) return null;
                const isVisible = showHistoryDefault || boardHistoryVisible['linkedin'];
                if (!isVisible && hasSearchResults) {
                  return (
                    <button onClick={() => toggleBoardHistory('linkedin')}
                      className="w-full mt-1 py-2 text-[11px] font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-colors flex items-center justify-center gap-1.5">
                      <Clock size={11} /> Load History ({historyItems.length} older jobs)
                    </button>
                  );
                }
                if (!isVisible) return null;
                const slice = getBoardHistorySlice('linkedin', historyItems);
                const grouped = groupByDate(slice);
                const hasMore = slice.length < historyItems.length;
                return (
                  <>
                    {hasSearchResults && (
                      <div className="flex items-center gap-2 mt-2 mb-1">
                        <div className="flex-1 h-px bg-blue-200" />
                        <span className="text-[9px] font-bold text-blue-500 uppercase tracking-wider">History</span>
                        <div className="flex-1 h-px bg-blue-200" />
                      </div>
                    )}
                    {grouped.map(group => (
                      <div key={group.date}>
                        <div className="flex items-center gap-1.5 py-1 mb-1">
                          <Clock size={9} className="text-gray-400" />
                          <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">{group.date}</span>
                        </div>
                        {group.jobs.map(hJob => {
                          const job = hJob.raw as LinkedInJob;
                          const isSaved = linkedinSavedIds.has(job.id);
                          const isSaving = linkedinSavingId === job.id;
                          const ms = matchScores[job.id];
                          const colors = ms ? scoreColor(ms.score) : null;
                          return (
                            <div key={job.id} className={`border rounded-xl p-2.5 flex flex-col gap-1.5 mb-2 ${cardClass(job.id, isSaved, ms, previewedIds, 'hover:border-blue-300')} transition-all opacity-90`}>
                              <div className="flex items-start gap-2">
                                {job.company_logo_url
                                  ? <img src={job.company_logo_url} alt="" className="w-6 h-6 rounded object-cover shrink-0 border border-gray-100" />
                                  : <div className="w-6 h-6 rounded bg-blue-50 flex items-center justify-center shrink-0"><Building2 size={10} className="text-blue-400" /></div>}
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] font-semibold text-gray-900 leading-tight truncate">{job.job_title ?? '—'}</p>
                                  <p className="text-[10px] text-gray-500 truncate">{job.company_name ?? '—'}</p>
                                </div>
                              </div>
                              {job.location && <p className="flex items-center gap-1 text-[10px] text-gray-400"><MapPin size={8} />{job.location}</p>}
                              {job.salary_range && <p className="flex items-center gap-1 text-[10px] text-gray-400"><DollarSign size={8} />{job.salary_range}</p>}
                              {ms && <ScoreBadge ms={ms} colors={colors!} opened={expandedScore === job.id} onToggle={() => setExpandedScore(prev => prev === job.id ? null : job.id)} profile={selectedProfile} job={job} />}
                              <div className="flex items-center gap-1 pt-1 border-t border-gray-100 mt-auto">
                                {(job.apply_url || job.job_url) && (
                                  <a href={job.apply_url ?? job.job_url ?? '#'} target="_blank" rel="noopener noreferrer" title="Apply"
                                    className="p-1 rounded-lg text-blue-500 hover:bg-blue-50 transition-colors mr-auto"><ExternalLink size={11} /></a>
                                )}
                                <button onClick={() => { setPreviewedIds(p => { const n = new Set(p); n.add(job.id); return n; }); setPreviewJob({ source: 'linkedin', job }); }} title="Preview"
                                  className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"><Eye size={11} /></button>
                                <button
                                  onClick={() => {
                                    if (ms && !ms.queued) {
                                      setExpandedScore(prev => prev === job.id ? null : job.id);
                                      return;
                                    }
                                    getMatchScore(job);
                                  }}
                                  disabled={!!scoringJobId && scoringJobId !== job.id}
                                  title={ms && !ms.queued ? 'Matched - view breakdown' : 'AI Match'}
                                  className={`p-1 rounded-lg disabled:opacity-40 transition-colors ${ms && !ms.queued ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100' : 'text-gray-500 hover:bg-blue-50 hover:text-blue-600'}`}
                                >
                                  {scoringJobId === job.id ? <LogoSpinner size={11} /> : ms && !ms.queued ? <Check size={11} /> : <Sparkles size={11} />}
                                </button>
                                <button onClick={() => saveLinkedInJob(job)} disabled={isSaved || isSaving} title={isSaved ? 'In Queue' : 'Add to Queue'}
                                  className={`p-1 rounded-lg transition-colors ${isSaved ? 'text-green-600 bg-green-50 cursor-default' : 'text-gray-500 hover:bg-blue-50 hover:text-blue-600'}`}>
                                  {isSaving ? <LogoSpinner size={11} /> : isSaved ? <BookmarkCheck size={11} /> : <Bookmark size={11} />}
                                </button>
                                {selectedProfile && (
                                  <button onClick={() => addToResumeAIQueue(job.id)} disabled={rewritingJobId === job.id || rewriteStatus[job.id] === 'done'} title={rewriteStatus[job.id] === 'done' ? 'In Resume AI Queue' : 'Add to Resume AI Queue'}
                                    className={`p-1 rounded-lg transition-colors ${rewriteStatus[job.id] === 'done' ? 'text-emerald-600 bg-emerald-50 cursor-default' : 'text-gray-500 hover:bg-violet-50 hover:text-violet-600 disabled:opacity-40'}`}>
                                    {rewritingJobId === job.id ? <LogoSpinner size={11} /> : rewriteStatus[job.id] === 'done' ? <CheckCircle2 size={11} /> : <PenLine size={11} />}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {hasMore && (
                      <button onClick={() => loadMoreBoardHistory('linkedin')}
                        className="w-full py-2 text-[11px] font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition-colors">
                        Load More ({historyItems.length - slice.length} remaining)
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          )}

          {/* ── Dice column ── */}
          {collapsedBoards.has('Dice') ? (
            <button onClick={() => toggleCollapseBoard('Dice')}
              className="shrink-0 w-10 flex flex-col items-center justify-start rounded-2xl border border-orange-200 bg-orange-50 shadow-sm overflow-hidden hover:bg-orange-100 transition-colors"
              title="Expand Dice">
              <div className="w-full flex items-center justify-center py-3 border-b border-orange-200">
                <div className="w-2 h-2 rounded-full bg-orange-500" />
              </div>
              <div className="flex-1 flex items-center justify-center py-2">
                <span className="text-[10px] font-bold text-orange-600 tracking-wide"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>Dice</span>
              </div>
              {diceJobs.length > 0 && (
                <div className="pb-2"><span className="text-[9px] font-bold bg-orange-200 text-orange-700 px-1 py-0.5 rounded-full">{diceJobs.length}</span></div>
              )}
            </button>
          ) : (
          <div className="w-72 min-w-[288px] shrink-0 flex flex-col rounded-2xl border border-orange-200 overflow-hidden shadow-sm">
            <div className="bg-orange-500 px-3 py-2.5 flex items-center gap-2 shrink-0">
              <button onClick={() => toggleCollapseBoard('Dice')} title="Collapse"
                className="w-5 h-5 rounded flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0">
                <ChevronRight size={11} />
              </button>
              <span className="text-xs font-bold text-white flex-1">Dice</span>
              {diceSearching && <LogoSpinner size={11} />}
              {diceError && !diceSearching && (
                <button onClick={() => triggerBoardSearch('dice', true)} title="Retry" className="text-orange-200 hover:text-white transition-colors"><RefreshCw size={11} /></button>
              )}
              {!diceError && (
                <div className="relative group shrink-0">
                  <button
                    onClick={refreshDice}
                    disabled={isBoardCooldownActive('dice')}
                    title={isBoardCooldownActive('dice') ? `Refreshes in ${formatCooldown(getBoardCooldownRemainingMs('dice'))}, Upgrade` : 'Refresh Dice'}
                    className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                      isBoardCooldownActive('dice')
                        ? 'bg-white/5 text-white/40 cursor-not-allowed'
                        : 'bg-white/10 hover:bg-white/20'
                    }`}>
                    <RefreshCw size={10} className="text-white" />
                  </button>
                </div>
              )}
              <span className="text-[10px] font-bold bg-white/20 text-white px-1.5 py-0.5 rounded-full">{diceJobs.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto bg-orange-50/30 p-2 flex flex-col gap-2">
              {diceSearching && (
                <div className="flex flex-col items-center justify-center gap-2 py-8">
                  <LogoSpinner size={18} />
                  <p className="text-xs text-gray-500">Scraping Dice…</p>
                </div>
              )}
              {!diceSearching && boardQueueStatus.dice && (
                <div className="flex flex-col items-center gap-2 py-6 text-center px-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                    <Clock size={18} className="text-amber-600" />
                  </div>
                  <p className="text-[11px] font-semibold text-amber-700">High Volume - Queued</p>
                  <p className="text-[10px] text-gray-500 leading-relaxed">Your search is in the queue. Expected wait time: ~{Math.ceil((boardQueueStatus.dice.eta_seconds) / 60)} min</p>
                  <button onClick={() => { setBoardQueueStatus(prev => ({ ...prev, dice: null })); triggerBoardSearch('dice'); }}
                    className="mt-1 text-[10px] font-medium text-orange-600 hover:text-orange-800 underline">Retry now</button>
                </div>
              )}
              {diceError && !diceSearching && (
                <div className="flex flex-col items-center gap-1 py-6 text-center">
                  <AlertCircle size={16} className="text-red-400" />
                  <p className="text-[11px] text-red-500">{diceError}</p>
                </div>
              )}
              {diceHasSearched && !diceSearching && !diceError && diceJobs.length === 0 && !diceShowDefault && (
                <div className="flex flex-col items-center gap-2 py-8 text-center px-4">
                  <Briefcase size={18} className="text-gray-300" />
                  <p className="text-[11px] text-gray-500 leading-relaxed">We haven't found any results for this filter. Try a different title, expand the date range, or use a broader location.</p>
                </div>
              )}
              {!diceHasSearched && !diceSearching && !diceError && !diceShowDefault && !boardQueueStatus.dice && (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-4">
                  {!boardHistoryLoaded['dice'] ? (
                    <>
                      <Clock size={20} className="text-orange-300" />
                      <p className="text-[11px] text-gray-500">View recent Dice results for this profile</p>
                      <button onClick={() => loadBoardHistory('dice')} disabled={!!boardHistoryLoading['dice'] || !selectedProfile}
                        className="px-3 py-1.5 text-[11px] font-semibold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-60 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm">
                        {boardHistoryLoading['dice'] ? <LogoSpinner size={10} /> : <RefreshCw size={10} />} Load History
                      </button>
                      <button onClick={() => triggerBoardSearch('dice')}
                        className="px-3 py-1.5 text-[11px] font-semibold text-orange-600 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition-colors flex items-center gap-1.5">
                        <Search size={10} /> Search New Jobs
                      </button>
                    </>
                  ) : (
                    <>
                      <Search size={20} className="text-orange-300" />
                      <p className="text-[11px] text-gray-500">No recent history. Search for new jobs.</p>
                      <button onClick={() => triggerBoardSearch('dice')}
                        className="px-3 py-1.5 text-[11px] font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm">
                        <Search size={10} /> Search New Jobs
                      </button>
                    </>
                  )}
                </div>
              )}
              {!diceSearching && !diceError && colDiceJobs.map(job => {
                const isSaved = diceSavedIds.has(job.id);
                const isSaving = diceSavingId === job.id;
                const isScoring = scoringJobId === job.id;
                const ms = matchScores[job.id];
                const colors = ms ? scoreColor(ms.score) : null;
                return (
                  <div key={job.id} className={`border rounded-xl p-2.5 flex flex-col gap-1.5 ${cardClass(job.id, isSaved, ms, previewedIds, 'hover:border-orange-300')} transition-all`}>
                    <div className="flex items-start gap-2">
                      {job.company_logo_url
                        ? <img src={job.company_logo_url} alt="" className="w-6 h-6 rounded object-cover shrink-0 border border-gray-100" />
                        : <div className="w-6 h-6 rounded bg-orange-50 flex items-center justify-center shrink-0"><Building2 size={10} className="text-orange-400" /></div>}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-1 flex-wrap">
                          <p className="text-[11px] font-semibold text-gray-900 leading-tight truncate flex-1">{job.job_title ?? '—'}</p>
                          {job.easy_apply && <span className="text-[8px] font-bold bg-green-100 text-green-700 px-1 py-0.5 rounded shrink-0">Easy</span>}
                        </div>
                        {job.company_page_url
                          ? <a href={job.company_page_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-orange-600 hover:underline truncate block">{job.company_name ?? '—'}</a>
                          : <p className="text-[10px] text-gray-500 truncate">{job.company_name ?? '—'}</p>}
                      </div>
                    </div>
                    {job.location && <p className="flex items-center gap-1 text-[10px] text-gray-400"><MapPin size={8} />{job.location}</p>}
                    {job.salary_range && <p className="flex items-center gap-1 text-[10px] text-gray-400"><DollarSign size={8} />{job.salary_range}</p>}
                    {timeAgo(job.posted) && <p className="flex items-center gap-1 text-[10px] text-gray-400"><Clock size={8} />{timeAgo(job.posted)}</p>}
                    {ms && <ScoreBadge ms={ms} colors={colors!} opened={expandedScore === job.id} onToggle={() => setExpandedScore(prev => prev === job.id ? null : job.id)} profile={selectedProfile} job={job} />}
                    <div className="flex items-center gap-1 pt-1 border-t border-gray-100 mt-auto">
                      {job.job_url && (
                        <a href={job.job_url} target="_blank" rel="noopener noreferrer" title="Apply"
                          className="p-1 rounded-lg text-orange-500 hover:bg-orange-50 transition-colors mr-auto"><ExternalLink size={11} /></a>
                      )}
                      <button onClick={() => { setPreviewedIds(p => { const n = new Set(p); n.add(job.id); return n; }); setPreviewJob({ source: 'dice', job }); }} title="Preview"
                        className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"><Eye size={11} /></button>
                      <button
                        onClick={() => {
                          if (ms && !ms.queued) {
                            setExpandedScore(prev => prev === job.id ? null : job.id);
                            return;
                          }
                          getDiceMatchScore(job);
                        }}
                        disabled={!!scoringJobId && scoringJobId !== job.id}
                        title={ms && !ms.queued ? 'Matched - view breakdown' : 'AI Match'}
                        className={`p-1 rounded-lg disabled:opacity-40 transition-colors ${ms && !ms.queued ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100' : 'text-gray-500 hover:bg-orange-50 hover:text-orange-600'}`}
                      >
                        {isScoring ? <LogoSpinner size={11} /> : ms && !ms.queued ? <Check size={11} /> : <Sparkles size={11} />}
                      </button>
                      <button onClick={() => saveDiceJob(job)} disabled={isSaved || isSaving} title={isSaved ? 'In Queue' : 'Add to Queue'}
                        className={`p-1 rounded-lg transition-colors ${isSaved ? 'text-green-600 bg-green-50 cursor-default' : 'text-gray-500 hover:bg-orange-50 hover:text-orange-600'}`}>
                        {isSaving ? <LogoSpinner size={11} /> : isSaved ? <BookmarkCheck size={11} /> : <Bookmark size={11} />}
                      </button>
                      {selectedProfile && (
                        <button onClick={() => addToResumeAIQueue(job.id)} disabled={rewritingJobId === job.id || rewriteStatus[job.id] === 'done'} title={rewriteStatus[job.id] === 'done' ? 'In Resume AI Queue' : 'Add to Resume AI Queue'}
                          className={`p-1 rounded-lg transition-colors ${rewriteStatus[job.id] === 'done' ? 'text-emerald-600 bg-emerald-50 cursor-default' : 'text-gray-500 hover:bg-violet-50 hover:text-violet-600 disabled:opacity-40'}`}>
                          {rewritingJobId === job.id ? <LogoSpinner size={11} /> : rewriteStatus[job.id] === 'done' ? <CheckCircle2 size={11} /> : <PenLine size={11} />}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {/* Board history section */}
              {!diceSearching && !diceError && (() => {
                const showHistoryDefault = diceShowDefault;
                const hasSearchResults = diceHasSearched && diceJobs.length > 0;
                const historyItems = diceBoardHistory;
                if (historyItems.length === 0 && !showHistoryDefault) return null;
                const isVisible = showHistoryDefault || boardHistoryVisible['dice'];
                if (!isVisible && hasSearchResults) {
                  return (
                    <button onClick={() => toggleBoardHistory('dice')}
                      className="w-full mt-1 py-2 text-[11px] font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-xl transition-colors flex items-center justify-center gap-1.5">
                      <Clock size={11} /> Load History ({historyItems.length} older jobs)
                    </button>
                  );
                }
                if (!isVisible) return null;
                const slice = getBoardHistorySlice('dice', historyItems);
                const grouped = groupByDate(slice);
                const hasMore = slice.length < historyItems.length;
                return (
                  <>
                    {hasSearchResults && (
                      <div className="flex items-center gap-2 mt-2 mb-1">
                        <div className="flex-1 h-px bg-orange-200" />
                        <span className="text-[9px] font-bold text-orange-500 uppercase tracking-wider">History</span>
                        <div className="flex-1 h-px bg-orange-200" />
                      </div>
                    )}
                    {grouped.map(group => (
                      <div key={group.date}>
                        <div className="flex items-center gap-1.5 py-1 mb-1">
                          <Clock size={9} className="text-gray-400" />
                          <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">{group.date}</span>
                        </div>
                        {group.jobs.map(hJob => {
                          const job = hJob.raw as DiceJob;
                          const isSaved = diceSavedIds.has(job.id);
                          const isSaving = diceSavingId === job.id;
                          const ms = matchScores[job.id];
                          const colors = ms ? scoreColor(ms.score) : null;
                          return (
                            <div key={job.id} className={`border rounded-xl p-2.5 flex flex-col gap-1.5 mb-2 ${cardClass(job.id, isSaved, ms, previewedIds, 'hover:border-orange-300')} transition-all opacity-90`}>
                              <div className="flex items-start gap-2">
                                {job.company_logo_url
                                  ? <img src={job.company_logo_url} alt="" className="w-6 h-6 rounded object-cover shrink-0 border border-gray-100" />
                                  : <div className="w-6 h-6 rounded bg-orange-50 flex items-center justify-center shrink-0"><Building2 size={10} className="text-orange-400" /></div>}
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] font-semibold text-gray-900 leading-tight truncate">{job.job_title ?? '—'}</p>
                                  <p className="text-[10px] text-gray-500 truncate">{job.company_name ?? '—'}</p>
                                </div>
                              </div>
                              {job.location && <p className="flex items-center gap-1 text-[10px] text-gray-400"><MapPin size={8} />{job.location}</p>}
                              {job.salary_range && <p className="flex items-center gap-1 text-[10px] text-gray-400"><DollarSign size={8} />{job.salary_range}</p>}
                              {ms && <ScoreBadge ms={ms} colors={colors!} opened={expandedScore === job.id} onToggle={() => setExpandedScore(prev => prev === job.id ? null : job.id)} profile={selectedProfile} job={job} />}
                              <div className="flex items-center gap-1 pt-1 border-t border-gray-100 mt-auto">
                                {job.job_url && (
                                  <a href={job.job_url} target="_blank" rel="noopener noreferrer" title="Apply"
                                    className="p-1 rounded-lg text-orange-500 hover:bg-orange-50 transition-colors mr-auto"><ExternalLink size={11} /></a>
                                )}
                                <button onClick={() => { setPreviewedIds(p => { const n = new Set(p); n.add(job.id); return n; }); setPreviewJob({ source: 'dice', job }); }} title="Preview"
                                  className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"><Eye size={11} /></button>
                                <button
                                  onClick={() => {
                                    if (ms && !ms.queued) {
                                      setExpandedScore(prev => prev === job.id ? null : job.id);
                                      return;
                                    }
                                    getDiceMatchScore(job);
                                  }}
                                  disabled={!!scoringJobId && scoringJobId !== job.id}
                                  title={ms && !ms.queued ? 'Matched - view breakdown' : 'AI Match'}
                                  className={`p-1 rounded-lg disabled:opacity-40 transition-colors ${ms && !ms.queued ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100' : 'text-gray-500 hover:bg-orange-50 hover:text-orange-600'}`}
                                >
                                  {scoringJobId === job.id ? <LogoSpinner size={11} /> : ms && !ms.queued ? <Check size={11} /> : <Sparkles size={11} />}
                                </button>
                                <button onClick={() => saveDiceJob(job)} disabled={isSaved || isSaving} title={isSaved ? 'In Queue' : 'Add to Queue'}
                                  className={`p-1 rounded-lg transition-colors ${isSaved ? 'text-green-600 bg-green-50 cursor-default' : 'text-gray-500 hover:bg-orange-50 hover:text-orange-600'}`}>
                                  {isSaving ? <LogoSpinner size={11} /> : isSaved ? <BookmarkCheck size={11} /> : <Bookmark size={11} />}
                                </button>
                                {selectedProfile && (
                                  <button onClick={() => addToResumeAIQueue(job.id)} disabled={rewritingJobId === job.id || rewriteStatus[job.id] === 'done'} title={rewriteStatus[job.id] === 'done' ? 'In Resume AI Queue' : 'Add to Resume AI Queue'}
                                    className={`p-1 rounded-lg transition-colors ${rewriteStatus[job.id] === 'done' ? 'text-emerald-600 bg-emerald-50 cursor-default' : 'text-gray-500 hover:bg-violet-50 hover:text-violet-600 disabled:opacity-40'}`}>
                                    {rewritingJobId === job.id ? <LogoSpinner size={11} /> : rewriteStatus[job.id] === 'done' ? <CheckCircle2 size={11} /> : <PenLine size={11} />}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {hasMore && (
                      <button onClick={() => loadMoreBoardHistory('dice')}
                        className="w-full py-2 text-[11px] font-medium text-orange-600 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-xl transition-colors">
                        Load More ({historyItems.length - slice.length} remaining)
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          )}

          {/* ── Indeed column ── */}
          {collapsedBoards.has('Indeed') ? (
            <button onClick={() => toggleCollapseBoard('Indeed')}
              className="shrink-0 w-10 flex flex-col items-center justify-start rounded-2xl border border-violet-200 bg-violet-50 shadow-sm overflow-hidden hover:bg-violet-100 transition-colors"
              title="Expand Indeed">
              <div className="w-full flex items-center justify-center py-3 border-b border-violet-200">
                <div className="w-2 h-2 rounded-full bg-violet-500" />
              </div>
              <div className="flex-1 flex items-center justify-center py-2">
                <span className="text-[10px] font-bold text-violet-600 tracking-wide"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>Indeed</span>
              </div>
              {indeedJobs.length > 0 && (
                <div className="pb-2"><span className="text-[9px] font-bold bg-violet-200 text-violet-700 px-1 py-0.5 rounded-full">{indeedJobs.length}</span></div>
              )}
            </button>
          ) : (
          <div className="w-72 min-w-[288px] shrink-0 flex flex-col rounded-2xl border border-violet-200 overflow-hidden shadow-sm">
            <div className="bg-violet-600 px-3 py-2.5 flex items-center gap-2 shrink-0">
              <button onClick={() => toggleCollapseBoard('Indeed')} title="Collapse"
                className="w-5 h-5 rounded flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0">
                <ChevronRight size={11} />
              </button>
              <span className="text-xs font-bold text-white flex-1">Indeed</span>
              {indeedSearching && <LogoSpinner size={11} />}
              {indeedError && !indeedSearching && (
                <button onClick={() => triggerBoardSearch('indeed', true)} title="Retry" className="text-violet-200 hover:text-white transition-colors"><RefreshCw size={11} /></button>
              )}
              {!indeedError && (
                <div className="relative group shrink-0">
                  <button
                    onClick={refreshIndeed}
                    disabled={isBoardCooldownActive('indeed')}
                    title={isBoardCooldownActive('indeed') ? `Refreshes in ${formatCooldown(getBoardCooldownRemainingMs('indeed'))}, Upgrade` : 'Refresh Indeed'}
                    className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                      isBoardCooldownActive('indeed')
                        ? 'bg-white/5 text-white/40 cursor-not-allowed'
                        : 'bg-white/10 hover:bg-white/20'
                    }`}>
                    <RefreshCw size={10} className="text-white" />
                  </button>
                </div>
              )}
              <span className="text-[10px] font-bold bg-white/20 text-white px-1.5 py-0.5 rounded-full">{indeedJobs.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto bg-violet-50/30 p-2 flex flex-col gap-2">
              {!indeedHasSearched && !indeedSearching && !indeedShowDefault && !boardQueueStatus.indeed && (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-4">
                  {!boardHistoryLoaded['indeed'] ? (
                    <>
                      <Clock size={20} className="text-violet-300" />
                      <p className="text-[11px] text-gray-500">View recent Indeed results for this profile</p>
                      <button onClick={() => loadBoardHistory('indeed')} disabled={!!boardHistoryLoading['indeed'] || !selectedProfile}
                        className="px-3 py-1.5 text-[11px] font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-60 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm">
                        {boardHistoryLoading['indeed'] ? <LogoSpinner size={10} /> : <RefreshCw size={10} />} Load History
                      </button>
                      <button onClick={() => triggerBoardSearch('indeed')}
                        className="px-3 py-1.5 text-[11px] font-semibold text-violet-600 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg transition-colors flex items-center gap-1.5">
                        <Search size={10} /> Search New Jobs
                      </button>
                    </>
                  ) : (
                    <>
                      <Search size={20} className="text-violet-300" />
                      <p className="text-[11px] text-gray-500">No recent history. Search for new jobs.</p>
                      <button onClick={() => triggerBoardSearch('indeed')}
                        className="px-3 py-1.5 text-[11px] font-semibold text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm">
                        <Search size={10} /> Search New Jobs
                      </button>
                    </>
                  )}
                </div>
              )}
              {indeedSearching && (
                <div className="flex flex-col items-center justify-center gap-2 py-8">
                  <LogoSpinner size={18} />
                  <p className="text-xs text-gray-500">Scraping Indeed…</p>
                </div>
              )}
              {!indeedSearching && boardQueueStatus.indeed && (
                <div className="flex flex-col items-center gap-2 py-6 text-center px-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                    <Clock size={18} className="text-amber-600" />
                  </div>
                  <p className="text-[11px] font-semibold text-amber-700">High Volume - Queued</p>
                  <p className="text-[10px] text-gray-500 leading-relaxed">Your search is in the queue. Expected wait time: ~{Math.ceil((boardQueueStatus.indeed.eta_seconds) / 60)} min</p>
                  <button onClick={() => { setBoardQueueStatus(prev => ({ ...prev, indeed: null })); triggerBoardSearch('indeed'); }}
                    className="mt-1 text-[10px] font-medium text-violet-600 hover:text-violet-800 underline">Retry now</button>
                </div>
              )}
              {indeedError && !indeedSearching && (
                <div className="flex flex-col items-center gap-1 py-6 text-center">
                  <AlertCircle size={16} className="text-red-400" />
                  <p className="text-[11px] text-red-500">{indeedError}</p>
                </div>
              )}
              {indeedHasSearched && !indeedSearching && !indeedError && indeedJobs.length === 0 && !indeedShowDefault && (
                <div className="flex flex-col items-center gap-2 py-8 text-center px-4">
                  <Briefcase size={18} className="text-gray-300" />
                  <p className="text-[11px] text-gray-500 leading-relaxed">We haven't found any results for this filter. Try a different title, expand the date range, or use a broader location.</p>
                </div>
              )}
              {!indeedSearching && !indeedError && colIndeedJobs.map(job => {
                const isSaved = indeedSavedIds.has(job.id);
                const isSaving = indeedSavingId === job.id;
                const isScoring = scoringJobId === job.id;
                const ms = matchScores[job.id];
                const colors = ms ? scoreColor(ms.score) : null;
                return (
                  <div key={job.id} className={`border rounded-xl p-2.5 flex flex-col gap-1.5 ${cardClass(job.id, isSaved, ms, previewedIds, 'hover:border-violet-300')} transition-all`}>
                    <div className="flex items-start gap-2">
                      {job.company_logo_url
                        ? <img src={job.company_logo_url} alt="" className="w-6 h-6 rounded object-cover shrink-0 border border-gray-100" />
                        : <div className="w-6 h-6 rounded bg-violet-50 flex items-center justify-center shrink-0"><Building2 size={10} className="text-violet-400" /></div>}
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold text-gray-900 leading-tight truncate">{job.job_title ?? '—'}</p>
                        <p className="text-[10px] text-gray-500 truncate">{job.company_name ?? '—'}</p>
                      </div>
                    </div>
                    {job.location_display && <p className="flex items-center gap-1 text-[10px] text-gray-400"><MapPin size={8} />{job.location_display}</p>}
                    {job.salary_display && <p className="flex items-center gap-1 text-[10px] text-gray-400"><DollarSign size={8} />{job.salary_display}</p>}
                    {timeAgo(job.date_published) && <p className="flex items-center gap-1 text-[10px] text-gray-400"><Clock size={8} />{timeAgo(job.date_published)}</p>}
                    {ms && <ScoreBadge ms={ms} colors={colors!} opened={expandedScore === job.id} onToggle={() => setExpandedScore(prev => prev === job.id ? null : job.id)} profile={selectedProfile} job={job} />}
                    <div className="flex items-center gap-1 pt-1 border-t border-gray-100 mt-auto">
                      {(job.job_url ?? job.apply_url) && (
                        <a href={job.job_url ?? job.apply_url ?? '#'} target="_blank" rel="noopener noreferrer" title="Apply"
                          className="p-1 rounded-lg text-violet-500 hover:bg-violet-50 transition-colors mr-auto"><ExternalLink size={11} /></a>
                      )}
                      <button onClick={() => { setPreviewedIds(p => { const n = new Set(p); n.add(job.id); return n; }); setPreviewJob({ source: 'indeed', job }); }} title="Preview"
                        className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"><Eye size={11} /></button>
                      <button
                        onClick={() => {
                          if (ms && !ms.queued) {
                            setExpandedScore(prev => prev === job.id ? null : job.id);
                            return;
                          }
                          getIndeedMatchScore(job);
                        }}
                        disabled={!!scoringJobId && scoringJobId !== job.id}
                        title={ms && !ms.queued ? 'Matched - view breakdown' : 'AI Match'}
                        className={`p-1 rounded-lg disabled:opacity-40 transition-colors ${ms && !ms.queued ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100' : 'text-gray-500 hover:bg-violet-50 hover:text-violet-600'}`}
                      >
                        {isScoring ? <LogoSpinner size={11} /> : ms && !ms.queued ? <Check size={11} /> : <Sparkles size={11} />}
                      </button>
                      <button onClick={() => saveIndeedJob(job)} disabled={isSaved || isSaving} title={isSaved ? 'In Queue' : 'Add to Queue'}
                        className={`p-1 rounded-lg transition-colors ${isSaved ? 'text-green-600 bg-green-50 cursor-default' : 'text-gray-500 hover:bg-violet-50 hover:text-violet-600'}`}>
                        {isSaving ? <LogoSpinner size={11} /> : isSaved ? <BookmarkCheck size={11} /> : <Bookmark size={11} />}
                      </button>
                      {selectedProfile && (
                        <button onClick={() => addToResumeAIQueue(job.id)} disabled={rewritingJobId === job.id || rewriteStatus[job.id] === 'done'} title={rewriteStatus[job.id] === 'done' ? 'In Resume AI Queue' : 'Add to Resume AI Queue'}
                          className={`p-1 rounded-lg transition-colors ${rewriteStatus[job.id] === 'done' ? 'text-emerald-600 bg-emerald-50 cursor-default' : 'text-gray-500 hover:bg-violet-50 hover:text-violet-600 disabled:opacity-40'}`}>
                          {rewritingJobId === job.id ? <LogoSpinner size={11} /> : rewriteStatus[job.id] === 'done' ? <CheckCircle2 size={11} /> : <PenLine size={11} />}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {/* Board history section */}
              {!indeedSearching && !indeedError && (() => {
                const showHistoryDefault = indeedShowDefault;
                const hasSearchResults = indeedHasSearched && indeedJobs.length > 0;
                const historyItems = indeedBoardHistory;
                if (historyItems.length === 0 && !showHistoryDefault) return null;
                const isVisible = showHistoryDefault || boardHistoryVisible['indeed'];
                if (!isVisible && hasSearchResults) {
                  return (
                    <button onClick={() => toggleBoardHistory('indeed')}
                      className="w-full mt-1 py-2 text-[11px] font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-xl transition-colors flex items-center justify-center gap-1.5">
                      <Clock size={11} /> Load History ({historyItems.length} older jobs)
                    </button>
                  );
                }
                if (!isVisible) return null;
                const slice = getBoardHistorySlice('indeed', historyItems);
                const grouped = groupByDate(slice);
                const hasMore = slice.length < historyItems.length;
                return (
                  <>
                    {hasSearchResults && (
                      <div className="flex items-center gap-2 mt-2 mb-1">
                        <div className="flex-1 h-px bg-violet-200" />
                        <span className="text-[9px] font-bold text-violet-500 uppercase tracking-wider">History</span>
                        <div className="flex-1 h-px bg-violet-200" />
                      </div>
                    )}
                    {grouped.map(group => (
                      <div key={group.date}>
                        <div className="flex items-center gap-1.5 py-1 mb-1">
                          <Clock size={9} className="text-gray-400" />
                          <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">{group.date}</span>
                        </div>
                        {group.jobs.map(hJob => {
                          const job = hJob.raw as IndeedJob;
                          const isSaved = indeedSavedIds.has(job.id);
                          const isSaving = indeedSavingId === job.id;
                          const ms = matchScores[job.id];
                          const colors = ms ? scoreColor(ms.score) : null;
                          return (
                            <div key={job.id} className={`border rounded-xl p-2.5 flex flex-col gap-1.5 mb-2 ${cardClass(job.id, isSaved, ms, previewedIds, 'hover:border-violet-300')} transition-all opacity-90`}>
                              <div className="flex items-start gap-2">
                                {job.company_logo_url
                                  ? <img src={job.company_logo_url} alt="" className="w-6 h-6 rounded object-cover shrink-0 border border-gray-100" />
                                  : <div className="w-6 h-6 rounded bg-violet-50 flex items-center justify-center shrink-0"><Building2 size={10} className="text-violet-400" /></div>}
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] font-semibold text-gray-900 leading-tight truncate">{job.job_title ?? '—'}</p>
                                  <p className="text-[10px] text-gray-500 truncate">{job.company_name ?? '—'}</p>
                                </div>
                              </div>
                              {job.location_display && <p className="flex items-center gap-1 text-[10px] text-gray-400"><MapPin size={8} />{job.location_display}</p>}
                              {job.salary_display && <p className="flex items-center gap-1 text-[10px] text-gray-400"><DollarSign size={8} />{job.salary_display}</p>}
                              {ms && <ScoreBadge ms={ms} colors={colors!} opened={expandedScore === job.id} onToggle={() => setExpandedScore(prev => prev === job.id ? null : job.id)} profile={selectedProfile} job={job} />}
                              <div className="flex items-center gap-1 pt-1 border-t border-gray-100 mt-auto">
                                {(job.job_url ?? job.apply_url) && (
                                  <a href={job.job_url ?? job.apply_url ?? '#'} target="_blank" rel="noopener noreferrer" title="Apply"
                                    className="p-1 rounded-lg text-violet-500 hover:bg-violet-50 transition-colors mr-auto"><ExternalLink size={11} /></a>
                                )}
                                <button onClick={() => { setPreviewedIds(p => { const n = new Set(p); n.add(job.id); return n; }); setPreviewJob({ source: 'indeed', job }); }} title="Preview"
                                  className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"><Eye size={11} /></button>
                                <button
                                  onClick={() => {
                                    if (ms && !ms.queued) {
                                      setExpandedScore(prev => prev === job.id ? null : job.id);
                                      return;
                                    }
                                    getIndeedMatchScore(job);
                                  }}
                                  disabled={!!scoringJobId && scoringJobId !== job.id}
                                  title={ms && !ms.queued ? 'Matched - view breakdown' : 'AI Match'}
                                  className={`p-1 rounded-lg disabled:opacity-40 transition-colors ${ms && !ms.queued ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100' : 'text-gray-500 hover:bg-violet-50 hover:text-violet-600'}`}
                                >
                                  {scoringJobId === job.id ? <LogoSpinner size={11} /> : ms && !ms.queued ? <Check size={11} /> : <Sparkles size={11} />}
                                </button>
                                <button onClick={() => saveIndeedJob(job)} disabled={isSaved || isSaving} title={isSaved ? 'In Queue' : 'Add to Queue'}
                                  className={`p-1 rounded-lg transition-colors ${isSaved ? 'text-green-600 bg-green-50 cursor-default' : 'text-gray-500 hover:bg-violet-50 hover:text-violet-600'}`}>
                                  {isSaving ? <LogoSpinner size={11} /> : isSaved ? <BookmarkCheck size={11} /> : <Bookmark size={11} />}
                                </button>
                                {selectedProfile && (
                                  <button onClick={() => addToResumeAIQueue(job.id)} disabled={rewritingJobId === job.id || rewriteStatus[job.id] === 'done'} title={rewriteStatus[job.id] === 'done' ? 'In Resume AI Queue' : 'Add to Resume AI Queue'}
                                    className={`p-1 rounded-lg transition-colors ${rewriteStatus[job.id] === 'done' ? 'text-emerald-600 bg-emerald-50 cursor-default' : 'text-gray-500 hover:bg-violet-50 hover:text-violet-600 disabled:opacity-40'}`}>
                                    {rewritingJobId === job.id ? <LogoSpinner size={11} /> : rewriteStatus[job.id] === 'done' ? <CheckCircle2 size={11} /> : <PenLine size={11} />}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {hasMore && (
                      <button onClick={() => loadMoreBoardHistory('indeed')}
                        className="w-full py-2 text-[11px] font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-xl transition-colors">
                        Load More ({historyItems.length - slice.length} remaining)
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          )}

          {/* ── Monster column ── */}
          {collapsedBoards.has('Monster') ? (
            <button onClick={() => toggleCollapseBoard('Monster')}
              className="shrink-0 w-10 flex flex-col items-center justify-start rounded-2xl border border-green-200 bg-green-50 shadow-sm overflow-hidden hover:bg-green-100 transition-colors"
              title="Expand Monster">
              <div className="w-full flex items-center justify-center py-3 border-b border-green-200">
                <div className="w-2 h-2 rounded-full bg-green-500" />
              </div>
              <div className="flex-1 flex items-center justify-center py-2">
                <span className="text-[10px] font-bold text-green-700 tracking-wide"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>Monster</span>
              </div>
              {monsterJobs.length > 0 && (
                <div className="pb-2"><span className="text-[9px] font-bold bg-green-200 text-green-700 px-1 py-0.5 rounded-full">{monsterJobs.length}</span></div>
              )}
            </button>
          ) : (
          <div className="w-72 min-w-[288px] shrink-0 flex flex-col rounded-2xl border border-green-200 overflow-hidden shadow-sm">
            <div className="bg-green-600 px-3 py-2.5 flex items-center gap-2 shrink-0">
              <button onClick={() => toggleCollapseBoard('Monster')} title="Collapse"
                className="w-5 h-5 rounded flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0">
                <ChevronRight size={11} />
              </button>
              <span className="text-xs font-bold text-white flex-1">Monster</span>
              {monsterSearching && <LogoSpinner size={11} />}
              {monsterError && !monsterSearching && (
                <button onClick={() => triggerBoardSearch('monster', true)} title="Retry" className="text-green-200 hover:text-white transition-colors"><RefreshCw size={11} /></button>
              )}
              {!monsterError && (
                <div className="relative group shrink-0">
                  <button
                    onClick={refreshMonster}
                    disabled={isBoardCooldownActive('monster')}
                    title={isBoardCooldownActive('monster') ? `Refreshes in ${formatCooldown(getBoardCooldownRemainingMs('monster'))}, Upgrade` : 'Refresh Monster'}
                    className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
                      isBoardCooldownActive('monster')
                        ? 'bg-white/5 text-white/40 cursor-not-allowed'
                        : 'bg-white/10 hover:bg-white/20'
                    }`}>
                    <RefreshCw size={10} className="text-white" />
                  </button>
                </div>
              )}
              <span className="text-[10px] font-bold bg-white/20 text-white px-1.5 py-0.5 rounded-full">{monsterJobs.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto bg-green-50/30 p-2 flex flex-col gap-2">
              {!monsterHasSearched && !monsterSearching && !monsterShowDefault && !boardQueueStatus.monster && (
                <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-4">
                  {!boardHistoryLoaded['monster'] ? (
                    <>
                      <Clock size={20} className="text-green-300" />
                      <p className="text-[11px] text-gray-500">View recent Monster results for this profile</p>
                      <button onClick={() => loadBoardHistory('monster')} disabled={!!boardHistoryLoading['monster'] || !selectedProfile}
                        className="px-3 py-1.5 text-[11px] font-semibold text-white bg-green-600 hover:bg-green-700 disabled:opacity-60 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm">
                        {boardHistoryLoading['monster'] ? <LogoSpinner size={10} /> : <RefreshCw size={10} />} Load History
                      </button>
                      <button onClick={() => triggerBoardSearch('monster')}
                        className="px-3 py-1.5 text-[11px] font-semibold text-green-600 bg-green-50 hover:bg-green-100 border border-green-200 rounded-lg transition-colors flex items-center gap-1.5">
                        <Search size={10} /> Search New Jobs
                      </button>
                    </>
                  ) : (
                    <>
                      <Search size={20} className="text-green-300" />
                      <p className="text-[11px] text-gray-500">No recent history. Search for new jobs.</p>
                      <button onClick={() => triggerBoardSearch('monster')}
                        className="px-3 py-1.5 text-[11px] font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors flex items-center gap-1.5 shadow-sm">
                        <Search size={10} /> Search New Jobs
                      </button>
                    </>
                  )}
                </div>
              )}
              {monsterSearching && (
                <div className="flex flex-col items-center justify-center gap-2 py-8">
                  <LogoSpinner size={18} />
                  <p className="text-xs text-gray-500">Scraping Monster…</p>
                </div>
              )}
              {!monsterSearching && boardQueueStatus.monster && (
                <div className="flex flex-col items-center gap-2 py-6 text-center px-3">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                    <Clock size={18} className="text-amber-600" />
                  </div>
                  <p className="text-[11px] font-semibold text-amber-700">High Volume - Queued</p>
                  <p className="text-[10px] text-gray-500 leading-relaxed">Your search is in the queue. Expected wait time: ~{Math.ceil((boardQueueStatus.monster.eta_seconds) / 60)} min</p>
                  <button onClick={() => { setBoardQueueStatus(prev => ({ ...prev, monster: null })); triggerBoardSearch('monster'); }}
                    className="mt-1 text-[10px] font-medium text-green-600 hover:text-green-800 underline">Retry now</button>
                </div>
              )}
              {monsterError && !monsterSearching && (
                <div className="flex flex-col items-center gap-1 py-6 text-center">
                  <AlertCircle size={16} className="text-red-400" />
                  <p className="text-[11px] text-red-500">{monsterError}</p>
                </div>
              )}
              {monsterHasSearched && !monsterSearching && !monsterError && monsterJobs.length === 0 && !monsterShowDefault && (
                <div className="flex flex-col items-center gap-2 py-8 text-center px-4">
                  <Briefcase size={18} className="text-gray-300" />
                  <p className="text-[11px] text-gray-500 leading-relaxed">We haven't found any results for this filter. Try a different title, expand the date range, or use a broader location.</p>
                </div>
              )}
              {!monsterSearching && !monsterError && colMonsterJobs.map(job => {
                const isSaved = monsterSavedIds.has(job.id);
                const isSaving = monsterSavingId === job.id;
                const isScoring = scoringJobId === job.id;
                const ms = matchScores[job.id];
                const colors = ms ? scoreColor(ms.score) : null;
                return (
                  <div key={job.id} className={`border rounded-xl p-2.5 flex flex-col gap-1.5 ${cardClass(job.id, isSaved, ms, previewedIds, 'hover:border-green-300')} transition-all`}>
                    <div className="flex items-start gap-2">
                      {job.company_logo_url
                        ? <img src={job.company_logo_url} alt="" className="w-6 h-6 rounded object-cover shrink-0 border border-gray-100" />
                        : <div className="w-6 h-6 rounded bg-green-50 flex items-center justify-center shrink-0"><Building2 size={10} className="text-green-500" /></div>}
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold text-gray-900 leading-tight truncate">{job.job_title ?? '—'}</p>
                        <p className="text-[10px] text-gray-500 truncate">{job.company_name ?? '—'}</p>
                      </div>
                    </div>
                    {job.location_display && <p className="flex items-center gap-1 text-[10px] text-gray-400"><MapPin size={8} />{job.location_display}</p>}
                    {(job.salary_min || job.salary_max) && <p className="flex items-center gap-1 text-[10px] text-gray-400"><DollarSign size={8} />{job.salary_min && job.salary_max ? `${job.salary_min}–${job.salary_max}` : (job.salary_min ?? job.salary_max)}</p>}
                    {(job.date_recency || timeAgo(job.date_published)) && <p className="flex items-center gap-1 text-[10px] text-gray-400"><Clock size={8} />{job.date_recency ?? timeAgo(job.date_published)}</p>}
                    {ms && <ScoreBadge ms={ms} colors={colors!} opened={expandedScore === job.id} onToggle={() => setExpandedScore(prev => prev === job.id ? null : job.id)} profile={selectedProfile} job={job} />}
                    <div className="flex items-center gap-1 pt-1 border-t border-gray-100 mt-auto">
                      {job.apply_url && (
                        <a href={job.apply_url} target="_blank" rel="noopener noreferrer" title="Apply"
                          className="p-1 rounded-lg text-green-600 hover:bg-green-50 transition-colors mr-auto"><ExternalLink size={11} /></a>
                      )}
                      <button onClick={() => { setPreviewedIds(p => { const n = new Set(p); n.add(job.id); return n; }); setPreviewJob({ source: 'monster', job }); }} title="Preview"
                        className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"><Eye size={11} /></button>
                      <button
                        onClick={() => {
                          if (ms && !ms.queued) {
                            setExpandedScore(prev => prev === job.id ? null : job.id);
                            return;
                          }
                          getMonsterMatchScore(job);
                        }}
                        disabled={!!scoringJobId && scoringJobId !== job.id}
                        title={ms && !ms.queued ? 'Matched - view breakdown' : 'AI Match'}
                        className={`p-1 rounded-lg disabled:opacity-40 transition-colors ${ms && !ms.queued ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100' : 'text-gray-500 hover:bg-green-50 hover:text-green-600'}`}
                      >
                        {isScoring ? <LogoSpinner size={11} /> : ms && !ms.queued ? <Check size={11} /> : <Sparkles size={11} />}
                      </button>
                      <button onClick={() => saveMonsterJob(job)} disabled={isSaved || isSaving} title={isSaved ? 'In Queue' : 'Add to Queue'}
                        className={`p-1 rounded-lg transition-colors ${isSaved ? 'text-green-600 bg-green-50 cursor-default' : 'text-gray-500 hover:bg-green-50 hover:text-green-600'}`}>
                        {isSaving ? <LogoSpinner size={11} /> : isSaved ? <BookmarkCheck size={11} /> : <Bookmark size={11} />}
                      </button>
                      {selectedProfile && (
                        <button onClick={() => addToResumeAIQueue(job.id)} disabled={rewritingJobId === job.id || rewriteStatus[job.id] === 'done'} title={rewriteStatus[job.id] === 'done' ? 'In Resume AI Queue' : 'Add to Resume AI Queue'}
                          className={`p-1 rounded-lg transition-colors ${rewriteStatus[job.id] === 'done' ? 'text-emerald-600 bg-emerald-50 cursor-default' : 'text-gray-500 hover:bg-violet-50 hover:text-violet-600 disabled:opacity-40'}`}>
                          {rewritingJobId === job.id ? <LogoSpinner size={11} /> : rewriteStatus[job.id] === 'done' ? <CheckCircle2 size={11} /> : <PenLine size={11} />}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {/* Board history section */}
              {!monsterSearching && !monsterError && (() => {
                const showHistoryDefault = monsterShowDefault;
                const hasSearchResults = monsterHasSearched && monsterJobs.length > 0;
                const historyItems = monsterBoardHistory;
                if (historyItems.length === 0 && !showHistoryDefault) return null;
                const isVisible = showHistoryDefault || boardHistoryVisible['monster'];
                if (!isVisible && hasSearchResults) {
                  return (
                    <button onClick={() => toggleBoardHistory('monster')}
                      className="w-full mt-1 py-2 text-[11px] font-medium text-green-600 bg-green-50 hover:bg-green-100 border border-green-200 rounded-xl transition-colors flex items-center justify-center gap-1.5">
                      <Clock size={11} /> Load History ({historyItems.length} older jobs)
                    </button>
                  );
                }
                if (!isVisible) return null;
                const slice = getBoardHistorySlice('monster', historyItems);
                const grouped = groupByDate(slice);
                const hasMore = slice.length < historyItems.length;
                return (
                  <>
                    {hasSearchResults && (
                      <div className="flex items-center gap-2 mt-2 mb-1">
                        <div className="flex-1 h-px bg-green-200" />
                        <span className="text-[9px] font-bold text-green-500 uppercase tracking-wider">History</span>
                        <div className="flex-1 h-px bg-green-200" />
                      </div>
                    )}
                    {grouped.map(group => (
                      <div key={group.date}>
                        <div className="flex items-center gap-1.5 py-1 mb-1">
                          <Clock size={9} className="text-gray-400" />
                          <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">{group.date}</span>
                        </div>
                        {group.jobs.map(hJob => {
                          const job = hJob.raw as MonsterJob;
                          const isSaved = monsterSavedIds.has(job.id);
                          const isSaving = monsterSavingId === job.id;
                          const ms = matchScores[job.id];
                          const colors = ms ? scoreColor(ms.score) : null;
                          return (
                            <div key={job.id} className={`border rounded-xl p-2.5 flex flex-col gap-1.5 mb-2 ${cardClass(job.id, isSaved, ms, previewedIds, 'hover:border-green-300')} transition-all opacity-90`}>
                              <div className="flex items-start gap-2">
                                {job.company_logo_url
                                  ? <img src={job.company_logo_url} alt="" className="w-6 h-6 rounded object-cover shrink-0 border border-gray-100" />
                                  : <div className="w-6 h-6 rounded bg-green-50 flex items-center justify-center shrink-0"><Building2 size={10} className="text-green-500" /></div>}
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] font-semibold text-gray-900 leading-tight truncate">{job.job_title ?? '—'}</p>
                                  <p className="text-[10px] text-gray-500 truncate">{job.company_name ?? '—'}</p>
                                </div>
                              </div>
                              {job.location_display && <p className="flex items-center gap-1 text-[10px] text-gray-400"><MapPin size={8} />{job.location_display}</p>}
                              {(job.salary_min || job.salary_max) && <p className="flex items-center gap-1 text-[10px] text-gray-400"><DollarSign size={8} />{job.salary_min && job.salary_max ? `${job.salary_min}–${job.salary_max}` : (job.salary_min ?? job.salary_max)}</p>}
                              {ms && <ScoreBadge ms={ms} colors={colors!} opened={expandedScore === job.id} onToggle={() => setExpandedScore(prev => prev === job.id ? null : job.id)} profile={selectedProfile} job={job} />}
                              <div className="flex items-center gap-1 pt-1 border-t border-gray-100 mt-auto">
                                {job.apply_url && (
                                  <a href={job.apply_url} target="_blank" rel="noopener noreferrer" title="Apply"
                                    className="p-1 rounded-lg text-green-600 hover:bg-green-50 transition-colors mr-auto"><ExternalLink size={11} /></a>
                                )}
                                <button onClick={() => { setPreviewedIds(p => { const n = new Set(p); n.add(job.id); return n; }); setPreviewJob({ source: 'monster', job }); }} title="Preview"
                                  className="p-1 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"><Eye size={11} /></button>
                                <button
                                  onClick={() => {
                                    if (ms && !ms.queued) {
                                      setExpandedScore(prev => prev === job.id ? null : job.id);
                                      return;
                                    }
                                    getMonsterMatchScore(job);
                                  }}
                                  disabled={!!scoringJobId && scoringJobId !== job.id}
                                  title={ms && !ms.queued ? 'Matched - view breakdown' : 'AI Match'}
                                  className={`p-1 rounded-lg disabled:opacity-40 transition-colors ${ms && !ms.queued ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100' : 'text-gray-500 hover:bg-green-50 hover:text-green-600'}`}
                                >
                                  {scoringJobId === job.id ? <LogoSpinner size={11} /> : ms && !ms.queued ? <Check size={11} /> : <Sparkles size={11} />}
                                </button>
                                <button onClick={() => saveMonsterJob(job)} disabled={isSaved || isSaving} title={isSaved ? 'In Queue' : 'Add to Queue'}
                                  className={`p-1 rounded-lg transition-colors ${isSaved ? 'text-green-600 bg-green-50 cursor-default' : 'text-gray-500 hover:bg-green-50 hover:text-green-600'}`}>
                                  {isSaving ? <LogoSpinner size={11} /> : isSaved ? <BookmarkCheck size={11} /> : <Bookmark size={11} />}
                                </button>
                                {selectedProfile && (
                                  <button onClick={() => addToResumeAIQueue(job.id)} disabled={rewritingJobId === job.id || rewriteStatus[job.id] === 'done'} title={rewriteStatus[job.id] === 'done' ? 'In Resume AI Queue' : 'Add to Resume AI Queue'}
                                    className={`p-1 rounded-lg transition-colors ${rewriteStatus[job.id] === 'done' ? 'text-emerald-600 bg-emerald-50 cursor-default' : 'text-gray-500 hover:bg-violet-50 hover:text-violet-600 disabled:opacity-40'}`}>
                                    {rewritingJobId === job.id ? <LogoSpinner size={11} /> : rewriteStatus[job.id] === 'done' ? <CheckCircle2 size={11} /> : <PenLine size={11} />}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                    {hasMore && (
                      <button onClick={() => loadMoreBoardHistory('monster')}
                        className="w-full py-2 text-[11px] font-medium text-green-600 bg-green-50 hover:bg-green-100 border border-green-200 rounded-xl transition-colors">
                        Load More ({historyItems.length - slice.length} remaining)
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          )}

          {/* ── CareerBuilder / Upcoming Boards ── */}
          {collapsedBoards.has('CareerBuilder') ? (
            <button onClick={() => toggleCollapseBoard('CareerBuilder')}
              className="shrink-0 w-10 flex flex-col items-center justify-start rounded-2xl border border-emerald-200 bg-emerald-50 shadow-sm overflow-hidden hover:bg-emerald-100 transition-colors"
              title="Expand CareerBuilder">
              <div className="w-full flex items-center justify-center py-3 border-b border-emerald-200">
                <div className="w-2 h-2 rounded-full bg-emerald-500" />
              </div>
              <div className="flex-1 flex items-center justify-center py-2">
                <span className="text-[10px] font-bold text-emerald-700 tracking-wide"
                  style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>CB</span>
              </div>
            </button>
          ) : (
          <div className="w-72 min-w-[288px] shrink-0 flex flex-col rounded-2xl border border-emerald-200 overflow-hidden shadow-sm">
            <div className="bg-emerald-600 px-3 py-2.5 flex items-center gap-2 shrink-0">
              <button onClick={() => toggleCollapseBoard('CareerBuilder')} title="Collapse"
                className="w-5 h-5 rounded flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0">
                <ChevronRight size={11} />
              </button>
              <span className="text-xs font-bold text-white flex-1">CareerBuilder</span>
              <span className="text-[9px] font-bold bg-emerald-400/80 text-white px-2 py-0.5 rounded-full tracking-wide uppercase">Coming Soon</span>
            </div>
            <div className="flex-1 overflow-y-auto bg-emerald-50/20 p-3 flex flex-col gap-2">
              <p className="text-[11px] text-gray-500 text-center pb-1">Vote for the next job boards we should add</p>
              {(['Tech Finder','Seek','Glassdoor','Job Street','Google Jobs','Remote.co','Upwork','Ashby','Reed','WellFound','JobFound','StepStone','Greenhouse'] as const).map(boardName => {
                const entry = boardVotes[boardName];
                const voted = userVotedBoards.has(boardName);
                const isVoting = votingBoard === boardName;
                return (
                  <div key={boardName} className="flex items-center gap-2 bg-white border border-emerald-100 rounded-xl px-3 py-2 hover:border-emerald-300 hover:shadow-sm transition-all">
                    <span className="flex-1 text-[12px] font-medium text-gray-800">{boardName}</span>
                    {entry && (
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full min-w-[24px] text-center">
                        {entry.vote_count}
                      </span>
                    )}
                    <button
                      onClick={() => voteForBoard(boardName)}
                      disabled={voted || isVoting || !user?.id}
                      title={!user?.id ? 'Sign in to vote' : voted ? 'Already voted' : 'Vote'}
                      className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg transition-colors ${
                        voted
                          ? 'bg-emerald-100 text-emerald-600 cursor-default'
                          : !user?.id
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : 'bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95'
                      }`}>
                      {isVoting ? <LogoSpinner size={10} /> : voted ? <ThumbsUp size={10} /> : <ThumbsUp size={10} />}
                      <span>{voted ? 'Voted' : 'Vote'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          )}

        </div>{/* end board columns */}
        </div>{/* end right panel */}
      </div>{/* end outer flex */}

      {previewJob && (
        <JobPreviewModal
          entry={previewJob}
          ms={matchScores[previewJob.job.id] ?? null}
          scoringJobId={scoringJobId}
          expandedScore={expandedScore}
          setExpandedScore={setExpandedScore}
          onScore={() => {
            if (previewJob.source === 'linkedin') getMatchScore(previewJob.job);
            else if (previewJob.source === 'dice') getDiceMatchScore(previewJob.job);
            else if (previewJob.source === 'monster') getMonsterMatchScore(previewJob.job);
            else if (previewJob.source === 'careerbuilder') getCbMatchScore(previewJob.job);
            else getIndeedMatchScore(previewJob.job);
          }}
          onSave={() => {
            if (previewJob.source === 'linkedin') saveLinkedInJob(previewJob.job);
            else if (previewJob.source === 'dice') saveDiceJob(previewJob.job);
            else if (previewJob.source === 'monster') saveMonsterJob(previewJob.job);
            else if (previewJob.source === 'careerbuilder') saveCbJob(previewJob.job);
            else saveIndeedJob(previewJob.job);
          }}
          isSaved={
            previewJob.source === 'linkedin'      ? linkedinSavedIds.has(previewJob.job.id) :
            previewJob.source === 'dice'          ? diceSavedIds.has(previewJob.job.id) :
            previewJob.source === 'monster'       ? monsterSavedIds.has(previewJob.job.id) :
            previewJob.source === 'careerbuilder' ? cbSavedIds.has(previewJob.job.id) :
            indeedSavedIds.has(previewJob.job.id)
          }
          isSaving={
            previewJob.source === 'linkedin'      ? linkedinSavingId === previewJob.job.id :
            previewJob.source === 'dice'          ? diceSavingId === previewJob.job.id :
            previewJob.source === 'monster'       ? monsterSavingId === previewJob.job.id :
            previewJob.source === 'careerbuilder' ? cbSavingId === previewJob.job.id :
            indeedSavingId === previewJob.job.id
          }
          onAddToQueue={selectedProfile ? () => addToResumeAIQueue(previewJob.job.id) : undefined}
          addingToQueue={rewritingJobId === previewJob.job.id}
          addedToQueue={rewriteStatus[previewJob.job.id] === 'done'}
          profile={selectedProfile}
          onClose={() => setPreviewJob(null)}
        />
      )}

      {refreshPopupBoard && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setRefreshPopupBoard(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">
                Refresh {refreshPopupBoard === 'linkedin' ? 'LinkedIn' : refreshPopupBoard === 'careerbuilder' ? 'CareerBuilder' : refreshPopupBoard.charAt(0).toUpperCase() + refreshPopupBoard.slice(1)}
              </h3>
              <button onClick={() => setRefreshPopupBoard(null)} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <X size={14} className="text-gray-400" />
              </button>
            </div>
            <div className="px-5 py-4 flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Keyword / Job Title</label>
                <input
                  type="text"
                  value={refreshKeyword}
                  onChange={e => setRefreshKeyword(e.target.value)}
                  placeholder="e.g. Software Engineer"
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Location</label>
                <input
                  type="text"
                  value={refreshLocation}
                  onChange={e => setRefreshLocation(e.target.value)}
                  placeholder="e.g. New York, NY"
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Date Posted</label>
                <select
                  value={refreshDateFilter}
                  onChange={e => setRefreshDateFilter(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white"
                >
                  {DATE_FILTERS.map(df => <option key={df} value={df}>{df}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Experience</label>
                <select
                  value={refreshExperience}
                  onChange={e => setRefreshExperience(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white"
                >
                  <option value="">Any level</option>
                  {EXPERIENCE_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Job Type</label>
                <select
                  value={refreshJobType}
                  onChange={e => setRefreshJobType(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 text-gray-700 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white"
                >
                  <option value="">Any type</option>
                  {JOB_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Max Results</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={5}
                    max={200}
                    step={5}
                    value={refreshMaxResults}
                    onChange={e => setRefreshMaxResults(Number(e.target.value))}
                    className="flex-1 h-1.5 accent-blue-600 cursor-pointer"
                  />
                  <span className="text-xs font-semibold text-gray-700 min-w-[28px] text-right">{refreshMaxResults}</span>
                </div>
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-2 justify-end">
              <button onClick={() => setRefreshPopupBoard(null)} className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                Cancel
              </button>
              {refreshPopupCooldownActive ? (
                <button
                  type="button"
                  onClick={openUpgradeModal}
                  className="px-4 py-1.5 text-xs font-bold bg-gray-200 text-gray-500 rounded-lg transition-colors flex items-center gap-1.5 cursor-not-allowed"
                >
                  <RefreshCw size={11} />
                  {!isPaidPlan
                    ? 'Used all refreshes in last 24h, Upgrade'
                    : `Refreshes in ${formatCooldown(refreshPopupCooldownRemainingMs)}, Upgrade`}
                </button>
              ) : (
                <button onClick={executeRefresh} className="px-4 py-1.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-1.5">
                  <RefreshCw size={11} />
                  Fetch Jobs
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
}
