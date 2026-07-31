import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, ExternalLink, Trash2, CheckCircle2, Circle,
  Users, Bookmark, Mail, Plus, Send,
  Copy, Check, X, User,
  FileText, RotateCcw, ChevronDown, ChevronUp,
  Building2, MapPin, Sparkles, Briefcase,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Profile, WishlistedJob } from '../types/database';

interface MatchScore {
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  optimization_points: string[];
}

interface EmailDraft {
  to: string;
  subject: string;
  body: string;
}

const BOARD_COLORS: Record<string, string> = {
  LinkedIn:      'bg-blue-100 text-blue-700 border-blue-200',
  Dice:          'bg-orange-100 text-orange-700 border-orange-200',
  Indeed:        'bg-violet-100 text-violet-700 border-violet-200',
  CareerBuilder: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  Monster:       'bg-red-100 text-red-700 border-red-200',
  External:      'bg-cyan-100 text-cyan-700 border-cyan-200',
};

const BOARD_TO_COL: Record<string, string> = {
  LinkedIn:      'linkedin_job_id',
  Dice:          'dice_job_id',
  Indeed:        'indeed_job_id',
  Monster:       'monster_job_id',
  CareerBuilder: 'careerbuilder_job_id',
};

const BOARD_TO_COL_NORMALIZED: Record<string, string> = {
  linkedin: 'linkedin_job_id',
  dice: 'dice_job_id',
  indeed: 'indeed_job_id',
  monster: 'monster_job_id',
  careerbuilder: 'careerbuilder_job_id',
};

