import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Radar, RefreshCw, User, Briefcase, MapPin, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, XCircle, Zap,
  Search, Target, Loader2, Users, Check, Clock,
  Eye, EyeOff, Sparkles, ExternalLink, Info, Power, Save, Pencil,
  Bookmark, BookmarkCheck, PenLine, Ban, X, ArrowUpRight,
  FileText, Activity, Download,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { supabase } from '../lib/supabase';
import { triggerProfileEmbedding } from '../lib/embeddings';
import { getMatchHealthPercent } from '../lib/match-health';
import { useAuth } from '../contexts/AuthContext';
import type { Profile, ResumeFile, ActivityLog, EducationEntry, ExperienceEntry } from '../types/database';

interface RadarMatchResult {
  id: string;
  profile_id: string;
  job_source: string;
  job_id: string;
  final_average_score: number;
  score_breakdown: Record<string, { score: number; candidate_value: string; job_value: string; rule: string } | number>;
  ai_notes: string;
  disqualified: boolean;
  disqualify_reason: string | null;
  created_at: string;
}

interface JobInfo {
  id: string;
  job_title: string | null;
  company_name: string | null;
  location: string | null;
  job_url: string | null;
  job_description?: string | null;
  post_content?: string | null;
  platform?: string | null;
}

type EditableMatchProfile = Profile & {
  work_authorization?: string | null;
  relocation_open?: boolean | null;
};

type SortField = 'score' | 'date' | 'profile';
type SortDir = 'asc' | 'desc';

type SourceTab = 'all' | 'job_boards' | 'social_groups' | 'chat_groups' | 'others';

const JOB_BOARD_SOURCES = new Set(['linkedin', 'dice', 'indeed', 'monster', 'careerbuilder']);
const SOCIAL_GROUP_PLATFORMS = new Set(['facebook', 'linkedin']);
const CHAT_GROUP_PLATFORMS = new Set(['whatsapp']);
const LIVE_MATCH_COOLDOWN_KEY = 'radar_live_match_cooldowns';

const EMPTY_EXPERIENCE: ExperienceEntry = {
  company: '',
  title: '',
  location: '',
  start_date: '',
  end_date: '',
  current: false,
  description: '',
};

const EMPTY_EDUCATION: EducationEntry = {
  institution: '',
  degree: '',
  field: '',
  start_year: '',
  end_year: '',
  gpa: '',
};

type PipelineStep = 'idle' | 'matching' | 'done';

interface WatchSchedule {
  id: string;
  account_id: string;
  profile_id: string | null;
  external_job_post_id?: string | null;
  boards: string[];
  frequency: 'hourly' | 'daily' | 'twice_daily' | 'weekly';
  is_active: boolean;
  last_run_at: string | null;
  run_status: 'idle' | 'scraping' | 'matching' | 'completed' | 'error';
  created_at: string;
  updated_at: string;
}

interface HotlistRow { profile_id: string; created_at: string | null; }

const DEFAULT_WATCH_BOARDS = ['linkedin', 'dice', 'indeed', 'monster'];
const HOTLIST_RETENTION_DAYS = 15;

function isHotlistEligible(profile: Profile): boolean {
  const createdAt = profile.created_at ? new Date(profile.created_at) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return true;
  const ageDays = (Date.now() - createdAt.getTime()) / 86_400_000;
  return ageDays <= HOTLIST_RETENTION_DAYS;
}

