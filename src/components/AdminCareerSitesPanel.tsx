import { useCallback, useEffect, useMemo, useState } from 'react';
import { Briefcase, Building2, ExternalLink, Pencil, Play, Plus, RefreshCcw, Trash2, X } from 'lucide-react';
import LogoSpinner from './LogoSpinner';
import { supabase } from '../lib/supabase';

type SiteKind = 'builtin' | 'sitemap_jsonld' | 'jobdiva' | 'greenhouse' | 'lever' | 'workday' | 'adzuna' | 'jooble' | 'none';

type Site = {
  slug: string;
  name: string;
  kind: SiteKind;
  config: Record<string, string>;
  careers_url: string | null;
  enabled: boolean;
  max_new_per_run: number;
  notes: string | null;
};

type Overview = {
  slug: string; open_it: number; open_non_it: number; added_24h: number; added_7d: number;
  rejected_total: number; runs_24h: number; accepted_24h: number; last_run_at: string | null;
};

type Run = {
  id: number; slug: string; started_at: string; finished_at: string; full_sync: boolean; listed: number;
  new_found: number; non_it_found: number; processed: number; fetched: number; failed: number;
  accepted: number; rejected: number; closed: number; error: string | null;
};

type TestResult = {
  listed: number;
  total: number | null;
  samples: Array<{ title: string; city?: string | null; state?: string | null; employment_type?: string | null; pay_min?: number | null; pay_max?: number | null; pay_unit?: string | null; date_posted?: string | null; url: string }>;
};

const KIND_LABEL: Record<SiteKind, string> = {
  builtin: 'Built-in',
  sitemap_jsonld: 'Job sitemap',
  jobdiva: 'JobDiva portal',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  workday: 'Workday',
  adzuna: 'Adzuna job board',
  jooble: 'Jooble job board',
  none: 'Needs adapter',
};

// What to paste for each type, and which config key it fills.
const KIND_FIELDS: Record<Exclude<SiteKind, 'builtin'>, Array<{ key: string; label: string; placeholder: string }>> = {
  none: [],
  sitemap_jsonld: [
    { key: 'sitemap_url', label: 'Sitemap URL', placeholder: 'https://jobs.example.com/sitemap.xml' },
    { key: 'url_contains', label: 'Job URLs contain', placeholder: '/job' },
  ],
  jobdiva: [{ key: 'url', label: 'JobDiva portal link', placeholder: 'https://www2.jobdiva.com/portal/?a=...' }],
  greenhouse: [{ key: 'url', label: 'Greenhouse board link', placeholder: 'https://boards.greenhouse.io/company' }],
  lever: [{ key: 'url', label: 'Lever link', placeholder: 'https://jobs.lever.co/company' }],
  workday: [{ key: 'url', label: 'Workday careers link', placeholder: 'https://company.wd5.myworkdayjobs.com/External' }],
  adzuna: [
    { key: 'category', label: 'Adzuna category', placeholder: 'it-jobs (or healthcare-nursing-jobs)' },
    { key: 'what', label: 'Keywords (optional)', placeholder: 'developer' },
  ],
  jooble: [
    { key: 'keywords', label: 'Keywords', placeholder: 'contract developer' },
    { key: 'location', label: 'Location', placeholder: 'USA' },
  ],
};

const EMPTY_FORM = { slug: '', name: '', kind: 'greenhouse' as SiteKind, config: {} as Record<string, string>, careers_url: '', max_new_per_run: 60, notes: '', enabled: true };