function normalizeBoard(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function resolveBoardColumn(board: string | null | undefined) {
  return BOARD_TO_COL[board ?? ''] ?? BOARD_TO_COL_NORMALIZED[normalizeBoard(board)];
}

function shouldUseBenchMatch(board: string | null | undefined) {
  const normalized = normalizeBoard(board);
  if (normalized === 'external') return true;
  return !resolveBoardColumn(board);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function scoreColor(score: number) {
  if (score >= 80) return { text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', bar: 'bg-emerald-500' };
  if (score >= 60) return { text: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200', bar: 'bg-amber-500' };
  if (score >= 40) return { text: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200', bar: 'bg-orange-500' };
  return { text: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', bar: 'bg-red-500' };
}

export default function WishlistPage() {
  const navigate = useNavigate();
  const { account } = useAuth();

  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [profileSearch, setProfileSearch] = useState('');
  const [sidebarTab, setSidebarTab] = useState<'hotlist' | 'all'>('hotlist');
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [profileQueueCounts, setProfileQueueCounts] = useState<Record<string, { queued: number; initiated: number }>>({});

  const [jobs, setJobs] = useState<WishlistedJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [selectedJob, setSelectedJob] = useState<WishlistedJob | null>(null);
  const [jobSearch, setJobSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'New' | 'Matched' | 'Submission Initiated'>('All');

  const [matchScores, setMatchScores] = useState<Record<string, MatchScore>>({});
  const [scoringJobId, setScoringJobId] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  const [emailTab, setEmailTab] = useState<'candidate' | 'client'>('client');
  const [emailDrafts, setEmailDrafts] = useState<Record<'candidate' | 'client', EmailDraft | null>>({ candidate: null, client: null });
  const [generatingEmail, setGeneratingEmail] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Submission state
  const [subForm, setSubForm] = useState<{
    vendor_name: string; vendor_email: string; vendor_contact: string;
    client_name: string; job_location: string; rate: string;
    submitted_by: string; submission_type: string;
  }>({ vendor_name: '', vendor_email: '', vendor_contact: '', client_name: '', job_location: '', rate: '', submitted_by: '', submission_type: 'Client & Vendor' });
  const [submitting, setSubmitting] = useState(false);
  const [submissionDone, setSubmissionDone] = useState(false);
  const [submissionHistory, setSubmissionHistory] = useState<Array<{ id: string; vendor_name: string; client_name: string; rate: string; submission_date: string }>>([]);
  const [initiationHistory, setInitiationHistory] = useState<Array<{ id: string; event_type: string; description: string; created_at: string }>>([]);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  useEffect(() => {
    supabase.from('profiles').select('*').order('updated_at', { ascending: false })
      .then(({ data }) => {
        const profiles = (data ?? []) as Profile[];
        setAllProfiles(profiles);
        setLoadingProfiles(false);
        if (profiles.length > 0) selectProfile(profiles[0]);
      });

    supabase.from('wishlisted_jobs').select('profile_id, status')
      .then(({ data }) => {
        const counts: Record<string, { queued: number; initiated: number }> = {};
        for (const row of (data ?? []) as Array<{ profile_id: string; status: string }>) {
          const bucket = counts[row.profile_id] ?? { queued: 0, initiated: 0 };
          if (row.status === 'Submission Initiated') {
            bucket.initiated += 1;
          } else {
            bucket.queued += 1;
          }
          counts[row.profile_id] = bucket;
        }
        setProfileQueueCounts(counts);
      });
  }, []);

  async function selectProfile(p: Profile) {
    setSelectedProfile(p);
    setSelectedJob(null);
    setMatchScores({});
    setExpandedJobId(null);
    setEmailDrafts({ candidate: null, client: null });
    setJobSearch('');
    setStatusFilter('All');

    setLoadingJobs(true);
    const { data } = await supabase.from('wishlisted_jobs').select('*')
      .eq('profile_id', p.id).order('created_at', { ascending: false });
    const jobList = (data ?? []) as WishlistedJob[];
    setJobs(jobList);
    setLoadingJobs(false);

    if (jobList.length > 0) {
      loadCachedScores(p.id, jobList);
    }
  }

  async function loadCachedScores(profileId: string, jobList: WishlistedJob[]) {
    const { data: scores } = await supabase
      .from('job_match_scores')
      .select('*')
      .eq('profile_id', profileId);

    if (!scores || scores.length === 0) return;

    const scoreMap: Record<string, MatchScore> = {};
    for (const job of jobList) {
      if (!job.source_job_id) continue;
      const colName = resolveBoardColumn(job.board);
      if (!colName) continue;

      const cached = scores.find((s: Record<string, unknown>) => s[colName] === job.source_job_id);
      if (cached) {
        scoreMap[job.id] = {
          score: cached.score as number,
          summary: (cached.summary as string) ?? '',
          strengths: (cached.strengths as string[]) ?? [],
          gaps: (cached.gaps as string[]) ?? [],
          optimization_points: (cached.optimization_points as string[]) ?? [],
        };
      }
    }
    setMatchScores(scoreMap);

    const scoredIds = Object.keys(scoreMap);
    if (scoredIds.length > 0) {
      setJobs(prev => prev.map(j => {
        if (scoredIds.includes(j.id) && j.status === 'New') {
          return { ...j, status: 'Matched' };
        }
        return j;
      }));
    }
  }

  async function generateScore(job: WishlistedJob) {
    if (!selectedProfile || scoringJobId) return;
    if (!job.source_job_id) return;

    const useBenchMatch = shouldUseBenchMatch(job.board);
    const colName = resolveBoardColumn(job.board);
    if (!useBenchMatch && !colName) return;

    setScoringJobId(job.id);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

      let res: Response;
      if (useBenchMatch) {
        res = await fetch(`${supabaseUrl}/functions/v1/bench-match`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ action: 'match', profile_id: selectedProfile.id, job_post_id: job.source_job_id }),
        });
      } else {
        const payload: Record<string, string | null> = {
          profile_id: selectedProfile.id,
          account_id: account?.id ?? null,
          [colName!]: job.source_job_id,
        };
        res = await fetch(`${supabaseUrl}/functions/v1/score-job-match`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.error ?? 'Scoring failed', 'error');
        setScoringJobId(null);
        return;
      }

      const data = await res.json();
      if (data.queued) {
        showToast('Score queued - check back in a moment', 'success');
        setScoringJobId(null);
        return;
      }
      if (data.score !== undefined) {
        const ms: MatchScore = {
          score: data.score,
          summary: data.summary ?? '',
          strengths: data.strengths ?? [],
          gaps: data.gaps ?? [],
          optimization_points: Array.isArray(data.optimization_points) ? data.optimization_points : [],
        };
        setMatchScores(prev => ({ ...prev, [job.id]: ms }));
        setExpandedJobId(job.id);
        if (job.status !== 'Submitted' && job.status !== 'Submission Initiated') {
          await supabase.from('wishlisted_jobs').update({ status: 'Matched' }).eq('id', job.id);
          setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'Matched' } : j));
        }
      } else {
        showToast('No score returned', 'error');
      }
    } catch {
      showToast('Scoring failed', 'error');
    }
    setScoringJobId(null);
  }

  async function regenerateScore(job: WishlistedJob) {
    if (!selectedProfile) return;
    if (!job.source_job_id) return;
    const colName = resolveBoardColumn(job.board);
    if (colName) {
      await supabase.from('job_match_scores')
        .delete()
        .eq('profile_id', selectedProfile.id)
        .eq(colName, job.source_job_id);
    }
    setMatchScores(prev => { const n = { ...prev }; delete n[job.id]; return n; });
    await generateScore(job);
  }

  async function selectJob(job: WishlistedJob) {
    setSelectedJob(job);
    setEmailDrafts({ candidate: null, client: null });
    setSubmissionDone(false);
    setSubmissionHistory([]);
    setInitiationHistory([]);
    setSubForm(prev => ({
      ...prev,
      client_name: job.company || '',
      job_location: job.location || '',
      submission_type: emailTab === 'candidate' ? 'Candidate' : 'Client & Vendor',
    }));
    if (expandedJobId !== job.id) setExpandedJobId(job.id);

    if (job.status === 'Submission Initiated' || job.status === 'Submitted') {
      const { data: subs } = await supabase.from('submissions')
        .select('id, vendor_name, client_name, rate, submission_date')
        .eq('candidate_name', selectedProfile?.candidate_name ?? '')
        .order('submission_date', { ascending: false })
        .limit(10);
      if (subs) setSubmissionHistory(subs);
    }

    if (job.status === 'Matched' || job.status === 'Submission Initiated') {
      const { data: logs } = await supabase.from('activity_logs')
        .select('id, event_type, description, created_at')
        .eq('profile_id', job.profile_id)
        .in('event_type', ['submission_initiated', 'email_generated'])
        .order('created_at', { ascending: false })
        .limit(10);
      if (logs) setInitiationHistory(logs);
    }
  }

  async function markAsSubmissionInitiated() {
    if (!selectedJob || !selectedProfile) return;
    const { error } = await supabase.from('wishlisted_jobs')
      .update({ status: 'Submission Initiated' })
      .eq('id', selectedJob.id);
    if (error) { showToast('Failed to update status', 'error'); return; }

    await supabase.from('activity_logs').insert({
      profile_id: selectedJob.profile_id,
      event_type: 'submission_initiated',
      description: `Marked "${selectedJob.job_title}" at ${selectedJob.company} as Submission Initiated`,
    });

    setJobs(prev => prev.map(j => j.id === selectedJob.id ? { ...j, status: 'Submission Initiated' } : j));
    setSelectedJob(prev => prev ? { ...prev, status: 'Submission Initiated' } : prev);
    showToast('Marked as Submission Initiated');
  }

  async function removeJob(job: WishlistedJob) {
    const { error } = await supabase.from('wishlisted_jobs').delete().eq('id', job.id);
    if (error) { showToast('Failed to remove job', 'error'); return; }
    setJobs(prev => prev.filter(j => j.id !== job.id));
    if (selectedJob?.id === job.id) { setSelectedJob(null); }
    if (expandedJobId === job.id) setExpandedJobId(null);
    setMatchScores(prev => { const n = { ...prev }; delete n[job.id]; return n; });
    await supabase.from('activity_logs').insert({
      profile_id: job.profile_id,
      event_type: 'job_removed',
      description: `Removed "${job.job_title}" from submission queue`,
    });
    showToast('Job removed');
  }

  async function submitSubmission() {
    if (!selectedProfile || !selectedJob) return;
    setSubmitting(true);
    const skills = Array.isArray(selectedProfile.core_skills)
      ? (selectedProfile.core_skills as string[]).slice(0, 5).join(', ')
      : (selectedProfile.core_skills as string) ?? '';

    const { error } = await supabase.from('submissions').insert({
      candidate_name: selectedProfile.candidate_name,
      skill_set: skills,
      vendor_name: subForm.vendor_name,
      vendor_email: subForm.vendor_email,
      vendor_contact: subForm.vendor_contact,
      client_name: subForm.client_name,
      job_location: subForm.job_location,
      rate: subForm.rate,
      submitted_by: subForm.submitted_by,
      submission_date: new Date().toISOString().split('T')[0],
      submission_type: subForm.submission_type,
    });

    setSubmitting(false);
    if (error) {
      showToast('Failed to add submission', 'error');
    } else {
      showToast('Submission added successfully');
      setSubmissionDone(true);
      await supabase.from('wishlisted_jobs').update({ status: 'Submitted' }).eq('id', selectedJob.id);
      setJobs(prev => prev.map(j => j.id === selectedJob.id ? { ...j, status: 'Submitted' } : j));
      setSelectedJob(prev => prev ? { ...prev, status: 'Submitted' } : prev);
    }
  }

  async function generateEmail() {
    if (!selectedProfile || !selectedJob) return;
    setGeneratingEmail(true);
    setEmailDrafts(d => ({ ...d, [emailTab]: null }));

    let subject = '';
    let body = '';

    if (emailTab === 'candidate') {
      let token: string | null = null;
      try {
        const { data: existing } = await supabase
          .from('apply_confirmations').select('token')
          .eq('wishlisted_job_id', selectedJob.id).maybeSingle();
        if (existing?.token) {
          token = existing.token;
        } else {
          const { data: created } = await supabase
            .from('apply_confirmations')
            .insert({ wishlisted_job_id: selectedJob.id, profile_id: selectedJob.profile_id })
            .select('token').single();
          token = created?.token ?? null;
        }
      } catch { /* non-critical */ }

      const confirmUrl = token ? `${window.location.origin}/confirm-applied/${token}` : null;
      subject = `Job Opportunity: ${selectedJob.job_title} at ${selectedJob.company}`;
      body =
        `Hi ${selectedProfile.candidate_name},\n\n` +
        `I hope you're doing well! I came across an excellent opportunity that I think would be a great fit for you.\n\n` +
        `Position: ${selectedJob.job_title}\n` +
        `Company:  ${selectedJob.company}\n` +
        `Location: ${selectedJob.location || 'N/A'}\n` +
        (selectedJob.job_url ? `\nApply here: ${selectedJob.job_url}\n` : '') +
        (confirmUrl ? `\nOnce you've applied, please confirm using this link:\n${confirmUrl}\n` : '') +
        `\nPlease review and apply at your earliest convenience. Let me know if you have any questions!\n\nBest regards`;
      setEmailDrafts(d => ({ ...d, candidate: { to: selectedProfile.email ?? '', subject, body } }));

    } else if (emailTab === 'client') {
      const skills = Array.isArray(selectedProfile.core_skills)
        ? (selectedProfile.core_skills as string[]).slice(0, 5).join(', ')
        : selectedProfile.core_skills ?? '';
      const location = [selectedProfile.city, selectedProfile.state].filter(Boolean).join(', ') || selectedProfile.location || '';

      subject = `Candidate Submission: ${selectedProfile.candidate_name} - ${selectedJob.job_title}`;
      body =
        `Dear ${selectedJob.company} Hiring Team,\n\n` +
        `I hope this message finds you well. I am pleased to submit ${selectedProfile.candidate_name} as a strong candidate for the ${selectedJob.job_title} position.\n\n` +
        `Candidate Overview:\n` +
        `- Name: ${selectedProfile.candidate_name}\n` +
        (selectedProfile.target_role ? `- Target Role: ${selectedProfile.target_role}\n` : '') +
        (selectedProfile.years_experience ? `- Experience: ${selectedProfile.years_experience} years\n` : '') +
        (location ? `- Location: ${location}\n` : '') +
        (skills ? `- Key Skills: ${skills}\n` : '') +
        (selectedProfile.email ? `- Email: ${selectedProfile.email}\n` : '') +
        (selectedProfile.phone ? `- Phone: ${selectedProfile.phone}\n` : '') +
        (selectedProfile.linkedin_url ? `- LinkedIn: ${selectedProfile.linkedin_url}\n` : '') +
        `\nI believe ${selectedProfile.candidate_name} would be an excellent addition to your team and am happy to arrange an introduction at your convenience.\n\nBest regards`;
      setEmailDrafts(d => ({ ...d, client: { to: '', subject, body } }));
    }

    setGeneratingEmail(false);
  }

  async function copyField(key: string, val: string) {
    await navigator.clipboard.writeText(val);
    setCopiedField(key);
    setTimeout(() => setCopiedField(null), 2000);
  }

  const filteredProfiles = allProfiles.filter(p => {
    if (!profileSearch) return true;
    const q = profileSearch.toLowerCase();
    return p.candidate_name.toLowerCase().includes(q) || (p.target_role ?? '').toLowerCase().includes(q);
  });

  const filteredJobs = jobs.filter(j => {
    const q = jobSearch.toLowerCase();
    const matchQ = !q || j.job_title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q) || j.location.toLowerCase().includes(q);
    const matchS = statusFilter === 'All' || j.status === statusFilter;
    return matchQ && matchS;
  });

  return (
    <div className="h-screen flex flex-col bg-slate-100 font-sans overflow-hidden">
      <AppNav />

      <div className="flex-1 grid grid-cols-[18rem_minmax(0,1fr)_440px] overflow-hidden min-h-0">

        {/* COL 1: Candidates List */}
        <div className="flex flex-col overflow-hidden bg-white border-r border-slate-200 min-h-0">
          <div className="h-[44px] flex items-center justify-between border-b border-slate-200 bg-white px-3 shrink-0">
            <div className="flex items-center gap-2">
              <Users size={14} className="text-blue-600 shrink-0" />
              <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-900">Candidates</span>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{allProfiles.length}</span>
          </div>

          <div className="border-b border-slate-200 bg-white px-3 py-2 shrink-0">
            <div className="flex items-center rounded-lg bg-slate-100 p-0.5">
              {(['hotlist', 'all'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setSidebarTab(tab)}
                  className={`flex-1 text-[11px] font-semibold py-1.5 rounded-md transition-all text-center ${sidebarTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {tab === 'hotlist' ? 'Hotlist' : 'All Bench'}
                </button>
              ))}
            </div>
          </div>

          <div className="border-b border-slate-200 bg-white px-3 py-2.5 shrink-0">
            <div className="relative">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search candidates..."
                value={profileSearch}
                onChange={e => setProfileSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-[11px] text-slate-700 shadow-sm outline-none ring-0 placeholder:text-slate-400 focus:border-blue-400"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0">
            {loadingProfiles ? (
              <div className="flex items-center justify-center py-10"><LogoSpinner size={18} /></div>
            ) : filteredProfiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <Users size={18} className="text-slate-300" />
                <p className="text-xs text-slate-400">{sidebarTab === 'hotlist' ? 'No hotlisted candidates' : 'No candidates found'}</p>
              </div>
            ) : filteredProfiles.map(p => {
              const isSelected = selectedProfile?.id === p.id;
              const counts = profileQueueCounts[p.id] ?? { queued: 0, initiated: 0 };
              return (
                <button
                  key={p.id}
                  onClick={() => selectProfile(p)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-all ${
                    isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50/70 border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isSelected ? 'bg-blue-100' : 'bg-gray-100'}`}>
                      <User size={13} className={isSelected ? 'text-blue-600' : 'text-gray-400'} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[12px] font-semibold truncate leading-tight ${isSelected ? 'text-blue-900' : 'text-gray-800'}`}>
                        {p.candidate_name}
                      </p>
                      <p className="text-[10px] text-gray-400 truncate mt-0.5">{p.target_role || 'No target role'}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className="inline-flex items-center rounded-md bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">
                          Queued <span className="ml-0.5 text-[10px] font-bold">{counts.queued}</span>
                        </span>
                        <span className="inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                          Initiated <span className="ml-0.5 text-[10px] font-bold">{counts.initiated}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedProfile && (
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-2.5 shrink-0">
              <button
                onClick={() => navigate('/job-finder')}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-100"
              >
                <Search size={11} /> Find More Jobs
              </button>
            </div>
          )}
        </div>

        {/* COL 2: Submission Queue */}
        <div className="flex flex-col overflow-hidden bg-slate-50/80 min-h-0">
          <div className="h-[44px] flex items-center gap-2 border-b border-slate-200 bg-white px-4 shrink-0">
            <Bookmark size={13} className="text-blue-500 shrink-0" />
            <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-900">Submission Queue</span>
          </div>

          <div className="border-b border-slate-200 bg-white px-3 py-3 shrink-0">
            <div className="relative">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search queue..."
                value={jobSearch}
                onChange={e => setJobSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-[11px] text-slate-700 shadow-sm outline-none placeholder:text-slate-400 focus:border-blue-400"
              />
            </div>
          </div>

          <div className="border-b border-slate-200 bg-white px-3 py-2 shrink-0">
            <div className="flex items-center gap-1.5 rounded-xl bg-slate-100 p-1">
              {(['All', 'New', 'Matched', 'Submission Initiated'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`flex-1 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition-all ${statusFilter === s ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {s === 'Submission Initiated' ? 'Initiated' : s}
                  {s !== 'All' && jobs.length > 0 && <span className="ml-1 text-[9px] opacity-70">{jobs.filter(j => j.status === s).length}</span>}
                </button>
              ))}
            </div>
          </div>

          {!selectedProfile ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50">
                <Bookmark size={24} className="text-blue-400" />
              </div>
              <div>
                <p className="text-base font-bold text-slate-900">Select a Candidate</p>
                <p className="mt-1 max-w-sm text-sm text-slate-400">Choose a candidate from the left panel to view their submission queue and match scores.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 min-h-0">
                {loadingJobs ? (
                  <div className="flex items-center justify-center py-10"><LogoSpinner size={18} /></div>
                ) : filteredJobs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <Bookmark size={20} className="text-slate-300" />
                    <p className="text-xs text-slate-400">{jobs.length === 0 ? 'No jobs in queue yet' : 'No jobs match filters'}</p>
                  </div>
                ) : filteredJobs.map(job => {
                  const isSelected = selectedJob?.id === job.id;
                  const isExpanded = expandedJobId === job.id;
                  const ms = matchScores[job.id];
                  const canScore = !!job.source_job_id;
                  const isScoring = scoringJobId === job.id;
                  const colors = ms ? scoreColor(ms.score) : null;

                  return (
                    <div key={job.id} className={`relative isolate overflow-hidden rounded-xl border bg-white shadow-sm transition-all ${isSelected ? 'border-blue-200' : 'border-slate-200 hover:border-slate-300'}`}>
                      <div onClick={() => selectJob(job)} className="w-full px-5 py-4 text-left">
                        <div className="grid gap-3 lg:grid-cols-[1fr_1.05fr] items-start">
                          <div className="min-w-0">
                            <div className="mb-2 flex flex-wrap items-start gap-2">
                              <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${BOARD_COLORS[job.board] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                                {job.board}
                              </span>
                              <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${job.status === 'Submitted' ? 'bg-emerald-100 text-emerald-700' : job.status === 'Submission Initiated' ? 'bg-amber-100 text-amber-700' : job.status === 'Matched' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                                {job.status === 'Submitted' || job.status === 'Submission Initiated' || job.status === 'Matched' ? <CheckCircle2 size={8} /> : <Circle size={8} />}
                                {job.status === 'Submission Initiated' ? 'Initiated' : job.status}
                              </span>
                              {job.rewrite_file_url && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600">
                                  <FileText size={8} /> Resume
                                </span>
                              )}
                            </div>
                            <p className={`break-words text-[13px] font-medium leading-tight ${isSelected ? 'text-blue-800' : 'text-slate-900'}`}>{job.job_title}</p>
                            <div className="mt-2 flex flex-col gap-1.5 text-[11px] text-slate-500">
                              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1">
                                <Building2 size={11} className="text-slate-400" />
                                {job.company}
                              </span>
                              {job.location && (
                                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1">
                                  <MapPin size={11} className="text-slate-400" />
                                  {job.location}
                                </span>
                              )}
                              <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                                Added {formatDate(job.created_at)}
                              </span>
                            </div>
                          </div>

                          <div className="min-w-0">
                            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 shadow-sm">
                              {ms ? (
                                <button onClick={e => { e.stopPropagation(); setExpandedJobId(isExpanded ? null : job.id); }} className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-[11px] font-semibold shadow-sm transition-colors ${colors!.bg} ${colors!.border} ${colors!.text}`}>
                                  <span className="flex items-center gap-1"><Sparkles size={10} /> Match {ms.score}</span>
                                  {isExpanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
                                </button>
                              ) : canScore ? (
                                <button onClick={e => { e.stopPropagation(); generateScore(job); }} disabled={!!scoringJobId} className="flex w-full items-center justify-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] font-semibold text-amber-700 transition-colors disabled:opacity-40">
                                  {isScoring ? <LogoSpinner size={10} /> : <Sparkles size={10} />}
                                  {isScoring ? 'Scoring' : 'Score'}
                                </button>
                              ) : (
                                <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[10px] font-medium text-slate-500">Awaiting score</div>
                              )}
                              <p className="mt-2 text-[10px] leading-relaxed text-slate-500">{ms ? ms.summary || 'Match details ready' : 'Tap to score and unlock actions'}</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mx-4 mb-4 flex flex-wrap items-center justify-end gap-1.5 border-t border-slate-100 pt-3">
                        {job.job_url && (
                          <a
                            href={job.job_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            title="Apply Link"
                            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white p-2 text-slate-500 shadow-sm transition-all hover:bg-slate-50"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}

                        <button
                          onClick={e => { e.stopPropagation(); selectJob(job); }}
                          title="Preview Job"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm transition-all hover:bg-slate-100"
                        >
                          <Search size={13} />
                          Full JD
                        </button>

                        <button
                          onClick={e => { e.stopPropagation(); removeJob(job); }}
                          title="Remove"
                          className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-2 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>

                      {isExpanded && ms && (
                        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
                          <div className="space-y-3">
                            <div className="flex items-center gap-3">
                              <div className={`text-2xl font-black tabular-nums leading-none ${colors!.text}`}>{ms.score}<span className="text-xs font-bold text-slate-300">/100</span></div>
                              <div className="flex-1">
                                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                                  <div className={`h-full rounded-full transition-all ${colors!.bar}`} style={{ width: `${ms.score}%` }} />
                                </div>
                              </div>
                            </div>
                            {ms.summary && <p className="text-[11px] leading-relaxed text-slate-600">{ms.summary}</p>}
                            {ms.strengths.length > 0 && (
                              <div>
                                <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Strengths</p>
                                <div className="flex flex-wrap gap-1">
                                  {ms.strengths.map((s, i) => <span key={i} className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">{s}</span>)}
                                </div>
                              </div>
                            )}
                            {ms.gaps.length > 0 && (
                              <div>
                                <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Gaps</p>
                                <div className="flex flex-wrap gap-1">
                                  {ms.gaps.map((g, i) => <span key={i} className="rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">{g}</span>)}
                                </div>
                              </div>
                            )}
                            {ms.optimization_points.length > 0 && (
                              <div>
                                <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Optimization</p>
                                <div className="space-y-1">
                                  {ms.optimization_points.map((pt, i) => (
                                    <div key={i} className="flex items-start gap-1.5">
                                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[9px] font-bold text-blue-700">{i + 1}</span>
                                      <p className="text-[10px] leading-relaxed text-slate-600">{pt}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            <button onClick={() => regenerateScore(job)} disabled={!!scoringJobId} className="flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-40">
                              <RotateCcw size={10} /> Regenerate Score
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* COL 3: Context Panel */}
        <div className="flex flex-col overflow-hidden bg-white border-l border-slate-200 min-h-0">

          {!selectedJob ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <div className="w-12 h-12 rounded-2xl bg-gray-50 flex items-center justify-center">
                <Briefcase size={20} className="text-gray-300" />
              </div>
              <p className="text-xs text-gray-400 max-w-[200px] leading-relaxed">
                Select a job to view actions based on its status.
              </p>
            </div>

          ) : selectedJob.status === 'New' ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center">
                <Sparkles size={20} className="text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800 mb-1">Generate a Match Score</p>
                <p className="text-xs text-gray-400 max-w-[220px] leading-relaxed">
                  Score this job first to unlock email generation and submission workflow.
                </p>
              </div>
            </div>

          ) : selectedJob.status === 'Matched' ? (
            <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">
              <div className="h-[44px] flex items-center gap-2 border-b border-slate-200 bg-white px-4 shrink-0">
                <Mail size={14} className="text-blue-500" />
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-900">Email Outreach Draft</span>
              </div>

              <div className="border-b border-slate-200 bg-white px-3 py-2.5 shrink-0">
                <div className="flex items-center gap-1.5 rounded-xl bg-slate-100 p-1">
                  {(['client', 'candidate'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setEmailTab(tab)}
                      className={`flex-1 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold capitalize transition-all ${emailTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      {tab === 'candidate' ? 'Candidate' : 'Client'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Email Generation */}
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center gap-2 px-3 pt-3 pb-2 shrink-0">
                  <Mail size={12} className="text-blue-500" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    {emailTab === 'candidate' ? 'Email to Candidate' : 'Email to Client'}
                  </span>
                </div>

                {!emailDrafts[emailTab] ? (
                  <div className="flex flex-col items-center justify-center gap-4 px-6 py-6 text-center">
                    <p className="text-xs text-gray-400 max-w-[200px] leading-relaxed">
                      {emailTab === 'candidate'
                        ? `Notify ${selectedProfile?.candidate_name} about the ${selectedJob.job_title} opportunity.`
                        : `Introduce ${selectedProfile?.candidate_name} to the hiring team at ${selectedJob.company}.`
                      }
                    </p>
                    <button
                      onClick={generateEmail}
                      disabled={generatingEmail}
                      className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-colors shadow-sm"
                    >
                      {generatingEmail ? <LogoSpinner size={12} /> : <Mail size={12} />}
                      Generate Email
                    </button>
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 px-3 pb-3 min-h-0">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Subject</span>
                        <button onClick={() => copyField('subject', emailDrafts[emailTab]!.subject)} className="flex items-center gap-1 text-[9px] text-gray-400 hover:text-gray-700 transition-colors">
                          {copiedField === 'subject' ? <Check size={9} className="text-emerald-500" /> : <Copy size={9} />}
                          {copiedField === 'subject' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <div className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[11px] text-gray-800 leading-relaxed font-medium">
                        {emailDrafts[emailTab]!.subject}
                      </div>
                    </div>

                    {emailDrafts[emailTab]!.to && (
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">To</span>
                          <button onClick={() => copyField('to', emailDrafts[emailTab]!.to)} className="flex items-center gap-1 text-[9px] text-gray-400 hover:text-gray-700 transition-colors">
                            {copiedField === 'to' ? <Check size={9} className="text-emerald-500" /> : <Copy size={9} />}
                            {copiedField === 'to' ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        <div className="bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[11px] text-gray-600">
                          {emailDrafts[emailTab]!.to}
                        </div>
                      </div>
                    )}

                    <div className="flex-1 flex flex-col min-h-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Body</span>
                        <button onClick={() => copyField('body', emailDrafts[emailTab]!.body)} className="flex items-center gap-1 text-[9px] text-gray-400 hover:text-gray-700 transition-colors">
                          {copiedField === 'body' ? <Check size={9} className="text-emerald-500" /> : <Copy size={9} />}
                          {copiedField === 'body' ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                      <textarea
                        value={emailDrafts[emailTab]!.body}
                        onChange={e => setEmailDrafts(d => ({ ...d, [emailTab]: { ...d[emailTab]!, body: e.target.value } }))}
                        className="flex-1 w-full text-[11px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 outline-none resize-none focus:ring-1 focus:ring-blue-200 leading-relaxed min-h-[120px]"
                        spellCheck={false}
                      />
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setEmailDrafts(d => ({ ...d, [emailTab]: null }))}
                        className="flex items-center gap-1 text-[10px] font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        <RotateCcw size={9} /> Redo
                      </button>
                      <button
                        onClick={() => {
                          const s = encodeURIComponent(emailDrafts[emailTab]!.subject);
                          const b = encodeURIComponent(emailDrafts[emailTab]!.body);
                          window.open(`mailto:${emailDrafts[emailTab]!.to || ''}?subject=${s}&body=${b}`);
                        }}
                        className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-bold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors"
                      >
                        <Mail size={10} /> Open in Mail
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Mark as Submission Initiated */}
              <div className="border-t border-gray-100 px-3 py-3 shrink-0">
                <button
                  onClick={markAsSubmissionInitiated}
                  className="w-full flex items-center justify-center gap-2 text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 px-4 py-2.5 rounded-xl transition-colors shadow-sm"
                >
                  <Send size={11} /> Mark as Submission Initiated
                </button>
              </div>

              {/* Initiation History */}
              {initiationHistory.length > 0 && (
                <div className="border-t border-gray-100 px-3 py-3 shrink-0 max-h-[140px] overflow-y-auto">
                  <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-2">Initiation History</p>
                  <div className="space-y-1.5">
                    {initiationHistory.map(log => (
                      <div key={log.id} className="flex items-start gap-2 text-[10px]">
                        <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-400 mt-1" />
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-600 truncate">{log.description}</p>
                          <p className="text-gray-400 text-[9px]">{formatDate(log.created_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

          ) : selectedJob.status === 'Submission Initiated' ? (
            <div className="flex-1 overflow-y-auto min-h-0 flex flex-col">
              {/* Submission Form */}
              <div className="border-b border-gray-100 p-3 shrink-0">
                <div className="flex items-center gap-2 mb-2.5">
                  <Plus size={12} className="text-emerald-600" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Add Submission</span>
                  {submissionDone && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-emerald-600">
                      <CheckCircle2 size={10} /> Saved
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] font-semibold text-gray-400 uppercase mb-0.5 block">Vendor Name</label>
                    <input
                      value={subForm.vendor_name}
                      onChange={e => setSubForm(f => ({ ...f, vendor_name: e.target.value }))}
                      className="w-full text-[11px] px-2 py-1.5 border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 placeholder:text-gray-300"
                      placeholder="Staffing vendor"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-semibold text-gray-400 uppercase mb-0.5 block">Vendor Email</label>
                    <input
                      value={subForm.vendor_email}
                      onChange={e => setSubForm(f => ({ ...f, vendor_email: e.target.value }))}
                      className="w-full text-[11px] px-2 py-1.5 border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 placeholder:text-gray-300"
                      placeholder="vendor@email.com"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-semibold text-gray-400 uppercase mb-0.5 block">Vendor Contact</label>
                    <input
                      value={subForm.vendor_contact}
                      onChange={e => setSubForm(f => ({ ...f, vendor_contact: e.target.value }))}
                      className="w-full text-[11px] px-2 py-1.5 border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 placeholder:text-gray-300"
                      placeholder="Phone"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-semibold text-gray-400 uppercase mb-0.5 block">Client Name</label>
                    <input
                      value={subForm.client_name}
                      onChange={e => setSubForm(f => ({ ...f, client_name: e.target.value }))}
                      className="w-full text-[11px] px-2 py-1.5 border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 placeholder:text-gray-300"
                      placeholder="End client"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-semibold text-gray-400 uppercase mb-0.5 block">Location</label>
                    <input
                      value={subForm.job_location}
                      onChange={e => setSubForm(f => ({ ...f, job_location: e.target.value }))}
                      className="w-full text-[11px] px-2 py-1.5 border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 placeholder:text-gray-300"
                      placeholder="Job location"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-semibold text-gray-400 uppercase mb-0.5 block">Rate</label>
                    <input
                      value={subForm.rate}
                      onChange={e => setSubForm(f => ({ ...f, rate: e.target.value }))}
                      className="w-full text-[11px] px-2 py-1.5 border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 placeholder:text-gray-300"
                      placeholder="$45/hr"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-semibold text-gray-400 uppercase mb-0.5 block">Submitted By</label>
                    <input
                      value={subForm.submitted_by}
                      onChange={e => setSubForm(f => ({ ...f, submitted_by: e.target.value }))}
                      className="w-full text-[11px] px-2 py-1.5 border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:border-blue-400 placeholder:text-gray-300"
                      placeholder="Your name"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-2.5">
                  <div className="flex-1 flex items-center gap-1.5 text-[10px] text-gray-400">
                    <User size={9} className="text-gray-300" />
                    <span className="truncate font-medium text-gray-600">{selectedProfile?.candidate_name}</span>
                    <span className="text-gray-300">at</span>
                    <span className="truncate font-medium text-gray-600">{selectedJob.company}</span>
                  </div>
                  <button
                    onClick={submitSubmission}
                    disabled={submitting || submissionDone}
                    className="flex items-center gap-1.5 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {submitting ? <LogoSpinner size={10} /> : <Send size={10} />}
                    {submissionDone ? 'Submitted' : 'Submit'}
                  </button>
                </div>
              </div>

              {/* Submission History */}
              <div className="flex-1 px-3 py-3 overflow-y-auto min-h-0">
                <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-2">Submission History</p>
                {submissionHistory.length === 0 ? (
                  <p className="text-[10px] text-gray-400 italic">No submissions yet for this candidate.</p>
                ) : (
                  <div className="space-y-2">
                    {submissionHistory.map(sub => (
                      <div key={sub.id} className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-semibold text-gray-700">{sub.client_name || 'N/A'}</span>
                          <span className="text-[9px] text-gray-400">{sub.submission_date ? formatDate(sub.submission_date) : ''}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[9px] text-gray-500">
                          {sub.vendor_name && <span>Vendor: {sub.vendor_name}</span>}
                          {sub.rate && <span>Rate: {sub.rate}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          ) : (
            /* Submitted or other status */
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 size={20} className="text-emerald-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800 mb-1">Submission Complete</p>
                <p className="text-xs text-gray-400 max-w-[220px] leading-relaxed">
                  This job has been submitted. Check the Tracker for details.
                </p>
              </div>
            </div>
          )}
        </div>

      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
