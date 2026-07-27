import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Upload, X, FileText, Sparkles, CheckCircle2,
  UserPlus, Link2, Copy, Check, ArrowRight, Star, PenLine,
  Plus, Trash2, Clock, Search, ChevronDown, ChevronRight,
  UserCircle2, MapPin, Mail, Phone, ExternalLink,
  Download, Calendar, Edit2, Target, ClipboardPaste, Cpu, Users,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { supabase } from '../lib/supabase';
import { throttledAll } from '../lib/query-throttle';
import { triggerProfileEmbedding } from '../lib/embeddings';
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

function memberName(m: TeamMember): string {
  return m.display_name?.trim() || m.invited_email.split('@')[0];
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
  title: string; color?: string; defaultOpen?: boolean; count?: number; action?: React.ReactNode; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50/60 hover:bg-gray-100/60 transition-colors text-left"
      >
        <ChevronDown size={14} className={`text-gray-400 transition-transform duration-200 shrink-0 ${open ? '' : '-rotate-90'}`} />
        <SectionHeader title={title} color={color} />
        {count != null && count > 0 && (
          <span className="text-[10px] font-bold text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded-full">{count}</span>
        )}
        <span className="flex-1" />
        {action && <span onClick={e => e.stopPropagation()}>{action}</span>}
      </button>
      {open && <div className="px-4 py-4 border-t border-gray-100">{children}</div>}
    </div>
  );
}

const BLANK_EDU: EducationEntry = { institution: '', degree: '', field: '', start_year: '', end_year: '', gpa: '' };
const BLANK_EXP: ExperienceEntry = { company: '', title: '', location: '', start_date: '', end_date: '', current: false, description: '' };

