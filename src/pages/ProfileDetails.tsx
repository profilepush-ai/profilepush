import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Search, Upload, Trash2, FileText, Bookmark,
  Activity, Clock, Download, CheckCircle2, Circle, MapPin, Calendar,
  BarChart2, User, Briefcase, Tag, Phone, Mail, Linkedin, Github,
  Globe, DollarSign, Clock3, Flag, GraduationCap, Building2,
  ExternalLink, XCircle, Trophy, Pencil, X, Check, Plus, ChevronDown, UserCircle2,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { supabase } from '../lib/supabase';
import { throttledAll } from '../lib/query-throttle';
import { useAuth } from '../contexts/AuthContext';
import type { Profile, ResumeFile, WishlistedJob, ActivityLog, EducationEntry, ExperienceEntry, ProfileAssignment } from '../types/database';

type TabId = 'about' | 'jobs' | 'documents' | 'activity';
type JobStatus = 'New' | 'Applied' | 'Rejected' | 'Placed';

const JOB_STATUS_STYLES: Record<JobStatus, string> = {
  New:      'bg-gray-100 text-gray-600',
  Applied:  'bg-blue-100 text-blue-700',
  Rejected: 'bg-red-100 text-red-600',
  Placed:   'bg-emerald-100 text-emerald-700',
};
const JOB_STATUS_CYCLE: Record<JobStatus, JobStatus> = {
  New: 'Applied', Applied: 'Rejected', Rejected: 'Placed', Placed: 'New',
};
const BOARD_COLORS: Record<string, string> = {
  LinkedIn: 'bg-blue-100 text-blue-700', Dice: 'bg-orange-100 text-orange-700',
  Indeed: 'bg-violet-100 text-violet-700', CareerBuilder: 'bg-emerald-100 text-emerald-700',
};
const EVENT_ICONS: Record<string, { icon: typeof Clock; color: string }> = {
  profile_parsed: { icon: FileText, color: 'text-blue-500' },
  job_wishlisted: { icon: Bookmark, color: 'text-emerald-500' },
  job_removed:    { icon: Trash2,   color: 'text-red-400' },
  status_changed: { icon: CheckCircle2, color: 'text-amber-500' },
  resume_updated: { icon: Upload,   color: 'text-violet-500' },
  profile_updated:{ icon: Pencil,   color: 'text-blue-500' },
  default:        { icon: Clock,    color: 'text-gray-400' },
};

const BLANK_EDU: EducationEntry = { institution: '', degree: '', field: '', start_year: '', end_year: '', gpa: '' };
const BLANK_EXP: ExperienceEntry = { company: '', title: '', location: '', start_date: '', end_date: '', current: false, description: '' };

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatDatetime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/* ── Shared display field ── */
function InfoField({ label, value, icon: Icon, link }: {
  label: string; value?: string | number | null; icon: typeof User; link?: boolean;
}) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="flex flex-col gap-0.5 py-2.5 border-b border-gray-50 last:border-0">
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon size={11} className="text-gray-400 shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      </div>
      {empty
        ? <span className="text-xs text-gray-300 italic pl-4">—</span>
        : link
          ? <a href={String(value)} target="_blank" rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline pl-4 truncate flex items-center gap-1">
              {String(value)} <ExternalLink size={9} className="shrink-0" />
            </a>
          : <span className="text-xs text-gray-800 pl-4">{String(value)}</span>
      }
    </div>
  );
}

/* ── Editable field ── */
function EditField({ label, icon: Icon, value, onChange, type = 'text' }: {
  label: string; icon: typeof User; value: string | number | null;
  onChange: (v: string) => void; type?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-2 border-b border-gray-50 last:border-0">
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon size={11} className="text-gray-400 shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      </div>
      <input
        type={type}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className="ml-4 text-xs text-gray-800 bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 w-[calc(100%-1rem)]"
      />
    </div>
  );
}

