import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Briefcase, Building2, Check, Clock3, Eye, LayoutGrid, MapPin, MessageSquare, Pencil, Plus, RotateCcw,
  Search, Share2, Sparkles, Trash2, UserRound, Users, X, XCircle,
  type LucideIcon,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import PostFormModal, { type PostKind, type UserPost } from '../components/posts/PostFormModal';
import ClaimPostsWidget from '../components/posts/ClaimPostsWidget';
import ScreeningSubmissionModal, { type ScreeningTurn } from '../components/ScreeningSubmissionModal';

interface ApplicationRow {
  id: string;
  candidate_name: string;
  candidate_email: string;
  candidate_phone: string;
  resume_url: string;
  resume_file_name: string;
  recruiter_note: string;
  status: string;
  ai_summary: string | null;
  ai_score: number | null;
  created_at: string;
  applied_by_account_name: string | null;
  applied_by_user_email: string | null;
}

const APPLICATION_STATUS_STYLES: Record<string, string> = {
  submitted: 'border-gray-200 bg-gray-100 text-gray-600',
  screening_sent: 'border-blue-200 bg-blue-50 text-blue-700',
  screening_completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  qualified: 'border-emerald-300 bg-emerald-100 text-emerald-800',
  rejected: 'border-red-200 bg-red-50 text-red-600',
};

const APPLICATION_STATUS_LABELS: Record<string, string> = {
  submitted: 'Applied',
  screening_sent: 'Screening Sent',
  screening_completed: 'Screening Submitted',
  qualified: 'Qualified',
  rejected: 'Rejected',
};

type KindFilter = 'all' | 'job' | 'hotlist';
type StatusFilter = 'open' | 'closed';

const KIND_FILTER_OPTIONS: Array<{ id: KindFilter; label: string; icon: LucideIcon }> = [
  { id: 'all', label: 'All', icon: LayoutGrid },
  { id: 'job', label: 'Jobs', icon: Briefcase },
  { id: 'hotlist', label: 'Hotlist', icon: UserRound },
];

const STATUS_FILTER_OPTIONS: Array<{ id: StatusFilter; label: string; icon: LucideIcon }> = [
  { id: 'open', label: 'Open', icon: Check },
  { id: 'closed', label: 'Closed', icon: XCircle },
];

const RANGE_OPTIONS: Array<{ id: string; label: string; hours: number | null }> = [
  { id: 'all', label: 'All time', hours: null },
  { id: '24h', label: 'Last 24 hours', hours: 24 },
  { id: '7d', label: 'Last 7 days', hours: 168 },
  { id: '30d', label: 'Last 30 days', hours: 720 },
];

function formatAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function matchesSearch(post: UserPost, query: string): boolean {
  if (!query) return true;
  const haystack = [
    post.title, post.company, post.candidateName, post.location,
    ...post.locations, ...post.skills,
  ].join(' ').toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function matchesRange(post: UserPost, rangeId: string): boolean {
  const range = RANGE_OPTIONS.find((option) => option.id === rangeId);
  if (!range || range.hours == null) return true;
  const cutoff = Date.now() - range.hours * 60 * 60 * 1000;
  return new Date(post.createdAt).getTime() >= cutoff;
}

export default function MyPostsPage() {
  const { account } = useAuth();
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [pendingSearchQuery, setPendingSearchQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [rangeId, setRangeId] = useState('all');
  const [isRangeMenuOpen, setIsRangeMenuOpen] = useState(false);
  const rangeMenuRef = useRef<HTMLDivElement | null>(null);
  const [jobPosts, setJobPosts] = useState<UserPost[]>([]);
  const [hotlistPosts, setHotlistPosts] = useState<UserPost[]>([]);
  const [metricsByPostId, setMetricsByPostId] = useState<Record<string, { previewCount: number; chatCount: number; shareCount: number; applicationCount: number }>>({});
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState<PostKind | null>(null);
  const [editingPost, setEditingPost] = useState<UserPost | null>(null);
  const [previewPost, setPreviewPost] = useState<UserPost | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(null);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [turnsByApplication, setTurnsByApplication] = useState<Record<string, ScreeningTurn[]>>({});
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [decisionBusyId, setDecisionBusyId] = useState<string | null>(null);
  const [chatBusyId, setChatBusyId] = useState<string | null>(null);
  const [applicantSearchQuery, setApplicantSearchQuery] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [landingPasteText, setLandingPasteText] = useState('');
  const [showKindChooser, setShowKindChooser] = useState(false);
  const [chosenKind, setChosenKind] = useState<PostKind>('job');
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [seedPasteText, setSeedPasteText] = useState<string | undefined>(undefined);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => setToast({ message, type }), []);

  const loadPosts = useCallback(async () => {
    if (!account?.id) return;
    setLoading(true);
    const [jobResult, hotlistResult, metricsResult] = await Promise.all([
      supabase
        .from('social_jobs')
        .select('id, job_title, company_name, location, employment_type, seniority_level, salary_range, job_description, post_content, extracted_skills, extracted_experience_years, extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max, poster_email, poster_phone, post_status, created_at')
        .eq('created_by_account_id', account.id)
        .eq('post_source', 'user_post')
        .is('hidden_at', null)
        .order('created_at', { ascending: false }),
      supabase
        .from('social_hotlist')
        .select('id, role_title, candidate_name, core_skills, years_experience, visa_type, employment_type, work_type, locations, hourly_rate_min, hourly_rate_max, availability, candidate_summary, raw_post_content, bench_sales_recruiter_email, bench_sales_recruiter_phone, post_status, created_at')
        .eq('created_by_account_id', account.id)
        .eq('post_source', 'user_post')
        .is('hidden_at', null)
        .order('created_at', { ascending: false }),
      supabase.rpc('get_my_post_metrics' as never),
    ]);

    if (!jobResult.error) {
      const jobRows = (jobResult.data ?? []) as Array<{
        id: string; job_title: string | null; company_name: string | null; location: string | null;
        employment_type: string | null; seniority_level: string | null; salary_range: string | null;
        job_description: string | null; post_content: string | null; extracted_skills: string[] | null;
        extracted_experience_years: number | null; extracted_visa_types: string[] | null;
        extracted_hourly_rate_min: number | null; extracted_hourly_rate_max: number | null;
        poster_email: string | null; poster_phone: string | null; post_status: string | null; created_at: string;
      }>;
      setJobPosts(jobRows.map((row): UserPost => ({
        id: row.id,
        kind: 'job',
        title: row.job_title ?? '',
        company: row.company_name ?? '',
        location: row.location ?? '',
        employmentType: row.employment_type ?? '',
        seniorityLevel: row.seniority_level ?? '',
        salaryRange: row.salary_range ?? '',
        jobDescription: row.job_description ?? '',
        postContent: row.post_content ?? '',
        skills: Array.isArray(row.extracted_skills) ? row.extracted_skills : [],
        experienceYears: row.extracted_experience_years ?? null,
        visaTypes: Array.isArray(row.extracted_visa_types) ? row.extracted_visa_types : [],
        hourlyRateMin: row.extracted_hourly_rate_min ?? null,
        hourlyRateMax: row.extracted_hourly_rate_max ?? null,
        contactEmail: row.poster_email ?? '',
        contactPhone: row.poster_phone ?? '',
        candidateName: '',
        visaType: '',
        workType: '',
        locations: [],
        availability: '',
        candidateSummary: '',
        postStatus: (row.post_status as 'open' | 'closed') ?? 'open',
        createdAt: row.created_at,
      })));
    }

    if (!hotlistResult.error) {
      const hotlistRows = (hotlistResult.data ?? []) as Array<{
        id: string; role_title: string | null; candidate_name: string | null; core_skills: string[] | null;
        years_experience: number | null; visa_type: string | null; employment_type: string | null; work_type: string | null;
        locations: string[] | null; hourly_rate_min: number | null; hourly_rate_max: number | null;
        availability: string | null; candidate_summary: string | null; raw_post_content: string | null;
        bench_sales_recruiter_email: string | null; bench_sales_recruiter_phone: string | null;
        post_status: string | null; created_at: string;
      }>;
      setHotlistPosts(hotlistRows.map((row): UserPost => ({
        id: row.id,
        kind: 'hotlist',
        title: row.role_title ?? '',
        company: '',
        location: '',
        employmentType: row.employment_type ?? '',
        seniorityLevel: '',
        salaryRange: '',
        jobDescription: '',
        postContent: row.raw_post_content ?? '',
        skills: Array.isArray(row.core_skills) ? row.core_skills : [],
        experienceYears: row.years_experience ?? null,
        visaTypes: [],
        hourlyRateMin: row.hourly_rate_min ?? null,
        hourlyRateMax: row.hourly_rate_max ?? null,
        contactEmail: row.bench_sales_recruiter_email ?? '',
        contactPhone: row.bench_sales_recruiter_phone ?? '',
        candidateName: row.candidate_name ?? '',
        visaType: row.visa_type ?? '',
        workType: row.work_type ?? '',
        locations: Array.isArray(row.locations) ? row.locations : [],
        availability: row.availability ?? '',
        candidateSummary: row.candidate_summary ?? '',
        postStatus: (row.post_status as 'open' | 'closed') ?? 'open',
        createdAt: row.created_at,
      })));
    }

    if (!metricsResult.error) {
      const metricsRows = (metricsResult.data ?? []) as Array<{ post_id: string; preview_count: number; chat_count: number; share_count: number; application_count: number }>;
      const next: Record<string, { previewCount: number; chatCount: number; shareCount: number; applicationCount: number }> = {};
      for (const row of metricsRows) {
        next[row.post_id] = {
          previewCount: row.preview_count ?? 0,
          chatCount: row.chat_count ?? 0,
          shareCount: row.share_count ?? 0,
          applicationCount: row.application_count ?? 0,
        };
      }
      setMetricsByPostId(next);
    }

    setLoading(false);
  }, [account?.id]);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

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

  async function handleToggleStatus(post: UserPost) {
    const nextStatus = post.postStatus === 'open' ? 'closed' : 'open';
    const rpcName = post.kind === 'job' ? 'update_user_job_post' : 'update_user_hotlist_post';
    const args = post.kind === 'job'
      ? {
        p_id: post.id, p_job_title: post.title, p_company_name: post.company, p_location: post.location,
        p_employment_type: post.employmentType, p_seniority_level: post.seniorityLevel, p_salary_range: post.salaryRange,
        p_job_description: post.jobDescription, p_post_content: post.postContent, p_skills: post.skills,
        p_experience_years: post.experienceYears, p_visa_types: post.visaTypes, p_hourly_rate_min: post.hourlyRateMin,
        p_hourly_rate_max: post.hourlyRateMax, p_contact_email: post.contactEmail, p_contact_phone: post.contactPhone,
        p_post_status: nextStatus,
      }
      : {
        p_id: post.id, p_role_title: post.title, p_candidate_name: post.candidateName, p_core_skills: post.skills,
        p_years_experience: post.experienceYears, p_visa_type: post.visaType, p_employment_type: post.employmentType,
        p_work_type: post.workType, p_locations: post.locations, p_hourly_rate_min: post.hourlyRateMin,
        p_hourly_rate_max: post.hourlyRateMax, p_availability: post.availability, p_candidate_summary: post.candidateSummary,
        p_post_content: post.postContent, p_contact_email: post.contactEmail, p_contact_phone: post.contactPhone,
        p_post_status: nextStatus,
      };
    const { error } = await supabase.rpc(rpcName as never, args as never);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    showToast(nextStatus === 'closed' ? 'Post closed' : 'Post reopened', 'success');
    void loadPosts();
  }

  async function handleDelete(post: UserPost) {
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    const rpcName = post.kind === 'job' ? 'delete_user_job_post' : 'delete_user_hotlist_post';
    const { error } = await supabase.rpc(rpcName as never, { p_id: post.id } as never);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    showToast('Post deleted', 'success');
    void loadPosts();
  }

  // Applicants + application-detail columns only apply to job posts —
  // social_hotlist has no equivalent job_applications table.
  const loadApplicationsForPost = useCallback(async (jobId: string) => {
    setApplicationsLoading(true);
    const { data, error } = await supabase.rpc('get_post_applications' as never, { p_social_job_id: jobId } as never);
    if (error) {
      showToast(error.message, 'error');
      setApplicationsLoading(false);
      return;
    }
    const appRows = (data ?? []) as unknown as ApplicationRow[];
    setApplications(appRows);

    const appIds = appRows.map((a) => a.id);
    if (appIds.length > 0) {
      const { data: turns } = await supabase
        .from('job_application_screening_turns')
        .select('id, application_id, turn_index, question_text, video_offset_ms, answered_at')
        .in('application_id', appIds)
        .order('turn_index', { ascending: true });

      const grouped: Record<string, ScreeningTurn[]> = {};
      for (const turn of (turns ?? []) as unknown as Array<ScreeningTurn & { application_id: string }>) {
        (grouped[turn.application_id] ??= []).push(turn);
      }
      setTurnsByApplication(grouped);
    } else {
      setTurnsByApplication({});
    }
    setApplicationsLoading(false);
  }, [showToast]);

  useEffect(() => {
    setSelectedApplicationId(null);
    setApplicantSearchQuery('');
    if (!selectedPostId) {
      setApplications([]);
      setTurnsByApplication({});
      return;
    }
    const post = [...jobPosts, ...hotlistPosts].find((p) => p.id === selectedPostId);
    if (post?.kind === 'job') {
      void loadApplicationsForPost(selectedPostId);
    } else {
      setApplications([]);
      setTurnsByApplication({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPostId]);

  async function handleQualify(applicationId: string) {
    setDecisionBusyId(applicationId);
    const { error } = await supabase.rpc('set_job_application_decision' as never, {
      p_application_id: applicationId,
      p_status: 'qualified',
    } as never);
    setDecisionBusyId(null);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    setApplications((prev) => prev.map((a) => (a.id === applicationId ? { ...a, status: 'qualified' } : a)));
    showToast('Candidate qualified', 'success');
  }

  async function handleReject(applicationId: string) {
    setDecisionBusyId(applicationId);
    const { error } = await supabase.rpc('set_job_application_decision' as never, {
      p_application_id: applicationId,
      p_status: 'rejected',
    } as never);
    setDecisionBusyId(null);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    setApplications((prev) => prev.map((a) => (a.id === applicationId ? { ...a, status: 'rejected' } : a)));
    showToast('Candidate rejected', 'success');
  }

  async function handleApplicantChat(applicationId: string) {
    setChatBusyId(applicationId);
    const { data, error } = await supabase.rpc('start_application_chat' as never, {
      p_application_id: applicationId,
    } as never);
    setChatBusyId(null);
    if (error || !data) {
      showToast(error?.message || 'Could not start the conversation', 'error');
      return;
    }
    navigate(`/inbox/${data as string}`);
  }

  function handleStartFromPaste() {
    if (!landingPasteText.trim()) return;
    setShowKindChooser(true);
  }

  function handleContinueToForm() {
    setEditingPost(null);
    setSeedPasteText(landingPasteText.trim());
    setFormOpen(chosenKind);
    setShowKindChooser(false);
    setLandingPasteText('');
    setShowPasteModal(false);
  }

  const pasteTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  function handleAddPostClick() {
    setShowKindChooser(false);
    if (hasAnyPosts) {
      setShowPasteModal(true);
    } else {
      pasteTextareaRef.current?.focus();
    }
  }

  function closePasteModal() {
    setShowPasteModal(false);
    setShowKindChooser(false);
    setLandingPasteText('');
  }

  useEffect(() => {
    if (!showPasteModal) return;
    const id = window.setTimeout(() => pasteTextareaRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [showPasteModal]);

  const [isMobileViewport, setIsMobileViewport] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 639px)');
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener('change', updateViewport);
    return () => mediaQuery.removeEventListener('change', updateViewport);
  }, []);

  const hasAnyPosts = jobPosts.length > 0 || hotlistPosts.length > 0;
  const posts = useMemo(() => {
    const source = kindFilter === 'all' ? [...jobPosts, ...hotlistPosts] : kindFilter === 'job' ? jobPosts : hotlistPosts;
    return source
      .filter((post) => post.postStatus === statusFilter)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [kindFilter, statusFilter, jobPosts, hotlistPosts]);
  const filteredPosts = useMemo(
    () => posts.filter((post) => matchesSearch(post, searchQuery) && matchesRange(post, rangeId)),
    [posts, searchQuery, rangeId],
  );
  const selectedPost = selectedPostId ? filteredPosts.find((post) => post.id === selectedPostId) ?? null : null;
  const zeroMetrics = { previewCount: 0, chatCount: 0, shareCount: 0, applicationCount: 0 };

  const normalizedApplicantSearch = applicantSearchQuery.trim().toLowerCase();
  const filteredApplications = applications.filter((app) => {
    if (!normalizedApplicantSearch) return true;
    return (
      app.candidate_name?.toLowerCase().includes(normalizedApplicantSearch) ||
      app.candidate_email?.toLowerCase().includes(normalizedApplicantSearch)
    );
  });
  const selectedApplication = selectedApplicationId ? applications.find((a) => a.id === selectedApplicationId) ?? null : null;
  const selectedApplicationTurns = selectedApplication ? (turnsByApplication[selectedApplication.id] ?? []) : [];
  const selectedApplicationHasAnsweredTurn = selectedApplicationTurns.some((t) => t.answered_at);
  const selectedApplicationScreeningSubmitted = selectedApplication
    ? (selectedApplication.status === 'screening_completed' || selectedApplication.status === 'qualified')
    : false;
  const selectedApplicationCanDecide = selectedApplication
    ? (selectedApplication.status !== 'qualified' && selectedApplication.status !== 'rejected')
    : false;
  // The desktop 3-column view should sit directly on the page background,
  // matching /feed's detail layout (its wrapper is bg-transparent, not a
  // white bordered card) — only loading/empty/mobile states keep the
  // bordered white frame.
  const showingDesktopColumns = !loading && !isMobileViewport
    && !(filteredPosts.length === 0 && (posts.length > 0 || hasAnyPosts));

  const searchBoxEl = (
    <div className="relative flex min-w-[160px] flex-1 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 dark:border-white/10 dark:bg-[#20242a]">
      <Search size={11} className="text-gray-400" />
      <input
        type="text"
        value={pendingSearchQuery}
        onChange={(e) => setPendingSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            setSearchQuery(pendingSearchQuery.trim());
          }
        }}
        placeholder="Search your posts"
        className="w-full border-0 bg-transparent text-[12px] text-gray-700 outline-none placeholder:text-gray-400 dark:text-slate-200 dark:placeholder:text-[#64748B]"
      />
      {pendingSearchQuery && (
        <button
          type="button"
          onClick={() => { setPendingSearchQuery(''); setSearchQuery(''); }}
          className="rounded-full p-0.5 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-600 dark:hover:bg-white/10"
          aria-label="Clear search"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );

  const searchButtonEl = (
    <button
      type="button"
      onClick={() => setSearchQuery(pendingSearchQuery.trim())}
      className="shrink-0 rounded-full border border-blue-600 bg-blue-600 p-1.5 text-white transition hover:bg-blue-700"
      aria-label="Search"
    >
      <Search size={12} />
    </button>
  );

  const rangeMenuEl = (
    <div ref={rangeMenuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setIsRangeMenuOpen((prev) => !prev)}
        className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-100 dark:border-white/10 dark:bg-[#20242a] dark:text-[#94A3B8] dark:hover:bg-white/5"
        aria-label="Change date range"
      >
        <Clock3 size={11} />
        <span>{rangeId}</span>
      </button>

      {isRangeMenuOpen && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-40 min-w-[130px] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#20242a]">
          {RANGE_OPTIONS.map((option) => {
            const isActive = option.id === rangeId;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => { setRangeId(option.id); setIsRangeMenuOpen(false); }}
                className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${isActive ? (isDark ? 'bg-[#2A2E35] text-slate-100' : 'bg-gray-100 text-gray-800') : (isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-600 hover:bg-gray-50')}`}
              >
                <span>{option.label}</span>
                {isActive ? <Check size={11} /> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const kindCounts: Record<KindFilter, number> = {
    all: jobPosts.filter((p) => p.postStatus === statusFilter).length + hotlistPosts.filter((p) => p.postStatus === statusFilter).length,
    job: jobPosts.filter((p) => p.postStatus === statusFilter).length,
    hotlist: hotlistPosts.filter((p) => p.postStatus === statusFilter).length,
  };
  const statusCounts: Record<StatusFilter, number> = {
    open: jobPosts.filter((p) => p.postStatus === 'open').length + hotlistPosts.filter((p) => p.postStatus === 'open').length,
    closed: jobPosts.filter((p) => p.postStatus === 'closed').length + hotlistPosts.filter((p) => p.postStatus === 'closed').length,
  };

  function kindFilterButtonsEl(fullWidth: boolean, compact = false) {
    return KIND_FILTER_OPTIONS.map((option) => {
      const isSelected = kindFilter === option.id;
      const Icon = option.icon;
      return (
        <button
          key={option.id}
          type="button"
          onClick={() => setKindFilter(option.id)}
          title={option.label}
          aria-label={option.label}
          className={`inline-flex items-center justify-center gap-1 rounded-full font-semibold transition ${compact ? 'px-2 py-1.5' : 'px-3 py-1.5 text-[11px]'} ${fullWidth ? 'w-full' : ''} ${isSelected ? (isDark ? 'border border-white/25 bg-[#2A2E35] text-slate-100' : 'border border-blue-600 bg-blue-600 text-white') : (isDark ? 'border border-transparent bg-[#171a1f] text-[#94A3B8] hover:bg-white/5' : 'border border-transparent bg-white text-gray-500 hover:text-gray-700')}`}
        >
          <Icon size={compact ? 13 : 11} />
          {!compact && (
            <>
              <span>{option.label}</span>
              <span>{kindCounts[option.id]}</span>
            </>
          )}
        </button>
      );
    });
  }

  function statusFilterButtonsEl(fullWidth: boolean, compact = false) {
    return STATUS_FILTER_OPTIONS.map((option) => {
      const isSelected = statusFilter === option.id;
      const Icon = option.icon;
      return (
        <button
          key={option.id}
          type="button"
          onClick={() => setStatusFilter(option.id)}
          title={option.label}
          aria-label={option.label}
          className={`inline-flex items-center justify-center gap-1 rounded-full font-semibold transition ${compact ? 'px-2 py-1.5' : 'px-3 py-1.5 text-[11px]'} ${fullWidth ? 'w-full' : ''} ${isSelected ? (isDark ? 'border border-white/25 bg-[#2A2E35] text-slate-100' : 'border border-blue-600 bg-blue-600 text-white') : (isDark ? 'border border-transparent bg-[#171a1f] text-[#94A3B8] hover:bg-white/5' : 'border border-transparent bg-white text-gray-500 hover:text-gray-700')}`}
        >
          <Icon size={compact ? 13 : 11} />
          {!compact && (
            <>
              <span>{option.label}</span>
              <span>{statusCounts[option.id]}</span>
            </>
          )}
        </button>
      );
    });
  }

  function addPostButtonEl(fullWidth: boolean) {
    return (
      <button
        type="button"
        onClick={handleAddPostClick}
        className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-blue-600 bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700 ${fullWidth ? 'w-full' : ''}`}
      >
        <Plus size={13} />
        Add Post
      </button>
    );
  }

  const pasteBarInner = !showKindChooser ? (
    <>
      <textarea
        ref={pasteTextareaRef}
        value={landingPasteText}
        onChange={(e) => setLandingPasteText(e.target.value)}
        rows={8}
        placeholder="Paste a job or hotlist post here — we'll auto-fill everything ✨"
        className={`w-full resize-none rounded-2xl border px-5 py-4 text-center text-[14px] outline-none shadow-sm transition focus:ring-2 ${isDark ? 'border-white/10 bg-[#20242a] text-slate-100 placeholder:text-[#94A3B8] focus:ring-blue-500/30' : 'border-[#dfdad2] bg-white text-gray-900 placeholder:text-gray-400 focus:ring-blue-200'}`}
      />
      <button
        type="button"
        onClick={handleStartFromPaste}
        disabled={!landingPasteText.trim()}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-6 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Sparkles size={15} />
        Continue
      </button>
    </>
  ) : (
    <>
      <p className="mb-2.5 text-[13px] font-semibold text-gray-900 dark:text-slate-100">Is this a Job post or a Hotlist/consultant post?</p>
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => setChosenKind('job')}
          className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-[12px] font-semibold transition-colors ${chosenKind === 'job' ? 'border-blue-600 bg-blue-600 text-white' : (isDark ? 'border-white/15 text-[#94A3B8] hover:bg-white/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}`}
        >
          <Briefcase size={12} />
          Job
        </button>
        <button
          type="button"
          onClick={() => setChosenKind('hotlist')}
          className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-[12px] font-semibold transition-colors ${chosenKind === 'hotlist' ? 'border-blue-600 bg-blue-600 text-white' : (isDark ? 'border-white/15 text-[#94A3B8] hover:bg-white/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}`}
        >
          <UserRound size={12} />
          Hotlist
        </button>
      </div>
      <div className="mt-3 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => setShowKindChooser(false)}
          className={`rounded-full px-4 py-1.5 text-[12px] font-semibold transition-colors ${isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-500 hover:bg-gray-100'}`}
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleContinueToForm}
          className="rounded-full bg-blue-600 px-5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700"
        >
          Continue
        </button>
      </div>
    </>
  );

  return (
    <div className="h-[100dvh] overflow-hidden overscroll-none bg-[#f3f2ee] text-gray-900 flex flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0 dark:bg-[#1B1D21] dark:text-slate-100">
      <AppNav />

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full w-full flex flex-col overflow-hidden px-2 py-2">
          {isMobileViewport ? (
            <div className="flex shrink-0 flex-col gap-1.5 pb-2">
              <div className="flex items-center gap-2">
                {searchBoxEl}
                {addPostButtonEl(false)}
              </div>
              <div className="flex items-center gap-1">
                {kindFilterButtonsEl(false, true)}
                {statusFilterButtonsEl(false, true)}
              </div>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-2 pb-2">
              <div className="flex shrink-0 items-center gap-1">
                {kindFilterButtonsEl(false)}
              </div>
              {searchBoxEl}
              {searchButtonEl}
              <div className="flex shrink-0 items-center gap-1">
                {statusFilterButtonsEl(false)}
              </div>
              {rangeMenuEl}
              {addPostButtonEl(false)}
            </div>
          )}

          <ClaimPostsWidget onClaimed={loadPosts} showToast={showToast} />

          {!hasAnyPosts ? (
            <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col items-center justify-center text-center">
              {pasteBarInner}
            </div>
          ) : showPasteModal ? (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={closePasteModal}>
              <div
                className={`w-full max-w-xl rounded-lg border p-4 text-center shadow-xl ${isDark ? 'border-white/10 bg-[#1B1D21]' : 'border-gray-200 bg-white'}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-1 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={closePasteModal}
                    className={`rounded-full p-1 transition-colors ${isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}
                  >
                    <X size={16} />
                  </button>
                </div>
                {pasteBarInner}
              </div>
            </div>
          ) : null}

          <div className={`min-h-0 overflow-auto ${showingDesktopColumns ? 'bg-transparent p-1' : 'rounded-lg border border-[#dfdad2] bg-white dark:border-white/10 dark:bg-[#1E2126]'} ${!hasAnyPosts && !loading ? 'shrink-0' : 'flex-1'}`}>
            {loading ? (
              <div className="flex items-center justify-center py-16"><LogoSpinner size={22} /></div>
            ) : filteredPosts.length === 0 && (posts.length > 0 || hasAnyPosts) ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-[13px] font-semibold text-gray-500 dark:text-slate-400">
                  {posts.length > 0 ? 'No posts match your search' : statusFilter === 'closed' ? 'No closed posts' : `No open ${kindFilter === 'all' ? '' : kindFilter === 'job' ? 'job ' : 'hotlist '}posts`}
                </p>
                <p className="mt-1 text-[12px] text-gray-400 dark:text-[#64748B]">
                  {posts.length > 0 ? 'Try a different search term.' : statusFilter === 'closed' ? 'Posts you close will show up here.' : 'Try switching to the Closed filter.'}
                </p>
              </div>
            ) : isMobileViewport ? (
              <div className="flex flex-col gap-2 p-2">
                {filteredPosts.map((post) => {
                  const metrics = metricsByPostId[post.id] ?? { previewCount: 0, chatCount: 0, shareCount: 0, applicationCount: 0 };
                  const displayTitle = post.kind === 'hotlist' && post.candidateName
                    ? `${post.title || 'Available Consultant'} — ${post.candidateName}`
                    : (post.title || 'Job Opportunity');
                  const locationText = post.kind === 'job' ? post.location : post.locations.join(', ');

                  return (
                    <div key={post.id} className="rounded-lg border border-[#dfdad2] bg-white p-3 dark:border-white/10 dark:bg-[#1E2126]">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${post.kind === 'job' ? (isDark ? 'border-blue-400/30 bg-blue-500/10 text-blue-300' : 'border-blue-200 bg-blue-50 text-blue-700') : (isDark ? 'border-purple-400/30 bg-purple-500/10 text-purple-300' : 'border-purple-200 bg-purple-50 text-purple-700')}`}>
                          {post.kind === 'job' ? <Briefcase size={9} /> : <UserRound size={9} />}
                          {post.kind === 'job' ? 'Job' : 'Hotlist'}
                        </span>
                        <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${post.postStatus === 'open' ? (isDark ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700') : (isDark ? 'border-white/15 bg-white/5 text-[#94A3B8]' : 'border-gray-200 bg-gray-100 text-gray-500')}`}>
                          {post.postStatus === 'open' ? 'Open' : 'Closed'}
                        </span>
                        <span className="text-[11px] text-gray-400 dark:text-[#64748B]">{formatAgo(post.createdAt)}</span>
                      </div>
                      <p className="truncate text-[13px] font-semibold leading-snug" style={{ color: isDark ? '#FFFFFF' : '#2563EB' }}>{displayTitle}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#94A3B8]">
                        {post.kind === 'job' && post.company && (
                          <span className="inline-flex items-center gap-1">
                            <Building2 size={10} className="shrink-0 text-gray-400" />
                            {post.company}
                          </span>
                        )}
                        {locationText && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={10} className="shrink-0 text-gray-400" />
                            {locationText}
                          </span>
                        )}
                      </div>

                      <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1"><Eye size={11} className="text-gray-400" />{metrics.previewCount}</span>
                        <span className="inline-flex items-center gap-1"><MessageSquare size={11} className="text-gray-400" />{metrics.chatCount}</span>
                        <span className="inline-flex items-center gap-1"><Share2 size={11} className="text-gray-400" />{metrics.shareCount}</span>
                        {post.kind === 'job' && (
                          <button
                            type="button"
                            onClick={() => navigate(`/posts/applications/${post.id}`)}
                            className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition-colors ${metrics.applicationCount > 0 ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-300' : (isDark ? 'border-white/15 text-[#94A3B8]' : 'border-gray-200 text-gray-600')}`}
                          >
                            <Users size={11} />
                            {metrics.applicationCount} Application{metrics.applicationCount === 1 ? '' : 's'}
                          </button>
                        )}
                      </div>

                      <div className="mt-2.5 flex items-center justify-around border-t border-gray-100 pt-2 dark:border-white/10">
                        <button type="button" onClick={() => setPreviewPost(post)} title="Preview post" className={`rounded p-1.5 transition-colors ${isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-500 hover:bg-gray-100'}`}>
                          <Eye size={15} />
                        </button>
                        <button type="button" onClick={() => { setEditingPost(post); setFormOpen(post.kind); }} title="Edit" className={`rounded p-1.5 transition-colors ${isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-500 hover:bg-gray-100'}`}>
                          <Pencil size={15} />
                        </button>
                        <button type="button" onClick={() => void handleToggleStatus(post)} title={post.postStatus === 'open' ? 'Close post' : 'Reopen post'} className={`rounded p-1.5 transition-colors ${isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-500 hover:bg-gray-100'}`}>
                          {post.postStatus === 'open' ? <XCircle size={15} /> : <RotateCcw size={15} />}
                        </button>
                        <button type="button" onClick={() => void handleDelete(post)} title="Delete" className={`rounded p-1.5 transition-colors ${isDark ? 'text-red-400 hover:bg-red-500/10' : 'text-red-500 hover:bg-red-50'}`}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grid h-full min-h-0 grid-cols-3 gap-3">
                {/* Plain block stacking, not CSS grid, for this list
                    column — a grid's "auto" row-sizing pass measures
                    nested-flex content by min-content rather than actual
                    rendered height (the same bug was found and fixed in
                    PulsePage's and Applications' detail layouts: rows
                    collapsed and overlapped). Column widths and the aside
                    styling below (borders, padding, no dark: variants)
                    intentionally match /feed's renderDetailSplitView. */}

                {/* Column 1: Post Cards */}
                <div className="min-h-0 space-y-1.5 overflow-y-auto pr-1">
                  {filteredPosts.map((post) => {
                    const isSelected = selectedPostId === post.id;
                    const metrics = metricsByPostId[post.id] ?? zeroMetrics;
                    const displayTitle = post.kind === 'hotlist' && post.candidateName
                      ? `${post.title || 'Available Consultant'} — ${post.candidateName}`
                      : (post.title || 'Job Opportunity');
                    const locationText = post.kind === 'job' ? post.location : post.locations.join(', ');

                    return (
                      <div
                        key={post.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedPostId(post.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedPostId(post.id); }}
                        className={`w-full cursor-pointer rounded-md border px-3 py-2.5 text-left transition-colors ${isSelected ? 'border-blue-300 bg-blue-50 dark:border-blue-400/40 dark:bg-blue-500/10' : 'border-transparent bg-white hover:bg-gray-50 dark:bg-[#1E2126] dark:hover:bg-white/5'}`}
                      >
                        <div className="mb-0.5 flex items-center gap-1.5">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${post.kind === 'job' ? (isDark ? 'border-blue-400/30 bg-blue-500/10 text-blue-300' : 'border-blue-200 bg-blue-50 text-blue-700') : (isDark ? 'border-purple-400/30 bg-purple-500/10 text-purple-300' : 'border-purple-200 bg-purple-50 text-purple-700')}`}>
                            {post.kind === 'job' ? <Briefcase size={9} /> : <UserRound size={9} />}
                            {post.kind === 'job' ? 'Job' : 'Hotlist'}
                          </span>
                          <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${post.postStatus === 'open' ? (isDark ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700') : (isDark ? 'border-white/15 bg-white/5 text-[#94A3B8]' : 'border-gray-200 bg-gray-100 text-gray-500')}`}>
                            {post.postStatus === 'open' ? 'Open' : 'Closed'}
                          </span>
                        </div>
                        <p className="truncate text-[13px] font-semibold leading-snug" style={{ color: isDark ? '#FFFFFF' : '#2563EB' }}>{displayTitle}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[#94A3B8]">
                          {post.kind === 'job' && post.company && (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              <Building2 size={10} className="shrink-0 text-gray-400" />
                              {post.company}
                            </span>
                          )}
                          {locationText && (
                            <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              <MapPin size={10} className="shrink-0 text-gray-400" />
                              <span className="truncate">{locationText}</span>
                            </span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2.5 text-[11px] text-gray-400 dark:text-[#94A3B8]">
                          <span className="inline-flex items-center gap-1"><Eye size={10} />{metrics.previewCount}</span>
                          <span className="inline-flex items-center gap-1"><MessageSquare size={10} />{metrics.chatCount}</span>
                          <span className="inline-flex items-center gap-1"><Share2 size={10} />{metrics.shareCount}</span>
                          {post.kind === 'job' && (
                            <span className="inline-flex items-center gap-1"><Users size={10} />{metrics.applicationCount}</span>
                          )}
                          <span className="ml-auto">{formatAgo(post.createdAt)}</span>
                        </div>
                        <div className="mt-2 flex items-center gap-1 border-t border-gray-100 pt-1.5 dark:border-white/10">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setEditingPost(post); setFormOpen(post.kind); }}
                            title="Edit"
                            className={`rounded p-1 transition-colors ${isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-500 hover:bg-gray-100'}`}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void handleToggleStatus(post); }}
                            title={post.postStatus === 'open' ? 'Close post' : 'Reopen post'}
                            className={`rounded p-1 transition-colors ${isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-500 hover:bg-gray-100'}`}
                          >
                            {post.postStatus === 'open' ? <XCircle size={13} /> : <RotateCcw size={13} />}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void handleDelete(post); }}
                            title="Delete"
                            className={`rounded p-1 transition-colors ${isDark ? 'text-red-400 hover:bg-red-500/10' : 'text-red-500 hover:bg-red-50'}`}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Column 2: Post Applicants (job posts only) */}
                <div className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white">
                  {!selectedPost ? (
                    <div className="flex flex-1 items-center justify-center p-6 text-center">
                      <p className="text-[13px] text-gray-400">Select a post to see applicants</p>
                    </div>
                  ) : selectedPost.kind !== 'job' ? (
                    <div className="flex flex-1 items-center justify-center p-6 text-center">
                      <p className="text-[13px] text-gray-400">Applicants aren&apos;t tracked for hotlist posts</p>
                    </div>
                  ) : (
                    <>
                      <div className="border-b border-gray-100 p-4">
                        <div className="relative">
                          <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            type="text"
                            value={applicantSearchQuery}
                            onChange={(e) => setApplicantSearchQuery(e.target.value)}
                            placeholder="Search applicants..."
                            className="w-full rounded-md border border-gray-200 bg-white py-1.5 pl-7 pr-2 text-[12px] text-gray-700 outline-none focus:border-blue-300"
                          />
                        </div>
                      </div>
                      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-4">
                        {applicationsLoading ? (
                          <div className="flex items-center justify-center py-10"><LogoSpinner size={18} /></div>
                        ) : applications.length === 0 ? (
                          <p className="p-3 text-center text-[12px] text-gray-400">No applications yet</p>
                        ) : filteredApplications.length === 0 ? (
                          <p className="p-3 text-center text-[12px] text-gray-400">No matching applicants</p>
                        ) : (
                          filteredApplications.map((app) => {
                            const isAppSelected = selectedApplicationId === app.id;
                            return (
                              <button
                                key={app.id}
                                type="button"
                                onClick={() => setSelectedApplicationId(app.id)}
                                className={`block w-full rounded-md border px-2.5 py-2 text-left transition-colors ${isAppSelected ? 'border-blue-300 bg-blue-50' : 'border-transparent bg-gray-50 hover:bg-gray-100'}`}
                              >
                                <div className="flex items-start justify-between gap-1.5">
                                  <p className="min-w-0 truncate text-[12px] font-semibold text-gray-900">{app.candidate_name || 'Unnamed candidate'}</p>
                                  <span className={`shrink-0 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${APPLICATION_STATUS_STYLES[app.status] ?? APPLICATION_STATUS_STYLES.submitted}`}>
                                    {APPLICATION_STATUS_LABELS[app.status] ?? app.status}
                                  </span>
                                </div>
                                {app.candidate_email && <p className="truncate text-[10px] text-gray-400">{app.candidate_email}</p>}
                                {app.ai_score !== null && (
                                  <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[9px] font-semibold text-purple-700">
                                    <Sparkles size={8} strokeWidth={2.5} />
                                    {app.ai_score}/100
                                  </span>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </>
                  )}
                </div>

                {/* Column 3: Post Application detail panel */}
                <aside className="flex min-h-0 flex-col rounded-lg border border-gray-200 bg-white">
                  {!selectedApplication ? (
                    <div className="flex flex-1 items-center justify-center p-6 text-center">
                      <p className="text-[13px] text-gray-400">Select an applicant to review</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start gap-2.5 border-b border-gray-100 p-4">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-semibold text-gray-900">{selectedApplication.candidate_name || 'Unnamed candidate'}</p>
                          {(selectedApplication.candidate_email || selectedApplication.candidate_phone) && (
                            <p className="truncate text-[12px] text-gray-500">
                              {selectedApplication.candidate_email}{selectedApplication.candidate_email && selectedApplication.candidate_phone ? ' · ' : ''}{selectedApplication.candidate_phone}
                            </p>
                          )}
                          <span className={`mt-1 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${APPLICATION_STATUS_STYLES[selectedApplication.status] ?? APPLICATION_STATUS_STYLES.submitted}`}>
                            {APPLICATION_STATUS_LABELS[selectedApplication.status] ?? selectedApplication.status}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedApplicationId(null)}
                          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
                          aria-label="Close"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                        {selectedApplication.ai_summary && (
                          <div>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">AI Summary</p>
                            <p className="text-[13px] leading-relaxed text-gray-700">{selectedApplication.ai_summary}</p>
                          </div>
                        )}

                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Screening Video</p>
                          {selectedApplicationHasAnsweredTurn ? (
                            <ScreeningSubmissionModal
                              embedded
                              applicationId={selectedApplication.id}
                              turns={selectedApplicationTurns}
                              onClose={() => {}}
                              showToast={showToast}
                            />
                          ) : (
                            <p className="text-[12px] text-gray-400">No screening recorded yet.</p>
                          )}
                        </div>

                        <div>
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Resume</p>
                          {selectedApplication.resume_url ? (
                            <iframe src={selectedApplication.resume_url} className="h-[400px] w-full rounded-md border border-gray-200 bg-white" title="Resume" />
                          ) : (
                            <p className="text-[12px] text-gray-400">No resume on file.</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 border-t border-gray-100 p-3">
                        <button
                          type="button"
                          disabled={chatBusyId === selectedApplication.id}
                          onClick={() => void handleApplicantChat(selectedApplication.id)}
                          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-gray-50 text-[12px] font-semibold text-gray-600 transition-colors hover:bg-gray-100 disabled:opacity-50"
                        >
                          {chatBusyId === selectedApplication.id ? <LogoSpinner size={14} /> : <MessageSquare size={14} />}
                          Chat
                        </button>
                        {selectedApplicationCanDecide && (
                          <>
                            {selectedApplicationScreeningSubmitted && (
                              <button
                                type="button"
                                disabled={decisionBusyId === selectedApplication.id}
                                onClick={() => void handleQualify(selectedApplication.id)}
                                className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-600 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                              >
                                {decisionBusyId === selectedApplication.id ? <LogoSpinner size={14} /> : <Check size={14} />}
                                Qualify
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={decisionBusyId === selectedApplication.id}
                              onClick={() => void handleReject(selectedApplication.id)}
                              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-red-200 bg-red-50 text-[12px] font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
                            >
                              {decisionBusyId === selectedApplication.id ? <LogoSpinner size={14} /> : <XCircle size={14} />}
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </aside>
              </div>
            )}
          </div>
        </div>
      </main>

      {formOpen && (
        <PostFormModal
          kind={formOpen}
          existingPost={editingPost}
          initialPasteText={seedPasteText}
          onClose={() => { setFormOpen(null); setEditingPost(null); setSeedPasteText(undefined); }}
          onSaved={() => { setFormOpen(null); setEditingPost(null); setSeedPasteText(undefined); void loadPosts(); }}
          showToast={showToast}
        />
      )}

      {previewPost && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => setPreviewPost(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="my-post-preview-title"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-white/10 dark:bg-[#20242a]"
          >
            <div className="flex items-start gap-2.5 border-b border-gray-100 p-4 dark:border-white/10">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300">
                <Eye size={16} />
              </span>
              <h2 id="my-post-preview-title" className="min-w-0 flex-1 truncate text-[15px] font-semibold text-gray-900 dark:text-slate-100">
                {previewPost.title || (previewPost.kind === 'hotlist' ? 'Available Consultant' : 'Job Opportunity')}
              </h2>
              <button
                type="button"
                onClick={() => setPreviewPost(null)}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10"
                aria-label="Close preview"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-700 dark:text-slate-300">
                {previewPost.postContent || 'No post content available.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
