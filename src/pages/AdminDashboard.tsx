import { useState, useMemo, useRef, useEffect } from 'react';
import { Lock, RefreshCcw, TrendingUp, Users, Briefcase, FileText, Zap, Search, Building2, UserCheck, Star, Database, Calendar, ChevronDown, X } from 'lucide-react';
import LogoSpinner from '../components/LogoSpinner';

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
    await fetchStats();
  }

  // Re-fetch when date range changes (if already authed)
  useEffect(() => {
    if (authed && datePreset !== 'custom') {
      fetchStats();
    }
  }, [datePreset]);

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
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <form
          onSubmit={login}
          className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl"
        >
          <div className="flex flex-col items-center gap-4 mb-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg">
              <Lock size={24} className="text-white" />
            </div>
            <div className="text-center">
              <h1 className="text-xl font-bold text-white">Admin Dashboard</h1>
              <p className="text-sm text-gray-400 mt-1">ProfilePush.ai</p>
            </div>
          </div>

          <div className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter admin password"
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder:text-gray-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              autoFocus
            />
            {error && (
              <p className="text-sm text-red-400 text-center">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !password}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
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
    <div className="min-h-screen bg-gray-950 text-white font-sans">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-950/90 backdrop-blur-md border-b border-gray-800">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg">
              <TrendingUp size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-white">ProfilePush Admin</h1>
              <p className="text-[11px] text-gray-500">{filteredStats.length} of {stats.length} accounts</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCcw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button
              onClick={() => { sessionStorage.removeItem('admin_authed'); setAuthed(false); setStats([]); }}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="max-w-[1600px] mx-auto px-6 py-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search accounts..."
              className="w-full pl-9 pr-8 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white placeholder:text-gray-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Date Range Dropdown */}
          <div className="relative" ref={dateDropdownRef}>
            <button
              onClick={() => setShowDateDropdown(!showDateDropdown)}
              className="flex items-center gap-2 px-4 py-2.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 hover:border-gray-700 transition-colors"
            >
              <Calendar size={14} className="text-gray-500" />
              <span>{currentPresetLabel}</span>
              {datePreset === 'custom' && (customStart || customEnd) && (
                <span className="text-[10px] text-blue-400 ml-1">
                  {customStart && new Date(customStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {customStart && customEnd && ' - '}
                  {customEnd && new Date(customEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
              <ChevronDown size={12} className="text-gray-500" />
            </button>

            {showDateDropdown && (
              <div className="absolute top-full mt-2 right-0 w-72 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl z-20 overflow-hidden">
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
                          ? 'bg-blue-600/20 text-blue-400 font-medium'
                          : 'text-gray-300 hover:bg-gray-800'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Custom date inputs */}
                {datePreset === 'custom' && (
                  <div className="border-t border-gray-800 p-3 space-y-3">
                    <div>
                      <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">Start Date</label>
                      <input
                        type="date"
                        value={customStart}
                        onChange={e => setCustomStart(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white outline-none focus:border-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">End Date</label>
                      <input
                        type="date"
                        value={customEnd}
                        onChange={e => setCustomEnd(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white outline-none focus:border-blue-500"
                      />
                    </div>
                    <button
                      onClick={applyCustomRange}
                      disabled={!customStart && !customEnd}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold rounded-lg transition-colors"
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

      {/* Stats Table */}
      <div className="max-w-[1600px] mx-auto px-6 pb-6">
        {loading && stats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <LogoSpinner size={24} />
            <p className="text-sm text-gray-500">Loading account data...</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900/50">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="sticky left-0 z-[5] bg-gray-900 px-5 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-400 min-w-[200px]">
                    Account
                  </th>
                  {COLUMNS.map(col => (
                    <th key={col.key} className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-400 text-right whitespace-nowrap">
                      <span className="flex items-center justify-end gap-1.5">
                        {col.icon} {col.label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Totals row */}
                <tr className="border-b border-gray-700 bg-blue-950/30">
                  <td className="sticky left-0 z-[5] bg-blue-950/50 px-5 py-3">
                    <span className="text-sm font-bold text-blue-300">ALL TOTALS</span>
                  </td>
                  {COLUMNS.map(col => (
                    <td key={col.key} className="px-4 py-3 text-right">
                      <span className="text-sm font-bold text-blue-300 tabular-nums">
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
                    className={`border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors ${
                      idx % 2 === 0 ? 'bg-gray-900/30' : ''
                    }`}
                  >
                    <td className="sticky left-0 z-[5] bg-gray-900 px-5 py-3">
                      <div>
                        <p className="text-sm font-semibold text-white truncate max-w-[180px]">
                          {account.name || 'Unnamed'}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-gray-500">
                            {new Date(account.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                          {account.is_trial && (
                            <span className="text-[9px] font-bold bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded">
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
                          <span className={`text-sm tabular-nums font-medium ${val > 0 ? 'text-gray-200' : 'text-gray-600'}`}>
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
        )}
      </div>
    </div>
  );
}