/* ── Section card ── */
function SectionCard({ title, icon: Icon, color, bg, children, action }: {
  title: string; icon: typeof User; color: string; bg: string;
  children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col overflow-hidden h-full">
      <div className={`flex items-center gap-2 px-4 py-3 border-b border-gray-100 ${bg}`}>
        <div className="w-6 h-6 rounded-lg bg-white/70 flex items-center justify-center shrink-0">
          <Icon size={13} className={color} />
        </div>
        <h3 className={`text-xs font-bold ${color} flex-1`}>{title}</h3>
        {action}
      </div>
      <div className="px-4 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, bg, color, message }: { icon: typeof Bookmark; bg: string; color: string; message: string }) {
  return (
    <div className="py-12 flex flex-col items-center gap-2 text-center">
      <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center`}>
        <Icon size={18} className={color} />
      </div>
      <span className="text-xs text-gray-400">{message}</span>
    </div>
  );
}

function JobCard({ job, onStatusChange, onRemove }: {
  job: WishlistedJob; onStatusChange: (j: WishlistedJob) => void; onRemove: (id: string, title: string) => void;
}) {
  return (
    <div className="rounded-xl bg-white border border-gray-200 px-3 py-2.5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="text-xs font-bold text-gray-800 leading-tight">{job.job_title}</p>
        <button onClick={() => onRemove(job.id, job.job_title)} className="text-gray-200 hover:text-red-400 transition-colors shrink-0 mt-0.5">
          <Trash2 size={11} />
        </button>
      </div>
      <p className="text-[11px] text-gray-500 font-medium mb-2">{job.company}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${BOARD_COLORS[job.board] ?? 'bg-gray-100 text-gray-600'}`}>{job.board}</span>
        {job.location && <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><MapPin size={8} />{job.location}</span>}
      </div>
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
        <span className="text-[10px] text-gray-400">{formatDate(job.created_at)}</span>
        <button
          onClick={() => onStatusChange(job)}
          className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${JOB_STATUS_STYLES[job.status as JobStatus] ?? JOB_STATUS_STYLES.New}`}
          title="Click to advance status"
        >
          {job.status} &rsaquo;
        </button>
      </div>
    </div>
  );
}

/* ── Education entry editor ── */
function EduEntryEdit({ edu, onChange, onRemove }: {
  edu: EducationEntry; onChange: (e: EducationEntry) => void; onRemove: () => void;
}) {
  const f = (key: keyof EducationEntry) => (v: string) => onChange({ ...edu, [key]: v });
  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2.5 flex flex-col gap-1.5">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] font-bold text-violet-600 uppercase tracking-wide">Education Entry</span>
        <button onClick={onRemove} className="text-gray-300 hover:text-red-400 transition-colors"><Trash2 size={11} /></button>
      </div>
      {(['institution','degree','field'] as (keyof EducationEntry)[]).map(k => (
        <input key={k} placeholder={k.charAt(0).toUpperCase() + k.slice(1)} value={edu[k] as string}
          onChange={e => f(k)(e.target.value)}
          className="text-xs text-gray-800 bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-100 w-full" />
      ))}
      <div className="grid grid-cols-3 gap-1.5">
        {(['start_year','end_year','gpa'] as (keyof EducationEntry)[]).map(k => (
          <input key={k} placeholder={k === 'gpa' ? 'GPA' : k === 'start_year' ? 'From' : 'To'}
            value={edu[k] as string} onChange={e => f(k)(e.target.value)}
            className="text-xs text-gray-800 bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-100 w-full" />
        ))}
      </div>
    </div>
  );
}

/* ── Experience entry editor ── */
function ExpEntryEdit({ exp, onChange, onRemove }: {
  exp: ExperienceEntry; onChange: (e: ExperienceEntry) => void; onRemove: () => void;
}) {
  const f = (key: keyof ExperienceEntry) => (v: string | boolean) => onChange({ ...exp, [key]: v });
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/40 px-3 py-2.5 flex flex-col gap-1.5">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wide">Experience Entry</span>
        <button onClick={onRemove} className="text-gray-300 hover:text-red-400 transition-colors"><Trash2 size={11} /></button>
      </div>
      {(['title','company','location'] as (keyof ExperienceEntry)[]).map(k => (
        <input key={k} placeholder={k.charAt(0).toUpperCase() + k.slice(1)} value={exp[k] as string}
          onChange={e => f(k)(e.target.value)}
          className="text-xs text-gray-800 bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-100 w-full" />
      ))}
      <div className="grid grid-cols-2 gap-1.5">
        <input placeholder="Start date" value={exp.start_date} onChange={e => f('start_date')(e.target.value)}
          className="text-xs text-gray-800 bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-400 w-full" />
        <input placeholder="End date" value={exp.end_date} onChange={e => f('end_date')(e.target.value)}
          disabled={exp.current}
          className="text-xs text-gray-800 bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-400 w-full disabled:opacity-40" />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={exp.current} onChange={e => f('current')(e.target.checked)}
          className="rounded text-amber-500 focus:ring-amber-300" />
        <span className="text-[11px] text-gray-600">Currently working here</span>
      </label>
      <textarea placeholder="Description" value={exp.description} onChange={e => f('description')(e.target.value)}
        rows={3}
        className="text-xs text-gray-800 bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-100 w-full resize-none" />
    </div>
  );
}

export default function ProfileDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, membership } = useAuth();
  const isAdmin = membership?.role === 'owner' || membership?.role === 'admin';

  const [profile, setProfile] = useState<Profile | null>(null);
  const [wishlist, setWishlist] = useState<WishlistedJob[]>([]);
  const [resumes, setResumes] = useState<ResumeFile[]>([]);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>('about');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Team members for assign dropdown
  const [teamMembers, setTeamMembers] = useState<Array<{ user_id: string | null; invited_email: string }>>([]);
  const [assignments, setAssignments] = useState<ProfileAssignment[]>([]);
  const [assignOpen, setAssignOpen]   = useState(false);
  const [assignSearch, setAssignSearch] = useState('');
  const assignRef = useRef<HTMLDivElement>(null);

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [saving, setSaving] = useState(false);

  // Download dropdown
  const [downloadOpen, setDownloadOpen] = useState(false);
  const downloadRef = useRef<HTMLDivElement>(null);

  // Status dropdown
  const [statusOpen, setStatusOpen] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);

  // Document upload
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null);
  const docFileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadCategory = useRef<string>('resume');

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  useEffect(() => { if (id) loadAll(); }, [id]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (downloadRef.current && !downloadRef.current.contains(e.target as Node)) {
        setDownloadOpen(false);
      }
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setStatusOpen(false);
      }
      if (assignRef.current && !assignRef.current.contains(e.target as Node)) {
        setAssignOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function loadAll() {
    setLoading(true);
    const [profileRes, wishlistRes, resumesRes, activityRes, membersRes, assignmentsRes] = await throttledAll([
      () => supabase.from('profiles').select('*').eq('id', id!).maybeSingle(),
      () => supabase.from('wishlisted_jobs').select('*').eq('profile_id', id!).order('created_at', { ascending: false }),
      () => supabase.from('resume_files').select('*').eq('profile_id', id!).order('created_at', { ascending: false }),
      () => supabase.from('activity_logs').select('*').eq('profile_id', id!).order('created_at', { ascending: false }).limit(200),
      () => supabase.from('account_members').select('user_id, invited_email').eq('status', 'active'),
      () => supabase.from('profile_assignments').select('*').eq('profile_id', id!),
    ]);
    if (profileRes.error || !profileRes.data) { showToast('Profile not found', 'error'); navigate('/bench'); return; }
    const p = profileRes.data;

    const profileAssignments = (assignmentsRes.data ?? []) as ProfileAssignment[];

    // Members can only view profiles assigned to them
    const currentMembership = membership;
    if (currentMembership?.role === 'member' && !profileAssignments.some(a => a.user_id === user?.id)) {
      navigate('/bench');
      return;
    }

    setProfile(p);
    setAssignments(profileAssignments);
    setWishlist(wishlistRes.data ?? []);
    setResumes(resumesRes.data ?? []);
    setActivity(activityRes.data ?? []);
    setTeamMembers((membersRes.data ?? []) as Array<{ user_id: string | null; invited_email: string }>);
    setLoading(false);
  }

  async function toggleAssignment(userId: string) {
    if (!profile) return;
    const existing = assignments.find(a => a.user_id === userId);
    if (existing) {
      const { error } = await supabase.from('profile_assignments').delete().eq('id', existing.id);
      if (error) { showToast('Failed to remove assignment', 'error'); return; }
      setAssignments(prev => prev.filter(a => a.id !== existing.id));
      showToast('Assignment removed');
    } else {
      const { data, error } = await supabase.from('profile_assignments')
        .insert({ profile_id: profile.id, user_id: userId })
        .select()
        .single();
      if (error) { showToast('Failed to assign', 'error'); return; }
      setAssignments(prev => [...prev, data as ProfileAssignment]);
      showToast('Profile assigned');
    }
  }

  async function clearAllAssignments() {
    if (!profile) return;
    const { error } = await supabase.from('profile_assignments').delete().eq('profile_id', profile.id);
    if (error) { showToast('Failed to clear assignments', 'error'); return; }
    setAssignments([]);
    setAssignOpen(false);
    showToast('All assignments removed');
  }

  function startEdit() {
    if (!profile) return;
    setDraft({ ...profile, education: [...(profile.education as EducationEntry[])], experience: [...(profile.experience as ExperienceEntry[])] });
    setEditMode(true);
    setTab('about');
  }

  function cancelEdit() {
    setDraft(null);
    setEditMode(false);
  }

  async function updateStatus(status: 'Active' | 'Placed' | 'Lost') {
    if (!profile) return;
    const { error } = await supabase.from('profiles').update({ profile_status: status }).eq('id', profile.id);
    if (error) { showToast('Failed to update status', 'error'); return; }
    setProfile(p => p ? { ...p, profile_status: status } : p);
    setStatusOpen(false);
    showToast(`Status updated to ${status}`);
  }

  async function saveEdit() {
    if (!draft) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({
      candidate_name: draft.candidate_name, target_role: draft.target_role,
      location: draft.location, core_skills: draft.core_skills,
      phone: draft.phone, email: draft.email,
      linkedin_url: draft.linkedin_url, github_url: draft.github_url, portfolio_url: draft.portfolio_url,
      city: draft.city, state: draft.state, zip_code: draft.zip_code, country: draft.country,
      desired_salary_min: draft.desired_salary_min || null, desired_salary_max: draft.desired_salary_max || null,
      work_type: draft.work_type, preferred_locations: draft.preferred_locations,
      notice_period: draft.notice_period, visa_status: draft.visa_status,
      years_experience: draft.years_experience || null, availability: draft.availability,
      education: draft.education, experience: draft.experience,
    }).eq('id', id!);
    setSaving(false);
    if (error) { showToast('Failed to save changes', 'error'); return; }
    setProfile(draft);
    setEditMode(false);
    setDraft(null);
    showToast('Profile saved');
    const log = { profile_id: id!, event_type: 'profile_updated', description: 'Profile details updated' };
    await supabase.from('activity_logs').insert(log);
    setActivity(prev => [{ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...log }, ...prev]);
  }

  function setDraftField<K extends keyof Profile>(key: K, value: Profile[K]) {
    setDraft(prev => prev ? { ...prev, [key]: value } : prev);
  }

  function setEdu(idx: number, edu: EducationEntry) {
    if (!draft) return;
    const arr = [...(draft.education as EducationEntry[])];
    arr[idx] = edu;
    setDraftField('education', arr as Profile['education']);
  }
  function addEdu() {
    if (!draft) return;
    setDraftField('education', [...(draft.education as EducationEntry[]), { ...BLANK_EDU }] as Profile['education']);
  }
  function removeEdu(idx: number) {
    if (!draft) return;
    setDraftField('education', (draft.education as EducationEntry[]).filter((_, i) => i !== idx) as Profile['education']);
  }
  function setExp(idx: number, exp: ExperienceEntry) {
    if (!draft) return;
    const arr = [...(draft.experience as ExperienceEntry[])];
    arr[idx] = exp;
    setDraftField('experience', arr as Profile['experience']);
  }
  function addExp() {
    if (!draft) return;
    setDraftField('experience', [...(draft.experience as ExperienceEntry[]), { ...BLANK_EXP }] as Profile['experience']);
  }
  function removeExp(idx: number) {
    if (!draft) return;
    setDraftField('experience', (draft.experience as ExperienceEntry[]).filter((_, i) => i !== idx) as Profile['experience']);
  }

  function triggerDocUpload(category: string) {
    pendingUploadCategory.current = category;
    docFileInputRef.current?.click();
  }

  async function handleDocUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !id) return;
    const category = pendingUploadCategory.current;
    setUploadingCategory(category);
    try {
      const storagePath = `${id}/${category}/${Date.now()}-${file.name}`;
      const { error: uploadErr } = await supabase.storage
        .from('resumes')
        .upload(storagePath, file, { contentType: file.type || 'application/octet-stream' });
      let fileUrl: string | null = null;
      if (!uploadErr) {
        const { data: urlData } = supabase.storage.from('resumes').getPublicUrl(storagePath);
        fileUrl = urlData.publicUrl;
      }
      const { data: inserted, error: insertErr } = await supabase
        .from('resume_files')
        .insert({ profile_id: id, file_name: file.name, file_url: fileUrl, category })
        .select()
        .single();
      if (insertErr || !inserted) { showToast('Upload failed', 'error'); return; }
      setResumes(prev => [inserted, ...prev]);
      const log = { profile_id: id, event_type: 'resume_updated', description: `Uploaded ${file.name} (${category})` };
      await supabase.from('activity_logs').insert(log);
      setActivity(prev => [{ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...log }, ...prev]);
      showToast('File uploaded');
    } finally {
      setUploadingCategory(null);
    }
  }

  async function deleteDocument(doc: ResumeFile) {
    const { error } = await supabase.from('resume_files').delete().eq('id', doc.id);
    if (error) { showToast('Failed to delete', 'error'); return; }
    setResumes(prev => prev.filter(r => r.id !== doc.id));
    showToast('File deleted');
  }

  async function removeFromWishlist(jobId: string, jobTitle: string) {
    const { error } = await supabase.from('wishlisted_jobs').delete().eq('id', jobId);
    if (error) { showToast('Failed to remove job', 'error'); return; }
    setWishlist(prev => prev.filter(j => j.id !== jobId));
    const log = { profile_id: id!, event_type: 'job_removed', description: `Removed "${jobTitle}" from wishlist` };
    await supabase.from('activity_logs').insert(log);
    setActivity(prev => [{ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...log }, ...prev]);
    showToast('Removed from wishlist');
  }

  async function cycleJobStatus(job: WishlistedJob) {
    const newStatus = JOB_STATUS_CYCLE[job.status as JobStatus] ?? 'New';
    const { error } = await supabase.from('wishlisted_jobs').update({ status: newStatus }).eq('id', job.id);
    if (error) { showToast('Failed to update status', 'error'); return; }
    setWishlist(prev => prev.map(j => j.id === job.id ? { ...j, status: newStatus } : j));
    const log = { profile_id: id!, event_type: 'status_changed', description: `"${job.job_title}" at ${job.company} marked as ${newStatus}` };
    await supabase.from('activity_logs').insert(log);
    setActivity(prev => [{ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...log }, ...prev]);
    showToast(`Status → ${newStatus}`);
  }

  if (loading) {
    return (
      <div className="h-screen flex flex-col bg-gray-100">
        <AppNav />
        <div className="flex-1 flex items-center justify-center">
          <LogoSpinner size={20} />
        </div>
      </div>
    );
  }

  if (!profile) return null;

  const displayProfile = editMode && draft ? draft : profile;
  const skills = displayProfile.core_skills.split(',').map(s => s.trim()).filter(Boolean);
  const jobsByStatus: Record<JobStatus, WishlistedJob[]> = {
    New:      wishlist.filter(j => j.status === 'New'),
    Applied:  wishlist.filter(j => j.status === 'Applied'),
    Rejected: wishlist.filter(j => j.status === 'Rejected'),
    Placed:   wishlist.filter(j => j.status === 'Placed'),
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100 font-sans overflow-hidden">
      <AppNav />

      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-5 py-2.5 shrink-0 flex items-center gap-3">
        <Link to="/bench" className="text-gray-400 hover:text-gray-700 transition-colors shrink-0">
          <ArrowLeft size={15} />
        </Link>
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
            <span className="text-sm font-bold text-white leading-none">
              {displayProfile.candidate_name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm font-bold text-gray-900">{displayProfile.candidate_name}</h1>
              <span className="text-xs text-gray-500">{displayProfile.target_role}</span>
              {displayProfile.location && <span className="text-[11px] text-gray-400">&bull; {displayProfile.location}</span>}
              {editMode && <span className="text-[10px] bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">Editing</span>}
            </div>
            {/* Assigned users */}
            {(() => {
              const assignedUserIds = new Set(assignments.map(a => a.user_id));
              const assignedMembers = teamMembers.filter(m => m.user_id && assignedUserIds.has(m.user_id));
              if (isAdmin) {
                const filteredMembers = teamMembers.filter(m =>
                  m.user_id && (!assignSearch || m.invited_email.toLowerCase().includes(assignSearch.toLowerCase()))
                );
                return (
                  <div className="relative mt-0.5" ref={assignRef}>
                    <button
                      onClick={() => { setAssignOpen(o => !o); setAssignSearch(''); }}
                      className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500 hover:text-gray-700 transition-colors group"
                    >
                      <UserCircle2 size={11} className="shrink-0 text-gray-400" />
                      <span>{assignedMembers.length > 0 ? assignedMembers.map(m => m.invited_email.split('@')[0]).join(', ') : 'Unassigned'}</span>
                      <ChevronDown size={9} className="text-gray-300 group-hover:text-gray-500 transition-colors" />
                    </button>
                    {assignOpen && (
                      <div className="absolute left-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-xl z-50 w-56 overflow-hidden">
                        <div className="p-2 border-b border-gray-100">
                          <div className="relative">
                            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                            <input
                              autoFocus
                              type="text"
                              value={assignSearch}
                              onChange={e => setAssignSearch(e.target.value)}
                              placeholder="Search team members…"
                              className="w-full pl-6 pr-2 py-1.5 text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 placeholder:text-gray-300"
                            />
                          </div>
                        </div>
                        <div className="max-h-44 overflow-y-auto">
                          {assignedMembers.length > 0 && (!assignSearch || 'clear all'.includes(assignSearch.toLowerCase())) && (
                            <button
                              onClick={() => clearAllAssignments()}
                              className="w-full text-left flex items-center gap-2 px-3 py-2 text-[11px] transition-colors border-b border-gray-50 text-gray-500 hover:bg-gray-50"
                            >
                              <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                                <X size={9} className="text-gray-400" />
                              </div>
                              Clear all assignments
                            </button>
                          )}
                          {filteredMembers.length === 0 && assignSearch && (
                            <p className="px-3 py-3 text-[11px] text-gray-400 text-center">No members found</p>
                          )}
                          {filteredMembers.map(m => {
                            const isAssigned = assignedUserIds.has(m.user_id!);
                            return (
                              <button
                                key={m.user_id}
                                onClick={() => toggleAssignment(m.user_id!)}
                                className={`w-full text-left flex items-center gap-2 px-3 py-2 text-[11px] transition-colors border-b border-gray-50 last:border-0 ${
                                  isAssigned ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-blue-50/50'
                                }`}
                              >
                                <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                                  isAssigned ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                                }`}>
                                  {isAssigned && <Check size={9} className="text-white" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="truncate">{m.invited_email.split('@')[0]}</p>
                                  <p className="text-[10px] text-gray-400 truncate">{m.invited_email}</p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              }
              return assignedMembers.length > 0 ? (
                <div className="flex items-center gap-1 mt-0.5 text-[11px] text-gray-400">
                  <UserCircle2 size={11} className="shrink-0" />
                  <span>{assignedMembers.map(m => m.invited_email.split('@')[0]).join(', ')}</span>
                </div>
              ) : null;
            })()}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Status dropdown */}
          {!editMode && (() => {
            const currentStatus = (profile?.profile_status as string | undefined) ?? 'Active';
            const statusConfig = {
              Active: { dot: 'bg-emerald-500', pill: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
              Placed: { dot: 'bg-blue-500',    pill: 'bg-blue-50 border-blue-200 text-blue-700' },
              Lost:   { dot: 'bg-red-400',     pill: 'bg-red-50 border-red-200 text-red-600' },
            } as const;
            const cfg = statusConfig[currentStatus as keyof typeof statusConfig] ?? statusConfig.Active;
            return (
              <div className="relative" ref={statusRef}>
                <button
                  onClick={() => setStatusOpen(o => !o)}
                  className={`flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${cfg.pill}`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                  {currentStatus}
                  <ChevronDown size={10} className={`transition-transform ${statusOpen ? 'rotate-180' : ''}`} />
                </button>
                {statusOpen && (
                  <div className="absolute right-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg z-50 w-36 overflow-hidden">
                    {([
                      { value: 'Active' as const, dot: 'bg-emerald-500', text: 'text-emerald-700' },
                      { value: 'Placed' as const, dot: 'bg-blue-500',    text: 'text-blue-700' },
                      { value: 'Lost'   as const, dot: 'bg-red-400',     text: 'text-red-600' },
                    ]).map(({ value, dot, text }) => (
                      <button
                        key={value}
                        onClick={() => updateStatus(value)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors border-b border-gray-50 last:border-0 ${
                          currentStatus === value ? `bg-gray-50 font-semibold ${text}` : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <div className={`w-1.5 h-1.5 rounded-full ${dot} shrink-0`} />
                        {value}
                        {currentStatus === value && <Check size={10} className="ml-auto text-gray-400" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
          {editMode ? (
            <>
              <button onClick={cancelEdit}
                className="flex items-center gap-1.5 border border-gray-200 text-gray-600 hover:bg-gray-50 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                <X size={11} /> Cancel
              </button>
              <button onClick={saveEdit} disabled={saving}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                {saving ? <LogoSpinner size={11} /> : <Check size={11} />}
                Save Changes
              </button>
            </>
          ) : (
            <button onClick={startEdit}
              className="flex items-center gap-1.5 border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-600 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
              <Pencil size={11} /> Edit Profile
            </button>
          )}

          {/* Download dropdown */}
          <div className="relative" ref={downloadRef}>
            <button
              onClick={() => setDownloadOpen(o => !o)}
              className="flex items-center gap-1.5 border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-600 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <Download size={11} /> Download <ChevronDown size={10} className={`transition-transform ${downloadOpen ? 'rotate-180' : ''}`} />
            </button>
            {downloadOpen && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 overflow-hidden">
                <div className="px-3 py-1.5 border-b border-gray-50">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Resumes</span>
                </div>
                {resumes.filter(r => (r.category ?? 'resume') === 'resume').length === 0 ? (
                  <div className="px-3 py-2 text-xs text-gray-400 italic">No resume files</div>
                ) : (
                  resumes.filter(r => (r.category ?? 'resume') === 'resume').map(r => (
                    <button key={r.id}
                      onClick={() => {
                        setDownloadOpen(false);
                        if (r.file_url) {
                          const a = document.createElement('a');
                          a.href = r.file_url; a.download = r.file_name; a.click();
                        } else {
                          showToast('File URL not available — upload to storage to enable downloads.');
                        }
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
                    >
                      <FileText size={12} className="text-blue-400 shrink-0" />
                      <span className="text-xs text-gray-700 truncate">{r.file_name}</span>
                    </button>
                  ))
                )}
                <div className="px-3 py-1.5 border-t border-b border-gray-50 mt-0.5">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Documents</span>
                </div>
                <button
                  onClick={() => { setDownloadOpen(false); showToast('Export to PDF coming soon.'); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
                >
                  <User size={12} className="text-emerald-400 shrink-0" />
                  <span className="text-xs text-gray-700">Profile Summary (PDF)</span>
                </button>
                <button
                  onClick={() => { setDownloadOpen(false); showToast('Export to PDF coming soon.'); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
                >
                  <GraduationCap size={12} className="text-violet-400 shrink-0" />
                  <span className="text-xs text-gray-700">Education Record</span>
                </button>
                <button
                  onClick={() => { setDownloadOpen(false); showToast('Export to PDF coming soon.'); }}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
                >
                  <Building2 size={12} className="text-amber-400 shrink-0" />
                  <span className="text-xs text-gray-700">Work History</span>
                </button>
              </div>
            )}
          </div>

          <button
            onClick={() => navigate(`/job-finder?profileId=${profile.id}&role=${encodeURIComponent(profile.target_role)}`)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            <Search size={11} /> Find Jobs
          </button>
        </div>
      </div>

      {/* Tab cards */}
      <div className="bg-white border-b border-gray-200 px-5 py-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTab('about')}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all hover:shadow-sm shrink-0 ${
              tab === 'about' ? 'border-blue-300 bg-blue-50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
              <User size={12} className="text-blue-600" />
            </div>
            <span className={`text-xs font-semibold whitespace-nowrap ${tab === 'about' ? 'text-blue-700' : 'text-gray-600'}`}>
              About Profile
            </span>
          </button>

          <div className="w-px h-8 bg-gray-100 shrink-0" />

          {([
            { label: 'Jobs',       value: wishlist.length,  icon: Bookmark,  color: 'text-blue-600',  bg: 'bg-blue-50',  activeRing: 'border-blue-300 bg-blue-50',   tabId: 'jobs'      as TabId },
            { label: 'Documents',  value: resumes.length,   icon: FileText,  color: 'text-violet-600',bg: 'bg-violet-50',activeRing: 'border-violet-300 bg-violet-50',tabId: 'documents' as TabId },
            { label: 'Activities', value: activity.length,  icon: BarChart2, color: 'text-amber-600', bg: 'bg-amber-50', activeRing: 'border-amber-300 bg-amber-50',  tabId: 'activity'  as TabId },
          ] as const).map((s, i) => (
            <button
              key={i}
              onClick={() => { if (!editMode) setTab(s.tabId); }}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all hover:shadow-sm ${
                editMode ? 'opacity-40 cursor-not-allowed' : ''
              } ${tab === s.tabId && !editMode ? `${s.activeRing} shadow-sm` : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'}`}
            >
              <div className={`w-7 h-7 rounded-lg ${s.bg} flex items-center justify-center shrink-0`}>
                <s.icon size={12} className={s.color} />
              </div>
              <span className="text-base font-bold text-gray-900 leading-none">{s.value}</span>
              <span className="text-[11px] text-gray-400 whitespace-nowrap">{s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">

        {/* ── ABOUT PROFILE ── */}
        {tab === 'about' && (
          <div className="p-4 h-full">
            <div className="grid grid-cols-4 gap-3 h-full" style={{ minHeight: 0 }}>

              {/* Col 1 — Contact Details */}
              <SectionCard title="Contact Details" icon={User} color="text-blue-700" bg="bg-blue-50">
                {editMode && draft ? (
                  <>
                    <EditField label="Full Name"    icon={User}     value={draft.candidate_name} onChange={v => setDraftField('candidate_name', v)} />
                    <EditField label="Email"        icon={Mail}     value={draft.email}           onChange={v => setDraftField('email', v)}           type="email" />
                    <EditField label="Phone"        icon={Phone}    value={draft.phone}           onChange={v => setDraftField('phone', v)}           type="tel" />
                    <EditField label="LinkedIn URL" icon={Linkedin} value={draft.linkedin_url}    onChange={v => setDraftField('linkedin_url', v)}    type="url" />
                    <EditField label="GitHub URL"   icon={Github}   value={draft.github_url}      onChange={v => setDraftField('github_url', v)}      type="url" />
                    <EditField label="Portfolio URL"icon={Globe}    value={draft.portfolio_url}   onChange={v => setDraftField('portfolio_url', v)}   type="url" />
                    <EditField label="City"         icon={MapPin}   value={draft.city}            onChange={v => setDraftField('city', v)} />
                    <EditField label="State"        icon={MapPin}   value={draft.state}           onChange={v => setDraftField('state', v)} />
                    <EditField label="Zip Code"     icon={MapPin}   value={draft.zip_code}        onChange={v => setDraftField('zip_code', v)} />
                    <EditField label="Country"      icon={Flag}     value={draft.country}         onChange={v => setDraftField('country', v)} />
                    <EditField label="Location"     icon={MapPin}   value={draft.location}        onChange={v => setDraftField('location', v)} />
                  </>
                ) : (
                  <>
                    <InfoField label="Full Name"  icon={User}     value={displayProfile.candidate_name} />
                    <InfoField label="Email"      icon={Mail}     value={displayProfile.email} />
                    <InfoField label="Phone"      icon={Phone}    value={displayProfile.phone} />
                    <InfoField label="LinkedIn"   icon={Linkedin} value={displayProfile.linkedin_url}   link />
                    <InfoField label="GitHub"     icon={Github}   value={displayProfile.github_url}     link />
                    <InfoField label="Portfolio"  icon={Globe}    value={displayProfile.portfolio_url}  link />
                    <InfoField label="City"       icon={MapPin}   value={displayProfile.city} />
                    <InfoField label="State"      icon={MapPin}   value={displayProfile.state} />
                    <InfoField label="Zip Code"   icon={MapPin}   value={displayProfile.zip_code} />
                    <InfoField label="Country"    icon={Flag}     value={displayProfile.country} />
                    <InfoField label="Date Added" icon={Calendar} value={formatDate(displayProfile.created_at)} />
                  </>
                )}
              </SectionCard>

              {/* Col 2 — Job Preferences */}
              <SectionCard title="Job Preferences" icon={Briefcase} color="text-emerald-700" bg="bg-emerald-50">
                {editMode && draft ? (
                  <>
                    <EditField label="Target Role"         icon={Briefcase} value={draft.target_role}         onChange={v => setDraftField('target_role', v)} />
                    <EditField label="Work Type"           icon={Building2} value={draft.work_type}           onChange={v => setDraftField('work_type', v)} />
                    <EditField label="Preferred Locations" icon={MapPin}    value={draft.preferred_locations}  onChange={v => setDraftField('preferred_locations', v)} />
                    <EditField label="Salary Min ($)"      icon={DollarSign}value={draft.desired_salary_min}  onChange={v => setDraftField('desired_salary_min', v ? Number(v) : null)} type="number" />
                    <EditField label="Salary Max ($)"      icon={DollarSign}value={draft.desired_salary_max}  onChange={v => setDraftField('desired_salary_max', v ? Number(v) : null)} type="number" />
                    <EditField label="Years of Experience" icon={Clock3}    value={draft.years_experience}    onChange={v => setDraftField('years_experience', v ? Number(v) : null)} type="number" />
                    <EditField label="Notice Period"       icon={Clock3}    value={draft.notice_period}       onChange={v => setDraftField('notice_period', v)} />
                    <EditField label="Availability"        icon={Calendar}  value={draft.availability}        onChange={v => setDraftField('availability', v)} />
                    <EditField label="Visa / Work Auth"    icon={Flag}      value={draft.visa_status}         onChange={v => setDraftField('visa_status', v)} />
                    <div className="py-2 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Tag size={11} className="text-gray-400 shrink-0" />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Core Skills</span>
                      </div>
                      <input value={draft.core_skills} onChange={e => setDraftField('core_skills', e.target.value)}
                        placeholder="React, TypeScript, Node.js, ..."
                        className="ml-4 text-xs text-gray-800 bg-white border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-100 w-[calc(100%-1rem)]" />
                      <p className="ml-4 text-[9px] text-gray-400 mt-1">Comma-separated list</p>
                    </div>
                  </>
                ) : (
                  <>
                    <InfoField label="Target Role"          icon={Briefcase}  value={displayProfile.target_role} />
                    <InfoField label="Work Type"            icon={Building2}  value={displayProfile.work_type} />
                    <InfoField label="Preferred Locations"  icon={MapPin}     value={displayProfile.preferred_locations} />
                    <InfoField
                      label="Salary Range" icon={DollarSign}
                      value={
                        displayProfile.desired_salary_min || displayProfile.desired_salary_max
                          ? [
                              displayProfile.desired_salary_min ? `$${displayProfile.desired_salary_min.toLocaleString()}` : null,
                              displayProfile.desired_salary_max ? `$${displayProfile.desired_salary_max.toLocaleString()}` : null,
                            ].filter(Boolean).join(' – ')
                          : null
                      }
                    />
                    <InfoField label="Years of Experience" icon={Clock3}   value={displayProfile.years_experience ?? null} />
                    <InfoField label="Notice Period"       icon={Clock3}   value={displayProfile.notice_period} />
                    <InfoField label="Availability"        icon={Calendar} value={displayProfile.availability} />
                    <InfoField label="Visa / Work Auth"    icon={Flag}     value={displayProfile.visa_status} />
                    <div className="py-2.5 border-b border-gray-50 last:border-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Tag size={11} className="text-gray-400 shrink-0" />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Core Skills</span>
                      </div>
                      {skills.length === 0
                        ? <span className="text-xs text-gray-300 italic pl-4">—</span>
                        : <p className="text-xs text-gray-800 pl-4 leading-relaxed">{skills.join(', ')}</p>
                      }
                    </div>
                  </>
                )}
              </SectionCard>

              {/* Col 3 — Education */}
              <SectionCard
                title="Education" icon={GraduationCap} color="text-violet-700" bg="bg-violet-50"
                action={editMode ? (
                  <button onClick={addEdu}
                    className="flex items-center gap-1 text-[10px] font-bold text-violet-600 hover:text-violet-800 bg-white/80 px-2 py-1 rounded-lg transition-colors">
                    <Plus size={10} /> Add
                  </button>
                ) : undefined}
              >
                {editMode && draft ? (
                  <div className="flex flex-col gap-2.5 py-3">
                    {(draft.education as EducationEntry[]).length === 0 && (
                      <div className="py-6 text-center">
                        <span className="text-xs text-gray-300">No entries — click Add to start</span>
                      </div>
                    )}
                    {(draft.education as EducationEntry[]).map((edu, i) => (
                      <EduEntryEdit key={i} edu={edu} onChange={e => setEdu(i, e)} onRemove={() => removeEdu(i)} />
                    ))}
                  </div>
                ) : (
                  (!displayProfile.education || (displayProfile.education as EducationEntry[]).length === 0) ? (
                    <EmptyState icon={GraduationCap} bg="bg-violet-50" color="text-violet-300" message="No education listed" />
                  ) : (
                    <div className="flex flex-col gap-3 py-3">
                      {(displayProfile.education as EducationEntry[]).map((edu, i) => (
                        <div key={i} className="rounded-xl bg-violet-50/60 border border-violet-100 px-3 py-2.5">
                          <p className="text-xs font-bold text-gray-800 leading-tight">{edu.degree}{edu.field ? ` · ${edu.field}` : ''}</p>
                          <p className="text-[11px] text-violet-700 font-semibold mt-0.5">{edu.institution}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {(edu.start_year || edu.end_year) && (
                              <span className="text-[10px] text-gray-400">{edu.start_year}{edu.end_year ? ` – ${edu.end_year}` : ''}</span>
                            )}
                            {edu.gpa && (
                              <span className="text-[10px] bg-white border border-violet-200 text-violet-600 px-1.5 py-0.5 rounded-full font-semibold">GPA {edu.gpa}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </SectionCard>

              {/* Col 4 — Experience */}
              <SectionCard
                title="Experience" icon={Building2} color="text-amber-700" bg="bg-amber-50"
                action={editMode ? (
                  <button onClick={addExp}
                    className="flex items-center gap-1 text-[10px] font-bold text-amber-600 hover:text-amber-800 bg-white/80 px-2 py-1 rounded-lg transition-colors">
                    <Plus size={10} /> Add
                  </button>
                ) : undefined}
              >
                {editMode && draft ? (
                  <div className="flex flex-col gap-2.5 py-3">
                    {(draft.experience as ExperienceEntry[]).length === 0 && (
                      <div className="py-6 text-center">
                        <span className="text-xs text-gray-300">No entries — click Add to start</span>
                      </div>
                    )}
                    {(draft.experience as ExperienceEntry[]).map((exp, i) => (
                      <ExpEntryEdit key={i} exp={exp} onChange={e => setExp(i, e)} onRemove={() => removeExp(i)} />
                    ))}
                  </div>
                ) : (
                  (!displayProfile.experience || (displayProfile.experience as ExperienceEntry[]).length === 0) ? (
                    <EmptyState icon={Building2} bg="bg-amber-50" color="text-amber-300" message="No experience listed" />
                  ) : (
                    <div className="flex flex-col gap-3 py-3">
                      {(displayProfile.experience as ExperienceEntry[]).map((exp, i) => (
                        <div key={i} className="rounded-xl bg-amber-50/60 border border-amber-100 px-3 py-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-bold text-gray-800 leading-tight">{exp.title}</p>
                            {exp.current && (
                              <span className="text-[9px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full shrink-0 leading-none">Current</span>
                            )}
                          </div>
                          <p className="text-[11px] text-amber-700 font-semibold mt-0.5">{exp.company}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            {(exp.start_date || exp.end_date) && (
                              <span className="text-[10px] text-gray-400">{exp.start_date}{exp.end_date && !exp.current ? ` – ${exp.end_date}` : exp.current ? ' – Present' : ''}</span>
                            )}
                            {exp.location && (
                              <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><MapPin size={8} />{exp.location}</span>
                            )}
                          </div>
                          {exp.description && (
                            <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed line-clamp-3">{exp.description}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                )}
              </SectionCard>

            </div>
          </div>
        )}

        {/* ── JOBS ── */}
        {tab === 'jobs' && (
          <div className="p-4 h-full">
            <div className="grid grid-cols-4 gap-3 h-full" style={{ minHeight: 0 }}>
              <SectionCard title={`New  ·  ${jobsByStatus.New.length}`} icon={Bookmark} color="text-gray-600" bg="bg-gray-50">
                {jobsByStatus.New.length === 0 ? (
                  <div className="py-10 flex flex-col items-center gap-2 text-center">
                    <Bookmark size={18} className="text-gray-200" />
                    <span className="text-xs text-gray-300">No new jobs</span>
                    <button onClick={() => navigate(`/job-finder?profileId=${profile.id}&role=${encodeURIComponent(profile.target_role)}`)}
                      className="text-blue-500 hover:text-blue-600 text-[11px] font-semibold mt-1">
                      Find jobs &rarr;
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 py-3">
                    {jobsByStatus.New.map(job => <JobCard key={job.id} job={job} onStatusChange={cycleJobStatus} onRemove={removeFromWishlist} />)}
                  </div>
                )}
              </SectionCard>
              <SectionCard title={`Applied  ·  ${jobsByStatus.Applied.length}`} icon={Circle} color="text-blue-700" bg="bg-blue-50">
                {jobsByStatus.Applied.length === 0
                  ? <EmptyState icon={Circle} bg="bg-blue-50" color="text-blue-200" message="No applied jobs" />
                  : <div className="flex flex-col gap-2 py-3">{jobsByStatus.Applied.map(job => <JobCard key={job.id} job={job} onStatusChange={cycleJobStatus} onRemove={removeFromWishlist} />)}</div>
                }
              </SectionCard>
              <SectionCard title={`Rejected  ·  ${jobsByStatus.Rejected.length}`} icon={XCircle} color="text-red-600" bg="bg-red-50">
                {jobsByStatus.Rejected.length === 0
                  ? <EmptyState icon={XCircle} bg="bg-red-50" color="text-red-200" message="No rejected jobs" />
                  : <div className="flex flex-col gap-2 py-3">{jobsByStatus.Rejected.map(job => <JobCard key={job.id} job={job} onStatusChange={cycleJobStatus} onRemove={removeFromWishlist} />)}</div>
                }
              </SectionCard>
              <SectionCard title={`Placed  ·  ${jobsByStatus.Placed.length}`} icon={Trophy} color="text-emerald-700" bg="bg-emerald-50">
                {jobsByStatus.Placed.length === 0
                  ? <EmptyState icon={Trophy} bg="bg-emerald-50" color="text-emerald-200" message="No placements yet" />
                  : <div className="flex flex-col gap-2 py-3">{jobsByStatus.Placed.map(job => <JobCard key={job.id} job={job} onStatusChange={cycleJobStatus} onRemove={removeFromWishlist} />)}</div>
                }
              </SectionCard>
            </div>
          </div>
        )}

        {/* ── DOCUMENTS ── */}
        {tab === 'documents' && (
          <div className="p-4 h-full">
            <div className="grid grid-cols-4 gap-3 h-full" style={{ minHeight: 0 }}>
              {([
                { category: 'resume',     label: 'Resumes',                icon: FileText,    color: 'text-blue-700',   bg: 'bg-blue-50',   fileBg: 'bg-blue-50/50',   fileBorder: 'border-blue-100',   iconColor: 'text-blue-500'   },
                { category: 'experience', label: 'Experience Docs',         icon: Building2,   color: 'text-amber-700',  bg: 'bg-amber-50',  fileBg: 'bg-amber-50/50',  fileBorder: 'border-amber-100',  iconColor: 'text-amber-500'  },
                { category: 'education',  label: 'Education Docs',          icon: GraduationCap, color: 'text-violet-700', bg: 'bg-violet-50', fileBg: 'bg-violet-50/50', fileBorder: 'border-violet-100', iconColor: 'text-violet-500' },
                { category: 'visa',       label: 'Visa & Work Auth Docs',   icon: Flag,        color: 'text-rose-700',   bg: 'bg-rose-50',   fileBg: 'bg-rose-50/50',   fileBorder: 'border-rose-100',   iconColor: 'text-rose-500'   },
              ]).map(({ category, label, icon: Icon, color, bg, fileBg, fileBorder, iconColor }) => {
                const docs = resumes.filter(r => (r.category ?? 'resume') === category);
                const uploading = uploadingCategory === category;
                return (
                  <SectionCard
                    key={category}
                    title={label}
                    icon={Icon}
                    color={color}
                    bg={bg}
                    action={
                      <button
                        onClick={() => triggerDocUpload(category)}
                        disabled={uploading}
                        className={`flex items-center gap-1 text-[10px] font-bold ${color} hover:opacity-70 bg-white/80 px-2 py-1 rounded-lg transition-opacity disabled:opacity-40`}
                      >
                        {uploading ? <LogoSpinner size={10} /> : <Plus size={10} />}
                        {uploading ? 'Uploading…' : 'Upload'}
                      </button>
                    }
                  >
                    {docs.length === 0 ? (
                      <div className="py-12 flex flex-col items-center gap-2 text-center">
                        <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center`}>
                          <Icon size={18} className={`${iconColor} opacity-30`} />
                        </div>
                        <span className="text-xs text-gray-400">No files yet</span>
                        <button
                          onClick={() => triggerDocUpload(category)}
                          className={`text-[11px] font-semibold ${color} hover:opacity-70 transition-opacity mt-0.5`}
                        >
                          + Upload file
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 py-3">
                        {docs.map(doc => (
                          <div key={doc.id} className={`flex items-center gap-2 rounded-xl ${fileBg} border ${fileBorder} px-3 py-2.5`}>
                            <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center shrink-0">
                              <FileText size={12} className={iconColor} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-gray-800 truncate">{doc.file_name}</p>
                              <p className="text-[10px] text-gray-400">{formatDate(doc.created_at)}</p>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              {doc.file_url ? (
                                <a href={doc.file_url} download={doc.file_name} className={`${iconColor} hover:opacity-70 transition-opacity`}>
                                  <Download size={12} />
                                </a>
                              ) : (
                                <button className="text-gray-300 cursor-not-allowed" title="No URL available">
                                  <Download size={12} />
                                </button>
                              )}
                              <button
                                onClick={() => deleteDocument(doc)}
                                className="text-gray-300 hover:text-red-400 transition-colors ml-0.5"
                                title="Delete file"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </SectionCard>
                );
              })}
            </div>
          </div>
        )}

        {/* ── ACTIVITY ── */}
        {tab === 'activity' && (
          <div className="p-4">
            {activity.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm py-16 flex flex-col items-center gap-3 text-center px-4 max-w-xl">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center">
                  <Activity size={20} className="text-amber-300" />
                </div>
                <p className="text-gray-500 text-sm font-medium">No activity recorded yet.</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5 max-w-xl">
                <div className="relative">
                  <div className="absolute left-4 top-2 bottom-2 w-px bg-gray-100" />
                  <ul className="space-y-1">
                    {activity.map(log => {
                      const meta = EVENT_ICONS[log.event_type] ?? EVENT_ICONS.default;
                      const Icon = meta.icon;
                      return (
                        <li key={log.id} className="flex gap-4 items-start py-2 relative">
                          <div className={`w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center shrink-0 relative z-10 ${meta.color}`}>
                            <Icon size={13} />
                          </div>
                          <div className="flex-1 min-w-0 pt-0.5">
                            <p className="text-xs text-gray-700 leading-relaxed">{log.description}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">{formatDatetime(log.created_at)}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      <input ref={docFileInputRef} type="file" accept=".pdf,.doc,.docx,.rtf,.txt" className="hidden" onChange={handleDocUpload} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
