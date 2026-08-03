import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookmarkCheck, ChevronDown, ChevronUp, Pencil, RefreshCw, Save, Search, X } from 'lucide-react';
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

export default function WatchlistProfilesPage() {
  const { account } = useAuth();

  const [profiles, setProfiles] = useState<WatchlistProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<WatchlistProfile | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [form, setForm] = useState<WatchlistFormState>(EMPTY_FORM);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

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
      .eq('is_watching', true)
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
    if (!value) return profiles;
    return profiles.filter((item) => {
      const haystack = [
        item.target_role,
        item.category,
        item.priority_skills,
        item.preferred_locations,
        item.visa_status,
        item.employment_type,
        item.work_type,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(value);
    });
  }, [profiles, query]);

  const activeCount = useMemo(() => filteredProfiles.filter((item) => item.is_watching).length, [filteredProfiles]);
  const selectedProfile = useMemo(
    () => filteredProfiles.find((item) => item.id === selectedProfileId) ?? null,
    [filteredProfiles, selectedProfileId],
  );

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

      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm px-5 py-2.5 flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search profiles, skills, locations..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-full pl-8 pr-7 py-1.5 text-xs border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 focus:bg-white transition-all"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={12} />
            </button>
          )}
        </div>

        <span className="text-xs text-blue-600 font-medium bg-blue-50 px-2 py-1 rounded-lg">
          {activeCount} active / {filteredProfiles.length} profiles
        </span>

        <button
          type="button"
          onClick={() => void loadProfiles()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors text-gray-600 font-medium"
        >
          <RefreshCw size={12} className="text-gray-400" />
          Refresh
        </button>
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
                {filteredProfiles.map((profile) => {
                  const isSelected = profile.id === selectedProfileId;
                  const busy = savingId === profile.id;
                  return (
                    <div
                      key={profile.id}
                      onClick={() => { setSelectedProfileId(profile.id); setEditingProfile(null); }}
                      className={`px-3 py-2.5 cursor-pointer transition-colors ${isSelected ? 'bg-blue-100/60' : 'hover:bg-blue-50/30'}`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <p className="text-xs font-semibold text-gray-900 break-words whitespace-normal leading-snug">{profile.target_role}</p>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={(event) => { event.stopPropagation(); startEditing(profile); }}
                            className="p-0.5 rounded text-gray-400 hover:text-blue-600 transition-colors disabled:opacity-60"
                            title="Edit"
                          >
                            <Pencil size={10} />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={(event) => { event.stopPropagation(); void handleToggleWatch(profile); }}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                            title="Unwatch"
                          >
                            <BookmarkCheck size={10} /> Unwatch
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 text-[11px] text-gray-600">{profile.category || 'uncategorized'} • {profile.schedule_frequency}</div>
                      <div className="mt-0.5 text-[11px] text-gray-500 truncate">{profile.priority_skills || 'No skills added'}</div>
                      <div className="mt-1 text-[10px] text-gray-400">Updated {formatDateTime(profile.updated_at)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 bg-white flex flex-col overflow-hidden">
          <div className="shrink-0 h-[44px] flex items-center gap-2 px-3 border-b border-gray-200 bg-white">
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Profile Details</span>
            {selectedProfile && (
              <span className="ml-auto text-[10px] text-gray-500 truncate max-w-[220px]">{selectedProfile.target_role}</span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {!selectedProfile ? (
              <div className="py-16 text-center text-xs text-gray-400">Select a profile to view details.</div>
            ) : editingProfile?.id === selectedProfile.id ? (
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full border-collapse text-left text-[11px]">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="border-b border-gray-200 px-3 py-2 font-semibold uppercase tracking-wide text-gray-500 w-[220px]">Field</th>
                      <th className="border-b border-gray-200 px-3 py-2 font-semibold uppercase tracking-wide text-gray-500">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-700">Target Role</td>
                      <td className="border-b border-gray-100 px-3 py-2"><input value={form.target_role} onChange={(e) => setForm((prev) => ({ ...prev, target_role: e.target.value }))} className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200" /></td>
                    </tr>
                    <tr>
                      <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-700">Category</td>
                      <td className="border-b border-gray-100 px-3 py-2"><input value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))} className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200" /></td>
                    </tr>
                    <tr>
                      <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-700">Priority Skills</td>
                      <td className="border-b border-gray-100 px-3 py-2"><textarea value={form.priority_skills} onChange={(e) => setForm((prev) => ({ ...prev, priority_skills: e.target.value }))} rows={2} className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200" /></td>
                    </tr>
                    <tr>
                      <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-700">Preferred Locations</td>
                      <td className="border-b border-gray-100 px-3 py-2"><input value={form.preferred_locations} onChange={(e) => setForm((prev) => ({ ...prev, preferred_locations: e.target.value }))} className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200" /></td>
                    </tr>
                    <tr>
                      <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-700">Visa Status</td>
                      <td className="border-b border-gray-100 px-3 py-2"><input value={form.visa_status} onChange={(e) => setForm((prev) => ({ ...prev, visa_status: e.target.value }))} className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200" /></td>
                    </tr>
                    <tr>
                      <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-700">Employment Type</td>
                      <td className="border-b border-gray-100 px-3 py-2"><input value={form.employment_type} onChange={(e) => setForm((prev) => ({ ...prev, employment_type: e.target.value }))} className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200" /></td>
                    </tr>
                    <tr>
                      <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-700">Work Type</td>
                      <td className="border-b border-gray-100 px-3 py-2"><input value={form.work_type} onChange={(e) => setForm((prev) => ({ ...prev, work_type: e.target.value }))} className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200" /></td>
                    </tr>
                    <tr>
                      <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-700">Experience (Min / Max)</td>
                      <td className="border-b border-gray-100 px-3 py-2">
                        <div className="grid grid-cols-2 gap-2">
                          <input value={form.min_years_exp} onChange={(e) => setForm((prev) => ({ ...prev, min_years_exp: e.target.value }))} className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200" />
                          <input value={form.max_years_exp} onChange={(e) => setForm((prev) => ({ ...prev, max_years_exp: e.target.value }))} className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200" />
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-700">Rate (Min / Max)</td>
                      <td className="border-b border-gray-100 px-3 py-2">
                        <div className="grid grid-cols-2 gap-2">
                          <input value={form.min_rate_usd_per_hr} onChange={(e) => setForm((prev) => ({ ...prev, min_rate_usd_per_hr: e.target.value }))} className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200" />
                          <input value={form.max_rate_usd_per_hr} onChange={(e) => setForm((prev) => ({ ...prev, max_rate_usd_per_hr: e.target.value }))} className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200" />
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-700">Schedule</td>
                      <td className="border-b border-gray-100 px-3 py-2">
                        <select value={form.schedule_frequency} onChange={(e) => setForm((prev) => ({ ...prev, schedule_frequency: e.target.value as WatchlistProfile['schedule_frequency'] }))} className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200">
                          <option value="disabled">disabled</option>
                          <option value="hourly">hourly</option>
                          <option value="daily">daily</option>
                          <option value="twice_daily">twice_daily</option>
                          <option value="weekly">weekly</option>
                        </select>
                      </td>
                    </tr>
                    <tr>
                      <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-700">Notes</td>
                      <td className="border-b border-gray-100 px-3 py-2"><textarea value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} rows={2} className="w-full rounded border border-gray-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-200" /></td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 font-semibold text-gray-700">Open To Relocation</td>
                      <td className="px-3 py-2">
                        <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                          <input type="checkbox" checked={form.relocation_open} onChange={(e) => setForm((prev) => ({ ...prev, relocation_open: e.target.checked }))} className="h-3.5 w-3.5 rounded border-gray-300" />
                          Enabled
                        </label>
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-gray-200 p-3 bg-gray-50">
                  <button type="button" onClick={closeEditor} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-white">
                    <X size={12} /> Cancel
                  </button>
                  <button type="button" onClick={() => void handleSave()} disabled={savingId === editingProfile.id} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                    <Save size={12} /> Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 overflow-hidden">
                {(() => {
                  const detailRows = [
                    ['Target Role', selectedProfile.target_role],
                    ['Category', selectedProfile.category || '-'],
                    ['Priority Skills', selectedProfile.priority_skills || '-'],
                    ['Preferred Locations', selectedProfile.preferred_locations || '-'],
                    ['Visa Status', selectedProfile.visa_status || '-'],
                    ['Employment Type', selectedProfile.employment_type || '-'],
                    ['Work Type', selectedProfile.work_type || '-'],
                    ['Experience', `${selectedProfile.min_years_exp ?? '-'} / ${selectedProfile.max_years_exp ?? '-'}`],
                    ['Rate (USD/hr)', `${selectedProfile.min_rate_usd_per_hr ?? '-'} / ${selectedProfile.max_rate_usd_per_hr ?? '-'}`],
                    ['Schedule', selectedProfile.schedule_frequency],
                    ['Relocation', selectedProfile.relocation_open ? 'Yes' : 'No'],
                    ['Notes', selectedProfile.notes || '-'],
                    ['Created', formatDateTime(selectedProfile.created_at)],
                    ['Updated', formatDateTime(selectedProfile.updated_at)],
                  ] as Array<[string, string]>;

                  const visibleRows = detailsExpanded ? detailRows : detailRows.slice(0, 2);

                  return (
                    <>
                <table className="w-full border-collapse text-left text-[11px]">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="border-b border-gray-200 px-3 py-2 font-semibold uppercase tracking-wide text-gray-500 w-[220px]">Field</th>
                      <th className="border-b border-gray-200 px-3 py-2 font-semibold uppercase tracking-wide text-gray-500">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map(([label, value], index) => {
                      const isLastVisible = index === visibleRows.length - 1;
                      return (
                        <tr key={label}>
                          <td className={`${isLastVisible ? '' : 'border-b border-gray-100'} px-3 py-2 font-semibold text-gray-700`}>{label}</td>
                          <td className={`${isLastVisible ? '' : 'border-b border-gray-100'} px-3 py-2 text-gray-700`}>{value}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {detailRows.length > 2 && (
                  <div className="border-t border-gray-200 px-3 py-2 bg-white">
                    <button
                      type="button"
                      onClick={() => setDetailsExpanded((prev) => !prev)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700"
                    >
                      {detailsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {detailsExpanded ? 'Collapse Details' : 'Expand Details'}
                    </button>
                  </div>
                )}

                <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-gray-200 p-3 bg-gray-50">
                  <button type="button" onClick={() => startEditing(selectedProfile)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-white">
                    <Pencil size={12} /> Edit
                  </button>
                  <button type="button" onClick={() => void handleToggleWatch(selectedProfile)} disabled={savingId === selectedProfile.id} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-60">
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
