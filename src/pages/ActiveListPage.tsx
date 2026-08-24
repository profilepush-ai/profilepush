import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Clock3, Search, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import InsufficientCreditsModal from '../components/InsufficientCreditsModal';
import LocationChipInput from '../components/LocationChipInput';
import ActiveListTable, { type ActiveListContact } from '../components/ActiveListTable';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import { downloadCsv } from '../lib/csv';

const EMAIL_DOWNLOAD_COST = 0.25;
const PAGE_SIZE = 50;

type ActiveListResponse = {
  recruiters: ActiveListContact[];
  vendors: ActiveListContact[];
};

// Matches /jobs' PROFILE_RANGE_OPTIONS, default '3d' — same range picker,
// same default (/jobs itself defaults to 3 days, not 24h).
type RangeId = '24h' | '3d' | '7d' | '15d' | '30d';
const RANGE_OPTIONS: { id: RangeId; label: string; shortLabel: string; hours: number }[] = [
  { id: '24h', label: 'Last 24 hours', shortLabel: '24h', hours: 24 },
  { id: '3d', label: 'Last 3 days', shortLabel: '3d', hours: 72 },
  { id: '7d', label: 'Last 7 days', shortLabel: '7d', hours: 168 },
  { id: '15d', label: 'Last 15 days', shortLabel: '15d', hours: 360 },
  { id: '30d', label: 'Last 30 days', shortLabel: '30d', hours: 720 },
];

// Fixed numeric buckets, same as /jobs' EXPERIENCE_RANGE_OPTIONS — years is
// continuous data that needs binning either way.
const EXPERIENCE_RANGE_OPTIONS: { id: string; label: string; min: number; max: number | null }[] = [
  { id: '1-3', label: '1-3 yrs', min: 1, max: 3 },
  { id: '3-5', label: '3-5 yrs', min: 3, max: 5 },
  { id: '5-7', label: '5-7 yrs', min: 5, max: 7 },
  { id: '7-9', label: '7-9 yrs', min: 7, max: 9 },
  { id: '9-12', label: '9-12 yrs', min: 9, max: 12 },
  { id: '12-15', label: '12-15 yrs', min: 12, max: 15 },
  { id: '15+', label: '15+ yrs', min: 15, max: null },
];

function matchesExperienceRange(years: number, rangeId: string): boolean {
  const range = EXPERIENCE_RANGE_OPTIONS.find((r) => r.id === rangeId);
  if (!range) return false;
  return range.max == null ? years >= range.min : years >= range.min && years <= range.max;
}

// Same fixed option lists /jobs uses for these three categories
// (PulsePage.tsx's WORK_TYPE_OPTIONS/EMPLOYMENT_TYPE_OPTIONS/VISA_STATUS_OPTIONS,
// minus its 'all' placeholder entry — this page's filters are an array-based
// multi-select, so "nothing selected" already means "all").
const WORK_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'Onsite' },
];

const EMPLOYMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'c2c', label: 'C2C' },
  { value: 'w2', label: 'W2' },
  { value: '1099', label: '1099' },
  { value: 'part_time', label: 'Part-time' },
];

const VISA_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'usc', label: 'USC' },
  { value: 'gc', label: 'GC' },
  { value: 'h1b', label: 'H1B' },
  { value: 'ead', label: 'EAD' },
  { value: 'opt', label: 'OPT' },
  { value: 'cpt', label: 'CPT' },
  { value: 'tn', label: 'TN' },
];

// Checkbox facet categories — same set /jobs uses (Experience, Work Type,
// Employment Type, Visa). Deliberately no "Role" category here — role stays
// a free-text search in the top bar, same place /jobs puts its own role search.
type FacetCategory = 'experienceRange' | 'workType' | 'employmentType' | 'visaStatus';
const FACET_CATEGORIES: { category: FacetCategory; title: string }[] = [
  { category: 'experienceRange', title: 'Experience' },
  { category: 'workType', title: 'Work Type' },
  { category: 'employmentType', title: 'Employment Type' },
  { category: 'visaStatus', title: 'Visa' },
];
type FacetFilters = Record<FacetCategory, string[]>;
const DEFAULT_FACETS: FacetFilters = { experienceRange: [], workType: [], employmentType: [], visaStatus: [] };

