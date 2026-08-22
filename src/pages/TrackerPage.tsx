import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus, Search, Trash2, Pencil, X, Save, User, Briefcase,
  Building2, Mail, Phone, MapPin, DollarSign, Calendar,
  UserCheck, ChevronDown, ChevronUp, FileText, Tag, Clock, Users, Download,
  AlertTriangle, History, Eye, EyeOff, Copy, Check, Clock3, BadgeCheck,
  GraduationCap, Laptop, Shield,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Profile } from '../types/database';
import { buildScoreBreakdownDisplayItems } from '../lib/radar-match-ui';
import { normalizePostSource, type PostSource } from '../lib/post-source';
import PostSourceBadge from '../components/PostSourceBadge';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Vendor { id: string; name: string; contact_person: string; email: string; contact: string; location: string; created_at: string; }
interface Client { id: string; name: string; contact_person: string; email: string; phone: string; location: string; created_at: string; }

type TrackerLeadType = 'job' | 'hotlist';

interface TrackerLead {
  id: string;
  type: TrackerLeadType;
  title: string;
  company: string;
  location: string;
  posterName: string;
  posterEmail: string;
  posterPhone: string;
  platform: string;
  postedAt: string;
  createdAt: string;
  scoreBreakdown: Record<string, unknown> | null;
  revealedAt: string | null;
  submittedAt: string | null;
  verifiedAt: string | null;
  postSource: PostSource;
}

function vendorMatchesLead(vendor: Pick<Vendor, 'email' | 'contact' | 'name' | 'contact_person'>, lead: TrackerLead): boolean {
  const normalize = (v?: string | null) => (v ?? '').trim().toLowerCase();
  const vendorEmail = normalize(vendor.email);
  const vendorPhone = normalize(vendor.contact);
  const vendorName = normalize(vendor.name);
  const contactPerson = normalize(vendor.contact_person);
  return Boolean(
    (vendorEmail && vendorEmail === normalize(lead.posterEmail))
    || (vendorPhone && vendorPhone === normalize(lead.posterPhone))
    || (contactPerson && contactPerson === normalize(lead.posterName))
    || (vendorName && [normalize(lead.company), normalize(lead.posterName)].includes(vendorName)),
  );
}

interface Submission {
  id: string; candidate_name: string; skill_set: string; vendor_name: string;
  vendor_email: string; vendor_contact: string; client_name: string; job_location: string;
  rate: string; submitted_by: string; submission_date: string; submission_type: string; created_at: string;
}


// ── Date range ────────────────────────────────────────────────────────────────

type DatePreset = '30d' | 'today' | '7d' | 'month' | 'custom';

const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: '30d',   label: 'Last 30 days' },
  { id: 'today', label: 'Today'        },
  { id: '7d',    label: 'Last 7 days'  },
  { id: 'month', label: 'This month'   },
  { id: 'custom',label: 'Custom range' },
];

function buildRange(preset: DatePreset, cs?: string, ce?: string): { start: string; end: string } {
  const now = new Date();
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  if (preset === 'today') {
    const s = new Date(now); s.setHours(0, 0, 0, 0);
    return { start: s.toISOString(), end: end.toISOString() };
  }
  if (preset === '7d') {
    const s = new Date(now); s.setDate(now.getDate() - 6); s.setHours(0, 0, 0, 0);
    return { start: s.toISOString(), end: end.toISOString() };
  }
  if (preset === '30d') {
    const s = new Date(now); s.setDate(now.getDate() - 29); s.setHours(0, 0, 0, 0);
    return { start: s.toISOString(), end: end.toISOString() };
  }
  if (preset === 'month') {
    const s = new Date(now); s.setDate(1); s.setHours(0, 0, 0, 0);
    return { start: s.toISOString(), end: end.toISOString() };
  }
  return {
    start: cs ? new Date(cs).toISOString() : buildRange('30d').start,
    end:   ce ? new Date(ce + 'T23:59:59').toISOString() : end.toISOString(),
  };
}

function inRange(iso: string, start: string, end: string) { return iso >= start && iso <= end; }

// ── Combobox ──────────────────────────────────────────────────────────────────

interface ComboOption { value: string; subtitle?: string; }

interface ComboboxProps {
  value: string;
  onChange: (val: string, opt?: ComboOption) => void;
  options: ComboOption[];
  recentOptions: ComboOption[];
  placeholder?: string;
  inputType?: string;
  autoFocus?: boolean;
}