async function callAdmin<T>(action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-career-sites', {
    body: { password: sessionStorage.getItem('admin_authed') || '', action, ...extra },
  });
  if (error) {
    // The function's own message is in the response body.
    const ctx = (error as { context?: Response }).context;
    const body = ctx ? await ctx.json().catch(() => null) : null;
    throw new Error(body?.error || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

function ago(iso: string | null) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 48 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function AdminCareerSitesPanel({ onViewJobs }: { onViewJobs?: (slug: string) => void }) {
  const [sites, setSites] = useState<Site[]>([]);
  const [overview, setOverview] = useState<Record<string, Overview>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [runFilter, setRunFilter] = useState('');
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [form, setForm] = useState<typeof EMPTY_FORM | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const d = await callAdmin<{ sites: Site[]; overview: Overview[]; runs: Run[] }>('list');
      setSites(d.sites ?? []);
      setOverview(Object.fromEntries((d.overview ?? []).map((o) => [o.slug, o])));
      setRuns(d.runs ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => {
    const o = Object.values(overview);
    const sum = (k: keyof Overview) => o.reduce((n, x) => n + Number(x[k] ?? 0), 0);
    return {
      enabled: sites.filter((s) => s.enabled).length,
      openIt: sum('open_it'),
      openNonIt: sum('open_non_it'),
      added24h: sum('added_24h'),
      lastRun: runs[0]?.started_at ?? null,
    };
  }, [overview, sites, runs]);

  const lastRunBySlug = useMemo(() => {
    const m: Record<string, Run> = {};
    for (const r of runs) if (!m[r.slug]) m[r.slug] = r;
    return m;
  }, [runs]);

  const shownRuns = runFilter ? runs.filter((r) => r.slug === runFilter) : runs;
  const nameOf = (slug: string) => sites.find((s) => s.slug === slug)?.name ?? slug;

  const act = async (slug: string, fn: () => Promise<unknown>, message: string) => {
    setBusySlug(slug);
    setNotice('');
    setError('');
    try {
      await fn();
      setNotice(message);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
    setBusySlug(null);
  };

  const openEdit = (site?: Site) => {
    setTest(null);
    setFormError('');
    if (!site) { setForm({ ...EMPTY_FORM }); return; }
    const config = { ...site.config };
    if (site.kind === 'jobdiva' && config.portal_key) config.url = config.portal_key;
    if (site.kind === 'greenhouse' && config.board) config.url = config.board;
    if (site.kind === 'lever' && config.company) config.url = config.company;
    setForm({ slug: site.slug, name: site.name, kind: site.kind, config, careers_url: site.careers_url ?? '', max_new_per_run: site.max_new_per_run, notes: site.notes ?? '', enabled: site.enabled });
  };

  const runTest = async () => {
    if (!form || form.kind === 'builtin') return;
    setTesting(true);
    setTest(null);
    setFormError('');
    try {
      setTest(await callAdmin<TestResult>('test', { kind: form.kind, config: form.config }));
    } catch (e) {
      setFormError((e as Error).message);
    }
    setTesting(false);
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setFormError('');
    try {
      await callAdmin('save', { site: form });
      setForm(null);
      setNotice(`Saved ${form.name}. It is picked up on the next hourly run.`);
      await load();
    } catch (e) {
      setFormError((e as Error).message);
    }
    setSaving(false);
  };

  const input = 'h-9 w-full rounded-md border border-gray-300 bg-white px-2.5 text-xs text-gray-800 outline-none focus:border-blue-500';

  return (
    <div className="mt-4 space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900"><Building2 size={14} className="text-emerald-600" />Career sites</p>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Requirements taken straight from staffing firms' own career sites. Runs every hour at :05 UTC; the 06:05 UTC run
              also re-reads each full listing and closes jobs the site has removed. US contract roles are kept, IT first.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => openEdit()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700">
              <Plus size={13} />Add site
            </button>
            <button onClick={() => void load()} disabled={loading} title="Refresh" className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              <RefreshCcw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 px-4 py-3 sm:grid-cols-5">
          <div><p className="text-[10px] uppercase text-gray-400">Sites on</p><p className="text-lg font-semibold tabular-nums text-gray-900">{totals.enabled} / {sites.length}</p></div>
          <div><p className="text-[10px] uppercase text-gray-400">Open IT jobs</p><p className="text-lg font-semibold tabular-nums text-blue-700">{totals.openIt.toLocaleString()}</p></div>
          <div><p className="text-[10px] uppercase text-gray-400">Open Non-IT jobs</p><p className="text-lg font-semibold tabular-nums text-slate-700">{totals.openNonIt.toLocaleString()}</p></div>
          <div><p className="text-[10px] uppercase text-gray-400">Added last 24h</p><p className="text-lg font-semibold tabular-nums text-emerald-700">{totals.added24h.toLocaleString()}</p></div>
          <div><p className="text-[10px] uppercase text-gray-400">Last run</p><p className="text-lg font-semibold text-gray-900">{ago(totals.lastRun)}</p></div>
        </div>

        {error && <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}
        {notice && <div className="border-t border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">{notice}</div>}

        {loading && sites.length === 0 ? (
          <div className="flex justify-center py-10"><LogoSpinner size={18} /></div>
        ) : (
          <div className="overflow-x-auto border-t border-gray-200">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-gray-50 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Site</th>
                  <th className="px-3 py-2.5 font-medium">Type</th>
                  <th className="px-3 py-2.5 text-center font-medium">On</th>
                  <th className="px-3 py-2.5 text-right font-medium">Open IT</th>
                  <th className="px-3 py-2.5 text-right font-medium">Open Non-IT</th>
                  <th className="px-3 py-2.5 text-right font-medium">Added 24h</th>
                  <th className="px-3 py-2.5 text-right font-medium">Per run</th>
                  <th className="px-3 py-2.5 font-medium">Last run</th>
                  <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => {
                  const o = overview[site.slug];
                  const last = lastRunBySlug[site.slug];
                  return (
                    <tr key={site.slug} className={`border-t border-gray-100 hover:bg-gray-50 ${site.enabled ? '' : 'opacity-60'}`}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5 font-semibold text-gray-900">
                          {site.name}
                          {site.careers_url && (
                            <a href={site.careers_url} target="_blank" rel="noreferrer" title="Open careers site" className="text-gray-400 hover:text-blue-600"><ExternalLink size={11} /></a>
                          )}
                        </div>
                        {site.notes && <p className="mt-0.5 text-[10px] text-gray-400">{site.notes}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{KIND_LABEL[site.kind]}</td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={site.enabled}
                          disabled={busySlug === site.slug || site.kind === 'none'}
                          title={site.kind === 'none' ? 'Needs an adapter before it can run' : undefined}
                          onClick={() => void act(site.slug, () => callAdmin('toggle', { slug: site.slug, enabled: !site.enabled }), `${site.name} switched ${site.enabled ? 'off' : 'on'}.`)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${site.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}
                        >
                          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${site.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-blue-700">{Number(o?.open_it ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{Number(o?.open_non_it ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{Number(o?.added_24h ?? 0).toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{site.max_new_per_run}</td>
                      <td className="px-3 py-2.5">
                        {last ? (
                          <div>
                            <span className="text-gray-700">{ago(last.started_at)}</span>
                            <span className="ml-1.5 text-[10px] text-gray-400">listed {last.listed.toLocaleString()} · +{last.accepted}</span>
                            {last.error && <p className="mt-0.5 max-w-[220px] truncate text-[10px] text-red-600" title={last.error}>{last.error}</p>}
                          </div>
                        ) : <span className="text-gray-400">no runs yet</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => void act(site.slug, () => callAdmin('run', { slug: site.slug }), `Queued a run for ${site.name}. Results appear below in a few minutes.`)}
                            disabled={busySlug === site.slug || site.kind === 'none'}
                            title={site.kind === 'none' ? 'Needs an adapter before it can run' : 'Run now'}
                            className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                          >
                            {busySlug === site.slug ? <LogoSpinner size={11} /> : <Play size={12} />}
                          </button>
                          {onViewJobs && (
                            <button onClick={() => onViewJobs(site.slug)} title="View jobs" className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-100"><Briefcase size={12} /></button>
                          )}
                          <button onClick={() => openEdit(site)} title="Edit" className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-100"><Pencil size={12} /></button>
                          {site.kind !== 'builtin' && (
                            <button
                              onClick={() => {
                                if (window.confirm(`Delete ${site.name}? Its jobs will be closed.`)) {
                                  void act(site.slug, () => callAdmin('delete', { slug: site.slug }), `Deleted ${site.name}.`);
                                }
                              }}
                              title="Delete"
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-red-600 hover:bg-red-50"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">Runs</p>
            <p className="mt-0.5 text-[11px] text-gray-500">Each run: jobs listed on the site, new to us, IT/Non-IT, pages fetched, stored, turned away and closed.</p>
          </div>
          <select value={runFilter} onChange={(e) => setRunFilter(e.target.value)} className="h-9 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700 outline-none focus:border-blue-500">
            <option value="">All sites</option>
            {sites.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
          </select>
        </div>
        <div className="max-h-[460px] overflow-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="sticky top-0 bg-gray-50 text-[10px] font-medium uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-3 py-2.5 font-medium">Started</th>
                <th className="px-3 py-2.5 font-medium">Site</th>
                <th className="px-3 py-2.5 font-medium">Mode</th>
                <th className="px-3 py-2.5 text-right font-medium">Listed</th>
                <th className="px-3 py-2.5 text-right font-medium">New</th>
                <th className="px-3 py-2.5 text-right font-medium">Of which Non-IT</th>
                <th className="px-3 py-2.5 text-right font-medium">Fetched</th>
                <th className="px-3 py-2.5 text-right font-medium">Stored</th>
                <th className="px-3 py-2.5 text-right font-medium">Turned away</th>
                <th className="px-3 py-2.5 text-right font-medium">Closed</th>
                <th className="px-3 py-2.5 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {shownRuns.map((r) => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-600">{formatTime(r.started_at)}</td>
                  <td className="px-3 py-2 font-medium text-gray-800">{nameOf(r.slug)}</td>
                  <td className="px-3 py-2 text-gray-500">{r.full_sync ? 'Full' : 'Hourly'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.listed.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.new_found.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.non_it_found.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.fetched}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-700">{r.accepted}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.rejected}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.closed}</td>
                  <td className="max-w-[240px] truncate px-3 py-2 text-red-600" title={r.error ?? ''}>{r.error ?? ''}</td>
                </tr>
              ))}
              {shownRuns.length === 0 && !loading && (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-gray-400">No runs recorded yet. Runs are logged from now on.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setForm(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">{form.slug ? `Edit ${form.name}` : 'Add a career site'}</p>
              <button onClick={() => setForm(null)} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-gray-500">Firm name</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Cognizant Staffing" className={input} />
              </label>
              {form.kind === 'builtin' ? (
                <p className="rounded-md bg-gray-50 px-3 py-2 text-[11px] text-gray-500">Built-in site: read by a dedicated adapter, so only its name, limit and notes can be changed here.</p>
              ) : (
                <>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-semibold uppercase text-gray-500">How the site lists jobs</span>
                    <select
                      value={form.kind}
                      onChange={(e) => { setForm({ ...form, kind: e.target.value as SiteKind, config: {} }); setTest(null); }}
                      className={input}
                    >
                      {(Object.keys(KIND_FIELDS) as Array<keyof typeof KIND_FIELDS>).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                    </select>
                    <span className="mt-1 block text-[10px] text-gray-400">
                      Open the firm's careers page: links to boards.greenhouse.io, jobs.lever.co, myworkdayjobs.com or jobdiva.com tell you the type.
                      Otherwise try Job sitemap (most sites list jobs in /sitemap.xml).
                    </span>
                  </label>
                  {KIND_FIELDS[form.kind as keyof typeof KIND_FIELDS].map((f) => (
                    <label key={f.key} className="block">
                      <span className="mb-1 block text-[10px] font-semibold uppercase text-gray-500">{f.label}</span>
                      <input
                        value={form.config[f.key] ?? ''}
                        onChange={(e) => { setForm({ ...form, config: { ...form.config, [f.key]: e.target.value } }); setTest(null); }}
                        placeholder={f.placeholder}
                        className={input}
                      />
                    </label>
                  ))}
                </>
              )}
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-gray-500">Careers page (for reference)</span>
                <input value={form.careers_url} onChange={(e) => setForm({ ...form, careers_url: e.target.value })} placeholder="https://..." className={input} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase text-gray-500">New jobs per run</span>
                  <input type="number" min={1} max={300} value={form.max_new_per_run} onChange={(e) => setForm({ ...form, max_new_per_run: Number(e.target.value) })} className={input} />
                </label>
                <label className="flex items-end gap-2 pb-2">
                  <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                  <span className="text-xs text-gray-700">Scrape this site</span>
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-gray-500">Notes</span>
                <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={input} />
              </label>
            </div>

            {formError && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{formError}</p>}

            {test && (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                <p className="font-semibold">
                  Found {test.listed.toLocaleString()} jobs on the first page{test.total ? ` (${test.total.toLocaleString()} in all)` : ''}.
                </p>
                <ul className="mt-1.5 space-y-1">
                  {test.samples.map((s) => (
                    <li key={s.url} className="truncate">
                      {s.title || '(no title)'} · {[s.city, s.state].filter(Boolean).join(', ') || 'no location'} · {s.employment_type || 'type?'}
                      {s.pay_min ? ` · $${s.pay_min}${s.pay_max && s.pay_max !== s.pay_min ? `–${s.pay_max}` : ''}${s.pay_unit ? `/${String(s.pay_unit).toLowerCase()}` : ''}` : ''}
                    </li>
                  ))}
                  {test.samples.length === 0 && <li>No job details could be read. Check the type and link.</li>}
                </ul>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              {form.kind !== 'builtin' && form.kind !== 'none' && (
                <button onClick={() => void runTest()} disabled={testing} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-300 px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                  {testing ? <LogoSpinner size={12} /> : <Play size={12} />}Test
                </button>
              )}
              <button onClick={() => void save()} disabled={saving || !form.name.trim()} className="inline-flex h-9 items-center rounded-md bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