export default function ProfilesDirectory() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { account } = useAuth();
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
  const [filterOpen, setFilterOpen]     = useState(false);
  const statusDropdownRef  = useRef<HTMLDivElement>(null);
  const assignDropdownRef  = useRef<HTMLDivElement>(null);

  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [profileAssignments, setProfileAssignments] = useState<ProfileAssignment[]>([]);

  const [assignPopup, setAssignPopup]   = useState<{ profileId: string; search: string; rect: DOMRect } | null>(null);
  const assignPopupRef = useRef<HTMLDivElement>(null);
  const [benchStagePopup, setBenchStagePopup] = useState<{ profileId: string; rect: DOMRect } | null>(null);
  const benchStagePopupRef = useRef<HTMLDivElement>(null);

  const [benchStageFilter, setBenchStageFilter] = useState<BenchStage | null>(null);
  const [submissions, setSubmissions] = useState<{candidate_name: string; client_name: string; vendor_name: string}[]>([]);

  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [detailFiles, setDetailFiles]     = useState<ResumeFile[]>([]);
  const [detailLogs, setDetailLogs]       = useState<ActivityLog[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // Date range filter
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');

  // Priority skills inline edit
  const [editingPrioritySkills, setEditingPrioritySkills] = useState(false);
  const [prioritySkillsItems, setPrioritySkillsItems]     = useState<string[]>([]);
  const [newSkillInput, setNewSkillInput]                 = useState('');
  const [aiGeneratingSkills, setAiGeneratingSkills]       = useState(false);
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

  // Hotlist
  const [hotlistIds, setHotlistIds] = useState<Set<string>>(new Set());
  const [hotlistAdding, setHotlistAdding] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('hotlist').select('profile_id').then(({ data }) => {
      if (data) setHotlistIds(new Set(data.map(r => r.profile_id)));
    });
  }, []);

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
    if (!filterOpen) return;
    function handle(e: MouseEvent) {
      if (assignDropdownRef.current && !assignDropdownRef.current.contains(e.target as Node)) setFilterOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [filterOpen]);

  useEffect(() => {
    if (!benchStagePopup) return;
    function handle(e: MouseEvent) {
      if (benchStagePopupRef.current && !benchStagePopupRef.current.contains(e.target as Node)) setBenchStagePopup(null);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [benchStagePopup]);

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

  async function uploadDocForProfile(file: File) {
    if (!selectedProfileId) return;
    const storagePath = `${selectedProfileId}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from('resumes').upload(storagePath, file, { contentType: file.type || 'application/octet-stream' });
    if (error) { showToast('Upload failed', 'error'); return; }
    const { data: urlData } = supabase.storage.from('resumes').getPublicUrl(storagePath);
    const { data: rec } = await supabase.from('resume_files').insert({ profile_id: selectedProfileId, file_name: file.name, file_url: urlData.publicUrl, category: 'resume' }).select().single();
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

      const { error } = await supabase.from('profiles').insert(inserts);
      if (error) {
        showToast(`Batch ${Math.floor(i / batchSize) + 1} failed: ${error.message}`, 'error');
      } else {
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

  const searchFilteredStats = profileStats.filter(({ profile: p }) => {
    const q = search.toLowerCase().trim();
    if (q) {
      const matchesCandidate = p.candidate_name.toLowerCase().includes(q)
        || (p.target_role ?? '').toLowerCase().includes(q)
        || (p.phone ?? '').toLowerCase().includes(q)
        || (p.email ?? '').toLowerCase().includes(q);
      const profileUserIds = profileAssignments.filter(a => a.profile_id === p.id).map(a => a.user_id);
      const assignedMems = teamMembers.filter(m => m.user_id && profileUserIds.includes(m.user_id));
      const matchesAssignee = assignedMems.some(m => memberName(m).toLowerCase().includes(q) || m.invited_email.toLowerCase().includes(q));
      const matchesSubmission = submissions
        .filter(s => s.client_name.toLowerCase().includes(q) || s.vendor_name.toLowerCase().includes(q))
        .some(s => s.candidate_name.toLowerCase() === p.candidate_name.toLowerCase());
      if (!matchesCandidate && !matchesAssignee && !matchesSubmission) return false;
    }
    const profileUserIds = profileAssignments.filter(a => a.profile_id === p.id).map(a => a.user_id);
    const matchesAssigned = !assignedFilter
      || (assignedFilter === '__unassigned__' ? profileUserIds.length === 0 : profileUserIds.includes(assignedFilter));
    // Date range filter
    if (dateFrom) {
      const created = new Date(p.created_at);
      if (created < new Date(dateFrom)) return false;
    }
    if (dateTo) {
      const created = new Date(p.created_at);
      const toEnd = new Date(dateTo);
      toEnd.setDate(toEnd.getDate() + 1);
      if (created >= toEnd) return false;
    }
    return matchesAssigned;
  });

  const filteredStats = benchStageFilter
    ? searchFilteredStats.filter(s => (s.profile.bench_stage ?? 'New') === benchStageFilter)
    : searchFilteredStats;

  const handleSearchChange = (v: string) => setSearch(v);
  const handleAssignedFilter = (v: string) => { setAssignedFilter(v); setFilterOpen(false); };

  const assignedLabel = !assignedFilter ? 'All'
    : assignedFilter === '__unassigned__' ? 'Unassigned'
    : teamMembers.find(m => m.user_id === assignedFilter) ? memberName(teamMembers.find(m => m.user_id === assignedFilter)!) : 'User';

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
        {/* Date range filter — top right */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <Calendar size={13} className="text-gray-400 shrink-0" />
          <input
            type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400 bg-white text-gray-700 cursor-pointer shadow-sm"
          />
          <span className="text-xs text-gray-400">—</span>
          <input
            type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-400 bg-white text-gray-700 cursor-pointer shadow-sm"
          />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }}
              className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-lg transition-colors">
              <X size={9} /> Clear
            </button>
          )}
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

          {/* Pipeline stage cards (3×2) */}
          <div className="p-2.5 border-b border-gray-200 grid grid-cols-3 gap-1.5 shrink-0">
            {(['New', 'Assigned', 'Sourcing', 'Submitted', 'Placed', 'Lost'] as const).map(stage => {
              const count = searchFilteredStats.filter(s => (s.profile.bench_stage ?? 'New') === stage).length;
              const isActive = benchStageFilter === stage;
              const cfg = STAGE_CFG[stage];
              return (
                <button key={stage} onClick={() => setBenchStageFilter(f => f === stage ? null : stage)}
                  className={`flex items-center justify-between px-2.5 py-2 rounded-xl border transition-all text-left ${isActive ? cfg.activeCls : `${cfg.bg} ${cfg.border} hover:shadow-sm`}`}>
                  <div>
                    <p className={`text-lg font-black tabular-nums leading-none ${isActive ? 'text-white' : cfg.text}`}>{count}</p>
                    <p className={`text-[8px] font-bold uppercase tracking-wide mt-0.5 ${isActive ? 'text-white/70' : 'text-gray-400'}`}>{stage}</p>
                  </div>
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-white/40' : cfg.dot}`} />
                </button>
              );
            })}
          </div>

          {/* Filters row */}
          <div className="px-2.5 py-2 border-b border-gray-200 flex items-center gap-2 shrink-0">
            {/* Assignee filter */}
            <div className="relative flex-1" ref={assignDropdownRef}>
              <button onClick={() => setFilterOpen(o => !o)}
                className={`w-full flex items-center justify-between gap-1 text-[11px] font-semibold border rounded-lg px-2 py-1.5 transition-colors ${assignedFilter ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                <span className="truncate">{assignedLabel}</span>
                <ChevronDown size={10} className={`shrink-0 transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
              </button>
              {filterOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 min-w-[160px] overflow-hidden">
                  {[{ value: '', label: 'All Assignees' }, { value: '__unassigned__', label: 'Unassigned' },
                    ...teamMembers.filter(m => m.user_id).map(m => ({ value: m.user_id!, label: memberName(m) }))
                  ].map(opt => (
                    <button key={opt.value} onClick={() => handleAssignedFilter(opt.value)}
                      className={`w-full text-left px-3 py-2 text-xs border-b border-gray-50 last:border-0 transition-colors ${assignedFilter === opt.value ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Candidate count */}
          <div className="px-3 py-1.5 shrink-0 flex items-center justify-between border-b border-gray-50">
            <span className="text-[10px] text-gray-400 font-medium">{filteredStats.length} candidate{filteredStats.length !== 1 ? 's' : ''}</span>
            {benchStageFilter && (
              <button onClick={() => setBenchStageFilter(null)}
                className="flex items-center gap-0.5 text-[10px] font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 px-1.5 py-0.5 rounded-full transition-colors">
                {benchStageFilter} <X size={8} />
              </button>
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
            ) : filteredStats.map(({ profile: p, applied, saved }) => {
              const isSelected = selectedProfileId === p.id;
              const stage = (p.bench_stage ?? 'New') as BenchStage;
              const cfg = STAGE_CFG[stage];
              return (
                <button key={p.id} onClick={() => setSelectedProfileId(isSelected ? null : p.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-all ${isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50/70'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm font-semibold truncate flex-1 ${isSelected ? 'text-blue-700' : 'text-gray-800'}`}>{p.candidate_name}</p>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={e => { e.stopPropagation(); navigate(`/job-finder?profileId=${p.id}`); }}
                        title="Find Jobs"
                        className="p-1 rounded hover:bg-blue-100 transition-colors group/si"
                      >
                        <Search size={10} className="text-gray-300 group-hover/si:text-blue-500 transition-colors" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); navigate(`/resume-ai?profileId=${p.id}`); }}
                        title="Resume AI"
                        className="p-1 rounded hover:bg-blue-100 transition-colors group/ri"
                      >
                        <Sparkles size={10} className="text-gray-300 group-hover/ri:text-blue-500 transition-colors" />
                      </button>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border shrink-0 ${cfg.bg} ${cfg.border} ${cfg.text}`}>{stage}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-500 truncate mt-0.5">{p.target_role}</p>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-[10px] text-gray-400">{applied} applied · {saved} saved</span>
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
                        <Users size={18} className="text-blue-600" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900">Bulk Import Profiles</p>
                        <p className="text-[11px] text-gray-500 mt-0.5">Paste Google Sheet or Excel rows to upload multiple candidates in one go.</p>
                      </div>
                    </div>
                  </div>

                  {bulkStep === 'paste' && (
                    <div className="px-6 py-5">
                      <label className="block text-xs font-bold text-gray-700 mb-2">Create in bulk by copy-pasting your bench data here</label>
                      <p className="text-[11px] text-gray-400 mb-3">Copy header row + data rows from Google Sheets or Excel and paste below. We auto-map Name, Role, Skills, Visa, Rate and more.</p>
                      <textarea
                        value={bulkPasteText}
                        onChange={e => setBulkPasteText(e.target.value)}
                        placeholder={"Name\tRole\tSkills\tVisa\tWork Type\tRate\tLocation\n" + "John Doe\tJava Developer\tJava, Spring Boot, AWS\tH1B\tRemote\t65\tNew York, NY\n" + "Jane Smith\tReact Developer\tReact, TypeScript, Node\tGC\tHybrid\t70\tAustin, TX"}
                        className="w-full h-56 text-[11px] font-mono text-gray-700 border border-gray-200 rounded-xl px-4 py-3 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-400 placeholder:text-gray-300"
                      />
                      <p className="text-[10px] text-gray-400 mt-2">Supports tab-separated data (default when copied from spreadsheets).</p>
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
            const daysAgo = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86_400_000);
            const sinceLabel = daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1d ago' : `${daysAgo}d ago`;
            const activeBoards = BOARDS.filter(b => { const m = perBoard[b.key]; return m && (m.fetched + m.matched + m.applied + m.rewritten) > 0; });

            return (
              <div className="flex-1 flex flex-col overflow-hidden">

                {/* ── Shared candidate header ── */}
                <div className="bg-white border-b border-gray-200 px-5 py-3 shrink-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                        <span className="text-sm font-black text-blue-600">{p.candidate_name[0]?.toUpperCase()}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <h2 className="text-sm font-bold text-gray-900 truncate">{p.candidate_name}</h2>
                        <p className="text-xs text-gray-500 truncate">{p.target_role}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (hotlistIds.has(p.id)) return;
                          setHotlistAdding(p.id);
                          const { error } = await supabase.from('hotlist').insert({ profile_id: p.id });
                          if (!error) {
                            setHotlistIds(prev => new Set([...prev, p.id]));
                            showToast(`${p.candidate_name} added to hotlist`);
                          } else if (error.code === '23505') {
                            setHotlistIds(prev => new Set([...prev, p.id]));
                          } else {
                            showToast('Failed to add to hotlist', 'error');
                          }
                          setHotlistAdding(null);
                        }}
                        disabled={hotlistIds.has(p.id) || hotlistAdding === p.id}
                        className={`flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors border shrink-0 ${
                          hotlistIds.has(p.id)
                            ? 'bg-amber-50 text-amber-600 border-amber-200 cursor-default'
                            : 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500'
                        }`}
                      >
                        <Target size={10} className="shrink-0" />
                        {hotlistIds.has(p.id) ? 'On Hotlist' : hotlistAdding === p.id ? 'Adding...' : '+ Hotlist'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/job-match-ai?profileId=${p.id}`); }}
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
                        onClick={e => { e.stopPropagation(); const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect(); setBenchStagePopup(benchStagePopup?.profileId === p.id ? null : { profileId: p.id, rect }); }}
                        className={`flex items-center gap-1.5 text-[11px] font-semibold border rounded-full pl-2 pr-2.5 py-0.5 transition-colors cursor-pointer ${stageCfg.bg} ${stageCfg.border} ${stageCfg.text}`}>
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${stageCfg.dot}`} />{benchStage}<ChevronDown size={9} className="shrink-0" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect(); setAssignPopup(assignPopup?.profileId === p.id ? null : { profileId: p.id, search: '', rect }); }}
                        className={`flex items-center gap-1.5 text-[11px] font-medium border rounded-lg px-2 py-0.5 transition-colors ${assignedMembers.length > 0 ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' : 'bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100'}`}>
                        <UserCircle2 size={11} className="shrink-0" />
                        <span className="truncate max-w-[80px]">{assignedMembers.length > 0 ? assignedMembers.map(m => memberName(m)).join(', ') : 'Unassigned'}</span>
                        <ChevronDown size={9} className="shrink-0" />
                      </button>
                      <span className="text-[10px] text-gray-400 flex items-center gap-0.5 shrink-0"><Clock size={9} />{sinceLabel}</span>
                      <button onClick={() => { setEditDraft({ candidate_name: p.candidate_name, target_role: p.target_role, email: p.email, phone: p.phone, location: p.location, city: p.city, state: p.state, country: p.country, linkedin_url: p.linkedin_url, github_url: p.github_url, portfolio_url: p.portfolio_url, core_skills: p.core_skills, visa_status: p.visa_status, work_type: p.work_type, notice_period: p.notice_period, years_experience: p.years_experience, availability: p.availability, desired_salary_min: p.desired_salary_min, desired_salary_max: p.desired_salary_max, preferred_locations: p.preferred_locations }); setShowEditModal(true); }}
                        className="flex items-center gap-1 text-[11px] font-semibold text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 px-2.5 py-1 rounded-lg transition-colors border border-gray-200 shrink-0">
                        <Edit2 size={10} /> Edit
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── 4 Sub-columns ── */}
                <div className="flex-1 flex overflow-hidden">

                  {/* Sub-col 1: Profile */}
                  <div className="flex-1 flex flex-col border-r border-gray-200 overflow-hidden min-w-0">
                    <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 shrink-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Profile</p>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-3">

                      {/* ── Priority Skills — always at top ── */}
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <Star size={10} className="text-amber-500 fill-amber-400 shrink-0" />
                            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Priority Skills</p>
                            {(p.priority_skills ? p.priority_skills.split(',').filter(s => s.trim()) : []).length > 0 && (
                              <span className="text-[9px] font-bold text-amber-600 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full">
                                {p.priority_skills.split(',').filter(s => s.trim()).length}/10
                              </span>
                            )}
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
                                className="flex items-center gap-0.5 text-[9px] font-semibold text-amber-600 hover:text-amber-800 bg-amber-100 hover:bg-amber-200 px-2 py-1 rounded-lg transition-colors">
                                <Edit2 size={9} /> Edit
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

                      {/* Contact info */}
                      {p.email && <div><p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Email</p><p className="text-xs text-gray-700 font-medium break-all">{p.email}</p></div>}
                      {p.phone && <div><p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Phone</p><p className="text-xs text-gray-700 font-medium">{p.phone}</p></div>}
                      {p.location && <div><p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Location</p><p className="text-xs text-gray-700 font-medium">{p.location}</p></div>}
                      {(p.city || p.state || p.country) && (
                        <div><p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">City / State</p><p className="text-xs text-gray-700 font-medium">{[p.city, p.state, p.country].filter(Boolean).join(', ')}</p></div>
                      )}
                      {p.visa_status && <div><p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Visa Status</p><p className="text-xs text-gray-700 font-medium">{p.visa_status}</p></div>}
                      {(p.linkedin_url || p.github_url || p.portfolio_url) && (
                        <div className="pt-2 border-t border-gray-100 space-y-1.5">
                          {p.linkedin_url && <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 transition-colors truncate"><ExternalLink size={10} className="shrink-0" />LinkedIn</a>}
                          {p.github_url && <a href={p.github_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-800 transition-colors truncate"><ExternalLink size={10} className="shrink-0" />GitHub</a>}
                          {p.portfolio_url && <a href={p.portfolio_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-800 transition-colors truncate"><ExternalLink size={10} className="shrink-0" />Portfolio</a>}
                        </div>
                      )}
                      {p.core_skills && (() => {
                        const allSkills = p.core_skills.split(',').map(s => s.trim()).filter(Boolean);
                        const PREVIEW = 4;
                        const shown = skillsExpanded ? allSkills : allSkills.slice(0, PREVIEW);
                        return (
                          <div className="pt-2 border-t border-gray-100">
                            <button
                              onClick={() => setSkillsExpanded(v => !v)}
                              className="flex items-center justify-between w-full mb-2 group">
                              <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 group-hover:text-gray-600 transition-colors">
                                All Skills <span className="text-gray-300 font-normal">({allSkills.length})</span>
                              </p>
                              <ChevronDown size={10} className={`text-gray-400 transition-transform duration-200 ${skillsExpanded ? 'rotate-180' : ''}`} />
                            </button>
                            <div className="flex flex-wrap gap-1">
                              {shown.map(skill => (
                                <span key={skill} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">{skill}</span>
                              ))}
                              {!skillsExpanded && allSkills.length > PREVIEW && (
                                <button onClick={() => setSkillsExpanded(true)}
                                  className="text-[10px] text-blue-500 hover:text-blue-700 font-semibold px-1">
                                  +{allSkills.length - PREVIEW} more
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                      {!p.email && !p.phone && !p.location && !p.core_skills && !(p.priority_skills) && (
                        <p className="text-[11px] text-gray-400 italic">No profile info</p>
                      )}
                    </div>
                  </div>

                  {/* Sub-col 2: Preferences + Work & Education */}
                  <div className="flex-1 flex flex-col border-r border-gray-200 overflow-hidden min-w-0">
                    <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 shrink-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Preferences & History</p>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-3">
                      {/* Work Preferences */}
                      {(p.work_type || p.notice_period || p.years_experience != null || p.availability || p.desired_salary_min || p.desired_salary_max || p.preferred_locations) && (
                        <div className="space-y-2.5">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-blue-600">Work Preferences</p>
                          {p.work_type && <div><p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Work Type</p><p className="text-xs text-gray-700 font-medium">{p.work_type}</p></div>}
                          {p.notice_period && <div><p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Notice</p><p className="text-xs text-gray-700 font-medium">{p.notice_period}</p></div>}
                          {p.years_experience != null && <div><p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Experience</p><p className="text-xs text-gray-700 font-medium">{p.years_experience} yr{p.years_experience !== 1 ? 's' : ''}</p></div>}
                          {p.availability && <div><p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Availability</p><p className="text-xs text-gray-700 font-medium">{p.availability}</p></div>}
                          {(p.desired_salary_min || p.desired_salary_max) && (
                            <div>
                              <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Hourly Rate</p>
                              <p className="text-xs text-gray-700 font-medium">
                                {p.desired_salary_min ? `${Number(p.desired_salary_min).toLocaleString()}` : ''}
                                {p.desired_salary_min && p.desired_salary_max ? ' – ' : ''}
                                {p.desired_salary_max ? `${Number(p.desired_salary_max).toLocaleString()}/hr` : ''}
                              </p>
                            </div>
                          )}
                          {p.preferred_locations && <div><p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">Preferred Locations</p><p className="text-xs text-gray-700 font-medium">{p.preferred_locations}</p></div>}
                        </div>
                      )}

                      {/* Work Experience */}
                      {Array.isArray(p.experience) && p.experience.length > 0 && (
                        <div className="pt-2 border-t border-gray-100 space-y-2">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-600">Work Experience</p>
                          {p.experience.map((exp: ExperienceEntry, i: number) => {
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
                                      <p className="text-xs font-bold text-gray-800 truncate">{exp.title}</p>
                                      <p className="text-[11px] text-gray-500 truncate">{exp.company}</p>
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
                          })}
                        </div>
                      )}

                      {/* Education */}
                      {Array.isArray(p.education) && p.education.length > 0 && (
                        <div className="pt-2 border-t border-gray-100 space-y-2">
                          <p className="text-[9px] font-bold uppercase tracking-wider text-violet-600">Education</p>
                          {p.education.map((edu: EducationEntry, i: number) => (
                            <div key={i} className="bg-white border border-gray-200 rounded-xl p-2.5 space-y-1">
                              <p className="text-xs font-bold text-gray-800 truncate">{edu.institution}</p>
                              <p className="text-[11px] text-gray-600 truncate">{edu.degree}{edu.field ? ` · ${edu.field}` : ''}</p>
                              <div className="flex items-center gap-2 text-[9px] text-gray-400">
                                {(edu.start_year || edu.end_year) && <span>{edu.start_year}{edu.start_year && edu.end_year ? ' – ' : ''}{edu.end_year}</span>}
                                {edu.gpa && <span>GPA {edu.gpa}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {!p.work_type && !p.notice_period && p.years_experience == null && !p.availability && !p.desired_salary_min && !p.desired_salary_max && !p.preferred_locations && (!Array.isArray(p.experience) || p.experience.length === 0) && (!Array.isArray(p.education) || p.education.length === 0) && (
                        <p className="text-[11px] text-gray-400 italic">No preferences or history added</p>
                      )}
                    </div>
                  </div>

                  {/* Sub-col 3: Documents */}
                  <div className="flex-1 flex flex-col border-r border-gray-200 overflow-hidden min-w-0">
                    <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 shrink-0 flex items-center justify-between">
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
                        <button onClick={() => docUploadRef.current?.click()}
                          title="Upload document"
                          className="flex items-center gap-0.5 text-[9px] font-semibold text-gray-500 hover:text-gray-700 bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-lg transition-colors">
                          <Plus size={9} /> Upload
                        </button>
                        <input ref={docUploadRef} type="file" accept=".pdf,.doc,.docx,.rtf,.txt,.html" className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; if (f) uploadDocForProfile(f); e.target.value = ''; }} />
                      </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3">
                      {detailLoading ? (
                        <div className="flex items-center justify-center py-6"><LogoSpinner size={14} /></div>
                      ) : detailFiles.length === 0 ? (
                        <div className="text-center py-6">
                          <FileText size={18} className="text-gray-200 mx-auto mb-2" />
                          <p className="text-[11px] text-gray-400">No documents yet</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {detailFiles.map(f => {
                            const catColors: Record<string, string> = {
                              resume:    'bg-blue-50 text-blue-700 border-blue-200',
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
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Sub-col 4: Activity */}
                  <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                    <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 shrink-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Activity</p>
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
                <MSelect label="Work Authorization" required value={preFill.work_authorization ?? ''} onChange={v => setPreFill(p => ({ ...p, work_authorization: v }))} options={WORK_AUTH_OPTIONS} />
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
