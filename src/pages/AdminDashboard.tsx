import { useState, useMemo, useRef, useEffect } from 'react';
import { Lock, RefreshCcw, TrendingUp, Users, Briefcase, FileText, Zap, Search, Building2, UserCheck, Star, Database, Calendar, ChevronDown, X, Plus } from 'lucide-react';
import LogoSpinner from '../components/LogoSpinner';
import { supabase } from '../lib/supabase';

interface AccountStats {
  id: string;
  name: string;
  created_at: string;
  credits_balance: number;
  is_trial: boolean;
  users: number;
  candidates: number;
  submissions: number;
  vendors: number;
  clients: number;
  job_searches: number;
  credits_used: number;
  api_calls: number;
  resume_rewrites: number;
  match_scores: number;
  wishlisted_jobs: number;
}

interface HotlistRoleRow {
  id: string;
  account_id: string;
  target_role: string;
  category: string | null;
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
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

type AdminView = 'stats' | 'hotlist';

type DatePreset = '7d' | '30d' | '90d' | 'all' | 'custom';

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom range' },
];

const ROLE_CATEGORY_OPTIONS = ['all', 'front-end', 'backend', 'data', 'security', 'crm', 'qa', 'biz-dev', 'ai', 'ml', 'devops'];
const ROLE_SCHEDULE_OPTIONS: Array<HotlistRoleRow['schedule_frequency']> = ['disabled', 'hourly', 'daily', 'twice_daily', 'weekly'];

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

const COLUMNS: { key: keyof AccountStats; label: string; icon: React.ReactNode }[] = [
  { key: 'users', label: 'Users', icon: <Users size={12} /> },
  { key: 'candidates', label: 'Candidates', icon: <UserCheck size={12} /> },
  { key: 'credits_balance', label: 'Credits Bal.', icon: <Database size={12} /> },
  { key: 'credits_used', label: 'Credits Used', icon: <Zap size={12} /> },
  { key: 'job_searches', label: 'Job Searches', icon: <Search size={12} /> },
  { key: 'wishlisted_jobs', label: 'Saved Jobs', icon: <Star size={12} /> },
  { key: 'resume_rewrites', label: 'Resume Rewrites', icon: <FileText size={12} /> },
  { key: 'match_scores', label: 'Match Scores', icon: <TrendingUp size={12} /> },
  { key: 'submissions', label: 'Submissions', icon: <Briefcase size={12} /> },
  { key: 'vendors', label: 'Vendors', icon: <Building2 size={12} /> },
  { key: 'clients', label: 'Clients', icon: <Building2 size={12} /> },
  { key: 'api_calls', label: 'Total API Calls', icon: <Zap size={12} /> },
];

