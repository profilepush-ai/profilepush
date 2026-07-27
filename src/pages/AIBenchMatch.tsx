import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles, Search, FileText, Copy, Check,
  ChevronLeft, ChevronRight, Trash2, Clock, MapPin, Briefcase, Tag,
  User, X, Zap, Target, CheckSquare, Square, StopCircle, Bookmark, Eye, FileUp,
  CalendarClock, Loader2, XCircle, Plus,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Profile } from '../types/database';

interface ExternalJobPost {
  id: string;
  user_id: string;
  title: string;
  company: string;
  location: string;
  skills: string[];
  experience_years: number | null;
  employment_type: string;
  raw_description: string;
  summary: string;
  source: string | null;
  poc_name: string | null;
  poc_email: string | null;
  poc_phone: string | null;
  created_at: string;
}

interface MatchedCandidate {
  profile: Profile;
  score: number;
  reason: string;
}

interface DetailedScore {
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
  optimization_points: string[];
}



const PAGE_SIZE = 10;

const pageCache: {
  posts: ExternalJobPost[] | null;
  profiles: Profile[] | null;
  selectedPostId: string | null;
  bulkResults: Map<string, DetailedScore> | null;
  userId: string | null;
} = { posts: null, profiles: null, selectedPostId: null, bulkResults: null, userId: null };