// Raw work_type/employment_type/visa_type text is free-form, scraped from
// posts ("Full-time", "C2C/W2", "Not specified", "Onsite" typo'd into the
// employment field, etc.) — not the clean snake_case slugs the fixed option
// lists use. Comparing it directly (as an earlier version of this file did)
// silently failed to match even the dominant values, since e.g. "full-time"
// never equals "full_time". Mirrors /jobs' own getLeadFilterContext: bucket
// raw text into canonical slugs via substring matching instead of exact
// comparison. Unlike /jobs (one value per lead, first-match-wins), this
// returns every bucket a raw string matches — "C2C/W2" should count toward
// both the C2C and W2 checkboxes, not arbitrarily just one, since a contact
// here aggregates multiple posts and a checkbox filter is OR-semantics
// anyway.
function classifyEmploymentType(raw: string): string[] {
  const n = raw.toLowerCase().trim();
  const matches: string[] = [];
  if (n.includes('full')) matches.push('full_time');
  if (n.includes('contract')) matches.push('contract');
  if (n.includes('c2c')) matches.push('c2c');
  if (n.includes('w2')) matches.push('w2');
  if (n.includes('1099')) matches.push('1099');
  if (n.includes('part')) matches.push('part_time');
  return matches;
}

function classifyWorkType(raw: string): string[] {
  const n = raw.toLowerCase().trim();
  const matches: string[] = [];
  if (n.includes('remote')) matches.push('remote');
  if (n.includes('hybrid')) matches.push('hybrid');
  if (n.includes('onsite') || n.includes('on site') || n.includes('on-site')) matches.push('onsite');
  return matches;
}

function classifyVisaStatus(raw: string): string[] {
  const n = raw.toLowerCase().trim();
  const matches: string[] = [];
  if (n.includes('usc') || n.includes('us citizen')) matches.push('usc');
  if (n.includes('green card') || n === 'gc' || n.includes(' gc') || n.includes('gc ') || n.includes('gc,') || n.includes('gc/')) matches.push('gc');
  if (n.includes('h1b') || n.includes('h-1b')) matches.push('h1b');
  if (n.includes('ead')) matches.push('ead');
  if (n.includes('opt') && !n.includes('option')) matches.push('opt');
  if (n.includes('cpt')) matches.push('cpt');
  if (n.includes('tn')) matches.push('tn');
  return matches;
}

function getFacetValues(contact: ActiveListContact, category: FacetCategory): string[] {
  switch (category) {
    case 'experienceRange': return EXPERIENCE_RANGE_OPTIONS.filter((r) => contact.experience_years.some((y) => matchesExperienceRange(y, r.id))).map((r) => r.id);
    case 'workType': return contact.work_types.flatMap(classifyWorkType);
    case 'employmentType': return contact.employment_types.flatMap(classifyEmploymentType);
    case 'visaStatus': return contact.visa_types.flatMap(classifyVisaStatus);
  }
}

function contactMatchesCategory(contact: ActiveListContact, category: FacetCategory, selected: string[]): boolean {
  if (selected.length === 0) return true;
  const values = getFacetValues(contact, category).map((v) => v.trim().toLowerCase());
  return selected.some((s) => values.includes(s));
}

// Mirrors /jobs' matchesLeadFilters(lead, excludeCategory) — used to filter
// the visible table (no exclusion) and to compute each facet's own option
// counts against every OTHER active filter (excluding itself), so checking a
// box narrows the rest of the sidebar without hiding its own options.
function matchesAllFacets(contact: ActiveListContact, filters: FacetFilters, excludeCategory?: FacetCategory): boolean {
  return (Object.keys(filters) as FacetCategory[]).every((category) => (
    category === excludeCategory ? true : contactMatchesCategory(contact, category, filters[category])
  ));
}

