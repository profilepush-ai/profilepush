import { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bell, Filter, Lock, Menu, RefreshCcw, Target, TrendingUp, Search, Database, Calendar, ChevronDown, X, Plus, Mail, Play, Pause, Trash2, ExternalLink, Save, SlidersHorizontal, Activity, Megaphone, FileSearch, Send, MessageSquare, UserRound, LayoutGrid, Sparkles, List as ListIcon, Table as TableIcon, Star, Zap, Globe, Building2, Briefcase } from 'lucide-react';
import LogoSpinner from '../components/LogoSpinner';
import LinkedinKeywordScraperPanel from '../components/LinkedinKeywordScraperPanel';
import AdminScraperLogsPanel from '../components/AdminScraperLogsPanel';
import AdminCareerSitesPanel from '../components/AdminCareerSitesPanel';
import AdminCareerJobsPanel from '../components/AdminCareerJobsPanel';
import AdminRevenuePanel from '../components/AdminRevenuePanel';
import AdminAiPromptsPanel from '../components/AdminAiPromptsPanel';
import AdminChannelsPanel from '../components/AdminChannelsPanel';
import AdminListsPanel from '../components/AdminListsPanel';
import AdminEmailsPanel from '../components/AdminEmailsPanel';
import AdminFeedbackPanel from '../components/AdminFeedbackPanel';
import AdminMarketPanel from '../components/AdminMarketPanel';
import AdminSocialPosterPanel from '../components/AdminSocialPosterPanel';
import AdminNotificationsPanel from '../components/AdminNotificationsPanel';
import AdminTrendCharts from '../components/AdminTrendCharts';
import AdminFunnels from '../components/AdminFunnels';
import AdminProgress from '../components/AdminProgress';
import AdminEventsTable from '../components/AdminEventsTable';
import { buildMetricSeries, type DailyRow } from '../lib/admin-signups-series';
import { formatChange, trendOf, type Trend } from '../lib/admin-targets';
import type { BriefLine } from '../lib/admin-briefing';
import {
  ROLE_FILTERS,
  ROLE_LABEL,
  TEASER_LABEL,
  formatInr,
  formatUsd,
  isCurrentPayload,
  totalsFor,
  type AccountRow,
  type EventRow,
  type RoleFilter,
  type Totals,
} from '../lib/admin-account-stats';
import AdminTrendsPanel from '../components/AdminTrendsPanel';
import AdminPostOutreachPanel from '../components/AdminPostOutreachPanel';
import { AdminWebsitesPanel } from './AdminWebsitesPage';
import { supabase } from '../lib/supabase';
import { filterAndSortAccountStats, sortValue, type AdminStatsSortDirection, type AdminStatsSortKey } from '../lib/admin-dashboard-table';

interface LinkedinGroupRow {
  group_id: string;
  group_name: string | null;
  is_active: boolean;
  scraped_posts_count: number;
  social_jobs_count: number;
  radar_results_count: number;
  last_scraped_at: string | null;
  created_at: string;
  updated_at: string;
}

interface LinkedinScraperConfig {
  is_enabled: boolean;
  max_pages: number;
  max_posts_per_group: number;
  posted_limit: '24h' | 'week' | 'month';
  sort_by: 'date' | 'relevance';
  schedule_interval_hours: number;
  last_scheduled_at: string | null;
  updated_at: string;
}

type AdminView = 'revenue' | 'stats' | 'websites' | 'lists' | 'emails' | 'feedback' | 'scraper' | 'scraper-logs' | 'career-sites' | 'career-jobs' | 'ai-prompts' | 'channels' | 'market' | 'trends' | 'post-outreach' | 'social' | 'notifications';

// The sidebar renders from this rather than from nine hand-written buttons,
// which is what the top nav had become — adding a section meant editing the
// markup in three places and the subtitle chain in a fourth.
const ADMIN_NAV: Array<{ id: AdminView; label: string; Icon: typeof TrendingUp }> = [
  { id: 'revenue', label: 'Revenue', Icon: TrendingUp },
  { id: 'stats', label: 'Account Stats', Icon: UserRound },
  { id: 'websites', label: 'Websites', Icon: Globe },
  { id: 'lists', label: 'Lists', Icon: ListIcon },
  { id: 'emails', label: 'Emails', Icon: Mail },
  { id: 'feedback', label: 'Feedback', Icon: Star },
  { id: 'scraper', label: 'Scraper Config', Icon: Database },
  { id: 'scraper-logs', label: 'Scraper Logs', Icon: FileSearch },
  { id: 'career-sites', label: 'Career Sites', Icon: Building2 },
  { id: 'career-jobs', label: 'Career Jobs', Icon: Briefcase },
  { id: 'ai-prompts', label: 'AI Prompts', Icon: Sparkles },
  { id: 'channels', label: 'Channels', Icon: MessageSquare },
  { id: 'market', label: 'Market', Icon: TrendingUp },
  { id: 'trends', label: 'Trends', Icon: Activity },
  { id: 'post-outreach', label: 'Post Outreach', Icon: Megaphone },
  { id: 'social', label: 'Social Poster', Icon: Send },
  { id: 'notifications', label: 'Notifications', Icon: Bell },
];
type ScraperConfigTab = 'group' | 'keyword';
type LinkedinStatsRange = '24h' | '7d' | '30d' | 'all' | 'custom';

type DatePreset = '7d' | '30d' | '90d' | 'all' | 'custom';

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom range' },
];

function getDateRange(preset: DatePreset, customStart: string, customEnd: string): { start_date: string | null; end_date: string | null } {
  if (preset === 'all') return { start_date: null, end_date: null };
  if (preset === 'custom') {
    return {
      start_date: customStart || null,
      end_date: customEnd ? `${customEnd}T23:59:59.999Z` : null,
    };
  }
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return { start_date: d.toISOString(), end_date: null };
}

type ColumnGroup = 'Who' | 'Money' | 'Matches' | 'Applying' | 'Results' | 'Extras';
type ColumnKind = 'name' | 'text' | 'role' | 'number' | 'inr' | 'usd' | 'duration' | 'age' | 'date' | 'yes' | 'plan' | 'teaser';
type Column = { key: AdminStatsSortKey; label: string; kind: ColumnKind; group: ColumnGroup; width: number; title?: string };

