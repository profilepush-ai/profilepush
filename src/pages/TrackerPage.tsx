import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Search, Trash2, Pencil, X, Save, User, Briefcase,
  Building2, Mail, Phone, MapPin, DollarSign, Calendar,
  UserCheck, ChevronDown, ChevronUp, FileText, Tag, Clock, Users, Download,
  AlertTriangle, History, Eye, EyeOff, Copy, Check, Clock3, Sparkles,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Profile } from '../types/database';
import { buildScoreBreakdownDisplayItems } from '../lib/radar-match-ui';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Vendor { id: string; name: string; contact_person: string; email: string; contact: string; location: string; created_at: string; }
interface Client { id: string; name: string; contact_person: string; email: string; phone: string; location: string; created_at: string; }
interface RevealedContactJob {
  id: string;
  company_name: string | null;
  posted_by_name: string | null;
  poster_email: string | null;
  poster_phone: string | null;
}
interface VendorHistoryJob {
  id: string;
  job_title: string;
  company_name: string;
  location: string;
  posted_by_name: string;
  poster_email: string;
  platform: string;
  created_at: string;
  revealed_at: string | null;
  extracted_role_normalized: string | null;
  match_score: number | null;
  score_breakdown: Record<string, unknown> | null;
}
interface Submission {
  id: string; candidate_name: string; skill_set: string; vendor_name: string;
  vendor_email: string; vendor_contact: string; client_name: string; job_location: string;
  rate: string; submitted_by: string; submission_date: string; submission_type: string; created_at: string;
}