export default function RadarPage() {
  const { account, user, subscription, refreshAccount } = useAuth();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [hotlistRows, setHotlistRows] = useState<HotlistRow[]>([]);
  const [hotlistProfileIds, setHotlistProfileIds] = useState<Set<string>>(new Set());
  const [sidebarTab, setSidebarTab] = useState<'hotlist' | 'all'>('hotlist');
  const [candidateQuery, setCandidateQuery] = useState('');
  const [results, setResults] = useState<RadarMatchResult[]>([]);
  const [jobMap, setJobMap] = useState<Map<string, JobInfo>>(new Map());
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const [pipelineStep, setPipelineStep] = useState<PipelineStep>('idle');
  const [pipelineDetail, setPipelineDetail] = useState('');
  const [pipelineProgress, setPipelineProgress] = useState({ current: 0, total: 0 });
  const abortRef = useRef(false);
  const scanStateKey = 'radar_scan_state';

  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(searchParams.get('profileId'));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedScoreKeys, setExpandedScoreKeys] = useState<Set<string>>(new Set());
  const [reviewedMap, setReviewedMap] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem('radar_reviewed') ?? '{}');
    } catch { return {}; }
  });
  const hideDisqualified = false;
  const [sourceTab, setSourceTab] = useState<SourceTab>('all');
  const [jobSearchQuery, setJobSearchQuery] = useState('');
  const [previewResult, setPreviewResult] = useState<RadarMatchResult | null>(null);
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());
  const [savingJobId, setSavingJobId] = useState<string | null>(null);
  const [queuedJobIds, setQueuedJobIds] = useState<Set<string>>(new Set());
  const [queuingJobId, setQueuingJobId] = useState<string | null>(null);
  const [disqualifyingJobId, setDisqualifyingJobId] = useState<string | null>(null);
  const [liveMatchCooldowns, setLiveMatchCooldowns] = useState<Record<string, number>>({});
  const sortField: SortField = 'score';
  const sortDir: SortDir = 'desc';

  // Account-level watch settings
  const [globalWatch, setGlobalWatch] = useState<WatchSchedule | null>(null);
  const [savingWatch, setSavingWatch] = useState(false);
  const isPaidPlan = subscription?.status === 'active' && (subscription.plan_amount_usd ?? 0) > 0;

  // Candidate details tabs
  const [detailTab, setDetailTab] = useState<'profile' | 'docs' | 'activity'>('profile');
  const [profileDocs, setProfileDocs] = useState<ResumeFile[]>([]);
  const [profileActivity, setProfileActivity] = useState<ActivityLog[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [savingProfileFields, setSavingProfileFields] = useState(false);
  const [profileForm, setProfileForm] = useState({
    target_role: '',
    priority_skills: '',
    core_skills: '',
    years_experience: '',
    visa_status: '',
    work_authorization: '',
    work_type: '',
    preferred_locations: '',
    desired_salary_min: '',
    desired_salary_max: '',
    relocation_open: false,
  });
  const [profileExperience, setProfileExperience] = useState<ExperienceEntry[]>([]);
  const [profileEducation, setProfileEducation] = useState<EducationEntry[]>([]);
  const [matchPage, setMatchPage] = useState(1);

  // Boards to scrape

  useEffect(() => {
    if (account?.id) {
      loadData();
      loadHotlist();
      loadGlobalWatchSchedule();
      // Recover from interrupted scan — results are already persisted by the edge function
      try {
        const saved = localStorage.getItem(scanStateKey);
        if (saved) {
          const state = JSON.parse(saved);
          if (state.running) {
            localStorage.removeItem(scanStateKey);
          }
        }
      } catch {}
    }
  }, [account?.id]);

  // Poll for watch status updates when running
  useEffect(() => {
    const hasRunning = globalWatch?.run_status === 'scraping' || globalWatch?.run_status === 'matching';
    if (!hasRunning || !account?.id) return;
    const interval = setInterval(() => {
      loadGlobalWatchSchedule();
    }, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalWatch?.run_status, account?.id]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LIVE_MATCH_COOLDOWN_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, number>;
      if (parsed && typeof parsed === 'object') setLiveMatchCooldowns(parsed);
    } catch {
      setLiveMatchCooldowns({});
    }
  }, []);

  useEffect(() => {
    if (!selectedProfileId && profiles.length > 0) {
      const urlProfileId = searchParams.get('profileId');
      const match = urlProfileId ? profiles.find(p => p.id === urlProfileId) : null;
      const mostRecent = [...profiles].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      const hotlistMostRecent = [...profiles]
        .filter(p => hotlistProfileIds.has(p.id))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      setSelectedProfileId(match ? match.id : hotlistMostRecent?.id ?? mostRecent?.id ?? profiles[0].id);
    }
  }, [profiles, selectedProfileId, searchParams, hotlistProfileIds]);

  useEffect(() => {
    if (selectedProfileId) {
      loadProfileDocs(selectedProfileId);
      loadProfileActivity(selectedProfileId);
      setMatchPage(1);
      setIsEditingProfile(false);
    } else {
      setProfileDocs([]);
      setProfileActivity([]);
      setIsEditingProfile(false);
    }
  }, [selectedProfileId]);

  useEffect(() => {
    const selected = profiles.find(p => p.id === selectedProfileId) as EditableMatchProfile | undefined;
    if (!selected) {
      setProfileForm({
        target_role: '',
        priority_skills: '',
        core_skills: '',
        years_experience: '',
        visa_status: '',
        work_authorization: '',
        work_type: '',
        preferred_locations: '',
        desired_salary_min: '',
        desired_salary_max: '',
        relocation_open: false,
      });
      setProfileExperience([]);
      setProfileEducation([]);
      return;
    }

    setProfileForm({
      target_role: selected.target_role ?? '',
      priority_skills: selected.priority_skills ?? '',
      core_skills: selected.core_skills ?? '',
      years_experience: selected.years_experience != null ? String(selected.years_experience) : '',
      visa_status: selected.visa_status ?? '',
      work_authorization: selected.work_authorization ?? '',
      work_type: selected.work_type ?? '',
      preferred_locations: selected.preferred_locations ?? '',
      desired_salary_min: selected.desired_salary_min != null ? String(selected.desired_salary_min) : '',
      desired_salary_max: selected.desired_salary_max != null ? String(selected.desired_salary_max) : '',
      relocation_open: Boolean(selected.relocation_open),
    });
    setProfileExperience(Array.isArray(selected.experience) ? selected.experience : []);
    setProfileEducation(Array.isArray(selected.education) ? selected.education : []);
  }, [selectedProfileId, profiles]);

  function updateProfileField(
    field: keyof typeof profileForm,
    value: string | boolean,
  ) {
    setProfileForm(prev => ({ ...prev, [field]: value }));
  }

  function updateExperienceField(index: number, field: keyof ExperienceEntry, value: string | boolean) {
    setProfileExperience(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function updateEducationField(index: number, field: keyof EducationEntry, value: string) {
    setProfileEducation(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function addExperienceRow() {
    setProfileExperience(prev => [...prev, { ...EMPTY_EXPERIENCE }]);
  }

  function removeExperienceRow(index: number) {
    setProfileExperience(prev => prev.filter((_, i) => i !== index));
  }

  function addEducationRow() {
    setProfileEducation(prev => [...prev, { ...EMPTY_EDUCATION }]);
  }

  function removeEducationRow(index: number) {
    setProfileEducation(prev => prev.filter((_, i) => i !== index));
  }

  async function saveProfileForMatching(profileId: string) {
    setSavingProfileFields(true);
    const updatePayload = {
      target_role: profileForm.target_role.trim(),
      priority_skills: profileForm.priority_skills.trim(),
      core_skills: profileForm.core_skills.trim(),
      years_experience: profileForm.years_experience.trim() ? Number(profileForm.years_experience.trim()) : null,
      visa_status: profileForm.visa_status.trim(),
      work_authorization: profileForm.work_authorization.trim(),
      work_type: profileForm.work_type.trim(),
      preferred_locations: profileForm.preferred_locations.trim(),
      desired_salary_min: profileForm.desired_salary_min.trim() ? Number(profileForm.desired_salary_min.trim()) : null,
      desired_salary_max: profileForm.desired_salary_max.trim() ? Number(profileForm.desired_salary_max.trim()) : null,
      relocation_open: profileForm.relocation_open,
      experience: profileExperience,
      education: profileEducation,
    };

    const { data, error } = await supabase
      .from('profiles')
      .update(updatePayload as unknown as Record<string, unknown>)
      .eq('id', profileId)
      .select('*')
      .single();

    if (error || !data) {
      showToast('Failed to update candidate details', 'error');
      setSavingProfileFields(false);
      return;
    }

    setProfiles(prev => prev.map(p => (p.id === profileId ? (data as Profile) : p)));
    triggerProfileEmbedding(profileId);
    showToast('Profile updated and vector refresh started', 'success');
    setSavingProfileFields(false);
  }

  async function loadProfileDocs(profileId: string) {
    setDocsLoading(true);
    const { data } = await supabase
      .from('resume_files')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false });
    setProfileDocs(data ?? []);
    setDocsLoading(false);
  }

  async function loadProfileActivity(profileId: string) {
    setActivityLoading(true);
    const { data } = await supabase
      .from('activity_logs')
      .select('*')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(50);
    setProfileActivity(data ?? []);
    setActivityLoading(false);
  }

  async function loadGlobalWatchSchedule() {
    if (!account?.id) return;
    const { data, error } = await supabase
      .from('watch_schedules')
      .select('*')
      .eq('account_id', account.id)
      .is('profile_id', null)
      .is('external_job_post_id', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      showToast('Failed to load watch settings', 'error');
      return;
    }

    if (data) {
      const normalizedFrequency = isPaidPlan
        ? data.frequency
        : 'daily';

      if (!isPaidPlan && data.frequency !== 'daily') {
        await supabase.from('watch_schedules').update({ frequency: 'daily' }).eq('id', data.id);
      }

      setGlobalWatch({ ...data, frequency: normalizedFrequency });
      return;
    }

    const { data: created, error: createError } = await supabase
      .from('watch_schedules')
      .insert({
        account_id: account.id,
        profile_id: null,
        boards: DEFAULT_WATCH_BOARDS,
        frequency: 'daily',
        is_active: true,
      })
      .select('*')
      .single();

    if (createError) {
      showToast('Failed to initialize watch settings', 'error');
      return;
    }

    if (created) setGlobalWatch(created as WatchSchedule);
  }

  async function updateGlobalWatch(patch: Partial<WatchSchedule>) {
    if (!globalWatch?.id) return;
    setSavingWatch(true);
    const { data, error } = await supabase
      .from('watch_schedules')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', globalWatch.id)
      .select('*')
      .single();
    setSavingWatch(false);

    if (error) {
      showToast('Failed to update watch settings', 'error');
      return;
    }
    if (data) setGlobalWatch(data as WatchSchedule);
  }

  async function loadHotlist() {
    if (!account?.id) {
      setHotlistRows([]);
      setHotlistProfileIds(new Set());
      return;
    }

    const { data } = await supabase.from('hotlist').select('profile_id, created_at').eq('account_id', account.id).order('created_at', { ascending: false });
    const rows = (data ?? []) as HotlistRow[];
    setHotlistRows(rows);

    const profileIds = rows.map((row) => row.profile_id).filter(Boolean);
    const nextIds = new Set<string>();

    if (profileIds.length > 0) {
      const { data: profileRows } = await supabase.from('profiles').select('id, created_at').in('id', profileIds);
      const profileMap = new Map((profileRows ?? []).map((profile) => [profile.id, profile]));
      for (const row of rows) {
        const profile = profileMap.get(row.profile_id);
        if (profile && isHotlistEligible(profile as Profile)) nextIds.add(row.profile_id);
      }
    }

    setHotlistProfileIds(nextIds);
  }

  async function loadResultsOnly() {
    const [radarRes, matchScoresRes] = await Promise.all([
      supabase.from('radar_match_results').select('*').order('created_at', { ascending: false }),
      supabase.from('job_match_scores').select('*').order('created_at', { ascending: false }),
    ]);

    const normalizedScores: RadarMatchResult[] = (matchScoresRes.data ?? []).map((s: Record<string, unknown>) => {
      let job_id = '';
      let job_source = '';
      if (s.linkedin_job_id) { job_id = s.linkedin_job_id as string; job_source = 'linkedin'; }
      else if (s.dice_job_id) { job_id = s.dice_job_id as string; job_source = 'dice'; }
      else if (s.indeed_job_id) { job_id = s.indeed_job_id as string; job_source = 'indeed'; }
      else if (s.monster_job_id) { job_id = s.monster_job_id as string; job_source = 'monster'; }
      else if (s.careerbuilder_job_id) { job_id = s.careerbuilder_job_id as string; job_source = 'careerbuilder'; }
      else if (s.external_job_post_id) { job_id = s.external_job_post_id as string; job_source = 'external'; }
      else if (s.social_job_id) { job_id = s.social_job_id as string; job_source = 'social'; }

      return {
        id: s.id as string,
        profile_id: s.profile_id as string,
        job_source,
        job_id,
        final_average_score: (s.score as number) ?? 0,
        score_breakdown: {},
        ai_notes: (s.summary as string) ?? '',
        disqualified: false,
        disqualify_reason: null,
        created_at: s.created_at as string,
      };
    }).filter((r: RadarMatchResult) => r.job_id);

    const radarResults: RadarMatchResult[] = radarRes.data ?? [];
    const seen = new Set<string>();
    const combined: RadarMatchResult[] = [];
    for (const r of radarResults) {
      const key = `${r.profile_id}:${r.job_id}`;
      if (!seen.has(key)) { seen.add(key); combined.push(r); }
    }
    for (const r of normalizedScores) {
      const key = `${r.profile_id}:${r.job_id}`;
      if (!seen.has(key)) { seen.add(key); combined.push(r); }
    }

    setResults(combined);
    await loadJobDetails(combined);
  }

  async function loadData() {
    setLoading(true);
    try {
      const [profilesRes, radarRes, matchScoresRes] = await Promise.all([
        supabase.from('profiles').select('*').order('candidate_name'),
        supabase.from('radar_match_results').select('*').order('created_at', { ascending: false }),
        supabase.from('job_match_scores').select('*').order('created_at', { ascending: false }),
      ]);

      if (profilesRes.data) setProfiles(profilesRes.data);

      // Normalize job_match_scores into RadarMatchResult shape
      const normalizedScores: RadarMatchResult[] = (matchScoresRes.data ?? []).map((s: Record<string, unknown>) => {
        let job_id = '';
        let job_source = '';
        if (s.linkedin_job_id) { job_id = s.linkedin_job_id as string; job_source = 'linkedin'; }
        else if (s.dice_job_id) { job_id = s.dice_job_id as string; job_source = 'dice'; }
        else if (s.indeed_job_id) { job_id = s.indeed_job_id as string; job_source = 'indeed'; }
        else if (s.monster_job_id) { job_id = s.monster_job_id as string; job_source = 'monster'; }
        else if (s.careerbuilder_job_id) { job_id = s.careerbuilder_job_id as string; job_source = 'careerbuilder'; }
        else if (s.external_job_post_id) { job_id = s.external_job_post_id as string; job_source = 'external'; }
        else if (s.social_job_id) { job_id = s.social_job_id as string; job_source = 'social'; }

        return {
          id: s.id as string,
          profile_id: s.profile_id as string,
          job_source,
          job_id,
          final_average_score: (s.score as number) ?? 0,
          score_breakdown: {},
          ai_notes: (s.summary as string) ?? '',
          disqualified: false,
          disqualify_reason: null,
          created_at: s.created_at as string,
        };
      }).filter((r: RadarMatchResult) => r.job_id);

      // Merge radar results + job_match_scores, deduplicating by job_id+profile_id
      const radarResults: RadarMatchResult[] = radarRes.data ?? [];
      const seen = new Set<string>();
      const combined: RadarMatchResult[] = [];

      for (const r of radarResults) {
        const key = `${r.profile_id}:${r.job_id}`;
        if (!seen.has(key)) { seen.add(key); combined.push(r); }
      }
      for (const r of normalizedScores) {
        const key = `${r.profile_id}:${r.job_id}`;
        if (!seen.has(key)) { seen.add(key); combined.push(r); }
      }

      setResults(combined);
      await loadJobDetails(combined);
    } catch {
      showToast('Failed to load radar data', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadJobDetails(matches: RadarMatchResult[]) {
    const linkedinIds = matches.filter(m => m.job_source === 'linkedin').map(m => m.job_id);
    const diceIds = matches.filter(m => m.job_source === 'dice').map(m => m.job_id);
    const indeedIds = matches.filter(m => m.job_source === 'indeed').map(m => m.job_id);
    const monsterIds = matches.filter(m => m.job_source === 'monster').map(m => m.job_id);
    const careerbuilderIds = matches.filter(m => m.job_source === 'careerbuilder').map(m => m.job_id);
    const externalIds = matches.filter(m => m.job_source === 'external').map(m => m.job_id);
    const socialIds = matches.filter(m => m.job_source === 'social').map(m => m.job_id);

    const map = new Map<string, JobInfo>();

    if (linkedinIds.length) {
      const { data } = await supabase
        .from('linkedin_jobs')
        .select('id, job_title, company_name, location, job_url, job_description')
        .in('id', linkedinIds);
      data?.forEach(j => map.set(j.id, j));
    }
    if (diceIds.length) {
      const { data } = await supabase
        .from('dice_jobs')
        .select('id, job_title, company_name, location, job_url, job_description')
        .in('id', diceIds);
      data?.forEach(j => map.set(j.id, j));
    }
    if (indeedIds.length) {
      const { data } = await supabase
        .from('indeed_jobs')
        .select('id, job_title, company_name, location_display, job_url, job_description')
        .in('id', indeedIds);
      data?.forEach(j => map.set(j.id, { id: j.id, job_title: j.job_title, company_name: j.company_name, location: j.location_display, job_url: j.job_url, job_description: j.job_description }));
    }
    if (monsterIds.length) {
      const { data } = await supabase
        .from('monster_jobs')
        .select('id, job_title, company_name, location_display, apply_url, job_description')
        .in('id', monsterIds);
      data?.forEach(j => map.set(j.id, { id: j.id, job_title: j.job_title, company_name: j.company_name, location: j.location_display, job_url: j.apply_url, job_description: j.job_description }));
    }
    if (careerbuilderIds.length) {
      const { data } = await supabase
        .from('careerbuilder_jobs')
        .select('id, job_title, company_name, location_display, job_url, job_description')
        .in('id', careerbuilderIds);
      data?.forEach(j => map.set(j.id, { id: j.id, job_title: j.job_title, company_name: j.company_name, location: j.location_display, job_url: j.job_url, job_description: j.job_description }));
    }
    if (externalIds.length) {
      const { data } = await supabase
        .from('external_job_posts')
        .select('id, title, company, location, raw_description')
        .in('id', externalIds);
      data?.forEach(j => map.set(j.id, { id: j.id, job_title: j.title, company_name: j.company, location: j.location, job_url: null, job_description: j.raw_description }));
    }
    if (socialIds.length) {
      const { data } = await supabase
        .from('social_jobs')
        .select('id, job_title, company_name, location, post_url, job_description, platform, post_content')
        .in('id', socialIds);
      data?.forEach(j => map.set(j.id, { id: j.id, job_title: j.job_title, company_name: j.company_name, location: j.location, job_url: j.post_url, job_description: j.job_description, platform: j.platform, post_content: j.post_content }));
    }

    setJobMap(map);
  }

  function handleExpand(resultId: string, isCurrentlyExpanded: boolean) {
    if (isCurrentlyExpanded) {
      setExpandedId(null);
    } else {
      setExpandedId(resultId);
      const updated = { ...reviewedMap, [resultId]: Date.now() };
      setReviewedMap(updated);
      try { localStorage.setItem('radar_reviewed', JSON.stringify(updated)); } catch {}
    }
  }

  function formatTimeAgo(ts: number): string {
    const diff = nowTick - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function formatCooldown(ms: number): string {
    if (ms <= 0) return '0m';
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.ceil((ms % (1000 * 60 * 60)) / (1000 * 60));
    if (hours <= 0) return `${minutes}m`;
    return `${hours}h ${minutes}m`;
  }

  const selectedCooldownAt = selectedProfileId ? (liveMatchCooldowns[selectedProfileId] ?? 0) : 0;
  const cooldownRemainingMs = Math.max(0, selectedCooldownAt + (24 * 60 * 60 * 1000) - Date.now());
  const isLiveMatchCooldownActive = !isPaidPlan && cooldownRemainingMs > 0;

  function stampLiveMatchCooldown(profileId: string) {
    const next = { ...liveMatchCooldowns, [profileId]: Date.now() };
    setLiveMatchCooldowns(next);
    try {
      localStorage.setItem(LIVE_MATCH_COOLDOWN_KEY, JSON.stringify(next));
    } catch {
      // no-op if storage is unavailable
    }
  }

  async function runRadarScan() {
    if (!account?.id) return;
    if (!selectedProfileId) {
      showToast('Select a candidate to run Live Match', 'error');
      return;
    }
    if (isLiveMatchCooldownActive) {
      showToast('Live Match is available once every 24 hours on free plans', 'error');
      return;
    }

    abortRef.current = false;
    setScanning(true);
    localStorage.setItem(scanStateKey, JSON.stringify({ running: true, startedAt: Date.now() }));

    const targetProfiles = profiles.filter(p => p.id === selectedProfileId);

    if (targetProfiles.length === 0) {
      showToast('No active profiles to scan', 'error');
      setScanning(false);
      localStorage.removeItem(scanStateKey);
      return;
    }

    if (!isPaidPlan) {
      stampLiveMatchCooldown(selectedProfileId);
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token ?? supabaseKey;

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'Apikey': supabaseKey,
    };

    // ── Match against existing jobs (streamed in batches) ────────────────────
    setPipelineStep('matching');
    setPipelineDetail('Analyzing jobs...');
    setPipelineProgress({ current: 0, total: 0 });

    let totalNewMatches = 0;

    for (let i = 0; i < targetProfiles.length; i++) {
      if (abortRef.current) break;
      const profile = targetProfiles[i];
      setPipelineDetail(`Matching ${profile.candidate_name} against jobs...`);

      try {
        const response = await fetch(
          `${supabaseUrl}/functions/v1/radar-match`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ profile_id: profile.id, account_id: account.id }),
          }
        );

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          console.error(`Radar match failed for ${profile.candidate_name}:`, errData);
          if (response.status === 402) {
            showToast(errData.error || 'Insufficient credits. Please top up your account.', 'error');
            cleanup();
            return;
          }
          continue;
        }

        const contentType = response.headers.get('content-type') ?? '';

        if (contentType.includes('text/plain')) {
          // Streaming response — read line by line
          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const msg = JSON.parse(line);
                if (msg.type === 'batch') {
                  totalNewMatches += (msg.matched ?? 0);
                  setPipelineProgress({ current: msg.progress ?? 0, total: msg.total_jobs ?? 0 });
                  setPipelineDetail(`Matching ${profile.candidate_name} — ${msg.total_so_far} match${msg.total_so_far === 1 ? '' : 'es'} so far...`);
                  if (msg.matched > 0) {
                    await loadResultsOnly();
                  }
                } else if (msg.type === 'done') {
                  // final message for this profile
                }
              } catch { /* skip malformed lines */ }
            }
          }
        } else {
          // Non-streaming fallback (e.g. "No jobs found" JSON responses)
          const matchData = await response.json();
          totalNewMatches += (matchData.matched ?? 0);
          if (matchData.matched > 0) {
            await loadResultsOnly();
          }
        }
      } catch (err) {
        console.error(`Radar match error for ${profile.candidate_name}:`, err);
      }
    }

    if (abortRef.current) { cleanup(); return; }

    await refreshAccount();

    if (totalNewMatches > 0) {
      setPipelineStep('done');
      setPipelineDetail('');
      showToast(`Found ${totalNewMatches} match${totalNewMatches === 1 ? '' : 'es'} from recent jobs`, 'success');
      await loadResultsOnly();
    } else {
      setPipelineStep('done');
      setPipelineDetail('');
      showToast('No matches found right now. Job Watch will keep checking hotlist candidates automatically.', 'success');
    }
    cleanup();
  }

  function cleanup() {
    setScanning(false);
    setPipelineStep('idle');
    setPipelineDetail('');
    setPipelineProgress({ current: 0, total: 0 });
    localStorage.removeItem(scanStateKey);
  }

  function abortScan() {
    abortRef.current = true;
    showToast('Aborting scan...', 'error');
  }

  async function addToSubmissionQueue(result: RadarMatchResult) {
    const job = jobMap.get(result.job_id);
    if (!job || !result.profile_id) return;
    setSavingJobId(result.job_id);
    const boardMap: Record<string, string> = { linkedin: 'LinkedIn', dice: 'Dice', indeed: 'Indeed', monster: 'Monster', careerbuilder: 'CareerBuilder', external: 'External' };
    const { error } = await supabase.from('wishlisted_jobs').insert({
      profile_id: result.profile_id,
      job_title: job.job_title ?? 'Untitled',
      company: job.company_name ?? 'Unknown',
      board: boardMap[result.job_source] ?? result.job_source,
      location: job.location ?? '',
      job_url: job.job_url ?? null,
      source_job_id: result.job_id,
      status: 'New',
    });
    if (error) {
      showToast('Failed to add to submission queue', 'error');
    } else {
      setSavedJobIds(prev => new Set([...prev, result.job_id]));
      showToast(`Added "${job.job_title}" to submission queue`);
    }
    setSavingJobId(null);
  }

  async function addToResumeAIQueue(result: RadarMatchResult) {
    const job = jobMap.get(result.job_id);
    if (!job || !result.profile_id) return;
    setQueuingJobId(result.job_id);
    try {
      const { data: existing } = await supabase
        .from('wishlisted_jobs')
        .select('id, resume_ai_queued')
        .eq('profile_id', result.profile_id)
        .eq('source_job_id', result.job_id)
        .maybeSingle();

      if (existing) {
        if (!existing.resume_ai_queued) {
          await supabase.from('wishlisted_jobs').update({ resume_ai_queued: true }).eq('id', existing.id);
        }
      } else {
        const boardMap: Record<string, string> = { linkedin: 'LinkedIn', dice: 'Dice', indeed: 'Indeed', monster: 'Monster', careerbuilder: 'CareerBuilder', external: 'External' };
        await supabase.from('wishlisted_jobs').insert({
          profile_id: result.profile_id,
          job_title: job.job_title ?? 'Untitled',
          company: job.company_name ?? 'Unknown',
          board: boardMap[result.job_source] ?? result.job_source,
          location: job.location ?? '',
          job_url: job.job_url ?? null,
          source_job_id: result.job_id,
          status: 'New',
          resume_ai_queued: true,
        });
      }
      setQueuedJobIds(prev => new Set([...prev, result.job_id]));
      showToast(`Added to Resume AI Queue`);
    } catch {
      showToast('Failed to add to Resume AI Queue', 'error');
    }
    setQueuingJobId(null);
  }

  async function disqualifyResult(result: RadarMatchResult) {
    setDisqualifyingJobId(result.job_id);
    // Update in radar_match_results if it exists there
    const { error: radarErr } = await supabase
      .from('radar_match_results')
      .update({ disqualified: true, disqualify_reason: 'Manually disqualified by user' })
      .eq('profile_id', result.profile_id)
      .eq('job_id', result.job_id);

    // Also update local state regardless (may be from job_match_scores)
    if (!radarErr || radarErr.code === 'PGRST116') {
      setResults(prev => prev.map(r =>
        r.profile_id === result.profile_id && r.job_id === result.job_id
          ? { ...r, disqualified: true, disqualify_reason: 'Manually disqualified by user' }
          : r
      ));
      showToast('Job moved to disqualified');
    } else {
      showToast('Failed to disqualify', 'error');
    }
    setDisqualifyingJobId(null);
  }

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const profileResults = results
    .filter(r => !selectedProfileId || r.profile_id === selectedProfileId)
    .filter(r => !hideDisqualified || !r.disqualified)
    .filter(r => r.final_average_score >= 70)
    .filter(r => new Date(r.created_at).getTime() >= sevenDaysAgo);

  const getSourceCategory = (r: { job_source: string; job_id: string }): SourceTab => {
    if (JOB_BOARD_SOURCES.has(r.job_source)) return 'job_boards';
    if (r.job_source === 'social') {
      const job = jobMap.get(r.job_id);
      const platform = job?.platform?.toLowerCase() ?? '';
      if (CHAT_GROUP_PLATFORMS.has(platform)) return 'chat_groups';
      if (SOCIAL_GROUP_PLATFORMS.has(platform)) return 'social_groups';
      return 'others';
    }
    return 'others';
  };

  const filteredResults = profileResults
    .filter(r => {
      if (sourceTab === 'all') return true;
      return getSourceCategory(r) === sourceTab;
    })
    .filter(r => {
      if (!jobSearchQuery.trim()) return true;
      const q = jobSearchQuery.toLowerCase();
      const job = jobMap.get(r.job_id);
      if (!job) return false;
      return (job.job_title ?? '').toLowerCase().includes(q)
        || (job.company_name ?? '').toLowerCase().includes(q)
        || (job.location ?? '').toLowerCase().includes(q)
        || r.job_source.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortField) {
        case 'score': return (a.final_average_score - b.final_average_score) * dir;
        case 'date': return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
        case 'profile': {
          const pA = profiles.find(p => p.id === a.profile_id)?.candidate_name ?? '';
          const pB = profiles.find(p => p.id === b.profile_id)?.candidate_name ?? '';
          return pA.localeCompare(pB) * dir;
        }
        default: return 0;
      }
    });

  const MATCH_PAGE_SIZE = 10;
  const totalMatchPages = Math.max(1, Math.ceil(filteredResults.length / MATCH_PAGE_SIZE));
  const paginatedResults = filteredResults.slice((matchPage - 1) * MATCH_PAGE_SIZE, matchPage * MATCH_PAGE_SIZE);

  function getScoreColor(score: number) {
    if (score >= 80) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
    if (score >= 60) return 'text-sky-600 bg-sky-50 border-sky-200';
    if (score >= 40) return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-red-600 bg-red-50 border-red-200';
  }

  function getScoreBg(score: number) {
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 60) return 'bg-sky-500';
    if (score >= 40) return 'bg-amber-500';
    return 'bg-red-500';
  }

  const benchProfiles = profiles.filter(p => p.bench_stage !== 'Placed' && p.bench_stage !== 'Lost');
  const hotlistProfiles = profiles.filter(p => hotlistProfileIds.has(p.id));
  const sidebarProfiles = (sidebarTab === 'all' ? benchProfiles : hotlistProfiles).filter(p => {
    const q = candidateQuery.toLowerCase();
    if (!q) return true;
    return p.candidate_name.toLowerCase().includes(q) || (p.target_role ?? '').toLowerCase().includes(q);
  }).sort((a, b) => {
    const da = new Date(b.created_at || '').getTime();
    const db = new Date(a.created_at || '').getTime();
    return da - db;
  });

  if (loading) {
    return (
      <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
        <AppNav />
        <div className="flex-1 flex items-center justify-center">
          <LogoSpinner size={32} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100 font-sans overflow-hidden">
      <AppNav />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Full-width Search Header */}
      <div className="bg-white border-b border-gray-200 px-5 h-[44px] flex items-center gap-2.5 shrink-0">
        <div className="flex-1 relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search candidates or jobs by name, title, company, location..."
            value={jobSearchQuery}
            onChange={(e) => { setJobSearchQuery(e.target.value); setCandidateQuery(e.target.value); setMatchPage(1); }}
            className="w-full pl-8 pr-8 py-2 text-xs border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-shadow"
          />
          {jobSearchQuery && (
            <button onClick={() => { setJobSearchQuery(''); setCandidateQuery(''); }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* ── COL 1: Candidates Sidebar ──────────────────────────────────── */}
        <div className="w-[260px] flex-shrink-0 hidden lg:flex flex-col overflow-hidden bg-white border-r border-gray-200 min-h-0">
          <div className="h-[44px] flex items-center px-3 border-b border-gray-200 shrink-0">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">Candidates</h3>
          </div>
          <div className="px-3 py-2 border-b border-gray-100 shrink-0">
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              {(['hotlist', 'all'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setSidebarTab(tab)}
                  className={`flex-1 text-[11px] font-semibold py-1.5 rounded-md transition-all text-center ${
                    sidebarTab === tab
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab === 'hotlist' ? 'Hotlist' : 'All Bench'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {sidebarProfiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <User size={18} className="text-gray-300" />
                <p className="text-xs text-gray-400">{sidebarTab === 'hotlist' ? 'No hotlisted candidates' : 'No candidates found'}</p>
              </div>
            ) : (
              <>
                {sidebarProfiles.map(profile => {
                  const isSelected = selectedProfileId === profile.id;
                  const matchedCount = results.filter(r => r.profile_id === profile.id && !r.disqualified && r.final_average_score >= 70).length;
                  const healthScore = getMatchHealthPercent(profile);
                  const healthTone = healthScore === 0
                    ? { chip: 'bg-gray-50 text-gray-500', label: 'Health' }
                    : healthScore < 60
                    ? { chip: 'bg-red-50 text-red-700', label: 'Health' }
                    : healthScore < 80
                    ? { chip: 'bg-amber-50 text-amber-700', label: 'Health' }
                    : { chip: 'bg-emerald-50 text-emerald-700', label: 'Health' };
                  const matchedTone = matchedCount === 0
                    ? 'bg-gray-50 text-gray-500'
                    : 'bg-violet-50 text-violet-700';
                  return (
                    <button
                      key={profile.id}
                      onClick={() => setSelectedProfileId(isSelected ? null : profile.id)}
                      className={`w-full text-left px-4 py-3 border-b border-gray-50 transition-all ${
                        isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50 border-l-2 border-l-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isSelected ? 'bg-blue-100' : 'bg-gray-100'}`}>
                          <User size={13} className={isSelected ? 'text-blue-600' : 'text-gray-400'} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-[12px] font-semibold truncate leading-tight ${isSelected ? 'text-blue-900' : 'text-gray-800'}`}>
                            {profile.candidate_name}
                          </p>
                          <p className="text-[10px] text-gray-400 truncate mt-0.5">{profile.target_role || 'No target role'}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${matchedTone}`}>
                              Matched <span className="ml-0.5 text-[10px] font-bold">{matchedCount}</span>
                            </span>
                            <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-semibold ${healthTone.chip}`}>
                              {healthTone.label} <span className="ml-0.5 text-[10px] font-bold">{healthScore}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* ── Main Content ────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* Content area */}
        <div className="flex-1 flex overflow-hidden min-h-0">

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* ── COL 2: Candidate Details ───────────────────────────────────── */}
          {selectedProfileId && (() => {
            const profile = profiles.find(p => p.id === selectedProfileId);
            if (!profile) return null;
            return (
              <div className="w-[340px] flex-shrink-0 border-r border-slate-200 overflow-hidden bg-slate-50/50 flex flex-col">
                {/* Col 2 Header */}
                <div className="sticky top-0 z-10 bg-white border-b border-slate-200">
                  <div className="px-3 h-[44px] flex items-center justify-between border-b border-slate-100">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">Details</h3>
                    {detailTab === 'profile' && (
                      <button
                        onClick={() => setIsEditingProfile(prev => !prev)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 transition-colors"
                        title={isEditingProfile ? 'Close edit mode' : 'Edit profile fields'}
                      >
                        <Pencil size={11} />
                        {isEditingProfile ? 'Close' : 'Edit'}
                      </button>
                    )}
                  </div>
                  <div className="px-3 py-2">
                    <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                      {(['profile', 'docs', 'activity'] as const).map(tab => (
                        <button
                          key={tab}
                          onClick={() => setDetailTab(tab)}
                          className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold rounded-md transition-all ${
                            detailTab === tab
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          {tab === 'profile' && 'Profile'}
                          {tab === 'docs' && 'Docs'}
                          {tab === 'activity' && 'Activity'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Col 2 Body */}
                <div className={`flex-1 p-2.5 ${detailTab === 'profile' && !isEditingProfile ? 'overflow-hidden' : 'overflow-y-auto'}`}>
                {/* ── Profile Tab ── */}
                {detailTab === 'profile' && (
                  <div className={isEditingProfile ? 'space-y-2.5' : 'h-full flex flex-col gap-2'}>
                    {(() => {
                      const hasText = (value: string | null | undefined) => Boolean(value && value.trim().length > 0);
                      const completionPct = getMatchHealthPercent({
                        target_role: profileForm.target_role,
                        years_experience: profileForm.years_experience,
                        visa_status: profileForm.visa_status,
                        work_authorization: profileForm.work_authorization,
                        work_type: profileForm.work_type,
                        preferred_locations: profileForm.preferred_locations,
                        desired_salary_min: profileForm.desired_salary_min,
                        desired_salary_max: profileForm.desired_salary_max,
                      });
                      const healthTone = completionPct < 60
                        ? {
                          wrap: 'border-red-200 bg-red-50',
                          title: 'text-red-600',
                          score: 'text-red-700',
                          helper: 'text-red-600',
                          message: 'This candidate is not getting the right matches. Get at least 80% for good matches.',
                        }
                        : completionPct < 80
                        ? {
                          wrap: 'border-amber-200 bg-amber-50',
                          title: 'text-amber-700',
                          score: 'text-amber-700',
                          helper: 'text-amber-700',
                          message: 'Matches can improve. Push this profile to 80%+ for stronger results.',
                        }
                        : {
                          wrap: 'border-emerald-200 bg-emerald-50',
                          title: 'text-emerald-700',
                          score: 'text-emerald-700',
                          helper: 'text-emerald-700',
                          message: 'Great profile health. This candidate is set up for high quality matches.',
                        };
                      const createdAt = new Date(profile.created_at).getTime();
                      const daysSinceCreated = Number.isFinite(createdAt)
                        ? Math.max(0, Math.floor((Date.now() - createdAt) / (1000 * 60 * 60 * 24)))
                        : 0;
                      const matches70Plus = results.filter(
                        r => r.profile_id === profile.id && !r.disqualified && r.final_average_score >= 70,
                      ).length;

                      const matchFieldRows = [
                        { label: 'Target Role', value: profileForm.target_role },
                        { label: 'Years Exp', value: profileForm.years_experience },
                        { label: 'Visa Status', value: profileForm.visa_status },
                        { label: 'Work Authorization', value: profileForm.work_authorization },
                        { label: 'Work Type', value: profileForm.work_type },
                        { label: 'Preferred Locations', value: profileForm.preferred_locations },
                        { label: 'Min Rate ($/hr)', value: profileForm.desired_salary_min },
                        { label: 'Max Rate ($/hr)', value: profileForm.desired_salary_max },
                        { label: 'Relocation Open', value: profileForm.relocation_open ? 'Yes' : 'No' },
                        { label: 'Priority Skills', value: profileForm.priority_skills },
                      ];

                      return (
                        <>
                          <div className="bg-white rounded-xl border border-slate-200 p-2.5">
                            <div className="grid grid-cols-2 gap-1.5">
                              <div className="rounded-lg border border-slate-200 bg-slate-50 p-1.5">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Days Since Created</p>
                                <p className="mt-0.5 text-sm font-bold text-slate-900">{daysSinceCreated}</p>
                              </div>
                              <div className="rounded-lg border border-slate-200 bg-slate-50 p-1.5">
                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Jobs Matched (70+)</p>
                                <p className="mt-0.5 text-sm font-bold text-slate-900">{matches70Plus}</p>
                              </div>
                            </div>
                          </div>

                          <div className={`rounded-xl border p-2.5 ${healthTone.wrap}`}>
                            <p className={`text-sm font-bold ${healthTone.score}`}>{completionPct}% Match Health</p>
                            <p className={`mt-1 text-[10px] leading-relaxed ${healthTone.helper}`}>
                              {healthTone.message}
                            </p>
                          </div>

                          {!isEditingProfile ? (
                            <div className="bg-white rounded-xl border border-slate-200 p-2.5 flex-1 min-h-0 flex flex-col">
                              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Match Rules</p>
                              <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg flex-1 min-h-0 overflow-y-auto">
                                {matchFieldRows.map((row) => {
                                  const hasValue = hasText(row.value);
                                  const isPrioritySkills = row.label === 'Priority Skills';
                                  const skills = isPrioritySkills
                                    ? row.value.split(',').map(skill => skill.trim()).filter(Boolean)
                                    : [];

                                  return (
                                    <div key={row.label} className="grid grid-cols-[104px_1fr] items-start gap-1.5 px-2 py-1.5">
                                      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide pt-0.5">{row.label}</p>
                                      {!isPrioritySkills ? (
                                        <p className={`text-[11px] font-medium ${hasValue ? 'text-slate-800' : 'text-slate-400 italic'}`}>
                                          {hasValue ? row.value : 'Empty'}
                                        </p>
                                      ) : skills.length > 0 ? (
                                        <div>
                                          <div className="flex flex-wrap gap-0.5">
                                          {skills.map(skill => (
                                            <span key={skill} className="inline-flex items-center rounded-md bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-slate-700">
                                              {skill}
                                            </span>
                                          ))}
                                          </div>
                                        </div>
                                      ) : (
                                        <p className="text-[11px] font-medium text-slate-400 italic">Empty</p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="space-y-2.5 bg-white rounded-xl border border-slate-200 p-2.5">
                                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Match Rules</p>

                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Target Role</label>
                                  <input
                                    value={profileForm.target_role}
                                    onChange={(e) => updateProfileField('target_role', e.target.value)}
                                    placeholder="Ex: Senior Java Developer"
                                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                                  />
                                </div>

                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Priority Skills</label>
                                  <textarea
                                    value={profileForm.priority_skills}
                                    onChange={(e) => updateProfileField('priority_skills', e.target.value)}
                                    placeholder="Comma-separated top skills"
                                    rows={3}
                                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                                  />
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">Years Exp</label>
                                    <input
                                      type="number"
                                      min="0"
                                      value={profileForm.years_experience}
                                      onChange={(e) => updateProfileField('years_experience', e.target.value)}
                                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">Visa Status</label>
                                    <input
                                      value={profileForm.visa_status}
                                      onChange={(e) => updateProfileField('visa_status', e.target.value)}
                                      placeholder="Ex: H1B"
                                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">Work Authorization</label>
                                    <input
                                      value={profileForm.work_authorization}
                                      onChange={(e) => updateProfileField('work_authorization', e.target.value)}
                                      placeholder="Ex: C2C, W2"
                                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">Work Type</label>
                                    <input
                                      value={profileForm.work_type}
                                      onChange={(e) => updateProfileField('work_type', e.target.value)}
                                      placeholder="Remote / Hybrid"
                                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                                    />
                                  </div>
                                </div>

                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">Preferred Locations</label>
                                  <input
                                    value={profileForm.preferred_locations}
                                    onChange={(e) => updateProfileField('preferred_locations', e.target.value)}
                                    placeholder="Ex: Austin, Remote"
                                    className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                                  />
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">Min Rate ($/hr)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      value={profileForm.desired_salary_min}
                                      onChange={(e) => updateProfileField('desired_salary_min', e.target.value)}
                                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">Max Rate ($/hr)</label>
                                    <input
                                      type="number"
                                      min="0"
                                      value={profileForm.desired_salary_max}
                                      onChange={(e) => updateProfileField('desired_salary_max', e.target.value)}
                                      className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                                    />
                                  </div>
                                </div>

                                <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
                                  <input
                                    type="checkbox"
                                    checked={profileForm.relocation_open}
                                    onChange={(e) => updateProfileField('relocation_open', e.target.checked)}
                                    className="w-3.5 h-3.5 rounded border-slate-300"
                                  />
                                  Open to relocation
                                </label>
                              </div>

                              <div className="space-y-2 bg-white rounded-xl border border-slate-200 p-2.5">
                                <div className="flex items-center justify-between">
                                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Work History</p>
                                  <button
                                    onClick={addExperienceRow}
                                    className="text-[10px] font-semibold text-blue-600 hover:text-blue-700"
                                  >
                                    + Add
                                  </button>
                                </div>
                                {profileExperience.length === 0 ? (
                                  <p className="text-[11px] text-slate-400">No work history added yet.</p>
                                ) : (
                                  <div className="space-y-1.5">
                                    {profileExperience.map((exp, idx) => (
                                      <div key={idx} className="rounded-lg border border-slate-100 bg-slate-50 p-2 space-y-1.5">
                                        <div className="grid grid-cols-2 gap-1.5">
                                          <input value={exp.title} onChange={(e) => updateExperienceField(idx, 'title', e.target.value)} placeholder="Title" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                          <input value={exp.company} onChange={(e) => updateExperienceField(idx, 'company', e.target.value)} placeholder="Company" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-1.5">
                                          <input value={exp.start_date} onChange={(e) => updateExperienceField(idx, 'start_date', e.target.value)} placeholder="Start" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                          <input value={exp.current ? '' : exp.end_date} onChange={(e) => updateExperienceField(idx, 'end_date', e.target.value)} placeholder="End" disabled={exp.current} className="rounded-md border border-slate-200 px-2 py-1 text-xs disabled:bg-slate-100" />
                                        </div>
                                        <input value={exp.location} onChange={(e) => updateExperienceField(idx, 'location', e.target.value)} placeholder="Location" className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                        <textarea value={exp.description} onChange={(e) => updateExperienceField(idx, 'description', e.target.value)} rows={2} placeholder="Summary / achievements" className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                        <div className="flex items-center justify-between">
                                          <label className="text-[10px] text-slate-600 flex items-center gap-1.5">
                                            <input type="checkbox" checked={Boolean(exp.current)} onChange={(e) => updateExperienceField(idx, 'current', e.target.checked)} className="w-3 h-3" />
                                            Current role
                                          </label>
                                          <button onClick={() => removeExperienceRow(idx)} className="text-[10px] font-semibold text-red-500 hover:text-red-600">Remove</button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <div className="space-y-2 bg-white rounded-xl border border-slate-200 p-2.5">
                                <div className="flex items-center justify-between">
                                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">Education</p>
                                  <button
                                    onClick={addEducationRow}
                                    className="text-[10px] font-semibold text-blue-600 hover:text-blue-700"
                                  >
                                    + Add
                                  </button>
                                </div>
                                {profileEducation.length === 0 ? (
                                  <p className="text-[11px] text-slate-400">No education added yet.</p>
                                ) : (
                                  <div className="space-y-1.5">
                                    {profileEducation.map((edu, idx) => (
                                      <div key={idx} className="rounded-lg border border-slate-100 bg-slate-50 p-2 space-y-1.5">
                                        <div className="grid grid-cols-2 gap-1.5">
                                          <input value={edu.degree} onChange={(e) => updateEducationField(idx, 'degree', e.target.value)} placeholder="Degree" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                          <input value={edu.field} onChange={(e) => updateEducationField(idx, 'field', e.target.value)} placeholder="Field" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                        </div>
                                        <input value={edu.institution} onChange={(e) => updateEducationField(idx, 'institution', e.target.value)} placeholder="Institution" className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                        <div className="grid grid-cols-3 gap-1.5">
                                          <input value={edu.start_year} onChange={(e) => updateEducationField(idx, 'start_year', e.target.value)} placeholder="Start" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                          <input value={edu.end_year} onChange={(e) => updateEducationField(idx, 'end_year', e.target.value)} placeholder="End" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                          <input value={edu.gpa ?? ''} onChange={(e) => updateEducationField(idx, 'gpa', e.target.value)} placeholder="GPA" className="rounded-md border border-slate-200 px-2 py-1 text-xs" />
                                        </div>
                                        <div className="flex justify-end">
                                          <button onClick={() => removeEducationRow(idx)} className="text-[10px] font-semibold text-red-500 hover:text-red-600">Remove</button>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              <button
                                onClick={() => saveProfileForMatching(profile.id)}
                                disabled={savingProfileFields}
                                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-bold text-white rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 hover:from-blue-700 hover:to-sky-600 disabled:opacity-50 transition-colors"
                              >
                                {savingProfileFields ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                                {savingProfileFields ? 'Saving...' : 'Save Profile & Refresh Vector'}
                              </button>
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* ── Docs Tab ── */}
                {detailTab === 'docs' && (
                  <div>
                    {docsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 size={18} className="animate-spin text-slate-400" />
                      </div>
                    ) : profileDocs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <FileText size={24} className="text-slate-300 mb-1.5" />
                        <p className="text-xs text-slate-500">No documents uploaded</p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {profileDocs.map(doc => (
                          <div key={doc.id} className="flex items-center gap-2 bg-white rounded-lg border border-slate-100 p-2 hover:border-slate-200 transition-colors">
                            <FileText size={14} className="text-slate-400 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-medium text-slate-800 truncate">{doc.file_name}</p>
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                {doc.category && <span className="capitalize">{doc.category}</span>}
                                {doc.category && ' · '}
                                {new Date(doc.created_at).toLocaleDateString()}
                              </p>
                            </div>
                            {doc.file_url && (
                              <a
                                href={doc.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                              >
                                <Download size={13} />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Activity Tab ── */}
                {detailTab === 'activity' && (
                  <div>
                    {activityLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 size={18} className="animate-spin text-slate-400" />
                      </div>
                    ) : profileActivity.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 text-center">
                        <Activity size={24} className="text-slate-300 mb-1.5" />
                        <p className="text-xs text-slate-500">No activity recorded yet</p>
                      </div>
                    ) : (
                      <div className="space-y-0">
                        {profileActivity.map((log, i) => (
                          <div key={log.id} className="relative flex gap-2.5 pb-3">
                            {i < profileActivity.length - 1 && (
                              <div className="absolute left-[7px] top-5 bottom-0 w-px bg-slate-200" />
                            )}
                            <div className="w-[15px] h-[15px] rounded-full bg-slate-100 border-2 border-slate-300 shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-slate-800 leading-snug">{log.description}</p>
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                {log.event_type && <span className="capitalize font-medium">{log.event_type.replace(/_/g, ' ')}</span>}
                                {' · '}
                                {new Date(log.created_at).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                </div>
              </div>
            );
          })()}

          {/* ── COL 3: Match Results ───────────────────────────────────────── */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            {/* Filter Tabs - Sticky Column Header */}
            <div className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
              <div className="flex items-center h-[44px] px-3 gap-3 border-b border-slate-100">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide shrink-0">Matches</h3>
                <div className="hidden md:flex items-center gap-2.5">
                  <button
                    onClick={() => updateGlobalWatch({ is_active: !globalWatch?.is_active })}
                    disabled={!globalWatch || savingWatch}
                    className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full border text-[10px] font-bold transition-colors ${
                      globalWatch?.is_active
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                    title={globalWatch?.is_active ? 'Turn watch off' : 'Turn watch on'}
                  >
                    {savingWatch ? <Loader2 size={11} className="animate-spin" /> : <Power size={11} />}
                    <span>{globalWatch?.is_active ? 'ON' : 'OFF'}</span>
                  </button>
                  {!isPaidPlan && (
                    <div className="relative group">
                      <button
                        type="button"
                        className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors"
                        aria-label="Free plan watch schedule details"
                      >
                        <Info size={11} />
                      </button>
                      <div className="pointer-events-none absolute left-1/2 top-8 z-20 w-72 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <p className="text-[11px] leading-relaxed text-slate-600">
                          Free accounts are limited to only Daily matches. Upgrade your account to setup hourly match schedules
                        </p>
                        <button
                          onClick={() => navigate('/billing')}
                          className="pointer-events-auto mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white shadow-sm hover:opacity-90 transition-opacity"
                          style={{ background: 'linear-gradient(135deg, #2563eb 0%, #0ea5e9 100%)' }}
                        >
                          <ArrowUpRight size={11} />
                          Upgrade now
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex-1" />
                <div className="flex items-center gap-2 shrink-0">
                  {isLiveMatchCooldownActive && (
                    <p className="text-[10px] text-slate-500 whitespace-nowrap">
                      Refresh in {formatCooldown(cooldownRemainingMs)}.{' '}
                      <button
                        onClick={() => navigate('/billing')}
                        className="text-blue-600 hover:text-blue-700 font-semibold"
                      >
                        Upgrade for hourly refresh
                      </button>
                    </p>
                  )}
                  <button
                    onClick={runRadarScan}
                    disabled={scanning || !selectedProfileId || isLiveMatchCooldownActive}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 hover:from-blue-700 hover:via-orange-600 hover:to-yellow-500 disabled:from-slate-300 disabled:via-slate-300 disabled:to-slate-300 disabled:cursor-not-allowed text-white text-[11px] font-bold rounded-lg transition-all shadow-sm"
                  >
                    {scanning ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {scanning ? 'Scanning...' : 'Live Match'}
                  </button>
                </div>
              </div>
              <div className="px-3 py-2">
                <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                  {([
                    { key: 'all' as const, label: 'All', count: profileResults.length },
                    { key: 'job_boards' as const, label: 'Job Boards', count: profileResults.filter(r => JOB_BOARD_SOURCES.has(r.job_source)).length },
                    { key: 'social_groups' as const, label: 'Social', count: profileResults.filter(r => r.job_source === 'social' && SOCIAL_GROUP_PLATFORMS.has(jobMap.get(r.job_id)?.platform?.toLowerCase() ?? '')).length },
                    { key: 'chat_groups' as const, label: 'Chat', count: profileResults.filter(r => r.job_source === 'social' && CHAT_GROUP_PLATFORMS.has(jobMap.get(r.job_id)?.platform?.toLowerCase() ?? '')).length },
                    { key: 'others' as const, label: 'Others', count: profileResults.filter(r => getSourceCategory(r) === 'others').length },
                  ]).map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => { setSourceTab(tab.key); setMatchPage(1); }}
                      className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold rounded-md transition-all ${
                        sourceTab === tab.key
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {tab.label}
                      <span className={`text-[10px] min-w-[16px] px-1 rounded-full font-bold ${
                        sourceTab === tab.key
                          ? 'bg-slate-200 text-slate-700'
                          : 'text-slate-400'
                      }`}>
                        {tab.count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Pipeline Progress */}
              {scanning && pipelineStep !== 'idle' && (
                <div className="border-t border-sky-100 bg-sky-50/70 px-3 py-2">
                  <div className="flex items-center gap-2 text-sky-700">
                    <Target size={12} className="animate-pulse" />
                    <span className="text-[11px] font-semibold">Matching profiles against jobs...</span>
                  </div>
                  {pipelineDetail && <p className="mt-0.5 text-[11px] text-sky-700/90">{pipelineDetail}</p>}
                  {pipelineProgress.total > 0 && (
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-sky-100 rounded-full overflow-hidden">
                        <div className="h-full bg-sky-500 rounded-full transition-all duration-300" style={{ width: `${(pipelineProgress.current / pipelineProgress.total) * 100}%` }} />
                      </div>
                      <span className="text-[10px] text-sky-700 font-medium whitespace-nowrap">{pipelineProgress.current}/{pipelineProgress.total}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Results List */}
            <div className="p-4">
            {filteredResults.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
                <Radar size={48} className="mx-auto text-slate-300 mb-4" />
                <h3 className="text-lg font-medium text-slate-700 mb-2">No match results yet</h3>
                <p className="text-slate-500 text-sm max-w-md mx-auto">
                  Create a watch schedule or click &quot;Live Match&quot; to find and score job matches for this profile.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
            {paginatedResults.map(result => {
              const profile = profiles.find(p => p.id === result.profile_id);
              const job = jobMap.get(result.job_id);
              const isExpanded = expandedId === result.id;

              return (
                <div
                  key={result.id}
                  className={`bg-white rounded-xl border shadow-sm transition-all ${
                    result.disqualified ? 'border-red-200 bg-red-50/30' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <button
                    onClick={() => handleExpand(result.id, isExpanded)}
                    className="w-full px-5 py-4 flex items-center gap-4 text-left"
                  >
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-slate-900 truncate">
                          {job?.job_title ?? 'Unknown Job'}
                        </span>
                        {result.disqualified && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded-full">
                            <XCircle size={10} />
                            DQ
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <User size={12} />
                          {profile?.candidate_name ?? 'Unknown'}
                        </span>
                        {job?.company_name && (
                          <span className="flex items-center gap-1">
                            <Briefcase size={12} />
                            {job.company_name}
                          </span>
                        )}
                        {job?.location && (
                          <span className="flex items-center gap-1">
                            <MapPin size={12} />
                            {job.location}
                          </span>
                        )}
                        <span className="text-slate-400 capitalize">{result.job_source}</span>
                        <span className="flex items-center gap-1 text-slate-400">
                          <Clock size={10} />
                          matched {formatTimeAgo(new Date(result.created_at).getTime())}
                        </span>
                        {reviewedMap[result.id] && (
                          <span className="text-slate-400 italic">
                            reviewed {formatTimeAgo(reviewedMap[result.id])}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action icons + Expand toggle */}
                    <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => { e.stopPropagation(); addToSubmissionQueue(result); }}
                        disabled={savedJobIds.has(result.job_id) || savingJobId === result.job_id}
                        className={`p-1.5 rounded-md transition-colors ${
                          savedJobIds.has(result.job_id)
                            ? 'text-blue-600 bg-blue-50'
                            : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'
                        }`}
                        title={savedJobIds.has(result.job_id) ? 'Saved' : 'Save to submissions'}
                      >
                        <Bookmark size={14} className={savedJobIds.has(result.job_id) ? 'fill-current' : ''} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); addToResumeAIQueue(result); }}
                        disabled={queuedJobIds.has(result.job_id) || queuingJobId === result.job_id}
                        className={`p-1.5 rounded-md transition-colors ${
                          queuedJobIds.has(result.job_id)
                            ? 'text-teal-600 bg-teal-50'
                            : 'text-slate-400 hover:text-teal-600 hover:bg-teal-50'
                        }`}
                        title={queuedJobIds.has(result.job_id) ? 'Queued for Resume AI' : 'Queue for Resume AI'}
                      >
                        <PenLine size={14} />
                      </button>
                      {!result.disqualified && (
                        <button
                          onClick={(e) => { e.stopPropagation(); disqualifyResult(result); }}
                          disabled={disqualifyingJobId === result.job_id}
                          className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Disqualify"
                        >
                          <XCircle size={14} />
                        </button>
                      )}
                      {job?.job_url && (
                        <a
                          href={job.job_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                          title="Open job posting"
                        >
                          <ExternalLink size={14} />
                        </a>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleExpand(result.id, isExpanded); }}
                        className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors ml-0.5"
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  </button>

                  {/* AI Summary strip with score — shown in collapsed state */}
                  {!isExpanded && (
                    <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-gradient-to-r from-blue-50 via-sky-50 to-blue-50 border border-blue-100 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        {result.ai_notes ? (
                          <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">
                            <Sparkles size={11} className="inline mr-1 text-blue-500 -mt-0.5" />
                            {result.ai_notes}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-400 italic">No AI summary available</p>
                        )}
                      </div>
                      <div className={`flex-shrink-0 w-12 h-12 rounded-lg border flex flex-col items-center justify-center ${getScoreColor(result.final_average_score)}`}>
                        <span className="text-base font-bold leading-none">{result.final_average_score}</span>
                        <span className="text-[9px] opacity-70">score</span>
                      </div>
                    </div>
                  )}

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="px-5 pb-5 pt-0 border-t border-slate-100">
                      {/* AI Assessment — full in expanded */}
                      {result.ai_notes && (
                        <div className="mt-4 px-4 py-3 rounded-xl bg-gradient-to-r from-blue-50 via-sky-50/60 to-blue-50 border border-blue-100">
                          <div className="flex items-start gap-2">
                            <Sparkles size={13} className="text-blue-500 mt-0.5 flex-shrink-0" />
                            <p className="text-sm text-slate-700 leading-relaxed">{result.ai_notes}</p>
                          </div>
                        </div>
                      )}

                      {result.disqualified && result.disqualify_reason && (
                        <div className="mt-3 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                          <AlertTriangle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-red-700">{result.disqualify_reason}</p>
                        </div>
                      )}

                      {/* Score breakdown — collapsible items */}
                      <div className="mt-4">
                        <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Score Breakdown</h4>
                        <div className="space-y-1">
                          {Object.entries(result.score_breakdown).map(([key, value]) => {
                            const isDetailed = typeof value === 'object' && value !== null && 'score' in value;
                            const score = isDetailed ? (value as { score: number }).score : (value as number);
                            const detail = isDetailed ? value as { score: number; candidate_value: string; job_value: string; rule: string } : null;
                            const itemKey = `${result.id}__${key}`;
                            const isItemOpen = expandedScoreKeys.has(itemKey);
                            return (
                              <div key={key} className="rounded-lg border border-slate-100 overflow-hidden">
                                <button
                                  onClick={() => {
                                    setExpandedScoreKeys(prev => {
                                      const next = new Set(prev);
                                      if (next.has(itemKey)) next.delete(itemKey);
                                      else next.add(itemKey);
                                      return next;
                                    });
                                  }}
                                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 transition-colors text-left"
                                >
                                  <span className="text-xs font-medium text-slate-700 capitalize flex-1">{key.replace(/_/g, ' ')}</span>
                                  <div className="flex items-center gap-2">
                                    <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full ${getScoreBg(score)}`}
                                        style={{ width: `${score}%` }}
                                      />
                                    </div>
                                    <span className={`text-[11px] font-bold min-w-[36px] text-right ${score >= 80 ? 'text-emerald-600' : score >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{score}/100</span>
                                    {detail && (
                                      <ChevronDown size={12} className={`text-slate-400 transition-transform ${isItemOpen ? 'rotate-180' : ''}`} />
                                    )}
                                  </div>
                                </button>
                                {isItemOpen && detail && (
                                  <div className="px-3 pb-3 pt-0 bg-slate-50 border-t border-slate-100">
                                    <div className="grid grid-cols-2 gap-2 mt-2">
                                      <div>
                                        <span className="text-[10px] font-medium text-slate-400 uppercase">Candidate</span>
                                        <p className="text-[11px] text-slate-600 mt-0.5">{detail.candidate_value || 'Not specified'}</p>
                                      </div>
                                      <div>
                                        <span className="text-[10px] font-medium text-slate-400 uppercase">Job Requirement</span>
                                        <p className="text-[11px] text-slate-600 mt-0.5">{detail.job_value || 'Not specified'}</p>
                                      </div>
                                    </div>
                                    <div className="mt-2 pt-2 border-t border-slate-200">
                                      <span className="text-[10px] font-medium text-slate-400 uppercase">Reasoning</span>
                                      <p className="text-[11px] text-slate-500 mt-0.5 italic">{detail.rule}</p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          {savedJobIds.has(result.job_id) ? (
                            <span title="Added to Submission" className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-green-50 text-green-500 cursor-default">
                              <BookmarkCheck size={15} />
                            </span>
                          ) : (
                            <button
                              onClick={() => addToSubmissionQueue(result)}
                              disabled={savingJobId === result.job_id}
                              title="Submission Queue"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:bg-blue-50 hover:text-blue-600 transition-colors disabled:opacity-50"
                            >
                              {savingJobId === result.job_id ? <Loader2 size={15} className="animate-spin" /> : <Bookmark size={15} />}
                            </button>
                          )}

                          {queuedJobIds.has(result.job_id) ? (
                            <span title="Queued for Resume AI" className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-500 cursor-default">
                              <CheckCircle2 size={15} />
                            </span>
                          ) : (
                            <button
                              onClick={() => addToResumeAIQueue(result)}
                              disabled={queuingJobId === result.job_id}
                              title="Resume AI Queue"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:bg-violet-50 hover:text-violet-600 transition-colors disabled:opacity-50"
                            >
                              {queuingJobId === result.job_id ? <Loader2 size={15} className="animate-spin" /> : <PenLine size={15} />}
                            </button>
                          )}

                          {job?.job_url && (
                            <a
                              href={job.job_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Apply Link"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:bg-sky-50 hover:text-sky-600 transition-colors"
                            >
                              <ExternalLink size={15} />
                            </a>
                          )}

                          <button
                            onClick={() => setPreviewResult(result)}
                            title="Preview Job"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                          >
                            <Eye size={15} />
                          </button>
                        </div>

                        {!result.disqualified && (
                          <button
                            onClick={() => disqualifyResult(result)}
                            disabled={disqualifyingJobId === result.job_id}
                            title="Disqualify"
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-50"
                          >
                            {disqualifyingJobId === result.job_id ? <Loader2 size={15} className="animate-spin" /> : <Ban size={15} />}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </div>

        {/* Pagination Footer */}
        {filteredResults.length > MATCH_PAGE_SIZE && (
          <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 py-2 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">
              {(matchPage - 1) * MATCH_PAGE_SIZE + 1}-{Math.min(matchPage * MATCH_PAGE_SIZE, filteredResults.length)} of {filteredResults.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMatchPage(p => Math.max(1, p - 1))}
                disabled={matchPage === 1}
                className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-default transition-colors"
              >
                Prev
              </button>
              <span className="text-[11px] font-medium text-slate-700 px-2">{matchPage}/{totalMatchPages}</span>
              <button
                onClick={() => setMatchPage(p => Math.min(totalMatchPages, p + 1))}
                disabled={matchPage === totalMatchPages}
                className="px-2.5 py-1 text-[11px] font-medium rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-default transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}

        </div> {/* end col3 */}
        </div> {/* end flex wrapper for col2+col3 */}
        </div>
        </div>
      </div>

      {/* Preview Modal */}
      {previewResult && (() => {
        const previewJob = jobMap.get(previewResult.job_id);
        const desc = previewJob?.job_description ?? '';
        return (
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setPreviewResult(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-5 border-b border-gray-100 flex items-start gap-3 shrink-0">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center shrink-0">
                  <Briefcase size={20} className="text-slate-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-bold text-gray-900 text-base leading-tight">{previewJob?.job_title ?? 'Untitled Job'}</h2>
                  <p className="text-sm font-medium mt-0.5 text-blue-600">{previewJob?.company_name ?? 'Unknown Company'}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
                    {previewJob?.location && <span className="flex items-center gap-1 text-xs text-gray-500"><MapPin size={10} />{previewJob.location}</span>}
                    <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full capitalize">{previewResult.job_source}</span>
                  </div>
                </div>
                <button onClick={() => setPreviewResult(null)} className="text-gray-400 hover:text-gray-600 transition-colors shrink-0 p-1">
                  <X size={18} />
                </button>
              </div>

              {/* Score strip */}
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 shrink-0 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                  previewResult.final_average_score >= 80 ? 'bg-emerald-500' :
                  previewResult.final_average_score >= 60 ? 'bg-sky-500' :
                  previewResult.final_average_score >= 40 ? 'bg-amber-500' : 'bg-red-500'
                }`}>
                  {previewResult.final_average_score}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-800">
                    {previewResult.final_average_score >= 80 ? 'Strong Match' :
                     previewResult.final_average_score >= 60 ? 'Medium Match' :
                     previewResult.final_average_score >= 40 ? 'Weak Match' : 'Poor Match'}
                  </p>
                  {previewResult.ai_notes && <p className="text-xs text-gray-500 mt-0.5">{previewResult.ai_notes}</p>}
                </div>
                {previewResult.disqualified && (
                  <span className="text-xs font-semibold bg-red-100 text-red-700 px-2 py-1 rounded-full">Disqualified</span>
                )}
              </div>

              {/* Description */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {previewJob?.post_content && (
                  <div>
                    <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Original Post</h3>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                      {previewJob.post_content.split('\n').filter(l => l.trim()).map((p, i) => (
                        <p key={i} className="text-sm text-gray-700 leading-relaxed">{p}</p>
                      ))}
                    </div>
                  </div>
                )}

                {desc.trim() ? (
                  <div>
                    <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Job Description</h3>
                    {desc.includes('<') && desc.includes('>') ? (
                      <div
                        className="prose prose-sm max-w-none text-gray-700"
                        dangerouslySetInnerHTML={{ __html: desc }}
                      />
                    ) : (
                      <div className="space-y-2">
                        {desc.split('\n').filter(l => l.trim()).map((p, i) => (
                          <p key={i} className="text-sm text-gray-700 leading-relaxed">{p}</p>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 italic">No description available.</p>
                )}

                {/* Score breakdown */}
                {previewResult.score_breakdown && Object.keys(previewResult.score_breakdown).length > 0 && (
                  <div>
                    <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Matching Rules</h3>
                    <div className="space-y-2.5">
                      {Object.entries(previewResult.score_breakdown).map(([key, value]) => {
                        const isDetailed = typeof value === 'object' && value !== null && 'score' in value;
                        const score = isDetailed ? (value as { score: number }).score : (Number(value) || 0);
                        const detail = isDetailed ? value as { score: number; candidate_value: string; job_value: string; rule: string } : null;
                        return (
                          <div key={key} className="bg-gray-50 rounded-lg p-2.5">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs text-gray-600 capitalize flex-1 font-medium">{key.replace(/_/g, ' ')}</span>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${score >= 80 ? 'bg-emerald-100 text-emerald-700' : score >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{score}</span>
                            </div>
                            <div className="h-1 bg-gray-200 rounded-full overflow-hidden mb-1.5">
                              <div className={`h-full rounded-full ${score >= 80 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-400'}`} style={{ width: `${Math.min(score, 100)}%` }} />
                            </div>
                            {detail && (
                              <div className="text-[10px] space-y-0.5">
                                <div className="flex gap-1"><span className="text-gray-400">You:</span><span className="text-gray-600 truncate">{detail.candidate_value || '—'}</span></div>
                                <div className="flex gap-1"><span className="text-gray-400">Job:</span><span className="text-gray-600 truncate">{detail.job_value || '—'}</span></div>
                                <div className="text-gray-400 italic mt-0.5">{detail.rule}</div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-gray-100 flex flex-wrap items-center gap-2 shrink-0">
                {previewJob?.job_url && (
                  <a
                    href={previewJob.job_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    {previewResult.job_source === 'social' ? 'View Post' : 'Apply Now'} <ExternalLink size={13} />
                  </a>
                )}

                {savedJobIds.has(previewResult.job_id) ? (
                  <span className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-green-50 border border-green-200 text-green-600 cursor-default">
                    <BookmarkCheck size={13} /> Added
                  </span>
                ) : (
                  <button
                    onClick={() => addToSubmissionQueue(previewResult)}
                    disabled={savingJobId === previewResult.job_id}
                    className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl border border-gray-200 text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-50"
                  >
                    {savingJobId === previewResult.job_id ? <Loader2 size={13} className="animate-spin" /> : <Bookmark size={13} />}
                    Submission Queue
                  </button>
                )}

                {queuedJobIds.has(previewResult.job_id) ? (
                  <span className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600 cursor-default">
                    <CheckCircle2 size={13} /> Queued
                  </span>
                ) : (
                  <button
                    onClick={() => addToResumeAIQueue(previewResult)}
                    disabled={queuingJobId === previewResult.job_id}
                    className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl border border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100 hover:border-violet-300 transition-all disabled:opacity-50"
                  >
                    {queuingJobId === previewResult.job_id ? <Loader2 size={13} className="animate-spin" /> : <PenLine size={13} />}
                    Resume AI Queue
                  </button>
                )}

                {!previewResult.disqualified && (
                  <button
                    onClick={() => { disqualifyResult(previewResult); setPreviewResult(null); }}
                    disabled={disqualifyingJobId === previewResult.job_id}
                    className="flex items-center gap-1.5 text-sm font-semibold px-4 py-2 rounded-xl border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:border-red-300 transition-all disabled:opacity-50"
                  >
                    <Ban size={13} /> Disqualify
                  </button>
                )}

                <button onClick={() => setPreviewResult(null)} className="ml-auto text-sm text-gray-400 hover:text-gray-600 px-3 py-2 rounded-xl hover:bg-gray-50 transition-colors">
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