// Grouped the way the product runs. Activity columns count inside the chosen
// range; state columns (role, paid, credits, profiles or jobs, last active)
// are as of now.
const COLUMNS: Column[] = [
  { group: 'Who', key: 'name', label: 'Name', kind: 'name', width: 170 },
  { group: 'Who', key: 'email', label: 'Email', kind: 'text', width: 210 },
  { group: 'Who', key: 'role', label: 'Role', kind: 'role', width: 100 },
  { group: 'Who', key: 'created_at', label: 'Signed up', kind: 'date', width: 150 },
  { group: 'Who', key: 'age_days', label: 'Age', kind: 'age', width: 70 },
  { group: 'Who', key: 'last_active', label: 'Last active', kind: 'date', width: 150, title: 'Last activity, any time' },
  { group: 'Who', key: 'sessions', label: 'Sessions', kind: 'number', width: 85 },
  { group: 'Who', key: 'active_seconds', label: 'Active time', kind: 'duration', width: 95 },
  { group: 'Who', key: 'active_days', label: 'Active days', kind: 'number', width: 95 },
  { group: 'Money', key: 'paid', label: 'Plan', kind: 'plan', width: 70, title: 'Any paid top-up, ever' },
  { group: 'Money', key: 'revenue_inr', label: 'Revenue ₹', kind: 'inr', width: 95 },
  { group: 'Money', key: 'revenue_usd', label: 'Revenue $', kind: 'usd', width: 90 },
  { group: 'Money', key: 'credits_balance', label: 'Credits', kind: 'number', width: 80, title: 'Balance now' },
  { group: 'Money', key: 'credits_bought', label: 'Bought', kind: 'number', width: 80 },
  { group: 'Money', key: 'credits_spent', label: 'Spent', kind: 'number', width: 80, title: 'Usage net of refunds' },
  { group: 'Money', key: 'teaser_state', label: 'Free state', kind: 'teaser', width: 115, title: 'Out of credits: teasers, then paused, then a second chance' },
  { group: 'Matches', key: 'profiles_or_jobs', label: 'Profiles/Jobs', kind: 'number', width: 105, title: 'Open profiles or jobs now' },
  { group: 'Matches', key: 'matches', label: 'Matches', kind: 'number', width: 85 },
  { group: 'Matches', key: 'watched', label: 'Watched', kind: 'number', width: 85 },
  { group: 'Matches', key: 'saved', label: 'Saved', kind: 'number', width: 75 },
  { group: 'Matches', key: 'shared', label: 'Shared', kind: 'number', width: 75 },
  { group: 'Matches', key: 'not_a_match', label: 'Not a match', kind: 'number', width: 100 },
  { group: 'Matches', key: 'last_match_at', label: 'Last match', kind: 'date', width: 150 },
  { group: 'Applying', key: 'applied', label: 'Applied', kind: 'number', width: 85, title: 'Email + site + Ask Resume' },
  { group: 'Applying', key: 'applied_email', label: 'By email', kind: 'number', width: 85 },
  { group: 'Applying', key: 'applied_site', label: 'On site', kind: 'number', width: 80 },
  { group: 'Applying', key: 'ask_resume', label: 'Ask Resume', kind: 'number', width: 100 },
  { group: 'Applying', key: 'asks', label: 'Asks', kind: 'number', width: 70, title: 'Rate, visa or location asked of the poster' },
  { group: 'Results', key: 'replies', label: 'Replies', kind: 'number', width: 80 },
  { group: 'Results', key: 'interviews', label: 'Interviews', kind: 'number', width: 95 },
  { group: 'Results', key: 'placed', label: 'Placed', kind: 'number', width: 75 },
  { group: 'Extras', key: 'ai_match_runs', label: 'AI Match runs', kind: 'number', width: 115 },
  { group: 'Extras', key: 'ai_apply_fills', label: 'AI Apply fills', kind: 'number', width: 110 },
  { group: 'Extras', key: 'referrals_made', label: 'Referrals', kind: 'number', width: 85 },
  { group: 'Extras', key: 'referred_by', label: 'Referred', kind: 'yes', width: 80 },
  { group: 'Extras', key: 'gmail_connected', label: 'Gmail', kind: 'yes', width: 70 },
  { group: 'Extras', key: 'avatar_on', label: 'Avatar', kind: 'yes', width: 70 },
  { group: 'Extras', key: 'picture_reports', label: 'Pic reports', kind: 'number', width: 95 },
  { group: 'Extras', key: 'emails_received', label: 'Emails sent', kind: 'number', width: 100, title: 'Emails we sent this account' },
  { group: 'Extras', key: 'billing_currency', label: 'Currency', kind: 'text', width: 85 },
];

const COLUMN_GROUPS = COLUMNS.reduce<Array<{ group: ColumnGroup; span: number }>>((groups, col) => {
  const last = groups[groups.length - 1];
  if (last?.group === col.group) last.span += 1;
  else groups.push({ group: col.group, span: 1 });
  return groups;
}, []);
const TABLE_WIDTH = COLUMNS.reduce((total, col) => total + col.width, 0);
const RIGHT_ALIGNED = new Set<ColumnKind>(['number', 'inr', 'usd', 'duration', 'age']);

const STATS_PANES = [
  { key: 'charts', label: 'Charts', icon: Activity },
  { key: 'funnel', label: 'Funnel', icon: Filter },
  { key: 'progress', label: 'Progress', icon: Target },
  { key: 'cards', label: 'Summary', icon: LayoutGrid },
  { key: 'table', label: 'Accounts', icon: TableIcon },
  { key: 'events', label: 'Events', icon: Zap },
] as const;

type StatsPane = (typeof STATS_PANES)[number]['key'];

// Green while an account is still showing up, red once it has gone quiet for
// a week. Per-account daily history is not in the payload, so recency is the
// honest signal here — not a growth rate dressed up as one.
function accountPulse(lastActivityAt: string | null): string {
  if (!lastActivityAt) return 'bg-gray-300';
  const age = Date.now() - Date.parse(lastActivityAt);
  if (Number.isNaN(age)) return 'bg-gray-300';
  return age <= 7 * 86_400_000 ? 'bg-green-500' : 'bg-red-500';
}

function formatCompactDateTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatActiveTime(totalSeconds: number) {
  if (totalSeconds < 60) return totalSeconds > 0 ? '<1m' : '0m';
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

const muted = (value: number) => (value > 0 ? 'text-gray-800' : 'text-gray-400');

function AccountCell({ account, col }: { account: AccountRow; col: Column }) {
  const value = sortValue(account, col.key);
  const num = Number(value) || 0;
  switch (col.kind) {
    case 'number':
      return <span className={`text-xs tabular-nums ${muted(num)}`}>{num.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>;
    case 'inr':
      return <span className={`text-xs tabular-nums ${muted(num)}`}>{num > 0 ? formatInr(num) : '-'}</span>;
    case 'usd':
      return <span className={`text-xs tabular-nums ${muted(num)}`}>{num > 0 ? formatUsd(num) : '-'}</span>;
    case 'duration':
      return <span className={`text-xs tabular-nums ${muted(num)}`}>{formatActiveTime(num)}</span>;
    case 'age':
      return <span className="text-xs tabular-nums text-gray-700">{`${Math.max(0, num).toLocaleString()}d`}</span>;
    case 'date':
      return <span className="block truncate whitespace-nowrap text-xs text-gray-600">{typeof value === 'string' ? formatCompactDateTime(value) : '-'}</span>;
    case 'yes':
      return <span className={`text-xs ${value ? 'font-semibold text-emerald-700' : 'text-gray-400'}`}>{value ? 'Yes' : '-'}</span>;
    case 'plan':
      return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${value ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
          {value ? 'Paid' : 'Free'}
        </span>
      );
    case 'teaser':
      return <span className={`text-xs ${account.teaser_state === 'none' ? 'text-gray-400' : 'text-amber-700'}`}>{TEASER_LABEL[account.teaser_state] ?? '-'}</span>;
    case 'role':
      return account.role === 'none' ? (
        <span className="text-xs text-gray-400">-</span>
      ) : (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
          account.role === 'jobs' ? 'bg-blue-50 text-blue-700' : account.role === 'job_seeker' ? 'bg-violet-50 text-violet-700' : 'bg-emerald-50 text-emerald-700'
        }`}
        >
          {ROLE_LABEL[account.role]}
        </span>
      );
    case 'name':
      return (
        <span className="flex items-center gap-1.5">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${accountPulse(account.last_active)}`}
            title={account.last_active ? `Last active ${formatCompactDateTime(account.last_active)}` : 'Never active'}
          />
          <span className="block truncate text-xs text-gray-800">{account.name || '-'}</span>
          {account.internal && <span className="shrink-0 rounded bg-gray-100 px-1 text-[9px] font-semibold uppercase text-gray-500">internal</span>}
        </span>
      );
    default:
      return <span className="block truncate text-xs text-gray-800">{typeof value === 'string' && value ? value : '-'}</span>;
  }
}

