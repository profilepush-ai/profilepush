import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Radar, RefreshCw, User, Briefcase, MapPin, ChevronDown, ChevronUp,
  AlertTriangle, CheckCircle2, XCircle, Zap,
  Search, Target, Loader2, Users, Check, Clock, Plus, Trash2,
  Eye, EyeOff, Calendar, Sparkles, ExternalLink, Pencil,
  Bookmark, BookmarkCheck, PenLine, Ban, X, ArrowUpRight,
  FileText, Activity, Download, GraduationCap, Building2,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Profile, ResumeFile, ActivityLog } from '../types/database';

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

type SortField = 'score' | 'date' | 'profile';
type SortDir = 'asc' | 'desc';

type SourceTab = 'all' | 'job_boards' | 'social_groups' | 'chat_groups' | 'others';

const JOB_BOARD_SOURCES = new Set(['linkedin', 'dice', 'indeed', 'monster', 'careerbuilder']);
const SOCIAL_GROUP_PLATFORMS = new Set(['facebook', 'linkedin']);
const CHAT_GROUP_PLATFORMS = new Set(['whatsapp']);

type PipelineStep = 'idle' | 'matching' | 'done';

interface WatchSchedule {
  id: string;
  account_id: string;
  profile_id: string;
  boards: string[];
  frequency: 'hourly' | 'daily' | 'twice_daily' | 'weekly';
  is_active: boolean;
  last_run_at: string | null;
  run_status: 'idle' | 'scraping' | 'matching' | 'completed' | 'error';
  created_at: string;
  updated_at: string;
}

interface WatchScheduleRun {
  id: string;
  schedule_id: string;
  account_id: string;
  status: 'success' | 'failed' | 'partial' | 'running' | 'error';
  jobs_fetched: number;
  jobs_matched: number;
  boards_searched: string[];
  duration_ms: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

type RadarTab = 'results' | 'watch' | 'history';



export default function RadarPage() {
  const { account, user } = useAuth();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [hotlistProfileIds, setHotlistProfileIds] = useState<Set<string>>(new Set());
  const [sidebarTab, setSidebarTab] = useState<'hotlist' | 'all'>('all');
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
  const [col4Tab, setCol4Tab] = useState<'watch' | 'history'>('watch');
  const [previewResult, setPreviewResult] = useState<RadarMatchResult | null>(null);
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(new Set());
  const [savingJobId, setSavingJobId] = useState<string | null>(null);
  const [queuedJobIds, setQueuedJobIds] = useState<Set<string>>(new Set());
  const [queuingJobId, setQueuingJobId] = useState<string | null>(null);
  const [disqualifyingJobId, setDisqualifyingJobId] = useState<string | null>(null);
  const sortField: SortField = 'score';
  const sortDir: SortDir = 'desc';

  // Watch schedules
  const [radarTab, setRadarTab] = useState<RadarTab>('results');
  const [watchSchedules, setWatchSchedules] = useState<WatchSchedule[]>([]);
  const [showWatchForm, setShowWatchForm] = useState(false);
  const [watchFormProfile, setWatchFormProfile] = useState<string>('');
  const [watchFormBoards, setWatchFormBoards] = useState<Set<string>>(new Set(['linkedin', 'dice', 'indeed']));
  const [watchFormFrequency, setWatchFormFrequency] = useState<'hourly' | 'daily' | 'twice_daily' | 'weekly'>('daily');
  const [savingWatch, setSavingWatch] = useState(false);
  const [scheduleRuns, setScheduleRuns] = useState<WatchScheduleRun[]>([]);
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null);

