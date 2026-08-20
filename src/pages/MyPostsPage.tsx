import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Briefcase, Building2, Eye, MapPin, MessageSquare, Pencil, Plus, RotateCcw,
  Search, Trash2, UserRound, X, XCircle,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import Toast from '../components/Toast';
import LogoSpinner from '../components/LogoSpinner';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { supabase } from '../lib/supabase';
import PostFormModal, { type PostKind, type UserPost } from '../components/posts/PostFormModal';

type Tab = 'job' | 'hotlist';

const CARD_PALETTE = [
  { border: 'border-blue-100', titleColor: '#38BDF8' },
  { border: 'border-violet-100', titleColor: '#FACC15' },
  { border: 'border-emerald-100', titleColor: '#34D399' },
  { border: 'border-amber-100', titleColor: '#FB7185' },
  { border: 'border-rose-100', titleColor: '#C084FC' },
  { border: 'border-cyan-100', titleColor: '#FB923C' },
];

function hexToRgbChannels(hex: string): string {
  const cleaned = hex.replace('#', '').trim();
  const value = Number.parseInt(cleaned, 16);
  if (Number.isNaN(value)) return '56 189 248';
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

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

export default function MyPostsPage() {
  const { account } = useAuth();
  const { isDark } = useTheme();
  const [tab, setTab] = useState<Tab>('job');
  const [searchQuery, setSearchQuery] = useState('');
  const [jobPosts, setJobPosts] = useState<UserPost[]>([]);
  const [hotlistPosts, setHotlistPosts] = useState<UserPost[]>([]);
  const [metricsByPostId, setMetricsByPostId] = useState<Record<string, { previewCount: number; chatCount: number }>>({});
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState<PostKind | null>(null);
  const [editingPost, setEditingPost] = useState<UserPost | null>(null);
  const [previewPost, setPreviewPost] = useState<UserPost | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

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
      const metricsRows = (metricsResult.data ?? []) as Array<{ post_id: string; preview_count: number; chat_count: number }>;
      const next: Record<string, { previewCount: number; chatCount: number }> = {};
      for (const row of metricsRows) {
        next[row.post_id] = { previewCount: row.preview_count ?? 0, chatCount: row.chat_count ?? 0 };
      }
      setMetricsByPostId(next);
    }

    setLoading(false);
  }, [account?.id]);

  useEffect(() => {
    void loadPosts();
  }, [loadPosts]);

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

  const posts = tab === 'job' ? jobPosts : hotlistPosts;
  const filteredPosts = useMemo(
    () => posts.filter((post) => matchesSearch(post, searchQuery)),
    [posts, searchQuery],
  );

  return (
    <div className="h-[100dvh] overflow-hidden overscroll-none bg-white text-gray-900 flex flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-0 dark:bg-[#1B1D21] dark:text-slate-100">
      <AppNav />

      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="h-full w-full flex flex-col overflow-hidden px-2 py-2">
          <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
            <div className="relative flex min-w-[200px] flex-1 items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-white/10 dark:bg-[#20242a]">
              <Search size={11} className="text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search your posts by title, company, location, skills"
                className="w-full border-0 bg-transparent text-[11px] text-gray-700 outline-none placeholder:text-gray-400 dark:text-slate-200 dark:placeholder:text-[#64748B]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="rounded-full p-0.5 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-600 dark:hover:bg-white/10"
                  aria-label="Clear search"
                >
                  <X size={11} />
                </button>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {([
                { id: 'job' as Tab, label: 'Jobs', icon: Briefcase, count: jobPosts.length },
                { id: 'hotlist' as Tab, label: 'Hotlist', icon: UserRound, count: hotlistPosts.length },
              ]).map((tabDef) => {
                const isSelected = tab === tabDef.id;
                const Icon = tabDef.icon;
                return (
                  <button
                    key={tabDef.id}
                    type="button"
                    onClick={() => setTab(tabDef.id)}
                    className={`inline-flex items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[10px] font-semibold transition ${isSelected ? (isDark ? 'border border-white/25 bg-[#2A2E35] text-slate-100' : 'border border-blue-600 bg-blue-600 text-white') : (isDark ? 'border border-gray-200 bg-gray-50 text-gray-600 hover:bg-gray-100' : 'border border-blue-200 bg-white text-blue-600 hover:bg-blue-50')}`}
                  >
                    <Icon size={11} />
                    <span>{tabDef.label}</span>
                    <span>{tabDef.count}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => { setEditingPost(null); setFormOpen(tab); }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-blue-600 bg-blue-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-blue-700"
            >
              <Plus size={13} />
              Add Post
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-16"><LogoSpinner size={22} /></div>
            ) : filteredPosts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-xs font-semibold text-gray-500 dark:text-slate-400">
                  {posts.length === 0 ? `No ${tab === 'job' ? 'job' : 'hotlist'} posts yet` : 'No posts match your search'}
                </p>
                <p className="mt-1 text-[11px] text-gray-400 dark:text-[#64748B]">
                  {posts.length === 0 ? 'Create one to start getting responses from other recruiters on ProfilePush.' : 'Try a different search term.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredPosts.map((post, idx) => {
              const palette = CARD_PALETTE[idx % CARD_PALETTE.length];
              const accentRgb = hexToRgbChannels(palette.titleColor);
              const cardBorderColor = `rgb(${accentRgb} / 0.45)`;
              const titleToneStyle = { color: isDark ? '#FFFFFF' : '#2563EB' };
              const metrics = metricsByPostId[post.id] ?? { previewCount: 0, chatCount: 0 };
              const displayTitle = post.kind === 'hotlist' && post.candidateName
                ? `${post.title || 'Available Consultant'} — ${post.candidateName}`
                : (post.title || 'Job Opportunity');
              const locationText = post.kind === 'job' ? post.location : post.locations.join(', ');

              return (
                <div
                  key={post.id}
                  className={`relative min-w-0 rounded-lg border bg-white px-3 py-2.5 dark:bg-[#1E2126] ${palette.border}`}
                  style={{ borderColor: cardBorderColor }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-semibold leading-snug" style={titleToneStyle}>{displayTitle}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] text-[#94A3B8]">
                        <span>Posted {formatAgo(post.createdAt)}</span>
                        {post.kind === 'job' && post.company && (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <span>•</span>
                            <Building2 size={10} className="shrink-0" style={{ color: palette.titleColor }} />
                            <span>{post.company}</span>
                          </span>
                        )}
                        {locationText && (
                          <span className="inline-flex items-center gap-1 whitespace-nowrap">
                            <span>•</span>
                            <MapPin size={10} className="shrink-0" style={{ color: palette.titleColor }} />
                            <span className="truncate">{locationText}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button type="button" onClick={() => { setEditingPost(post); setFormOpen(post.kind); }} title="Edit" className={`rounded p-1 transition-colors ${isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-500 hover:bg-gray-100'}`}>
                        <Pencil size={12} />
                      </button>
                      <button type="button" onClick={() => void handleDelete(post)} title="Delete" className={`rounded p-1 transition-colors ${isDark ? 'text-red-400 hover:bg-red-500/10' : 'text-red-500 hover:bg-red-50'}`}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${post.postStatus === 'open' ? (isDark ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-emerald-200 bg-emerald-50 text-emerald-700') : (isDark ? 'border-white/15 bg-white/5 text-[#94A3B8]' : 'border-gray-200 bg-gray-100 text-gray-500')}`}>
                      {post.postStatus === 'open' ? 'Open' : 'Closed'}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${isDark ? 'border-white/15 bg-white/5 text-slate-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                      <Eye size={9} strokeWidth={2.5} />
                      {metrics.previewCount} preview{metrics.previewCount === 1 ? '' : 's'}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${isDark ? 'border-white/15 bg-white/5 text-slate-300' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                      <MessageSquare size={9} strokeWidth={2.5} />
                      {metrics.chatCount} chat{metrics.chatCount === 1 ? '' : 's'}
                    </span>
                  </div>

                  {post.skills.length > 0 && (
                    <p className="mt-1.5 truncate text-[9px] leading-tight text-gray-500 dark:text-[#94A3B8]">
                      {post.skills.slice(0, 6).join(' · ')}
                    </p>
                  )}

                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPreviewPost(post)}
                      title="Preview post"
                      className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-2 text-[11px] font-semibold text-gray-700 transition-opacity hover:bg-gray-50 dark:border-white/15 dark:bg-transparent dark:text-gray-300 dark:hover:bg-white/5"
                    >
                      <Eye size={13} strokeWidth={2} />
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleStatus(post)}
                      title={post.postStatus === 'open' ? 'Close post' : 'Reopen post'}
                      className={`inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-semibold transition-opacity ${post.postStatus === 'open' ? 'bg-blue-600 text-white hover:bg-blue-700' : (isDark ? 'bg-white/5 text-slate-200 hover:bg-white/10' : 'bg-gray-100 text-gray-700 hover:bg-gray-200')}`}
                    >
                      {post.postStatus === 'open' ? <XCircle size={13} strokeWidth={2} /> : <RotateCcw size={13} strokeWidth={2} />}
                      {post.postStatus === 'open' ? 'Close' : 'Reopen'}
                    </button>
                  </div>
                </div>
              );
            })}
              </div>
            )}
          </div>
        </div>
      </main>

      {formOpen && (
        <PostFormModal
          kind={formOpen}
          existingPost={editingPost}
          onClose={() => { setFormOpen(null); setEditingPost(null); }}
          onSaved={() => { setFormOpen(null); setEditingPost(null); void loadPosts(); }}
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
              <h2 id="my-post-preview-title" className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-slate-100">
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
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-700 dark:text-slate-300">
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