export default function AdminDashboard() {
  const [authed, setAuthed] = useState(!!sessionStorage.getItem('admin_authed'));
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<AccountRow[]>([]);
  const [funnel, setFunnel] = useState<Record<string, Record<string, number>>>({});
  const [events, setEvents] = useState<EventRow[]>([]);
  const [statTotals, setStatTotals] = useState<Record<string, Totals>>({});
  // True when admin-stats answered in its pre-RPC shape: it needs deploying.
  const [staleStats, setStaleStats] = useState(false);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [includeInternal, setIncludeInternal] = useState(false);
  // Section and pane live in the URL so a refresh returns to what you were
  // looking at instead of resetting to the default view — and so a particular
  // chart or section can be linked to.
  const [searchParams, setSearchParams] = useSearchParams();
  const [adminView, setAdminView] = useState<AdminView>(() => {
    const requested = searchParams.get('view');
    return ADMIN_NAV.some((item) => item.id === requested) ? (requested as AdminView) : 'stats';
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [scraperConfigTab, setScraperConfigTab] = useState<ScraperConfigTab>('group');
  const [linkedinGroups, setLinkedinGroups] = useState<LinkedinGroupRow[]>([]);
  const [linkedinScraperConfig, setLinkedinScraperConfig] = useState<LinkedinScraperConfig>({
    is_enabled: true,
    max_pages: 1,
    max_posts_per_group: 100,
    posted_limit: '24h',
    sort_by: 'date',
    schedule_interval_hours: 3,
    last_scheduled_at: null,
    updated_at: '',
  });
  const [savingScraperConfig, setSavingScraperConfig] = useState(false);
  const [triggeringScraper, setTriggeringScraper] = useState(false);
  const [linkedinGroupsLoading, setLinkedinGroupsLoading] = useState(false);
  const [linkedinGroupsError, setLinkedinGroupsError] = useState('');
  const [linkedinGroupsNotice, setLinkedinGroupsNotice] = useState('');
  const [linkedinGroupsSearch, setLinkedinGroupsSearch] = useState('');
  const [linkedinStatsRange, setLinkedinStatsRange] = useState<LinkedinStatsRange>('24h');
  const [linkedinStatsStartDate, setLinkedinStatsStartDate] = useState('');
  const [linkedinStatsEndDate, setLinkedinStatsEndDate] = useState('');
  const [newLinkedinGroupId, setNewLinkedinGroupId] = useState('');
  const [newLinkedinGroupName, setNewLinkedinGroupName] = useState('');
  const [savingLinkedinGroupId, setSavingLinkedinGroupId] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('7d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  // Below lg the summary grid and the ~2200px-wide table can't usefully
  // share one viewport — the cards push the table off-screen and the table's
  // horizontal scroll swallows the page. So on small screens only one pane
  // renders at a time; from lg up both show together as before and this is
  // ignored.
  const [statsPane, setStatsPane] = useState<StatsPane>(() => {
    const requested = searchParams.get('pane');
    return STATS_PANES.some((pane) => pane.key === requested) ? (requested as StatsPane) : 'charts';
  });
  const [sortKey, setSortKey] = useState<AdminStatsSortKey>('created_at');
  const [sortDirection, setSortDirection] = useState<AdminStatsSortDirection>('desc');
  const dateDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(e.target as Node)) {
        setShowDateDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function fetchStats(pw?: string) {
    setLoading(true);
    const authPw = pw || sessionStorage.getItem('admin_authed') || password;
    const { start_date, end_date } = getDateRange(datePreset, customStart, customEnd);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-stats`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: authPw, start_date, end_date, include_internal: includeInternal }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error || 'Request failed');
        setLoading(false);
        return false;
      }
      const data = await res.json();
      const current = isCurrentPayload(data);
      setStaleStats(!current);
      setStats(current ? data.accounts : []);
      setDaily(current ? data.daily ?? [] : []);
      setFunnel(current ? data.funnel ?? {} : {});
      setEvents(current ? data.events ?? [] : []);
      setStatTotals(current ? data.totals ?? {} : {});
      setLoading(false);
      return true;
    } catch {
      setError('Network error');
      setLoading(false);
      return false;
    }
  }

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const success = await fetchStats(password);
    if (success) {
      sessionStorage.setItem('admin_authed', password);
      setAuthed(true);
    }
  }

  async function refresh() {
    await Promise.all([fetchStats(), fetchLinkedinGroups()]);
  }

  async function fetchLinkedinGroups(
    range: LinkedinStatsRange = linkedinStatsRange,
    startDate = linkedinStatsStartDate,
    endDate = linkedinStatsEndDate,
  ) {
    setLinkedinGroupsLoading(true);
    setLinkedinGroupsError('');
    let statsStart: string | null = null;
    let statsEnd: string | null = null;
    if (range === 'custom') {
      const exclusiveEnd = endDate ? new Date(`${endDate}T00:00:00.000Z`) : null;
      if (exclusiveEnd) exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
      statsStart = startDate ? `${startDate}T00:00:00.000Z` : null;
      statsEnd = exclusiveEnd?.toISOString() ?? null;
    } else if (range !== 'all') {
      const hours = range === '24h' ? 24 : range === '7d' ? 24 * 7 : 24 * 30;
      statsEnd = new Date().toISOString();
      statsStart = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    }
    const { data, error } = await supabase.functions.invoke('admin-linkedin-groups', {
      body: {
        action: 'list',
        password: sessionStorage.getItem('admin_authed') || password,
        stats_start: statsStart,
        stats_end: statsEnd,
      },
    });

    if (error) {
      setLinkedinGroupsError(error.message);
      setLinkedinGroupsLoading(false);
      return;
    }

    setLinkedinGroups((data?.groups ?? []) as LinkedinGroupRow[]);
    if (data?.config) setLinkedinScraperConfig(data.config as LinkedinScraperConfig);
    setLinkedinGroupsLoading(false);
  }

  async function saveLinkedinScraperConfig() {
    setSavingScraperConfig(true);
    setLinkedinGroupsError('');
    setLinkedinGroupsNotice('');
    const { data, error } = await supabase.functions.invoke('admin-linkedin-groups', {
      body: {
        action: 'update_config',
        password: sessionStorage.getItem('admin_authed') || password,
        ...linkedinScraperConfig,
      },
    });
    if (error) {
      setLinkedinGroupsError(error.message);
    } else {
      setLinkedinScraperConfig(data.config as LinkedinScraperConfig);
      setLinkedinGroupsNotice('Scraper settings saved.');
    }
    setSavingScraperConfig(false);
  }

  async function setLinkedinSchedulerEnabled(isEnabled: boolean) {
    setSavingScraperConfig(true);
    setLinkedinGroupsError('');
    setLinkedinGroupsNotice('');
    const { data, error } = await supabase.functions.invoke('admin-linkedin-groups', {
      body: {
        action: 'set_scheduler_enabled',
        password: sessionStorage.getItem('admin_authed') || password,
        is_enabled: isEnabled,
      },
    });
    if (error) {
      setLinkedinGroupsError(error.message);
    } else {
      setLinkedinScraperConfig(data.config as LinkedinScraperConfig);
      setLinkedinGroupsNotice(isEnabled ? 'Scheduler resumed.' : 'Scheduler paused.');
    }
    setSavingScraperConfig(false);
  }

  async function triggerLinkedinScraper() {
    setTriggeringScraper(true);
    setLinkedinGroupsError('');
    setLinkedinGroupsNotice('');
    const passwordValue = sessionStorage.getItem('admin_authed') || password;
    const { data: savedData, error: saveError } = await supabase.functions.invoke('admin-linkedin-groups', {
      body: { action: 'update_config', password: passwordValue, ...linkedinScraperConfig },
    });
    if (saveError) {
      setLinkedinGroupsError(saveError.message);
      setTriggeringScraper(false);
      return;
    }
    setLinkedinScraperConfig(savedData.config as LinkedinScraperConfig);

    const { data, error } = await supabase.functions.invoke('admin-linkedin-groups', {
      body: { action: 'trigger_scrape', password: passwordValue },
    });
    if (error) {
      setLinkedinGroupsError(error.message);
    } else {
      setLinkedinGroupsNotice(`${Number(data?.groupsQueued ?? 0)} active groups queued for scraping.`);
    }
    setTriggeringScraper(false);
  }

  async function addLinkedinGroup() {
    const groupId = newLinkedinGroupId.trim().match(/linkedin\.com\/groups\/(\d+)/i)?.[1]
      ?? newLinkedinGroupId.trim();
    if (!/^\d+$/.test(groupId)) {
      setLinkedinGroupsError('Enter a numeric LinkedIn group ID or group URL.');
      return;
    }

    setSavingLinkedinGroupId(groupId);
    setLinkedinGroupsError('');
    setLinkedinGroupsNotice('');
    const { error } = await supabase.functions.invoke('admin-linkedin-groups', {
      body: {
        action: 'create',
        password: sessionStorage.getItem('admin_authed') || password,
        group_id: groupId,
        group_name: newLinkedinGroupName.trim() || null,
      },
    });

    if (error) {
      setLinkedinGroupsError(error.message);
    } else {
      setNewLinkedinGroupId('');
      setNewLinkedinGroupName('');
      setLinkedinGroupsNotice(`Group ${groupId} added.`);
      await fetchLinkedinGroups();
    }
    setSavingLinkedinGroupId(null);
  }

  async function toggleLinkedinGroup(group: LinkedinGroupRow) {
    setSavingLinkedinGroupId(group.group_id);
    setLinkedinGroupsError('');
    setLinkedinGroupsNotice('');
    const { error } = await supabase.functions.invoke('admin-linkedin-groups', {
      body: {
        action: 'set_active',
        password: sessionStorage.getItem('admin_authed') || password,
        group_id: group.group_id,
        is_active: !group.is_active,
      },
    });

    if (error) {
      setLinkedinGroupsError(error.message);
    } else {
      setLinkedinGroups((current) => current.map((row) => (
        row.group_id === group.group_id ? { ...row, is_active: !row.is_active } : row
      )));
    }
    setSavingLinkedinGroupId(null);
  }

  async function deleteLinkedinGroup(group: LinkedinGroupRow) {
    if (!window.confirm(`Delete LinkedIn group ${group.group_id}?`)) return;
    setSavingLinkedinGroupId(group.group_id);
    setLinkedinGroupsError('');
    const { error } = await supabase.functions.invoke('admin-linkedin-groups', {
      body: {
        action: 'delete',
        password: sessionStorage.getItem('admin_authed') || password,
        group_id: group.group_id,
      },
    });

    if (error) {
      setLinkedinGroupsError(error.message);
    } else {
      setLinkedinGroups((current) => current.filter((row) => row.group_id !== group.group_id));
      setLinkedinGroupsNotice(`Group ${group.group_id} deleted.`);
    }
    setSavingLinkedinGroupId(null);
  }

  // Re-fetch when the date range or the internal-accounts switch changes (if
  // already authed).
  useEffect(() => {
    if (authed && (datePreset !== 'custom' || customStart || customEnd)) {
      fetchStats();
    }
  }, [datePreset, includeInternal]);

  useEffect(() => {
    if (authed) {
      void fetchLinkedinGroups();
    }
  }, [authed]);

  function applyCustomRange() {
    if (customStart || customEnd) {
      setShowDateDropdown(false);
      fetchStats();
    }
  }

  const filteredStats = useMemo(() => {
    return filterAndSortAccountStats(stats, {
      query: searchQuery,
      role: roleFilter,
      sortKey,
      sortDirection,
    });
  }, [stats, searchQuery, roleFilter, sortKey, sortDirection]);

  const filteredLinkedinGroups = useMemo(() => {
    const query = linkedinGroupsSearch.trim().toLowerCase();
    if (!query) return linkedinGroups;
    return linkedinGroups.filter((group) => (
      group.group_id.includes(query) || (group.group_name ?? '').toLowerCase().includes(query)
    ));
  }, [linkedinGroups, linkedinGroupsSearch]);

  useEffect(() => {
    // Functional form: it reads the current params without this effect
    // depending on them, which would otherwise loop on its own write, and it
    // leaves any other parameter on the URL alone.
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set('view', adminView);
      // The pane only means anything inside Account Stats; carrying it into
      // the other sections would put a stale parameter in every shared link.
      if (adminView === 'stats') next.set('pane', statsPane);
      else next.delete('pane');
      return next;
      // replace, not push: flipping between panes should not fill the back
      // button with admin states to click through.
    }, { replace: true });
  }, [adminView, statsPane, setSearchParams]);

  const currentPresetLabel = DATE_PRESETS.find(p => p.key === datePreset)?.label ?? 'Last 7 days';
  // The same window the stats fetch uses, so the chart cannot disagree with
  // the numbers beside it.
  const signupRange = getDateRange(datePreset, customStart, customEnd);

  // Direction of travel per card, from the same daily buckets the charts use.
  // Cards measuring a level rather than a flow (watched %, avatars on) are
  // left out: "up" means nothing for those.
  const cardTrends = useMemo(() => {
    const backing: Record<string, string | string[]> = {
      Accounts: 'signups',
      Active: 'active_users',
      'Matches sent': 'matches',
      Applied: ['applied_email', 'applied_site', 'ask_resume'],
      Replies: 'replies',
      Interviews: 'interviews',
      Placed: 'placed',
      'Paid accounts': 'paid_orders',
      'Revenue ₹': 'revenue_inr',
      'Revenue $': 'revenue_usd',
      'Credits spent': 'credits_spent',
      'AI Apply fills': 'ai_apply_fills',
      Referrals: 'referrals',
    };
    const out: Record<string, Trend> = {};
    for (const [label, metric] of Object.entries(backing)) {
      const series = buildMetricSeries(daily, metric, roleFilter, signupRange.start_date, signupRange.end_date);
      if (series.length) out[label] = trendOf(series);
    }
    return out;
  }, [daily, roleFilter, signupRange.start_date, signupRange.end_date]);

  // Breakages the data cannot report on, because they are why it is missing.
  const blockers = useMemo<BriefLine[]>(() => {
    const lines: BriefLine[] = [];
    if (staleStats) {
      lines.push({ key: 'stale-stats', text: 'admin-stats is out of date: apply the admin_account_stats migration and deploy admin-stats.', tone: 'bad' });
    } else if (!daily.length) {
      lines.push({ key: 'no-daily', text: 'No daily data in this range.', tone: 'neutral' });
    }
    return lines;
  }, [daily.length, staleStats]);

  // Summary cards: the selected role's totals, counted in SQL.
  const t = totalsFor(statTotals, roleFilter);
  const n = (key: keyof Totals) => Number(t[key] ?? 0);
  const share = (count: number, of: number) => (of > 0 ? `${Math.round((count / of) * 100)}%` : '-');
  const appliedTotal = n('applied_email') + n('applied_site') + n('ask_resume');
  const roleSplit = roleFilter === 'all'
    ? (['profiles', 'jobs', 'job_seeker'] as const)
      .map((r) => `${Number(statTotals[r]?.accounts ?? 0).toLocaleString()} ${ROLE_LABEL[r]}`).join(' · ')
    : ROLE_LABEL[roleFilter];
  const summaryCards: Array<{ label: string; value: string; hint: string }> = [
    { label: 'Accounts', value: n('accounts').toLocaleString(), hint: `+${n('signups').toLocaleString()} new · ${roleSplit}` },
    { label: 'Active', value: n('active').toLocaleString(), hint: `${share(n('active'), n('accounts'))} of accounts · ${n('sessions').toLocaleString()} sessions` },
    { label: 'Matches sent', value: n('matches').toLocaleString(), hint: `${n('ai_match_runs').toLocaleString()} AI Match runs` },
    { label: 'Watched', value: share(n('matches_watched'), n('matches')), hint: `${n('matches_watched').toLocaleString()} of the matches sent were opened` },
    { label: 'Applied', value: appliedTotal.toLocaleString(), hint: `${n('applied_email').toLocaleString()} email · ${n('applied_site').toLocaleString()} site · ${n('ask_resume').toLocaleString()} Ask Resume` },
    { label: 'Replies', value: n('replies').toLocaleString(), hint: `${n('asks').toLocaleString()} questions asked of posters` },
    { label: 'Interviews', value: n('interviews').toLocaleString(), hint: 'cards moved to interview' },
    { label: 'Placed', value: n('placed').toLocaleString(), hint: 'cards moved to placed' },
    { label: 'Paid accounts', value: n('paid_accounts').toLocaleString(), hint: `${n('paid_orders').toLocaleString()} paid orders in range` },
    { label: 'Revenue ₹', value: formatInr(n('revenue_inr')), hint: 'paid top-ups in INR' },
    { label: 'Revenue $', value: formatUsd(n('revenue_usd')), hint: 'paid top-ups in USD' },
    { label: 'Credits spent', value: Math.round(n('credits_spent')).toLocaleString(), hint: `${n('credits_bought').toLocaleString()} bought in range` },
    { label: 'AI Apply fills', value: n('ai_apply_fills').toLocaleString(), hint: 'Chrome extension form fills' },
    { label: 'Referrals', value: n('referrals').toLocaleString(), hint: `${n('referred').toLocaleString()} accounts came by referral` },
    { label: 'Avatars on', value: n('avatars_on').toLocaleString(), hint: `${share(n('avatars_on'), n('accounts'))} of accounts` },
    { label: 'Picture reports', value: n('picture_reports').toLocaleString(), hint: `${(events.find((e) => e.event === 'picture_reported')?.count ?? 0).toLocaleString()} report taps (events)` },
  ];

  if (!authed) {
    return (
      <div className="min-h-screen bg-white text-gray-900 flex items-center justify-center p-6">
        <form
          onSubmit={login}
          className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm"
        >
          <div className="flex flex-col items-center gap-4 mb-8">
            <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center">
              <Lock size={20} className="text-gray-700" />
            </div>
            <div className="text-center">
              <h1 className="text-xl font-semibold text-gray-900">Admin Dashboard</h1>
              <p className="text-sm text-gray-500 mt-1">ProfilePush.ai</p>
            </div>
          </div>

          <div className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter admin password"
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 placeholder:text-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              autoFocus
            />
            {error && (
              <p className="text-sm text-red-600 text-center">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full rounded-lg bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <LogoSpinner size={16} /> : <Lock size={14} />}
              {loading ? 'Verifying...' : 'Unlock'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // The subtitle used to be a nine-deep nested ternary inline in the header.
  // Stats is the only view whose subtitle depends on live data, so it is the
  // only one that needs to be computed.
  const viewSubtitle = adminView === 'stats'
    ? `${filteredStats.length} of ${stats.length} accounts${includeInternal ? ' · internal included' : ''}`
    : adminView === 'scraper'
      ? (scraperConfigTab === 'group'
        ? `${linkedinGroups.filter((group) => group.is_active).length} active of ${linkedinGroups.length} LinkedIn groups`
        : 'LinkedIn keyword search configuration')
      : adminView === 'scraper-logs' ? 'Hourly group and keyword pipeline logs'
      : adminView === 'lists' ? 'Vendor and bench sales contacts for GMass'
      : adminView === 'emails' ? 'Every email we send, how it performs, and new emails to users'
      : adminView === 'feedback' ? 'Ratings and comments from users after they send an AI Submit'
      : adminView === 'channels' ? 'Team channels'
      : adminView === 'market' ? 'Market Pulse leaderboard'
      : adminView === 'trends' ? 'Platform-wide daily trends'
      : adminView === 'post-outreach' ? 'Scraped posts — AI comment outreach'
      : adminView === 'social' ? 'Publish one post to every connected network'
      : adminView === 'notifications' ? 'Requests and notifications from users'
      : adminView === 'websites' ? 'Website Modernization: demos, live sites and demo requests'
      : 'AI prompt configuration';
  const currentNavLabel = ADMIN_NAV.find((item) => item.id === adminView)?.label ?? 'Admin';

  return (
    <div className="flex h-screen overflow-hidden bg-white text-gray-900 font-sans">
      {/* Backdrop, phone and tablet only: the sidebar is off-canvas below lg. */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-56 shrink-0 flex-col border-r border-gray-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-2.5 border-b border-gray-200 px-4 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100">
            <TrendingUp size={15} className="text-gray-700" />
          </div>
          <h1 className="truncate text-sm font-semibold text-gray-900">ProfilePush Admin</h1>
        </div>

        <nav className="flex-1 overflow-y-auto p-2" aria-label="Admin sections">
          {ADMIN_NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => { setAdminView(id); setSidebarOpen(false); }}
              aria-current={adminView === id ? 'page' : undefined}
              className={`mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-xs font-semibold transition ${
                adminView === id
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <Icon size={15} className="shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </nav>

        <div className="border-t border-gray-200 p-2">
          <button
            onClick={refresh}
            disabled={loading || linkedinGroupsLoading}
            className="mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
          >
            <RefreshCcw size={14} className={`shrink-0 ${loading || linkedinGroupsLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => {
              sessionStorage.removeItem('admin_authed'); setAuthed(false);
              setStats([]); setDaily([]); setFunnel({}); setEvents([]); setStatTotals({});
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium text-gray-500 transition hover:bg-red-50 hover:text-red-600"
          >
            <Lock size={14} className="shrink-0" />
            Logout
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-200 bg-white/95 px-4 py-2 backdrop-blur-sm sm:gap-3 sm:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 lg:hidden"
            aria-label="Open admin menu"
          >
            <Menu size={16} />
          </button>
          <div className="min-w-0 shrink-0">
            <h2 className="truncate text-sm font-semibold text-gray-900">{currentNavLabel}</h2>
            <p className="truncate text-[10px] text-gray-500">{viewSubtitle}</p>
          </div>

          {adminView === 'stats' && (
            <>
              {/* Pane tabs scroll sideways rather than wrapping, so the row
                  height never changes as the window narrows and the search
                  field keeps its place. */}
              <div className="flex min-w-0 shrink items-center gap-1 overflow-x-auto">
              <div className="flex shrink-0 items-center gap-1">
                {STATS_PANES.map((pane) => (
                  <button
                    key={pane.key}
                    type="button"
                    onClick={() => setStatsPane(pane.key)}
                    aria-pressed={statsPane === pane.key}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      statsPane === pane.key
                        ? 'border border-blue-600 bg-blue-600 text-white'
                        : 'border border-gray-300 bg-white text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <pane.icon size={12} />
                    {pane.label}
                  </button>
                ))}
              </div>
              </div>
              <div className="ml-auto flex min-w-0 flex-1 items-center gap-2 sm:max-w-[500px]">
          <div className="relative min-w-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by name, email or role"
                className="h-10 w-full rounded-md border border-gray-300 bg-white pl-9 pr-8 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                >
                  <X size={14} />
                </button>
              )}
          </div>

            <div className="relative" ref={dateDropdownRef}>
              <button
                onClick={() => setShowDateDropdown(!showDateDropdown)}
                className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 lg:w-[180px]"
              >
                <Calendar size={14} className="text-gray-500" />
                <span>{currentPresetLabel}</span>
                {datePreset === 'custom' && (customStart || customEnd) && (
                  <span className="ml-1 text-[10px] text-blue-600">
                    {customStart && new Date(customStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {customStart && customEnd && ' - '}
                    {customEnd && new Date(customEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
                <ChevronDown size={12} className="text-gray-500" />
              </button>

              {showDateDropdown && (
                <div className="absolute top-full right-0 z-20 mt-2 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                  <div className="p-2">
                    {DATE_PRESETS.map(p => (
                      <button
                        key={p.key}
                        onClick={() => {
                          setDatePreset(p.key);
                          if (p.key !== 'custom') setShowDateDropdown(false);
                        }}
                        className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                          datePreset === p.key
                            ? 'bg-blue-50 font-medium text-blue-700'
                            : 'text-gray-700 hover:bg-gray-100'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {datePreset === 'custom' && (
                    <div className="space-y-3 border-t border-gray-200 p-3">
                      <div>
                        <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-gray-500">Start Date</label>
                        <input
                          type="date"
                          value={customStart}
                          onChange={e => setCustomStart(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-[11px] uppercase tracking-wider text-gray-500">End Date</label>
                        <input
                          type="date"
                          value={customEnd}
                          onChange={e => setCustomEnd(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500"
                        />
                      </div>
                      <button
                        onClick={applyCustomRange}
                        disabled={!customStart && !customEnd}
                        className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                      >
                        Apply Range
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

              </div>
            </>
          )}
        </div>


      {/* Stats Table */}
      <div className="mx-auto flex-1 min-h-0 min-w-0 w-full max-w-[1600px] overflow-x-hidden px-4 pb-4 sm:px-6 sm:pb-6">
        {adminView === 'stats' && (
          loading && stats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <LogoSpinner size={24} />
              <p className="text-sm text-gray-500">Loading account data...</p>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-3 pt-3">
              {/* One role switch for every pane it applies to, and the
                  internal-accounts switch, which refetches. */}
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {statsPane !== 'events' && statsPane !== 'progress' && (
                  <div className="inline-flex rounded-full border border-gray-300 bg-white p-0.5">
                    {ROLE_FILTERS.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setRoleFilter(option.key)}
                        aria-pressed={roleFilter === option.key}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                          roleFilter === option.key ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                )}
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={includeInternal}
                    onChange={(e) => setIncludeInternal(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                  />
                  Include internal
                </label>
                {staleStats && (
                  <span className="text-xs font-semibold text-red-600">
                    admin-stats is out of date: apply the admin_account_stats migration and deploy admin-stats.
                  </span>
                )}
              </div>

              <div className={`shrink-0 grid-cols-2 gap-px overflow-hidden rounded-lg border border-gray-200 bg-gray-200 sm:grid-cols-4 lg:grid-cols-8 ${statsPane === 'cards' ? 'grid' : 'hidden'}`}>
                {summaryCards.map((metric) => (
                  <div key={metric.label} className="min-w-0 bg-white px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {cardTrends[metric.label] && (
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            cardTrends[metric.label].direction === 'up' ? 'bg-green-500'
                              : cardTrends[metric.label].direction === 'down' ? 'bg-red-500' : 'bg-gray-300'
                          }`}
                          title={`${formatChange(cardTrends[metric.label].change)} — recent half of the range vs the half before`}
                        />
                      )}
                      <p className="truncate text-[10px] font-semibold uppercase text-gray-500">{metric.label}</p>
                    </div>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{metric.value}</p>
                    <p className="mt-0.5 truncate text-[10px] text-gray-400" title={metric.hint}>{metric.hint}</p>
                  </div>
                ))}
              </div>
              <div className={`min-h-0 flex-1 overflow-y-auto ${statsPane === 'charts' ? 'block' : 'hidden'}`}>
                <AdminTrendCharts
                  daily={daily}
                  role={roleFilter}
                  startDate={signupRange.start_date}
                  endDate={signupRange.end_date}
                  rangeLabel={currentPresetLabel}
                  blockers={blockers}
                />
              </div>
              <div className={`min-h-0 flex-1 overflow-y-auto ${statsPane === 'progress' ? 'block' : 'hidden'}`}>
                <AdminProgress
                  accounts={stats}
                  daily={daily}
                  funnel={funnel.all}
                  totals={totalsFor(statTotals, 'all')}
                  startDate={signupRange.start_date}
                  endDate={signupRange.end_date}
                  rangeLabel={currentPresetLabel}
                />
              </div>
              <div className={`min-h-0 flex-1 overflow-y-auto ${statsPane === 'funnel' ? 'block' : 'hidden'}`}>
                <AdminFunnels
                  funnel={funnel}
                  role={roleFilter}
                  startDate={signupRange.start_date}
                  endDate={signupRange.end_date}
                  rangeLabel={currentPresetLabel}
                />
              </div>
              <div className={`min-h-0 flex-1 overflow-y-auto ${statsPane === 'events' ? 'block' : 'hidden'}`}>
                <AdminEventsTable events={events} rangeLabel={currentPresetLabel} />
              </div>
              <div className={`min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white ${statsPane === 'table' ? 'flex' : 'hidden'} ${statsPane === 'cards' ? 'lg:flex' : ''}`}>
              <div className="min-h-0 flex-1 overflow-auto">
              <table className="table-fixed text-left" style={{ width: TABLE_WIDTH, minWidth: '100%' }}>
                <colgroup>
                  {COLUMNS.map((col) => <col key={col.key} style={{ width: col.width }} />)}
                </colgroup>
                <thead className="sticky top-0 z-[4]">
                  <tr className="border-b border-gray-200 bg-gray-100">
                    {COLUMN_GROUPS.map((g, i) => (
                      <th
                        key={g.group}
                        colSpan={g.span}
                        className={`px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 ${i > 0 ? 'border-l border-gray-200' : ''}`}
                      >
                        {g.group}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    {COLUMNS.map((col, i) => (
                      <th
                        key={col.key}
                        title={col.title}
                        className={`px-4 py-2.5 text-[10px] font-semibold uppercase text-gray-600 whitespace-nowrap ${RIGHT_ALIGNED.has(col.kind) ? 'text-right' : 'text-left'} ${i === 0 ? 'sticky left-0 z-[5] bg-gray-50' : ''}`}
                      >
                        <button
                          title={col.title ?? `Sort by ${col.label}`}
                          className={`flex w-full items-center gap-1.5 transition-colors hover:text-blue-600 ${RIGHT_ALIGNED.has(col.kind) ? 'justify-end text-right' : 'justify-start text-left'}`}
                          onClick={() => {
                            if (sortKey === col.key) {
                              setSortDirection((current) => (current === 'desc' ? 'asc' : 'desc'));
                            } else {
                              setSortKey(col.key);
                              setSortDirection('desc');
                            }
                          }}
                        >
                          {col.label}
                          {sortKey === col.key && (
                            <span className="text-[10px] text-blue-600">{sortDirection === 'desc' ? '↓' : '↑'}</span>
                          )}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredStats.length === 0 && (
                    <tr>
                      <td colSpan={COLUMNS.length} className="px-5 py-12 text-center text-gray-500 text-sm">
                        {searchQuery ? 'No accounts match your search.' : 'No data available.'}
                      </td>
                    </tr>
                  )}

                  {filteredStats.map((account) => (
                    <tr
                      key={account.account_id}
                      className="group border-b border-gray-200 bg-white transition-colors hover:bg-gray-50"
                    >
                      {COLUMNS.map((col, i) => (
                        <td
                          key={col.key}
                          className={`px-4 py-2 ${RIGHT_ALIGNED.has(col.kind) ? 'text-right' : 'text-left'} ${i === 0 ? 'sticky left-0 z-[3] bg-white group-hover:bg-gray-50' : ''}`}
                        >
                          <AccountCell account={account} col={col} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              </div>
            </div>
          )
        )}


        {adminView === 'scraper' && (
        <>
        <div className="mt-4 flex items-center gap-1 border-b border-gray-200">
          <button
            onClick={() => setScraperConfigTab('group')}
            className={`h-8 shrink-0 border-b-2 px-2.5 text-xs font-semibold transition ${scraperConfigTab === 'group' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
          >
            Group Scraper
          </button>
          <button
            onClick={() => setScraperConfigTab('keyword')}
            className={`h-8 shrink-0 border-b-2 px-2.5 text-xs font-semibold transition ${scraperConfigTab === 'keyword' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
          >
            Keyword Scraper
          </button>
        </div>
        {scraperConfigTab === 'group' && (
        <div className="mt-4 grid h-full min-h-0 w-full min-w-0 max-w-full gap-4 overflow-y-auto lg:grid-cols-[320px_minmax(0,1fr)] lg:overflow-hidden">
          <aside className="rounded-lg border border-gray-200 bg-white lg:overflow-y-auto">
            <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
              <SlidersHorizontal size={15} className="text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-900">Scraping Settings</h2>
            </div>
            <div className="space-y-4 p-4">
              <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
                <div>
                  <p className="text-xs font-semibold text-gray-700">Scheduler</p>
                  <p className={`mt-0.5 text-[11px] font-medium ${linkedinScraperConfig.is_enabled ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {linkedinScraperConfig.is_enabled ? 'Active' : 'Paused'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void setLinkedinSchedulerEnabled(!linkedinScraperConfig.is_enabled)}
                  disabled={savingScraperConfig || triggeringScraper}
                  className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${linkedinScraperConfig.is_enabled ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100' : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                >
                  {linkedinScraperConfig.is_enabled ? <Pause size={13} /> : <Play size={13} />}
                  {linkedinScraperConfig.is_enabled ? 'Pause Scheduler' : 'Resume Scheduler'}
                </button>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-700">Maximum pages per group</span>
                <input type="number" min={1} max={20} value={linkedinScraperConfig.max_pages} onChange={(event) => setLinkedinScraperConfig((current) => ({ ...current, max_pages: Number(event.target.value) }))} className="h-9 w-full rounded-md border border-gray-300 px-2.5 text-xs outline-none focus:border-blue-500" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-700">Maximum posts per group</span>
                <input type="number" min={1} max={1000} value={linkedinScraperConfig.max_posts_per_group} onChange={(event) => setLinkedinScraperConfig((current) => ({ ...current, max_posts_per_group: Number(event.target.value) }))} className="h-9 w-full rounded-md border border-gray-300 px-2.5 text-xs outline-none focus:border-blue-500" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-700">Posted time window</span>
                <select value={linkedinScraperConfig.posted_limit} onChange={(event) => setLinkedinScraperConfig((current) => ({ ...current, posted_limit: event.target.value as LinkedinScraperConfig['posted_limit'] }))} className="h-9 w-full rounded-md border border-gray-300 bg-white px-2.5 text-xs outline-none focus:border-blue-500">
                  <option value="24h">Last 24 hours</option>
                  <option value="week">Last week</option>
                  <option value="month">Last month</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-700">Sort results by</span>
                <select value={linkedinScraperConfig.sort_by} onChange={(event) => setLinkedinScraperConfig((current) => ({ ...current, sort_by: event.target.value as LinkedinScraperConfig['sort_by'] }))} className="h-9 w-full rounded-md border border-gray-300 bg-white px-2.5 text-xs outline-none focus:border-blue-500">
                  <option value="date">Newest first</option>
                  <option value="relevance">Relevance</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-gray-700">Run every</span>
                <select value={linkedinScraperConfig.schedule_interval_hours} onChange={(event) => setLinkedinScraperConfig((current) => ({ ...current, schedule_interval_hours: Number(event.target.value) }))} className="h-9 w-full rounded-md border border-gray-300 bg-white px-2.5 text-xs outline-none focus:border-blue-500">
                  {[1, 2, 3, 4, 6, 8, 12, 24].map((hours) => <option key={hours} value={hours}>{hours} {hours === 1 ? 'hour' : 'hours'}</option>)}
                </select>
              </label>
              <div className="border-t border-gray-200 pt-3 text-[11px] leading-5 text-gray-500">
                <p>Last scheduled: {formatCompactDateTime(linkedinScraperConfig.last_scheduled_at)}</p>
                <p>Updated: {formatCompactDateTime(linkedinScraperConfig.updated_at || null)}</p>
              </div>
              <button onClick={() => void saveLinkedinScraperConfig()} disabled={savingScraperConfig} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {savingScraperConfig ? <RefreshCcw size={13} className="animate-spin" /> : <Save size={13} />} Save Settings
              </button>
              <button onClick={() => void triggerLinkedinScraper()} disabled={triggeringScraper || savingScraperConfig} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                {triggeringScraper ? <RefreshCcw size={13} className="animate-spin" /> : <Play size={13} />} Run Now
              </button>
            </div>
          </aside>

          <div className="flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white lg:min-h-0">
            <div className="border-b border-gray-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">LinkedIn Groups</h2>
            </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-3 py-3 sm:px-4">
            <div className="flex w-full flex-wrap items-end gap-2 xl:w-auto">
              <div className="relative w-full sm:w-64">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={linkedinGroupsSearch}
                  onChange={(event) => setLinkedinGroupsSearch(event.target.value)}
                  placeholder="Search group ID or name..."
                  className="h-9 w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 text-xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <select
                aria-label="Performance date range"
                value={linkedinStatsRange}
                onChange={(event) => {
                  const range = event.target.value as LinkedinStatsRange;
                  setLinkedinStatsRange(range);
                  if (range !== 'custom') void fetchLinkedinGroups(range);
                }}
                className="h-9 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700 outline-none focus:border-blue-500"
              >
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="all">All time</option>
                <option value="custom">Custom range</option>
              </select>
              {linkedinStatsRange === 'custom' && (
                <>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase text-gray-500">From</span>
                    <input type="date" value={linkedinStatsStartDate} max={linkedinStatsEndDate || undefined} onChange={(event) => setLinkedinStatsStartDate(event.target.value)} className="h-9 rounded-md border border-gray-300 bg-white px-2 text-xs outline-none focus:border-blue-500" />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase text-gray-500">To</span>
                    <input type="date" value={linkedinStatsEndDate} min={linkedinStatsStartDate || undefined} onChange={(event) => setLinkedinStatsEndDate(event.target.value)} className="h-9 rounded-md border border-gray-300 bg-white px-2 text-xs outline-none focus:border-blue-500" />
                  </label>
                  <button onClick={() => void fetchLinkedinGroups('custom')} disabled={linkedinGroupsLoading} className="h-9 rounded-md border border-blue-300 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50">Apply</button>
                </>
              )}
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-2 lg:w-auto">
              <input
                value={newLinkedinGroupId}
                onChange={(event) => setNewLinkedinGroupId(event.target.value)}
                placeholder="Group ID or URL"
                className="h-9 w-44 rounded-md border border-gray-300 px-2.5 text-xs outline-none focus:border-blue-500"
              />
              <input
                value={newLinkedinGroupName}
                onChange={(event) => setNewLinkedinGroupName(event.target.value)}
                placeholder="Name (optional)"
                className="h-9 w-44 rounded-md border border-gray-300 px-2.5 text-xs outline-none focus:border-blue-500"
              />
              <button
                onClick={() => void addLinkedinGroup()}
                disabled={!newLinkedinGroupId.trim() || savingLinkedinGroupId !== null}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                <Plus size={12} /> Add Group
              </button>
              <button
                onClick={() => void fetchLinkedinGroups()}
                disabled={linkedinGroupsLoading}
                title="Reload groups"
                className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCcw size={13} className={linkedinGroupsLoading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {linkedinGroupsError && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{linkedinGroupsError}</div>}
          {linkedinGroupsNotice && <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">{linkedinGroupsNotice}</div>}

          {linkedinGroupsLoading && linkedinGroups.length === 0 ? (
            <div className="flex flex-1 items-center justify-center"><LogoSpinner size={18} /></div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[980px] table-fixed text-left">
                <thead className="sticky top-0 z-[2] bg-gray-50">
                  <tr className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-600">
                    <th className="w-[160px] px-4 py-3">Group ID</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="w-[110px] px-4 py-3">Status</th>
                    <th className="w-[100px] px-4 py-3 text-right" title="All raw posts saved from HarvestAPI, including repeat sightings across scrape runs">Scraped</th>
                    <th className="w-[110px] px-4 py-3 text-right" title="LinkedIn posts accepted into social_jobs after job filtering and deduplication">Social Jobs</th>
                    <th className="w-[105px] px-4 py-3 text-right" title="Social jobs with a persisted radar_match_results row">Radar</th>
                    <th className="w-[180px] px-4 py-3">Last Scraped</th>
                    <th className="w-[130px] px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLinkedinGroups.map((group) => (
                    <tr key={group.group_id} className="border-b border-gray-200 text-xs text-gray-800 hover:bg-gray-50">
                      <td className="px-4 py-3 font-semibold text-gray-900">{group.group_id}</td>
                      <td className="truncate px-4 py-3 text-gray-600">{group.group_name || '-'}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => void toggleLinkedinGroup(group)}
                          disabled={savingLinkedinGroupId === group.group_id}
                          className={`rounded px-2 py-1 text-[11px] font-semibold ${group.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
                        >
                          {group.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-gray-900">{group.scraped_posts_count.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-blue-700">{group.social_jobs_count.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-700">{group.radar_results_count.toLocaleString()}</td>
                      <td className="px-4 py-3 text-gray-500">{formatCompactDateTime(group.last_scraped_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <a
                            href={`https://www.linkedin.com/groups/${group.group_id}/`}
                            target="_blank"
                            rel="noreferrer"
                            title="Open LinkedIn group"
                            className="rounded-md border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50"
                          >
                            <ExternalLink size={13} />
                          </a>
                          <button
                            onClick={() => void deleteLinkedinGroup(group)}
                            disabled={savingLinkedinGroupId === group.group_id}
                            title="Delete group"
                            className="rounded-md border border-red-300 bg-red-50 p-2 text-red-700 hover:bg-red-100 disabled:opacity-50"
                          >
                            {savingLinkedinGroupId === group.group_id ? <RefreshCcw size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredLinkedinGroups.length === 0 && !linkedinGroupsLoading && (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-xs text-gray-500">No LinkedIn groups found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
        )}
        {scraperConfigTab === 'keyword' && <LinkedinKeywordScraperPanel />}
        </>
        )}

  {adminView === 'scraper-logs' && <AdminScraperLogsPanel />}
  {adminView === 'career-sites' && (
    <AdminCareerSitesPanel
      onViewJobs={(slug) => {
        setSearchParams((current) => { const next = new URLSearchParams(current); next.set('site', slug); return next; });
        setAdminView('career-jobs');
      }}
    />
  )}
  {adminView === 'career-jobs' && <AdminCareerJobsPanel />}
  {adminView === 'revenue' && <AdminRevenuePanel />}

        {adminView === 'ai-prompts' && <AdminAiPromptsPanel />}
        {adminView === 'websites' && <AdminWebsitesPanel />}
        {adminView === 'channels' && <AdminChannelsPanel />}
        {adminView === 'lists' && <AdminListsPanel />}
        {adminView === 'emails' && <AdminEmailsPanel />}
        {adminView === 'feedback' && <AdminFeedbackPanel />}
        {adminView === 'market' && <AdminMarketPanel />}
        {adminView === 'trends' && <AdminTrendsPanel />}
        {adminView === 'post-outreach' && <AdminPostOutreachPanel />}
        {adminView === 'social' && <AdminSocialPosterPanel />}
        {adminView === 'notifications' && <AdminNotificationsPanel />}
      </div>
      </div>

    </div>
  );
}
