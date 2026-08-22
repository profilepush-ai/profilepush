import { useState, useMemo, useRef, useEffect } from 'react';
import { Lock, RefreshCcw, TrendingUp, Search, Building2, UserCheck, Database, Calendar, ChevronDown, X, Plus, Mail, Play, Pause, Pencil, Trash2, ExternalLink, Save, SlidersHorizontal, LogIn, Clock, CalendarDays, Activity, Megaphone, FileSearch, Send, FileText, MessageSquare } from 'lucide-react';
import LogoSpinner from '../components/LogoSpinner';
import LocationAutosuggestInput from '../components/LocationAutosuggestInput';
import LinkedinKeywordScraperPanel from '../components/LinkedinKeywordScraperPanel';
import AdminScraperLogsPanel from '../components/AdminScraperLogsPanel';
import AdminAiPromptsPanel from '../components/AdminAiPromptsPanel';
import { supabase } from '../lib/supabase';
import { triggerRoleEmbedding } from '../lib/embeddings';
import { filterAndSortAccountStats, type AdminStatsSortDirection, type AdminStatsSortKey } from '../lib/admin-dashboard-table';
import { buildRoleFeedRowsFromMatches, buildRoleStatsSummary } from '../lib/hotlist-role-stats';
import { splitPreferredLocations } from '../lib/location-normalization';

interface AccountStats {
  id: string;
  name: string;
  created_at: string;
  user_name: string;
  user_email: string;
  credits_balance: number;
  searches_count: number;
  job_posts_count: number;
  hotlist_posts_count: number;
  job_previews_count: number;
  hotlist_previews_count: number;
  ai_pitches_count: number;
  ai_requests_count: number;
  chats_count: number;
  account_age_days: number;
  session_count: number;
  active_seconds: number;
  active_days: number;
  last_activity_at: string | null;
  last_logged_in: string | null;
  is_trial: boolean;
}

interface HotlistRoleRow {
  id: string;
  account_id: string;
  target_role: string;
  category: string | null;
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
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

interface HotlistMatchRunRow {
  id: string;
  trigger_source: string;
  account_id: string | null;
  role_id: string | null;
  roles_found: number;
  profiles_processed: number;
  total_matched: number;
  status: 'running' | 'success' | 'error' | 'failed' | 'aborted';
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  created_at: string;
}

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

function canRetryMatchRun(row: HotlistMatchRunRow) {
  const status = String(row.status ?? '').toLowerCase();
  const hasStatusFailure = status === 'error' || status === 'failed' || status === 'aborted';
  const hasErrorMessage = typeof row.error_message === 'string' && row.error_message.trim().length > 0;
  return hasStatusFailure || hasErrorMessage;
}

type AdminView = 'stats' | 'hotlist' | 'scraper' | 'keyword-scraper' | 'scraper-logs' | 'history' | 'ai-prompts';
type LinkedinStatsRange = '24h' | '7d' | '30d' | 'all' | 'custom';

type DatePreset = '7d' | '30d' | '90d' | 'all' | 'custom';

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom range' },
];

const ROLE_CATEGORY_OPTIONS = ['all', 'front-end', 'backend', 'data', 'security', 'crm', 'qa', 'biz-dev', 'ai', 'ml', 'devops'];
const VISA_TYPE_OPTIONS = ['US Citizen', 'Green Card', 'H1B', 'H4EAD', 'TN', 'OPT', 'CPT', 'F1', 'EAD', 'Other'];
const EMPLOYMENT_TYPE_OPTIONS = ['C2C', 'W2', '1099', 'C2C or W2', 'Any'];
const WORK_TYPE_OPTIONS = ['Remote', 'Hybrid', 'Onsite', 'Open'];

function formatTriggerSource(triggerSource: string | null | undefined) {
  if (!triggerSource) return '-';
  if (triggerSource === 'manual_all') return 'manual_all (all roles)';
  if (triggerSource === 'manual_scoped') return 'manual_scoped (single role)';
  if (triggerSource === 'scheduled_cron') return 'scheduled_cron (cron)';
  return triggerSource;
}

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

const COLUMNS: Array<{ key: keyof AccountStats; label: string; icon: React.ReactNode; kind: 'text' | 'number' | 'duration' | 'age' | 'date'; widthClass: string }> = [
  { key: 'user_name', label: 'User Name', icon: <UserCheck size={12} />, kind: 'text', widthClass: 'w-[140px]' },
  { key: 'user_email', label: 'User Email', icon: <Mail size={12} />, kind: 'text', widthClass: 'w-[210px]' },
  { key: 'credits_balance', label: 'Credits', icon: <Database size={12} />, kind: 'number', widthClass: 'w-[110px]' },
  { key: 'searches_count', label: 'Searches', icon: <Search size={12} />, kind: 'number', widthClass: 'w-[95px]' },
  { key: 'job_posts_count', label: 'Job Posts', icon: <Megaphone size={12} />, kind: 'number', widthClass: 'w-[100px]' },
  { key: 'hotlist_posts_count', label: 'Hotlist Posts', icon: <Megaphone size={12} />, kind: 'number', widthClass: 'w-[115px]' },
  { key: 'job_previews_count', label: 'Job Previews', icon: <FileSearch size={12} />, kind: 'number', widthClass: 'w-[115px]' },
  { key: 'hotlist_previews_count', label: 'Hotlist Previews', icon: <FileSearch size={12} />, kind: 'number', widthClass: 'w-[135px]' },
  { key: 'ai_pitches_count', label: 'AI Pitches', icon: <Send size={12} />, kind: 'number', widthClass: 'w-[105px]' },
  { key: 'ai_requests_count', label: 'AI Requests', icon: <FileText size={12} />, kind: 'number', widthClass: 'w-[115px]' },
  { key: 'chats_count', label: 'Chats', icon: <MessageSquare size={12} />, kind: 'number', widthClass: 'w-[90px]' },
  { key: 'account_age_days', label: 'Created Since', icon: <CalendarDays size={12} />, kind: 'age', widthClass: 'w-[120px]' },
  { key: 'session_count', label: 'Sessions', icon: <LogIn size={12} />, kind: 'number', widthClass: 'w-[95px]' },
  { key: 'active_seconds', label: 'Active Time', icon: <Clock size={12} />, kind: 'duration', widthClass: 'w-[110px]' },
  { key: 'active_days', label: 'Active Days', icon: <CalendarDays size={12} />, kind: 'number', widthClass: 'w-[105px]' },
  { key: 'last_activity_at', label: 'Last Activity', icon: <Activity size={12} />, kind: 'date', widthClass: 'w-[155px]' },
  { key: 'last_logged_in', label: 'Last Logged In', icon: <Calendar size={12} />, kind: 'date', widthClass: 'w-[155px]' },
];

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

