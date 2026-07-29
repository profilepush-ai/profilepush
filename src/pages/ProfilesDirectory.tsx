import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Upload, X, FileText, Sparkles, CheckCircle2,
  UserPlus, Link2, Copy, Check, ArrowRight, Star, PenLine,
  Plus, Trash2, Clock, Search, ChevronDown, ChevronRight, Filter,
  UserCircle2, MapPin, Mail, Phone, ExternalLink,
  Download, Calendar, Edit2, Target, ClipboardPaste, Cpu, Users, Table2,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { supabase } from '../lib/supabase';
import { throttledAll } from '../lib/query-throttle';
import { triggerProfileEmbedding } from '../lib/embeddings';
import { getMatchHealthPercent } from '../lib/match-health';
import { useAuth } from '../contexts/AuthContext';
import type { Profile, WishlistedJob, EducationEntry, ExperienceEntry, ResumeFile, ActivityLog, ProfileAssignment } from '../types/database';

interface ParsedProfile {
  candidate_name: string; target_role: string; location: string;
  city: string; state: string; zip_code: string; country: string;
  phone: string; email: string; linkedin_url: string; github_url: string;
  portfolio_url: string; core_skills: string; years_experience: number | null;
  visa_status: string; work_type: string; notice_period: string;
  availability: string; desired_salary_min: string; desired_salary_max: string;
  preferred_locations: string; relocation_status: string; work_authorization: string; education: EducationEntry[];
  experience: ExperienceEntry[]; file_name: string;
}

const BLANK_PARSED: ParsedProfile = {
  candidate_name: '', target_role: '', location: '', city: '', state: '',
  zip_code: '', country: '', phone: '', email: '', linkedin_url: '',
  github_url: '', portfolio_url: '', core_skills: '', years_experience: null,
  visa_status: '', work_type: '', notice_period: '', availability: '',
  desired_salary_min: '', desired_salary_max: '', preferred_locations: '',
  relocation_status: '', work_authorization: '', education: [], experience: [], file_name: '',
};

interface ParseStep { id: string; label: string; status: 'pending' | 'active' | 'done'; }

const PARSE_STEPS: Omit<ParseStep, 'status'>[] = [
  { id: 'upload',    label: 'Uploading document' },
  { id: 'read',      label: 'Reading file contents' },
  { id: 'extract',   label: 'Extracting candidate information' },
  { id: 'structure', label: 'Structuring profile data' },
  { id: 'finalize',  label: 'Finalizing profile' },
];

interface BoardMetrics { fetched: number; matched: number; saved: number; rewritten: number; applied: number; }
interface ProfileStat {
  profile: Profile; fetched: number; matched: number; saved: number;
  rewritten: number; applied: number; perBoard: Record<string, BoardMetrics>;
}