export default function AIBenchMatch() {
  const { account, user } = useAuth();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  // Column 1: Job Description
  const [jobDescription, setJobDescription] = useState('');
  const [savedPosts, setSavedPosts] = useState<ExternalJobPost[]>(pageCache.userId === user?.id && pageCache.posts ? pageCache.posts : []);
  const [selectedPost, setSelectedPost] = useState<ExternalJobPost | null>(
    pageCache.userId === user?.id && pageCache.posts && pageCache.selectedPostId
      ? pageCache.posts.find(p => p.id === pageCache.selectedPostId) ?? null
      : null
  );
  const [viewingPost, setViewingPost] = useState<ExternalJobPost | null>(null);
  const [parsing, setParsing] = useState(false);
  const [loadingPosts, setLoadingPosts] = useState(!pageCache.posts || pageCache.userId !== user?.id);

  // Column 2: Candidates
  const [allProfiles, setAllProfiles] = useState<Profile[]>(pageCache.profiles ?? []);
  const [loadingProfiles, setLoadingProfiles] = useState(!pageCache.profiles);
  const [page, setPage] = useState(0);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<MatchedCandidate | null>(null);
  const [detailedScore, setDetailedScore] = useState<DetailedScore | null>(null);
  const [scoring, setScoring] = useState(false);

  // Bulk match
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkMatching, setBulkMatching] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [bulkResults, setBulkResults] = useState<Map<string, DetailedScore>>(
    pageCache.userId === user?.id && pageCache.bulkResults ? pageCache.bulkResults : new Map()
  );
  const bulkAbortRef = useRef(false);

  // Saved jobs tracking (profile_id -> wishlisted_job id)
  const [savedMap, setSavedMap] = useState<Map<string, string>>(new Map());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  // Hotlist tab
  const [candidateTab, setCandidateTab] = useState<'hotlist' | 'all'>('hotlist');
  const [hotlistIds, setHotlistIds] = useState<Set<string>>(new Set());
  const [hotlistLoading, setHotlistLoading] = useState(true);

  // Resume AI queue tracking
  const [resumeAiQueuedIds, setResumeAiQueuedIds] = useState<Set<string>>(new Set());
  const [queuingResumeAi, setQueuingResumeAi] = useState<Set<string>>(new Set());

  const [memberNames, setMemberNames] = useState<Map<string, string>>(new Map());
  const [emailDraft, setEmailDraft] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Watch Schedule popup state
  const [showSchedulePopup, setShowSchedulePopup] = useState(false);
  const [scheduleFrequency, setScheduleFrequency] = useState<'hourly' | 'daily' | 'twice_daily' | 'weekly'>('daily');
  const [scheduleBoards, setScheduleBoards] = useState<Set<string>>(new Set(['linkedin', 'dice']));
  const [savingSchedule, setSavingSchedule] = useState(false);

  // Load cached scores when a job post is selected
  useEffect(() => {
    if (!selectedPost) { setBulkResults(new Map()); return; }
    setBulkResults(new Map());
    loadCachedScores(selectedPost.id);
  }, [selectedPost?.id]);

  useEffect(() => { if (user) loadSavedPosts(); }, [user?.id]);

  useEffect(() => {
    if (!pageCache.profiles) loadProfiles();
    loadMemberNames();
    loadHotlistIds();
  }, []);

  // Sync to page-level cache so navigation doesn't lose state
  useEffect(() => { pageCache.posts = savedPosts; pageCache.userId = user?.id ?? null; }, [savedPosts, user?.id]);
  useEffect(() => { pageCache.profiles = allProfiles; }, [allProfiles]);
  useEffect(() => { pageCache.selectedPostId = selectedPost?.id ?? null; }, [selectedPost?.id]);
  useEffect(() => { pageCache.bulkResults = bulkResults; }, [bulkResults]);

  useEffect(() => {
    if (!selectedPost) { setSavedMap(new Map()); return; }
    supabase
      .from('wishlisted_jobs')
      .select('id, profile_id')
      .eq('source_job_id', selectedPost.id)
      .then(({ data }) => {
        const map = new Map<string, string>();
        (data ?? []).forEach(row => map.set(row.profile_id, row.id));
        setSavedMap(map);
      });
  }, [selectedPost?.id]);

  async function loadMemberNames() {
    const { data } = await supabase
      .from('account_members')
      .select('user_id, display_name, invited_email');
    if (data) {
      const map = new Map<string, string>();
      data.forEach(m => {
        if (m.user_id) map.set(m.user_id, m.display_name || m.invited_email || 'Unknown');
      });
      setMemberNames(map);
    }
  }

  async function loadProfiles() {
    if (pageCache.profiles && pageCache.profiles.length > 0) {
      setAllProfiles(pageCache.profiles);
      setLoadingProfiles(false);
      return;
    }
    setLoadingProfiles(true);
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    setAllProfiles((data ?? []) as Profile[]);
    setLoadingProfiles(false);
  }

  async function loadHotlistIds() {
    setHotlistLoading(true);
    const { data } = await supabase.from('hotlist').select('profile_id');
    if (data) setHotlistIds(new Set(data.map(r => r.profile_id)));
    setHotlistLoading(false);
  }

  async function loadSavedPosts() {
    if (!user) return;
    if (pageCache.userId === user.id && pageCache.posts && pageCache.posts.length > 0) {
      setSavedPosts(pageCache.posts);
      setLoadingPosts(false);
      return;
    }
    setLoadingPosts(true);
    const { data } = await supabase
      .from('external_job_posts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setSavedPosts((data ?? []) as ExternalJobPost[]);
    setLoadingPosts(false);
  }

  async function loadCachedScores(postId: string) {
    const { data } = await supabase
      .from('job_match_scores')
      .select('profile_id, score, summary, strengths, gaps, optimization_points')
      .eq('external_job_post_id', postId);
    if (data && data.length > 0) {
      const map = new Map<string, DetailedScore>();
      data.forEach(row => {
        map.set(row.profile_id, {
          score: row.score,
          summary: row.summary,
          strengths: row.strengths as string[],
          gaps: row.gaps as string[],
          optimization_points: row.optimization_points as string[],
        });
      });
      setBulkResults(map);
    }
  }

  async function persistScore(profileId: string, postId: string, result: DetailedScore) {
    const { error } = await supabase
      .from('job_match_scores')
      .upsert({
        profile_id: profileId,
        external_job_post_id: postId,
        score: result.score,
        summary: result.summary,
        strengths: result.strengths,
        gaps: result.gaps,
        optimization_points: result.optimization_points || [],
      }, { onConflict: 'profile_id,external_job_post_id' });
    if (error) console.error('persistScore failed:', error.message);
  }

  async function addToResumeAiQueue(profileId: string) {
    let wishlistId = savedMap.get(profileId);
    setQueuingResumeAi(prev => new Set(prev).add(profileId));
    try {
      if (!wishlistId) {
        // Auto-save to submission queue first
        if (!selectedPost || !user) throw new Error('No job selected');
        const { data, error: saveErr } = await supabase
          .from('wishlisted_jobs')
          .insert({
            user_id: user.id,
            account_id: accountId,
            profile_id: profileId,
            source: selectedPost.source || 'external',
            source_job_id: selectedPost.id,
            external_job_post_id: selectedPost.id,
            title: selectedPost.title,
            company: selectedPost.company || null,
            location: selectedPost.location || null,
            url: selectedPost.url || null,
          })
          .select('id')
          .single();
        if (saveErr) throw saveErr;
        wishlistId = data.id;
        setSavedMap(prev => new Map(prev).set(profileId, data.id));
      }
      const { error } = await supabase
        .from('wishlisted_jobs')
        .update({ resume_ai_queued: true })
        .eq('id', wishlistId);
      if (error) throw error;
      setResumeAiQueuedIds(prev => new Set(prev).add(profileId));
      showToast('Added to Resume AI queue');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to queue', 'error');
    } finally {
      setQueuingResumeAi(prev => { const n = new Set(prev); n.delete(profileId); return n; });
    }
  }

  async function handleSubmitJobDescription() {
    if (!jobDescription.trim() || jobDescription.trim().length < 20) {
      showToast('Please enter a longer job description', 'error');
      return;
    }
    setParsing(true);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bench-match`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'parse', raw_description: jobDescription, account_id: account?.id ?? null }),
      });
      if (!res.ok) throw new Error('Failed to parse job description');
      const parsed = await res.json();
      if (parsed.error) throw new Error(parsed.error);

      // Save to database
      const { data: saved, error: saveErr } = await supabase
        .from('external_job_posts')
        .insert({
          account_id: account?.id ?? null,
          title: parsed.title || 'Untitled Position',
          company: parsed.company || '',
          location: parsed.location || '',
          skills: parsed.skills || [],
          experience_years: parsed.experience_years ?? null,
          employment_type: parsed.employment_type || '',
          raw_description: jobDescription,
          summary: parsed.summary || '',
        })
        .select()
        .single();

      if (saveErr || !saved) throw new Error('Failed to save job post');

      const newPost = saved as ExternalJobPost;
      setSavedPosts(prev => [newPost, ...prev]);
      setSelectedPost(newPost);
      setJobDescription('');
      setPage(0);
      setSelectedCandidate(null);
      setDetailedScore(null);
      setEmailDraft(null);
      showToast('Job description parsed and saved');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to process job description', 'error');
    } finally {
      setParsing(false);
    }
  }

  async function createSchedule() {
    if (!jobDescription.trim() || jobDescription.trim().length < 20) {
      showToast('Please enter a longer job description', 'error');
      return;
    }
    if (scheduleBoards.size === 0) {
      showToast('Select at least one job board', 'error');
      return;
    }
    setSavingSchedule(true);
    try {
      // Parse and save the job post first
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bench-match`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'parse', raw_description: jobDescription, account_id: account?.id ?? null }),
      });
      if (!res.ok) throw new Error('Failed to parse job description');
      const parsed = await res.json();
      if (parsed.error) throw new Error(parsed.error);

      const { data: saved, error: saveErr } = await supabase
        .from('external_job_posts')
        .insert({
          account_id: account?.id ?? null,
          title: parsed.title || 'Untitled Position',
          company: parsed.company || '',
          location: parsed.location || '',
          skills: parsed.skills || [],
          experience_years: parsed.experience_years ?? null,
          employment_type: parsed.employment_type || '',
          raw_description: jobDescription,
          summary: parsed.summary || '',
        })
        .select()
        .single();
      if (saveErr || !saved) throw new Error('Failed to save job post');

      const newPost = saved as ExternalJobPost;
      setSavedPosts(prev => [newPost, ...prev]);
      setSelectedPost(newPost);
      setJobDescription('');

      // Now create the watch schedule
      const { error: schedErr } = await supabase
        .from('watch_schedules')
        .insert({
          account_id: account?.id ?? null,
          profile_id: selectedCandidate?.profile.id ?? null,
          external_job_post_id: newPost.id,
          frequency: scheduleFrequency,
          boards: Array.from(scheduleBoards),
          is_active: true,
        });
      if (schedErr) throw new Error('Failed to create schedule');

      setShowSchedulePopup(false);
      showToast('Watch schedule created');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create schedule', 'error');
    } finally {
      setSavingSchedule(false);
    }
  }

  async function scoreCandidate(profile: Profile) {
    if (!selectedPost) return;
    setSelectedCandidate({ profile, score: 0, reason: '' });
    setScoring(true);
    setDetailedScore(null);
    setEmailDraft(null);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bench-match`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'match',
          profile_id: profile.id,
          job_post_id: selectedPost.id,
          account_id: account?.id ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to score candidate');
      const detailed: DetailedScore = {
        score: data.score,
        summary: data.summary,
        strengths: data.strengths || [],
        gaps: data.gaps || [],
        optimization_points: data.optimization_points || [],
      };
      setDetailedScore(detailed);
      setSelectedCandidate({ profile, score: detailed.score, reason: detailed.summary });
      setBulkResults(prev => new Map(prev).set(profile.id, detailed));
      persistScore(profile.id, selectedPost.id, detailed);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Scoring failed', 'error');
    } finally {
      setScoring(false);
    }
  }

  function toggleCheck(profileId: string) {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }

  function toggleSelectAll() {
    if (checkedIds.size === filteredProfiles.length) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(filteredProfiles.map(p => p.id)));
    }
  }

  async function bulkMatch() {
    if (!selectedPost || checkedIds.size === 0) return;
    const postSnapshot = selectedPost;
    bulkAbortRef.current = false;
    setBulkMatching(true);
    setBulkProgress({ current: 0, total: checkedIds.size });
    const results = new Map<string, DetailedScore>();

    const profilesToMatch = allProfiles.filter(p => checkedIds.has(p.id));
    let retries = 0;
    for (let i = 0; i < profilesToMatch.length; i++) {
      if (bulkAbortRef.current) break;
      const profile = profilesToMatch[i];
      setBulkProgress({ current: i + 1, total: profilesToMatch.length });
      try {
        const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bench-match`;
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'match', profile_id: profile.id, job_post_id: postSnapshot.id, account_id: account?.id ?? null }),
        });
        if (res.ok) {
          const data = await res.json();
          if (!data.error) {
            const result: DetailedScore = {
              score: data.score,
              summary: data.summary,
              strengths: data.strengths || [],
              gaps: data.gaps || [],
              optimization_points: data.optimization_points || [],
            };
            results.set(profile.id, result);
            persistScore(profile.id, postSnapshot.id, result);
            retries = 0;
          }
        } else if (res.status === 429 || res.status === 503 || res.status === 500) {
          // Rate limited or server overloaded — retry this profile after a longer delay
          if (retries < 2) {
            retries++;
            i--;
            await new Promise(r => setTimeout(r, 3000 * retries));
            continue;
          }
          retries = 0;
        }
      } catch {
        // continue to next
      }
      setBulkResults(new Map(results));
      // Throttle between requests to avoid API rate limits
      if (i < profilesToMatch.length - 1) {
        await new Promise(r => setTimeout(r, 1200));
      }
    }

    setBulkMatching(false);
    setCheckedIds(new Set());
    if (!bulkAbortRef.current) {
      showToast(`Matched ${results.size} of ${profilesToMatch.length} candidates`);
    }
  }

  async function saveJobForCandidate(profileId: string) {
    if (!selectedPost || savedMap.has(profileId)) return;
    setSavingIds(prev => new Set(prev).add(profileId));
    try {
      const { data, error } = await supabase
        .from('wishlisted_jobs')
        .insert({
          profile_id: profileId,
          job_title: selectedPost.title || 'Untitled Position',
          company: selectedPost.company || 'Unknown',
          board: 'External',
          location: selectedPost.location || '',
          source_job_id: selectedPost.id,
          status: 'New',
        })
        .select('id')
        .single();
      if (error) throw error;
      setSavedMap(prev => new Map(prev).set(profileId, data.id));
      showToast('Job added to submission queue');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save job', 'error');
    } finally {
      setSavingIds(prev => { const n = new Set(prev); n.delete(profileId); return n; });
    }
  }

  async function unsaveJobForCandidate(profileId: string) {
    const wishlistId = savedMap.get(profileId);
    if (!wishlistId) return;
    setSavingIds(prev => new Set(prev).add(profileId));
    try {
      const { error } = await supabase.from('wishlisted_jobs').delete().eq('id', wishlistId);
      if (error) throw error;
      setSavedMap(prev => { const n = new Map(prev); n.delete(profileId); return n; });
      showToast('Job removed from queue');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to remove', 'error');
    } finally {
      setSavingIds(prev => { const n = new Set(prev); n.delete(profileId); return n; });
    }
  }

  async function deletePost(id: string) {
    await supabase.from('external_job_posts').delete().eq('id', id);
    setSavedPosts(prev => prev.filter(p => p.id !== id));
    if (selectedPost?.id === id) {
      setSelectedPost(null);
      setCandidates([]);
      setSelectedCandidate(null);
      setDetailedScore(null);
      setEmailDraft(null);
    }
    showToast('Job post deleted');
  }

  async function updatePostField(id: string, field: string, value: string | null) {
    const { error } = await supabase.from('external_job_posts').update({ [field]: value || null }).eq('id', id);
    if (error) { showToast('Failed to update', 'error'); return; }
    const update = (post: ExternalJobPost) => post.id === id ? { ...post, [field]: value || null } : post;
    setSavedPosts(prev => prev.map(update));
    if (viewingPost?.id === id) setViewingPost(prev => prev ? update(prev) : prev);
    if (selectedPost?.id === id) setSelectedPost(prev => prev ? update(prev) : prev);
  }

  const filteredProfiles = allProfiles.filter(p => {
    if (candidateTab === 'hotlist' && !hotlistIds.has(p.id)) return false;
    if (!candidateSearch.trim()) return true;
    const q = candidateSearch.toLowerCase();
    return p.candidate_name.toLowerCase().includes(q)
      || (p.target_role ?? '').toLowerCase().includes(q)
      || (p.core_skills ?? '').toLowerCase().includes(q)
      || (p.location ?? '').toLowerCase().includes(q);
  });
  const totalPages = Math.ceil(filteredProfiles.length / PAGE_SIZE);
  const paginatedProfiles = filteredProfiles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function scoreColor(score: number) {
    if (score >= 75) return 'text-emerald-600';
    if (score >= 50) return 'text-amber-600';
    return 'text-red-500';
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 font-sans overflow-hidden">
      <AppNav />

      {/* Page header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-sm">
            <Target size={15} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900">Hotlist AI</h1>
            <p className="text-[11px] text-gray-500">Paste external job descriptions to find matching bench candidates and use AI to instantly score and build your hotlist.</p>
          </div>
        </div>
      </div>

      {/* 3-column layout */}
      <div className="flex-1 grid grid-cols-12 gap-0 overflow-hidden">

        {/* ── Column 1: Job Descriptions ── */}
        <div className="col-span-3 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="p-4 border-b border-gray-100 shrink-0">
            <h2 className="text-xs font-bold text-gray-800 flex items-center gap-1.5 mb-3">
              <FileText size={12} className="text-blue-500" />
              Job Description
            </h2>
            <textarea
              ref={textareaRef}
              value={jobDescription}
              onChange={e => setJobDescription(e.target.value)}
              placeholder="Paste a job description from emails, LinkedIn, social media, or any external source..."
              rows={6}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-xs text-gray-700 placeholder:text-gray-400 resize-none focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 leading-relaxed"
            />
          </div>

          {/* Saved job posts list */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-2.5 border-b border-gray-50 shrink-0">
              <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
                Saved Job Posts ({savedPosts.length})
              </span>
            </div>
            {loadingPosts ? (
              <div className="flex items-center justify-center py-10">
                <LogoSpinner size={16} />
              </div>
            ) : savedPosts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center mb-2">
                  <FileText size={16} className="text-gray-300" />
                </div>
                <p className="text-xs text-gray-400">No job posts yet</p>
                <p className="text-[10px] text-gray-300 mt-0.5">Paste a description above to get started</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {savedPosts.map(post => (
                  <button
                    key={post.id}
                    onClick={() => {
                      setSelectedPost(post);
                      setPage(0);
                      setSelectedCandidate(null);
                      setDetailedScore(null);
                      setEmailDraft(null);
                      setBulkResults(new Map());
                      setCheckedIds(new Set());
                    }}
                    className={`w-full text-left px-4 py-3 hover:bg-blue-50/50 transition-colors group ${
                      selectedPost?.id === post.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-gray-800 truncate">
                          {post.title || 'Untitled'}
                        </p>
                        {post.company && (
                          <p className="text-[10px] text-gray-500 mt-0.5 truncate">{post.company}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {post.source && (
                            <span className="text-[9px] font-semibold bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded">
                              {post.source}
                            </span>
                          )}
                          {post.location && (
                            <span className="text-[9px] text-gray-400 flex items-center gap-0.5">
                              <MapPin size={8} />{post.location}
                            </span>
                          )}
                          <span className="text-[9px] text-gray-400 flex items-center gap-0.5">
                            <Clock size={8} />{new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                        {post.skills.length > 0 && (
                          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                            {post.skills.slice(0, 3).map((s, i) => (
                              <span key={i} className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-medium">{s}</span>
                            ))}
                            {post.skills.length > 3 && (
                              <span className="text-[9px] text-gray-400">+{post.skills.length - 3}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-center gap-1.5 shrink-0 mt-0.5">
                        <button
                          onClick={e => { e.stopPropagation(); setViewingPost(post); }}
                          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-blue-500 transition-all"
                          title="Preview job post"
                        >
                          <Eye size={12} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); deletePost(post.id); }}
                          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all"
                          title="Delete"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Column 2: Bench Candidates ── */}
        <div className="col-span-5 border-r border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
          <div className="bg-white border-b border-gray-200 px-5 py-3 shrink-0 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setCandidateTab('hotlist'); setPage(0); }}
                  className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${
                    candidateTab === 'hotlist'
                      ? 'bg-amber-50 text-amber-700 border border-amber-200'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Target size={11} />
                  Hotlist
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                    candidateTab === 'hotlist' ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {allProfiles.filter(p => hotlistIds.has(p.id)).length}
                  </span>
                </button>
                <button
                  onClick={() => { setCandidateTab('all'); setPage(0); }}
                  className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${
                    candidateTab === 'all'
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <User size={11} />
                  All Bench
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                    candidateTab === 'all' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {allProfiles.length}
                  </span>
                </button>
              </div>
              <div className="flex items-center gap-2">
                {selectedPost && (
                  <div className="text-[10px] text-gray-500 flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-full">
                    <Target size={9} className="text-blue-500" />
                    <span className="font-medium truncate max-w-[100px]">{selectedPost.title}</span>
                  </div>
                )}
                {selectedPost && !bulkMatching && checkedIds.size > 0 && (
                  <button
                    onClick={bulkMatch}
                    className="flex items-center gap-1 text-[10px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    <Zap size={9} /> Bulk Match ({checkedIds.size})
                  </button>
                )}
                {bulkMatching && (
                  <button
                    onClick={() => { bulkAbortRef.current = true; }}
                    className="flex items-center gap-1 text-[10px] font-semibold bg-red-500 hover:bg-red-600 text-white px-2.5 py-1.5 rounded-lg transition-colors"
                  >
                    <StopCircle size={9} /> Stop
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={toggleSelectAll}
                disabled={filteredProfiles.length === 0 || bulkMatching}
                className="flex items-center gap-1 text-[10px] font-semibold text-gray-500 hover:text-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {checkedIds.size > 0 && checkedIds.size === filteredProfiles.length ? (
                  <CheckSquare size={12} className="text-blue-500" />
                ) : (
                  <Square size={12} />
                )}
                {checkedIds.size > 0 ? `${checkedIds.size} selected` : 'Select all'}
              </button>
              {bulkMatching && (
                <div className="flex items-center gap-2 flex-1">
                  <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                      style={{ width: `${bulkProgress.total ? (bulkProgress.current / bulkProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-500 font-medium shrink-0">{bulkProgress.current}/{bulkProgress.total}</span>
                </div>
              )}
              <div className="relative flex-1">
                <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={candidateSearch}
                  onChange={e => { setCandidateSearch(e.target.value); setPage(0); }}
                  placeholder="Search candidates..."
                  className="w-full pl-7 pr-3 py-1.5 text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 placeholder:text-gray-400"
                />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {loadingProfiles || hotlistLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <LogoSpinner size={20} />
                <p className="text-xs text-gray-500 font-medium">Loading candidates...</p>
              </div>
            ) : filteredProfiles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center">
                  {candidateTab === 'hotlist' ? <Target size={20} className="text-gray-300" /> : <Search size={20} className="text-gray-300" />}
                </div>
                <p className="text-xs text-gray-500 font-medium">
                  {candidateTab === 'hotlist' ? 'No candidates on hotlist' : 'No candidates found'}
                </p>
                <p className="text-[10px] text-gray-400 max-w-[200px]">
                  {candidateSearch ? 'Try a different search term' : candidateTab === 'hotlist' ? 'Add candidates from the Bench page to build your hotlist' : 'Add candidates to your bench first'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {paginatedProfiles.map((p) => {
                  const isSelected = selectedCandidate?.profile.id === p.id;
                  const isChecked = checkedIds.has(p.id);
                  const bulkResult = bulkResults.get(p.id);
                  return (
                    <div
                      key={p.id}
                      className={`bg-white rounded-xl border px-4 py-3 transition-all cursor-pointer hover:shadow-md ${
                        isSelected ? 'border-blue-300 shadow-md ring-1 ring-blue-100' : isChecked ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200 hover:border-gray-300'
                      }`}
                      onClick={() => {
                        const br = bulkResults.get(p.id);
                        setSelectedCandidate({ profile: p, score: br?.score ?? 0, reason: br?.summary ?? '' });
                        setDetailedScore(br ?? null);
                        setEmailDraft(null);
                      }}
                    >
                      <div className="flex items-start gap-2.5">
                        <button
                          onClick={e => { e.stopPropagation(); toggleCheck(p.id); }}
                          className="shrink-0 mt-0.5 text-gray-300 hover:text-blue-500 transition-colors"
                        >
                          {isChecked ? <CheckSquare size={14} className="text-blue-500" /> : <Square size={14} />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-bold text-gray-800 truncate">{p.candidate_name}</p>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {bulkResult && (
                                <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                                  bulkResult.score >= 75 ? 'bg-emerald-100 text-emerald-700' :
                                  bulkResult.score >= 50 ? 'bg-amber-100 text-amber-700' :
                                  'bg-red-100 text-red-600'
                                }`}>{bulkResult.score}</span>
                              )}
                              {selectedPost ? (
                                <button
                                  onClick={e => { e.stopPropagation(); scoreCandidate(p); }}
                                  disabled={scoring && selectedCandidate?.profile.id === p.id}
                                  className="flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50 px-2 py-1 rounded-lg transition-colors"
                                >
                                  {scoring && selectedCandidate?.profile.id === p.id ? <LogoSpinner size={9} /> : <Zap size={9} />}
                                  Match
                                </button>
                              ) : (
                                <span className="text-[9px] text-gray-300 italic">Select a job first</span>
                              )}
                            </div>
                          </div>
                          <p className="text-[11px] text-gray-500 truncate mt-0.5">{p.target_role}</p>
                          {bulkResult && (
                            <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-1">{bulkResult.summary}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            {(p.location || p.city) && (
                              <span className="text-[9px] text-gray-400 flex items-center gap-0.5">
                                <MapPin size={8} />{p.location || p.city}
                              </span>
                            )}
                            {p.years_experience && (
                              <span className="text-[9px] text-gray-400 flex items-center gap-0.5">
                                <Briefcase size={8} />{p.years_experience}yr
                              </span>
                            )}
                            {p.core_skills && (
                              <span className="text-[9px] text-gray-400 flex items-center gap-0.5">
                                <Tag size={8} />{p.core_skills.split(',').slice(0, 2).map(s => s.trim()).join(', ')}
                              </span>
                            )}
                          </div>
                          {selectedPost && (
                            <div className="mt-2 pt-1.5 border-t border-gray-100 flex items-center gap-1.5 flex-wrap">
                              {savedMap.has(p.id) ? (
                                <button
                                  onClick={e => { e.stopPropagation(); unsaveJobForCandidate(p.id); }}
                                  disabled={savingIds.has(p.id)}
                                  className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 px-2 py-1 rounded-lg transition-colors"
                                >
                                  <Bookmark size={9} className="fill-emerald-600" /> In Queue
                                </button>
                              ) : (
                                <button
                                  onClick={e => { e.stopPropagation(); saveJobForCandidate(p.id); }}
                                  disabled={savingIds.has(p.id)}
                                  className="flex items-center gap-1 text-[10px] font-semibold text-gray-600 hover:text-blue-600 bg-gray-100 hover:bg-blue-50 disabled:opacity-50 px-2 py-1 rounded-lg transition-colors"
                                >
                                  {savingIds.has(p.id) ? <LogoSpinner size={9} /> : <Bookmark size={9} />} Add to Queue
                                </button>
                              )}
                              {resumeAiQueuedIds.has(p.id) ? (
                                <button
                                  disabled
                                  className="flex items-center gap-1 text-[10px] font-semibold text-teal-600 bg-teal-50 px-2 py-1 rounded-lg"
                                >
                                  <Check size={9} /> Resume AI Queued
                                </button>
                              ) : (
                                <button
                                  onClick={e => { e.stopPropagation(); addToResumeAiQueue(p.id); }}
                                  disabled={queuingResumeAi.has(p.id)}
                                  className="flex items-center gap-1 text-[10px] font-semibold text-gray-600 hover:text-teal-600 bg-gray-100 hover:bg-teal-50 disabled:opacity-50 px-2 py-1 rounded-lg transition-colors"
                                >
                                  {queuingResumeAi.has(p.id) ? <LogoSpinner size={9} /> : <FileUp size={9} />} Resume AI
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-3 pt-3 pb-1">
                    <button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="flex items-center gap-1 text-[11px] font-semibold text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:text-blue-600 transition-colors"
                    >
                      <ChevronLeft size={12} /> Prev
                    </button>
                    <span className="text-[10px] text-gray-400 font-medium">
                      Page {page + 1} of {totalPages}
                    </span>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="flex items-center gap-1 text-[11px] font-semibold text-gray-600 disabled:text-gray-300 disabled:cursor-not-allowed hover:text-blue-600 transition-colors"
                    >
                      Next <ChevronRight size={12} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Column 3: Match Analysis ── */}
        <div className="col-span-4 bg-white flex flex-col overflow-hidden">
          <div className="border-b border-gray-200 px-5 py-3 shrink-0">
            <h2 className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
              <Zap size={12} className="text-blue-500" />
              Match Analysis
            </h2>
            {selectedCandidate && (
              <p className="text-[10px] text-gray-400 mt-0.5">
                {selectedCandidate.profile.candidate_name} vs {selectedPost?.title || 'job'}
              </p>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {!selectedCandidate || !selectedPost ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center">
                  <Zap size={20} className="text-blue-300" />
                </div>
                <p className="text-xs text-gray-500 font-medium">No candidate selected</p>
                <p className="text-[10px] text-gray-400 max-w-[220px]">
                  Select a job post and click "Match" on a candidate to see detailed analysis here
                </p>
              </div>
            ) : scoring ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <LogoSpinner size={20} />
                <p className="text-xs text-gray-500 font-medium">Running AI match analysis...</p>
                <p className="text-[10px] text-gray-400">Comparing candidate skills against job requirements</p>
              </div>
            ) : detailedScore ? (
              <div className="space-y-5">
                {/* Candidate + Score header */}
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-blue-600">{selectedCandidate.profile.candidate_name[0]?.toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{selectedCandidate.profile.candidate_name}</p>
                    <p className="text-[11px] text-gray-500 truncate">{selectedCandidate.profile.target_role}</p>
                  </div>
                  <div className={`text-2xl font-black ${scoreColor(detailedScore.score)}`}>{detailedScore.score}</div>
                </div>

                {/* Score bar */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Match Score</span>
                    <span className={`text-[10px] font-semibold ${scoreColor(detailedScore.score)}`}>
                      {detailedScore.score >= 75 ? 'Strong Match' : detailedScore.score >= 50 ? 'Moderate Match' : 'Weak Match'}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        detailedScore.score >= 75 ? 'bg-emerald-500' : detailedScore.score >= 50 ? 'bg-amber-500' : 'bg-red-400'
                      }`}
                      style={{ width: `${detailedScore.score}%` }}
                    />
                  </div>
                </div>

                {/* Summary */}
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Summary</span>
                  <p className="text-xs text-gray-700 mt-1.5 leading-relaxed">{detailedScore.summary}</p>
                </div>

                {/* Strengths */}
                <div>
                  <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wide">Strengths</span>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {detailedScore.strengths.map((s, i) => (
                      <span key={i} className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-1 rounded-lg font-medium">{s}</span>
                    ))}
                  </div>
                </div>

                {/* Gaps */}
                <div>
                  <span className="text-[10px] font-bold text-red-500 uppercase tracking-wide">Gaps</span>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {detailedScore.gaps.map((g, i) => (
                      <span key={i} className="text-[10px] bg-red-50 text-red-600 border border-red-100 px-2 py-1 rounded-lg font-medium">{g}</span>
                    ))}
                  </div>
                </div>

                {/* Save + Email actions */}
                <div className="pt-3 border-t border-gray-100 space-y-3">
                  {savedMap.has(selectedCandidate.profile.id) ? (
                    <button
                      onClick={() => unsaveJobForCandidate(selectedCandidate.profile.id)}
                      disabled={savingIds.has(selectedCandidate.profile.id)}
                      className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 px-4 py-2.5 rounded-xl transition-colors"
                    >
                      <Bookmark size={12} className="fill-emerald-600" /> Added to Submission
                    </button>
                  ) : (
                    <button
                      onClick={() => saveJobForCandidate(selectedCandidate.profile.id)}
                      disabled={savingIds.has(selectedCandidate.profile.id)}
                      className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 disabled:opacity-50 px-4 py-2.5 rounded-xl transition-colors"
                    >
                      {savingIds.has(selectedCandidate.profile.id) ? <LogoSpinner size={12} /> : <Bookmark size={12} />} Add to Submission Queue
                    </button>
                  )}

                  {/* Add to Resume AI Queue button */}
                  {resumeAiQueuedIds.has(selectedCandidate.profile.id) ? (
                    <div className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-4 py-2.5 rounded-xl">
                      <Check size={12} /> Added to Resume AI Queue
                    </div>
                  ) : (
                    <button
                      onClick={() => addToResumeAiQueue(selectedCandidate.profile.id)}
                      disabled={queuingResumeAi.has(selectedCandidate.profile.id)}
                      className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-orange-600 bg-orange-50 hover:bg-orange-100 border border-orange-200 disabled:opacity-50 px-4 py-2.5 rounded-xl transition-colors"
                    >
                      {queuingResumeAi.has(selectedCandidate.profile.id) ? <LogoSpinner size={12} /> : <FileUp size={12} />} Add to Resume AI Queue
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center">
                  <Target size={20} className="text-gray-300" />
                </div>
                <p className="text-xs text-gray-500 font-medium">Ready to analyze</p>
                <p className="text-[10px] text-gray-400 max-w-[220px]">
                  Click "Match" on a candidate card to run AI analysis against the selected job
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Job Post Detail Modal ── */}
      {viewingPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setViewingPost(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal header */}
            <div className="px-6 py-4 border-b border-gray-100 shrink-0">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-bold text-gray-900 leading-tight">
                    {viewingPost.title || 'Untitled Position'}
                  </h3>
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    {viewingPost.company && (
                      <span className="text-xs text-gray-600 font-medium flex items-center gap-1">
                        <Briefcase size={11} className="text-gray-400" />{viewingPost.company}
                      </span>
                    )}
                    {viewingPost.location && (
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <MapPin size={11} className="text-gray-400" />{viewingPost.location}
                      </span>
                    )}
                    {viewingPost.employment_type && (
                      <span className="text-[10px] font-semibold bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                        {viewingPost.employment_type}
                      </span>
                    )}
                    {viewingPost.experience_years && (
                      <span className="text-[10px] font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        {viewingPost.experience_years}+ years
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => setViewingPost(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
              {/* AI Summary */}
              {viewingPost.summary && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Sparkles size={11} className="text-blue-500" />
                    <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wide">AI Summary</span>
                  </div>
                  <p className="text-xs text-gray-700 leading-relaxed">{viewingPost.summary}</p>
                </div>
              )}

              {/* Skills */}
              {viewingPost.skills.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Required Skills</span>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {viewingPost.skills.map((skill, i) => (
                      <span key={i} className="text-[11px] bg-gray-100 text-gray-700 px-2.5 py-1 rounded-lg font-medium">
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Full Description */}
              <div>
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Full Description</span>
                <div className="mt-2 bg-gray-50 border border-gray-100 rounded-xl p-4">
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                    {viewingPost.raw_description}
                  </pre>
                </div>
              </div>

              {/* Metadata */}
              <div className="flex items-center gap-3 text-[10px] text-gray-400 pt-1">
                <span className="flex items-center gap-1">
                  <Clock size={9} />
                  Added {new Date(viewingPost.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
                {memberNames.get(viewingPost.user_id) && (
                  <span className="flex items-center gap-1">
                    <User size={9} />
                    {memberNames.get(viewingPost.user_id)}
                  </span>
                )}
              </div>

              {/* Source & POC */}
              <div className="border-t border-gray-100 pt-4 space-y-3">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Source & Contact</span>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <label className="text-[10px] font-semibold text-gray-500 mb-1 block">Job Source</label>
                    <select
                      value={viewingPost.source || ''}
                      onChange={e => updatePostField(viewingPost.id, 'source', e.target.value)}
                      className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:border-blue-400 transition-colors"
                    >
                      <option value="">Select source...</option>
                      <option value="Client">Client</option>
                      <option value="Vendor">Vendor</option>
                      <option value="Social Media">Social Media</option>
                      <option value="Others">Others</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-gray-500 mb-1 block">POC Name</label>
                    <input
                      type="text"
                      defaultValue={viewingPost.poc_name || ''}
                      onBlur={e => { if (e.target.value !== (viewingPost.poc_name || '')) updatePostField(viewingPost.id, 'poc_name', e.target.value); }}
                      placeholder="Contact person name"
                      className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:border-blue-400 transition-colors placeholder:text-gray-300"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-gray-500 mb-1 block">POC Email</label>
                    <input
                      type="email"
                      defaultValue={viewingPost.poc_email || ''}
                      onBlur={e => { if (e.target.value !== (viewingPost.poc_email || '')) updatePostField(viewingPost.id, 'poc_email', e.target.value); }}
                      placeholder="email@example.com"
                      className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:border-blue-400 transition-colors placeholder:text-gray-300"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-gray-500 mb-1 block">POC Phone</label>
                    <input
                      type="tel"
                      defaultValue={viewingPost.poc_phone || ''}
                      onBlur={e => { if (e.target.value !== (viewingPost.poc_phone || '')) updatePostField(viewingPost.id, 'poc_phone', e.target.value); }}
                      placeholder="+1 (555) 000-0000"
                      className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:border-blue-400 transition-colors placeholder:text-gray-300"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Modal footer */}
            <div className="px-6 py-3.5 border-t border-gray-100 flex items-center justify-between shrink-0 bg-gray-50/50">
              <button
                onClick={() => { deletePost(viewingPost.id); setViewingPost(null); }}
                className="flex items-center gap-1.5 text-xs font-semibold text-red-500 hover:text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors"
              >
                <Trash2 size={11} /> Delete
              </button>
              <button
                onClick={() => {
                  setSelectedPost(viewingPost);
                  setPage(0);
                  setSelectedCandidate(null);
                  setDetailedScore(null);
                  setEmailDraft(null);
                  setViewingPost(null);
                }}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold px-5 py-2.5 rounded-xl transition-colors"
              >
                <Target size={11} /> Use for Matching
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Popup Modal */}
      {showSchedulePopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowSchedulePopup(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6 animate-in fade-in zoom-in-95" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-slate-900">Schedule Watch</h3>
              <button onClick={() => setShowSchedulePopup(false)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <XCircle size={18} />
              </button>
            </div>

            <p className="text-xs text-gray-500 mb-4 leading-relaxed">
              This will save the job description and create an automated watch schedule to find matching candidates on selected job boards.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Frequency</label>
                <select
                  value={scheduleFrequency}
                  onChange={e => setScheduleFrequency(e.target.value as 'hourly' | 'daily' | 'twice_daily' | 'weekly')}
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
                      onClick={() => setScheduleBoards(prev => {
                        const next = new Set(prev);
                        if (next.has(b.id)) next.delete(b.id); else next.add(b.id);
                        return next;
                      })}
                      className={`text-xs px-3 py-2 rounded-lg border font-medium transition-colors ${
                        scheduleBoards.has(b.id)
                          ? 'bg-blue-50 border-blue-300 text-blue-700'
                          : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {scheduleBoards.has(b.id) && <Check size={10} className="inline mr-1" />}
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-gray-100">
              <button onClick={() => setShowSchedulePopup(false)} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors">
                Cancel
              </button>
              <button
                onClick={createSchedule}
                disabled={scheduleBoards.size === 0 || savingSchedule}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
              >
                {savingSchedule ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />}
                Create Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