type EmailDraftTabId = 'pitching' | 'requestDetails';

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
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 pr-8 placeholder-gray-300 transition-all"
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
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Recent</span>
            </div>
          )}
          {listItems.map((opt, i) => (
            <button
              key={i}
              onMouseDown={e => { e.preventDefault(); setQuery(opt.value); onChange(opt.value, opt); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 transition-colors"
            >
              <div className="text-sm font-medium text-gray-800 truncate">{opt.value}</div>
              {opt.subtitle && <div className="text-xs text-gray-400 truncate">{opt.subtitle}</div>}
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
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        <Icon size={11} className="text-gray-400" />{label}
      </label>
      {children}
    </div>
  );
}

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-300 transition-all';

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

function formatBreakdownFieldName(key: string) {
  return key
    .replace(/_/g, ' ')
    .replace(/\bmatch\b/gi, '')
    .replace(/\bemployment\b/gi, 'Emp')
    .replace(/\bexperience\b/gi, 'Exp')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
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
  const { user } = useAuth();
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
  type ModalType = 'vendor' | 'client' | 'submission' | 'email' | null;
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
  const [vendorHistory, setVendorHistory] = useState<VendorHistoryJob[]>([]);
  const [expandedHistoryBreakdownIds, setExpandedHistoryBreakdownIds] = useState<Set<string>>(new Set());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set());
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type?: 'success' | 'error' } | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{ existing: Submission[]; } | null>(null);
  const [activeEmailJob, setActiveEmailJob] = useState<VendorHistoryJob | null>(null);
  const [trackerEmailDrafts, setTrackerEmailDrafts] = useState<{ pitching: string; requestDetails: string }>({
    pitching: '',
    requestDetails: '',
  });
  const [selectedEmailDraftTab, setSelectedEmailDraftTab] = useState<EmailDraftTabId>('pitching');

  // Close date picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) setDateOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const loadOwnRevealedContacts = async (): Promise<RevealedContactJob[]> => {
      if (!user?.id) return [];
      const { data: actions } = await supabase
        .from('pulse_lead_actions')
        .select('lead_id')
        .eq('user_id', user.id)
        .eq('action_type', 'revealed');
      const leadIds = [...new Set((actions ?? []).map((action) => action.lead_id))];
      if (leadIds.length === 0) return [];
      const { data: jobs } = await supabase
        .from('social_jobs')
        .select('id, company_name, posted_by_name, poster_email, poster_phone')
        .in('id', leadIds);
      return (jobs ?? []) as RevealedContactJob[];
    };

    const [vRes, cRes, sRes, pRes, revealedContacts] = await Promise.all([
      supabase.from('vendors').select('*').order('created_at', { ascending: false }),
      supabase.from('clients').select('*').order('created_at', { ascending: false }),
      supabase.from('submissions').select('*').order('submission_date', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('profiles').select('id,candidate_name,core_skills,preferred_locations,location,city,state,desired_salary_min').order('created_at', { ascending: false }),
      loadOwnRevealedContacts(),
    ]);
    if (!vRes.error) {
      const normalized = (value: string | null | undefined) => value?.trim().toLowerCase() ?? '';
      const ownVendors = (vRes.data ?? []).filter((vendor) => revealedContacts.some((job) => {
        const vendorEmail = normalized(vendor.email);
        const vendorPhone = normalized(vendor.contact);
        const vendorName = normalized(vendor.name);
        const contactPerson = normalized(vendor.contact_person);
        return (vendorEmail && vendorEmail === normalized(job.poster_email))
          || (vendorPhone && vendorPhone === normalized(job.poster_phone))
          || (contactPerson && contactPerson === normalized(job.posted_by_name))
          || (vendorName && [normalized(job.company_name), normalized(job.posted_by_name)].includes(vendorName));
      }));
      setVendors(ownVendors);
    }
    if (!cRes.error) setClients(cRes.data ?? []);
    if (!sRes.error) setSubmissions(sRes.data ?? []);
    if (!pRes.error) setProfiles((pRes.data ?? []) as Profile[]);
    setLoading(false);
  }, [user?.id]);

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

  const filteredVendorIdsKey = filteredVendors.map((vendor) => vendor.id).join(',');

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

  const loadVendorHistoryForVendors = useCallback(async (vendorsToMatch: Vendor[]) => {
    setHistoryLoading(true);
    setVendorHistory([]);

    if (!user?.id || vendorsToMatch.length === 0) {
      setHistoryLoading(false);
      return;
    }

    // Get revealed lead IDs for this account
    const { data: actions, error: actionsErr } = await supabase
      .from('pulse_lead_actions')
      .select('lead_id, created_at')
      .eq('user_id', user.id)
      .eq('action_type', 'revealed');

    if (actionsErr || !actions?.length) {
      setHistoryLoading(false);
      return;
    }

    const revealedIds = (actions as Array<{ lead_id: string; created_at: string }>).map(a => a.lead_id);
    const revealDateByLeadId = new Map<string, string>();
    for (const action of actions as Array<{ lead_id: string; created_at: string }>) {
      if (!revealDateByLeadId.has(action.lead_id)) {
        revealDateByLeadId.set(action.lead_id, action.created_at);
      }
    }

    const fetchJobsForVendor = async (vendor: Vendor) => {
      // Query social_jobs matching this vendor by name or email, filtered to revealed IDs
      let query = supabase
        .from('social_jobs')
        .select('id, job_title, company_name, location, posted_by_name, poster_email, platform, created_at, extracted_role_normalized')
        .in('id', revealedIds)
        .order('created_at', { ascending: false })
        .limit(100);

      // Match by vendor name, email, or contact person
      const conditions: string[] = [];
      if (vendor.name) conditions.push(`posted_by_name.ilike.%${vendor.name}%`);
      if (vendor.email) conditions.push(`poster_email.eq.${vendor.email}`);
      if (vendor.contact_person) conditions.push(`posted_by_name.ilike.%${vendor.contact_person}%`);
      if (vendor.name) conditions.push(`company_name.ilike.%${vendor.name}%`);

      if (conditions.length === 0) return [] as VendorHistoryJob[];

      const { data: jobs, error: jobsErr } = await query.or(conditions.join(','));
      if (jobsErr || !jobs) return [] as VendorHistoryJob[];

      const jobIds = (jobs as Array<{ id: string }>).map((job) => job.id);
      const matchByJobId = new Map<string, { final_average_score: number | null; score_breakdown: Record<string, unknown> | null }>();

      if (jobIds.length > 0) {
        const { data: matches } = await supabase
          .from('radar_match_results')
          .select('job_id, final_average_score, score_breakdown, created_at')
          .in('job_id', jobIds)
          .order('created_at', { ascending: false });

        for (const row of (matches ?? []) as Array<{ job_id: string; final_average_score: number | null; score_breakdown: Record<string, unknown> | null }>) {
          if (!matchByJobId.has(row.job_id)) {
            matchByJobId.set(row.job_id, {
              final_average_score: row.final_average_score,
              score_breakdown: row.score_breakdown,
            });
          }
        }
      }

      return (jobs as Array<Omit<VendorHistoryJob, 'match_score' | 'score_breakdown'>>).map((job) => {
        const match = matchByJobId.get(job.id);
        return {
          ...job,
          match_score: match?.final_average_score ?? null,
          score_breakdown: match?.score_breakdown ?? null,
          revealed_at: revealDateByLeadId.get(job.id) ?? null,
        };
      });
    };

    const allJobs = (await Promise.all(vendorsToMatch.map(fetchJobsForVendor))).flat();
    setVendorHistory(Array.from(new Map(allJobs.map((job) => [job.id, job])).values()));
    setHistoryLoading(false);
  }, [user?.id]);

  const loadVendorHistory = useCallback(async (vendor: Vendor) => {
    await loadVendorHistoryForVendors([vendor]);
  }, [loadVendorHistoryForVendors]);

  useEffect(() => {
    if (activeVendorId) return;
    void loadVendorHistoryForVendors(filteredVendors);
  }, [activeVendorId, filteredVendorIdsKey, loadVendorHistoryForVendors]);

  const generateTrackerEmailDrafts = useCallback((job: VendorHistoryJob) => {
    const breakdownItems = buildScoreBreakdownDisplayItems(
      job.score_breakdown as Record<string, number | { score: number; candidate_value: string; job_value: string; rule: string }> | undefined,
    );

    const pickDetail = (patterns: RegExp[]) => {
      const item = breakdownItems.find((entry) => patterns.some((pattern) => pattern.test(entry.key)));
      return item?.detail?.candidate_value?.trim() || '-';
    };

    const role = job.job_title || job.extracted_role_normalized || 'requirement';
    const companyText = job.company_name ? ` at ${job.company_name}` : '';

    const profileHighlights = [
      `- Role: ${pickDetail([/role/i, /title/i, /position/i])}`,
      `- Exp: ${pickDetail([/experience/i, /years?_?exp/i, /exp/i])}`,
      `- Location: ${pickDetail([/location/i, /preferred_location/i, /preferred_locations/i])}`,
      `- Visa: ${pickDetail([/visa/i, /work_authorization/i, /authorization/i])}`,
      `- Rate: ${pickDetail([/rate/i, /salary/i, /bill_rate/i])}`,
      `- Skills: ${pickDetail([/skill/i])}`,
    ];

    const pitching = [
      `Hi ${job.posted_by_name || 'there'},`,
      '',
      `I saw your post for the ${role}${companyText}.`,
      'I have a profile that looks highly relevant and can share it right away.',
      '',
      'Profile Highlights:',
      ...profileHighlights,
      '',
      'Please let me know if you would like me to send the profile and availability.',
      '',
      'Thanks,',
      defaultSubmittedBy || (user?.email?.split('@')[0] ?? 'ProfilePush User'),
    ].join('\n');

    const requestDetails = [
      `Hi ${job.posted_by_name || 'there'},`,
      '',
      `Following up on the ${role}${companyText}.`,
      'Could you please share the following details so I can submit the best-fit profile quickly?',
      '',
      '- Full JD / must-have skills',
      '- Interview process and timeline',
      '- Work authorization constraints',
      '- Work type (onsite / hybrid / remote)',
      '- Target bill rate range',
      '- Client/VMS details and submission format',
      '',
      'I can send matching profiles immediately after this.',
      '',
      'Thanks,',
      defaultSubmittedBy || (user?.email?.split('@')[0] ?? 'ProfilePush User'),
    ].join('\n');

    setActiveEmailJob(job);
    setTrackerEmailDrafts({ pitching, requestDetails });
    setSelectedEmailDraftTab('pitching');
    setModal('email');
  }, [defaultSubmittedBy, user?.email]);

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
    if (activeVendorId === vendor.id) {
      setActiveVendorId(null);
      setVendorHistory([]);
    } else {
      setActiveVendorId(vendor.id);
      void loadVendorHistory(vendor);
    }
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
    <div className="h-[100dvh] flex flex-col bg-gray-50 overflow-hidden overscroll-none pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0">
      <AppNav />

      {/* ── Global toolbar ── */}
      <div className="sticky top-0 z-20 border-b border-gray-200 bg-white px-2 py-2 flex items-center gap-2">
        {/* Search */}
        <div className="flex flex-1 items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5">
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
            className="w-full border-0 bg-transparent text-[11px] text-gray-700 outline-none placeholder:text-gray-400"
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
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1.5 text-[10px] font-semibold text-gray-600 transition hover:bg-gray-100"
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
                      className={`w-full text-left px-3 py-1.5 text-xs rounded-lg transition-colors ${datePreset === p.id && !isSearching ? 'bg-blue-600 text-white font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setDatePreset('custom')}
                    className={`w-full text-left px-3 py-1.5 text-xs rounded-lg transition-colors ${datePreset === 'custom' ? 'bg-blue-600 text-white font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    Custom range
                  </button>
                </div>
                {datePreset === 'custom' && (
                  <div className="border-t border-gray-100 pt-3 space-y-2">
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1">From</label>
                      <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide block mb-1">To</label>
                      <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    </div>
                    <button onClick={applyCustom} disabled={!customStart || !customEnd} className="w-full py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors">
                      Apply
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isSearching && (
          <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-1.5 text-[10px] font-semibold text-blue-700">
            {filteredSubs.length + filteredVendors.length} results across all data
          </span>
        )}
      </div>

      {/* ── Page content: 2 columns – Contacts (narrow) + Jobs History (wide) ── */}
      <div className="flex-1 grid grid-cols-[minmax(0,40%)_minmax(0,60%)] lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)] gap-0 overflow-hidden">

        {/* ════════════════ CONTACTS LIST (narrow) ════════════════ */}
        <div className="min-w-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="shrink-0 h-[44px] flex items-center gap-2 px-3 border-b border-gray-200 bg-white">
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Contacts</span>
            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded ring-1 ring-amber-200">{filteredVendors.length}</span>
            {selVendor.size > 0 && (
              <button onClick={() => downloadVendors(selVendor)} className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Download selected">
                <Download size={13} />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {filteredVendors.length === 0 ? (
              <div className="py-16 text-center text-xs text-gray-400">
                {isSearching ? 'No vendors match your search.' : `No vendors in ${dateLabel}.`}
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-white/10">
                {filteredVendors.map((v) => {
                  const subCount = submissions.filter(s => s.vendor_name === v.name).length;
                  const isActive = activeVendorId === v.id;
                  return (
                    <div
                      key={v.id}
                      onClick={() => handleVendorRowClick(v)}
                      className={`px-2.5 sm:px-3.5 py-2.5 sm:py-3 cursor-pointer transition-colors ${isActive ? 'bg-amber-50/70 dark:bg-[#30353D]' : 'bg-white hover:bg-amber-50/30 dark:bg-[#1F2328] dark:hover:bg-[#272C33]'}`}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <p className="text-xs sm:text-sm font-semibold text-gray-900 dark:text-slate-100 break-words whitespace-normal leading-snug">{v.name}</p>
                        <div className="flex items-center gap-1 shrink-0">
                          {subCount > 0 && <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">{subCount}</span>}
                          <button onClick={(e) => { e.stopPropagation(); openEditVendor(v); }} className="p-0.5 rounded text-gray-400 hover:text-blue-600 transition-colors" title="Edit"><Pencil size={10} /></button>
                          <button onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'vendor', id: v.id }); }} className="p-0.5 rounded text-gray-400 hover:text-red-600 transition-colors" title="Delete"><Trash2 size={10} /></button>
                        </div>
                      </div>
                      {v.contact_person && (
                        <div className="flex items-center gap-1 mt-1 text-[11px] sm:text-xs text-gray-600 dark:text-slate-300">
                          <User size={10} className="text-gray-400 dark:text-slate-500 shrink-0" />
                          {revealedFields.has(`cp-${v.id}`) ? (
                            <span className="truncate">{v.contact_person}</span>
                          ) : (
                            <span className="text-gray-400 dark:text-slate-400 truncate">{v.contact_person.slice(0, 3)}•••</span>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); setRevealedFields(prev => { const n = new Set(prev); const k = `cp-${v.id}`; n.has(k) ? n.delete(k) : n.add(k); return n; }); }} className="p-0.5 rounded text-gray-400 hover:text-blue-600 transition-colors shrink-0">
                            {revealedFields.has(`cp-${v.id}`) ? <EyeOff size={9} /> : <Eye size={9} />}
                          </button>
                        </div>
                      )}
                      {v.email && (
                        <div className="flex items-center gap-1 mt-0.5 sm:mt-1 text-[11px] sm:text-xs">
                          <Mail size={10} className="text-gray-400 dark:text-slate-500 shrink-0" />
                          {revealedFields.has(`email-${v.id}`) ? (
                            <a href={`mailto:${v.email}`} onClick={e => e.stopPropagation()} className="text-blue-600 dark:text-cyan-400 hover:underline truncate">{v.email}</a>
                          ) : (
                            <span className="text-gray-400 dark:text-slate-400 truncate">{v.email.slice(0, 3)}@•••</span>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); setRevealedFields(prev => { const n = new Set(prev); const k = `email-${v.id}`; n.has(k) ? n.delete(k) : n.add(k); return n; }); }} className="p-0.5 rounded text-gray-400 hover:text-blue-600 transition-colors shrink-0">
                            {revealedFields.has(`email-${v.id}`) ? <EyeOff size={9} /> : <Eye size={9} />}
                          </button>
                        </div>
                      )}
                      {v.email && (
                        <div className="mt-1.5 sm:mt-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void navigator.clipboard.writeText(v.email);
                              setCopiedField(`email-${v.id}`);
                              setTimeout(() => setCopiedField(null), 1500);
                            }}
                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-2 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-white/15 dark:bg-[#20242A] dark:text-slate-200 dark:hover:bg-[#292E35]"
                          >
                            {copiedField === `email-${v.id}` ? <Check size={10} className="text-green-500" /> : <Copy size={10} />}
                            {copiedField === `email-${v.id}` ? 'Copied' : 'Email ID'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ════════════════ VENDOR HISTORY COLUMN ════════════════ */}
        <div className="min-w-0 bg-white dark:bg-[#1B1D21] flex flex-col overflow-hidden">
          <div className="shrink-0 h-[44px] flex items-center gap-2 px-3 border-b border-gray-200 dark:border-white/10 bg-white dark:bg-[#1F2328]">
            <span className="text-xs font-bold text-gray-700 dark:text-slate-200 uppercase tracking-wider">Jobs</span>
            <span className="text-[10px] font-bold text-blue-700 dark:text-slate-200 bg-blue-50 dark:bg-[#2A2E35] px-1.5 py-0.5 rounded ring-1 ring-blue-200 dark:ring-white/10">{vendorHistory.length}</span>
            {activeVendorId ? (
              <span className="ml-auto text-[10px] text-gray-500 dark:text-[#94A3B8] truncate max-w-[140px]">
                {vendors.find(v => v.id === activeVendorId)?.name}
              </span>
            ) : (
              <span className="ml-auto text-[10px] text-gray-500 dark:text-[#94A3B8] truncate max-w-[140px]">All contacts</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {historyLoading ? (
              <div className="flex h-full items-center justify-center py-16">
                <LogoSpinner size={20} />
              </div>
            ) : vendorHistory.length === 0 ? (
              <div className="py-16 text-center text-xs text-gray-400 dark:text-[#94A3B8]">
                <History size={18} className="mx-auto text-gray-300 dark:text-slate-600 mb-2" />
                <p className="font-medium text-gray-500 dark:text-[#CBD5E1]">No revealed jobs</p>
                <p className="mt-1">{activeVendorId ? 'No contact reveals found for this vendor yet.' : 'No contact reveals found across these contacts yet.'}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:gap-3">
                {vendorHistory.map((job, index) => {
                  const breakdownItems = buildScoreBreakdownDisplayItems(
                    job.score_breakdown as Record<string, number | { score: number; candidate_value: string; job_value: string; rule: string }> | undefined,
                  );
                  const isExpanded = expandedHistoryBreakdownIds.has(job.id);
                  const prioritizedBreakdownItems = [...breakdownItems].sort((a, b) => {
                    const getPriority = (key: string) => {
                      if (/exp|experience|years?_?exp/i.test(key)) return 0;
                      if (/visa|work_authorization|authorization/i.test(key)) return 1;
                      return 2;
                    };

                    return getPriority(a.key) - getPriority(b.key);
                  });
                  const canToggleBreakdown = prioritizedBreakdownItems.length > 2;
                  const collapsedBreakdownItems = prioritizedBreakdownItems.slice(0, 3);
                  const visibleBreakdownItems = isExpanded ? prioritizedBreakdownItems : collapsedBreakdownItems;
                  const cardToneClass = [
                    'border-blue-100 bg-blue-50/35 dark:border-white/10 dark:bg-[#23272e]',
                    'border-emerald-100 bg-emerald-50/35 dark:border-white/10 dark:bg-[#252a30]',
                    'border-amber-100 bg-amber-50/40 dark:border-white/10 dark:bg-[#2a2d32]',
                    'border-slate-200 bg-slate-50/75 dark:border-white/10 dark:bg-[#22262c]',
                  ][index % 4];

                  return (
                    <div
                      key={job.id}
                      className={`px-2.5 sm:px-3.5 py-2.5 sm:py-3 ${index > 0 ? 'border-t border-gray-100 dark:border-white/10 lg:border-t-0' : ''} lg:rounded-xl lg:border ${cardToneClass}`}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <p className="text-[11px] sm:text-sm font-semibold text-gray-900 dark:text-[#CBD5E1] leading-snug">{job.job_title || job.extracted_role_normalized || 'Untitled Job'}</p>
                          <span className="rounded bg-gray-100 dark:bg-[#171a1f] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-600 dark:text-[#94A3B8]">{job.platform}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                        </div>
                      </div>
                      {job.company_name && (
                        <div className="mt-0.5 sm:mt-1 text-[10px] sm:text-xs text-gray-600 dark:text-[#94A3B8]">{job.company_name}</div>
                      )}
                      <div className="mt-0.5 text-[10px] sm:text-xs text-gray-500 dark:text-[#94A3B8]">
                        <span>{job.posted_by_name || '—'}</span>
                      </div>
                      <div className="mt-0.5 sm:mt-1 space-y-0.5 text-[10px] sm:text-xs text-gray-400 dark:text-slate-500">
                        <div>- {formatAgo(job.created_at)} posted</div>
                        <div>- {job.revealed_at ? `${formatAgo(job.revealed_at)} revealed` : '— revealed'}</div>
                      </div>

                      {breakdownItems.length > 0 && (
                        canToggleBreakdown ? (
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedHistoryBreakdownIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(job.id)) next.delete(job.id);
                                else next.add(job.id);
                                return next;
                              });
                            }}
                            className="mt-1.5 w-full overflow-hidden rounded-md border border-gray-200 dark:border-white/10 text-left relative group focus:outline-none"
                          >
                            <table className="w-full table-fixed border-collapse text-left text-[10px]">
                              <tbody>
                                {visibleBreakdownItems.map((item, idx) => (
                                  <tr key={item.key}>
                                    <td className={`border-b border-gray-100 dark:border-white/10 bg-white dark:bg-[#1b1f25] px-2 py-1 break-words whitespace-normal transition-all duration-200 ${!isExpanded && idx >= 2 ? 'blur-sm select-none text-gray-400 dark:text-slate-500' : 'text-gray-700 dark:text-[#CBD5E1]'}`}>
                                      {formatBreakdownFieldName(item.key)}
                                    </td>
                                    <td className={`border-b border-gray-100 dark:border-white/10 bg-white dark:bg-[#1b1f25] px-2 py-1 break-words whitespace-normal transition-all duration-200 ${!isExpanded && idx >= 2 ? 'blur-sm select-none text-gray-400 dark:text-slate-500' : 'text-gray-700 dark:text-[#CBD5E1]'}`}>
                                      {item.detail?.job_value || '-'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {!isExpanded && (
                              <div className="absolute bottom-0 left-0 right-0 h-7 flex items-center justify-center pointer-events-none">
                                <ChevronDown size={12} className="text-blue-500 dark:text-[#94A3B8]" />
                              </div>
                            )}
                          </button>
                        ) : (
                          <div className="mt-1.5 w-full overflow-hidden rounded-md border border-gray-200 dark:border-white/10 text-left">
                            <table className="w-full table-fixed border-collapse text-left text-[10px]">
                              <tbody>
                                {visibleBreakdownItems.map((item) => (
                                  <tr key={item.key}>
                                    <td className="border-b border-gray-100 dark:border-white/10 bg-white dark:bg-[#1b1f25] px-2 py-1 break-words whitespace-normal text-gray-700 dark:text-[#CBD5E1]">{formatBreakdownFieldName(item.key)}</td>
                                    <td className="border-b border-gray-100 dark:border-white/10 bg-white dark:bg-[#1b1f25] px-2 py-1 break-words whitespace-normal text-gray-700 dark:text-[#CBD5E1]">{item.detail?.job_value || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )
                      )}

                      <div className="mt-2">
                        <div className="flex flex-col gap-1.5">
                          <button
                            onClick={() => void generateTrackerEmailDrafts(job)}
                                  className="inline-flex w-full justify-center items-center gap-1 rounded-md border border-blue-600 bg-blue-600 dark:border-white/15 dark:bg-[#2A2E35] px-2 py-1.5 sm:px-2.5 sm:py-2 text-[10px] sm:text-xs font-semibold text-white dark:text-slate-100 shadow-sm transition hover:bg-blue-700 dark:hover:bg-[#343943]"
                          >
                            <Mail size={10} />
                            Generate Email
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
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
                <h2 className="text-base font-bold text-gray-900">{editingId ? 'Edit Vendor' : 'Add Vendor'}</h2>
                <p className="text-xs text-gray-400 mt-0.5">Vendor / staffing company details</p>
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
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={saveVendor} disabled={saving} className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">
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
                <h2 className="text-base font-bold text-gray-900">{editingId ? 'Edit Client' : 'Add Client'}</h2>
                <p className="text-xs text-gray-400 mt-0.5">End client / hiring company details</p>
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
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={saveClient} disabled={saving} className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">
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
                <h2 className="text-base font-bold text-gray-900">{editingId ? 'Edit Submission' : 'New Submission'}</h2>
                <p className="text-xs text-gray-400 mt-0.5">Fields auto-suggest from bench, vendors &amp; clients</p>
              </div>
              <button onClick={() => setModal(null)} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  <Tag size={11} className="text-gray-400" />Submission Type
                </label>
                <div className="flex gap-2">
                  {SUBMISSION_TYPES.map(t => (
                    <button key={t} type="button" onClick={() => setSubForm(f => ({ ...f, submission_type: t }))}
                      className={`flex-1 py-2 text-sm font-semibold rounded-lg border transition-all ${
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
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500 mb-3">Vendor Details</p>
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
                  <p className="text-[10px] font-bold uppercase tracking-widest text-teal-600 mb-3">Client Details</p>
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
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Job Details</p>
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
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Submission Info</p>
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
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={saveSubmission} disabled={saving} className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm">
                <Save size={13} />{saving ? 'Saving…' : editingId ? 'Save Changes' : 'Add Submission'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EMAIL DRAFT MODAL ── */}
      {modal === 'email' && activeEmailJob && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-3" onClick={() => setModal(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-4 sm:p-3 shadow-xl max-h-[85vh] overflow-y-auto"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900">
                  {activeEmailJob.job_title || activeEmailJob.extracted_role_normalized || 'Requirement'}
                </p>
                <p className="text-[12px] text-gray-600">{[activeEmailJob.company_name, activeEmailJob.location].filter(Boolean).join(' • ') || 'Company details unavailable'}</p>
                <p className="mt-0.5 text-[11px] text-gray-500">{activeEmailJob.posted_by_name || 'Posted by hidden'}{activeEmailJob.created_at ? ` • ${formatAgo(activeEmailJob.created_at)}` : ''}</p>
              </div>
              <button
                onClick={() => setModal(null)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            <div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  onClick={() => generateTrackerEmailDrafts(activeEmailJob)}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-3 sm:py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                >
                  <Sparkles size={14} />
                  Generate Email
                </button>

                <button
                  onClick={() => void copyText(activeEmailJob.poster_email, 'Email ID')}
                  disabled={!activeEmailJob.poster_email}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-300 bg-blue-600 px-3 py-3 sm:py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-200 disabled:text-gray-500"
                >
                  <Mail size={14} />
                  {copiedField === 'Email ID' ? 'Copied' : 'Email ID'}
                </button>
              </div>

              <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedEmailDraftTab('pitching')}
                      className={`rounded px-2 py-1 text-[10px] font-semibold transition ${selectedEmailDraftTab === 'pitching' ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
                    >
                      Pitching Email
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedEmailDraftTab('requestDetails')}
                      className={`rounded px-2 py-1 text-[10px] font-semibold transition ${selectedEmailDraftTab === 'requestDetails' ? 'bg-blue-600 text-white' : 'border border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
                    >
                      Request Details
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyText(
                      selectedEmailDraftTab === 'pitching' ? trackerEmailDrafts.pitching : trackerEmailDrafts.requestDetails,
                      'Email draft',
                    )}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-[10px] font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    {copiedField === 'Email draft' ? 'Copied' : 'Copy Draft'}
                  </button>
                </div>

                <textarea
                  value={selectedEmailDraftTab === 'pitching' ? trackerEmailDrafts.pitching : trackerEmailDrafts.requestDetails}
                  readOnly
                  rows={14}
                  className="w-full rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none whitespace-pre-wrap"
                />
              </div>
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
                <h3 className="text-base font-bold text-gray-900">Duplicate Submission Detected</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  <span className="font-semibold text-gray-700">{subForm.candidate_name}</span> has already been submitted to{' '}
                  <span className="font-semibold text-gray-700">
                    {subForm.submission_type === 'Vendor' ? subForm.vendor_name : subForm.client_name}
                  </span>
                </p>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 mb-5 max-h-40 overflow-y-auto space-y-2">
              {duplicateWarning.existing.map(s => (
                <div key={s.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-gray-600 font-medium truncate">{s.submitted_by || 'Unknown'}</span>
                    <span className="text-gray-400">submitted on</span>
                    <span className="font-medium text-gray-700">{new Date(s.submission_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xs text-gray-500 mb-4">Are you sure you want to proceed with this submission?</p>

            <div className="flex justify-end gap-2.5">
              <button
                onClick={() => setDuplicateWarning(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setDuplicateWarning(null); saveSubmission(true); }}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors"
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
            <h3 className="text-base font-bold text-gray-900 mb-1.5">
              Delete {deleteTarget.type.charAt(0).toUpperCase() + deleteTarget.type.slice(1)}?
            </h3>
            <p className="text-sm text-gray-500 mb-5">This cannot be undone.</p>
            <div className="flex justify-end gap-2.5">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancel</button>
              <button onClick={confirmDelete} className="px-5 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold rounded-lg transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