const BOARDS = [
  { key: 'LinkedIn',      dot: 'bg-blue-500',    text: 'text-blue-700',    bg: 'bg-blue-50'    },
  { key: 'Dice',          dot: 'bg-orange-500',  text: 'text-orange-700',  bg: 'bg-orange-50'  },
  { key: 'Indeed',        dot: 'bg-violet-500',  text: 'text-violet-700',  bg: 'bg-violet-50'  },
  { key: 'Monster',       dot: 'bg-red-500',     text: 'text-red-700',     bg: 'bg-red-50'     },
  { key: 'CareerBuilder', dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50' },
] as const;

const BOARD_COL: Record<string, string> = {
  LinkedIn: 'linkedin_job_id', Dice: 'dice_job_id', Indeed: 'indeed_job_id',
  Monster: 'monster_job_id', CareerBuilder: 'careerbuilder_job_id',
};

interface TeamMember { user_id: string | null; invited_email: string; role: string; display_name: string | null; }
interface HotlistRow { profile_id: string; created_at: string | null; }
type DocCategory = 'resume' | 'rewritten' | 'experience' | 'education' | 'visa' | 'others';

function memberName(m: TeamMember): string {
  return m.display_name?.trim() || m.invited_email.split('@')[0];
}

const HOTLIST_RETENTION_DAYS = 15;
function isHotlistEligible(profile: Profile): boolean {
  const createdAt = profile.created_at ? new Date(profile.created_at) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return true;
  const ageDays = (Date.now() - createdAt.getTime()) / 86_400_000;
  return ageDays <= HOTLIST_RETENTION_DAYS;
}

const VISA_OPTIONS = ['US Citizen', 'Green Card', 'H1B', 'H4 EAD', 'OPT/CPT', 'TN', 'Other'];
const WORK_OPTIONS = ['Remote', 'On-site', 'Hybrid', 'Any'];
const WORK_AUTH_OPTIONS = ['C2C', 'W2', '1099', 'C2C or W2', 'Any'];
const NOTICE_OPTIONS = ['Immediately Available', '1 Week', '2 Weeks', '1 Month', '2 Months'];

const STAGE_CFG = {
  New:       { dot: 'bg-blue-400',    bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-700',    activeCls: 'bg-blue-600 border-blue-600 text-white'       },
  Assigned:  { dot: 'bg-amber-400',   bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   activeCls: 'bg-amber-500 border-amber-500 text-white'      },
  Sourcing:  { dot: 'bg-violet-400',  bg: 'bg-violet-50',  border: 'border-violet-200',  text: 'text-violet-700',  activeCls: 'bg-violet-600 border-violet-600 text-white'    },
  Submitted: { dot: 'bg-emerald-400', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', activeCls: 'bg-emerald-600 border-emerald-600 text-white'  },
  Placed:    { dot: 'bg-sky-400',     bg: 'bg-sky-50',     border: 'border-sky-200',     text: 'text-sky-700',     activeCls: 'bg-sky-600 border-sky-600 text-white'          },
  Lost:      { dot: 'bg-red-400',     bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-600',     activeCls: 'bg-red-600 border-red-600 text-white'          },
} as const;

type BenchStage = keyof typeof STAGE_CFG;

type BenchDatePreset = '15d' | 'today' | 'week' | 'month' | 'all';

export const DEFAULT_BENCH_DATE_PRESET: BenchDatePreset = 'all';

const BENCH_DATE_PRESETS: { id: BenchDatePreset; label: string }[] = [
  { id: '15d', label: 'Last 15 days' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];

function getBenchDateStart(preset: BenchDatePreset): Date | null {
  const now = new Date();
  if (preset === 'all') return null;
  if (preset === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (preset === '15d') {
    const start = new Date(now);
    start.setDate(now.getDate() - 14);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (preset === 'week') {
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  const start = new Date(now);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start;
}

function MField({ label, value, onChange, placeholder, type = 'text', required }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100" />
    </div>
  );
}

function MSelect({ label, value, onChange, options, required }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; required?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white cursor-pointer">
        <option value="">Select…</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function SectionHeader({ title, color = 'blue' }: { title: string; color?: string }) {
  const cls: Record<string, string> = {
    blue: 'text-blue-700 bg-blue-50 border-blue-200', emerald: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    violet: 'text-violet-700 bg-violet-50 border-violet-200', amber: 'text-amber-700 bg-amber-50 border-amber-200',
    gray: 'text-gray-700 bg-gray-50 border-gray-200',
  };
  return <div className={`text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border w-fit ${cls[color] ?? cls.blue}`}>{title}</div>;
}

function CollapsibleSection({ title, color = 'gray', defaultOpen = false, count, action, children }: {
  title: string; color?: string; defaultOpen?: boolean; count?: number; action?: ReactNode; children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(v => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(v => !v);
          }
        }}
        className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50/60 hover:bg-gray-100/60 transition-colors text-left cursor-pointer"
      >
        <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 shrink-0 ${open ? '' : '-rotate-90'}`} />
        <SectionHeader title={title} color={color} />
        {count != null && count > 0 && (
          <span className="text-[10px] font-bold text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded-full">{count}</span>
        )}
        <span className="flex-1" />
        {action && <div className="shrink-0" onClick={e => e.stopPropagation()}>{action}</div>}
      </div>
      {open && <div className="px-4 py-4 border-t border-gray-100">{children}</div>}
    </div>
  );
}

function DetailSection({ title, color = 'gray', defaultOpen = false, children }: { title: string; color?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const cls: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50/70',
    emerald: 'border-emerald-200 bg-emerald-50/70',
    violet: 'border-violet-200 bg-violet-50/70',
    amber: 'border-amber-200 bg-amber-50/70',
    gray: 'border-gray-200 bg-gray-50/70',
  };

  return (
    <div className={`rounded-xl border px-3 py-3 ${cls[color] ?? cls.gray}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <p className="text-[9px] font-bold uppercase tracking-wider text-gray-600">{title}</p>
        <ChevronDown size={12} className={`text-gray-400 transition-transform duration-200 shrink-0 ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
}

function DetailField({ label, value, emptyText = '—' }: { label: string; value: ReactNode; emptyText?: string }) {
  const text = value ?? emptyText;
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 mb-0.5">{label}</p>
      <div className="text-xs text-gray-700 font-medium break-words">{text}</div>
    </div>
  );
}

function formatProfileValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.trim() || '—';
  return String(value);
}

const BLANK_EDU: EducationEntry = { institution: '', degree: '', field: '', start_year: '', end_year: '', gpa: '' };
const BLANK_EXP: ExperienceEntry = { company: '', title: '', location: '', start_date: '', end_date: '', current: false, description: '' };

export default function ProfilesDirectory() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { account, subscription } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [profiles, setProfiles]       = useState<Profile[]>([]);
  const [loading, setLoading]         = useState(true);
  const [parsing, setParsing]         = useState(false);
  const [parseSteps, setParseSteps]   = useState<ParseStep[]>([]);
  const [showModal, setShowModal]     = useState(false);
  const [parsed, setParsed]           = useState<ParsedProfile>(BLANK_PARSED);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preFill, setPreFill]        = useState<Partial<ParsedProfile>>({});
  const [preFillSkills, setPreFillSkills] = useState<string[]>([]);
  const [preFillSkillInput, setPreFillSkillInput] = useState('');
  const [quickCreating, setQuickCreating] = useState(false);
  const [earlyProfileId, setEarlyProfileId] = useState<string | null>(null);
  const [saving, setSaving]           = useState(false);
  const [toast, setToast]             = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText]           = useState('');

  const [bulkPasteText, setBulkPasteText] = useState('');
  const [bulkParsedRows, setBulkParsedRows] = useState<Record<string, string>[]>([]);
  const [bulkCreating, setBulkCreating] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [bulkStep, setBulkStep] = useState<'paste' | 'parsing' | 'preview' | 'creating' | 'done'>('paste');

  const [queuedJobId, setQueuedJobId] = useState<string | null>(null);
  const queuePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [onboardingUrl, setOnboardingUrl]             = useState('');
  const [generatingLink, setGeneratingLink]           = useState(false);
  const [copied, setCopied]                           = useState(false);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  const [allJobs, setAllJobs]                               = useState<WishlistedJob[]>([]);
  const [allMatchScores, setAllMatchScores]                 = useState<Record<string, string | null>[]>([]);
  const [profileMatchCounts, setProfileMatchCounts]         = useState<Record<string, number>>({});
  const [profileRewrittenCounts, setProfileRewrittenCounts] = useState<Record<string, number>>({});
  const [statsLoading, setStatsLoading]                     = useState(true);

  const [search, setSearch]             = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [assignedFilterOpen, setAssignedFilterOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'hotlist' | 'bench'>('hotlist');
  const assignedFilterRef = useRef<HTMLDivElement>(null);

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [profileAssignments, setProfileAssignments] = useState<ProfileAssignment[]>([]);

  const [assignPopup, setAssignPopup]   = useState<{ profileId: string; search: string; rect: DOMRect } | null>(null);
  const assignPopupRef = useRef<HTMLDivElement>(null);
  const [benchStagePopup, setBenchStagePopup] = useState<{ profileId: string; rect: DOMRect } | null>(null);
  const benchStagePopupRef = useRef<HTMLDivElement>(null);

  const [submissions, setSubmissions] = useState<{candidate_name: string; client_name: string; vendor_name: string}[]>([]);

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [detailFiles, setDetailFiles]     = useState<ResumeFile[]>([]);
  const [detailLogs, setDetailLogs]       = useState<ActivityLog[]>([]);
  const [docUploadTarget, setDocUploadTarget] = useState<DocCategory>('resume');
  const [detailLoading, setDetailLoading] = useState(false);

  // Date filter
  const [datePreset, setDatePreset] = useState<BenchDatePreset>(DEFAULT_BENCH_DATE_PRESET);
  const [dateOpen, setDateOpen] = useState(false);
  const dateDropdownRef = useRef<HTMLDivElement>(null);

  // Priority skills inline edit
  const [editingPrioritySkills, setEditingPrioritySkills] = useState(false);
  const [prioritySkillsItems, setPrioritySkillsItems]     = useState<string[]>([]);
  const [newSkillInput, setNewSkillInput]                 = useState('');
  const [aiGeneratingSkills, setAiGeneratingSkills]       = useState(false);
  const [editingMatchHealth, setEditingMatchHealth]       = useState(false);
  const [matchHealthDraft, setMatchHealthDraft]           = useState<Partial<Profile>>({});
  const [savingMatchHealth, setSavingMatchHealth]         = useState(false);
  const newSkillRef = useRef<HTMLInputElement>(null);

  // Collapsed states
  const [skillsExpanded, setSkillsExpanded]         = useState(false);
  const [expandedExpIds, setExpandedExpIds]         = useState<Set<number>>(new Set());

  // Document actions
  const docUploadRef = useRef<HTMLInputElement>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());

  // Edit profile modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editDraft, setEditDraft]         = useState<Partial<Profile>>({});
  const [editSaving, setEditSaving]       = useState(false);
  const [editingFullProfile, setEditingFullProfile] = useState(false);
  const [fullProfileDraft, setFullProfileDraft]     = useState<Partial<Profile>>({});
  const [savingFullProfile, setSavingFullProfile]   = useState(false);
  const [experienceAddOpen, setExperienceAddOpen]     = useState(false);
  const [educationAddOpen, setEducationAddOpen]       = useState(false);
  const [experienceDraft, setExperienceDraft]         = useState<ExperienceEntry>(BLANK_EXP);
  const [educationDraft, setEducationDraft]           = useState<EducationEntry>(BLANK_EDU);

  type FullProfileField = keyof Pick<Profile, 'candidate_name' | 'phone' | 'email' | 'linkedin_url' | 'github_url' | 'portfolio_url' | 'location' | 'city' | 'state' | 'zip_code' | 'country' | 'core_skills' | 'notice_period' | 'availability'>;

  function startEditingFullProfile(profile: Profile) {
    setFullProfileDraft({
      candidate_name: profile.candidate_name ?? '',
      phone: profile.phone ?? '',
      email: profile.email ?? '',
      linkedin_url: profile.linkedin_url ?? '',
      github_url: profile.github_url ?? '',
      portfolio_url: profile.portfolio_url ?? '',
      location: profile.location ?? '',
      city: profile.city ?? '',
      state: profile.state ?? '',
      zip_code: profile.zip_code ?? '',
      country: profile.country ?? '',
      core_skills: profile.core_skills ?? '',
      notice_period: profile.notice_period ?? '',
      availability: profile.availability ?? '',
      experience: Array.isArray(profile.experience) ? profile.experience.map(item => ({ ...item })) : [],
      education: Array.isArray(profile.education) ? profile.education.map(item => ({ ...item })) : [],
    });
    setExperienceDraft(BLANK_EXP);
    setEducationDraft(BLANK_EDU);
    setExperienceAddOpen(false);
    setEducationAddOpen(false);
    setEditingFullProfile(true);
  }

  function cancelEditingFullProfile() {
    setEditingFullProfile(false);
    setFullProfileDraft({});
    setExperienceAddOpen(false);
    setEducationAddOpen(false);
  }

  // Hotlist
  const [hotlistIds, setHotlistIds] = useState<Set<string>>(new Set());
  const [hotlistRows, setHotlistRows] = useState<HotlistRow[]>([]);
  const [hotlistAdding, setHotlistAdding] = useState<string | null>(null);
  const [sidebarTabInitialized, setSidebarTabInitialized] = useState(false);
  const isPaidPlan = subscription?.status === 'active' && (subscription.plan_amount_usd ?? 0) > 0;

  async function addProfileToHotlist(profileId: string) {
    if (!account?.id) return;
    const { error } = await supabase.from('hotlist').upsert({
      profile_id: profileId,
      account_id: account.id,
      created_at: new Date().toISOString(),
    }, { onConflict: 'profile_id,account_id' });

    if (!error) {
      setHotlistRows(prev => prev.some(row => row.profile_id === profileId)
        ? prev
        : [{ profile_id: profileId, created_at: new Date().toISOString() }, ...prev]);
      setHotlistIds(prev => {
        const next = new Set(prev);
        next.add(profileId);
        return next;
      });
    }
  }

  useEffect(() => {
    if (!account?.id) {
      setHotlistRows([]);
      setHotlistIds(new Set());
      setSidebarTabInitialized(false);
      return;
    }

    supabase.from('hotlist').select('profile_id, created_at').eq('account_id', account.id).order('created_at', { ascending: false }).then(({ data }) => {
      setHotlistRows((data ?? []) as HotlistRow[]);
    });
  }, [account?.id]);

  useEffect(() => {
    const profileMap = new Map(profiles.map(p => [p.id, p]));
    const nextIds = new Set<string>();
    for (const row of hotlistRows) {
      const profile = profileMap.get(row.profile_id);
      if (profile && isHotlistEligible(profile)) nextIds.add(row.profile_id);
    }
    setHotlistIds(prev => {
      const prevArray = Array.from(prev);
      const nextArray = Array.from(nextIds);
      if (prevArray.length === nextArray.length && prevArray.every((id, index) => id === nextArray[index])) return prev;
      return nextIds;
    });
  }, [hotlistRows, profiles]);

  useEffect(() => {
    if (!sidebarTabInitialized && profiles.length > 0) {
      setSidebarTab('hotlist');
      setSidebarTabInitialized(true);
    }
  }, [profiles, hotlistIds, sidebarTabInitialized]);

  useEffect(() => { fetchProfiles(); fetchStats(); fetchTeamMembers(); fetchAllAssignments(); }, []);
  useEffect(() => () => { if (queuePollRef.current) clearInterval(queuePollRef.current); }, []);

  useEffect(() => {
    const pid = searchParams.get('profile');
    if (pid && profiles.length > 0 && !loading) {
      setSelectedProfileId(pid);
    }
  }, [profiles, loading]);

  useEffect(() => {
    if (!selectedProfileId) { setDetailFiles([]); setDetailLogs([]); return; }
    setDetailLoading(true);
    setSelectedDocIds(new Set());
    setEditingPrioritySkills(false);
    setEditingMatchHealth(false);
    setMatchHealthDraft({});
    setNewSkillInput('');
    setSkillsExpanded(false);
    setExpandedExpIds(new Set());
    throttledAll([
      () => supabase.from('resume_files').select('*').eq('profile_id', selectedProfileId).order('created_at', { ascending: false }),
      () => supabase.from('activity_logs').select('*').eq('profile_id', selectedProfileId).order('created_at', { ascending: false }),
    ]).then(([filesRes, logsRes]) => {
      setDetailFiles((filesRes.data ?? []) as ResumeFile[]);
      setDetailLogs((logsRes.data ?? []) as ActivityLog[]);
      setDetailLoading(false);
    });
  }, [selectedProfileId]);

  useEffect(() => {
    if (!assignPopup) return;
    function handle(e: MouseEvent) {
      if (assignPopupRef.current && !assignPopupRef.current.contains(e.target as Node)) setAssignPopup(null);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [assignPopup]);

  useEffect(() => {
    if (!benchStagePopup) return;
    function handle(e: MouseEvent) {
      if (benchStagePopupRef.current && !benchStagePopupRef.current.contains(e.target as Node)) setBenchStagePopup(null);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [benchStagePopup]);

  useEffect(() => {
    if (!dateOpen) return;
    function handle(e: MouseEvent) {
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(e.target as Node)) setDateOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [dateOpen]);

  useEffect(() => {
    if (!assignedFilterOpen) return;
    function handle(e: MouseEvent) {
      if (assignedFilterRef.current && !assignedFilterRef.current.contains(e.target as Node)) setAssignedFilterOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [assignedFilterOpen]);

  async function fetchStats() {
    setStatsLoading(true);
    const [jobsRes, resumesRes, matchRes, subRes] = await throttledAll([
      () => supabase.from('wishlisted_jobs').select('id, profile_id, status, board, rewrite_file_url'),
      () => supabase.from('resume_files').select('id, profile_id, category'),
      () => supabase.from('job_match_scores').select('profile_id, linkedin_job_id, dice_job_id, indeed_job_id, monster_job_id, careerbuilder_job_id'),
      () => supabase.from('submissions').select('candidate_name, client_name, vendor_name'),
    ]);
    setAllJobs(jobsRes.data ?? []);
    setAllMatchScores((matchRes.data ?? []) as Record<string, string | null>[]);
    setSubmissions((subRes.data ?? []) as {candidate_name: string; client_name: string; vendor_name: string}[]);
    const rewrittenCounts: Record<string, number> = {};
    for (const f of (resumesRes.data ?? [])) {
      if (f.category === 'rewritten') rewrittenCounts[f.profile_id] = (rewrittenCounts[f.profile_id] ?? 0) + 1;
    }
    const matchCounts: Record<string, number> = {};
    for (const m of (matchRes.data ?? [])) matchCounts[m.profile_id] = (matchCounts[m.profile_id] ?? 0) + 1;
    setProfileRewrittenCounts(rewrittenCounts);
    setProfileMatchCounts(matchCounts);
    setStatsLoading(false);
  }

  async function fetchTeamMembers() {
    const { data } = await supabase.from('account_members').select('user_id, invited_email, role, display_name').eq('status', 'active');
    setTeamMembers((data ?? []) as TeamMember[]);
  }

  async function fetchProfiles() {
    setLoading(true);
    const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (error) showToast('Failed to load profiles', 'error');
    else setProfiles(data ?? []);
    setLoading(false);
  }

  async function fetchAllAssignments() {
    const { data } = await supabase.from('profile_assignments').select('*');
    setProfileAssignments((data ?? []) as ProfileAssignment[]);
  }

  async function toggleAssignment(profileId: string, userId: string) {
    const existing = profileAssignments.find(a => a.profile_id === profileId && a.user_id === userId);
    if (existing) {
      await supabase.from('profile_assignments').delete().eq('id', existing.id);
      setProfileAssignments(prev => prev.filter(a => a.id !== existing.id));
    } else {
      const { data } = await supabase.from('profile_assignments')
        .insert({ profile_id: profileId, user_id: userId })
        .select()
        .single();
      if (data) setProfileAssignments(prev => [...prev, data as ProfileAssignment]);
    }
  }

  async function clearAssignments(profileId: string) {
    await supabase.from('profile_assignments').delete().eq('profile_id', profileId);
    setProfileAssignments(prev => prev.filter(a => a.profile_id !== profileId));
    setAssignPopup(null);
  }

  async function updateBenchStage(profileId: string, stage: BenchStage) {
    await supabase.from('profiles').update({ bench_stage: stage }).eq('id', profileId);
    setProfiles(prev => prev.map(p => p.id === profileId ? { ...p, bench_stage: stage } : p));
    setBenchStagePopup(null);
  }

  async function savePrioritySkills(profileId: string, skills: string[]) {
    const value = skills.filter(Boolean).join(', ');
    await supabase.from('profiles').update({ priority_skills: value }).eq('id', profileId);
    setProfiles(prev => prev.map(p => p.id === profileId ? { ...p, priority_skills: value } : p));
    setEditingPrioritySkills(false);
  }

  async function saveMatchHealthRules() {
    if (!selectedProfileId) return;
    setSavingMatchHealth(true);
    const payload = {
      target_role: matchHealthDraft.target_role ?? '',
      priority_skills: matchHealthDraft.priority_skills ?? '',
      years_experience: matchHealthDraft.years_experience != null && matchHealthDraft.years_experience !== '' ? Number(matchHealthDraft.years_experience) : null,
      visa_status: matchHealthDraft.visa_status ?? '',
      work_authorization: matchHealthDraft.work_authorization ?? '',
      work_type: matchHealthDraft.work_type ?? '',
      preferred_locations: matchHealthDraft.preferred_locations ?? '',
      desired_salary_min: matchHealthDraft.desired_salary_min != null && matchHealthDraft.desired_salary_min !== '' ? Number(matchHealthDraft.desired_salary_min) : null,
      desired_salary_max: matchHealthDraft.desired_salary_max != null && matchHealthDraft.desired_salary_max !== '' ? Number(matchHealthDraft.desired_salary_max) : null,
    };
    const { data, error } = await supabase.from('profiles').update(payload).eq('id', selectedProfileId).select().single();
    if (error) {
      showToast('Failed to update match rules', 'error');
    } else {
      setProfiles(prev => prev.map(p => p.id === selectedProfileId ? { ...p, ...data } : p));
      setEditingMatchHealth(false);
      setMatchHealthDraft({});
      showToast('Match rules updated');
      triggerProfileEmbedding(selectedProfileId);
    }
    setSavingMatchHealth(false);
  }

  async function generatePrioritySkills(p: Profile) {
    setAiGeneratingSkills(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
      const expSummary = Array.isArray(p.experience)
        ? p.experience.slice(0, 2).map((e: ExperienceEntry) => `${e.title} at ${e.company}`).join('; ')
        : '';
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-priority-skills`, {
        method: 'POST', headers,
        body: JSON.stringify({ target_role: p.target_role, core_skills: p.core_skills, experience_summary: expSummary }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.skills)) {
          const current = prioritySkillsItems.filter(Boolean);
          const combined = [...current];
          for (const s of data.skills) {
            if (combined.length >= 10) break;
            if (!combined.some(x => x.toLowerCase() === s.toLowerCase())) combined.push(s);
          }
          setPrioritySkillsItems(combined);
          if (!editingPrioritySkills) setEditingPrioritySkills(true);
        }
      } else {
        showToast('AI suggestion failed', 'error');
      }
    } catch {
      showToast('AI suggestion failed', 'error');
    }
    setAiGeneratingSkills(false);
  }

  async function saveEditProfile() {
    if (!selectedProfileId) return;
    setEditSaving(true);
    const { data } = await supabase.from('profiles').update(editDraft).eq('id', selectedProfileId).select().single();
    if (data) setProfiles(prev => prev.map(p => p.id === selectedProfileId ? { ...p, ...data } : p));
    setEditSaving(false);
    setShowEditModal(false);
    showToast('Profile updated');
    triggerProfileEmbedding(selectedProfileId);
  }

  async function saveFullProfileEdits() {
    if (!selectedProfileId) return;
    setSavingFullProfile(true);
    const { data, error } = await supabase.from('profiles').update(fullProfileDraft).eq('id', selectedProfileId).select().single();
    if (error) {
      showToast('Failed to update profile', 'error');
    } else {
      if (data) setProfiles(prev => prev.map(p => p.id === selectedProfileId ? { ...p, ...data } : p));
      setEditingFullProfile(false);
      setFullProfileDraft({});
      setExperienceAddOpen(false);
      setEducationAddOpen(false);
      showToast('Profile updated');
      triggerProfileEmbedding(selectedProfileId);
    }
    setSavingFullProfile(false);
  }

  function addExperienceEntry() {
    const nextEntry: ExperienceEntry = {
      ...experienceDraft,
      company: experienceDraft.company?.trim() ?? '',
      title: experienceDraft.title?.trim() ?? '',
      location: experienceDraft.location?.trim() ?? '',
      start_date: experienceDraft.start_date?.trim() ?? '',
      end_date: experienceDraft.end_date?.trim() ?? '',
      current: Boolean(experienceDraft.current),
      description: experienceDraft.description?.trim() ?? '',
    };
    setFullProfileDraft(prev => ({
      ...prev,
      experience: [...(Array.isArray(prev.experience) ? prev.experience : []), nextEntry],
    }));
    setExperienceDraft(BLANK_EXP);
    setExperienceAddOpen(false);
  }

  function addEducationEntry() {
    const nextEntry: EducationEntry = {
      ...educationDraft,
      institution: educationDraft.institution?.trim() ?? '',
      degree: educationDraft.degree?.trim() ?? '',
      field: educationDraft.field?.trim() ?? '',
      start_year: educationDraft.start_year?.trim() ?? '',
      end_year: educationDraft.end_year?.trim() ?? '',
      gpa: educationDraft.gpa?.trim() ?? '',
    };
    setFullProfileDraft(prev => ({
      ...prev,
      education: [...(Array.isArray(prev.education) ? prev.education : []), nextEntry],
    }));
    setEducationDraft(BLANK_EDU);
    setEducationAddOpen(false);
  }

  async function uploadDocForProfile(file: File, category: DocCategory = 'resume') {
    if (!selectedProfileId) return;
    const storagePath = `${selectedProfileId}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from('resumes').upload(storagePath, file, { contentType: file.type || 'application/octet-stream' });
    if (error) { showToast('Upload failed', 'error'); return; }
    const { data: urlData } = supabase.storage.from('resumes').getPublicUrl(storagePath);
    const { data: rec } = await supabase.from('resume_files').insert({ profile_id: selectedProfileId, file_name: file.name, file_url: urlData.publicUrl, category }).select().single();
    if (rec) setDetailFiles(prev => [rec as ResumeFile, ...prev]);
    showToast('Document uploaded');
  }

  async function generateOnboardingLink() {
    if (!account) return;
    setGeneratingLink(true);
    try {
      const { data: existing } = await supabase.from('onboarding_tokens').select('id, token')
        .eq('account_id', account.id).eq('is_active', true)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      let token = existing?.token && existing.token.length <= 16 ? existing.token : null;
      if (!token) {
        // deactivate any stale long token before creating a new short one
        if (existing?.id) {
          await supabase.from('onboarding_tokens').update({ is_active: false }).eq('id', existing.id);
        }
        const { data: created } = await supabase.from('onboarding_tokens')
          .insert({ account_id: account.id }).select('token').single();
        token = created?.token;
      }
      if (token) { setOnboardingUrl(`${window.location.origin}/onboard/${token}`); setShowOnboardingModal(true); }
      else showToast('Failed to generate link', 'error');
    } catch { showToast('Failed to generate link', 'error'); }
    setGeneratingLink(false);
  }

  async function copyOnboardingUrl() {
    await navigator.clipboard.writeText(onboardingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function startParseSteps() { setParseSteps(PARSE_STEPS.map((s, i) => ({ ...s, status: i === 0 ? 'active' : 'pending' }))); }
  function advanceStep(completedId: string, nextId?: string) {
    setParseSteps(prev => prev.map(s => {
      if (s.id === completedId) return { ...s, status: 'done' };
      if (nextId && s.id === nextId) return { ...s, status: 'active' };
      return s;
    }));
  }
  function completeAllSteps() { setParseSteps(prev => prev.map(s => ({ ...s, status: 'done' }))); }

  function mergePreFill(parsedResult: ParsedProfile): ParsedProfile {
    const merged = { ...parsedResult };
    const keys: (keyof ParsedProfile)[] = [
      'candidate_name', 'target_role', 'visa_status', 'work_type', 'work_authorization', 'preferred_locations',
      'desired_salary_min', 'desired_salary_max', 'relocation_status', 'years_experience', 'core_skills',
    ];
    for (const k of keys) {
      const pv = preFill[k];
      if (pv !== undefined && pv !== '' && pv !== null) {
        const current = merged[k];
        if (current === '' || current === null || current === undefined) {
          (merged as Record<string, unknown>)[k] = pv;
        }
      }
    }
    const skillsStr = preFillSkills.filter(s => s.trim()).join(', ');
    if (skillsStr && !merged.core_skills) {
      merged.core_skills = skillsStr;
    }
    return merged;
  }

  async function handleQuickCreate() {
    if (!account?.id || quickCreating) return;
    const name = (preFill.candidate_name ?? '').trim();
    const filledSkills = preFillSkills.filter(s => s.trim());
    if (!name || !preFill.target_role?.trim() || !preFill.visa_status || !preFill.work_type || !preFill.work_authorization || !preFill.preferred_locations?.trim() || !preFill.desired_salary_min || !preFill.desired_salary_max || !preFill.relocation_status || preFill.years_experience == null || filledSkills.length < 3) return;
    setQuickCreating(true);
    try {
      const profilePayload = {
        candidate_name: name,
        target_role: preFill.target_role!.trim(),
        visa_status: preFill.visa_status,
        work_type: preFill.work_type,
        preferred_locations: preFill.preferred_locations!.trim(),
        desired_salary_min: Number(preFill.desired_salary_min) || null,
        desired_salary_max: Number(preFill.desired_salary_max) || null,
        relocation_open: preFill.relocation_status === 'Yes',
        years_experience: Number(preFill.years_experience) || null,
        work_authorization: preFill.work_authorization || null,
        core_skills: filledSkills.join(', '),
      };

      let profileId = earlyProfileId;

      if (profileId) {
        const { error } = await supabase.from('profiles').update(profilePayload).eq('id', profileId);
        if (error) throw error;
      } else {
        const { data: profile, error } = await supabase.from('profiles').insert({
          account_id: account.id, ...profilePayload,
        }).select('id').single();
        if (error || !profile) throw error || new Error('No profile returned');
        profileId = profile.id;

        if (pendingFile) {
          const storagePath = `${account.id}/${profileId}/${Date.now()}_${pendingFile.name}`;
          await supabase.storage.from('resumes').upload(storagePath, pendingFile, { contentType: pendingFile.type || 'application/octet-stream' });
          const { data: urlData } = supabase.storage.from('resumes').getPublicUrl(storagePath);
          await supabase.from('resume_files').insert({
            profile_id: profileId, file_name: pendingFile.name,
            file_url: urlData.publicUrl, file_type: pendingFile.type || 'application/octet-stream',
            category: 'original',
          });
        }

        await addProfileToHotlist(profileId);
      }

      // Generate embedding for the profile (fire-and-forget)
      triggerProfileEmbedding(profileId);

      setParsing(false);
      setParseSteps([]);
      setPreFill({});
      setPreFillSkills([]);
      setPreFillSkillInput('');
      setShowModal(false);
      setParsed(BLANK_PARSED);
      setPendingFile(null);
      setEarlyProfileId(null);
      const savedJobId = queuedJobId;
      setQueuedJobId(null);
      await fetchProfiles();
      showToast(`Profile "${name}" saved. Resume details will be filled in once analysis completes.`, 'success');

      if (savedJobId && profileId) {
        pollAndUpdateProfile(savedJobId, profileId);
      }
    } catch (err: unknown) {
      showToast((err as Error)?.message || 'Failed to save profile', 'error');
    } finally {
      setQuickCreating(false);
    }
  }

  async function pollAndUpdateProfile(jobId: string, profileId: string) {
    const maxAttempts = 40;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const { data: job } = await supabase.from('llm_resilience_queue').select('status, result').eq('id', jobId).maybeSingle();
      if (!job || job.status === 'failed') break;
      if (job.status === 'done' && job.result) {
        const r = job.result as Record<string, unknown>;
        const updates: Record<string, unknown> = {};
        if (r.location) updates.location = r.location;
        if (r.city) updates.city = r.city;
        if (r.state) updates.state = r.state;
        if (r.zip_code) updates.zip_code = r.zip_code;
        if (r.country) updates.country = r.country;
        if (r.phone) updates.phone = r.phone;
        if (r.email) updates.email = r.email;
        if (r.linkedin_url) updates.linkedin_url = r.linkedin_url;
        if (r.github_url) updates.github_url = r.github_url;
        if (r.portfolio_url) updates.portfolio_url = r.portfolio_url;
        if (r.core_skills && !updates.core_skills) updates.core_skills = r.core_skills;
        if (r.notice_period) updates.notice_period = r.notice_period;
        if (r.availability) updates.availability = r.availability;
        if (Array.isArray(r.education) && r.education.length) updates.education = r.education;
        if (Array.isArray(r.experience) && r.experience.length) updates.experience = r.experience;
        if (Object.keys(updates).length > 0) {
          await supabase.from('profiles').update(updates).eq('id', profileId);
          await fetchProfiles();
        }
        break;
      }
    }
  }

  async function processFile(file: File) {
    if (!['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/rtf','text/rtf','text/plain'].includes(file.type) && !file.name.match(/\.(pdf|doc|docx|rtf|txt)$/i)) {
      showToast('Unsupported file type. Use PDF, Word, RTF, or TXT.', 'error');
      return;
    }
    if (!account?.id) return;

    setParsing(true);
    setPreFill({});
    setPreFillSkills([]);
    setPreFillSkillInput('');
    startParseSteps();

    const displayName = file.name.replace(/\.(pdf|doc|docx|rtf|txt)$/i, '').replace(/[_-]+/g, ' ').trim() || 'New Profile';

    try {
      const { data: profile, error: profileErr } = await supabase.from('profiles').insert({
        account_id: account.id,
        candidate_name: displayName,
        core_skills: '',
      }).select('id').single();
      if (profileErr || !profile) throw profileErr || new Error('Profile creation failed');
      setEarlyProfileId(profile.id);

      const storagePath = `${account.id}/${profile.id}/${Date.now()}_${file.name}`;
      await supabase.storage.from('resumes').upload(storagePath, file, { contentType: file.type || 'application/octet-stream' });
      const { data: urlData } = supabase.storage.from('resumes').getPublicUrl(storagePath);
      await supabase.from('resume_files').insert({
        profile_id: profile.id, file_name: file.name,
        file_url: urlData.publicUrl, file_type: file.type || 'application/octet-stream',
        category: 'original',
      });

      await addProfileToHotlist(profile.id);
      await fetchProfiles();
      setPendingFile(file);
      setPreFill(p => ({ ...p, candidate_name: displayName }));
    } catch (err) {
      showToast(`Failed to create initial profile: ${(err as Error)?.message || 'Unknown'}`, 'error');
      setParsing(false);
      setParseSteps([]);
      return;
    }

    let wasQueued = false;
    try {
      const formData = new FormData();
      formData.append('resume', file, file.name);
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
      advanceStep('upload', 'read');
      const res = await fetch(`${supabaseUrl}/functions/v1/parse-resume`, { method: 'POST', headers, body: formData });
      advanceStep('read', 'extract');
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      advanceStep('extract', 'structure');
      const data = await res.json();
      advanceStep('structure', 'finalize');

      if (res.status === 202 && data.queued) {
        setQueuedJobId(data.job_id);
        queuePollRef.current = setInterval(async () => {
          const { data: qj } = await supabase.from('llm_job_queue').select('id, status, result, error').eq('id', data.job_id).maybeSingle();
          if (qj?.status === 'completed' && qj.result) {
            clearInterval(queuePollRef.current!);
            queuePollRef.current = null;
            setQueuedJobId(null);
            completeAllSteps();
            await new Promise(r => setTimeout(r, 600));
            setParsing(false); setParseSteps([]);
            const r = qj.result as Record<string, unknown>;
            if (Array.isArray(r.core_skills)) r.core_skills = (r.core_skills as string[]).join(', ');
            const parsedResult: ParsedProfile = {
              candidate_name: (r.candidate_name as string) || '', target_role: (r.target_role as string) || '',
              location: (r.location as string) || '', city: (r.city as string) || '', state: (r.state as string) || '',
              zip_code: (r.zip_code as string) || '', country: (r.country as string) || '',
              phone: (r.phone as string) || '', email: (r.email as string) || '',
              linkedin_url: (r.linkedin_url as string) || '', github_url: (r.github_url as string) || '',
              portfolio_url: (r.portfolio_url as string) || '', core_skills: (r.core_skills as string) || '',
              years_experience: (r.years_experience as number) || null, visa_status: (r.visa_status as string) || '',
              work_type: (r.work_type as string) || '', notice_period: (r.notice_period as string) || '',
              availability: (r.availability as string) || '',
              desired_salary_min: String(r.desired_salary_min ?? ''), desired_salary_max: String(r.desired_salary_max ?? ''),
              preferred_locations: (r.preferred_locations as string) || '',
              relocation_status: (r.relocation_status as string) || '',
              work_authorization: (r.work_authorization as string) || '',
              education: Array.isArray(r.education) ? r.education as EducationEntry[] : [],
              experience: Array.isArray(r.experience) ? r.experience as ExperienceEntry[] : [],
              file_name: file.name,
            };
            setParsed(mergePreFill(parsedResult));
            setShowModal(true);
          } else if (qj?.status === 'dead') {
            clearInterval(queuePollRef.current!);
            queuePollRef.current = null;
            setQueuedJobId(null);
            setParsing(false); setParseSteps([]);
            showToast('Resume processing failed. Please fill in details manually.', 'error');
          }
        }, 3_000);
        wasQueued = true;
        return;
      }

      completeAllSteps();
      await new Promise(r => setTimeout(r, 500));
      const directResult: ParsedProfile = {
        candidate_name: data.candidate_name || '', target_role: data.target_role || '',
        location: data.location || '', city: data.city || '', state: data.state || '',
        zip_code: data.zip_code || '', country: data.country || '',
        phone: data.phone || '', email: data.email || '',
        linkedin_url: data.linkedin_url || '', github_url: data.github_url || '',
        portfolio_url: data.portfolio_url || '', core_skills: data.core_skills || '',
        years_experience: data.years_experience || null, visa_status: data.visa_status || '',
        work_type: data.work_type || '', notice_period: data.notice_period || '',
        availability: data.availability || '',
        desired_salary_min: String(data.desired_salary_min ?? ''), desired_salary_max: String(data.desired_salary_max ?? ''),
        preferred_locations: data.preferred_locations || '',
        relocation_status: data.relocation_status || '',
        work_authorization: data.work_authorization || '',
        education: Array.isArray(data.education) ? data.education : [],
        experience: Array.isArray(data.experience) ? data.experience : [],
        file_name: file.name,
      };
      setParsed(mergePreFill(directResult));
      setShowModal(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Parse failed: ${msg}. Fill in details manually.`, 'error');
    } finally {
      if (!wasQueued) { setParsing(false); setParseSteps([]); }
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await processFile(file);
  }

  async function handlePasteSubmit() {
    if (!pasteText.trim()) return;
    const blob = new Blob([pasteText], { type: 'text/plain' });
    const file = new File([blob], 'pasted-resume.txt', { type: 'text/plain' });
    setShowPasteModal(false);
    setPasteText('');
    await processFile(file);
  }

  function parseBulkPaste(text: string) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return { columns: [] as string[], rows: [] as Record<string, string>[] };
    const headers = lines[0].split('\t').map(h => h.trim());
    const rows = lines.slice(1).map(line => {
      const cells = line.split('\t');
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
      return row;
    }).filter(r => Object.values(r).some(v => v));
    return { columns: headers, rows };
  }

  async function handleBulkPreview() {
    const { rows } = parseBulkPaste(bulkPasteText);
    if (rows.length === 0) {
      showToast('No data rows found. Make sure you copy headers + data from your spreadsheet.', 'error');
      return;
    }
    setBulkStep('parsing');

    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bulk-parse-profiles`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ spreadsheet_text: bulkPasteText }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'AI parsing failed' }));
        throw new Error(err.error || `Request failed (${res.status})`);
      }
      const data = await res.json();
      if (!data.profiles || data.profiles.length === 0) {
        throw new Error('AI could not parse any candidates from the data.');
      }
      setBulkParsedRows(data.profiles);
      setBulkStep('preview');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'AI parsing failed', 'error');
      setBulkStep('paste');
    }
  }

  async function handleBulkCreate() {
    if (!account?.id || bulkCreating) return;
    setBulkCreating(true);
    setBulkStep('creating');
    const total = bulkParsedRows.length;
    setBulkProgress({ done: 0, total });

    const batchSize = 5;
    let created = 0;

    for (let i = 0; i < total; i += batchSize) {
      const batch = bulkParsedRows.slice(i, i + batchSize);
      const inserts = batch.map((p: Record<string, unknown>) => ({
        account_id: account!.id,
        candidate_name: (p.candidate_name as string) || 'Unknown',
        target_role: (p.target_role as string) || '',
        location: (p.location as string) || '',
        city: (p.city as string) || '',
        state: (p.state as string) || '',
        country: (p.country as string) || '',
        core_skills: (p.core_skills as string) || '',
        priority_skills: (p.priority_skills as string) || '',
        phone: (p.phone as string) || '',
        email: (p.email as string) || '',
        linkedin_url: (p.linkedin_url as string) || '',
        visa_status: (p.visa_status as string) || '',
        work_type: (p.work_type as string) || '',
        work_authorization: (p.work_authorization as string) || '',
        preferred_locations: (p.preferred_locations as string) || '',
        desired_salary_min: typeof p.desired_salary_min === 'number' && p.desired_salary_min > 0 ? p.desired_salary_min : null,
        desired_salary_max: typeof p.desired_salary_max === 'number' && p.desired_salary_max > 0 ? p.desired_salary_max : null,
        years_experience: typeof p.years_experience === 'number' && p.years_experience > 0 ? p.years_experience : null,
        relocation_open: p.relocation_open === true,
        availability: (p.availability as string) || '',
        tax_terms: (p.tax_terms as string) || '',
      }));

      const { data: createdRows, error } = await supabase.from('profiles').insert(inserts).select('id');
      if (error) {
        showToast(`Batch ${Math.floor(i / batchSize) + 1} failed: ${error.message}`, 'error');
      } else {
        for (const row of createdRows ?? []) {
          await addProfileToHotlist(row.id);
        }
        created += batch.length;
      }
      setBulkProgress({ done: Math.min(created, total), total });
    }

    await fetchProfiles();
    setBulkStep('done');
    setBulkCreating(false);
    showToast(`${created} profiles created successfully.`, 'success');
  }

  function resetBulkImportState() {
    setBulkPasteText('');
    setBulkParsedRows([]);
    setBulkCreating(false);
    setBulkProgress({ done: 0, total: 0 });
    setBulkStep('paste');
  }

  async function handleSave() {
    if (!parsed.candidate_name.trim() || !parsed.target_role.trim()) return;
    setSaving(true);
    const { data: profile, error: profileErr } = await supabase.from('profiles').insert({
      account_id: account?.id, candidate_name: parsed.candidate_name.trim(),
      target_role: parsed.target_role.trim(), location: parsed.location.trim(),
      city: parsed.city.trim(), state: parsed.state.trim(), zip_code: parsed.zip_code.trim(),
      country: parsed.country.trim(), phone: parsed.phone.trim(), email: parsed.email.trim(),
      linkedin_url: parsed.linkedin_url.trim(), github_url: parsed.github_url.trim(),
      portfolio_url: parsed.portfolio_url.trim(), core_skills: parsed.core_skills.trim(),
      years_experience: parsed.years_experience, visa_status: parsed.visa_status,
      work_type: parsed.work_type, notice_period: parsed.notice_period,
      availability: parsed.availability.trim(),
      relocation_open: parsed.relocation_status === 'Yes',
      desired_salary_min: parsed.desired_salary_min ? Number(parsed.desired_salary_min) : null,
      desired_salary_max: parsed.desired_salary_max ? Number(parsed.desired_salary_max) : null,
      preferred_locations: parsed.preferred_locations.trim(),
      education: parsed.education, experience: parsed.experience,
    }).select().single();

    if (profileErr || !profile) { showToast('Failed to create profile', 'error'); setSaving(false); return; }

    let fileUrl: string | null = null;
    if (pendingFile) {
      const storagePath = `${profile.id}/${Date.now()}-${pendingFile.name}`;
      const { error: uploadErr } = await supabase.storage.from('resumes')
        .upload(storagePath, pendingFile, { contentType: pendingFile.type || 'application/octet-stream' });
      if (!uploadErr) {
        const { data: urlData } = supabase.storage.from('resumes').getPublicUrl(storagePath);
        fileUrl = urlData.publicUrl;
      }
    }

    await addProfileToHotlist(profile.id);
    await supabase.from('resume_files').insert({ profile_id: profile.id, file_name: parsed.file_name || 'manual', file_url: fileUrl, category: 'resume' });
    await supabase.from('activity_logs').insert({
      profile_id: profile.id, event_type: 'profile_parsed',
      description: `Profile created${parsed.file_name ? ` from resume: ${parsed.file_name}` : ' manually'}`,
    });

    setProfiles(prev => [profile, ...prev]);
    fetchStats();
    setShowModal(false); setParsed(BLANK_PARSED); setPendingFile(null); setEarlyProfileId(null);
    showToast(`Profile created for ${profile.candidate_name}`);
    setSelectedProfileId(profile.id);
    setSaving(false);
    triggerProfileEmbedding(profile.id);
  }

  function addEdu() { setParsed(p => ({ ...p, education: [...p.education, { ...BLANK_EDU }] })); }
  function removeEdu(i: number) { setParsed(p => ({ ...p, education: p.education.filter((_, idx) => idx !== i) })); }
  function updateEdu(i: number, field: keyof EducationEntry, value: string) {
    setParsed(p => ({ ...p, education: p.education.map((e, idx) => idx === i ? { ...e, [field]: value } : e) }));
  }
  function addExp() { setParsed(p => ({ ...p, experience: [...p.experience, { ...BLANK_EXP }] })); }
  function removeExp(i: number) { setParsed(p => ({ ...p, experience: p.experience.filter((_, idx) => idx !== i) })); }
  function updateExp(i: number, field: keyof ExperienceEntry, value: string | boolean) {
    setParsed(p => ({ ...p, experience: p.experience.map((e, idx) => idx === i ? { ...e, [field]: value } : e) }));
  }

  // ── computed ────────────────────────────────────────────────────────────────

  const profileStats: ProfileStat[] = profiles.map(p => {
    const profileJobs   = allJobs.filter(j => j.profile_id === p.id);
    const profileScores = allMatchScores.filter(s => s['profile_id'] === p.id);
    const perBoard: Record<string, BoardMetrics> = {};
    for (const { key } of BOARDS) {
      const bJobs   = profileJobs.filter(j => j.board === key);
      const bScores = profileScores.filter(s => s[BOARD_COL[key]] != null);
      perBoard[key] = { fetched: bJobs.length, matched: bScores.length, saved: bJobs.length, rewritten: bJobs.filter(j => j.rewrite_file_url).length, applied: bJobs.filter(j => j.status === 'Applied').length };
    }
    return {
      profile: p, fetched: profileJobs.length, matched: profileMatchCounts[p.id] ?? 0,
      saved: profileJobs.length, rewritten: profileRewrittenCounts[p.id] ?? 0,
      applied: profileJobs.filter(j => j.status === 'Applied').length, perBoard,
    };
  });

  const sidebarProfiles = (sidebarTab === 'bench'
    ? profiles.filter(p => p.bench_stage !== 'Placed' && p.bench_stage !== 'Lost')
    : profiles.filter(p => hotlistIds.has(p.id))
  ).sort((a, b) => {
    const da = new Date(b.created_at || '').getTime();
    const db = new Date(a.created_at || '').getTime();
    return da - db;
  });

  const sidebarProfileIds = new Set(sidebarProfiles.map(p => p.id));

  const searchFilteredStats = profileStats.filter(({ profile: p }) => {
    if (!sidebarProfileIds.has(p.id)) return false;

    const profileUserIds = profileAssignments.filter(a => a.profile_id === p.id).map(a => a.user_id);

    if (assignedFilter === '__unassigned__') {
      if (profileUserIds.length > 0) return false;
    } else if (assignedFilter && !profileUserIds.includes(assignedFilter)) {
      return false;
    }

    const q = search.toLowerCase().trim();
    if (q) {
      const matchesCandidate = p.candidate_name.toLowerCase().includes(q)
        || (p.target_role ?? '').toLowerCase().includes(q)
        || (p.phone ?? '').toLowerCase().includes(q)
        || (p.email ?? '').toLowerCase().includes(q);
      const assignedMems = teamMembers.filter(m => m.user_id && profileUserIds.includes(m.user_id));
      const matchesAssignee = assignedMems.some(m => memberName(m).toLowerCase().includes(q) || m.invited_email.toLowerCase().includes(q));
      const matchesSubmission = submissions
        .filter(s => s.client_name.toLowerCase().includes(q) || s.vendor_name.toLowerCase().includes(q))
        .some(s => s.candidate_name.toLowerCase() === p.candidate_name.toLowerCase());
      if (!matchesCandidate && !matchesAssignee && !matchesSubmission) return false;
    }

    // Date preset filter
    const start = getBenchDateStart(datePreset);
    if (start) {
      const created = new Date(p.created_at);
      if (created < start) return false;
    }
    return true;
  });

  const filteredStats = searchFilteredStats;

  const handleSearchChange = (v: string) => setSearch(v);
  const datePresetLabel = BENCH_DATE_PRESETS.find(p => p.id === datePreset)?.label ?? 'All time';
  const selectedAssignee = teamMembers.find(m => m.user_id === assignedFilter);
  const assignedFilterLabel = !assignedFilter
    ? 'All assignees'
    : assignedFilter === '__unassigned__'
      ? 'Unassigned'
      : (selectedAssignee ? memberName(selectedAssignee) : 'Assigned');

  const selectedStat = profileStats.find(s => s.profile.id === selectedProfileId) ?? null;

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-gray-100 font-sans overflow-hidden">
      <AppNav />

      {/* Global Search Bar */}
      <div className="bg-white border-b border-gray-200 px-5 py-2.5 shrink-0 flex items-center gap-4">
        <div className="relative flex-1 max-w-2xl">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text" value={search} onChange={e => handleSearchChange(e.target.value)}
            placeholder="Search by candidate name, assigned user, client, vendor, or company…"
            className="w-full pl-10 pr-9 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 placeholder:text-gray-300 shadow-sm"
          />
          {search && (
            <button onClick={() => handleSearchChange('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
              <X size={13} />
            </button>
          )}
        </div>
        {/* Date selector + add new — top right */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <div ref={dateDropdownRef} className="relative shrink-0">
            <button
              onClick={() => setDateOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border bg-white text-gray-700 border-gray-200 hover:border-gray-300 transition-colors whitespace-nowrap"
            >
              <Calendar size={11} className="text-gray-400" />
              {datePresetLabel}
              <ChevronDown size={10} className={`transition-transform text-gray-400 ${dateOpen ? 'rotate-180' : ''}`} />
            </button>
            {dateOpen && (
              <div className="absolute right-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg z-50 w-52 py-1.5">
                {BENCH_DATE_PRESETS.map(option => (
                  <button
                    key={option.id}
                    onClick={() => { setDatePreset(option.id); setDateOpen(false); }}
                    className={`w-full text-left text-xs px-3 py-2 transition-colors flex items-center gap-2 ${
                      datePreset === option.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {datePreset === option.id && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => { setSelectedProfileId(null); navigate('/bench', { replace: true }); }}
            className="text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors shadow-sm"
          >
            + Add New
          </button>
        </div>
      </div>

      {/* 2-Column Layout */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* ── Column 1: Candidates ── */}
        <div className="w-72 flex flex-col border-r border-gray-200 bg-white shrink-0 overflow-hidden">

          <div className="h-[44px] flex items-center justify-between px-3 border-b border-gray-200 shrink-0">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">Candidates</h3>
            <div ref={assignedFilterRef} className="relative">
              <button
                onClick={() => setAssignedFilterOpen(o => !o)}
                title="Filter by assignee"
                className={`h-7 w-7 rounded-lg border flex items-center justify-center transition-colors ${assignedFilter ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300'}`}
              >
                <Filter size={12} />
                {assignedFilter && (
                  <span className="absolute -top-1 -right-1 h-3.5 min-w-[14px] px-1 rounded-full bg-blue-600 text-white text-[9px] font-bold leading-[14px] text-center">
                    1
                  </span>
                )}
              </button>
              {assignedFilterOpen && (
                <div className="absolute right-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg z-30 min-w-[180px] overflow-hidden">
                  <button
                    onClick={() => { setAssignedFilter(''); setAssignedFilterOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${assignedFilter === '' ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}
                  >
                    All assignees
                  </button>
                  <button
                    onClick={() => { setAssignedFilter('__unassigned__'); setAssignedFilterOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${assignedFilter === '__unassigned__' ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}
                  >
                    Unassigned
                  </button>
                  {teamMembers.filter(m => m.user_id).map(member => (
                    <button
                      key={member.user_id}
                      onClick={() => { setAssignedFilter(member.user_id!); setAssignedFilterOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors ${assignedFilter === member.user_id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                      {memberName(member)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="px-3 py-2 border-b border-gray-100 shrink-0">
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              {(['hotlist', 'bench'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setSidebarTab(tab)}
                  className={`flex-1 text-[11px] font-semibold py-1.5 rounded-md transition-all text-center ${
                    sidebarTab === tab
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab === 'hotlist' ? 'Hotlist' : 'Bench'}
                </button>
              ))}
            </div>
          </div>

          {/* Candidate count */}
          <div className="px-3 py-1.5 shrink-0 flex items-center justify-between border-b border-gray-50">
            <span className="text-[10px] text-gray-400 font-medium">{filteredStats.length} candidate{filteredStats.length !== 1 ? 's' : ''}</span>
            {assignedFilter && (
              <span className="text-[10px] text-blue-600 font-semibold truncate max-w-[130px]">{assignedFilterLabel}</span>
            )}
          </div>

          {/* Scrollable candidate list */}
          <div className="flex-1 overflow-y-auto">
            {(loading || statsLoading) ? (
              <div className="flex items-center justify-center py-10"><LogoSpinner size={16} /></div>
            ) : filteredStats.length === 0 ? (
              <div className="py-10 text-center px-4">
                  <p className="text-xs text-gray-400">{profiles.length === 0 ? 'No candidates yet. Click + Add New to upload one.' : 'No candidates match your filters.'}</p>
              </div>
            ) : filteredStats.map(({ profile: p, matched }) => {
              const isSelected = selectedProfileId === p.id;
              const matchedCount = matched;
              const healthScore = getMatchHealthPercent(p);
              const healthTone = healthScore === 0
                ? { chip: 'bg-gray-50 text-gray-500' }
                : healthScore < 60
                ? { chip: 'bg-red-50 text-red-700' }
                : healthScore < 80
                ? { chip: 'bg-amber-50 text-amber-700' }
                : { chip: 'bg-emerald-50 text-emerald-700' };
              const matchedTone = matchedCount === 0
                ? 'bg-gray-50 text-gray-500'
                : 'bg-violet-50 text-violet-700';
              return (
                <button key={p.id} onClick={() => setSelectedProfileId(isSelected ? null : p.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-all ${isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50/70 border-l-2 border-l-transparent'}`}>
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isSelected ? 'bg-blue-100' : 'bg-gray-100'}`}>
                      <UserCircle2 size={13} className={isSelected ? 'text-blue-600' : 'text-gray-400'} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[12px] font-semibold truncate leading-tight ${isSelected ? 'text-blue-900' : 'text-gray-800'}`}>{p.candidate_name}</p>
                      <p className="text-[10px] text-gray-400 truncate mt-0.5">{p.target_role || 'No target role'}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${matchedTone}`}>
                          Matched <span className="ml-0.5 text-[10px] font-bold">{matchedCount}</span>
                        </span>
                        <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${healthTone.chip}`}>
                          Health <span className="ml-0.5 text-[10px] font-bold">{healthScore}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Column 2: Candidate Detail ── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-50 min-w-0">
          {!selectedStat ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="w-full max-w-4xl space-y-4">
                {/* Bulk import inline widget */}
                <div className="rounded-2xl border border-blue-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-blue-100 bg-gradient-to-r from-blue-50 to-white">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                        <Table2 size={18} className="text-blue-600" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">Bulk Import Profiles</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">Paste Google Sheet or Excel rows to upload multiple candidates in one go.</p>
                      </div>
                    </div>
                  </div>

                  {bulkStep === 'paste' && (
                    <div className="px-6 py-5">
                      <textarea
                        value={bulkPasteText}
                        onChange={e => setBulkPasteText(e.target.value)}
                        placeholder={"Name\tRole\tSkills\tVisa\tWork Type\tRate\tLocation\n" + "John Doe\tJava Developer\tJava, Spring Boot, AWS\tH1B\tRemote\t65\tNew York, NY\n" + "Jane Smith\tReact Developer\tReact, TypeScript, Node\tGC\tHybrid\t70\tAustin, TX"}
                        className="w-full h-56 text-[11px] font-mono text-gray-700 border border-gray-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 placeholder:text-gray-300"
                      />
                      <div className="mt-4 flex justify-end">
                        <button
                          onClick={handleBulkPreview}
                          disabled={!bulkPasteText.trim()}
                          className="flex items-center gap-1.5 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl transition-colors shadow-sm"
                        >
                          Preview Data
                        </button>
                      </div>
                    </div>
                  )}

                  {bulkStep === 'parsing' && (
                    <div className="px-6 py-10 flex flex-col items-center justify-center gap-4">
                      <LogoSpinner size={28} />
                      <p className="text-sm font-semibold text-gray-700">AI is analyzing your spreadsheet data...</p>
                      <p className="text-xs text-gray-400">Intelligently mapping columns to candidate profile fields</p>
                    </div>
                  )}

                  {bulkStep === 'preview' && (
                    <div className="px-6 py-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs font-semibold text-gray-700">{bulkParsedRows.length} candidates parsed by AI</p>
                        <button onClick={() => setBulkStep('paste')} className="text-[11px] text-blue-600 hover:text-blue-700 font-medium">Edit Data</button>
                      </div>
                      <div className="border border-gray-200 rounded-xl overflow-hidden">
                        <div className="overflow-x-auto max-h-[42vh]">
                          <table className="w-full text-[11px]">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide">#</th>
                                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Name</th>
                                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Role</th>
                                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Skills</th>
                                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Visa</th>
                                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Work Type</th>
                                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Location</th>
                                <th className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">Rate</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {bulkParsedRows.map((row, idx) => (
                                <tr key={idx} className="hover:bg-gray-50/50">
                                  <td className="px-3 py-2 text-gray-400 font-medium">{idx + 1}</td>
                                  <td className="px-3 py-2 text-gray-900 font-medium whitespace-nowrap">{(row as Record<string,unknown>).candidate_name as string || '-'}</td>
                                  <td className="px-3 py-2 text-gray-700 max-w-[140px] truncate">{(row as Record<string,unknown>).target_role as string || '-'}</td>
                                  <td className="px-3 py-2 text-gray-700 max-w-[180px] truncate">{(row as Record<string,unknown>).core_skills as string || '-'}</td>
                                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{(row as Record<string,unknown>).visa_status as string || '-'}</td>
                                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{(row as Record<string,unknown>).work_type as string || '-'}</td>
                                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{(row as Record<string,unknown>).preferred_locations as string || (row as Record<string,unknown>).location as string || '-'}</td>
                                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{(row as Record<string,unknown>).desired_salary_max ? `${(row as Record<string,unknown>).desired_salary_max}/hr` : '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <div className="mt-4 flex items-center justify-between">
                        <p className="text-[10px] text-gray-400">Profiles will be created in batches of 5. Upload resumes individually afterward.</p>
                        <button
                          onClick={handleBulkCreate}
                          className="flex items-center gap-1.5 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl transition-colors shadow-sm"
                        >
                          Create {bulkParsedRows.length} Profiles
                        </button>
                      </div>
                    </div>
                  )}

                  {bulkStep === 'creating' && (
                    <div className="px-6 py-10 flex flex-col items-center justify-center gap-4">
                      <LogoSpinner size={28} />
                      <p className="text-sm font-semibold text-gray-700">Creating profiles in batches...</p>
                      <div className="w-64 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${bulkProgress.total ? (bulkProgress.done / bulkProgress.total) * 100 : 0}%` }} />
                      </div>
                      <p className="text-xs text-gray-500">{bulkProgress.done} / {bulkProgress.total} profiles created</p>
                    </div>
                  )}

                  {bulkStep === 'done' && (
                    <div className="px-6 py-10 flex flex-col items-center justify-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center">
                        <Check size={24} className="text-emerald-600" />
                      </div>
                      <p className="text-sm font-semibold text-gray-700">{bulkProgress.done} profiles created successfully!</p>
                      <p className="text-[11px] text-gray-400">Import another sheet to add more candidates.</p>
                      <button
                        onClick={resetBulkImportState}
                        className="mt-1 text-sm font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 px-5 py-2.5 rounded-xl transition-colors"
                      >
                        Import Another Sheet
                      </button>
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-2 mt-4">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={parsing}
                    className="flex items-center justify-center gap-1.5 text-xs font-semibold bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 text-gray-700 hover:text-blue-700 px-3 py-2.5 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {parsing ? <LogoSpinner size={11} /> : <Upload size={12} />} AI Resume Upload
                  </button>
                  <button
                    onClick={() => { setParsed(BLANK_PARSED); setPendingFile(null); setShowModal(true); }}
                    className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold bg-white hover:bg-violet-50 border border-gray-200 hover:border-violet-300 text-gray-700 hover:text-violet-700 px-3 py-2.5 rounded-xl transition-colors"
                  >
                    <UserPlus size={12} /> Add Manually
                  </button>
                  <button
                    onClick={generateOnboardingLink}
                    disabled={generatingLink}
                    className="flex items-center justify-center gap-1.5 text-xs font-semibold bg-white hover:bg-emerald-50 border border-gray-200 hover:border-emerald-300 text-gray-700 hover:text-emerald-700 px-3 py-2.5 rounded-xl transition-colors"
                  >
                    {generatingLink ? <LogoSpinner size={11} /> : <Link2 size={12} />}
                    {generatingLink ? 'Generating…' : 'Send Onboarding Link'}
                  </button>
                  <button
                    onClick={() => setShowPasteModal(true)}
                    className="flex items-center justify-center gap-1.5 text-xs font-semibold bg-white hover:bg-amber-50 border border-gray-200 hover:border-amber-300 text-gray-700 hover:text-amber-700 px-3 py-2.5 rounded-xl transition-colors"
                  >
                    <ClipboardPaste size={12} /> Paste Text
                  </button>
                </div>
                <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx,.rtf,.txt" className="hidden" onChange={handleFileChange} />
              </div>
            </div>
          ) : (() => {
            const { profile: p, fetched, matched, saved, rewritten, applied, perBoard } = selectedStat;
            const assignedUserIds = profileAssignments.filter(a => a.profile_id === p.id).map(a => a.user_id);
            const assignedMembers = teamMembers.filter(m => m.user_id && assignedUserIds.includes(m.user_id));
            const benchStage     = (p.bench_stage ?? 'New') as BenchStage;
            const stageCfg       = STAGE_CFG[benchStage];
            const isHotlistMember = hotlistIds.has(p.id);
            const isHotlistExpired = !isHotlistEligible(p);
            const daysAgo = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86_400_000);
            const sinceLabel = daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1d ago' : `${daysAgo}d ago`;
            const activeBoards = BOARDS.filter(b => { const m = perBoard[b.key]; return m && (m.fetched + m.matched + m.applied + m.rewritten) > 0; });
            const matchFieldRows = [
              { label: 'Target Role', field: 'target_role' as const, type: 'text' as const, options: [] as string[], value: editingMatchHealth ? (matchHealthDraft.target_role ?? '') : (p.target_role ?? '') },
              { label: 'Years Exp', field: 'years_experience' as const, type: 'number' as const, options: [] as string[], value: editingMatchHealth ? (matchHealthDraft.years_experience ?? '') : (p.years_experience != null ? `${p.years_experience} yr${p.years_experience !== 1 ? 's' : ''}` : '') },
              { label: 'Visa Status', field: 'visa_status' as const, type: 'select' as const, options: VISA_OPTIONS, value: editingMatchHealth ? (matchHealthDraft.visa_status ?? '') : (p.visa_status ?? '') },
              { label: 'Employment Type', field: 'work_authorization' as const, type: 'select' as const, options: WORK_AUTH_OPTIONS, value: editingMatchHealth ? (matchHealthDraft.work_authorization ?? '') : (p.work_authorization ?? '') },
              { label: 'Work Type', field: 'work_type' as const, type: 'select' as const, options: WORK_OPTIONS, value: editingMatchHealth ? (matchHealthDraft.work_type ?? '') : (p.work_type ?? '') },
              { label: 'Preferred Locations', field: 'preferred_locations' as const, type: 'text' as const, options: [] as string[], value: editingMatchHealth ? (matchHealthDraft.preferred_locations ?? '') : (p.preferred_locations ?? '') },
              { label: 'Min Rate', field: 'desired_salary_min' as const, type: 'number' as const, options: [] as string[], value: editingMatchHealth ? (matchHealthDraft.desired_salary_min ?? '') : (p.desired_salary_min != null ? `${Number(p.desired_salary_min).toLocaleString()}` : '') },
              { label: 'Max Rate', field: 'desired_salary_max' as const, type: 'number' as const, options: [] as string[], value: editingMatchHealth ? (matchHealthDraft.desired_salary_max ?? '') : (p.desired_salary_max != null ? `${Number(p.desired_salary_max).toLocaleString()}/hr` : '') },
            ];
            const matchHealthPct = getMatchHealthPercent({
              target_role: p.target_role,
              years_experience: p.years_experience,
              visa_status: p.visa_status,
              work_authorization: p.work_authorization,
              work_type: p.work_type,
              preferred_locations: p.preferred_locations,
              desired_salary_min: p.desired_salary_min,
              desired_salary_max: p.desired_salary_max,
            });
            const matchHealthTone = matchHealthPct === 0
              ? 'border-gray-200 bg-gray-50 text-gray-500'
              : matchHealthPct < 60
              ? 'border-red-200 bg-red-50 text-red-700'
              : matchHealthPct < 80
              ? 'border-amber-200 bg-amber-50 text-amber-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700';
            const updateMatchHealthField = (
              field: 'target_role' | 'years_experience' | 'visa_status' | 'work_authorization' | 'work_type' | 'preferred_locations' | 'desired_salary_min' | 'desired_salary_max',
              value: string | number | null,
            ) => {
              setMatchHealthDraft(prev => ({ ...prev, [field]: value }));
            };

            const resumeFiles = detailFiles.filter(f => f.category === 'resume' || /resume/i.test(f.file_name));
            const aiResumeFiles = detailFiles.filter(f => f.category === 'rewritten' || /rewritten|ai/i.test(f.file_name));
            const experienceFiles = detailFiles.filter(f => f.category === 'experience' || /experience/i.test(f.file_name));
            const educationFiles = detailFiles.filter(f => f.category === 'education' || /education/i.test(f.file_name));
            const visaFiles = detailFiles.filter(f => f.category === 'visa' || /visa/i.test(f.file_name));
            const otherFiles = detailFiles.filter(f => !resumeFiles.some(r => r.id === f.id) && !aiResumeFiles.some(a => a.id === f.id) && !experienceFiles.some(e => e.id === f.id) && !educationFiles.some(e => e.id === f.id) && !visaFiles.some(v => v.id === f.id));
            const renderDocCard = (f: ResumeFile) => {
              const catColors: Record<string, string> = {
                resume: 'bg-blue-50 text-blue-700 border-blue-200',
                rewritten: 'bg-emerald-50 text-emerald-700 border-emerald-200',
              };
              const dateLabel = new Date(f.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              const isChecked = selectedDocIds.has(f.id);
              return (
                <div key={f.id} onClick={() => setSelectedDocIds(prev => { const s = new Set(prev); isChecked ? s.delete(f.id) : s.add(f.id); return s; })}
                  className={`p-2.5 border rounded-xl cursor-pointer transition-colors ${isChecked ? 'border-blue-300 bg-blue-50/60' : 'border-gray-200 bg-white hover:bg-gray-50/50'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-colors ${isChecked ? 'bg-blue-500 border-blue-500' : 'border-gray-300 bg-white'}`}>
                        {isChecked && <Check size={8} className="text-white" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold text-gray-700 truncate">{f.file_name}</p>
                        <p className="text-[9px] text-gray-400 mt-0.5">{dateLabel}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${catColors[f.category] ?? 'bg-gray-50 text-gray-500 border-gray-200'}`}>{f.category}</span>
                      {f.file_url && (
                        <a href={f.file_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
                          className="flex items-center gap-0.5 text-[9px] text-blue-600 hover:text-blue-800 transition-colors">
                          <ExternalLink size={8} /> View
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            };

            return (
              <div className="flex-1 flex flex-col overflow-hidden">

                {/* ── Shared candidate header ── */}
                <div className="bg-white border-b border-gray-200 px-5 py-3 shrink-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-bold text-gray-900 truncate">{p.candidate_name}</h2>
                    <p className="text-xs text-gray-500 truncate">{p.target_role}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (isHotlistMember) {
                            if (!account?.id) return;
                            await supabase.from('hotlist').delete().eq('profile_id', p.id).eq('account_id', account.id);
                            setHotlistIds(prev => {
                              const next = new Set(prev);
                              next.delete(p.id);
                              return next;
                            });
                            showToast(`${p.candidate_name} removed from hotlist`);
                            return;
                          }

                          if (isHotlistExpired && !isPaidPlan) {
                            showToast('Upgrade to Pro to add candidates older than 15 days back to Hotlist.', 'error');
                            return;
                          }

                          if (!account?.id) return;
                          setHotlistAdding(p.id);
                          const { error } = await supabase.from('hotlist').upsert({
                            profile_id: p.id,
                            account_id: account.id,
                            created_at: new Date().toISOString(),
                          }, { onConflict: 'profile_id,account_id' });

                          if (!error) {
                            setHotlistIds(prev => new Set([...prev, p.id]));
                            showToast(`${p.candidate_name} added to hotlist`);
                          } else {
                            showToast('Failed to update hotlist', 'error');
                          }
                          setHotlistAdding(null);
                        }}
                        disabled={hotlistAdding === p.id || (!isHotlistMember && isHotlistExpired && !isPaidPlan)}
                        className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors border shrink-0 ${
                          isHotlistMember
                            ? 'bg-amber-50 text-amber-600 border-amber-200 cursor-pointer'
                            : 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500'
                        } ${(!isHotlistMember && isHotlistExpired && !isPaidPlan) ? 'opacity-70 cursor-not-allowed' : ''}`}
                      >
                        <Target size={10} className="shrink-0" />
                        {hotlistAdding === p.id ? 'Updating...' : isHotlistMember ? 'Remove' : isHotlistExpired && !isPaidPlan ? 'Pro Required' : '+ Hotlist'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/job-watch-ai?profileId=${p.id}`); }}
                        className="flex items-center gap-1 text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 rounded-lg transition-colors border border-emerald-600 shrink-0"
                      >
                        <Cpu size={10} className="shrink-0" />
                        AI Job Match
                      </button>
                      <button
                        onClick={() => navigate(`/job-finder?profileId=${p.id}`)}
                        className="flex items-center gap-1 text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded-lg transition-colors border border-blue-600 shrink-0"
                      >
                        <Search size={10} className="shrink-0" />
                        Find Jobs
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect(); setAssignPopup(assignPopup?.profileId === p.id ? null : { profileId: p.id, search: '', rect }); }}
                        className={`flex items-center gap-1.5 text-[11px] font-medium border rounded-lg px-2 py-0.5 transition-colors ${assignedMembers.length > 0 ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' : 'bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100'}`}>
                        <UserCircle2 size={11} className="shrink-0" />
                        <span className="truncate max-w-[80px]">{assignedMembers.length > 0 ? assignedMembers.map(m => memberName(m)).join(', ') : 'Unassigned'}</span>
                        <ChevronDown size={9} className="shrink-0" />
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditingFullProfile(p)}
                        title="Edit profile"
                        className="flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors shrink-0"
                      >
                        <Edit2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── 3 Sub-columns ── */}
                <div className="flex-1 flex overflow-hidden">

                  {/* Sub-col 1: Profile */}
                  <div className="flex-1 flex flex-col border-r border-gray-200 overflow-hidden min-w-0">
                    <div className="h-11 px-4 border-b border-gray-200 bg-gray-50 shrink-0 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Match Rules</p>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-3">

                      <div className={`rounded-xl border p-2.5 ${matchHealthTone}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-sm font-bold ${matchHealthTone}`}>{matchHealthPct}% Match Health</p>
                          {editingMatchHealth ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={saveMatchHealthRules}
                                disabled={savingMatchHealth}
                                className="flex items-center gap-1 text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-2 py-1 rounded-lg transition-colors"
                              >
                                <Check size={10} /> {savingMatchHealth ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                onClick={() => { setEditingMatchHealth(false); setMatchHealthDraft({}); }}
                                className="text-[10px] font-semibold text-gray-600 hover:text-gray-900 bg-white hover:bg-gray-100 px-2 py-1 rounded-lg border border-gray-200 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setMatchHealthDraft({
                                  target_role: p.target_role ?? '',
                                  years_experience: p.years_experience ?? null,
                                  visa_status: p.visa_status ?? '',
                                  work_authorization: p.work_authorization ?? '',
                                  work_type: p.work_type ?? '',
                                  preferred_locations: p.preferred_locations ?? '',
                                  desired_salary_min: p.desired_salary_min ?? null,
                                  desired_salary_max: p.desired_salary_max ?? null,
                                });
                                setEditingMatchHealth(true);
                              }}
                              title="Edit match rules"
                              className="flex items-center justify-center w-6 h-6 rounded-lg border border-gray-200 bg-white text-gray-600 hover:text-gray-900 hover:bg-gray-50 transition-colors"
                            >
                              <Edit2 size={11} />
                            </button>
                          )}
                        </div>
                        <div className="mt-2 space-y-1.5">
                          {matchFieldRows.map((row) => {
                            const hasValue = String(row.value ?? '').trim().length > 0;
                            return (
                              <div key={row.label} className="flex flex-col gap-1 rounded-lg bg-white/70 px-2 py-1.5 border border-gray-100">
                                <p className="text-[10px] font-semibold text-gray-600">{row.label}</p>
                                {editingMatchHealth ? (
                                  row.type === 'select' ? (
                                    <select
                                      value={String((matchHealthDraft as Record<string, unknown>)[row.field] ?? '')}
                                      onChange={(e) => updateMatchHealthField(row.field, e.target.value)}
                                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[10px] bg-white focus:outline-none focus:border-amber-300"
                                    >
                                      <option value="">Select…</option>
                                      {row.options.map(option => <option key={option} value={option}>{option}</option>)}
                                    </select>
                                  ) : (
                                    <input
                                      type={row.type}
                                      value={String((matchHealthDraft as Record<string, unknown>)[row.field] ?? '')}
                                      onChange={(e) => updateMatchHealthField(row.field, e.target.value)}
                                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-[10px] bg-white focus:outline-none focus:border-amber-300"
                                    />
                                  )
                                ) : (
                                  <p className={`text-[10px] font-medium ${hasValue ? 'text-gray-800' : 'text-gray-400 italic'}`}>
                                    {hasValue ? row.value : 'Empty'}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* ── Priority Skills — always at top ── */}
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <Star size={10} className="text-amber-500 fill-amber-400 shrink-0" />
                            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Priority Skills</p>
                          </div>
                          <div className="flex items-center gap-1">
                            {/* AI Generate button */}
                            <button
                              onClick={() => generatePrioritySkills(p)}
                              disabled={aiGeneratingSkills}
                              title="AI: suggest 5 priority skills"
                              className="flex items-center gap-1 text-[9px] font-bold bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 disabled:opacity-50 text-white px-2 py-1 rounded-lg transition-all shadow-sm">
                              {aiGeneratingSkills ? <LogoSpinner size={9} /> : <Sparkles size={9} />}
                              {aiGeneratingSkills ? 'Thinking…' : 'AI'}
                            </button>
                            {!editingPrioritySkills && (
                              <button
                                onClick={() => {
                                  const current = p.priority_skills ? p.priority_skills.split(',').map(s => s.trim()).filter(Boolean) : [];
                                  setPrioritySkillsItems(current);
                                  setNewSkillInput('');
                                  setEditingPrioritySkills(true);
                                }}
                                className="flex items-center justify-center text-amber-600 hover:text-amber-800 bg-amber-100 hover:bg-amber-200 w-7 h-7 rounded-lg transition-colors">
                                <Edit2 size={9} />
                              </button>
                            )}
                          </div>
                        </div>

                        {editingPrioritySkills ? (
                          <div className="space-y-2">
                            {/* Line items */}
                            <div className="space-y-1">
                              {prioritySkillsItems.map((skill, idx) => (
                                <div key={idx} className="flex items-center gap-1.5 group">
                                  <span className="text-[9px] font-bold text-amber-400 w-4 text-right shrink-0">{idx + 1}</span>
                                  <input
                                    type="text"
                                    value={skill}
                                    onChange={e => setPrioritySkillsItems(prev => prev.map((s, i) => i === idx ? e.target.value : s))}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter' && prioritySkillsItems.length < 10) {
                                        e.preventDefault();
                                        setPrioritySkillsItems(prev => [...prev.slice(0, idx + 1), '', ...prev.slice(idx + 1)]);
                                        setTimeout(() => {
                                          const inputs = document.querySelectorAll<HTMLInputElement>('[data-priority-skill]');
                                          inputs[idx + 1]?.focus();
                                        }, 0);
                                      } else if (e.key === 'Backspace' && skill === '' && prioritySkillsItems.length > 1) {
                                        e.preventDefault();
                                        setPrioritySkillsItems(prev => prev.filter((_, i) => i !== idx));
                                        setTimeout(() => {
                                          const inputs = document.querySelectorAll<HTMLInputElement>('[data-priority-skill]');
                                          inputs[Math.max(0, idx - 1)]?.focus();
                                        }, 0);
                                      }
                                    }}
                                    data-priority-skill
                                    placeholder={`Skill ${idx + 1}`}
                                    className="flex-1 min-w-0 text-xs border border-amber-200 bg-white rounded-lg px-2 py-1 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-100 placeholder:text-amber-200"
                                  />
                                  <button onClick={() => setPrioritySkillsItems(prev => prev.filter((_, i) => i !== idx))}
                                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all shrink-0">
                                    <X size={10} />
                                  </button>
                                </div>
                              ))}
                            </div>
                            {/* Add new skill */}
                            {prioritySkillsItems.length < 10 && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-bold text-gray-300 w-4 text-right shrink-0">{prioritySkillsItems.length + 1}</span>
                                <input
                                  ref={newSkillRef}
                                  type="text"
                                  value={newSkillInput}
                                  onChange={e => setNewSkillInput(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter' && newSkillInput.trim()) {
                                      setPrioritySkillsItems(prev => [...prev, newSkillInput.trim()]);
                                      setNewSkillInput('');
                                    }
                                  }}
                                  placeholder="+ Add skill, press Enter"
                                  className="flex-1 min-w-0 text-xs border border-dashed border-amber-300 bg-amber-50/50 rounded-lg px-2 py-1 focus:outline-none focus:border-amber-400 placeholder:text-amber-300"
                                />
                              </div>
                            )}
                            <p className="text-[9px] text-amber-500/70">{prioritySkillsItems.length}/10 skills · Enter to add next line</p>
                            <div className="flex items-center gap-1.5 pt-1 border-t border-amber-200">
                              <button onClick={() => savePrioritySkills(p.id, newSkillInput.trim() ? [...prioritySkillsItems, newSkillInput.trim()] : prioritySkillsItems)}
                                className="flex items-center gap-1 text-[10px] font-bold bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg transition-colors shadow-sm">
                                <Check size={9} /> Save
                              </button>
                              <button onClick={() => { setEditingPrioritySkills(false); setNewSkillInput(''); }}
                                className="text-[10px] font-semibold text-gray-500 hover:text-gray-700 px-2.5 py-1.5 rounded-lg transition-colors bg-white hover:bg-gray-100 border border-gray-200">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (p.priority_skills && p.priority_skills.split(',').some(s => s.trim())) ? (
                          <div className="space-y-1">
                            {p.priority_skills.split(',').map(s => s.trim()).filter(Boolean).map((skill, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <span className="text-[9px] font-bold text-amber-400 w-4 text-right shrink-0">{idx + 1}</span>
                                <span className="text-xs font-semibold text-amber-800 bg-white border border-amber-200 px-2.5 py-1 rounded-lg flex-1 truncate shadow-sm">{skill}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-amber-500/60 italic">No priority skills yet — click Edit or use AI to suggest</p>
                        )}
                      </div>


                    </div>
                  </div>

                  {/* Sub-col 2: Full profile */}
                  <div className="flex-1 flex flex-col border-r border-gray-200 overflow-hidden min-w-0">
                    <div className="h-11 px-4 border-b border-gray-200 bg-gray-50 shrink-0 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Full Profile</p>
                      {editingFullProfile ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={saveFullProfileEdits}
                            disabled={savingFullProfile}
                            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors"
                          >
                            <Check size={10} /> {savingFullProfile ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditingFullProfile}
                            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEditingFullProfile(p)}
                          title="Edit profile"
                          className="flex items-center justify-center w-7 h-7 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                        >
                          <Edit2 size={12} />
                        </button>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                      <DetailSection title="Contact Details" color="gray">
                        {editingFullProfile ? (
                          <div className="space-y-2">
                            <input value={String((fullProfileDraft as Record<string, unknown>).phone ?? '')} onChange={e => setFullProfileDraft(prev => ({ ...prev, phone: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="Phone" />
                            <input value={String((fullProfileDraft as Record<string, unknown>).email ?? '')} onChange={e => setFullProfileDraft(prev => ({ ...prev, email: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="Email" />
                            <input value={String((fullProfileDraft as Record<string, unknown>).linkedin_url ?? '')} onChange={e => setFullProfileDraft(prev => ({ ...prev, linkedin_url: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="LinkedIn URL" />
                            <input value={String((fullProfileDraft as Record<string, unknown>).github_url ?? '')} onChange={e => setFullProfileDraft(prev => ({ ...prev, github_url: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="GitHub URL" />
                            <input value={String((fullProfileDraft as Record<string, unknown>).portfolio_url ?? '')} onChange={e => setFullProfileDraft(prev => ({ ...prev, portfolio_url: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="Portfolio URL" />
                          </div>
                        ) : (
                          <>
                            <DetailField label="Phone" value={p.phone || '—'} />
                            <DetailField label="Email" value={p.email || '—'} />
                            <DetailField label="LinkedIn" value={p.linkedin_url || '—'} />
                            <DetailField label="GitHub" value={p.github_url || '—'} />
                            <DetailField label="Portfolio" value={p.portfolio_url || '—'} />
                          </>
                        )}
                      </DetailSection>

                      <DetailSection title="Availability & Notice" color="amber">
                        {editingFullProfile ? (
                          <div className="space-y-2">
                            <select value={String((fullProfileDraft as Record<string, unknown>).notice_period ?? '')} onChange={e => setFullProfileDraft(prev => ({ ...prev, notice_period: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs bg-white">
                              <option value="">Select…</option>
                              {NOTICE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                            </select>
                            <select value={String((fullProfileDraft as Record<string, unknown>).availability ?? '')} onChange={e => setFullProfileDraft(prev => ({ ...prev, availability: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs bg-white">
                              <option value="">Select…</option>
                              {['Immediate', '1 Week', '2 Weeks', '1 Month', '2 Months'].map(option => <option key={option} value={option}>{option}</option>)}
                            </select>
                          </div>
                        ) : (
                          <>
                            <DetailField label="Notice period" value={p.notice_period || '—'} />
                            <DetailField label="Availability" value={p.availability || '—'} />
                          </>
                        )}
                      </DetailSection>

                      <DetailSection title="Work Experience" color="emerald">
                        {editingFullProfile ? (
                          <div className="space-y-2">
                            {Array.isArray(fullProfileDraft.experience) && fullProfileDraft.experience.length > 0 ? (
                              fullProfileDraft.experience.map((exp: ExperienceEntry, i: number) => (
                                <div key={i} className="rounded-xl border border-gray-200 bg-white p-2.5 text-xs text-gray-600">
                                  <p className="font-semibold text-gray-800">{exp.title || 'Untitled role'}</p>
                                  <p className="mt-0.5 text-[11px] text-gray-500">{exp.company || 'Unknown company'}</p>
                                  <p className="mt-1 text-[10px] text-gray-400">{[exp.location, exp.start_date, exp.end_date].filter(Boolean).join(' • ') || '—'}</p>
                                </div>
                              ))
                            ) : (
                              <p className="text-[11px] text-gray-400 italic">No work experience added</p>
                            )}
                            {experienceAddOpen ? (
                              <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-2.5">
                                <input value={experienceDraft.company} onChange={e => setExperienceDraft(prev => ({ ...prev, company: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="Company" />
                                <input value={experienceDraft.title} onChange={e => setExperienceDraft(prev => ({ ...prev, title: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="Title" />
                                <input value={experienceDraft.location} onChange={e => setExperienceDraft(prev => ({ ...prev, location: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="Location" />
                                <div className="grid grid-cols-2 gap-2">
                                  <input value={experienceDraft.start_date} onChange={e => setExperienceDraft(prev => ({ ...prev, start_date: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="Start date" />
                                  <input value={experienceDraft.end_date} onChange={e => setExperienceDraft(prev => ({ ...prev, end_date: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="End date" />
                                </div>
                                <label className="flex items-center gap-2 text-[10px] font-semibold text-gray-600">
                                  <input type="checkbox" checked={Boolean(experienceDraft.current)} onChange={e => setExperienceDraft(prev => ({ ...prev, current: e.target.checked }))} />
                                  Current role
                                </label>
                                <textarea value={experienceDraft.description} onChange={e => setExperienceDraft(prev => ({ ...prev, description: e.target.value }))} rows={3} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="Description" />
                                <div className="flex items-center gap-2">
                                  <button type="button" onClick={addExperienceEntry} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-semibold text-white">Save</button>
                                  <button type="button" onClick={() => { setExperienceAddOpen(false); setExperienceDraft(BLANK_EXP); }} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[10px] font-semibold text-gray-600">Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" onClick={() => setExperienceAddOpen(true)} className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-800">
                                <Plus size={10} /> Add
                              </button>
                            )}
                          </div>
                        ) : (
                          Array.isArray(p.experience) && p.experience.length > 0 ? (
                            p.experience.map((exp: ExperienceEntry, i: number) => {
                              const expanded = expandedExpIds.has(i);
                              const hasDesc = !!exp.description;
                              return (
                                <div key={i} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                                  <button
                                    onClick={() => hasDesc && setExpandedExpIds(prev => {
                                      const s = new Set(prev);
                                      s.has(i) ? s.delete(i) : s.add(i);
                                      return s;
                                    })}
                                    className={`w-full text-left p-2.5 ${hasDesc ? 'cursor-pointer hover:bg-gray-50/70' : 'cursor-default'} transition-colors`}>
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0 flex-1">
                                        <p className="text-xs font-bold text-gray-800 truncate">{exp.title || 'Untitled role'}</p>
                                        <p className="text-[11px] text-gray-500 truncate">{exp.company || 'Unknown company'}</p>
                                        <div className="flex items-center gap-2 text-[9px] text-gray-400 mt-0.5">
                                          {exp.location && <span className="truncate">{exp.location}</span>}
                                          {(exp.start_date || exp.end_date) && (
                                            <span className="shrink-0">{exp.start_date}{exp.start_date && (exp.end_date || exp.current) ? ' – ' : ''}{exp.current ? 'Present' : exp.end_date}</span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1 shrink-0">
                                        {exp.current && <span className="text-[8px] font-bold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full">Current</span>}
                                        {hasDesc && <ChevronDown size={10} className={`text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />}
                                      </div>
                                    </div>
                                  </button>
                                  {expanded && hasDesc && (
                                    <div className="px-2.5 pb-2.5 pt-0 border-t border-gray-100">
                                      <p className="text-[10px] text-gray-500 leading-relaxed whitespace-pre-line">{exp.description}</p>
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          ) : (
                            <p className="text-[11px] text-gray-400 italic">No work experience added</p>
                          )
                        )}
                      </DetailSection>

                      <DetailSection title="Education" color="violet">
                        {editingFullProfile ? (
                          <div className="space-y-2">
                            {Array.isArray(fullProfileDraft.education) && fullProfileDraft.education.length > 0 ? (
                              fullProfileDraft.education.map((edu: EducationEntry, i: number) => (
                                <div key={i} className="rounded-xl border border-gray-200 bg-white p-2.5 text-xs text-gray-600">
                                  <p className="font-semibold text-gray-800">{edu.institution || 'Institution not provided'}</p>
                                  <p className="mt-0.5 text-[11px] text-gray-500">{[edu.degree, edu.field].filter(Boolean).join(' · ') || '—'}</p>
                                  <p className="mt-1 text-[10px] text-gray-400">{[edu.start_year, edu.end_year].filter(Boolean).join(' – ') || '—'}</p>
                                </div>
                              ))
                            ) : (
                              <p className="text-[11px] text-gray-400 italic">No education added</p>
                            )}
                            {educationAddOpen ? (
                              <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-2.5">
                                <input value={educationDraft.institution} onChange={e => setEducationDraft(prev => ({ ...prev, institution: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="Institution" />
                                <input value={educationDraft.degree} onChange={e => setEducationDraft(prev => ({ ...prev, degree: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="Degree" />
                                <input value={educationDraft.field} onChange={e => setEducationDraft(prev => ({ ...prev, field: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="Field" />
                                <div className="grid grid-cols-2 gap-2">
                                  <input value={educationDraft.start_year} onChange={e => setEducationDraft(prev => ({ ...prev, start_year: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="Start year" />
                                  <input value={educationDraft.end_year} onChange={e => setEducationDraft(prev => ({ ...prev, end_year: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="End year" />
                                </div>
                                <input value={educationDraft.gpa} onChange={e => setEducationDraft(prev => ({ ...prev, gpa: e.target.value }))} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" placeholder="GPA" />
                                <div className="flex items-center gap-2">
                                  <button type="button" onClick={addEducationEntry} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-semibold text-white">Save</button>
                                  <button type="button" onClick={() => { setEducationAddOpen(false); setEducationDraft(BLANK_EDU); }} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[10px] font-semibold text-gray-600">Cancel</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" onClick={() => setEducationAddOpen(true)} className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-800">
                                <Plus size={10} /> Add
                              </button>
                            )}
                          </div>
                        ) : (
                          Array.isArray(p.education) && p.education.length > 0 ? (
                            p.education.map((edu: EducationEntry, i: number) => (
                              <div key={i} className="bg-white border border-gray-200 rounded-xl p-2.5 space-y-1">
                                <p className="text-xs font-bold text-gray-800 truncate">{edu.institution || 'Institution not provided'}</p>
                                <p className="text-[11px] text-gray-600 truncate">{[edu.degree, edu.field].filter(Boolean).join(' · ') || '—'}</p>
                                <div className="flex items-center gap-2 text-[9px] text-gray-400">
                                  {(edu.start_year || edu.end_year) && <span>{edu.start_year}{edu.start_year && edu.end_year ? ' – ' : ''}{edu.end_year}</span>}
                                  {edu.gpa && <span>GPA {edu.gpa}</span>}
                                </div>
                              </div>
                            ))
                          ) : (
                            <p className="text-[11px] text-gray-400 italic">No education added</p>
                          )
                        )}
                      </DetailSection>
                    </div>
                  </div>

                  {/* Sub-col 3: Documents */}
                  <div className="flex-1 flex flex-col border-r border-gray-200 overflow-hidden min-w-0">
                    <div className="h-11 px-4 border-b border-gray-200 bg-gray-50 shrink-0 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Documents</p>
                        {detailFiles.length > 0 && <span className="text-[9px] font-semibold text-gray-400 bg-gray-200 rounded-full px-1.5 py-0.5">{detailFiles.length}</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        {selectedDocIds.size > 0 && (
                          <button
                            onClick={() => {
                              detailFiles.filter(f => selectedDocIds.has(f.id) && f.file_url).forEach(f => {
                                const a = document.createElement('a');
                                a.href = f.file_url!;
                                a.download = f.file_name;
                                a.target = '_blank';
                                a.click();
                              });
                            }}
                            title={`Download ${selectedDocIds.size} selected`}
                            className="flex items-center gap-1 text-[9px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg transition-colors border border-blue-100">
                            <Download size={9} /> {selectedDocIds.size}
                          </button>
                        )}
                        <button onClick={() => { setDocUploadTarget('resume'); docUploadRef.current?.click(); }}
                          title="Upload document"
                          className="flex items-center gap-0.5 text-[9px] font-semibold text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-lg transition-colors">
                          <Plus size={9} /> Upload
                        </button>
                        <input ref={docUploadRef} type="file" accept=".pdf,.doc,.docx,.rtf,.txt,.html" className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; if (f) uploadDocForProfile(f, docUploadTarget); e.target.value = ''; }} />
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3">
                      {detailLoading ? (
                        <div className="flex items-center justify-center py-6"><LogoSpinner size={14} /></div>
                      ) : (
                        <div className="space-y-2">
                          <CollapsibleSection title="Resume" color="blue" defaultOpen={false} count={resumeFiles.length} action={<button type="button" onClick={(e) => { e.stopPropagation(); setDocUploadTarget('resume'); docUploadRef.current?.click(); }} className="text-[10px] font-semibold text-blue-600 hover:text-blue-800">+ Upload</button>}>
                            {resumeFiles.length === 0 ? (
                              <div className="flex flex-col items-start gap-2">
                                <p className="text-[11px] text-gray-400 italic">No resume files yet</p>
                                <button type="button" onClick={() => { setDocUploadTarget('resume'); docUploadRef.current?.click(); }} className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-800">
                                  <Plus size={10} /> Upload
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-2">{resumeFiles.map(renderDocCard)}</div>
                            )}
                          </CollapsibleSection>

                          <CollapsibleSection title="AI Resumes" color="emerald" defaultOpen={false} count={aiResumeFiles.length} action={<button type="button" onClick={(e) => { e.stopPropagation(); setDocUploadTarget('rewritten'); docUploadRef.current?.click(); }} className="text-[10px] font-semibold text-emerald-600 hover:text-emerald-800">+ Upload</button>}>
                            {aiResumeFiles.length === 0 ? (
                              <div className="flex flex-col items-start gap-2">
                                <p className="text-[11px] text-gray-400 italic">No AI resume files yet</p>
                                <button type="button" onClick={() => { setDocUploadTarget('rewritten'); docUploadRef.current?.click(); }} className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 hover:text-emerald-800">
                                  <Plus size={10} /> Upload
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-2">{aiResumeFiles.map(renderDocCard)}</div>
                            )}
                          </CollapsibleSection>

                          <CollapsibleSection title="Experience" color="violet" defaultOpen={false} count={experienceFiles.length} action={<button type="button" onClick={(e) => { e.stopPropagation(); setDocUploadTarget('experience'); docUploadRef.current?.click(); }} className="text-[10px] font-semibold text-violet-600 hover:text-violet-800">+ Upload</button>}>
                            {experienceFiles.length === 0 ? (
                              <div className="flex flex-col items-start gap-2">
                                <p className="text-[11px] text-gray-400 italic">No experience files yet</p>
                                <button type="button" onClick={() => { setDocUploadTarget('experience'); docUploadRef.current?.click(); }} className="flex items-center gap-1 text-[10px] font-semibold text-violet-600 hover:text-violet-800">
                                  <Plus size={10} /> Upload
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-2">{experienceFiles.map(renderDocCard)}</div>
                            )}
                          </CollapsibleSection>

                          <CollapsibleSection title="Education" color="amber" defaultOpen={false} count={educationFiles.length} action={<button type="button" onClick={(e) => { e.stopPropagation(); setDocUploadTarget('education'); docUploadRef.current?.click(); }} className="text-[10px] font-semibold text-amber-600 hover:text-amber-800">+ Upload</button>}>
                            {educationFiles.length === 0 ? (
                              <div className="flex flex-col items-start gap-2">
                                <p className="text-[11px] text-gray-400 italic">No education files yet</p>
                                <button type="button" onClick={() => { setDocUploadTarget('education'); docUploadRef.current?.click(); }} className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 hover:text-amber-800">
                                  <Plus size={10} /> Upload
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-2">{educationFiles.map(renderDocCard)}</div>
                            )}
                          </CollapsibleSection>

                          <CollapsibleSection title="Visa" color="gray" defaultOpen={false} count={visaFiles.length} action={<button type="button" onClick={(e) => { e.stopPropagation(); setDocUploadTarget('visa'); docUploadRef.current?.click(); }} className="text-[10px] font-semibold text-gray-600 hover:text-gray-800">+ Upload</button>}>
                            {visaFiles.length === 0 ? (
                              <div className="flex flex-col items-start gap-2">
                                <p className="text-[11px] text-gray-400 italic">No visa files yet</p>
                                <button type="button" onClick={() => { setDocUploadTarget('visa'); docUploadRef.current?.click(); }} className="flex items-center gap-1 text-[10px] font-semibold text-gray-600 hover:text-gray-800">
                                  <Plus size={10} /> Upload
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-2">{visaFiles.map(renderDocCard)}</div>
                            )}
                          </CollapsibleSection>

                          <CollapsibleSection title="Others" color="gray" defaultOpen={false} count={otherFiles.length} action={<button type="button" onClick={(e) => { e.stopPropagation(); setDocUploadTarget('others'); docUploadRef.current?.click(); }} className="text-[10px] font-semibold text-gray-600 hover:text-gray-800">+ Upload</button>}>
                            {otherFiles.length === 0 ? (
                              <div className="flex flex-col items-start gap-2">
                                <p className="text-[11px] text-gray-400 italic">No other files yet</p>
                                <button type="button" onClick={() => { setDocUploadTarget('others'); docUploadRef.current?.click(); }} className="flex items-center gap-1 text-[10px] font-semibold text-gray-600 hover:text-gray-800">
                                  <Plus size={10} /> Upload
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-2">{otherFiles.map(renderDocCard)}</div>
                            )}
                          </CollapsibleSection>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Sub-col 4: Activity */}
                  <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                    <div className="h-11 px-4 border-b border-gray-200 bg-gray-50 shrink-0 flex items-center justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Activity</p>
                      <span className="text-[10px] font-semibold text-gray-500 bg-white border border-gray-200 rounded-full px-2 py-0.5">
                        {p.created_at ? new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                      </span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                      {/* Metrics */}
                      <div className="space-y-1.5">
                        {([
                          { label: 'Fetched',   value: fetched,   color: 'text-gray-700' },
                          { label: 'Matched',   value: matched,   color: matched   > 0 ? 'text-violet-600' : 'text-gray-300' },
                          { label: 'Saved',     value: saved,     color: 'text-gray-700' },
                          { label: 'Rewritten', value: rewritten, color: rewritten > 0 ? 'text-blue-600'   : 'text-gray-300' },
                          { label: 'Applied',   value: applied,   color: applied   > 0 ? 'text-emerald-600': 'text-gray-400' },
                        ]).map(({ label, value, color }) => (
                          <div key={label} className="flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-gray-50 border border-gray-100">
                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-wide">{label}</p>
                            <p className={`text-sm font-black tabular-nums ${color}`}>{value}</p>
                          </div>
                        ))}
                      </div>

                      {/* Per-board */}
                      {activeBoards.length > 0 && (
                        <div className="pt-2 border-t border-gray-100 space-y-1">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">By Board</p>
                          {activeBoards.map(board => {
                            const bm = perBoard[board.key];
                            return (
                              <div key={board.key} className="flex items-center gap-2 py-1">
                                <div className={`w-1.5 h-1.5 rounded-full ${board.dot} shrink-0`} />
                                <span className={`text-[10px] font-bold ${board.text} w-[72px] shrink-0 truncate`}>{board.key}</span>
                                <div className="flex flex-wrap gap-1.5 text-[9px]">
                                  {bm.fetched   > 0 && <span className="text-gray-500">{bm.fetched}f</span>}
                                  {bm.matched   > 0 && <span className="text-violet-600">{bm.matched}m</span>}
                                  {bm.rewritten > 0 && <span className="text-blue-600">{bm.rewritten}r</span>}
                                  {bm.applied   > 0 && <span className="text-emerald-600">{bm.applied}a</span>}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Activity log */}
                      {detailLoading ? (
                        <div className="flex items-center justify-center py-3"><LogoSpinner size={13} /></div>
                      ) : detailLogs.length > 0 ? (
                        <div className="pt-2 border-t border-gray-100">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-2">History</p>
                          <div className="space-y-2">
                            {detailLogs.map(log => {
                              const logDays = Math.floor((Date.now() - new Date(log.created_at).getTime()) / 86_400_000);
                              const logLabel = logDays === 0 ? 'Today' : logDays === 1 ? '1d ago' : `${logDays}d ago`;
                              return (
                                <div key={log.id} className="flex items-start gap-2">
                                  <div className="w-1 h-1 rounded-full bg-gray-300 mt-1.5 shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[10px] text-gray-600 leading-snug">{log.description}</p>
                                    <p className="text-[9px] text-gray-400 mt-0.5">{logLabel}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        fetched === 0 && applied === 0 && <p className="text-[11px] text-gray-400 italic text-center pt-2">No activity yet</p>
                      )}
                    </div>

                  </div>

                </div>
              </div>
            );
          })()}
        </div>

      </div>

      {/* ── Bench Stage popup ── */}
      {benchStagePopup && (() => {
        const { rect, profileId } = benchStagePopup;
        const profile = profiles.find(p => p.id === profileId);
        const current = (profile?.bench_stage ?? 'New') as string;
        return (
          <div ref={benchStagePopupRef} className="fixed bg-white border border-gray-200 rounded-xl shadow-lg z-[9999] w-44 overflow-hidden"
            style={{ top: rect.bottom + 6, left: rect.left }} onClick={e => e.stopPropagation()}>
            {(['New', 'Assigned', 'Sourcing', 'Submitted', 'Placed', 'Lost'] as const).map(value => {
              const cfg = STAGE_CFG[value];
              return (
                <button key={value} onClick={() => updateBenchStage(profileId, value)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors border-b border-gray-50 last:border-0 ${current === value ? `bg-gray-50 font-semibold ${cfg.text}` : 'text-gray-700 hover:bg-gray-50'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot} shrink-0`} />
                  {value}
                  {current === value && <Check size={10} className="ml-auto text-gray-400" />}
                </button>
              );
            })}
          </div>
        );
      })()}

      {/* ── Assign popup ── */}
      {assignPopup && (() => {
        const currentAssignments = profileAssignments.filter(a => a.profile_id === assignPopup.profileId);
        const assignedUserIds = new Set(currentAssignments.map(a => a.user_id));
        const members = teamMembers.filter(m =>
          m.user_id && (!assignPopup.search || m.invited_email.toLowerCase().includes(assignPopup.search.toLowerCase()))
        );
        const { rect } = assignPopup;
        return (
          <div ref={assignPopupRef} className="fixed bg-white border border-gray-200 rounded-xl shadow-xl z-[9999] w-56 overflow-hidden"
            style={{ top: rect.bottom + 6, left: rect.left }} onClick={e => e.stopPropagation()}>
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input autoFocus type="text" value={assignPopup.search}
                  onChange={e => setAssignPopup(prev => prev ? { ...prev, search: e.target.value } : null)}
                  placeholder="Search team members…"
                  className="w-full pl-6 pr-2 py-1.5 text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 placeholder:text-gray-300" />
              </div>
            </div>
            <div className="max-h-44 overflow-y-auto">
              {assignedUserIds.size > 0 && (!assignPopup.search || 'clear all'.includes(assignPopup.search.toLowerCase())) && (
                <button onClick={() => clearAssignments(assignPopup.profileId)}
                  className="w-full text-left flex items-center gap-2 px-3 py-2 text-[11px] transition-colors border-b border-gray-50 text-gray-500 hover:bg-gray-50">
                  <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center shrink-0"><X size={9} className="text-gray-400" /></div>
                  Clear all assignments
                </button>
              )}
              {members.length === 0 && assignPopup.search && <p className="px-3 py-3 text-[11px] text-gray-400 text-center">No members found</p>}
              {members.map(m => {
                const isAssigned = assignedUserIds.has(m.user_id!);
                return (
                  <button key={m.user_id} onClick={() => toggleAssignment(assignPopup.profileId, m.user_id!)}
                    className={`w-full text-left flex items-center gap-2 px-3 py-2 text-[11px] transition-colors border-b border-gray-50 last:border-0 ${isAssigned ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-blue-50/50'}`}>
                    <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isAssigned ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
                      {isAssigned && <Check size={9} className="text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="truncate">{memberName(m)}</p>
                      <p className="text-[10px] text-gray-400 truncate">{m.invited_email}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Parse Progress Modal ── */}
      {parsing && parseSteps.length > 0 && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-6 pt-6 pb-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                  <Sparkles size={16} className="text-blue-500" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Analyzing Resume</h3>
                  <p className="text-[11px] text-gray-400 mt-0.5">Fill in details below while we extract the profile</p>
                </div>
              </div>
            </div>

            {/* Progress steps */}
            <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-100">
              <div className="flex items-center gap-2 mb-2">
                {parseSteps.map((step, i) => (
                  <div key={step.id} className="flex items-center gap-1.5 flex-1">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 ${step.status === 'done' ? 'bg-emerald-100' : step.status === 'active' ? 'bg-blue-100' : 'bg-gray-100'}`}>
                      {step.status === 'done'   && <CheckCircle2 size={11} className="text-emerald-500" />}
                      {step.status === 'active' && <LogoSpinner size={10} />}
                      {step.status === 'pending' && <span className="w-1 h-1 rounded-full bg-gray-300" />}
                    </div>
                    <span className={`text-[10px] font-medium truncate ${step.status === 'done' ? 'text-emerald-600' : step.status === 'active' ? 'text-gray-900' : 'text-gray-400'}`}>{step.label}</span>
                    {i < parseSteps.length - 1 && <div className="flex-1 h-px bg-gray-200 min-w-2" />}
                  </div>
                ))}
              </div>
              <div className="h-1 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${(parseSteps.filter(s => s.status === 'done').length / parseSteps.length) * 100}%` }} />
              </div>
              {queuedJobId && <p className="text-[10px] text-gray-400 mt-1.5 flex items-center gap-1.5"><Clock size={10} className="shrink-0" />Processing in background — feel free to fill in details</p>}
            </div>

            {/* Pre-fill form */}
            <div className="px-6 py-5 max-h-[50vh] overflow-y-auto">
              <p className="text-[11px] text-gray-500 mb-4 font-medium">Fill in the required fields below and create the profile immediately. Resume details will be filled in automatically once analysis completes.</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <MField label="Full Name" required value={preFill.candidate_name ?? ''} onChange={v => setPreFill(p => ({ ...p, candidate_name: v }))} placeholder="Jane Smith" />
                </div>
                <MField label="Target Role" required value={preFill.target_role ?? ''} onChange={v => setPreFill(p => ({ ...p, target_role: v }))} placeholder="Senior React Developer" />
                <MSelect label="Visa Status" required value={preFill.visa_status ?? ''} onChange={v => setPreFill(p => ({ ...p, visa_status: v }))} options={VISA_OPTIONS} />
                <MSelect label="Work Type" required value={preFill.work_type ?? ''} onChange={v => setPreFill(p => ({ ...p, work_type: v }))} options={WORK_OPTIONS} />
                <MSelect label="Employment Type" required value={preFill.work_authorization ?? ''} onChange={v => setPreFill(p => ({ ...p, work_authorization: v }))} options={WORK_AUTH_OPTIONS} />
                <MField label="Preferred Locations" required value={preFill.preferred_locations ?? ''} onChange={v => setPreFill(p => ({ ...p, preferred_locations: v }))} placeholder="Remote, Austin, NYC" />
                <MField label="Hourly Rate Min ($)" required value={preFill.desired_salary_min ?? ''} onChange={v => setPreFill(p => ({ ...p, desired_salary_min: v }))} type="number" placeholder="45" />
                <MField label="Hourly Rate Max ($)" required value={preFill.desired_salary_max ?? ''} onChange={v => setPreFill(p => ({ ...p, desired_salary_max: v }))} type="number" placeholder="75" />
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Years of Experience<span className="text-red-400 ml-0.5">*</span></label>
                  <input type="number" min={0} max={50} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white" placeholder="5" value={preFill.years_experience ?? ''} onChange={e => setPreFill(p => ({ ...p, years_experience: e.target.value ? Number(e.target.value) : null }))} />
                </div>
                <MSelect label="Open to Relocation" required value={preFill.relocation_status ?? ''} onChange={v => setPreFill(p => ({ ...p, relocation_status: v }))} options={['Yes', 'No']} />
              </div>

              {/* Core Skills - tag input */}
              <div className="mt-4">
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Core Skills<span className="text-red-400 ml-0.5">*</span>
                  <span className="ml-2 text-[10px] font-normal normal-case text-gray-400">(min 3, max 20)</span>
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {preFillSkills.filter(s => s.trim()).map((skill, i) => (
                    <span key={i} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-[11px] font-medium px-2.5 py-1 rounded-lg">
                      {skill}
                      <button type="button" onClick={() => setPreFillSkills(prev => prev.filter((_, idx) => idx !== i))} className="text-blue-400 hover:text-red-500 transition-colors">
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
                {preFillSkills.filter(s => s.trim()).length < 20 && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={preFillSkillInput}
                      onChange={e => setPreFillSkillInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && preFillSkillInput.trim()) {
                          e.preventDefault();
                          if (preFillSkills.filter(s => s.trim()).length < 20) {
                            setPreFillSkills(prev => [...prev.filter(s => s.trim()), preFillSkillInput.trim()]);
                            setPreFillSkillInput('');
                          }
                        }
                      }}
                      placeholder="Type a skill and press Enter"
                      className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => { if (preFillSkillInput.trim() && preFillSkills.filter(s => s.trim()).length < 20) { setPreFillSkills(prev => [...prev.filter(s => s.trim()), preFillSkillInput.trim()]); setPreFillSkillInput(''); } }}
                      className="px-3 py-2 rounded-xl text-xs font-semibold bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                )}
                <p className="text-[10px] text-gray-400 mt-1.5">{preFillSkills.filter(s => s.trim()).length} / 3 minimum{preFillSkills.filter(s => s.trim()).length >= 20 && ' (maximum reached)'}</p>
              </div>
            </div>

            {/* Quick create footer */}
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              <p className="text-[10px] text-gray-400 max-w-[55%]">Profile will be created with the fields above. Remaining details (contact, education, experience) will auto-fill from the resume.</p>
              <button
                onClick={handleQuickCreate}
                disabled={quickCreating || !(preFill.candidate_name ?? '').trim() || !(preFill.target_role ?? '').trim() || !preFill.visa_status || !preFill.work_type || !preFill.work_authorization || !(preFill.preferred_locations ?? '').trim() || !preFill.desired_salary_min || !preFill.desired_salary_max || !preFill.relocation_status || preFill.years_experience == null || preFillSkills.filter(s => s.trim()).length < 3}
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-sm"
              >
                {quickCreating && <LogoSpinner size={12} />}
                {quickCreating ? 'Creating…' : 'Create Profile Now'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Parse Confirm / Add Manually Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
                  {parsed.file_name ? <Sparkles size={14} className="text-blue-500" /> : <UserPlus size={14} className="text-blue-500" />}
                </div>
                <div>
                  <h2 className="font-bold text-sm text-gray-900">{parsed.file_name ? 'Confirm Extracted Profile' : 'Add Candidate Manually'}</h2>
                  <p className="text-[11px] text-gray-400 mt-0.5 truncate max-w-[400px]">{parsed.file_name || 'Fill in the candidate details below'}</p>
                </div>
              </div>
              <button onClick={() => { setShowModal(false); setPendingFile(null); }} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
              {/* ── Job Matching Data Points (always visible) ── */}
              <div className="space-y-3">
                <SectionHeader title="Job Matching Criteria" color="blue" />
                <p className="text-[11px] text-gray-400 -mt-1">These fields are used to match candidates with job opportunities.</p>
                <div className="grid grid-cols-2 gap-3">
                  <MField label="Candidate Name" required value={parsed.candidate_name} onChange={v => setParsed(p => ({ ...p, candidate_name: v }))} placeholder="Jane Smith" />
                  <MField label="Target Role" required value={parsed.target_role}     onChange={v => setParsed(p => ({ ...p, target_role: v }))}     placeholder="Senior React Developer" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Core Skills<span className="text-red-500 ml-0.5">*</span> <span className="text-gray-400 font-normal">(comma-separated)</span></label>
                  <textarea rows={2} value={parsed.core_skills} onChange={e => setParsed(p => ({ ...p, core_skills: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 resize-none"
                    placeholder="React, TypeScript, Node.js, AWS, PostgreSQL…" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Years of Experience<span className="text-red-500 ml-0.5">*</span></label>
                    <input type="number" min="0" max="50" value={parsed.years_experience ?? ''}
                      onChange={e => setParsed(p => ({ ...p, years_experience: e.target.value ? Number(e.target.value) : null }))}
                      placeholder="5" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100" />
                  </div>
                  <MSelect label="Visa Status" required value={parsed.visa_status}   onChange={v => setParsed(p => ({ ...p, visa_status: v }))}   options={VISA_OPTIONS} />
                  <MSelect label="Work Type" required value={parsed.work_type}     onChange={v => setParsed(p => ({ ...p, work_type: v }))}     options={WORK_OPTIONS} />
                  <MField label="Preferred Locations" required value={parsed.preferred_locations} onChange={v => setParsed(p => ({ ...p, preferred_locations: v }))} placeholder="Remote, Austin, NYC" />
                  <MField label="Hourly Rate Min ($)" required value={parsed.desired_salary_min} onChange={v => setParsed(p => ({ ...p, desired_salary_min: v }))} type="number" placeholder="45" />
                  <MField label="Hourly Rate Max ($)" required value={parsed.desired_salary_max} onChange={v => setParsed(p => ({ ...p, desired_salary_max: v }))} type="number" placeholder="75" />
                  <MSelect label="Relocation Status" required value={parsed.relocation_status} onChange={v => setParsed(p => ({ ...p, relocation_status: v }))} options={['Yes', 'No']} />
                </div>
              </div>

              {/* ── Collapsible: Basic Info ── */}
              <CollapsibleSection title="Basic Info" color="gray" defaultOpen={false}>
                <div className="grid grid-cols-2 gap-3">
                  <MField label="Email"  value={parsed.email}  onChange={v => setParsed(p => ({ ...p, email: v }))}  placeholder="jane@example.com" />
                  <MField label="Phone"  value={parsed.phone}  onChange={v => setParsed(p => ({ ...p, phone: v }))}  placeholder="+1 (555) 000-0000" />
                </div>
              </CollapsibleSection>

              {/* ── Collapsible: Location ── */}
              <CollapsibleSection title="Location Details" color="gray" defaultOpen={false}>
                <div className="grid grid-cols-3 gap-3">
                  <MField label="Location (display)" value={parsed.location}  onChange={v => setParsed(p => ({ ...p, location: v }))}  placeholder="Austin, TX" />
                  <MField label="City"               value={parsed.city}      onChange={v => setParsed(p => ({ ...p, city: v }))}      placeholder="Austin" />
                  <MField label="State"              value={parsed.state}     onChange={v => setParsed(p => ({ ...p, state: v }))}     placeholder="TX" />
                  <MField label="Zip Code"           value={parsed.zip_code}  onChange={v => setParsed(p => ({ ...p, zip_code: v }))}  placeholder="78701" />
                  <MField label="Country"            value={parsed.country}   onChange={v => setParsed(p => ({ ...p, country: v }))}   placeholder="USA" />
                </div>
              </CollapsibleSection>

              {/* ── Collapsible: Online Presence ── */}
              <CollapsibleSection title="Online Presence" color="gray" defaultOpen={false}>
                <div className="grid grid-cols-3 gap-3">
                  <MField label="LinkedIn URL"  value={parsed.linkedin_url}  onChange={v => setParsed(p => ({ ...p, linkedin_url: v }))}  placeholder="linkedin.com/in/..." />
                  <MField label="GitHub URL"    value={parsed.github_url}    onChange={v => setParsed(p => ({ ...p, github_url: v }))}    placeholder="github.com/..." />
                  <MField label="Portfolio URL" value={parsed.portfolio_url} onChange={v => setParsed(p => ({ ...p, portfolio_url: v }))} placeholder="yoursite.com" />
                </div>
              </CollapsibleSection>

              {/* ── Collapsible: Education ── */}
              <CollapsibleSection title="Education" color="gray" defaultOpen={false} count={parsed.education.length}
                action={<button onClick={addEdu} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition-colors border border-blue-100"><Plus size={11} /> Add</button>}>
                {parsed.education.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No education entries yet.</p>
                ) : (
                  <div className="space-y-3">
                    {parsed.education.map((edu, i) => (
                      <div key={i} className="border border-gray-100 rounded-xl p-3 bg-gray-50/50 space-y-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Entry {i + 1}</span>
                          <button onClick={() => removeEdu(i)} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                        </div>
                        <div className="grid grid-cols-2 gap-2.5">
                          <MField label="Institution" value={edu.institution} onChange={v => updateEdu(i, 'institution', v)} placeholder="MIT" />
                          <MField label="Degree"      value={edu.degree}      onChange={v => updateEdu(i, 'degree', v)}      placeholder="Bachelor of Science" />
                          <MField label="Field"       value={edu.field ?? ''} onChange={v => updateEdu(i, 'field', v)}       placeholder="Computer Science" />
                          <MField label="GPA"         value={edu.gpa ?? ''}   onChange={v => updateEdu(i, 'gpa', v)}         placeholder="3.8" />
                          <MField label="Start Year"  value={String(edu.start_year ?? '')} onChange={v => updateEdu(i, 'start_year', v)} placeholder="2018" />
                          <MField label="End Year"    value={String(edu.end_year ?? '')}   onChange={v => updateEdu(i, 'end_year', v)}   placeholder="2022" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CollapsibleSection>

              {/* ── Collapsible: Experience ── */}
              <CollapsibleSection title="Experience" color="gray" defaultOpen={false} count={parsed.experience.length}
                action={<button onClick={addExp} className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition-colors border border-blue-100"><Plus size={11} /> Add</button>}>
                {parsed.experience.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No experience entries yet.</p>
                ) : (
                  <div className="space-y-3">
                    {parsed.experience.map((exp, i) => (
                      <div key={i} className="border border-gray-100 rounded-xl p-3 bg-gray-50/50 space-y-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Entry {i + 1}</span>
                          <button onClick={() => removeExp(i)} className="text-gray-300 hover:text-red-500 transition-colors"><Trash2 size={13} /></button>
                        </div>
                        <div className="grid grid-cols-2 gap-2.5">
                          <MField label="Company"  value={exp.company}        onChange={v => updateExp(i, 'company', v)}    placeholder="Acme Corp" />
                          <MField label="Title"    value={exp.title}          onChange={v => updateExp(i, 'title', v)}      placeholder="Senior Engineer" />
                          <MField label="Location" value={exp.location ?? ''} onChange={v => updateExp(i, 'location', v)}  placeholder="Austin, TX" />
                          <MField label="Start Date" value={exp.start_date ?? ''} onChange={v => updateExp(i, 'start_date', v)} placeholder="Jan 2020" />
                          <MField label="End Date"   value={exp.end_date ?? ''}   onChange={v => updateExp(i, 'end_date', v)}   placeholder="Dec 2023" />
                          <div className="flex items-center gap-2 self-end pb-2">
                            <input type="checkbox" id={`current-${i}`} checked={!!exp.current} onChange={e => updateExp(i, 'current', e.target.checked)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-400" />
                            <label htmlFor={`current-${i}`} className="text-xs text-gray-600 cursor-pointer select-none">Currently here</label>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Description</label>
                          <textarea rows={2} value={exp.description ?? ''} onChange={e => updateExp(i, 'description', e.target.value)}
                            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 resize-none"
                            placeholder="Key responsibilities and achievements…" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CollapsibleSection>

              {/* ── Collapsible: Documents ── */}
              <CollapsibleSection title="Documents" color="gray" defaultOpen={false}>
                {pendingFile ? (
                  <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                    <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                    <span className="text-xs text-emerald-700 font-medium flex-1 truncate">{pendingFile.name}</span>
                    <button type="button" onClick={() => setPendingFile(null)} className="text-gray-400 hover:text-red-500 transition-colors"><X size={13} /></button>
                  </div>
                ) : (
                  <label className="flex items-center gap-3 border border-dashed border-gray-200 rounded-xl px-4 py-3 cursor-pointer hover:border-blue-300 hover:bg-blue-50/40 transition-colors">
                    <Upload size={14} className="text-gray-400 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-600 font-medium">Upload Resume / CV</p>
                      <p className="text-[11px] text-gray-400">PDF, Word, RTF, TXT supported</p>
                    </div>
                    <input type="file" accept=".pdf,.doc,.docx,.rtf,.txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setPendingFile(f); }} />
                  </label>
                )}
              </CollapsibleSection>
            </div>
            <div className="px-5 py-3.5 border-t border-gray-100 flex items-center justify-between shrink-0">
              <p className="text-[11px] text-gray-400">Fields marked * are required</p>
              <div className="flex items-center gap-3">
                <button onClick={() => { setShowModal(false); setPendingFile(null); }} className="text-gray-500 hover:text-gray-700 text-sm px-3 py-1.5 transition-colors">Cancel</button>
                <button onClick={handleSave} disabled={saving || !parsed.candidate_name.trim() || !parsed.target_role.trim() || !parsed.core_skills.trim() || parsed.years_experience == null || !parsed.visa_status || !parsed.work_type || !parsed.preferred_locations.trim() || !parsed.desired_salary_min || !parsed.desired_salary_max || !parsed.relocation_status}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold px-5 py-2 rounded-xl flex items-center gap-2 transition-colors">
                  {saving && <LogoSpinner size={12} />}
                  Create Profile
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Onboarding Link Modal ── */}
      {showOnboardingModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center"><Link2 size={14} className="text-emerald-600" /></div>
                <div>
                  <h2 className="font-bold text-sm text-gray-900">Candidate Onboarding Link</h2>
                  <p className="text-[11px] text-gray-400 mt-0.5">Share with candidates to let them submit their own profile</p>
                </div>
              </div>
              <button onClick={() => setShowOnboardingModal(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <div className="px-5 py-5 space-y-4">
              <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-3 flex items-center gap-2">
                <span className="flex-1 text-xs text-gray-700 truncate font-mono">{onboardingUrl}</span>
                <button onClick={copyOnboardingUrl}
                  className={`shrink-0 flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${copied ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}>
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 space-y-1.5">
                <p className="text-[11px] font-semibold text-blue-700">How it works:</p>
                <ul className="space-y-1">
                  {['Share this link with your candidate via email or WhatsApp', 'They fill in their own profile details and upload documents', 'Their profile appears in your Bench automatically', 'Link is active for 90 days — regenerate anytime'].map(item => (
                    <li key={item} className="flex items-start gap-1.5 text-[11px] text-blue-600">
                      <CheckCircle2 size={10} className="shrink-0 mt-0.5 text-blue-500" /> {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="px-5 pb-4 flex justify-end">
              <button onClick={() => setShowOnboardingModal(false)} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 transition-colors">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Profile Modal ── */}
      {showEditModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center"><Edit2 size={14} className="text-gray-600" /></div>
                <h2 className="font-bold text-sm text-gray-900">Edit Profile</h2>
              </div>
              <button onClick={() => setShowEditModal(false)} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <MField label="Candidate Name *" value={editDraft.candidate_name ?? ''} onChange={v => setEditDraft(d => ({ ...d, candidate_name: v }))} placeholder="Jane Smith" />
                <MField label="Target Role *"     value={editDraft.target_role ?? ''}    onChange={v => setEditDraft(d => ({ ...d, target_role: v }))}    placeholder="Senior React Developer" />
                <MField label="Email"             value={editDraft.email ?? ''}           onChange={v => setEditDraft(d => ({ ...d, email: v }))}           placeholder="jane@example.com" />
                <MField label="Phone"             value={editDraft.phone ?? ''}           onChange={v => setEditDraft(d => ({ ...d, phone: v }))}           placeholder="+1 (555) 000-0000" />
                <MField label="Location"          value={editDraft.location ?? ''}        onChange={v => setEditDraft(d => ({ ...d, location: v }))}        placeholder="Austin, TX" />
                <MField label="City"              value={editDraft.city ?? ''}            onChange={v => setEditDraft(d => ({ ...d, city: v }))}            placeholder="Austin" />
                <MField label="State"             value={editDraft.state ?? ''}           onChange={v => setEditDraft(d => ({ ...d, state: v }))}           placeholder="TX" />
                <MField label="Country"           value={editDraft.country ?? ''}         onChange={v => setEditDraft(d => ({ ...d, country: v }))}         placeholder="USA" />
                <MField label="LinkedIn URL"      value={editDraft.linkedin_url ?? ''}    onChange={v => setEditDraft(d => ({ ...d, linkedin_url: v }))}    placeholder="linkedin.com/in/..." />
                <MField label="GitHub URL"        value={editDraft.github_url ?? ''}      onChange={v => setEditDraft(d => ({ ...d, github_url: v }))}      placeholder="github.com/..." />
                <MField label="Portfolio URL"     value={editDraft.portfolio_url ?? ''}   onChange={v => setEditDraft(d => ({ ...d, portfolio_url: v }))}   placeholder="yoursite.com" />
                <MSelect label="Visa Status"   value={editDraft.visa_status ?? ''}    onChange={v => setEditDraft(d => ({ ...d, visa_status: v }))}    options={VISA_OPTIONS} />
                <MSelect label="Work Type"     value={editDraft.work_type ?? ''}      onChange={v => setEditDraft(d => ({ ...d, work_type: v }))}      options={WORK_OPTIONS} />
                <MSelect label="Employment Type" value={editDraft.work_authorization ?? ''} onChange={v => setEditDraft(d => ({ ...d, work_authorization: v }))} options={WORK_AUTH_OPTIONS} />
                <MField label="Preferred Locations" value={editDraft.preferred_locations ?? ''} onChange={v => setEditDraft(d => ({ ...d, preferred_locations: v }))} placeholder="Remote, Austin, NYC" />
                <MField label="Hourly Rate Min ($)" value={editDraft.desired_salary_min ?? ''} onChange={v => setEditDraft(d => ({ ...d, desired_salary_min: v }))} type="number" placeholder="45" />
                <MField label="Hourly Rate Max ($)" value={editDraft.desired_salary_max ?? ''} onChange={v => setEditDraft(d => ({ ...d, desired_salary_max: v }))} type="number" placeholder="75" />
                <MSelect label="Relocation Status" value={(editDraft as Record<string, unknown>).relocation_status as string ?? ''} onChange={v => setEditDraft(d => ({ ...d, relocation_status: v }))} options={['Yes', 'No']} />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Core Skills <span className="text-gray-400 font-normal">(comma-separated)</span></label>
                <textarea rows={2} value={editDraft.core_skills ?? ''} onChange={e => setEditDraft(d => ({ ...d, core_skills: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 resize-none"
                  placeholder="React, TypeScript, Node.js…" />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-gray-200 shrink-0 flex items-center justify-end gap-3">
              <button onClick={() => setShowEditModal(false)} className="text-sm font-semibold text-gray-600 hover:text-gray-800 px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors">Cancel</button>
              <button onClick={saveEditProfile} disabled={editSaving || !editDraft.candidate_name?.trim()}
                className="flex items-center gap-1.5 text-sm font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-5 py-2 rounded-xl transition-colors shadow-sm">
                {editSaving ? <><LogoSpinner size={12} /> Saving…</> : <><Check size={12} /> Save Changes</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Paste Text Modal ── */}
      {showPasteModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
                  <ClipboardPaste size={14} className="text-blue-600" />
                </div>
                <div>
                  <h2 className="font-bold text-sm text-gray-900">Paste Resume Text</h2>
                  <p className="text-[11px] text-gray-400 mt-0.5">Paste candidate resume content and AI will parse it</p>
                </div>
              </div>
              <button onClick={() => { setShowPasteModal(false); setPasteText(''); }} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
            </div>
            <div className="px-5 py-4">
              <textarea
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                placeholder="Paste the full resume text here..."
                className="w-full h-64 text-sm text-gray-700 border border-gray-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 placeholder:text-gray-300"
                autoFocus
              />
              <p className="text-[10px] text-gray-400 mt-2">AI will extract candidate name, skills, experience, and contact details automatically.</p>
            </div>
            <div className="px-5 pb-4 flex items-center justify-end gap-3">
              <button onClick={() => { setShowPasteModal(false); setPasteText(''); }} className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 transition-colors">Cancel</button>
              <button
                onClick={handlePasteSubmit}
                disabled={!pasteText.trim()}
                className="flex items-center gap-1.5 text-sm font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2 rounded-xl transition-colors shadow-sm"
              >
                <Sparkles size={12} /> Parse with AI
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