type TextFilters = {
  roleQuery: string;
  locationValues: string[];
  skillsQuery: string;
  rateMode: 'all' | 'has_rate' | 'range';
  rateMin: string;
  rateMax: string;
};
const DEFAULT_TEXT_FILTERS: TextFilters = { roleQuery: '', locationValues: [], skillsQuery: '', rateMode: 'all', rateMin: '', rateMax: '' };

function matchesTextFilters(contact: ActiveListContact, filters: TextFilters): boolean {
  if (filters.roleQuery && !contact.role_titles.toLowerCase().includes(filters.roleQuery.toLowerCase())) return false;
  if (filters.locationValues.length > 0) {
    const haystack = contact.locations.join(' ').toLowerCase();
    if (!filters.locationValues.some((loc) => haystack.includes(loc.toLowerCase()))) return false;
  }
  if (filters.skillsQuery && !contact.skills.join(' ').toLowerCase().includes(filters.skillsQuery.toLowerCase())) return false;
  if (filters.rateMode === 'has_rate' && contact.hourly_rate_min.length === 0 && contact.hourly_rate_max.length === 0) return false;
  if (filters.rateMode === 'range') {
    const min = filters.rateMin.trim() ? Number(filters.rateMin) : -Infinity;
    const max = filters.rateMax.trim() ? Number(filters.rateMax) : Infinity;
    const rates = [...contact.hourly_rate_min, ...contact.hourly_rate_max];
    if (!rates.some((r) => r >= min && r <= max)) return false;
  }
  return true;
}

// Fixed option list per checkbox category — same as /jobs, always shown in
// full regardless of count (0-count options are just grayed out, not
// hidden), rather than only offering whatever values happen to appear in
// the currently-visible rows.
function facetOptionList(category: FacetCategory): { value: string; label: string }[] {
  switch (category) {
    case 'experienceRange': return EXPERIENCE_RANGE_OPTIONS.map((r) => ({ value: r.id, label: r.label }));
    case 'workType': return WORK_TYPE_OPTIONS;
    case 'employmentType': return EMPLOYMENT_TYPE_OPTIONS;
    case 'visaStatus': return VISA_STATUS_OPTIONS;
  }
}

function toCsvRows(rows: ActiveListContact[]): string[][] {
  return rows.map((row) => [row.name, row.email, row.last_active_at, row.role_titles]);
}