  // Candidate details tabs
  const [detailTab, setDetailTab] = useState<'matchers' | 'profile' | 'docs' | 'activity'>('matchers');
  const [profileDocs, setProfileDocs] = useState<ResumeFile[]>([]);
  const [profileActivity, setProfileActivity] = useState<ActivityLog[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [showAllSkills, setShowAllSkills] = useState(false);
  const [expandedExpIdx, setExpandedExpIdx] = useState<number | null>(null);
  const [expandedEduIdx, setExpandedEduIdx] = useState<number | null>(null);
  const [matchPage, setMatchPage] = useState(1);

  // Boards to scrape

  useEffect(() => {
    if (account?.id) {
      loadData();
      loadHotlist();
      loadWatchSchedules();
      loadScheduleRuns();
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

  // Poll for schedule status updates when any are actively running
  useEffect(() => {
    const hasRunning = watchSchedules.some(s => s.run_status === 'scraping' || s.run_status === 'matching');
    if (!hasRunning || !account?.id) return;
    const interval = setInterval(() => {
      loadWatchSchedules();
      loadScheduleRuns();
    }, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchSchedules.length, account?.id]);

  useEffect(() => {
    if (!selectedProfileId && profiles.length > 0) {
      const urlProfileId = searchParams.get('profileId');
      const match = urlProfileId ? profiles.find(p => p.id === urlProfileId) : null;
      const mostRecent = [...profiles].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
      setSelectedProfileId(match ? match.id : mostRecent?.id ?? profiles[0].id);
    }
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (selectedProfileId) {
      loadProfileDocs(selectedProfileId);
      loadProfileActivity(selectedProfileId);
      setMatchPage(1);
      setShowAllSkills(false);
      setExpandedExpIdx(null);
      setExpandedEduIdx(null);
    } else {
      setProfileDocs([]);
      setProfileActivity([]);
    }
  }, [selectedProfileId]);

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

  async function loadWatchSchedules() {
    if (!account?.id) return;
    const { data } = await supabase
      .from('watch_schedules')
      .select('*')
      .eq('account_id', account.id)
      .order('created_at', { ascending: false });
    if (data) setWatchSchedules(data);
  }

  async function loadScheduleRuns() {
    if (!account?.id) return;
    const { data } = await supabase
      .from('watch_schedule_runs')
      .select('*')
      .eq('account_id', account.id)
      .order('started_at', { ascending: false })
      .limit(100);
    if (data) setScheduleRuns(data);
  }

  async function createWatchSchedule() {
    if (!account?.id || !watchFormProfile) return;
    setSavingWatch(true);
    const { error } = await supabase.from('watch_schedules').insert({
      account_id: account.id,
      profile_id: watchFormProfile,
      boards: Array.from(watchFormBoards),
      frequency: watchFormFrequency,
    });
    setSavingWatch(false);
    if (error) {
      showToast('Failed to create watch schedule', 'error');
    } else {
      showToast('Watch schedule created', 'success');
      setShowWatchForm(false);
      setWatchFormProfile('');
      setWatchFormBoards(new Set(['linkedin', 'dice', 'indeed']));
      setWatchFormFrequency('daily');
      await loadWatchSchedules();
    }
  }

  async function toggleWatchSchedule(id: string, currentActive: boolean) {
    const { error } = await supabase
      .from('watch_schedules')
      .update({ is_active: !currentActive, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      showToast('Failed to update schedule', 'error');
    } else {
      setWatchSchedules(prev => prev.map(s => s.id === id ? { ...s, is_active: !currentActive } : s));
    }
  }

  async function deleteWatchSchedule(id: string) {
    const { error } = await supabase.from('watch_schedules').delete().eq('id', id);
    if (error) {
      showToast('Failed to delete schedule', 'error');
    } else {
      setWatchSchedules(prev => prev.filter(s => s.id !== id));
      showToast('Schedule deleted', 'success');
    }
  }

  async function runWatchScheduleNow(schedule: WatchSchedule) {
    setRunningScheduleId(schedule.id);
    try {
      if (!schedule.is_active) {
        await supabase.from('watch_schedules').update({ is_active: true }).eq('id', schedule.id);
        setWatchSchedules(prev => prev.map(s => s.id === schedule.id ? { ...s, is_active: true } : s));
      }

      setWatchSchedules(prev => prev.map(s => s.id === schedule.id ? { ...s, run_status: 'scraping' } : s));

      const pollStatus = async () => {
        const { data } = await supabase
          .from('watch_schedules')
          .select('run_status')
          .eq('id', schedule.id)
          .maybeSingle();
        if (data?.run_status && data.run_status !== schedule.run_status) {
          setWatchSchedules(prev => prev.map(s => s.id === schedule.id ? { ...s, run_status: data.run_status } : s));
        }
      };

      const pollInterval = setInterval(pollStatus, 3000);

      const { error: fnError } = await supabase.functions.invoke('job-watch-trigger', {
        body: { schedule_id: schedule.id },
      });

      clearInterval(pollInterval);

      if (fnError) {
        showToast(`Watch run failed: ${fnError.message}`, 'error');
        setWatchSchedules(prev => prev.map(s => s.id === schedule.id ? { ...s, run_status: 'idle' } : s));
      } else {
        setWatchSchedules(prev => prev.map(s => s.id === schedule.id ? { ...s, run_status: 'idle', last_run_at: new Date().toISOString() } : s));
        showToast('Watch run complete! Check results below.', 'success');
        await Promise.all([loadData(), loadScheduleRuns()]);
      }
    } catch (err) {
      showToast(`Failed to run watch: ${(err as Error).message}`, 'error');
      setWatchSchedules(prev => prev.map(s => s.id === schedule.id ? { ...s, run_status: 'idle' } : s));
    } finally {
      setRunningScheduleId(null);
    }
  }

  async function loadHotlist() {
    const { data } = await supabase.from('hotlist').select('profile_id');
    if (data) setHotlistProfileIds(new Set(data.map(h => h.profile_id)));
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

  async function runRadarScan() {
    if (!account?.id) return;
    abortRef.current = false;
    setScanning(true);
    localStorage.setItem(scanStateKey, JSON.stringify({ running: true, startedAt: Date.now() }));

    const targetProfiles = selectedProfileId
      ? profiles.filter(p => p.id === selectedProfileId)
      : profiles.filter(p => p.bench_stage !== 'Placed' && p.bench_stage !== 'Lost');

    if (targetProfiles.length === 0) {
      showToast('No active profiles to scan', 'error');
      setScanning(false);
      localStorage.removeItem(scanStateKey);
      return;
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
                    setRadarTab('results');
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
            setRadarTab('results');
          }
        }
      } catch (err) {
        console.error(`Radar match error for ${profile.candidate_name}:`, err);
      }
    }

    if (abortRef.current) { cleanup(); return; }

    if (totalNewMatches > 0) {
      setPipelineStep('done');
      setPipelineDetail('');
      showToast(`Found ${totalNewMatches} match${totalNewMatches === 1 ? '' : 'es'} from recent jobs`, 'success');
      setRadarTab('results');
      await loadResultsOnly();
    } else {
      setPipelineStep('done');
      setPipelineDetail('');
      showToast(
        "Currently, we don\u2019t have any matching jobs for this profile. This profile is now being continuously monitored by our Job Watch Radar. You\u2019ll receive an alert the moment a 70%+ match is detected. Please try other candidates in the meanwhile.",
        'info'
      );
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
    const da = a.updated_at || a.created_at || '';
    const db = b.updated_at || b.created_at || '';
    return db.localeCompare(da);
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
              <div className="w-[260px] flex-shrink-0 border-r border-slate-200 overflow-hidden bg-slate-50/50 flex flex-col">
                {/* Col 2 Header */}
                <div className="sticky top-0 z-10 bg-white border-b border-slate-200">
                  <div className="px-4 h-[44px] flex items-center">
                    <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">Candidate Details</h3>
                  </div>
                  <div className="px-3 py-2">
                    <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                      {(['matchers', 'profile', 'docs', 'activity'] as const).map(tab => (
                        <button
                          key={tab}
                          onClick={() => setDetailTab(tab)}
                          className={`flex-1 flex items-center justify-center gap-1 px-1.5 py-1.5 text-[10px] font-semibold rounded-md transition-all ${
                            detailTab === tab
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          {tab === 'matchers' && 'Matchers'}
                          {tab === 'profile' && 'Profile'}
                          {tab === 'docs' && 'Docs'}
                          {tab === 'activity' && 'Activity'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Col 2 Body */}
                <div className="flex-1 overflow-y-auto p-4">

                {/* ── Matchers Tab ── */}
                {detailTab === 'matchers' && (
                  <>
                    <div className="mb-3">
                      <h3 className="text-sm font-bold text-slate-900 truncate">{profile.candidate_name}</h3>
                      <span className={`inline-block mt-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                        profile.bench_stage === 'Placed' ? 'bg-emerald-50 text-emerald-700' :
                        profile.bench_stage === 'Sourcing' ? 'bg-blue-50 text-blue-700' :
                        profile.bench_stage === 'Submitted' ? 'bg-orange-50 text-orange-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {profile.bench_stage}
                      </span>
                    </div>

                    <div className="space-y-3">
                      {profile.target_role && (
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Target Role</p>
                          <p className="text-xs text-slate-800">{profile.target_role}</p>
                        </div>
                      )}
                      {profile.years_experience != null && (
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Experience</p>
                          <p className="text-xs text-slate-800">{profile.years_experience} years</p>
                        </div>
                      )}
                      {profile.visa_status && (
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Visa Status</p>
                          <p className="text-xs text-slate-800">{profile.visa_status}</p>
                        </div>
                      )}
                      {profile.work_type && (
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Work Type</p>
                          <p className="text-xs text-slate-800">{profile.work_type}</p>
                        </div>
                      )}
                      {profile.preferred_locations && (
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Preferred Locations</p>
                          <p className="text-xs text-slate-800">{profile.preferred_locations}</p>
                        </div>
                      )}
                      {(profile.desired_salary_min || profile.desired_salary_max) && (
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Hourly Rate</p>
                          <p className="text-xs text-slate-800">
                            ${profile.desired_salary_min ?? '?'} - ${profile.desired_salary_max ?? '?'}/hr
                          </p>
                        </div>
                      )}
                      {profile.notice_period && (
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">Notice Period</p>
                          <p className="text-xs text-slate-800">{profile.notice_period}</p>
                        </div>
                      )}
                    </div>

                    {profile.priority_skills && (
                      <div className="mt-4 pt-3 border-t border-slate-200">
                        <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-1.5">Priority Skills</p>
                        <div className="flex flex-wrap gap-1">
                          {profile.priority_skills.split(',').map((skill, i) => (
                            <span key={i} className="text-[10px] font-semibold bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100">
                              {skill.trim()}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ── Profile Tab ── */}
                {detailTab === 'profile' && (
                  <div className="space-y-4">
                    {/* Personal Info */}
                    <div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Personal Information</p>
                      <div className="space-y-2.5 bg-white rounded-lg border border-slate-100 p-3">
                        <div className="flex items-center gap-2">
                          <User size={12} className="text-slate-400 shrink-0" />
                          <span className="text-xs text-slate-800 font-medium">{profile.candidate_name}</span>
                        </div>
                        {profile.email && (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 font-medium w-[50px] shrink-0">Email</span>
                            <span className="text-xs text-slate-700 truncate">{profile.email}</span>
                          </div>
                        )}
                        {profile.phone && (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 font-medium w-[50px] shrink-0">Phone</span>
                            <span className="text-xs text-slate-700">{profile.phone}</span>
                          </div>
                        )}
                        {(profile.city || profile.state || profile.country) && (
                          <div className="flex items-center gap-2">
                            <MapPin size={12} className="text-slate-400 shrink-0" />
                            <span className="text-xs text-slate-700">
                              {[profile.city, profile.state, profile.country].filter(Boolean).join(', ')}
                            </span>
                          </div>
                        )}
                        {profile.linkedin_url && (
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400 font-medium w-[50px] shrink-0">LinkedIn</span>
                            <a href={profile.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline truncate">View Profile</a>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Work Experience */}
                    {profile.experience && profile.experience.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Work Experience</p>
                        <div className="space-y-2">
                          {profile.experience.map((exp, i) => (
                            <div
                              key={i}
                              className="bg-white rounded-lg border border-slate-100 p-3 cursor-pointer hover:border-slate-200 transition-colors"
                              onClick={() => setExpandedExpIdx(expandedExpIdx === i ? null : i)}
                            >
                              <div className="flex items-start gap-2">
                                <Building2 size={12} className="text-slate-400 mt-0.5 shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-semibold text-slate-900 truncate">{exp.title}</p>
                                  <p className="text-[11px] text-slate-600">{exp.company}</p>
                                  <p className="text-[10px] text-slate-400 mt-0.5">
                                    {exp.start_date} - {exp.current ? 'Present' : exp.end_date}
                                    {exp.location && ` | ${exp.location}`}
                                  </p>
                                  {expandedExpIdx === i && exp.description && (
                                    <p className="text-[11px] text-slate-600 mt-2 leading-relaxed whitespace-pre-line border-t border-slate-100 pt-2">
                                      {exp.description}
                                    </p>
                                  )}
                                </div>
                                <ChevronDown size={12} className={`text-slate-400 shrink-0 mt-0.5 transition-transform ${expandedExpIdx === i ? 'rotate-180' : ''}`} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Education */}
                    {profile.education && profile.education.length > 0 && (
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Education</p>
                        <div className="space-y-2">
                          {profile.education.map((edu, i) => (
                            <div
                              key={i}
                              className="bg-white rounded-lg border border-slate-100 p-3 cursor-pointer hover:border-slate-200 transition-colors"
                              onClick={() => setExpandedEduIdx(expandedEduIdx === i ? null : i)}
                            >
                              <div className="flex items-start gap-2">
                                <GraduationCap size={12} className="text-slate-400 mt-0.5 shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-semibold text-slate-900">{edu.degree} {edu.field && `in ${edu.field}`}</p>
                                  <p className="text-[11px] text-slate-600">{edu.institution}</p>
                                  <p className="text-[10px] text-slate-400 mt-0.5">{edu.start_year} - {edu.end_year}</p>
                                  {expandedEduIdx === i && edu.gpa && (
                                    <p className="text-[11px] text-slate-600 mt-2 border-t border-slate-100 pt-2">
                                      GPA: {edu.gpa}
                                    </p>
                                  )}
                                </div>
                                <ChevronDown size={12} className={`text-slate-400 shrink-0 mt-0.5 transition-transform ${expandedEduIdx === i ? 'rotate-180' : ''}`} />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Core Skills */}
                    {profile.core_skills && (() => {
                      const allSkills = profile.core_skills.split(',').map(s => s.trim()).filter(Boolean);
                      const visibleSkills = showAllSkills ? allSkills : allSkills.slice(0, 5);
                      return (
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">Core Skills</p>
                          <div className="flex flex-wrap gap-1">
                            {visibleSkills.map((skill, i) => (
                              <span key={i} className="text-[10px] font-medium bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                                {skill}
                              </span>
                            ))}
                          </div>
                          {allSkills.length > 5 && (
                            <button
                              onClick={() => setShowAllSkills(!showAllSkills)}
                              className="mt-1.5 text-[10px] font-medium text-blue-600 hover:text-blue-700 transition-colors"
                            >
                              {showAllSkills ? 'Show less' : `+${allSkills.length - 5} more`}
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* ── Docs Tab ── */}
                {detailTab === 'docs' && (
                  <div>
                    {docsLoading ? (
                      <div className="flex items-center justify-center py-12">
                        <Loader2 size={18} className="animate-spin text-slate-400" />
                      </div>
                    ) : profileDocs.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <FileText size={28} className="text-slate-300 mb-2" />
                        <p className="text-xs text-slate-500">No documents uploaded</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {profileDocs.map(doc => (
                          <div key={doc.id} className="flex items-center gap-2.5 bg-white rounded-lg border border-slate-100 p-3 hover:border-slate-200 transition-colors">
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
                      <div className="flex items-center justify-center py-12">
                        <Loader2 size={18} className="animate-spin text-slate-400" />
                      </div>
                    ) : profileActivity.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Activity size={28} className="text-slate-300 mb-2" />
                        <p className="text-xs text-slate-500">No activity recorded yet</p>
                      </div>
                    ) : (
                      <div className="space-y-0">
                        {profileActivity.map((log, i) => (
                          <div key={log.id} className="relative flex gap-3 pb-4">
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
                {/* Col 2 Footer - Action Buttons */}
                <div className="border-t border-slate-200 bg-white p-3 flex flex-col gap-2">
                  <button
                    onClick={() => navigate(`/bench?edit=${profile.id}`)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    <Pencil size={12} />
                    Edit Profile
                  </button>
                  <button
                    onClick={() => navigate(`/bench?profile=${profile.id}`)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                  >
                    <ArrowUpRight size={12} />
                    Open in Bench
                  </button>
                  <button
                    onClick={() => navigate(`/jobs?profile=${profile.id}`)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
                  >
                    <Search size={12} />
                    Go to Job Finder
                  </button>
                </div>
              </div>
            );
          })()}

          {/* ── COL 3: Match Results ───────────────────────────────────────── */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            {/* Pipeline Progress */}
            {scanning && pipelineStep !== 'idle' && (
              <div className="bg-white border-b border-sky-200 px-5 py-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex items-center gap-2 text-sky-600">
                    <Target size={14} className="animate-pulse" />
                    <span className="text-sm font-medium">Matching profiles against jobs...</span>
                  </div>
                </div>
                {pipelineDetail && <p className="text-sm text-slate-600 mb-2">{pipelineDetail}</p>}
                {pipelineProgress.total > 0 && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-sky-500 rounded-full transition-all duration-300" style={{ width: `${(pipelineProgress.current / pipelineProgress.total) * 100}%` }} />
                    </div>
                    <span className="text-xs text-slate-500 font-medium">{pipelineProgress.current}/{pipelineProgress.total}</span>
                  </div>
                )}
              </div>
            )}

            {/* Filter Tabs - Sticky Column Header */}
            <div className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
              <div className="flex items-center h-[44px] px-3 gap-3 border-b border-slate-100">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide shrink-0">Matches</h3>
                <div className="flex-1" />
                <button
                  onClick={runRadarScan}
                  disabled={scanning}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 hover:from-blue-700 hover:via-orange-600 hover:to-yellow-500 disabled:opacity-50 text-white text-[11px] font-bold rounded-lg transition-all shadow-sm shrink-0"
                >
                  {scanning ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {scanning ? 'Scanning...' : 'Live Match'}
                </button>
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

        {/* ── COL 4: Watch & History ──────────────────────────────────────── */}
        <div className="flex-1 min-w-0 hidden xl:flex flex-col border-l border-slate-200 bg-white overflow-hidden">
          {/* Col4 Header */}
          <div className="sticky top-0 z-10 bg-white border-b border-slate-200">
            <div className="px-3 h-[44px] flex items-center justify-between border-b border-slate-100">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">Automation</h3>
              <button
                onClick={() => { setWatchFormProfile(selectedProfileId ?? ''); setShowWatchForm(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 hover:from-blue-700 hover:via-orange-600 hover:to-yellow-500 text-white text-[11px] font-bold rounded-lg transition-all shadow-sm shrink-0"
              >
                <Plus size={12} />
                Watch Schedule
              </button>
            </div>
            <div className="px-3 py-2">
              <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                <button
                  onClick={() => setCol4Tab('watch')}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold rounded-md transition-all ${
                    col4Tab === 'watch'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Schedules
                  {watchSchedules.length > 0 && <span className={`text-[10px] min-w-[16px] px-1 rounded-full font-bold ${col4Tab === 'watch' ? 'bg-slate-200 text-slate-700' : 'text-slate-400'}`}>{watchSchedules.length}</span>}
                </button>
                <button
                  onClick={() => setCol4Tab('history')}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-semibold rounded-md transition-all ${
                    col4Tab === 'history'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  History
                  {scheduleRuns.length > 0 && <span className={`text-[10px] min-w-[16px] px-1 rounded-full font-bold ${col4Tab === 'history' ? 'bg-slate-200 text-slate-700' : 'text-slate-400'}`}>{scheduleRuns.length}</span>}
                </button>
              </div>
            </div>
          </div>

          {/* Col4 Content */}
          <div className="flex-1 overflow-y-auto">
            {col4Tab === 'watch' ? (
              <div className="p-3 space-y-2">
                {watchSchedules.length === 0 ? (
                  <div className="text-center py-8 px-4">
                    <div className="w-10 h-10 mx-auto rounded-full bg-slate-100 flex items-center justify-center mb-3">
                      <Clock size={18} className="text-slate-400" />
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">No schedules yet. Create one to automate radar scans.</p>
                  </div>
                ) : (
                  watchSchedules.map(schedule => {
                    const prof = profiles.find(p => p.id === schedule.profile_id);
                    return (
                      <div key={schedule.id} className={`rounded-lg border p-3 transition-all ${schedule.is_active ? 'border-slate-200 bg-white shadow-sm' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${schedule.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                            <span className="text-[11px] font-semibold text-slate-800 truncate">{prof?.candidate_name ?? 'Unknown'}</span>
                          </div>
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 ${
                            schedule.frequency === 'hourly' ? 'bg-red-50 text-red-600' :
                            schedule.frequency === 'daily' ? 'bg-blue-50 text-blue-600' :
                            schedule.frequency === 'twice_daily' ? 'bg-amber-50 text-amber-600' :
                            'bg-slate-100 text-slate-600'
                          }`}>{schedule.frequency.replace('_', ' ')}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 mb-2 pl-4">{schedule.boards.join(', ')}</p>
                        <div className="flex items-center gap-1 pl-3">
                          {(schedule.run_status === 'scraping' || schedule.run_status === 'matching') ? (
                            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 font-medium">
                              <Loader2 size={10} className="animate-spin" />
                              {schedule.run_status === 'scraping' ? 'Searching...' : 'Matching...'}
                            </span>
                          ) : (
                            <button
                              onClick={() => runWatchScheduleNow(schedule)}
                              disabled={runningScheduleId === schedule.id}
                              className="p-1.5 rounded-md text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
                              title="Run now"
                            >
                              <Zap size={12} />
                            </button>
                          )}
                          <button
                            onClick={() => toggleWatchSchedule(schedule.id, schedule.is_active)}
                            className={`p-1.5 rounded-md transition-colors ${schedule.is_active ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:bg-slate-100'}`}
                            title={schedule.is_active ? 'Pause' : 'Resume'}
                          >
                            {schedule.is_active ? <Eye size={12} /> : <EyeOff size={12} />}
                          </button>
                          <button
                            onClick={() => deleteWatchSchedule(schedule.id)}
                            className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="p-3 space-y-2">
                {scheduleRuns.length === 0 ? (
                  <div className="text-center py-8 px-4">
                    <div className="w-10 h-10 mx-auto rounded-full bg-slate-100 flex items-center justify-center mb-3">
                      <Clock size={18} className="text-slate-400" />
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">Run history will appear here once schedules execute.</p>
                  </div>
                ) : (
                  scheduleRuns.slice(0, 25).map(run => {
                    const schedule = watchSchedules.find(s => s.id === run.schedule_id);
                    const prof = profiles.find(p => p.id === schedule?.profile_id);
                    return (
                      <div key={run.id} className="rounded-lg border border-slate-200 p-3 bg-white shadow-sm">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-semibold text-slate-800 truncate">{prof?.candidate_name ?? 'Unknown'}</span>
                          <span className={`inline-flex items-center gap-0.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                            run.status === 'success' ? 'bg-emerald-50 text-emerald-700' :
                            run.status === 'partial' ? 'bg-amber-50 text-amber-700' :
                            run.status === 'running' ? 'bg-blue-50 text-blue-700' :
                            'bg-red-50 text-red-700'
                          }`}>
                            {run.status === 'running' && <Loader2 size={8} className="animate-spin" />}
                            {run.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-slate-500 mb-1">
                          <span className="tabular-nums">{run.jobs_fetched} fetched</span>
                          <span className="text-blue-600 font-semibold tabular-nums">{run.jobs_matched} matched</span>
                        </div>
                        <p className="text-[9px] text-slate-400">
                          {new Date(run.started_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>

        </div> {/* end flex wrapper for col2+col3+col4 */}
        </div>
        </div>
      </div>

      {/* Watch Schedule Create Modal */}
      {showWatchForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowWatchForm(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-slate-900">Create Watch Schedule</h3>
              <button onClick={() => setShowWatchForm(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <XCircle size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Profile</label>
                <select
                  value={watchFormProfile}
                  onChange={e => setWatchFormProfile(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                >
                  <option value="">Select profile...</option>
                  {profiles.map(p => (
                    <option key={p.id} value={p.id}>{p.candidate_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Frequency</label>
                <select
                  value={watchFormFrequency}
                  onChange={e => setWatchFormFrequency(e.target.value as 'hourly' | 'daily' | 'twice_daily' | 'weekly')}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400"
                >
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="twice_daily">Twice Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Job Boards</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'linkedin', label: 'LinkedIn' },
                    { id: 'dice', label: 'Dice' },
                    { id: 'indeed', label: 'Indeed' },
                    { id: 'monster', label: 'Monster' },
                  ].map(b => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setWatchFormBoards(prev => {
                        const next = new Set(prev);
                        if (next.has(b.id)) next.delete(b.id); else next.add(b.id);
                        return next;
                      })}
                      className={`text-xs px-3 py-2 rounded-lg border font-medium transition-colors ${
                        watchFormBoards.has(b.id)
                          ? 'bg-blue-50 border-blue-300 text-blue-700'
                          : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {watchFormBoards.has(b.id) && <Check size={10} className="inline mr-1" />}
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
              <button onClick={() => setShowWatchForm(false)} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors">
                Cancel
              </button>
              <button
                onClick={createWatchSchedule}
                disabled={!watchFormProfile || watchFormBoards.size === 0 || savingWatch}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
              >
                {savingWatch ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Create Schedule
              </button>
            </div>
          </div>
        </div>
      )}

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