export default function AdminDashboard() {
  const [authed, setAuthed] = useState(!!sessionStorage.getItem('admin_authed'));
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<AccountStats[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [roles, setRoles] = useState<HotlistRoleRow[]>([]);
  const [rolesError, setRolesError] = useState('');
  const [adminView, setAdminView] = useState<AdminView>('stats');

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
  const [newRoleAvatarUrl, setNewRoleAvatarUrl] = useState('');
  const [newRoleSchedule, setNewRoleSchedule] = useState<HotlistRoleRow['schedule_frequency']>('daily');
  const [newRoleIsActive, setNewRoleIsActive] = useState(true);
  const [newRoleSaving, setNewRoleSaving] = useState(false);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('7d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [showDateDropdown, setShowDateDropdown] = useState(false);
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
    await Promise.all([fetchStats(), fetchHotlistRoles()]);
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

    setRoles((data ?? []) as HotlistRoleRow[]);
    setRolesLoading(false);
  }

  function resetNewRoleForm() {
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
    setNewRoleAvatarUrl('');
    setNewRoleSchedule('daily');
    setNewRoleIsActive(true);
  }

  function toNumberOrNull(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
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
      years_exp: toNumberOrNull(newRoleMinYearsExp),
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
      schedule_frequency: newRoleSchedule,
      is_active: newRoleIsActive,
      avatar_url: newRoleAvatarUrl.trim() || null,
    };

    const { error } = await supabase.from('hotlist_ai_roles').insert(payload);

    if (error) {
      setRolesError(error.message);
      setNewRoleSaving(false);
      return;
    }

    resetNewRoleForm();
    await fetchHotlistRoles();
    setNewRoleSaving(false);
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

  // Filtered stats by search
  const filteredStats = useMemo(() => {
    if (!searchQuery.trim()) return stats;
    const q = searchQuery.toLowerCase();
    return stats.filter(s => (s.name || '').toLowerCase().includes(q));
  }, [stats, searchQuery]);

  // Totals row
  const totals: Record<string, number> = {};
  for (const col of COLUMNS) {
    totals[col.key] = filteredStats.reduce((sum, s) => sum + ((s[col.key] as number) || 0), 0);
  }

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
    <div className="min-h-screen bg-white text-gray-900 font-sans">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 backdrop-blur-sm">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
              <TrendingUp size={16} className="text-gray-700" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-gray-900">ProfilePush Admin</h1>
              <p className="text-[11px] text-gray-500">
                {adminView === 'stats'
                  ? `${filteredStats.length} of ${stats.length} accounts`
                  : `${roles.length} hotlist roles`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 rounded-lg border border-gray-300 bg-gray-50 p-1">
              <button
                onClick={() => setAdminView('stats')}
                className={`rounded px-2.5 py-1 text-[11px] font-semibold transition ${adminView === 'stats' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >
                Account Stats
              </button>
              <button
                onClick={() => setAdminView('hotlist')}
                className={`rounded px-2.5 py-1 text-[11px] font-semibold transition ${adminView === 'hotlist' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >
                Hotlist AI Roles
              </button>
            </div>
            <button
              onClick={refresh}
              disabled={loading || rolesLoading}
              className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCcw size={12} className={loading || rolesLoading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button
              onClick={() => { sessionStorage.removeItem('admin_authed'); setAuthed(false); setStats([]); }}
              className="text-xs text-gray-500 hover:text-red-600 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      {adminView === 'stats' && (
      <div className="max-w-[1600px] mx-auto px-6 py-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search accounts..."
              className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-8 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
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

          {/* Date Range Dropdown */}
          <div className="relative" ref={dateDropdownRef}>
            <button
              onClick={() => setShowDateDropdown(!showDateDropdown)}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Calendar size={14} className="text-gray-500" />
              <span>{currentPresetLabel}</span>
              {datePreset === 'custom' && (customStart || customEnd) && (
                <span className="text-[10px] text-blue-600 ml-1">
                  {customStart && new Date(customStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {customStart && customEnd && ' - '}
                  {customEnd && new Date(customEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
              <ChevronDown size={12} className="text-gray-500" />
            </button>

            {showDateDropdown && (
              <div className="absolute top-full mt-2 right-0 z-20 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
                {/* Preset options */}
                <div className="p-2">
                  {DATE_PRESETS.map(p => (
                    <button
                      key={p.key}
                      onClick={() => {
                        setDatePreset(p.key);
                        if (p.key !== 'custom') setShowDateDropdown(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                        datePreset === p.key
                          ? 'bg-blue-50 text-blue-700 font-medium'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Custom date inputs */}
                {datePreset === 'custom' && (
                  <div className="border-t border-gray-200 p-3 space-y-3">
                    <div>
                      <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">Start Date</label>
                      <input
                        type="date"
                        value={customStart}
                        onChange={e => setCustomStart(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">End Date</label>
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
      <div className="max-w-[1600px] mx-auto px-6 pb-6">
        {adminView === 'stats' && (
          loading && stats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <LogoSpinner size={24} />
              <p className="text-sm text-gray-500">Loading account data...</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="sticky left-0 z-[5] bg-gray-50 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-600 min-w-[200px]">
                      Account
                    </th>
                    {COLUMNS.map(col => (
                      <th key={col.key} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-gray-600 text-right whitespace-nowrap">
                        <span className="flex items-center justify-end gap-1.5">
                          {col.icon} {col.label}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-200 bg-blue-50">
                    <td className="sticky left-0 z-[5] bg-blue-50 px-5 py-3">
                      <span className="text-sm font-semibold text-blue-700">ALL TOTALS</span>
                    </td>
                    {COLUMNS.map(col => (
                      <td key={col.key} className="px-4 py-3 text-right">
                        <span className="text-sm font-semibold text-blue-700 tabular-nums">
                          {(totals[col.key] ?? 0).toLocaleString()}
                        </span>
                      </td>
                    ))}
                  </tr>

                  {filteredStats.length === 0 && (
                    <tr>
                      <td colSpan={COLUMNS.length + 1} className="px-5 py-12 text-center text-gray-500 text-sm">
                        {searchQuery ? 'No accounts match your search.' : 'No data available.'}
                      </td>
                    </tr>
                  )}

                  {filteredStats.map((account, idx) => (
                    <tr
                      key={account.id}
                      className={`border-b border-gray-200 hover:bg-gray-50 transition-colors ${
                        idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'
                      }`}
                    >
                      <td className={`sticky left-0 z-[5] px-5 py-3 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}>
                        <div>
                          <p className="text-sm font-medium text-gray-900 truncate max-w-[180px]">
                            {account.name || 'Unnamed'}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-gray-500">
                              {new Date(account.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </span>
                            {account.is_trial && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                                TRIAL
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      {COLUMNS.map(col => {
                        const val = (account[col.key] as number) || 0;
                        return (
                          <td key={col.key} className="px-4 py-3 text-right">
                            <span className={`text-sm tabular-nums font-medium ${val > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                              {val.toLocaleString()}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {adminView === 'hotlist' && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Hotlist AI Roles</p>
              <p className="text-[11px] text-gray-500">Editable table for hotlist_ai_roles with avatar upload.</p>
            </div>
            <button
              onClick={() => void fetchHotlistRoles()}
              disabled={rolesLoading}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCcw size={11} className={rolesLoading ? 'animate-spin' : ''} /> Reload Roles
            </button>
          </div>

          <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">Add New Role</p>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
              <input
                value={newRoleTargetRole}
                onChange={(e) => setNewRoleTargetRole(e.target.value)}
                placeholder="Target role"
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500 md:col-span-2"
              />
              <select
                value={newRoleCategory}
                onChange={(e) => setNewRoleCategory(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
              >
                {ROLE_CATEGORY_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <select
                value={newRoleSchedule}
                onChange={(e) => setNewRoleSchedule(e.target.value as HotlistRoleRow['schedule_frequency'])}
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
              >
                {ROLE_SCHEDULE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              <input
                value={newRoleMinYearsExp}
                onChange={(e) => setNewRoleMinYearsExp(e.target.value)}
                placeholder="Min Yrs"
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
              />
              <input
                value={newRoleMaxYearsExp}
                onChange={(e) => setNewRoleMaxYearsExp(e.target.value)}
                placeholder="Max Yrs"
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
              />
              <input
                value={newRoleVisaStatus}
                onChange={(e) => setNewRoleVisaStatus(e.target.value)}
                placeholder="Visa"
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
              />
              <input
                value={newRoleEmploymentType}
                onChange={(e) => setNewRoleEmploymentType(e.target.value)}
                placeholder="Employment"
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
              />
              <input
                value={newRoleWorkType}
                onChange={(e) => setNewRoleWorkType(e.target.value)}
                placeholder="Work type"
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
              />
              <input
                value={newRolePreferredLocations}
                onChange={(e) => setNewRolePreferredLocations(e.target.value)}
                placeholder="Locations"
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500 md:col-span-2"
              />
              <input
                value={newRoleMinRate}
                onChange={(e) => setNewRoleMinRate(e.target.value)}
                placeholder="Rate min"
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
              />
              <input
                value={newRoleMaxRate}
                onChange={(e) => setNewRoleMaxRate(e.target.value)}
                placeholder="Rate max"
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500"
              />
              <input
                value={newRoleAvatarUrl}
                onChange={(e) => setNewRoleAvatarUrl(e.target.value)}
                placeholder="Avatar URL"
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500 md:col-span-2"
              />
              <textarea
                value={newRolePrioritySkills}
                onChange={(e) => setNewRolePrioritySkills(e.target.value)}
                placeholder="Priority skills"
                rows={2}
                className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-blue-500 md:col-span-2"
              />
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={newRoleIsActive}
                    onChange={(e) => setNewRoleIsActive(e.target.checked)}
                  />
                  Active
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    checked={newRoleRelocationOpen}
                    onChange={(e) => setNewRoleRelocationOpen(e.target.checked)}
                  />
                  Relocation
                </label>
                <button
                  onClick={() => void createRole()}
                  disabled={newRoleSaving}
                  className="inline-flex items-center gap-1 rounded-md border border-blue-600 bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {newRoleSaving ? <LogoSpinner size={12} /> : <Plus size={11} />}
                  Add Role
                </button>
              </div>
            </div>
          </div>

          {rolesError && (
            <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
              {rolesError}
            </div>
          )}

          {rolesLoading && roles.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <LogoSpinner size={18} />
            </div>
          ) : (
            <table className="w-full min-w-[1700px] text-left">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-600">
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Years</th>
                  <th className="px-3 py-2">Visa</th>
                  <th className="px-3 py-2">Employment</th>
                  <th className="px-3 py-2">Work Type</th>
                  <th className="px-3 py-2">Locations</th>
                  <th className="px-3 py-2">Rate Min</th>
                  <th className="px-3 py-2">Rate Max</th>
                  <th className="px-3 py-2">Skills</th>
                  <th className="px-3 py-2">Relocation</th>
                  <th className="px-3 py-2">Schedule</th>
                  <th className="px-3 py-2">Active</th>
                  <th className="px-3 py-2">Avatar</th>
                  <th className="px-3 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id} className="border-b border-gray-200 align-top text-xs text-gray-800 hover:bg-gray-50">
                    <td className="px-3 py-2 min-w-[220px]">
                      <span className="font-medium text-gray-900">{role.target_role || '-'}</span>
                    </td>
                    <td className="px-3 py-2 min-w-[130px]">
                      <span className="rounded bg-gray-100 px-2 py-1 text-[11px] text-gray-700">{role.category || 'all'}</span>
                    </td>
                    <td className="px-3 py-2 min-w-[80px]">
                      <span>{(role.min_years_exp != null && role.max_years_exp != null) ? `${role.min_years_exp}-${role.max_years_exp}` : role.years_exp ?? '-'}</span>
                    </td>
                    <td className="px-3 py-2 min-w-[120px]">
                      <span>{role.visa_status || '-'}</span>
                    </td>
                    <td className="px-3 py-2 min-w-[120px]">
                      <span>{role.employment_type || '-'}</span>
                    </td>
                    <td className="px-3 py-2 min-w-[110px]">
                      <span>{role.work_type || '-'}</span>
                    </td>
                    <td className="px-3 py-2 min-w-[180px]">
                      <span>{role.preferred_locations || '-'}</span>
                    </td>
                    <td className="px-3 py-2 min-w-[90px]">
                      <span>{role.min_rate_usd_per_hr != null ? `${role.min_rate_usd_per_hr}` : '-'}</span>
                    </td>
                    <td className="px-3 py-2 min-w-[90px]">
                      <span>{role.max_rate_usd_per_hr != null ? `${role.max_rate_usd_per_hr}` : '-'}</span>
                    </td>
                    <td className="px-3 py-2 min-w-[220px]">
                      <span>{role.priority_skills || '-'}</span>
                    </td>
                    <td className="px-3 py-2 min-w-[90px]">
                      <span>{role.relocation_open ? 'Yes' : 'No'}</span>
                    </td>
                    <td className="px-3 py-2 min-w-[110px]">
                      <span>{role.schedule_frequency}</span>
                    </td>
                    <td className="px-3 py-2 min-w-[90px]">
                      <span className={`rounded px-2 py-1 text-[11px] ${role.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {role.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-3 py-2 min-w-[220px]">
                      {role.avatar_url ? (
                        <img src={role.avatar_url} alt={role.target_role} className="h-8 w-8 rounded-full border border-gray-300 object-cover" />
                      ) : (
                        <div className="h-8 w-8 rounded-full border border-gray-300 bg-gray-100" />
                      )}
                    </td>
                    <td className="px-3 py-2 min-w-[140px] text-gray-500">
                      {new Date(role.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                  </tr>
                ))}

                {roles.length === 0 && !rolesLoading && (
                  <tr>
                    <td colSpan={15} className="px-4 py-8 text-center text-xs text-gray-500">No hotlist roles found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