function Combobox({ value, onChange, options, recentOptions, placeholder, inputType = 'text', autoFocus }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery(value); }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [value]);

  const filtered = query.trim() ? options.filter(o => o.value.toLowerCase().includes(query.toLowerCase())) : [];
  const showRecent = !query.trim() && recentOptions.length > 0;
  const listItems = showRecent ? recentOptions : filtered;

  return (
    <div ref={ref} className="relative">
      <input
        type={inputType} value={query} autoComplete="off" autoFocus={autoFocus} placeholder={placeholder}
        className="w-full px-3 py-2 text-[15px] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 pr-8 placeholder-gray-300 transition-all"
        onChange={e => { setQuery(e.target.value); onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setQuery(value); } }}
      />
      <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
      {open && listItems.length > 0 && (
        <div className="absolute z-[60] mt-1 w-full bg-white rounded-xl border border-gray-200 shadow-2xl overflow-hidden max-h-44 overflow-y-auto">
          {showRecent && (
            <div className="px-3 pt-2 pb-0.5 flex items-center gap-1.5">
              <Clock size={10} className="text-gray-300" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Recent</span>
            </div>
          )}
          {listItems.map((opt, i) => (
            <button
              key={i}
              onMouseDown={e => { e.preventDefault(); setQuery(opt.value); onChange(opt.value, opt); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors"
            >
              <div className="text-[15px] font-medium text-gray-800 truncate">{opt.value}</div>
              {opt.subtitle && <div className="text-[13px] text-gray-400 truncate">{opt.subtitle}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Form helpers ──────────────────────────────────────────────────────────────

function Field({ label, icon: Icon, children }: { label: string; icon: React.FC<{ size?: number; className?: string }>; children: React.ReactNode }) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        <Icon size={11} className="text-gray-400" />{label}
      </label>
      {children}
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 text-[15px] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-300 transition-all';

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatDate(d: string) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${m}/${day}/${y}`;
}

function fmtIso(iso: string) {
  if (!iso) return '—';
  return iso.slice(0, 10).split('-').map((p, i) => i === 0 ? p : p).join('-').replace(/(\d{4})-(\d{2})-(\d{2})/, '$2/$3/$1');
}

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const escape = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers.map(escape), ...rows.map(r => r.map(escape))].map(r => r.join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const SUBMISSION_TYPES = ['Client', 'Vendor', 'Candidate'] as const;

const TYPE_BADGE: Record<string, string> = {
  Client:    'bg-teal-50 text-teal-700 ring-1 ring-teal-200',
  Vendor:    'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  Candidate: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  C2C:       'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  W2:        'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  Direct:    'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function TrackerPage() {
  const { user, account } = useAuth();
  const defaultSubmittedBy = (user?.user_metadata?.full_name as string | undefined) ?? '';

  const [vendors, setVendors]         = useState<Vendor[]>([]);
  const [clients, setClients]         = useState<Client[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [profiles, setProfiles]       = useState<Profile[]>([]);
  const [loading, setLoading]         = useState(true);

  // Date range
  const [datePreset, setDatePreset] = useState<DatePreset>('30d');
  const [dateRange, setDateRange]   = useState(() => buildRange('30d'));
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd]     = useState('');
  const [dateOpen, setDateOpen]       = useState(false);
  const dateRef = useRef<HTMLDivElement>(null);

  // Search
  const [pendingGlobalSearch, setPendingGlobalSearch] = useState('');
  const [globalSearch, setGlobalSearch] = useState('');

  // Selections
  const [selSub, setSelSub]     = useState<Set<string>>(new Set());
  const [selVendor, setSelVendor] = useState<Set<string>>(new Set());
  const [selClient, setSelClient] = useState<Set<string>>(new Set());

  // Pages

  // Modals
  type ModalType = 'vendor' | 'client' | 'submission' | null;
  const [modal, setModal]         = useState<ModalType>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving]       = useState(false);

  const emptyVendor = { name: '', contact_person: '', email: '', contact: '', location: '' };
  const [vendorForm, setVendorForm] = useState(emptyVendor);

  const emptyClient = { name: '', contact_person: '', email: '', phone: '', location: '' };
  const [clientForm, setClientForm] = useState(emptyClient);

  const emptySubmission = {
    candidate_name: '', skill_set: '', vendor_name: '', vendor_email: '', vendor_contact: '',
    client_name: '', job_location: '', rate: '', submitted_by: '',
    submission_date: new Date().toISOString().slice(0, 10), submission_type: '',
  };
  const [subForm, setSubForm] = useState(emptySubmission);

  const [deleteTarget, setDeleteTarget] = useState<{ type: 'vendor' | 'client' | 'submission'; id: string } | null>(null);
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set());
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set());

  // Vendor history
  const [activeVendorId, setActiveVendorId] = useState<string | null>(null);
  const [allLeads, setAllLeads] = useState<TrackerLead[]>([]);
  const [jobsLayoutMode, setJobsLayoutMode] = useState<'card' | 'table'>('table');
  const [expandedFieldKeys, setExpandedFieldKeys] = useState<Set<string>>(new Set());
  const [expandedSkillsLeadIds, setExpandedSkillsLeadIds] = useState<Set<string>>(new Set());
  const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set());
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type?: 'success' | 'error' } | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{ existing: Submission[]; } | null>(null);
  const [trackerPostPreview, setTrackerPostPreview] = useState<{ leadId: string; title: string; content: string } | null>(null);
  const [trackerDraftPreview, setTrackerDraftPreview] = useState<{
    leadId: string; leadType: TrackerLeadType; vendorName: string; vendorEmail: string;
    jobTitle: string; company: string; subject: string; emailContent: string;
  } | null>(null);
  const [loadingPreviewLeadId, setLoadingPreviewLeadId] = useState<string | null>(null);
  const [loadingDraftLeadId, setLoadingDraftLeadId] = useState<string | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  // Close date picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) setDateOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 639px)');
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener('change', updateViewport);
    return () => mediaQuery.removeEventListener('change', updateViewport);
  }, []);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  // Combines revealed + submitted + verified job AND hotlist leads for the
  // current user into one unified list, so a vendor contacted purely via
  // Submit (no separate Reveal) or via a hotlist consultant still shows up.
  const loadTrackerLeads = useCallback(async (): Promise<TrackerLead[]> => {
    if (!user?.id) return [];

    const [{ data: revealedActions }, askResult] = await Promise.all([
      supabase
        .from('pulse_lead_actions')
        .select('lead_id, created_at')
        .eq('user_id', user.id)
        .eq('action_type', 'revealed'),
      account?.id
        ? supabase
          .from('pulse_ask_ai_requests')
          .select('job_id, hotlist_id, created_at')
          .eq('account_id', account.id)
          .eq('user_id', user.id)
          .in('status', ['completed', 'fulfilled'])
        : Promise.resolve({ data: [] as Array<{ job_id: string | null; hotlist_id: string | null; created_at: string }> }),
    ]);

    const revealedAtByLeadId = new Map<string, string>();
    for (const row of (revealedActions ?? []) as Array<{ lead_id: string; created_at: string }>) {
      if (!revealedAtByLeadId.has(row.lead_id)) revealedAtByLeadId.set(row.lead_id, row.created_at);
    }

    const submittedAtByLeadId = new Map<string, string>();
    for (const row of (askResult.data ?? []) as Array<{ job_id: string | null; hotlist_id: string | null; created_at: string }>) {
      const leadId = row.job_id ?? row.hotlist_id;
      if (leadId && !submittedAtByLeadId.has(leadId)) submittedAtByLeadId.set(leadId, row.created_at);
    }

    const allLeadIds = [...new Set([...revealedAtByLeadId.keys(), ...submittedAtByLeadId.keys()])];
    if (allLeadIds.length === 0) return [];

    const verifiedAtByLeadId = new Map<string, string>();
    if (account?.id) {
      const [{ data: jobStates }, { data: hotlistStates }] = await Promise.all([
        supabase.rpc('get_pulse_asked_job_states' as never, { p_account_id: account.id }),
        supabase.rpc('get_hotlist_asked_states' as never, { p_account_id: account.id }),
      ]);
      for (const row of (jobStates ?? []) as Array<{ job_id: string; state: string }>) {
        if (row.state === 'verified') verifiedAtByLeadId.set(row.job_id, submittedAtByLeadId.get(row.job_id) || revealedAtByLeadId.get(row.job_id) || '');
      }
      for (const row of (hotlistStates ?? []) as Array<{ hotlist_id: string; state: string }>) {
        if (row.state === 'verified') verifiedAtByLeadId.set(row.hotlist_id, submittedAtByLeadId.get(row.hotlist_id) || revealedAtByLeadId.get(row.hotlist_id) || '');
      }
    }

    const [{ data: jobRows }, { data: hotlistRows }] = await Promise.all([
      supabase
        .from('social_jobs')
        .select('id, job_title, company_name, location, posted_by_name, poster_email, poster_phone, platform, created_at, posted_at, extracted_role_normalized, post_source')
        .in('id', allLeadIds),
      supabase
        .from('social_hotlist')
        .select('id, role_title, bench_sales_company_name, locations, bench_sales_recruiter_name, bench_sales_recruiter_email, bench_sales_recruiter_phone, platform, created_at, posted_at, post_source')
        .in('id', allLeadIds),
    ]);

    const jobIds = ((jobRows ?? []) as Array<{ id: string }>).map((row) => row.id);
    const hotlistIds = ((hotlistRows ?? []) as Array<{ id: string }>).map((row) => row.id);

    const [{ data: jobMatches }, { data: hotlistMatches }] = await Promise.all([
      jobIds.length > 0
        ? supabase.from('radar_match_results').select('job_id, score_breakdown, created_at').in('job_id', jobIds).order('created_at', { ascending: false })
        : Promise.resolve({ data: [] as Array<{ job_id: string; score_breakdown: Record<string, unknown> | null }> }),
      hotlistIds.length > 0
        ? supabase.from('radar_match_hotlist').select('hotlist_id, score_breakdown, created_at').in('hotlist_id', hotlistIds).order('created_at', { ascending: false })
        : Promise.resolve({ data: [] as Array<{ hotlist_id: string; score_breakdown: Record<string, unknown> | null }> }),
    ]);

    const breakdownByJobId = new Map<string, Record<string, unknown> | null>();
    for (const row of (jobMatches ?? []) as Array<{ job_id: string; score_breakdown: Record<string, unknown> | null }>) {
      if (!breakdownByJobId.has(row.job_id)) breakdownByJobId.set(row.job_id, row.score_breakdown);
    }
    const breakdownByHotlistId = new Map<string, Record<string, unknown> | null>();
    for (const row of (hotlistMatches ?? []) as Array<{ hotlist_id: string; score_breakdown: Record<string, unknown> | null }>) {
      if (!breakdownByHotlistId.has(row.hotlist_id)) breakdownByHotlistId.set(row.hotlist_id, row.score_breakdown);
    }

    const jobLeads: TrackerLead[] = ((jobRows ?? []) as Array<{
      id: string; job_title: string | null; company_name: string | null; location: string | null;
      posted_by_name: string | null; poster_email: string | null; poster_phone: string | null;
      platform: string | null; created_at: string; posted_at: string | null; extracted_role_normalized: string | null;
      post_source: string | null;
    }>).map((row) => ({
      id: row.id,
      type: 'job' as const,
      title: row.job_title?.trim() || row.extracted_role_normalized?.trim() || 'Untitled Job',
      company: row.company_name?.trim() || '',
      location: row.location?.trim() || '',
      posterName: row.posted_by_name?.trim() || '',
      posterEmail: row.poster_email?.trim() || '',
      posterPhone: row.poster_phone?.trim() || '',
      platform: row.platform || '',
      postedAt: row.posted_at || row.created_at,
      createdAt: row.created_at,
      scoreBreakdown: breakdownByJobId.get(row.id) ?? null,
      revealedAt: revealedAtByLeadId.get(row.id) ?? null,
      submittedAt: submittedAtByLeadId.get(row.id) ?? null,
      verifiedAt: verifiedAtByLeadId.get(row.id) ?? null,
      postSource: normalizePostSource(row.post_source),
    }));

    const hotlistLeads: TrackerLead[] = ((hotlistRows ?? []) as Array<{
      id: string; role_title: string | null; bench_sales_company_name: string | null; locations: string[] | null;
      bench_sales_recruiter_name: string | null; bench_sales_recruiter_email: string | null; bench_sales_recruiter_phone: string | null;
      platform: string | null; created_at: string; posted_at: string | null; post_source: string | null;
    }>).map((row) => ({
      id: row.id,
      type: 'hotlist' as const,
      title: row.role_title?.trim() || 'Available Consultant',
      company: row.bench_sales_company_name?.trim() || '',
      location: Array.isArray(row.locations) && row.locations.length > 0 ? row.locations.join(', ') : '',
      posterName: row.bench_sales_recruiter_name?.trim() || '',
      posterEmail: row.bench_sales_recruiter_email?.trim() || '',
      posterPhone: row.bench_sales_recruiter_phone?.trim() || '',
      platform: row.platform || '',
      postedAt: row.posted_at || row.created_at,
      createdAt: row.created_at,
      scoreBreakdown: breakdownByHotlistId.get(row.id) ?? null,
      revealedAt: revealedAtByLeadId.get(row.id) ?? null,
      submittedAt: submittedAtByLeadId.get(row.id) ?? null,
      verifiedAt: verifiedAtByLeadId.get(row.id) ?? null,
      postSource: normalizePostSource(row.post_source),
    }));

    return [...jobLeads, ...hotlistLeads];
  }, [account?.id, user?.id]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [vRes, cRes, sRes, pRes, leads] = await Promise.all([
      supabase.from('vendors').select('*').order('created_at', { ascending: false }),
      supabase.from('clients').select('*').order('created_at', { ascending: false }),
      supabase.from('submissions').select('*').order('submission_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('profiles').select('id,candidate_name,core_skills,preferred_locations,location,city,state,desired_salary_min').order('created_at', { ascending: false }),
      loadTrackerLeads(),
    ]);
    setAllLeads(leads);
    if (!vRes.error) {
      const ownVendors = (vRes.data ?? []).filter((vendor) => leads.some((lead) => vendorMatchesLead(vendor, lead)));
      setVendors(ownVendors);
    }
    if (!cRes.error) setClients(cRes.data ?? []);
    if (!sRes.error) setSubmissions(sRes.data ?? []);
    if (!pRes.error) setProfiles((pRes.data ?? []) as Profile[]);
    setLoading(false);
  }, [loadTrackerLeads]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Reset pages on search/date change


  // ── Date preset helpers ────────────────────────────────────────────────────

  function applyPreset(preset: DatePreset) {
    setDatePreset(preset);
    if (preset !== 'custom') {
      setDateRange(buildRange(preset));
      setDateOpen(false);
    }
  }

  function applyCustom() {
    setDateRange(buildRange('custom', customStart, customEnd));
    setDateOpen(false);
  }

  function applyGlobalSearch() {
    setGlobalSearch(pendingGlobalSearch.trim());
  }

  const dateLabel = DATE_PRESETS.find(p => p.id === datePreset)?.label ?? 'Custom range';
  const trackerDateShortLabel: Record<DatePreset, string> = {
    '30d': '30d',
    today: '1d',
    '7d': '7d',
    month: 'MTD',
    custom: 'Custom',
  };

  // ── Suggestions ────────────────────────────────────────────────────────────

  const vendorOptions: ComboOption[]    = vendors.map(v => ({ value: v.name, subtitle: v.email || undefined }));
  const recentVendorOpts                = vendorOptions.slice(0, 2);
  const vendorNameOpts                  = vendors.map(v => ({ value: v.name }));
  const recentVendorNames               = vendorNameOpts.slice(0, 2);
  const clientOptions: ComboOption[]    = clients.map(c => ({ value: c.name }));
  const recentClientOpts                = clientOptions.slice(0, 2);
  const clientNameOpts                  = clientOptions;
  const recentClientNames               = clientNameOpts.slice(0, 2);
  const candidateOptions: ComboOption[] = profiles.map(p => ({ value: p.candidate_name, subtitle: p.core_skills?.slice(0, 80) || undefined }));
  const recentCandidates                = candidateOptions.slice(0, 3);

  const locationOptions: ComboOption[] = [
    ...new Set([
      ...submissions.map(s => s.job_location).filter(Boolean),
      ...profiles.flatMap(p => {
        const locs: string[] = [];
        if (p.preferred_locations) locs.push(p.preferred_locations);
        if (p.city && p.state) locs.push(`${p.city}, ${p.state}`);
        else if (p.location) locs.push(p.location);
        return locs;
      }),
    ]),
  ].map(v => ({ value: v }));

  const rateOptions: ComboOption[] = [
    ...new Set([
      ...submissions.map(s => s.rate).filter(Boolean),
      ...profiles.filter(p => p.desired_salary_min).map(p => `$${p.desired_salary_min}/yr`),
    ]),
  ].map(v => ({ value: v }));

  const submittedByOptions: ComboOption[] = [
    ...new Set(submissions.map(s => s.submitted_by).filter(Boolean)),
  ].map(v => ({ value: v }));

  // ── Auto-fill handlers ──────────────────────────────────────────────────────

  function handleSubCandidateSelect(name: string) {
    const p = profiles.find(x => x.candidate_name === name);
    if (!p) { setSubForm(f => ({ ...f, candidate_name: name })); return; }
    setSubForm(f => ({
      ...f,
      candidate_name: name,
      job_location: p.preferred_locations || (p.city && p.state ? `${p.city}, ${p.state}` : p.location) || f.job_location,
      rate: p.desired_salary_min ? `$${p.desired_salary_min}/yr` : f.rate,
    }));
  }

  function handleSubVendorSelect(name: string) {
    const v = vendors.find(x => x.name === name);
    setSubForm(f => ({ ...f, vendor_name: name, vendor_email: v?.email ?? f.vendor_email, vendor_contact: v?.contact ?? f.vendor_contact }));
  }

  function handleVendorNameSelect(name: string, opt?: ComboOption) {
    const existing = opt && vendors.find(v => v.name === name);
    if (existing) {
      setVendorForm({ name: existing.name, contact_person: existing.contact_person, email: existing.email, contact: existing.contact, location: existing.location });
      setEditingId(existing.id);
    } else {
      setVendorForm(f => ({ ...f, name }));
    }
  }

  // ── Open modals ─────────────────────────────────────────────────────────────

  function openAddVendor() { setEditingId(null); setVendorForm(emptyVendor); setModal('vendor'); }
  function openEditVendor(v: Vendor) { setEditingId(v.id); setVendorForm({ name: v.name, contact_person: v.contact_person, email: v.email, contact: v.contact, location: v.location }); setModal('vendor'); }
  function openAddClient() { setEditingId(null); setClientForm(emptyClient); setModal('client'); }
  function openEditClient(c: Client) { setEditingId(c.id); setClientForm({ name: c.name, contact_person: c.contact_person, email: c.email, phone: c.phone, location: c.location }); setModal('client'); }
  function openAddSubmission() { setEditingId(null); setSubForm({ ...emptySubmission, submitted_by: defaultSubmittedBy }); setModal('submission'); }
  function openEditSubmission(s: Submission) {
    setEditingId(s.id);
    setSubForm({ candidate_name: s.candidate_name, skill_set: s.skill_set, vendor_name: s.vendor_name, vendor_email: s.vendor_email, vendor_contact: s.vendor_contact, client_name: s.client_name, job_location: s.job_location, rate: s.rate, submitted_by: s.submitted_by, submission_date: s.submission_date, submission_type: s.submission_type });
    setModal('submission');
  }

  // ── Save ────────────────────────────────────────────────────────────────────

  async function saveVendor() {
    if (!vendorForm.name.trim()) { setToast({ message: 'Vendor name is required.', type: 'error' }); return; }
    setSaving(true);
    const { error } = editingId
      ? await supabase.from('vendors').update(vendorForm).eq('id', editingId)
      : await supabase.from('vendors').insert(vendorForm);
    setSaving(false);
    if (error) { setToast({ message: 'Failed to save vendor.', type: 'error' }); return; }
    setToast({ message: editingId ? 'Vendor updated.' : 'Vendor added.', type: 'success' });
    setModal(null); fetchAll();
  }

  async function saveClient() {
    if (!clientForm.name.trim()) { setToast({ message: 'Client name is required.', type: 'error' }); return; }
    setSaving(true);
    const { error } = editingId
      ? await supabase.from('clients').update(clientForm).eq('id', editingId)
      : await supabase.from('clients').insert(clientForm);
    setSaving(false);
    if (error) { setToast({ message: 'Failed to save client.', type: 'error' }); return; }
    setToast({ message: editingId ? 'Client updated.' : 'Client added.', type: 'success' });
    setModal(null); fetchAll();
  }

  async function saveSubmission(skipDuplicateCheck = false) {
    if (!subForm.candidate_name.trim()) { setToast({ message: 'Candidate name is required.', type: 'error' }); return; }

    if (!editingId && !skipDuplicateCheck) {
      const candidateNorm = subForm.candidate_name.trim().toLowerCase();
      const matchTarget = subForm.submission_type === 'Vendor' ? subForm.vendor_name.trim().toLowerCase() : subForm.client_name.trim().toLowerCase();
      if (matchTarget) {
        const dupes = submissions.filter(s => {
          if (s.candidate_name.toLowerCase() !== candidateNorm) return false;
          if (subForm.submission_type === 'Vendor') return s.vendor_name.toLowerCase() === matchTarget;
          return s.client_name.toLowerCase() === matchTarget;
        });
        if (dupes.length > 0) {
          setDuplicateWarning({ existing: dupes });
          return;
        }
      }
    }

    setSaving(true);
    const { error } = editingId
      ? await supabase.from('submissions').update(subForm).eq('id', editingId)
      : await supabase.from('submissions').insert(subForm);
    setSaving(false);
    if (error) { setToast({ message: 'Failed to save submission.', type: 'error' }); return; }
    setToast({ message: editingId ? 'Submission updated.' : 'Submission added.', type: 'success' });
    setModal(null); setDuplicateWarning(null); fetchAll();
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async function confirmDelete() {
    if (!deleteTarget) return;
    const table = deleteTarget.type === 'vendor' ? 'vendors' : deleteTarget.type === 'client' ? 'clients' : 'submissions';
    const { error } = await supabase.from(table).delete().eq('id', deleteTarget.id);
    if (error) { setToast({ message: 'Failed to delete.', type: 'error' }); }
    else { setToast({ message: 'Deleted.', type: 'success' }); fetchAll(); }
    setDeleteTarget(null);
  }

  // ── Filter logic ──────────────────────────────────────────────────────────
  // Search spans ALL data; date filter applies only when not searching

  const q = globalSearch.toLowerCase();
  const isSearching = q.length > 0;

  const filteredSubs = submissions.filter(s => {
    if (isSearching) return [s.candidate_name, s.client_name, s.vendor_name, s.submission_type, s.submitted_by, s.skill_set, s.job_location, s.rate].some(f => (f ?? '').toLowerCase().includes(q));
    return inRange(s.submission_date + 'T00:00:00.000Z', dateRange.start, dateRange.end);
  });

  const filteredVendors = vendors.filter(v => {
    if (isSearching) return [v.name, v.email, v.contact, v.contact_person, v.location].some(f => (f ?? '').toLowerCase().includes(q));
    return inRange(v.created_at, dateRange.start, dateRange.end);
  });

  const filteredClients = clients.filter(c => {
    if (isSearching) return [c.name, c.contact_person, c.email, c.phone, c.location].some(f => (f ?? '').toLowerCase().includes(q));
    return inRange(c.created_at, dateRange.start, dateRange.end);
  });

  // Paginated slices

  // ── Selection helpers ──────────────────────────────────────────────────────

  function toggleSel(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set); next.has(id) ? next.delete(id) : next.add(id); setter(next);
  }

  // ── Vendor history ────────────────────────────────────────────────────────

  function formatAgo(dateIso: string) {
    const ts = new Date(dateIso).getTime();
    if (Number.isNaN(ts)) return 'just now';
    const diffMs = Date.now() - ts;
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  // vendorHistory is a pure client-side filter of the already-loaded allLeads —
  // no separate fetch/loading state needed since loadTrackerLeads() already
  // pulled every revealed/submitted/verified job + hotlist lead up front.
  const vendorHistory = useMemo(() => {
    const vendorsToMatch = activeVendorId ? vendors.filter((v) => v.id === activeVendorId) : filteredVendors;
    if (vendorsToMatch.length === 0) return [];
    return allLeads
      .filter((lead) => vendorsToMatch.some((vendor) => vendorMatchesLead(vendor, lead)))
      .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());
  }, [activeVendorId, allLeads, filteredVendors, vendors]);

  // Preview shows the original post's raw content — same read PulsePage's
  // handlePreviewPost does, but free here since these leads were already
  // engaged (revealed/submitted) once from Pulse.
  const handleTrackerPreviewPost = useCallback(async (lead: TrackerLead) => {
    if (loadingPreviewLeadId) return;
    setLoadingPreviewLeadId(lead.id);
    try {
      const { data, error } = await supabase
        .from(lead.type === 'hotlist' ? 'social_hotlist' : 'social_jobs')
        .select(lead.type === 'hotlist' ? 'raw_post_content' : 'post_content')
        .eq('id', lead.id)
        .maybeSingle();
      if (error || !data) throw new Error(error?.message || 'Could not load the post');

      const content = String((lead.type === 'hotlist' ? (data as { raw_post_content: string | null }).raw_post_content : (data as { post_content: string | null }).post_content) ?? '').trim();
      setTrackerPostPreview({
        leadId: lead.id,
        title: lead.title || (lead.type === 'hotlist' ? 'Available Consultant' : 'Job Opportunity'),
        content: content || 'No post content available.',
      });
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : 'Could not load the post', type: 'error' });
    } finally {
      setLoadingPreviewLeadId(null);
    }
  }, [loadingPreviewLeadId]);

  // Submit/Request never regenerates or charges credits here — it just shows
  // the actual AI-generated draft that was already produced (and cached in
  // pulse_ask_ai_previews) when this lead was submitted/requested from Pulse.
  const handleTrackerViewDraft = useCallback(async (lead: TrackerLead) => {
    if (!user?.id || loadingDraftLeadId) return;
    setLoadingDraftLeadId(lead.id);
    try {
      const { data, error } = await supabase
        .from('pulse_ask_ai_previews' as never)
        .select('subject, email_content, vendor_name, vendor_email')
        .eq('user_id', user.id)
        .eq(lead.type === 'hotlist' ? 'hotlist_id' : 'job_id', lead.id)
        .maybeSingle();
      if (error) throw new Error(error.message || 'Could not load the generated draft');

      const row = data as { subject: string; email_content: string; vendor_name: string; vendor_email: string } | null;
      if (!row) {
        setToast({ message: 'No draft has been generated for this lead yet.', type: 'error' });
        return;
      }

      setTrackerDraftPreview({
        leadId: lead.id,
        leadType: lead.type,
        vendorName: row.vendor_name || lead.posterName || 'the vendor',
        vendorEmail: row.vendor_email || lead.posterEmail || '',
        jobTitle: lead.title,
        company: lead.company,
        subject: row.subject,
        emailContent: row.email_content,
      });
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : 'Could not load the generated draft', type: 'error' });
    } finally {
      setLoadingDraftLeadId(null);
    }
  }, [loadingDraftLeadId, user?.id]);

  const copyText = useCallback(async (text: string, label: string) => {
    if (!text) {
      setToast({ message: `${label} is unavailable.`, type: 'error' });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(label);
      setTimeout(() => setCopiedField(null), 1500);
      setToast({ message: `${label} copied.`, type: 'success' });
    } catch {
      setToast({ message: `Could not copy ${label.toLowerCase()}.`, type: 'error' });
    }
  }, []);

  function handleVendorRowClick(vendor: Vendor) {
    setActiveVendorId((current) => (current === vendor.id ? null : vendor.id));
  }

  // ── Jobs/Hotlist history: status badges + card/table renderers ───────────

  function getLeadBreakdownFieldValues(lead: TrackerLead) {
    const items = buildScoreBreakdownDisplayItems(
      lead.scoreBreakdown as Record<string, number | { score: number; candidate_value: string; job_value: string; rule: string }> | undefined,
    );
    const getValue = (matchers: string[]) => {
      const found = items.find((item) => matchers.some((matcher) => item.key.toLowerCase().includes(matcher)));
      const value = found?.detail?.job_value?.trim();
      return value && value !== 'Not specified' ? value : '-';
    };
    return {
      items,
      expValue: getValue(['experience', 'exp']),
      workTypeValue: getValue(['work_type', 'work type']),
      employmentTypeValue: getValue(['employment_type', 'employment type']),
      rateValue: getValue(['rate', 'hourly']),
      visaValue: getValue(['visa']),
      locationValue: getValue(['location']),
      skillsValue: getValue(['skill']),
    };
  }

  // Same 2-row-clamp + "+N more" / "Show less" pattern used on the /jobs and
  // /hotlist tables (renderClampedField / renderClampedSkills in PulsePage.tsx).
  function renderClampedField(leadId: string, fieldKey: string, value: string, linkClassName: string) {
    if (value === '-') return <span className="text-gray-300">—</span>;
    const cellKey = `${leadId}:${fieldKey}`;
    const isExpanded = expandedFieldKeys.has(cellKey);
    const toggleExpanded = () => {
      setExpandedFieldKeys((prev) => {
        const next = new Set(prev);
        if (next.has(cellKey)) next.delete(cellKey);
        else next.add(cellKey);
        return next;
      });
    };
    const parts = value.split(',').map((part) => part.trim()).filter(Boolean);

    if (parts.length > 1) {
      const itemCap = 2;
      const visibleParts = isExpanded ? parts : parts.slice(0, itemCap);
      const hiddenCount = parts.length - visibleParts.length;
      return (
        <div>
          <span className={isExpanded ? '' : 'line-clamp-2'}>{visibleParts.join(', ')}</span>
          {!isExpanded && hiddenCount > 0 && (
            <button type="button" onClick={(e) => { e.stopPropagation(); toggleExpanded(); }} className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}>
              +{hiddenCount} more
            </button>
          )}
          {isExpanded && parts.length > itemCap && (
            <button type="button" onClick={(e) => { e.stopPropagation(); toggleExpanded(); }} className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}>
              Show less
            </button>
          )}
        </div>
      );
    }

    const isLikelyOverflow = value.length > 36;
    return (
      <div>
        <span className={isExpanded ? '' : 'line-clamp-2'}>{value}</span>
        {isLikelyOverflow && (
          <button type="button" onClick={(e) => { e.stopPropagation(); toggleExpanded(); }} className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}>
            {isExpanded ? 'less' : 'more'}
          </button>
        )}
      </div>
    );
  }

  function renderClampedSkills(leadId: string, skillsValue: string, itemCap: number, linkClassName: string) {
    const skillsList = skillsValue === '-' ? [] : skillsValue.split(',').map((skill) => skill.trim()).filter(Boolean);
    if (skillsList.length === 0) return <span className="text-gray-300">—</span>;
    const isExpanded = expandedSkillsLeadIds.has(leadId);
    const visibleSkills = isExpanded ? skillsList : skillsList.slice(0, itemCap);
    const hiddenCount = skillsList.length - visibleSkills.length;
    return (
      <div>
        <span className={isExpanded ? '' : 'line-clamp-2'}>{visibleSkills.join(', ')}</span>
        {!isExpanded && hiddenCount > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpandedSkillsLeadIds((prev) => new Set(prev).add(leadId));
            }}
            className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}
          >
            +{hiddenCount} more
          </button>
        )}
        {isExpanded && skillsList.length > itemCap && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpandedSkillsLeadIds((prev) => {
                const next = new Set(prev);
                next.delete(leadId);
                return next;
              });
            }}
            className={`ml-1 whitespace-nowrap font-semibold ${linkClassName}`}
          >
            Show less
          </button>
        )}
      </div>
    );
  }

  function leadStatusBadges(lead: TrackerLead) {
    if (!lead.revealedAt && !lead.submittedAt && !lead.verifiedAt) return null;
    return (
      <div className="flex flex-wrap items-center gap-1">
        {lead.revealedAt && (
          <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:border-white/15 dark:bg-white/5 dark:text-slate-300">
            <Eye size={9} /> Revealed {formatAgo(lead.revealedAt)}
          </span>
        )}
        {lead.submittedAt && (
          <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-300">
            <Check size={9} /> Submitted {formatAgo(lead.submittedAt)}
          </span>
        )}
        {lead.verifiedAt && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300">
            <Check size={9} /> Verified
          </span>
        )}
      </div>
    );
  }

  function renderJobsCards() {
    const linkClass = 'text-blue-600 dark:text-cyan-400 hover:underline';
    return (
      <div className="grid grid-cols-1 gap-2 bg-[#f3f2ee] p-1.5 dark:bg-[#141619] lg:grid-cols-2 lg:gap-3 lg:p-3">
        {vendorHistory.map((lead) => {
          const { expValue, workTypeValue, employmentTypeValue, rateValue, visaValue, locationValue, skillsValue } = getLeadBreakdownFieldValues(lead);

          const statusLabel = lead.verifiedAt ? 'Verified' : (lead.type === 'hotlist' ? 'Requested' : 'Submitted');

          return (
            <div
              key={lead.id}
              className="flex flex-col overflow-hidden rounded-lg border border-[#dfdad2] bg-white dark:border-white/10 dark:bg-[#1E2126]"
            >
              <div className="min-w-0 flex-1 px-3 pt-2.5 pb-2">
                <p className="text-[13px] font-semibold leading-snug text-[#2563EB] dark:text-white">{lead.title}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-[#94A3B8]">
                  <span>{formatAgo(lead.postedAt)}</span>
                  <span>•</span>
                  <span>{lead.posterName || 'Unknown'}</span>
                  {lead.company && (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      <span>•</span>
                      <Building2 size={10} className="shrink-0 text-gray-400" />
                      <span className="text-[#94A3B8]">{lead.company}</span>
                    </span>
                  )}
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${lead.type === 'hotlist' ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-[#94A3B8]'}`}>{lead.type === 'hotlist' ? 'Hotlist' : 'Job'}</span>
                  <PostSourceBadge source={lead.postSource} />
                </div>

                {leadStatusBadges(lead) && <div className="mt-1 flex flex-wrap items-center gap-1">{leadStatusBadges(lead)}</div>}

                {(() => {
                  const chipFields = [
                    { key: 'exp', value: expValue, icon: GraduationCap, title: 'Experience' },
                    { key: 'workType', value: workTypeValue, icon: Laptop, title: 'Work type' },
                    { key: 'empType', value: employmentTypeValue, icon: Briefcase, title: 'Employment type' },
                    { key: 'rate', value: rateValue, icon: DollarSign, title: 'Rate' },
                    { key: 'visa', value: visaValue, icon: Shield, title: 'Visa' },
                    { key: 'location', value: locationValue, icon: MapPin, title: 'Location' },
                  ].filter((field) => field.value !== '-');
                  if (chipFields.length === 0 && skillsValue === '-') return null;
                  return (
                    <div className="mt-1.5 min-w-0 rounded-md bg-transparent px-2.5 py-2 text-left">
                      {chipFields.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1">
                          {chipFields.map((field) => (
                            <span
                              key={field.key}
                              title={field.title}
                              className="inline-flex max-w-full items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] leading-tight text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-[#CBD5E1]"
                            >
                              <field.icon size={10} className="shrink-0 text-gray-400 dark:text-[#94A3B8]" />
                              {renderClampedField(lead.id, field.key, field.value, linkClass)}
                            </span>
                          ))}
                        </div>
                      )}
                      {skillsValue !== '-' && (
                        <div className={chipFields.length > 0 ? 'mt-2' : ''}>
                          <div className="text-[10px] leading-tight break-words text-slate-700 dark:text-[#CBD5E1]">{renderClampedSkills(lead.id, skillsValue, 8, linkClass)}</div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="mt-auto flex items-center justify-around border-t border-gray-200 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => void handleTrackerPreviewPost(lead)}
                  disabled={loadingPreviewLeadId === lead.id}
                  title="Preview original post"
                  className="inline-flex h-9 flex-1 items-center justify-center text-gray-500 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-white/5"
                >
                  {loadingPreviewLeadId === lead.id ? <LogoSpinner size={14} /> : <Eye size={17} strokeWidth={1.75} />}
                </button>
                <button
                  type="button"
                  onClick={() => void handleTrackerViewDraft(lead)}
                  disabled={loadingDraftLeadId === lead.id}
                  title={`${statusLabel} — view the ${statusLabel.toLowerCase()} draft`}
                  className="inline-flex h-9 flex-1 items-center justify-center text-gray-500 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-white/5"
                >
                  {loadingDraftLeadId === lead.id ? <LogoSpinner size={14} /> : (lead.verifiedAt ? <BadgeCheck size={17} strokeWidth={1.75} /> : <Check size={17} strokeWidth={1.75} />)}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function renderJobsTable() {
    const cellClass = 'px-2 py-2 align-top break-words whitespace-normal text-gray-600 dark:text-[#94A3B8]';
    const linkClass = 'text-blue-600 dark:text-cyan-400 hover:underline';
    return (
      <table className="w-full table-fixed border-collapse text-left text-[12px]">
        <colgroup>
          <col style={{ width: '15%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '6%' }} />
          <col style={{ width: '16%' }} />
        </colgroup>
        <thead className="sticky top-0 z-[1] bg-gray-50 dark:bg-[#1F2328]">
          <tr className="border-b border-gray-200 dark:border-white/10 text-[11px] uppercase tracking-wide text-gray-500 dark:text-[#94A3B8]">
            <th className="px-2 py-2">Role</th>
            <th className="px-2 py-2">Company</th>
            <th className="px-2 py-2">Exp</th>
            <th className="px-2 py-2">Work Type</th>
            <th className="px-2 py-2">Emp Type</th>
            <th className="px-2 py-2">Rate</th>
            <th className="px-2 py-2">Visa</th>
            <th className="px-2 py-2">Location</th>
            <th className="px-2 py-2">Skills</th>
            <th className="px-2 py-2">Posted</th>
            <th className="px-2 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {vendorHistory.map((lead) => {
            const { expValue, workTypeValue, employmentTypeValue, rateValue, visaValue, locationValue, skillsValue } = getLeadBreakdownFieldValues(lead);
            return (
              <tr key={lead.id} className="border-b border-gray-100 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5">
                <td className="px-2 py-2 align-top break-words whitespace-normal font-medium text-gray-900 dark:text-slate-100">
                  <button type="button" onClick={() => void handleTrackerViewDraft(lead)} className="text-left hover:text-blue-600 hover:underline">{lead.title}</button>
                  <span className={`ml-1 inline-block rounded px-1 py-0.5 align-middle text-[9px] font-bold uppercase tracking-wide ${lead.type === 'hotlist' ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-600'}`}>{lead.type === 'hotlist' ? 'Hotlist' : 'Job'}</span>
                </td>
                <td className={cellClass}>{lead.company || '—'}</td>
                <td className={cellClass}>{renderClampedField(lead.id, 'exp', expValue, linkClass)}</td>
                <td className={cellClass}>{renderClampedField(lead.id, 'workType', workTypeValue, linkClass)}</td>
                <td className={cellClass}>{renderClampedField(lead.id, 'empType', employmentTypeValue, linkClass)}</td>
                <td className={cellClass}>{renderClampedField(lead.id, 'rate', rateValue, linkClass)}</td>
                <td className={cellClass}>{renderClampedField(lead.id, 'visa', visaValue, linkClass)}</td>
                <td className={cellClass}>{renderClampedField(lead.id, 'location', locationValue, linkClass)}</td>
                <td className={cellClass}>{renderClampedSkills(lead.id, skillsValue, 4, linkClass)}</td>
                <td className={cellClass}>{formatAgo(lead.postedAt)}</td>
                <td className="px-2 py-2 align-top">{leadStatusBadges(lead)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  // ── CSV download helpers ──────────────────────────────────────────────────

  function downloadSubs(ids: Set<string>) {
    const rows = (ids.size > 0 ? filteredSubs.filter(s => ids.has(s.id)) : filteredSubs)
      .map(s => [formatDate(s.submission_date), s.candidate_name, s.submission_type, s.client_name, s.vendor_name, s.skill_set, s.job_location, s.rate, s.submitted_by]);
    downloadCsv('submissions.csv', ['Date', 'Candidate', 'Type', 'Client', 'Vendor', 'Skill Set', 'Location', 'Rate', 'Submitted By'], rows);
  }

  function downloadVendors(ids: Set<string>) {
    const rows = (ids.size > 0 ? filteredVendors.filter(v => ids.has(v.id)) : filteredVendors)
      .map(v => [v.name, v.contact_person, v.email, v.contact, v.location, fmtIso(v.created_at)]);
    downloadCsv('vendors.csv', ['Name', 'Contact Person', 'Email', 'Phone', 'Location', 'Added On'], rows);
  }

  function downloadClients(ids: Set<string>) {
    const rows = (ids.size > 0 ? filteredClients.filter(c => ids.has(c.id)) : filteredClients)
      .map(c => [c.name, c.contact_person, c.email, c.phone, c.location, fmtIso(c.created_at)]);
    downloadCsv('clients.csv', ['Name', 'Contact Person', 'Email', 'Phone', 'Location', 'Added On'], rows);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="h-screen flex flex-col">
        <AppNav />
        <div className="flex-1 flex items-center justify-center">
          <LogoSpinner />
        </div>
      </div>
    );
  }

  function toggleExpand(set: Set<string>, id: string, setter: React.Dispatch<React.SetStateAction<Set<string>>>) {
    setter(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-[#f3f2ee] overflow-hidden overscroll-none pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0">
      <AppNav />

      {/* ── Global toolbar ── */}
      <div className="sticky top-0 z-20 bg-[#f3f2ee] px-2 py-2 flex items-center gap-2">
        {/* Search */}
        <div className="flex flex-1 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5">
          <Search size={11} className="text-gray-400" />
          <input
            type="text"
            placeholder="Search contacts and revealed jobs..."
            value={pendingGlobalSearch}
            onChange={e => setPendingGlobalSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                applyGlobalSearch();
              }
            }}
            className="w-full border-0 bg-transparent text-[12px] text-gray-700 outline-none placeholder:text-gray-400"
          />
          {pendingGlobalSearch && (
            <button
              onClick={() => {
                setPendingGlobalSearch('');
                setGlobalSearch('');
              }}
              className="rounded-full p-0.5 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-600"
            >
              <X size={11} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={applyGlobalSearch}
          className="rounded-full border border-blue-600 bg-blue-600 p-1.5 text-white transition hover:bg-blue-700"
          aria-label="Search"
        >
          <Search size={12} />
        </button>

        {/* Date range picker */}
        {!isSearching && (
          <div className="relative shrink-0" ref={dateRef}>
            <button
              onClick={() => setDateOpen(o => !o)}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-100"
            >
              <Clock3 size={11} />
              <span>{trackerDateShortLabel[datePreset]}</span>
            </button>
            {dateOpen && (
              <div className="absolute right-0 top-[calc(100%+6px)] z-30 w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-2xl">
                <div className="space-y-0.5 mb-3">
                  {DATE_PRESETS.filter(p => p.id !== 'custom').map(p => (
                    <button
                      key={p.id}
                      onClick={() => applyPreset(p.id)}
                      className={`w-full text-left px-3 py-1.5 text-[13px] rounded-lg transition-colors ${datePreset === p.id && !isSearching ? 'bg-blue-600 text-white font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setDatePreset('custom')}
                    className={`w-full text-left px-3 py-1.5 text-[13px] rounded-lg transition-colors ${datePreset === 'custom' ? 'bg-blue-600 text-white font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    Custom range
                  </button>
                </div>
                {datePreset === 'custom' && (
                  <div className="border-t border-gray-100 pt-3 space-y-2">
                    <div>
                      <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wide block mb-1">From</label>
                      <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-full px-2 py-1.5 text-[13px] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wide block mb-1">To</label>
                      <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-full px-2 py-1.5 text-[13px] border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <button onClick={applyCustom} disabled={!customStart || !customEnd} className="w-full py-1.5 text-[13px] font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors">
                      Apply
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isSearching && (
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-1.5 text-[11px] font-semibold text-blue-700">
            {filteredSubs.length + filteredVendors.length} results across all data
          </span>
        )}
      </div>

      {/* ── Page content: 2 columns – Contacts (narrow) + Jobs History (wide) ── */}
      <div className="flex-1 grid grid-cols-[minmax(0,40%)_minmax(0,60%)] lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)] gap-0 overflow-hidden">

        {/* ════════════════ CONTACTS LIST (narrow) ════════════════ */}
        <div className="min-w-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="shrink-0 h-[44px] flex items-center gap-2 px-3 border-b border-gray-200 bg-white">
            <span className="text-[13px] font-bold text-gray-700 uppercase tracking-wider">Contacts</span>
            <span className="text-[11px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded ring-1 ring-amber-200">{filteredVendors.length}</span>
            {selVendor.size > 0 && (
              <button onClick={() => downloadVendors(selVendor)} className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Download selected">
                <Download size={13} />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            {filteredVendors.length === 0 ? (
              <div className="py-16 text-center text-[13px] text-gray-400">
                {isSearching ? 'No vendors match your search.' : `No vendors in ${dateLabel}.`}
              </div>
            ) : (
              <table className="w-full table-fixed border-collapse text-left text-[12px]">
                <colgroup>
                  <col style={{ width: '46%' }} />
                  <col style={{ width: '36%' }} />
                  <col style={{ width: '18%' }} />
                </colgroup>
                <thead className="sticky top-0 z-[1] bg-gray-50 dark:bg-[#1F2328]">
                  <tr className="border-b border-gray-200 text-[11px] uppercase tracking-wide text-gray-500 dark:border-white/10 dark:text-[#94A3B8]">
                    <th className="px-2.5 py-2">Name</th>
                    <th className="px-2.5 py-2">Email</th>
                    <th className="px-2.5 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredVendors.map((v) => {
                    const subCount = submissions.filter(s => s.vendor_name === v.name).length;
                    const isActive = activeVendorId === v.id;
                    return (
                      <tr
                        key={v.id}
                        onClick={() => handleVendorRowClick(v)}
                        className={`cursor-pointer border-b border-gray-100 transition-colors dark:border-white/10 ${isActive ? 'bg-amber-50/70 dark:bg-[#30353D]' : 'bg-white hover:bg-amber-50/30 dark:bg-[#1F2328] dark:hover:bg-[#272C33]'}`}
                      >
                        <td className="px-2.5 py-2.5 align-top">
                          <div className="flex items-start gap-1.5">
                            <p className="min-w-0 flex-1 break-words font-semibold leading-snug text-gray-900 dark:text-slate-100">{v.name}</p>
                            {subCount > 0 && <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">{subCount}</span>}
                          </div>
                          {v.contact_person && (
                            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-500 dark:text-slate-400">
                              <User size={9} className="shrink-0 text-gray-400" />
                              {revealedFields.has(`cp-${v.id}`) ? (
                                <span className="truncate">{v.contact_person}</span>
                              ) : (
                                <span className="truncate text-gray-400">{v.contact_person.slice(0, 3)}•••</span>
                              )}
                              <button onClick={(e) => { e.stopPropagation(); setRevealedFields(prev => { const n = new Set(prev); const k = `cp-${v.id}`; n.has(k) ? n.delete(k) : n.add(k); return n; }); }} className="shrink-0 rounded p-0.5 text-gray-400 hover:text-blue-600">
                                {revealedFields.has(`cp-${v.id}`) ? <EyeOff size={8} /> : <Eye size={8} />}
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-2.5 py-2.5 align-top">
                          {v.email ? (
                            <div className="flex items-center gap-1">
                              {revealedFields.has(`email-${v.id}`) ? (
                                <a href={`mailto:${v.email}`} onClick={(e) => e.stopPropagation()} className="min-w-0 flex-1 truncate text-blue-600 hover:underline dark:text-cyan-400">{v.email}</a>
                              ) : (
                                <span className="min-w-0 flex-1 truncate text-gray-400">{v.email.slice(0, 3)}@•••</span>
                              )}
                              <button onClick={(e) => { e.stopPropagation(); setRevealedFields(prev => { const n = new Set(prev); const k = `email-${v.id}`; n.has(k) ? n.delete(k) : n.add(k); return n; }); }} className="shrink-0 rounded p-0.5 text-gray-400 hover:text-blue-600" title={revealedFields.has(`email-${v.id}`) ? 'Hide' : 'Reveal'}>
                                {revealedFields.has(`email-${v.id}`) ? <EyeOff size={9} /> : <Eye size={9} />}
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(v.email); setCopiedField(`email-${v.id}`); setTimeout(() => setCopiedField(null), 1500); }} className="shrink-0 rounded p-0.5 text-gray-400 hover:text-blue-600" title="Copy">
                                {copiedField === `email-${v.id}` ? <Check size={9} className="text-green-500" /> : <Copy size={9} />}
                              </button>
                            </div>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-2.5 py-2.5 align-top text-right">
                          <div className="inline-flex items-center gap-1">
                            <button onClick={(e) => { e.stopPropagation(); openEditVendor(v); }} className="rounded p-0.5 text-gray-400 hover:text-blue-600" title="Edit"><Pencil size={11} /></button>
                            <button onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'vendor', id: v.id }); }} className="rounded p-0.5 text-gray-400 hover:text-red-600" title="Delete"><Trash2 size={11} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ════════════════ VENDOR HISTORY COLUMN ════════════════ */}
        <div className="min-w-0 bg-white dark:bg-[#1B1D21] flex flex-col overflow-hidden">
          <div className="shrink-0 h-[44px] flex items-center gap-2 px-3 border-b border-gray-200 dark:border-white/10 bg-white dark:bg-[#1F2328]">
            <span className="text-[13px] font-bold text-gray-700 dark:text-slate-200 uppercase tracking-wider">Jobs</span>
            <span className="text-[11px] font-bold text-blue-700 dark:text-slate-200 bg-blue-50 dark:bg-[#2A2E35] px-1.5 py-0.5 rounded ring-1 ring-blue-200 dark:ring-white/10">{vendorHistory.length}</span>
            {!isMobileViewport && (
              <div className="ml-2 flex shrink-0 items-center rounded-md border border-gray-200 bg-gray-50 p-0.5 dark:border-white/10 dark:bg-white/5">
                {(['card', 'table'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setJobsLayoutMode(mode)}
                    className={`rounded px-2 py-1 text-[11px] font-semibold capitalize transition ${jobsLayoutMode === mode ? 'bg-white text-blue-700 shadow-sm dark:bg-[#2A2E35] dark:text-blue-300' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            )}
            {activeVendorId ? (
              <span className="ml-auto text-[11px] text-gray-500 dark:text-[#94A3B8] truncate max-w-[140px]">
                {vendors.find(v => v.id === activeVendorId)?.name}
              </span>
            ) : (
              <span className="ml-auto text-[11px] text-gray-500 dark:text-[#94A3B8] truncate max-w-[140px]">All contacts</span>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            {vendorHistory.length === 0 ? (
              <div className="py-16 text-center text-[13px] text-gray-400 dark:text-[#94A3B8]">
                <History size={18} className="mx-auto text-gray-300 dark:text-slate-600 mb-2" />
                <p className="font-medium text-gray-500 dark:text-[#CBD5E1]">No activity yet</p>
                <p className="mt-1">{activeVendorId ? 'No revealed or submitted leads found for this contact yet.' : 'No revealed or submitted leads found across these contacts yet.'}</p>
              </div>
            ) : jobsLayoutMode === 'table' && !isMobileViewport ? (
              renderJobsTable()
            ) : (
              renderJobsCards()
            )}
          </div>
        </div>

      </div>

      {/* ── ADD/EDIT VENDOR MODAL ── */}
      {modal === 'vendor' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-[17px] font-bold text-gray-900">{editingId ? 'Edit Vendor' : 'Add Vendor'}</h2>
                <p className="text-[13px] text-gray-400 mt-0.5">Vendor / staffing company details</p>
              </div>
              <button onClick={() => setModal(null)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"><X size={16} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Field label="Vendor / Company Name" icon={Building2}>
                <Combobox value={vendorForm.name} onChange={handleVendorNameSelect} options={vendorNameOpts} recentOptions={recentVendorNames} placeholder="Search existing or type a new name…" autoFocus />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Contact Person" icon={User}>
                  <input type="text" value={vendorForm.contact_person} onChange={e => setVendorForm(f => ({ ...f, contact_person: e.target.value }))} placeholder="Full name" className={inputCls} />
                </Field>
                <Field label="Email" icon={Mail}>
                  <input type="email" value={vendorForm.email} onChange={e => setVendorForm(f => ({ ...f, email: e.target.value }))} placeholder="vendor@email.com" className={inputCls} />
                </Field>
                <Field label="Contact Number" icon={Phone}>
                  <input type="tel" value={vendorForm.contact} onChange={e => setVendorForm(f => ({ ...f, contact: e.target.value }))} placeholder="+1 (555) 000-0000" className={inputCls} />
                </Field>
                <Field label="Location" icon={MapPin}>
                  <input type="text" value={vendorForm.location} onChange={e => setVendorForm(f => ({ ...f, location: e.target.value }))} placeholder="City, State" className={inputCls} />
                </Field>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-[15px] text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={saveVendor} disabled={saving} className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-[15px] font-semibold rounded-lg transition-colors shadow-sm">
                <Save size={13} />{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Vendor'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD/EDIT CLIENT MODAL ── */}
      {modal === 'client' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-[17px] font-bold text-gray-900">{editingId ? 'Edit Client' : 'Add Client'}</h2>
                <p className="text-[13px] text-gray-400 mt-0.5">End client / hiring company details</p>
              </div>
              <button onClick={() => setModal(null)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"><X size={16} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <Field label="Company / Client Name" icon={Building2}>
                <Combobox value={clientForm.name} onChange={val => setClientForm(f => ({ ...f, name: val }))} options={clientNameOpts} recentOptions={recentClientNames} placeholder="Search existing or type a new name…" autoFocus />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Contact Person" icon={User}>
                  <input type="text" value={clientForm.contact_person} onChange={e => setClientForm(f => ({ ...f, contact_person: e.target.value }))} placeholder="Full name" className={inputCls} />
                </Field>
                <Field label="Email" icon={Mail}>
                  <input type="email" value={clientForm.email} onChange={e => setClientForm(f => ({ ...f, email: e.target.value }))} placeholder="contact@company.com" className={inputCls} />
                </Field>
                <Field label="Phone" icon={Phone}>
                  <input type="tel" value={clientForm.phone} onChange={e => setClientForm(f => ({ ...f, phone: e.target.value }))} placeholder="+1 (555) 000-0000" className={inputCls} />
                </Field>
                <Field label="Location" icon={MapPin}>
                  <input type="text" value={clientForm.location} onChange={e => setClientForm(f => ({ ...f, location: e.target.value }))} placeholder="City, State" className={inputCls} />
                </Field>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-[15px] text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={saveClient} disabled={saving} className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-[15px] font-semibold rounded-lg transition-colors shadow-sm">
                <Save size={13} />{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Client'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD/EDIT SUBMISSION MODAL ── */}
      {modal === 'submission' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-[17px] font-bold text-gray-900">{editingId ? 'Edit Submission' : 'New Submission'}</h2>
                <p className="text-[13px] text-gray-400 mt-0.5">Fields auto-suggest from bench, vendors &amp; clients</p>
              </div>
              <button onClick={() => setModal(null)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="flex items-center gap-1.5 text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  <Tag size={11} className="text-gray-400" />Submission Type
                </label>
                <div className="flex gap-2">
                  {SUBMISSION_TYPES.map(t => (
                    <button key={t} type="button" onClick={() => setSubForm(f => ({ ...f, submission_type: t }))}
                      className={`flex-1 py-2 text-[15px] font-semibold rounded-lg border transition-all ${
                        subForm.submission_type === t
                          ? t === 'Client' ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                          : t === 'Vendor' ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                          : 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="Candidate Name" icon={User}>
                <Combobox value={subForm.candidate_name} onChange={(val, opt) => { if (opt) handleSubCandidateSelect(val); else setSubForm(f => ({ ...f, candidate_name: val })); }} options={candidateOptions} recentOptions={recentCandidates} placeholder="Search bench or type a name…" autoFocus />
              </Field>
              <Field label="Skill Set" icon={Briefcase}>
                <input type="text" value={subForm.skill_set} onChange={e => setSubForm(f => ({ ...f, skill_set: e.target.value }))} placeholder="e.g. React, Node.js, AWS" className={inputCls} />
              </Field>
              {subForm.submission_type === 'Vendor' && (
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-amber-500 mb-3">Vendor Details</p>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Vendor Name" icon={Building2}>
                      <Combobox value={subForm.vendor_name} onChange={(val, opt) => { if (opt) handleSubVendorSelect(val); else setSubForm(f => ({ ...f, vendor_name: val })); }} options={vendorOptions} recentOptions={recentVendorOpts} placeholder="Search vendors…" />
                    </Field>
                    <Field label="Vendor Email" icon={Mail}>
                      <input type="email" value={subForm.vendor_email} onChange={e => setSubForm(f => ({ ...f, vendor_email: e.target.value }))} placeholder="vendor@email.com" className={inputCls} />
                    </Field>
                    <Field label="Contact Number" icon={Phone}>
                      <input type="tel" value={subForm.vendor_contact} onChange={e => setSubForm(f => ({ ...f, vendor_contact: e.target.value }))} placeholder="+1 555 000 0000" className={inputCls} />
                    </Field>
                  </div>
                </div>
              )}
              {subForm.submission_type === 'Client' && (
                <div className="border-t border-gray-100 pt-4">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-teal-600 mb-3">Client Details</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <Field label="Client Name" icon={Users}>
                        <Combobox value={subForm.client_name} onChange={val => setSubForm(f => ({ ...f, client_name: val }))} options={clientOptions} recentOptions={recentClientOpts} placeholder="Search clients…" />
                      </Field>
                    </div>
                  </div>
                </div>
              )}
              <div className="border-t border-gray-100 pt-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-3">Job Details</p>
                <div className="grid grid-cols-2 gap-4">
                  {subForm.submission_type !== 'Client' && (
                    <Field label="Client Name" icon={Users}>
                      <Combobox value={subForm.client_name} onChange={val => setSubForm(f => ({ ...f, client_name: val }))} options={clientOptions} recentOptions={recentClientOpts} placeholder="Search clients…" />
                    </Field>
                  )}
                  <Field label="Job Location" icon={MapPin}>
                    <Combobox value={subForm.job_location} onChange={val => setSubForm(f => ({ ...f, job_location: val }))} options={locationOptions} recentOptions={locationOptions.slice(0, 3)} placeholder="City, State or Remote" />
                  </Field>
                  <Field label="Rate $" icon={DollarSign}>
                    <Combobox value={subForm.rate} onChange={val => setSubForm(f => ({ ...f, rate: val }))} options={rateOptions} recentOptions={rateOptions.slice(0, 3)} placeholder="e.g. $65/hr" />
                  </Field>
                </div>
              </div>
              <div className="border-t border-gray-100 pt-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-3">Submission Info</p>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Submitted By" icon={UserCheck}>
                    <Combobox value={subForm.submitted_by} onChange={val => setSubForm(f => ({ ...f, submitted_by: val }))} options={submittedByOptions} recentOptions={submittedByOptions.slice(0, 3)} placeholder="Recruiter name" />
                  </Field>
                  <Field label="Date" icon={Calendar}>
                    <input type="date" value={subForm.submission_date} onChange={e => setSubForm(f => ({ ...f, submission_date: e.target.value }))} className={inputCls} />
                  </Field>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-[15px] text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={saveSubmission} disabled={saving} className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-[15px] font-semibold rounded-lg transition-colors shadow-sm">
                <Save size={13} />{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Submission'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── POST CONTENT PREVIEW MODAL ── */}
      {trackerPostPreview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setTrackerPostPreview(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="tracker-post-preview-title"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-gray-200 bg-white shadow-xl"
          >
            <div className="flex items-start gap-2.5 border-b border-gray-100 p-4">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-500">
                <Eye size={16} />
              </span>
              <h2 id="tracker-post-preview-title" className="min-w-0 flex-1 truncate text-[15px] font-semibold text-gray-900">{trackerPostPreview.title}</h2>
              <button
                type="button"
                onClick={() => setTrackerPostPreview(null)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                aria-label="Close post preview"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-700">{trackerPostPreview.content}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── PAST GENERATED DRAFT MODAL ── */}
      {trackerDraftPreview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setTrackerDraftPreview(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="tracker-draft-preview-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-xl"
          >
            <div className="flex items-start gap-2.5">
              <div className="min-w-0 flex-1">
                <h2 id="tracker-draft-preview-title" className="text-[15px] font-semibold text-gray-900">{trackerDraftPreview.leadType === 'hotlist' ? 'Requested draft' : 'Submitted draft'}</h2>
                {(trackerDraftPreview.jobTitle || trackerDraftPreview.company) && (
                  <p className="mt-0.5 truncate text-[13px] text-gray-500">
                    {trackerDraftPreview.jobTitle}{trackerDraftPreview.jobTitle && trackerDraftPreview.company ? ' · ' : ''}{trackerDraftPreview.company}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setTrackerDraftPreview(null)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                aria-label="Close draft preview"
              >
                <X size={14} />
              </button>
            </div>

            <div className="relative mt-3">
              <input
                value={trackerDraftPreview.subject}
                readOnly
                placeholder="Subject"
                className="w-full rounded-md border border-gray-200 bg-gray-50 py-1.5 pl-3 pr-8 text-[13px] font-medium text-gray-900 outline-none"
              />
              <button
                type="button"
                onClick={() => void copyText(trackerDraftPreview.subject, 'Subject')}
                className="absolute right-1.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Copy subject"
              >
                <Copy size={11} />
              </button>
            </div>
            <div className="relative mt-2">
              <textarea
                value={trackerDraftPreview.emailContent}
                readOnly
                rows={10}
                className="w-full resize-none rounded-md border border-gray-200 bg-gray-50 py-2 pl-3 pr-8 text-[13px] leading-relaxed text-gray-900 outline-none"
              />
              <button
                type="button"
                onClick={() => void copyText(trackerDraftPreview.emailContent, 'Email body')}
                className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Copy email body"
              >
                <Copy size={11} />
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-gray-700">{trackerDraftPreview.vendorEmail || 'No email on file'}</span>
              <button
                type="button"
                onClick={() => void copyText(trackerDraftPreview.vendorEmail, 'Email ID')}
                disabled={!trackerDraftPreview.vendorEmail}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Copy email ID"
              >
                <Copy size={11} />
              </button>
            </div>
            <div className="mt-3 flex items-center justify-end">
              <button
                type="button"
                onClick={() => void copyText(
                  `${trackerDraftPreview.vendorEmail}\n${trackerDraftPreview.subject}\n\n${trackerDraftPreview.emailContent}`,
                  'Email',
                )}
                disabled={!trackerDraftPreview.vendorEmail || !trackerDraftPreview.subject.trim() || !trackerDraftPreview.emailContent.trim()}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-blue-600 px-2.5 text-[12px] font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Copy size={11} />
                Copy All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRM ── */}
      {/* Duplicate Submission Warning */}
      {duplicateWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDuplicateWarning(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                <AlertTriangle size={20} className="text-amber-500" />
              </div>
              <div>
                <h3 className="text-[17px] font-bold text-gray-900">Duplicate Submission Detected</h3>
                <p className="text-[15px] text-gray-500 mt-0.5">
                  <span className="font-semibold text-gray-700">{subForm.candidate_name}</span> has already been submitted to{' '}
                  <span className="font-semibold text-gray-700">
                    {subForm.submission_type === 'Vendor' ? subForm.vendor_name : subForm.client_name}
                  </span>
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-5 max-h-40 overflow-y-auto space-y-2">
              {duplicateWarning.existing.map(s => (
                <div key={s.id} className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-gray-600 font-medium truncate">{s.submitted_by || 'Unknown'}</span>
                    <span className="text-gray-400">submitted on</span>
                    <span className="font-medium text-gray-700">{new Date(s.submission_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[13px] text-gray-500 mb-4">Are you sure you want to proceed with this submission?</p>

            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setDuplicateWarning(null)}
                className="px-4 py-2 text-[15px] text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setDuplicateWarning(null); saveSubmission(true); }}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-[15px] font-semibold rounded-lg transition-colors"
              >
                Submit Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h3 className="text-[17px] font-bold text-gray-900 mb-1.5">
              Delete {deleteTarget.type.charAt(0).toUpperCase() + deleteTarget.type.slice(1)}?
            </h3>
            <p className="text-[15px] text-gray-500 mb-5">This cannot be undone.</p>
            <div className="flex justify-end gap-2.5">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-[15px] text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={confirmDelete} className="px-5 py-2 bg-red-500 hover:bg-red-600 text-white text-[15px] font-semibold rounded-lg transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
