import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookmarkCheck, Check, Clock3, ChevronDown, ChevronUp, Pencil, Save, Search, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import LogoSpinner from '../components/LogoSpinner';
import Toast from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

type WatchlistProfile = {
  id: string;
  account_id: string;
  source_hotlist_role_id: string | null;
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
  relocation_open: boolean;
  priority_skills: string | null;
  avatar_url: string | null;
  schedule_frequency: 'disabled' | 'hourly' | 'daily' | 'twice_daily' | 'weekly';
  is_watching: boolean;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type WatchlistFormState = {
  target_role: string;
  category: string;
  min_years_exp: string;
  max_years_exp: string;
  visa_status: string;
  employment_type: string;
  work_type: string;
  preferred_locations: string;
  min_rate_usd_per_hr: string;
  max_rate_usd_per_hr: string;
  relocation_open: boolean;
  priority_skills: string;
  schedule_frequency: WatchlistProfile['schedule_frequency'];
  notes: string;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function toFormState(profile: WatchlistProfile): WatchlistFormState {
  return {
    target_role: profile.target_role,
    category: profile.category ?? '',
    min_years_exp: profile.min_years_exp == null ? '' : String(profile.min_years_exp),
    max_years_exp: profile.max_years_exp == null ? '' : String(profile.max_years_exp),
    visa_status: profile.visa_status ?? '',
    employment_type: profile.employment_type ?? '',
    work_type: profile.work_type ?? '',
    preferred_locations: profile.preferred_locations ?? '',
    min_rate_usd_per_hr: profile.min_rate_usd_per_hr == null ? '' : String(profile.min_rate_usd_per_hr),
    max_rate_usd_per_hr: profile.max_rate_usd_per_hr == null ? '' : String(profile.max_rate_usd_per_hr),
    relocation_open: Boolean(profile.relocation_open),
    priority_skills: profile.priority_skills ?? '',
    schedule_frequency: profile.schedule_frequency,
    notes: profile.notes ?? '',
  };
}

const EMPTY_FORM: WatchlistFormState = {
  target_role: '',
  category: '',
  min_years_exp: '',
  max_years_exp: '',
  visa_status: '',
  employment_type: '',
  work_type: '',
  preferred_locations: '',
  min_rate_usd_per_hr: '',
  max_rate_usd_per_hr: '',
  relocation_open: false,
  priority_skills: '',
  schedule_frequency: 'hourly',
  notes: '',
};

type SelectOption = { value: string; label: string };

const VISA_OPTIONS: SelectOption[] = [
  { value: 'US Citizen', label: 'US Citizen' },
  { value: 'Green Card', label: 'Green Card' },
  { value: 'H1B', label: 'H1B' },
  { value: 'H4 EAD', label: 'H4 EAD' },
  { value: 'OPT/CPT', label: 'OPT/CPT' },
  { value: 'TN', label: 'TN' },
  { value: 'Other', label: 'Other' },
];

const EMPLOYMENT_OPTIONS: SelectOption[] = [
  { value: 'C2C', label: 'C2C' },
  { value: 'W2', label: 'W2' },
  { value: '1099', label: '1099' },
  { value: 'C2C or W2', label: 'C2C or W2' },
  { value: 'Any', label: 'Any' },
];

const WORK_OPTIONS: SelectOption[] = [
  { value: 'Remote', label: 'Remote' },
  { value: 'On-site', label: 'On-site' },
  { value: 'Hybrid', label: 'Hybrid' },
  { value: 'Any', label: 'Any' },
];

function renderSelectOptions(options: SelectOption[], currentValue?: string) {
  const normalized = currentValue?.trim();
  const merged = normalized && !options.some((option) => option.value === normalized)
    ? [...options, { value: normalized, label: normalized }]
    : options;
  return merged.map((option) => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ));
}

type WatchlistRangeOption = {
  id: '24h' | '3d' | '7d' | '15d' | '30d';
  label: string;
  hours: number;
};

const WATCHLIST_RANGE_OPTIONS: WatchlistRangeOption[] = [
  { id: '24h', label: 'Last 24 hours', hours: 24 },
  { id: '3d', label: 'Last 3 days', hours: 72 },
  { id: '7d', label: 'Last 7 days', hours: 168 },
  { id: '15d', label: 'Last 15 days', hours: 360 },
  { id: '30d', label: 'Last 30 days', hours: 720 },
];

const WATCHLIST_RANGE_SHORT_LABELS: Record<WatchlistRangeOption['id'], string> = {
  '24h': '24h',
  '3d': '3d',
  '7d': '7d',
  '15d': '15d',
  '30d': '30d',
};

export default function WatchlistProfilesPage() {
  const { account } = useAuth();

  const [profiles, setProfiles] = useState<WatchlistProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [pendingQuery, setPendingQuery] = useState('');
  const [query, setQuery] = useState('');
  const [rangeId, setRangeId] = useState<WatchlistRangeOption['id']>('7d');
  const [isRangeMenuOpen, setIsRangeMenuOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<WatchlistProfile | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [form, setForm] = useState<WatchlistFormState>(EMPTY_FORM);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const rangeMenuRef = useRef<HTMLDivElement | null>(null);

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

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  const loadProfiles = useCallback(async () => {
    if (!account?.id) {
      setProfiles([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from('watchlist_profiles' as never)
      .select('*')
      .eq('account_id', account.id)
      .order('updated_at', { ascending: false });

    if (error) {
      showToast(error.message || 'Could not load watchlist profiles', 'error');
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as unknown as WatchlistProfile[];
    setProfiles(rows);
    if (rows.length === 0) {
      setSelectedProfileId(null);
      setEditingProfile(null);
      setForm(EMPTY_FORM);
    } else if (!rows.some((item) => item.id === selectedProfileId)) {
      setSelectedProfileId(rows[0].id);
    }
    setLoading(false);
  }, [account?.id, selectedProfileId, showToast]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const filteredProfiles = useMemo(() => {
    const value = query.trim().toLowerCase();
    const hours = WATCHLIST_RANGE_OPTIONS.find((option) => option.id === rangeId)?.hours ?? 168;
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    return profiles.filter((item) => {
      const updatedTs = new Date(item.updated_at).getTime();
      if (Number.isFinite(updatedTs) && updatedTs < cutoff) return false;
      if (!value) return true;

      const roleName = (item.target_role ?? '').toLowerCase();
      return roleName.includes(value);
    });
  }, [profiles, query, rangeId]);

  const activeCount = useMemo(() => filteredProfiles.filter((item) => item.is_watching).length, [filteredProfiles]);
  const selectedProfile = useMemo(
    () => filteredProfiles.find((item) => item.id === selectedProfileId) ?? null,
    [filteredProfiles, selectedProfileId],
  );

  const sortedProfiles = useMemo(() => {
    return [...filteredProfiles].sort((a, b) => Number(b.is_watching) - Number(a.is_watching) || b.updated_at.localeCompare(a.updated_at));
  }, [filteredProfiles]);

  useEffect(() => {
    if (filteredProfiles.length === 0) {
      setSelectedProfileId(null);
      setEditingProfile(null);
      return;
    }

    if (!selectedProfileId || !filteredProfiles.some((item) => item.id === selectedProfileId)) {
      setSelectedProfileId(filteredProfiles[0].id);
      setEditingProfile(null);
    }
  }, [filteredProfiles, selectedProfileId]);

  useEffect(() => {
    setDetailsExpanded(false);
  }, [selectedProfileId]);

  function startEditing(profile: WatchlistProfile) {
    setSelectedProfileId(profile.id);
    setEditingProfile(profile);
    setForm(toFormState(profile));
  }

  function closeEditor() {
    setEditingProfile(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave() {
    if (!editingProfile || !account?.id) return;

    const targetRole = form.target_role.trim();
    if (!targetRole) {
      showToast('Target role is required', 'error');
      return;
    }

    setSavingId(editingProfile.id);

    const payload = {
      target_role: targetRole,
      category: form.category.trim() || null,
      min_years_exp: form.min_years_exp.trim() ? Number(form.min_years_exp) : null,
      max_years_exp: form.max_years_exp.trim() ? Number(form.max_years_exp) : null,
      visa_status: form.visa_status.trim() || null,
      employment_type: form.employment_type.trim() || null,
      work_type: form.work_type.trim() || null,
      preferred_locations: form.preferred_locations.trim() || null,
      min_rate_usd_per_hr: form.min_rate_usd_per_hr.trim() ? Number(form.min_rate_usd_per_hr) : null,
      max_rate_usd_per_hr: form.max_rate_usd_per_hr.trim() ? Number(form.max_rate_usd_per_hr) : null,
      relocation_open: form.relocation_open,
      priority_skills: form.priority_skills.trim() || null,
      schedule_frequency: form.schedule_frequency,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('watchlist_profiles' as never)
      .update(payload as never)
      .eq('id', editingProfile.id)
      .eq('account_id', account.id);

    if (error) {
      showToast(error.message || 'Could not save profile', 'error');
      setSavingId(null);
      return;
    }

    showToast('Watchlist profile updated');
    await loadProfiles();
    setSavingId(null);
    closeEditor();
  }

  async function handleToggleWatch(profile: WatchlistProfile) {
    if (!account?.id) return;

    setSavingId(profile.id);

    const nextWatching = !profile.is_watching;
    const payload = {
      is_watching: nextWatching,
      last_unwatched_at: nextWatching ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('watchlist_profiles' as never)
      .update(payload as never)
      .eq('id', profile.id)
      .eq('account_id', account.id);

    if (error) {
      showToast(error.message || 'Could not update watch state', 'error');
      setSavingId(null);
      return;
    }

    showToast(nextWatching ? 'Profile moved to active watchlist' : 'Profile unwatched');
    await loadProfiles();
    setSavingId(null);
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-gray-50 overflow-hidden overscroll-none pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0">
      <AppNav />

      <div className="sticky top-0 z-20 border-b border-gray-200 dark:border-white/10 bg-white dark:bg-[#1F2328] px-2 py-2 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-1.5 rounded-full border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#171a1f] px-3 py-1.5">
          <Search size={11} className="text-gray-400" />
          <input
            type="text"
            placeholder="Search role name..."
            value={pendingQuery}
            onChange={(event) => setPendingQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                setQuery(pendingQuery.trim());
              }
            }}
            className="w-full border-0 bg-transparent text-[11px] text-gray-700 dark:text-slate-200 outline-none placeholder:text-gray-400 dark:placeholder:text-slate-500"
          />
          {pendingQuery && (
            <button
              onClick={() => {
                setPendingQuery('');
                setQuery('');
              }}
              className="rounded-full p-0.5 text-gray-400 dark:text-slate-500 transition hover:text-gray-600 dark:hover:text-slate-300"
            >
              <X size={11} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setQuery(pendingQuery.trim())}
          className="rounded-full border border-blue-600 dark:border-white/15 bg-transparent p-1.5 text-blue-600 dark:text-slate-200 transition hover:text-blue-700 dark:hover:text-slate-100"
          aria-label="Search"
        >
          <Search size={12} />
        </button>

        <div ref={rangeMenuRef} className="relative shrink-0">
          <button
            onClick={() => setIsRangeMenuOpen((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-white/10 bg-transparent px-2 py-1.5 text-[10px] font-semibold text-gray-600 dark:text-[#94A3B8] transition hover:text-gray-700 dark:hover:text-slate-200"
            aria-label="Change date range"
          >
            <Clock3 size={11} />
            <span>{WATCHLIST_RANGE_SHORT_LABELS[rangeId]}</span>
          </button>

          {isRangeMenuOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[116px] overflow-hidden rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1F2328] p-1 shadow-lg">
              {WATCHLIST_RANGE_OPTIONS.map((option) => {
                const isActive = option.id === rangeId;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      setRangeId(option.id);
                      setIsRangeMenuOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[10px] font-semibold transition ${isActive ? 'text-blue-700 dark:text-slate-100' : 'text-gray-600 dark:text-[#94A3B8] hover:text-gray-700 dark:hover:text-slate-200'}`}
                  >
                    <span>{option.label}</span>
                    {isActive ? <Check size={11} /> : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-1.5 text-[10px] font-semibold text-blue-700">
          <BookmarkCheck size={11} />
          <span>{activeCount}/{filteredProfiles.length}</span>
        </span>
      </div>

      <div className="flex-1 grid grid-cols-[minmax(0,40%)_minmax(0,60%)] gap-0 overflow-hidden">
        <div className="min-w-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="shrink-0 h-[44px] flex items-center gap-2 px-3 border-b border-gray-200 bg-white">
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Profiles</span>
            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded ring-1 ring-amber-200">{filteredProfiles.length}</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <LogoSpinner size={20} />
              </div>
            ) : filteredProfiles.length === 0 ? (
              <div className="py-16 text-center text-xs text-gray-400">No watchlist profiles found.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {sortedProfiles.map((profile) => {
                  const isSelected = profile.id === selectedProfileId;
                  const busy = savingId === profile.id;
                  return (
                    <div
                      key={profile.id}
                      onClick={() => { setSelectedProfileId(profile.id); setEditingProfile(null); }}
                      className={`px-3 py-2.5 cursor-pointer transition-colors ${isSelected ? 'bg-blue-100/60 dark:bg-[#252a30]' : 'hover:bg-blue-50/30 dark:hover:bg-[#20242a]'}`}
                    >
                      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-1.5">
                        <p className="text-[11px] font-semibold text-gray-900 break-words whitespace-normal leading-snug">
                          {profile.target_role}
                        </p>
                        <div className="flex flex-wrap items-center gap-1 shrink-0">
                          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold ${profile.is_watching ? 'border border-emerald-200 dark:border-emerald-500/35 bg-transparent text-emerald-700 dark:text-emerald-300' : 'border border-gray-200 dark:border-white/10 bg-transparent text-gray-500 dark:text-[#94A3B8]'}`} title="Watching status">
                            <BookmarkCheck size={10} /> {profile.is_watching ? 'Watching' : 'Not Watching'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 bg-white flex flex-col overflow-hidden">
          <div className="shrink-0 h-[44px] flex items-center gap-2 px-3 border-b border-gray-200 bg-white">
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Details</span>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {!selectedProfile ? (
              <div className="py-16 text-center text-xs text-gray-400">Select a profile to view details.</div>
            ) : editingProfile?.id === selectedProfile.id ? (
              <div className="rounded-lg border border-gray-200 overflow-hidden bg-white">
                <div className="grid gap-3 p-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Target Role</label>
                    <input
                      value={form.target_role}
                      onChange={(event) => setForm((prev) => ({ ...prev, target_role: event.target.value }))}
                      className="mt-2 w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Visa Status</label>
                    <select
                      value={form.visa_status}
                      onChange={(event) => setForm((prev) => ({ ...prev, visa_status: event.target.value }))}
                      className="mt-2 w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      <option value="">Select visa status</option>
                      {renderSelectOptions(VISA_OPTIONS, form.visa_status)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Employment Type</label>
                    <select
                      value={form.employment_type}
                      onChange={(event) => setForm((prev) => ({ ...prev, employment_type: event.target.value }))}
                      className="mt-2 w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      <option value="">Select employment type</option>
                      {renderSelectOptions(EMPLOYMENT_OPTIONS, form.employment_type)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Work Type</label>
                    <select
                      value={form.work_type}
                      onChange={(event) => setForm((prev) => ({ ...prev, work_type: event.target.value }))}
                      className="mt-2 w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      <option value="">Select work type</option>
                      {renderSelectOptions(WORK_OPTIONS, form.work_type)}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Open To Relocation</label>
                    <label className="mt-2 inline-flex items-center gap-2 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={form.relocation_open}
                        onChange={(event) => setForm((prev) => ({ ...prev, relocation_open: event.target.checked }))}
                        className="h-3.5 w-3.5 rounded border-gray-300"
                      />
                      Enabled
                    </label>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Experience Min</label>
                    <input
                      value={form.min_years_exp}
                      onChange={(event) => setForm((prev) => ({ ...prev, min_years_exp: event.target.value }))}
                      className="mt-2 w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Experience Max</label>
                    <input
                      value={form.max_years_exp}
                      onChange={(event) => setForm((prev) => ({ ...prev, max_years_exp: event.target.value }))}
                      className="mt-2 w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Rate Min</label>
                    <input
                      value={form.min_rate_usd_per_hr}
                      onChange={(event) => setForm((prev) => ({ ...prev, min_rate_usd_per_hr: event.target.value }))}
                      className="mt-2 w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Rate Max</label>
                    <input
                      value={form.max_rate_usd_per_hr}
                      onChange={(event) => setForm((prev) => ({ ...prev, max_rate_usd_per_hr: event.target.value }))}
                      className="mt-2 w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Preferred Locations</label>
                    <input
                      value={form.preferred_locations}
                      onChange={(event) => setForm((prev) => ({ ...prev, preferred_locations: event.target.value }))}
                      className="mt-2 w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Priority Skills</label>
                    <textarea
                      value={form.priority_skills}
                      onChange={(event) => setForm((prev) => ({ ...prev, priority_skills: event.target.value }))}
                      rows={2}
                      className="mt-2 w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">Notes</label>
                    <textarea
                      value={form.notes}
                      onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                      rows={3}
                      className="mt-2 w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>
                </div>

                <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-gray-200 p-3 bg-gray-50">
                  <button type="button" onClick={closeEditor} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:text-gray-900">
                    <X size={12} /> Cancel
                  </button>
                  <button type="button" onClick={() => void handleSave()} disabled={savingId === editingProfile.id} className="inline-flex items-center gap-1 rounded-lg border border-blue-600 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 disabled:opacity-60">
                    <Save size={12} /> Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                {(() => {
                  const detailRows = [
                    ['Role', selectedProfile.target_role],
                    ['Exp', `${selectedProfile.min_years_exp ?? '-'} / ${selectedProfile.max_years_exp ?? '-'}`],
                    ['Rate ($)', `${selectedProfile.min_rate_usd_per_hr ?? '-'} / ${selectedProfile.max_rate_usd_per_hr ?? '-'}`],
                    ['Visa', selectedProfile.visa_status || '-'],
                    ['Locations', selectedProfile.preferred_locations || '-'],
                    ['Emp Type', selectedProfile.employment_type || '-'],
                    ['Work Type', selectedProfile.work_type || '-'],
                    ['Skills', selectedProfile.priority_skills || '-'],
                  ] as Array<[string, string]>;

                  const visibleRows = detailRows;

                  return (
                    <>
                <table className="w-full table-fixed border-collapse text-left text-[11px]">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="w-[96px] sm:w-[132px] border-b border-gray-200 px-3 py-2 font-semibold uppercase tracking-wide text-gray-500">Field</th>
                      <th className="border-b border-gray-200 px-3 py-2 font-semibold uppercase tracking-wide text-gray-500">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map(([label, value], index) => {
                      const isLastVisible = index === visibleRows.length - 1;
                      return (
                        <tr key={label}>
                          <td className={`${isLastVisible ? '' : 'border-b border-gray-100'} px-3 py-2 font-semibold align-top text-gray-700 break-words whitespace-normal`}>{label}</td>
                          <td className={`${isLastVisible ? '' : 'border-b border-gray-100'} px-3 py-2 align-top text-gray-700 break-words whitespace-normal`}>{value}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-gray-200 p-3 bg-gray-50">
                  <button type="button" onClick={() => startEditing(selectedProfile)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-white/10 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-slate-200 hover:text-gray-900 dark:hover:text-slate-100">
                    <Pencil size={12} /> Edit
                  </button>
                  <button type="button" onClick={() => void handleToggleWatch(selectedProfile)} disabled={savingId === selectedProfile.id} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 dark:border-amber-500/35 px-3 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:text-amber-800 dark:hover:text-amber-200 disabled:opacity-60">
                    <BookmarkCheck size={12} /> Unwatch
                  </button>
                </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && (
        <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