export default function ActiveListPage() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'recruiters' ? 'recruiters' : 'vendors';
  const { account, refreshAccount } = useAuth();
  const { isDark } = useTheme();
  const [activeTab, setActiveTab] = useState<'vendors' | 'recruiters'>(initialTab);
  const [data, setData] = useState<ActiveListResponse>({ recruiters: [], vendors: [] });
  const [loading, setLoading] = useState(true);
  const [rangeId, setRangeId] = useState<RangeId>('3d');
  const [isRangeMenuOpen, setIsRangeMenuOpen] = useState(false);
  const rangeMenuRef = useRef<HTMLDivElement | null>(null);
  const [pendingRoleQuery, setPendingRoleQuery] = useState('');
  const [pendingSkillsQuery, setPendingSkillsQuery] = useState('');
  const [pendingRateMin, setPendingRateMin] = useState('');
  const [pendingRateMax, setPendingRateMax] = useState('');
  const [textFilters, setTextFilters] = useState<TextFilters>(DEFAULT_TEXT_FILTERS);
  const [facetFilters, setFacetFilters] = useState<FacetFilters>(DEFAULT_FACETS);
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [charging, setCharging] = useState(false);
  const [showOutOfCredits, setShowOutOfCredits] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  async function loadData() {
    setLoading(true);
    const hours = RANGE_OPTIONS.find((r) => r.id === rangeId)?.hours ?? 72;
    const { data: result, error } = await supabase.functions.invoke<ActiveListResponse>('active-list', { body: { hours_back: hours } });
    if (error || !result) {
      setToast({ message: 'Could not load the active list', type: 'error' });
    } else {
      setData(result);
    }
    setLoading(false);
  }

  useEffect(() => { void loadData(); }, [rangeId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (rangeMenuRef.current && !rangeMenuRef.current.contains(event.target as Node)) setIsRangeMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function applyRoleSearch() {
    setTextFilters((prev) => ({ ...prev, roleQuery: pendingRoleQuery }));
  }

  // Matches /jobs' applyPendingTextFilters — checkboxes and location chips
  // apply immediately, but Skills/Rate min/max stay pending until blur,
  // Enter, or the sidebar's Apply button, so typing a number doesn't
  // re-filter the table on every keystroke.
  function applyPendingTextFilters() {
    setTextFilters((prev) => ({ ...prev, skillsQuery: pendingSkillsQuery, rateMin: pendingRateMin, rateMax: pendingRateMax }));
  }

  function handleFilterFieldKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') { event.preventDefault(); applyPendingTextFilters(); }
  }

  const baseRows = activeTab === 'vendors' ? data.vendors : data.recruiters;
  const textScopedRows = useMemo(() => baseRows.filter((row) => matchesTextFilters(row, textFilters)), [baseRows, textFilters]);

  const filteredVendors = useMemo(
    () => (activeTab === 'vendors' ? textScopedRows.filter((row) => matchesAllFacets(row, facetFilters)) : data.vendors),
    [textScopedRows, activeTab, facetFilters, data.vendors],
  );
  const filteredRecruiters = useMemo(
    () => (activeTab === 'recruiters' ? textScopedRows.filter((row) => matchesAllFacets(row, facetFilters)) : data.recruiters),
    [textScopedRows, activeTab, facetFilters, data.recruiters],
  );

  const activeFilteredRows = activeTab === 'vendors' ? filteredVendors : filteredRecruiters;
  const selectedRows = useMemo(() => activeFilteredRows.filter((row) => selectedEmails.has(row.email)), [activeFilteredRows, selectedEmails]);

  // 50 rows/page, shown as page-number pagination in the table header rather
  // than the infinite-scroll "load more" ActiveListTable otherwise offers —
  // selection (selectedRows above) stays scoped to the full filtered set, not
  // just the current page, so a user can select across pages before downloading.
  const totalPages = Math.max(1, Math.ceil(activeFilteredRows.length / PAGE_SIZE));
  const pageRows = useMemo(() => activeFilteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [activeFilteredRows, page]);
  useEffect(() => { setPage(1); }, [activeTab, facetFilters, textFilters, rangeId]);

  // Matches /jobs' feedFacetCounts — computed once per textScopedRows/filter
  // change rather than per-category inside the sidebar's render loop. Each
  // category's counts are against every OTHER active filter (excluding
  // itself), so checking a box narrows the rest of the sidebar without
  // hiding its own options.
  const facetCounts = useMemo(() => {
    const counts: Record<FacetCategory, Record<string, number>> = {
      experienceRange: {}, workType: {}, employmentType: {}, visaStatus: {},
    };
    for (const category of Object.keys(counts) as FacetCategory[]) {
      for (const row of textScopedRows) {
        if (!matchesAllFacets(row, facetFilters, category)) continue;
        const seen = new Set<string>();
        for (const raw of getFacetValues(row, category)) {
          const key = raw.trim().toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          counts[category][key] = (counts[category][key] ?? 0) + 1;
        }
      }
    }
    return counts;
  }, [textScopedRows, facetFilters]);

  const hasActiveFilters = Object.values(facetFilters).some((values) => values.length > 0)
    || textFilters.roleQuery || textFilters.locationValues.length > 0 || textFilters.skillsQuery || textFilters.rateMode !== 'all';

  function clearAllFilters() {
    setFacetFilters(DEFAULT_FACETS);
    setTextFilters(DEFAULT_TEXT_FILTERS);
    setPendingRoleQuery('');
    setPendingSkillsQuery('');
    setPendingRateMin('');
    setPendingRateMax('');
  }

  function toggleFacetOption(category: FacetCategory, value: string) {
    setFacetFilters((prev) => {
      const current = prev[category];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [category]: next };
    });
  }

  function handleTabChange(key: string) {
    setActiveTab(key as 'vendors' | 'recruiters');
    clearAllFilters();
    setSelectedEmails(new Set());
  }

  function toggleRow(email: string) {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  }

  function toggleAllVisible(emails: string[], select: boolean) {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      for (const email of emails) { if (select) next.add(email); else next.delete(email); }
      return next;
    });
  }

  async function handleDownload() {
    if (selectedRows.length === 0 || !account?.id || charging) return;

    // Free-plan download limit check runs first, before any credits are
    // touched — rejecting after a charge would mean "charged and got
    // nothing." Independent of the credits system below.
    setCharging(true);
    const { data: gateResult, error: gateError } = await supabase.rpc('check_and_log_active_list_download', {
      p_requested_count: selectedRows.length,
      p_download_type: activeTab,
    });
    const gateRow = Array.isArray(gateResult) ? gateResult[0] : null;
    if (gateError || !gateRow || gateRow.allowed_count !== selectedRows.length) {
      setCharging(false);
      setToast({ message: gateRow?.message || gateError?.message || 'Could not verify download limit right now', type: 'error' });
      return;
    }

    const cost = Math.round(selectedRows.length * EMAIL_DOWNLOAD_COST * 100) / 100;
    if ((account.credits_balance ?? 0) < cost) {
      setCharging(false);
      setShowOutOfCredits(true);
      return;
    }

    const { data: result, error } = await supabase.rpc('consume_feature_credit', {
      p_account_id: account.id,
      p_amount: cost,
      p_feature: 'active_list_email_download',
      p_metadata: { count: selectedRows.length, tab: activeTab },
    });
    setCharging(false);

    const row = Array.isArray(result) ? result[0] : null;
    if (error || !row?.success) {
      if (String(row?.message ?? '').toLowerCase().includes('insufficient')) {
        setShowOutOfCredits(true);
      } else {
        setToast({ message: row?.message || error?.message || 'Could not charge credits right now', type: 'error' });
      }
      return;
    }

    await refreshAccount();
    downloadCsv(`active-list-${activeTab}.csv`, ['Name', 'Email', 'Last Active On', 'Role Titles'], toCsvRows(selectedRows));
    setToast({ message: `${cost} credit${cost === 1 ? '' : 's'} used for ${selectedRows.length} email${selectedRows.length === 1 ? '' : 's'}`, type: 'success' });
    setSelectedEmails(new Set());
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden overscroll-none bg-[#f3f2ee] pb-[calc(4.25rem+env(safe-area-inset-bottom))] dark:bg-[#1B1D21] sm:pb-0">
      <AppNav />
      <main className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full w-full flex-col gap-2 overflow-hidden px-2 py-2">
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex flex-1 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5">
              <Search size={11} className="shrink-0 text-gray-400" />
              <input
                type="text"
                value={pendingRoleQuery}
                onChange={(event) => setPendingRoleQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyRoleSearch(); } }}
                placeholder="Search role titles"
                className="w-full border-0 bg-transparent text-[12px] text-gray-700 outline-none placeholder:text-gray-400"
              />
              {pendingRoleQuery && (
                <button
                  type="button"
                  onClick={() => { setPendingRoleQuery(''); setTextFilters((prev) => ({ ...prev, roleQuery: '' })); }}
                  className="rounded-full p-0.5 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-600"
                  aria-label="Clear search field"
                >
                  <X size={11} />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={applyRoleSearch}
              className="shrink-0 rounded-full border border-blue-600 bg-blue-600 p-1.5 text-white transition hover:bg-blue-700"
              aria-label="Search"
            >
              <Search size={12} />
            </button>

            <div className="flex shrink-0 items-center gap-1">
              {(['vendors', 'recruiters'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => handleTabChange(tab)}
                  className={`inline-flex items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${activeTab === tab ? 'border border-blue-600 bg-blue-600 text-white' : 'border border-transparent bg-white text-gray-500 hover:text-gray-700'}`}
                >
                  <span>{tab === 'vendors' ? 'Vendors' : 'Recruiters'}</span>
                  <span>{tab === 'vendors' ? data.vendors.length : data.recruiters.length}</span>
                </button>
              ))}
            </div>

            <div ref={rangeMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setIsRangeMenuOpen((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-100"
                aria-label="Change date range"
              >
                <Clock3 size={11} />
                <span>{RANGE_OPTIONS.find((r) => r.id === rangeId)?.shortLabel}</span>
              </button>
              {isRangeMenuOpen && (
                <div className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-[140px] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                  {RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => { setRangeId(option.id); setIsRangeMenuOpen(false); }}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${option.id === rangeId ? 'bg-gray-100 text-gray-800' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      <span>{option.label}</span>
                      {option.id === rangeId && <Check size={11} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="shrink-0 text-[11px] text-gray-400">Select rows to unlock and download their emails — {EMAIL_DOWNLOAD_COST} credit per email.</p>

          <div className="flex min-h-0 flex-1 gap-3">
            <aside className="flex h-full w-56 shrink-0 flex-col rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-[#171A1F]">
              <div className="flex shrink-0 items-center justify-between border-b border-gray-100 p-3 pb-2.5 dark:border-white/10">
                <span className="text-[12px] font-bold text-gray-900 dark:text-slate-100">Filters</span>
                {hasActiveFilters && (
                  <button type="button" onClick={clearAllFilters} className="text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400">
                    Clear
                  </button>
                )}
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
                {FACET_CATEGORIES.map(({ category, title }) => (
                  <div key={category}>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#64748B]">{title}</div>
                    <div className="flex flex-col gap-0.5">
                      {facetOptionList(category).map((opt) => {
                        const count = facetCounts[category][opt.value] ?? 0;
                        const isChecked = facetFilters[category].includes(opt.value);
                        return (
                          <label
                            key={opt.value}
                            className={`flex cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 text-[12px] transition ${isChecked ? (isDark ? 'bg-blue-500/10 text-blue-300' : 'bg-blue-50 text-blue-700') : (isDark ? 'text-slate-300 hover:bg-white/5' : 'text-gray-700 hover:bg-gray-50')} ${count === 0 && !isChecked ? 'opacity-40' : ''}`}
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleFacetOption(category, opt.value)}
                                disabled={count === 0 && !isChecked}
                                className="h-3 w-3 shrink-0 accent-blue-600"
                              />
                              <span className="truncate">{opt.label}</span>
                            </span>
                            <span className="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-[#64748B]">{count}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#64748B]">Location</label>
                  <LocationChipInput
                    values={textFilters.locationValues}
                    onChange={(next) => setTextFilters((prev) => ({ ...prev, locationValues: next }))}
                    placeholder="Search a city/state"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#64748B]">Skills</label>
                  <input
                    type="text"
                    value={pendingSkillsQuery}
                    onChange={(event) => setPendingSkillsQuery(event.target.value)}
                    onBlur={applyPendingTextFilters}
                    onKeyDown={handleFilterFieldKeyDown}
                    placeholder="e.g. React"
                    className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[12px] text-gray-700 outline-none placeholder:text-gray-400 dark:border-white/10 dark:bg-[#20242a] dark:text-slate-200 dark:placeholder:text-[#64748B]"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-[#64748B]">Rate</label>
                  <select
                    value={textFilters.rateMode}
                    onChange={(event) => setTextFilters((prev) => ({ ...prev, rateMode: event.target.value as TextFilters['rateMode'] }))}
                    className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[12px] text-gray-700 dark:border-white/10 dark:bg-[#20242a] dark:text-slate-200"
                  >
                    <option value="all">Any</option>
                    <option value="has_rate">Has a rate listed</option>
                    <option value="range">Within range</option>
                  </select>
                  {textFilters.rateMode === 'range' && (
                    <div className="mt-1.5 flex items-center gap-1">
                      <input
                        type="number"
                        value={pendingRateMin}
                        onChange={(event) => setPendingRateMin(event.target.value)}
                        onBlur={applyPendingTextFilters}
                        onKeyDown={handleFilterFieldKeyDown}
                        placeholder="Min"
                        className="w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[12px] text-gray-700 outline-none placeholder:text-gray-400 dark:border-white/10 dark:bg-[#20242a] dark:text-slate-200 dark:placeholder:text-[#64748B]"
                      />
                      <span className="shrink-0 text-[11px] text-gray-400">–</span>
                      <input
                        type="number"
                        value={pendingRateMax}
                        onChange={(event) => setPendingRateMax(event.target.value)}
                        onBlur={applyPendingTextFilters}
                        onKeyDown={handleFilterFieldKeyDown}
                        placeholder="Max"
                        className="w-full min-w-0 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[12px] text-gray-700 outline-none placeholder:text-gray-400 dark:border-white/10 dark:bg-[#20242a] dark:text-slate-200 dark:placeholder:text-[#64748B]"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="shrink-0 border-t border-gray-100 p-3 pt-2.5 dark:border-white/10">
                <button
                  type="button"
                  onClick={applyPendingTextFilters}
                  className="w-full rounded-md bg-blue-600 px-2 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  Apply
                </button>
              </div>
            </aside>

            <div className="min-h-0 flex-1 overflow-hidden">
              <ActiveListTable
                tabs={[
                  { key: activeTab, label: activeTab === 'vendors' ? 'Vendors' : 'Recruiters', rows: pageRows },
                ]}
                activeTab={activeTab}
                onDownload={() => void handleDownload()}
                downloadLabel={charging ? 'Charging…' : `Download Selected (${selectedRows.length})`}
                loading={loading}
                emptyMessage={hasActiveFilters ? 'No contacts match these filters.' : 'No active contacts in this range.'}
                maskPii
                selectable
                selectedEmails={selectedEmails}
                onToggleRow={toggleRow}
                onToggleAllVisible={toggleAllVisible}
                headerAccessory={!loading && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400 dark:text-[#64748B]">
                      {activeFilteredRows.length.toLocaleString('en-US')} {activeFilteredRows.length === 1 ? 'contact' : 'contacts'}
                    </span>
                    {totalPages > 1 && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          disabled={page === 1}
                          className="flex h-6 w-6 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-[#94A3B8] dark:hover:border-white/30"
                          aria-label="Previous page"
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <span className="px-1 text-[11px] font-semibold text-gray-600 tabular-nums dark:text-slate-300">Page {page} of {totalPages}</span>
                        <button
                          type="button"
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                          disabled={page === totalPages}
                          className="flex h-6 w-6 items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:text-[#94A3B8] dark:hover:border-white/30"
                          aria-label="Next page"
                        >
                          <ChevronRight size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              />
            </div>
          </div>
        </div>
      </main>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <InsufficientCreditsModal
        open={showOutOfCredits}
        onClose={() => setShowOutOfCredits(false)}
        balance={account?.credits_balance ?? 0}
        actionLabel={`download ${selectedRows.length} email${selectedRows.length === 1 ? '' : 's'}`}
      />
    </div>
  );
}
