import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCcw, Search } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import LogoSpinner from './LogoSpinner';
import { supabase } from '../lib/supabase';

type Job = {
  id: string;
  post_id: string;
  posted_by_name: string;
  job_title: string;
  location: string;
  employment_type: string;
  salary_range: string;
  job_category: string | null;
  post_status: string;
  posted_at: string | null;
  created_at: string;
  post_url: string;
  extracted_skills: string[] | null;
  extracted_visa_types: string[] | null;
};

type SiteOption = { slug: string; name: string };

const PAGE_SIZE = 100;

async function callAdmin<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-career-sites', {
    body: { password: sessionStorage.getItem('admin_authed') || '', action, ...extra },
  });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const body = ctx ? await ctx.json().catch(() => null) : null;
    throw new Error(body?.error || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

function formatDate(iso: string | null) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function AdminCareerJobsPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [slug, setSlug] = useState(searchParams.get('site') ?? '');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('open');
  const [days, setDays] = useState('');
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    void callAdmin<{ sites: SiteOption[] }>('list')
      .then((d) => setSites((d.sites ?? []).map((s) => ({ slug: s.slug, name: s.name }))))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await callAdmin<{ jobs: Job[]; total: number }>('jobs', {
        slug, category, status, days: Number(days) || 0, q: appliedQuery, offset: page * PAGE_SIZE, limit: PAGE_SIZE,
      });
      setJobs(d.jobs ?? []);
      setTotal(d.total ?? 0);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }, [slug, category, status, days, appliedQuery, page]);

  useEffect(() => { void load(); }, [load]);

  // Keep the chosen site in the URL so "View jobs" links and refreshes land here.
  const chooseSite = (next: string) => {
    setSlug(next);
    setPage(0);
    const params = new URLSearchParams(searchParams);
    if (next) params.set('site', next); else params.delete('site');
    setSearchParams(params, { replace: true });
  };

  const nameOf = (postId: string) => {
    const s = postId.split(':')[0];
    return sites.find((x) => x.slug === s)?.name ?? s;
  };
  const select = 'h-9 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700 outline-none focus:border-blue-500';
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Career site jobs</p>
          <p className="mt-0.5 text-[11px] text-gray-500">Every job collected from staffing firms' career sites, newest first. {total.toLocaleString()} match.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <select value={slug} onChange={(e) => chooseSite(e.target.value)} className={select}>
            <option value="">All sites</option>
            {sites.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
          </select>
          <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(0); }} className={select}>
            <option value="">IT + Non-IT</option>
            <option value="IT">IT</option>
            <option value="Non-IT">Non-IT</option>
          </select>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }} className={select}>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="">Open + closed</option>
          </select>
          <select value={days} onChange={(e) => { setDays(e.target.value); setPage(0); }} className={select}>
            <option value="">Any date</option>
            <option value="1">Posted last 24h</option>
            <option value="3">Last 3 days</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
          <form
            onSubmit={(e) => { e.preventDefault(); setAppliedQuery(query.trim()); setPage(0); }}
            className="flex h-9 items-center rounded-md border border-gray-300 bg-white px-2"
          >
            <Search size={12} className="text-gray-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title or location" className="w-36 bg-transparent px-1.5 text-xs outline-none" />
          </form>
          <button onClick={() => void load()} disabled={loading} title="Refresh" className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCcw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

      {loading && jobs.length === 0 ? (
        <div className="flex justify-center py-10"><LogoSpinner size={18} /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-xs">
            <thead className="bg-gray-50 text-[10px] font-medium uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-3 py-2.5 font-medium">Job</th>
                <th className="px-3 py-2.5 font-medium">Firm</th>
                <th className="px-3 py-2.5 font-medium">Location</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Pay</th>
                <th className="px-3 py-2.5 font-medium">Category</th>
                <th className="px-3 py-2.5 font-medium">Skills</th>
                <th className="px-3 py-2.5 font-medium">Posted</th>
                <th className="px-3 py-2.5 font-medium">Added</th>
              </tr>
            </thead>
            <tbody className={loading ? 'opacity-60' : ''}>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-gray-100 align-top hover:bg-gray-50">
                  <td className="max-w-[280px] px-3 py-2">
                    <a href={j.post_url} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 font-semibold text-blue-700 hover:underline">
                      <span>{j.job_title}</span><ExternalLink size={10} className="mt-0.5 shrink-0" />
                    </a>
                    {j.post_status === 'closed' && <span className="ml-1.5 rounded bg-gray-100 px-1 text-[10px] text-gray-500">closed</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{j.posted_by_name || nameOf(j.post_id)}</td>
                  <td className="px-3 py-2 text-gray-600">{j.location || '-'}</td>
                  <td className="px-3 py-2 text-gray-600">{j.employment_type || '-'}</td>
                  <td className="px-3 py-2 tabular-nums text-gray-700">{j.salary_range || '-'}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${j.job_category === 'Non-IT' ? 'bg-slate-100 text-slate-600' : 'bg-blue-50 text-blue-700'}`}>
                      {j.job_category === 'Non-IT' ? 'Non-IT' : 'IT'}
                    </span>
                  </td>
                  <td className="max-w-[240px] px-3 py-2 text-[11px] text-gray-500">{(j.extracted_skills ?? []).slice(0, 5).join(', ') || '-'}</td>
                  <td className="px-3 py-2 text-gray-600">{formatDate(j.posted_at)}</td>
                  <td className="px-3 py-2 text-gray-400">{formatDate(j.created_at)}</td>
                </tr>
              ))}
              {jobs.length === 0 && !loading && (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-gray-400">No jobs match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2.5 text-xs text-gray-600">
        <span>Page {page + 1} of {pages}</span>
        <div className="flex gap-2">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loading} className="h-8 rounded-md border border-gray-300 px-3 font-semibold hover:bg-gray-50 disabled:opacity-40">Previous</button>
          <button onClick={() => setPage((p) => p + 1)} disabled={page + 1 >= pages || loading} className="h-8 rounded-md border border-gray-300 px-3 font-semibold hover:bg-gray-50 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