export default function AdminDashboard() {
  const [authed, setAuthed] = useState(!!sessionStorage.getItem('admin_authed'));
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<AccountStats[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [roles, setRoles] = useState<HotlistRoleRow[]>([]);
  const [rolesError, setRolesError] = useState('');
  const [rolesNotice, setRolesNotice] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState<HotlistMatchRunRow[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [historyNotice, setHistoryNotice] = useState('');
  const [retryingHistoryRunId, setRetryingHistoryRunId] = useState<string | null>(null);
  const [abortingHistoryRunId, setAbortingHistoryRunId] = useState<string | null>(null);
  const [roleStatsSummary, setRoleStatsSummary] = useState<Record<string, { job_count: number; watch_count: number; active_watch_count: number }>>({});
  const [rolesSearchQuery, setRolesSearchQuery] = useState('');
  const [rolesCategoryFilter, setRolesCategoryFilter] = useState('all');
  const [adminView, setAdminView] = useState<AdminView>('stats');
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

  const [newRoleAccountId, setNewRoleAccountId] = useState('');
  const [newRoleTargetRole, setNewRoleTargetRole] = useState('');
  const [newRoleCategory, setNewRoleCategory] = useState('all');
  const [newRoleMinYearsExp, setNewRoleMinYearsExp] = useState('');
  const [newRoleMaxYearsExp, setNewRoleMaxYearsExp] = useState('');
  const [newRoleVisaStatus, setNewRoleVisaStatus] = useState('');
  const [newRoleEmploymentType, setNewRoleEmploymentType] = useState('');
  const [newRoleWorkType, setNewRoleWorkType] = useState('');
  const [newRolePreferredLocations, setNewRolePreferredLocations] = useState('');
  const [newRoleMinRate, setNewRoleMinRate] = useState('');
  const [newRoleMaxRate, setNewRoleMaxRate] = useState('');
  const [newRolePrioritySkills, setNewRolePrioritySkills] = useState('');
  const [newRoleRelocationOpen, setNewRoleRelocationOpen] = useState(false);
  const [preferredLocationInput, setPreferredLocationInput] = useState('');
  const [newRoleIsActive, setNewRoleIsActive] = useState(true);
  const [newRoleSaving, setNewRoleSaving] = useState(false);
  const [showAddRoleModal, setShowAddRoleModal] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null);
  const [deleteConfirmRole, setDeleteConfirmRole] = useState<HotlistRoleRow | null>(null);
  const [runningRoleMatchId, setRunningRoleMatchId] = useState<string | null>(null);
  const [runningAllRolesMatch, setRunningAllRolesMatch] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('7d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showDateDropdown, setShowDateDropdown] = useState(false);
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
          body: JSON.stringify({ password: authPw, start_date, end_date }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error || 'Request failed');
        setLoading(false);
        return false;
      }
      const data = await res.json();
      setStats(data.stats ?? []);
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
    await Promise.all([fetchStats(), fetchHotlistRoles(), fetchLinkedinGroups(), fetchMatchRunHistory()]);
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

  async function fetchHotlistRoles() {
    setRolesLoading(true);
    setRolesError('');
    const { data, error } = await supabase
      .from('hotlist_ai_roles')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(500);

    if (error) {
      setRolesError(error.message);
      setRolesLoading(false);
      return;
    }

    const roleRows = (data ?? []) as HotlistRoleRow[];
    setRoles(roleRows);

    const roleIds = roleRows.map((role) => role.id);

    const [matchRowsResult, watchesResult] = await Promise.all([
      supabase
        .from('radar_match_results')
        .select('job_source, job_id, created_at')
        .eq('job_source', 'social')
        .order('created_at', { ascending: false })
        .limit(5000),
      roleIds.length > 0
        ? supabase.from('watchlist_profiles').select('source_hotlist_role_id,is_watching').in('source_hotlist_role_id', roleIds)
        : Promise.resolve({ data: [] as Array<{ source_hotlist_role_id: string | null; is_watching: boolean | null }>, error: null }),
    ]);

    if (matchRowsResult.error || watchesResult.error) {
      setRoleStatsSummary({});
    } else {
      const matchRows = (matchRowsResult.data ?? []) as Array<{ job_source?: string | null; job_id?: string | null; created_at?: string | null }>;
      const socialJobIds = Array.from(new Set(matchRows.map((row) => (row.job_id ?? '').trim()).filter(Boolean)));
      let socialRows: Array<{ id?: string | null; extracted_role_normalized?: string | null; job_title?: string | null; post_content?: string | null }> = [];

      if (socialJobIds.length > 0) {
        const { data: socialData, error: socialError } = await supabase
          .from('social_jobs')
          .select('id, job_title, post_content, extracted_role_normalized')
          .in('id', socialJobIds);

        if (!socialError) {
          socialRows = (socialData ?? []) as Array<{ id?: string | null; extracted_role_normalized?: string | null; job_title?: string | null; post_content?: string | null }>;
        }
      }

      const feedRows = buildRoleFeedRowsFromMatches(matchRows, socialRows);
      setRoleStatsSummary(buildRoleStatsSummary(
        roleRows.map((role) => ({ id: role.id, target_role: role.target_role, priority_skills: role.priority_skills })),
        feedRows,
        (watchesResult.data ?? []) as Array<{ source_hotlist_role_id?: string | null; is_watching?: boolean | null }>
      ));
    }

    setRolesLoading(false);
  }

  async function fetchMatchRunHistory() {
    setHistoryLoading(true);
    setHistoryError('');

    const { data, error } = await supabase
      .from('hotlist_match_runs')
      .select('id, trigger_source, account_id, role_id, roles_found, profiles_processed, total_matched, status, error_message, started_at, completed_at, duration_ms, created_at')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      setHistoryError(error.message);
      setHistoryLoading(false);
      return;
    }

    setHistoryRows((data ?? []) as HotlistMatchRunRow[]);
    setHistoryLoading(false);
  }

  async function retryErroredMatchRun(row: HotlistMatchRunRow) {
    if (retryingHistoryRunId || abortingHistoryRunId || !canRetryMatchRun(row)) return;

    setRetryingHistoryRunId(row.id);
    setHistoryError('');
    setHistoryNotice('');

    const payload = row.role_id
      ? { trigger_source: 'manual_scoped', role_id: row.role_id }
      : { trigger_source: 'manual_all' };

    const { data, error } = await supabase.functions.invoke('job-watch-trigger', {
      body: payload,
    });

    if (error) {
      setHistoryError(error.message || 'Failed to retry this match run.');
      setRetryingHistoryRunId(null);
      return;
    }

    const summary = typeof data?.message === 'string'
      ? data.message
      : row.role_id
        ? 'Retry completed for role run.'
        : 'Retry completed for all roles run.';
    const profilesProcessed = typeof data?.profiles_processed === 'number' ? data.profiles_processed : 0;
    const totalMatched = typeof data?.total_matched === 'number' ? data.total_matched : 0;
    setHistoryNotice(`${summary} Roles processed: ${profilesProcessed}. Matches added: ${totalMatched}.`);

    await fetchMatchRunHistory();
    setRetryingHistoryRunId(null);
  }

  async function abortRunningMatchRun(row: HotlistMatchRunRow) {
    if (retryingHistoryRunId || abortingHistoryRunId || row.status !== 'running') return;

    setAbortingHistoryRunId(row.id);
    setHistoryError('');
    setHistoryNotice('');

    const { data, error } = await supabase.functions.invoke('job-watch-trigger', {
      body: {
        action: 'abort',
        run_log_id: row.id,
      },
    });

    if (error) {
      setHistoryError(error.message || 'Failed to abort this running match run.');
      setAbortingHistoryRunId(null);
      return;
    }

    const summary = typeof data?.message === 'string' ? data.message : 'Abort requested.';
    setHistoryNotice(summary);
    await fetchMatchRunHistory();
    setAbortingHistoryRunId(null);
  }

  function resetNewRoleForm() {
    setNewRoleAccountId(stats[0]?.id ?? '');
    setNewRoleTargetRole('');
    setNewRoleCategory('all');
    setNewRoleMinYearsExp('');
    setNewRoleMaxYearsExp('');
    setNewRoleVisaStatus('');
    setNewRoleEmploymentType('');
    setNewRoleWorkType('');
    setNewRolePreferredLocations('');
    setNewRoleMinRate('');
    setNewRoleMaxRate('');
    setNewRolePrioritySkills('');
    setNewRoleRelocationOpen(false);
    setPreferredLocationInput('');
    setNewRoleIsActive(true);
  }

  function openAddRoleModal() {
    setEditingRoleId(null);
    resetNewRoleForm();
    setRolesError('');
    setShowAddRoleModal(true);
  }

  function openEditRoleModal(role: HotlistRoleRow) {
    setEditingRoleId(role.id);
    setNewRoleAccountId(role.account_id);
    setNewRoleTargetRole(role.target_role || '');
    setNewRoleCategory(role.category || 'all');
    setNewRoleMinYearsExp(role.min_years_exp != null ? String(role.min_years_exp) : '');
    setNewRoleMaxYearsExp(role.max_years_exp != null ? String(role.max_years_exp) : '');
    setNewRoleVisaStatus(role.visa_status || '');
    setNewRoleEmploymentType(role.employment_type || '');
    setNewRoleWorkType(role.work_type || '');
    setNewRolePreferredLocations(role.preferred_locations || '');
    setNewRoleMinRate(role.min_rate_usd_per_hr != null ? String(role.min_rate_usd_per_hr) : '');
    setNewRoleMaxRate(role.max_rate_usd_per_hr != null ? String(role.max_rate_usd_per_hr) : '');
    setNewRolePrioritySkills(role.priority_skills || '');
    setNewRoleRelocationOpen(Boolean(role.relocation_open));
    setPreferredLocationInput('');
    setNewRoleIsActive(role.is_active);
    setRolesError('');
    setShowAddRoleModal(true);
  }

  function closeRoleModal() {
    setShowAddRoleModal(false);
    setEditingRoleId(null);
  }

  function toNumberOrNull(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function addPreferredLocation(value: string) {
    const candidate = value.trim();
    if (!candidate) return;
    const current = splitPreferredLocations(newRolePreferredLocations);
    const exists = current.some((loc) => loc.toLowerCase() === candidate.toLowerCase());
    if (exists) {
      setPreferredLocationInput('');
      return;
    }
    setNewRolePreferredLocations([...current, candidate].join(' | '));
    setPreferredLocationInput('');
  }

  function removePreferredLocation(value: string) {
    const next = splitPreferredLocations(newRolePreferredLocations)
      .filter((loc) => loc.toLowerCase() !== value.toLowerCase());
    setNewRolePreferredLocations(next.join(' | '));
  }

  async function createRole() {
    const accountId = newRoleAccountId || stats[0]?.id || '';
    if (!accountId) {
      setRolesError('No account found to attach this role.');
      return;
    }

    if (!newRoleTargetRole.trim()) {
      setRolesError('Target role is required to create a hotlist role.');
      return;
    }

    setNewRoleSaving(true);
    setRolesError('');

    const payload = {
      account_id: accountId,
      target_role: newRoleTargetRole.trim(),
      category: newRoleCategory,
      min_years_exp: toNumberOrNull(newRoleMinYearsExp),
      max_years_exp: toNumberOrNull(newRoleMaxYearsExp),
      visa_status: newRoleVisaStatus.trim() || null,
      employment_type: newRoleEmploymentType.trim() || null,
      work_type: newRoleWorkType.trim() || null,
      preferred_locations: newRolePreferredLocations.trim() || null,
      min_rate_usd_per_hr: toNumberOrNull(newRoleMinRate),
      max_rate_usd_per_hr: toNumberOrNull(newRoleMaxRate),
      relocation_open: newRoleRelocationOpen,
      priority_skills: newRolePrioritySkills.trim() || null,
      schedule_frequency: 'daily' as const,
      is_active: newRoleIsActive,
    };

    const { data, error } = await supabase
      .from('hotlist_ai_roles')
      .insert(payload)
      .select('id')
      .single();

    if (error) {
      setRolesError(error.message);
      setNewRoleSaving(false);
      return;
    }

    if (data?.id) {
      void triggerRoleEmbedding(String(data.id));
    }

    resetNewRoleForm();
    setShowAddRoleModal(false);
    await fetchHotlistRoles();
    setNewRoleSaving(false);
  }

  async function updateRole() {
    if (!editingRoleId) return;

    if (!newRoleTargetRole.trim()) {
      setRolesError('Target role is required to update a hotlist role.');
      return;
    }

    setNewRoleSaving(true);
    setRolesError('');

    const payload = {
      account_id: newRoleAccountId,
      target_role: newRoleTargetRole.trim(),
      category: newRoleCategory,
      min_years_exp: toNumberOrNull(newRoleMinYearsExp),
      max_years_exp: toNumberOrNull(newRoleMaxYearsExp),
      visa_status: newRoleVisaStatus.trim() || null,
      employment_type: newRoleEmploymentType.trim() || null,
      work_type: newRoleWorkType.trim() || null,
      preferred_locations: newRolePreferredLocations.trim() || null,
      min_rate_usd_per_hr: toNumberOrNull(newRoleMinRate),
      max_rate_usd_per_hr: toNumberOrNull(newRoleMaxRate),
      relocation_open: newRoleRelocationOpen,
      priority_skills: newRolePrioritySkills.trim() || null,
      is_active: newRoleIsActive,
    };

    const { error } = await supabase
      .from('hotlist_ai_roles')
      .update(payload)
      .eq('id', editingRoleId);

    if (error) {
      setRolesError(error.message);
      setNewRoleSaving(false);
      return;
    }

    void triggerRoleEmbedding(editingRoleId);
    closeRoleModal();
    await fetchHotlistRoles();
    setNewRoleSaving(false);
  }

  async function deleteRole(role: HotlistRoleRow) {
    setDeletingRoleId(role.id);
    setRolesError('');
    setDeleteConfirmRole(null);

    const { error } = await supabase
      .from('hotlist_ai_roles')
      .delete()
      .eq('id', role.id);

    if (error) {
      setRolesError(error.message);
      setDeletingRoleId(null);
      return;
    }

    await fetchHotlistRoles();
    setDeletingRoleId(null);
  }

  function openDeleteConfirm(role: HotlistRoleRow) {
    if (deletingRoleId || runningRoleMatchId) return;
    setDeleteConfirmRole(role);
  }

  function closeDeleteConfirm() {
    if (deletingRoleId) return;
    setDeleteConfirmRole(null);
  }

  async function runMatchesForRole(role: HotlistRoleRow) {
    if (runningRoleMatchId || runningAllRolesMatch) return;

    setRunningRoleMatchId(role.id);
    setRolesError('');
    setRolesNotice('');

    const { data, error } = await supabase.functions.invoke('job-watch-trigger', {
      body: {
        trigger_source: 'manual_scoped',
        role_id: role.id,
      },
    });

    if (error) {
      setRolesError(error.message || `Failed to run matches for ${role.target_role}.`);
      setRunningRoleMatchId(null);
      return;
    }

    const summary = typeof data?.message === 'string'
      ? data.message
      : `Match run completed for ${role.target_role}.`;
    const profilesProcessed = typeof data?.profiles_processed === 'number' ? data.profiles_processed : 0;
    const totalMatched = typeof data?.total_matched === 'number' ? data.total_matched : 0;
    setRolesNotice(`${summary} Roles processed: ${profilesProcessed}. Matches added: ${totalMatched}.`);
    await fetchHotlistRoles();
    setRunningRoleMatchId(null);
  }

  async function runMatchesForAllRoles() {
    if (runningAllRolesMatch || runningRoleMatchId) return;

    setRunningAllRolesMatch(true);
    setRolesError('');
    setRolesNotice('');

    const { data, error } = await supabase.functions.invoke('job-watch-trigger', {
      body: {
        trigger_source: 'manual_all',
      },
    });

    if (error) {
      setRolesError(error.message || 'Failed to run matches for all roles.');
      setRunningAllRolesMatch(false);
      return;
    }

    const summary = typeof data?.message === 'string'
      ? data.message
      : 'Match run completed for all active roles.';
    const rolesFound = typeof data?.roles_found === 'number' ? data.roles_found : 0;
    const profilesProcessed = typeof data?.profiles_processed === 'number' ? data.profiles_processed : 0;
    const totalMatched = typeof data?.total_matched === 'number' ? data.total_matched : 0;
    setRolesNotice(`${summary} Roles found: ${rolesFound}. Roles processed: ${profilesProcessed}. Matches added: ${totalMatched}.`);
    await fetchHotlistRoles();
    setRunningAllRolesMatch(false);
  }

  // Re-fetch when date range changes (if already authed)
  useEffect(() => {
    if (authed && datePreset !== 'custom') {
      fetchStats();
    }
  }, [datePreset]);

  useEffect(() => {
    if (authed) {
      void fetchHotlistRoles();
      void fetchLinkedinGroups();
      void fetchMatchRunHistory();
    }
  }, [authed]);

  useEffect(() => {
    if (newRoleAccountId || stats.length === 0) return;
    setNewRoleAccountId(stats[0]?.id ?? '');
  }, [newRoleAccountId, stats]);

  function applyCustomRange() {
    if (customStart || customEnd) {
      setShowDateDropdown(false);
      fetchStats();
    }
  }

  const filteredStats = useMemo(() => {
    return filterAndSortAccountStats(stats, {
      query: searchQuery,
      startDate: customStart,
      endDate: customEnd,
      sortKey,
      sortDirection,
    });
  }, [stats, searchQuery, customStart, customEnd, sortKey, sortDirection]);

  const filteredRoles = useMemo(() => {
    const q = rolesSearchQuery.trim().toLowerCase();
    return roles.filter((role) => {
      const category = (role.category || 'all').toLowerCase();
      const categoryMatches = rolesCategoryFilter === 'all' || category === rolesCategoryFilter.toLowerCase();
      if (!categoryMatches) return false;

      if (!q) return true;

      const haystack = [
        role.target_role,
        role.category,
        role.visa_status,
        role.employment_type,
        role.work_type,
        role.preferred_locations,
        role.priority_skills,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [roles, rolesCategoryFilter, rolesSearchQuery]);

  const filteredLinkedinGroups = useMemo(() => {
    const query = linkedinGroupsSearch.trim().toLowerCase();
    if (!query) return linkedinGroups;
    return linkedinGroups.filter((group) => (
      group.group_id.includes(query) || (group.group_name ?? '').toLowerCase().includes(query)
    ));
  }, [linkedinGroups, linkedinGroupsSearch]);

  // Totals row
  const totals: Record<string, number> = {};
  for (const col of COLUMNS) {
    totals[col.key] = col.kind === 'number' || col.kind === 'duration'
      ? filteredStats.reduce((sum, s) => sum + ((s[col.key] as number) || 0), 0)
      : 0;
  }

  const roleTotals = filteredRoles.reduce(
    (acc, role) => {
      const summary = roleStatsSummary[role.id];
      acc.jobs += summary?.job_count ?? 0;
      acc.watches += summary?.watch_count ?? 0;
      return acc;
    },
    { jobs: 0, watches: 0 }
  );

  const currentPresetLabel = DATE_PRESETS.find(p => p.key === datePreset)?.label ?? 'Last 7 days';

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

  return (
    <div className="h-screen overflow-hidden bg-white text-gray-900 font-sans flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-2.5 sm:px-6">
          <div className="flex flex-wrap items-center gap-3 lg:flex-nowrap">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100">
                <TrendingUp size={15} className="text-gray-700" />
              </div>
              <div className="min-w-0">
                <h1 className="whitespace-nowrap text-sm font-semibold text-gray-900">ProfilePush Admin</h1>
                <p className="truncate text-[10px] text-gray-500">
                  {adminView === 'stats'
                    ? `${filteredStats.length} of ${stats.length} accounts`
                    : adminView === 'hotlist'
                      ? `${roles.length} hotlist roles`
                      : adminView === 'scraper'
                        ? `${linkedinGroups.filter((group) => group.is_active).length} active of ${linkedinGroups.length} LinkedIn groups`
                      : adminView === 'keyword-scraper'
                        ? 'LinkedIn keyword search configuration'
                        : adminView === 'scraper-logs'
                          ? 'Hourly group and keyword pipeline logs'
                          : `${historyRows.length} match runs`}
                </p>
              </div>
            </div>
            <nav className="order-3 flex w-full min-w-0 items-center gap-1 overflow-x-auto lg:order-none lg:ml-auto lg:w-auto" aria-label="Admin sections">
              <button
                onClick={() => setAdminView('stats')}
                className={`h-8 shrink-0 border-b-2 px-2.5 text-xs font-semibold transition ${adminView === 'stats' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
              >
                Account Stats
              </button>
              <button
                onClick={() => setAdminView('hotlist')}
                className={`h-8 shrink-0 border-b-2 px-2.5 text-xs font-semibold transition ${adminView === 'hotlist' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
              >
                Hotlist Roles
              </button>
              <button
                onClick={() => setAdminView('scraper')}
                className={`h-8 shrink-0 border-b-2 px-2.5 text-xs font-semibold transition ${adminView === 'scraper' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
              >
                Scraper Config
              </button>
              <button
                onClick={() => setAdminView('keyword-scraper')}
                className={`h-8 shrink-0 border-b-2 px-2.5 text-xs font-semibold transition ${adminView === 'keyword-scraper' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
              >
                Keyword Scraper
              </button>
              <button
                onClick={() => setAdminView('scraper-logs')}
                className={`h-8 shrink-0 border-b-2 px-2.5 text-xs font-semibold transition ${adminView === 'scraper-logs' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
              >
                Scraper Logs
              </button>
              <button
                onClick={() => setAdminView('history')}
                className={`h-8 shrink-0 border-b-2 px-2.5 text-xs font-semibold transition ${adminView === 'history' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
              >
                Match History
              </button>
              <button
                onClick={() => setAdminView('ai-prompts')}
                className={`h-8 shrink-0 border-b-2 px-2.5 text-xs font-semibold transition ${adminView === 'ai-prompts' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
              >
                AI Prompts
              </button>
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-1 lg:ml-2">
              <button
                onClick={refresh}
                disabled={loading || rolesLoading || linkedinGroupsLoading}
                title="Refresh dashboard"
                className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
              >
                <RefreshCcw size={13} className={loading || rolesLoading || linkedinGroupsLoading ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={() => { sessionStorage.removeItem('admin_authed'); setAuthed(false); setStats([]); }}
                className="h-8 rounded-md px-2 text-xs font-medium text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      {adminView === 'stats' && (
      <div className="w-full px-4 py-2 sm:px-6">
        <div className="mx-auto grid w-full max-w-[1600px] gap-2 sm:grid-cols-[minmax(280px,1fr)_180px] sm:items-center">
          <div className="relative min-w-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search by name, username, or email"
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
      </div>
      )}

      {/* Stats Table */}
      <div className="mx-auto flex-1 min-h-0 min-w-0 w-full max-w-[1600px] overflow-x-hidden px-4 pb-4 sm:px-6 sm:pb-6">
        {adminView === 'stats' && (
          loading && stats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <LogoSpinner size={24} />
              <p className="text-sm text-gray-500">Loading account data...</p>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className="grid shrink-0 grid-cols-2 overflow-hidden rounded-lg border border-gray-200 bg-white sm:grid-cols-4 lg:grid-cols-6">
                {[
                  { label: 'Accounts', value: filteredStats.length.toLocaleString() },
                  { label: 'Searches', value: (totals.searches_count ?? 0).toLocaleString() },
                  { label: 'Job Posts', value: (totals.job_posts_count ?? 0).toLocaleString() },
                  { label: 'Hotlist Posts', value: (totals.hotlist_posts_count ?? 0).toLocaleString() },
                  { label: 'Job Previews', value: (totals.job_previews_count ?? 0).toLocaleString() },
                  { label: 'Hotlist Previews', value: (totals.hotlist_previews_count ?? 0).toLocaleString() },
                  { label: 'AI Pitches', value: (totals.ai_pitches_count ?? 0).toLocaleString() },
                  { label: 'AI Requests', value: (totals.ai_requests_count ?? 0).toLocaleString() },
                  { label: 'Chats', value: (totals.chats_count ?? 0).toLocaleString() },
                  { label: 'Credits', value: (totals.credits_balance ?? 0).toLocaleString() },
                  { label: 'Sessions', value: (totals.session_count ?? 0).toLocaleString() },
                  { label: 'Active Time', value: formatActiveTime(totals.active_seconds ?? 0) },
                ].map((metric) => (
                  <div key={metric.label} className="border-b border-r border-gray-200 px-4 py-3 [&:nth-child(2n)]:border-r-0 [&:nth-child(n+11)]:border-b-0 sm:[&:nth-child(4n)]:border-r-0 sm:[&:nth-child(n+9)]:border-b-0 lg:[&:nth-child(6n)]:border-r-0 lg:[&:nth-child(n+7)]:border-b-0">
                    <p className="text-[10px] font-semibold uppercase text-gray-500">{metric.label}</p>
                    <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{metric.value}</p>
                  </div>
                ))}
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
              <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full min-w-[2080px] table-fixed text-left">
                <thead className="sticky top-0 z-[4]">
                  <tr className="border-b border-gray-200 bg-gray-50">
                    {COLUMNS.map(col => (
                      <th key={col.key} className={`${col.widthClass} px-4 py-2.5 text-[10px] font-semibold uppercase text-gray-600 whitespace-nowrap ${col.kind === 'number' || col.kind === 'duration' || col.kind === 'age' ? 'text-right' : 'text-left'}`}>
                        <button
                          title={`Sort by ${col.label}`}
                          className={`flex w-full items-center gap-1.5 transition-colors hover:text-blue-600 ${col.kind === 'number' || col.kind === 'duration' || col.kind === 'age' ? 'justify-end text-right' : 'justify-start text-left'}`}
                          onClick={() => {
                            if (sortKey === col.key) {
                              setSortDirection((current) => (current === 'desc' ? 'asc' : 'desc'));
                            } else {
                              setSortKey(col.key as AdminStatsSortKey);
                              setSortDirection('desc');
                            }
                          }}
                        >
                          {col.icon} {col.label}
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
                      key={account.id}
                      className="border-b border-gray-200 bg-white transition-colors hover:bg-gray-50"
                    >
                      {COLUMNS.map(col => {
                        const value = account[col.key];
                        return (
                          <td key={col.key} className={`px-4 py-2.5 ${col.kind === 'number' || col.kind === 'duration' || col.kind === 'age' ? 'text-right' : 'text-left'}`}>
                            {col.kind === 'number' ? (
                              <span className={`text-xs tabular-nums font-normal ${((value as number) || 0) > 0 ? 'text-gray-800' : 'text-gray-400'}`}>
                                {((value as number) || 0).toLocaleString()}
                              </span>
                            ) : col.kind === 'duration' ? (
                              <span className={`text-xs tabular-nums font-normal ${((value as number) || 0) > 0 ? 'text-gray-800' : 'text-gray-400'}`}>
                                {formatActiveTime((value as number) || 0)}
                              </span>
                            ) : col.kind === 'age' ? (
                              <span className="text-xs tabular-nums font-normal text-gray-700">
                                {`${Math.max(0, (value as number) || 0).toLocaleString()}d`}
                              </span>
                            ) : col.kind === 'date' ? (
                              <span className="block truncate text-xs font-normal text-gray-600 whitespace-nowrap">
                                {typeof value === 'string' ? formatCompactDateTime(value) : '-'}
                              </span>
                            ) : (
                              <span className="block truncate text-xs font-normal text-gray-800">
                                {typeof value === 'string' && value ? value : '-'}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              </div>
            </div>
          )
        )}

        {adminView === 'hotlist' && (
        <div className="mt-4 flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between border-b border-gray-200 px-3 py-3 gap-3 sm:px-4">
            <div className="relative w-full max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={rolesSearchQuery}
                onChange={(e) => setRolesSearchQuery(e.target.value)}
                placeholder="Search hotlist roles..."
                className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-8 py-2 text-xs text-gray-900 placeholder:text-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              {rolesSearchQuery && (
                <button
                  onClick={() => setRolesSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              <select
                value={rolesCategoryFilter}
                onChange={(e) => setRolesCategoryFilter(e.target.value)}
                className="h-9 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700 outline-none focus:border-blue-500"
              >
                <option value="all">All Categories</option>
                {ROLE_CATEGORY_OPTIONS.filter((option) => option !== 'all').map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <button
                onClick={() => void runMatchesForAllRoles()}
                disabled={rolesLoading || runningAllRolesMatch || !!runningRoleMatchId || roles.length === 0}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                {runningAllRolesMatch ? <RefreshCcw size={11} className="animate-spin" /> : <Play size={11} />} Run All Roles
              </button>
              <button
                onClick={openAddRoleModal}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-blue-600 bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Plus size={11} /> Add New Role
              </button>
              <button
                onClick={() => void fetchHotlistRoles()}
                disabled={rolesLoading}
                className="flex h-9 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                <RefreshCcw size={11} className={rolesLoading ? 'animate-spin' : ''} /> Reload Roles
              </button>
            </div>
          </div>

          {rolesError && (
            <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
              {rolesError}
            </div>
          )}

          {rolesNotice && (
            <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">
              {rolesNotice}
            </div>
          )}

          {rolesLoading && roles.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-8">
              <LogoSpinner size={18} />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-x-scroll overflow-y-auto pb-2 pr-2" style={{ scrollbarGutter: 'stable both-edges' }}>
              <table className="min-w-max w-full table-auto border-collapse border-spacing-0 text-left">
                <thead className="sticky top-0 z-[2]">
                  <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-600">
                    <th className="sticky left-0 z-[5] w-[160px] min-w-[160px] max-w-[160px] border-r border-gray-200 bg-gray-50 px-3 py-2 whitespace-normal">Role</th>
                    <th className="sticky left-[160px] z-[5] w-[90px] min-w-[90px] max-w-[90px] border-r border-gray-200 bg-gray-50 px-3 py-2 whitespace-nowrap">Category</th>
                    <th className="sticky left-[250px] z-[5] w-[70px] min-w-[70px] max-w-[70px] border-r border-gray-200 bg-gray-50 px-3 py-2 whitespace-nowrap">Jobs</th>
                    <th className="sticky left-[320px] z-[5] w-[80px] min-w-[80px] max-w-[80px] border-r border-gray-200 bg-gray-50 px-3 py-2 whitespace-nowrap">Watches</th>
                    <th className="min-w-[80px] px-3 py-2 whitespace-nowrap">Years</th>
                    <th className="min-w-[80px] px-3 py-2 whitespace-nowrap">Visa</th>
                    <th className="min-w-[100px] px-3 py-2 whitespace-nowrap">Emp Type</th>
                    <th className="min-w-[90px] px-3 py-2 whitespace-nowrap">Work Type</th>
                    <th className="min-w-[150px] px-3 py-2 whitespace-nowrap">Locations</th>
                    <th className="min-w-[80px] px-3 py-2 whitespace-nowrap">Rate Min</th>
                    <th className="min-w-[80px] px-3 py-2 whitespace-nowrap">Rate Max</th>
                    <th className="min-w-[220px] px-3 py-2 whitespace-nowrap">Skills</th>
                    <th className="min-w-[70px] px-3 py-2 whitespace-nowrap">Reloc</th>
                    <th className="min-w-[90px] px-3 py-2 whitespace-nowrap">Status</th>
                    <th className="min-w-[110px] px-3 py-2 whitespace-nowrap">Updated</th>
                    <th
                      className="sticky right-0 z-[6] min-w-[104px] bg-gray-50 px-1.5 py-2 whitespace-nowrap"
                      style={{ boxShadow: '-14px 0 14px -14px rgba(255,255,255,1)' }}
                    >
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-blue-200 bg-blue-50 text-xs">
                    <td className="sticky left-0 z-[4] w-[160px] min-w-[160px] max-w-[160px] border-r border-blue-200 bg-blue-50 px-3 py-2 whitespace-normal break-words">
                      <span className="block font-semibold text-blue-700">Totals</span>
                    </td>
                    <td className="sticky left-[160px] z-[4] w-[90px] min-w-[90px] max-w-[90px] border-r border-blue-200 bg-blue-50 px-3 py-2 whitespace-nowrap">
                      <span className="text-blue-700">All</span>
                    </td>
                    <td className="sticky left-[250px] z-[4] w-[70px] min-w-[70px] max-w-[70px] border-r border-blue-200 bg-blue-50 px-3 py-2 whitespace-nowrap">
                      <span className="font-semibold text-blue-700">{roleTotals.jobs}</span>
                    </td>
                    <td className="sticky left-[320px] z-[4] w-[80px] min-w-[80px] max-w-[80px] border-r border-blue-200 bg-blue-50 px-3 py-2 whitespace-nowrap">
                      <span className="font-semibold text-blue-700">{roleTotals.watches}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" colSpan={11} />
                    <td
                      className="sticky right-0 z-[6] min-w-[104px] bg-blue-50 px-1.5 py-2 whitespace-nowrap"
                      style={{ boxShadow: '-14px 0 14px -14px rgba(255,255,255,1)' }}
                    />
                  </tr>

                  {filteredRoles.map((role) => (
                    <tr key={role.id} className="border-b border-gray-200 align-top text-xs text-gray-800 hover:bg-gray-50">
                      <td className="sticky left-0 z-[4] w-[160px] min-w-[160px] max-w-[160px] border-r border-gray-200 bg-white px-3 py-2 whitespace-normal break-words">
                        <span className="block font-medium leading-snug text-gray-900">{role.target_role || '-'}</span>
                      </td>
                      <td className="sticky left-[160px] z-[4] w-[90px] min-w-[90px] max-w-[90px] border-r border-gray-200 bg-white px-3 py-2 whitespace-nowrap">
                        <span className="rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-700">{role.category || 'all'}</span>
                      </td>
                      <td className="sticky left-[250px] z-[4] w-[70px] min-w-[70px] max-w-[70px] border-r border-gray-200 bg-white px-3 py-2 whitespace-nowrap">
                        <span className="font-semibold text-gray-900">{roleStatsSummary[role.id]?.job_count ?? 0}</span>
                      </td>
                      <td className="sticky left-[320px] z-[4] w-[80px] min-w-[80px] max-w-[80px] border-r border-gray-200 bg-white px-3 py-2 whitespace-nowrap">
                        <span className="font-semibold text-gray-900">{roleStatsSummary[role.id]?.watch_count ?? 0}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span>{(role.min_years_exp != null && role.max_years_exp != null) ? `${role.min_years_exp}-${role.max_years_exp}` : (role.min_years_exp ?? '-')}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span>{role.visa_status || '-'}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span>{role.employment_type || '-'}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span>{role.work_type || '-'}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span>{role.preferred_locations || '-'}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span>{role.min_rate_usd_per_hr != null ? `${role.min_rate_usd_per_hr}` : '-'}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span>{role.max_rate_usd_per_hr != null ? `${role.max_rate_usd_per_hr}` : '-'}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span>{role.priority_skills || '-'}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span>{role.relocation_open ? 'Yes' : 'No'}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`rounded px-2 py-1 text-[11px] ${role.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                          {role.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                        {new Date(role.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </td>
                      <td
                        className="sticky right-0 z-[6] min-w-[104px] bg-white px-1.5 py-2 whitespace-nowrap"
                        style={{ boxShadow: '-14px 0 14px -14px rgba(255,255,255,1)' }}
                      >
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => void runMatchesForRole(role)}
                            disabled={runningAllRolesMatch || !!runningRoleMatchId || deletingRoleId === role.id}
                            aria-label={`Run match for ${role.target_role || 'role'}`}
                            title="Run match"
                            className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                          >
                            {runningRoleMatchId === role.id ? <RefreshCcw size={14} className="animate-spin" /> : <Play size={14} />}
                          </button>
                          <button
                            onClick={() => openEditRoleModal(role)}
                            disabled={deletingRoleId === role.id || !!runningRoleMatchId}
                            aria-label={`Edit ${role.target_role || 'role'}`}
                            title="Edit"
                            className="rounded-md border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => openDeleteConfirm(role)}
                            disabled={deletingRoleId === role.id || !!runningRoleMatchId}
                            aria-label={`Delete ${role.target_role || 'role'}`}
                            title="Delete"
                            className="rounded-md border border-red-300 bg-red-50 p-2 text-red-700 hover:bg-red-100 disabled:opacity-50"
                          >
                            {deletingRoleId === role.id ? <RefreshCcw size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {filteredRoles.length === 0 && !rolesLoading && (
                    <tr>
                      <td colSpan={15} className="px-4 py-8 text-center text-xs text-gray-500">No hotlist roles found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}

        {adminView === 'scraper' && (
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

        {adminView === 'keyword-scraper' && <LinkedinKeywordScraperPanel />}

  {adminView === 'scraper-logs' && <AdminScraperLogsPanel />}

        {adminView === 'history' && (
        <div className="mt-4 flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">Match Run History</p>
            <button
              onClick={() => void fetchMatchRunHistory()}
              disabled={historyLoading}
              className="flex h-9 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCcw size={11} className={historyLoading ? 'animate-spin' : ''} /> Reload History
            </button>
          </div>

          {historyError && (
            <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
              {historyError}
            </div>
          )}

          {historyNotice && (
            <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">
              {historyNotice}
            </div>
          )}

          {historyLoading && historyRows.length === 0 ? (
            <div className="flex flex-1 items-center justify-center py-8">
              <LogoSpinner size={18} />
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="min-w-[1100px] w-full table-auto text-left">
                <thead className="sticky top-0 z-[1]">
                  <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-600">
                    <th className="px-3 py-2">Started</th>
                    <th className="px-3 py-2">Completed</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Account</th>
                    <th className="px-3 py-2">Role</th>
                    <th className="px-3 py-2">Roles Found</th>
                    <th className="px-3 py-2">Processed</th>
                    <th className="px-3 py-2">Matches</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Error</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((row) => (
                    <tr key={row.id} className="border-b border-gray-200 align-top text-xs text-gray-800 hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        {new Date(row.started_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        {row.completed_at ? new Date(row.completed_at).toLocaleString() : '-'}
                      </td>
                      <td className="px-3 py-2 break-normal whitespace-normal">
                        <span className="rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-700">{formatTriggerSource(row.trigger_source)}</span>
                      </td>
                      <td className="px-3 py-2 break-normal whitespace-normal text-gray-600">{row.account_id || '-'}</td>
                      <td className="px-3 py-2 break-normal whitespace-normal text-gray-600">{row.role_id || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.roles_found ?? 0}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.profiles_processed ?? 0}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-semibold text-gray-900">{row.total_matched ?? 0}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                        {row.duration_ms != null ? `${Math.round(row.duration_ms / 1000)}s` : '-'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`rounded px-2 py-1 text-[11px] ${row.status === 'success' ? 'bg-green-100 text-green-700' : row.status === 'error' || row.status === 'failed' || row.status === 'aborted' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 break-normal whitespace-normal text-red-700">{row.error_message || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {row.status === 'running' ? (
                          <button
                            onClick={() => void abortRunningMatchRun(row)}
                            disabled={historyLoading || !!abortingHistoryRunId || !!retryingHistoryRunId}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                            title="Abort this running run"
                          >
                            {abortingHistoryRunId === row.id ? <RefreshCcw size={11} className="animate-spin" /> : <X size={11} />}
                            Abort
                          </button>
                        ) : canRetryMatchRun(row) ? (
                          <button
                            onClick={() => void retryErroredMatchRun(row)}
                            disabled={historyLoading || !!retryingHistoryRunId || !!abortingHistoryRunId}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                            title="Retry this failed run"
                          >
                            {retryingHistoryRunId === row.id ? <RefreshCcw size={11} className="animate-spin" /> : <RefreshCcw size={11} />}
                            Retry
                          </button>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}

                  {historyRows.length === 0 && !historyLoading && (
                    <tr>
                      <td colSpan={12} className="px-4 py-8 text-center text-xs text-gray-500">No match runs found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
        )}

        {adminView === 'ai-prompts' && <AdminAiPromptsPanel />}
      </div>

      {adminView === 'hotlist' && showAddRoleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{editingRoleId ? 'Edit Role' : 'Add New Role'}</p>
                <p className="text-[11px] text-gray-500">{editingRoleId ? 'Update role fields and save changes.' : 'Create a role with full match metadata.'}</p>
              </div>
              <button
                onClick={closeRoleModal}
                className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-6">
              <label className="md:col-span-3">
                <span className="mb-1 block text-[11px] font-semibold text-gray-600">Target Role</span>
                <input
                  value={newRoleTargetRole}
                  onChange={(e) => setNewRoleTargetRole(e.target.value)}
                  placeholder="Senior Java Developer"
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
                />
              </label>

              <label>
                <span className="mb-1 block text-[11px] font-semibold text-gray-600">Category</span>
                <select
                  value={newRoleCategory}
                  onChange={(e) => setNewRoleCategory(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
                >
                  {ROLE_CATEGORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>

              <label>
                <span className="mb-1 block text-[11px] font-semibold text-gray-600">Status</span>
                <select
                  value={newRoleIsActive ? 'active' : 'inactive'}
                  onChange={(e) => setNewRoleIsActive(e.target.value === 'active')}
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>

              <label>
                <span className="mb-1 block text-[11px] font-semibold text-gray-600">Min Years</span>
                <input
                  value={newRoleMinYearsExp}
                  onChange={(e) => setNewRoleMinYearsExp(e.target.value)}
                  placeholder="3"
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
                />
              </label>

              <label>
                <span className="mb-1 block text-[11px] font-semibold text-gray-600">Max Years</span>
                <input
                  value={newRoleMaxYearsExp}
                  onChange={(e) => setNewRoleMaxYearsExp(e.target.value)}
                  placeholder="8"
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
                />
              </label>

              <label>
                <span className="mb-1 block text-[11px] font-semibold text-gray-600">Visa Type</span>
                <select
                  value={newRoleVisaStatus}
                  onChange={(e) => setNewRoleVisaStatus(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
                >
                  <option value="">Select</option>
                  {VISA_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>

              <label>
                <span className="mb-1 block text-[11px] font-semibold text-gray-600">Employment Type</span>
                <select
                  value={newRoleEmploymentType}
                  onChange={(e) => setNewRoleEmploymentType(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
                >
                  <option value="">Select</option>
                  {EMPLOYMENT_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>

              <label>
                <span className="mb-1 block text-[11px] font-semibold text-gray-600">Work Type</span>
                <select
                  value={newRoleWorkType}
                  onChange={(e) => setNewRoleWorkType(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
                >
                  <option value="">Select</option>
                  {WORK_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>

              <div className="md:col-span-2">
                <span className="mb-1 block text-[11px] font-semibold text-gray-600">Preferred Locations</span>
                <div className="rounded-md border border-gray-300 bg-white p-2">
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {splitPreferredLocations(newRolePreferredLocations).map((loc) => (
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
                  <div className="flex items-center gap-1.5">
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
                      className="h-[30px] rounded-md border border-gray-200 px-2.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-50"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              <label>
                <span className="mb-1 block text-[11px] font-semibold text-gray-600">Rate Min ($/hr)</span>
                <input
                  value={newRoleMinRate}
                  onChange={(e) => setNewRoleMinRate(e.target.value)}
                  placeholder="50"
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
                />
              </label>

              <label>
                <span className="mb-1 block text-[11px] font-semibold text-gray-600">Rate Max ($/hr)</span>
                <input
                  value={newRoleMaxRate}
                  onChange={(e) => setNewRoleMaxRate(e.target.value)}
                  placeholder="80"
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
                />
              </label>

              <label className="md:col-span-3">
                <span className="mb-1 block text-[11px] font-semibold text-gray-600">Priority Skills</span>
                <textarea
                  value={newRolePrioritySkills}
                  onChange={(e) => setNewRolePrioritySkills(e.target.value)}
                  placeholder="Java, Spring Boot, AWS"
                  rows={2}
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
                />
              </label>

              <div className="flex items-center gap-3 md:col-span-3">
                <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={newRoleRelocationOpen}
                    onChange={(e) => setNewRoleRelocationOpen(e.target.checked)}
                  />
                  Relocation
                </label>
              </div>
            </div>

            <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-gray-200 bg-white px-4 py-3">
              <button
                onClick={closeRoleModal}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void (editingRoleId ? updateRole() : createRole())}
                disabled={newRoleSaving}
                className="inline-flex items-center gap-1 rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {newRoleSaving ? <LogoSpinner size={12} /> : <Plus size={11} />}
                {editingRoleId ? 'Save Changes' : 'Add Role'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-xl">
            <div className="border-b border-gray-200 px-4 py-3">
              <p className="text-sm font-semibold text-gray-900">Delete role?</p>
              <p className="mt-1 text-xs text-gray-500">
                This will permanently remove <span className="font-medium text-gray-900">{deleteConfirmRole.target_role || 'this role'}</span>.
              </p>
            </div>
            <div className="px-4 py-4 text-sm text-gray-700">
              Are you sure you want to delete this hotlist role? This action cannot be undone.
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3">
              <button
                onClick={closeDeleteConfirm}
                disabled={!!deletingRoleId}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void deleteRole(deleteConfirmRole)}
                disabled={!!deletingRoleId}
                className="rounded-md border border-red-300 bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deletingRoleId === deleteConfirmRole.id ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
