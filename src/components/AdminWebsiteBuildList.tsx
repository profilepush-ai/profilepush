import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { SITE_BASE_URL } from '../lib/website-checkout';

// Admin > Websites > Build list: every company domain we know (users, job and
// hotlist posters, contact lists), its current website checked, ranked by
// priority. Filled by scripts/website-build-list.mjs.

type Row = {
  domain: string; company: string | null; side: 'bench' | 'vendor' | 'both' | 'other';
  is_user: boolean; user_persona: string | null; hotlist_posts: number; job_posts: number;
  site_status: 'ok' | 'thin' | 'dead' | 'parked'; words: number; title: string | null; staffing_score: number;
  priority: number; status: 'todo' | 'building' | 'built' | 'skipped'; notes: string | null; checked_at: string | null;
  demo_slug: string | null; claimed: boolean;
};
type Result = { rows: Row[]; count: number; page: number; page_size: number; totals: Record<string, number> };

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const password = sessionStorage.getItem('admin_authed') ?? '';
  const { data, error } = await supabase.functions.invoke('admin-websites', { body: { ...body, password } });
  if (error || data?.error) {
    let msg = data?.error ?? 'Request failed';
    try { const b = await (error as { context?: Response } | null)?.context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep msg */ }
    throw new Error(msg);
  }
  return data as T;
}

const SIDES = [['all', 'All'], ['bench', 'Bench sales'], ['vendor', 'Vendors'], ['both', 'Both'], ['users', 'Our users'], ['other', 'Other']] as const;
const SITES = [['buildable', 'Buildable site'], ['thin', 'Thin site'], ['parked', 'Parked'], ['dead', 'No site'], ['all', 'Any']] as const;
const STATUSES = [['todo', 'To do'], ['building', 'Building'], ['built', 'Built'], ['skipped', 'Skipped'], ['all', 'All']] as const;
const SIDE_TONE: Record<Row['side'], string> = {
  bench: 'bg-amber-50 text-amber-800', vendor: 'bg-sky-50 text-sky-800', both: 'bg-violet-50 text-violet-800', other: 'bg-gray-100 text-gray-600',
};

function Pills<T extends string>({ value, options, onChange }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([id, label]) => (
        <button key={id} onClick={() => onChange(id)} className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold ${value === id ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:text-gray-900'}`}>{label}</button>
      ))}
    </div>
  );
}

export default function AdminWebsiteBuildList() {
  const [side, setSide] = useState<(typeof SIDES)[number][0]>('bench');
  const [site, setSite] = useState<(typeof SITES)[number][0]>('buildable');
  const [status, setStatus] = useState<(typeof STATUSES)[number][0]>('todo');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await call<Result>({ action: 'build_list', side, site, status, q: query, page }));
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    setBusy(false);
  }, [side, site, status, query, page]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(0); }, [side, site, status, query]);

  async function update(domain: string, fields: { status?: Row['status']; notes?: string }) {
    setData(d => (d ? { ...d, rows: d.rows.map(r => (r.domain === domain ? { ...r, ...fields } : r)) } : d));
    try { await call({ action: 'build_update', domain, ...fields }); } catch (e) { setError(e instanceof Error ? e.message : 'Update failed'); void load(); }
  }

  const t = data?.totals;
  const pages = data ? Math.max(1, Math.ceil(data.count / data.page_size)) : 1;

  return (
    <div className="space-y-4">
      {t && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[['Known domains', t.all], ['Buildable sites', t.buildable], ['Buildable bench sales', t.bench_buildable], ['Building', t.building], ['Built', t.built]].map(([l, v]) => (
            <div key={l as string} className="bg-white rounded-xl border border-gray-100 p-3">
              <p className="text-[12px] text-gray-500">{l}</p>
              <p className="text-xl font-extrabold text-gray-900 tabular-nums">{(v as number).toLocaleString('en-IN')}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Pills value={side} options={SIDES} onChange={setSide} />
          <Pills value={site} options={SITES} onChange={setSite} />
          <Pills value={status} options={STATUSES} onChange={setStatus} />
        </div>
        <form onSubmit={e => { e.preventDefault(); setQuery(q); }} className="flex gap-2 max-w-md">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search domain, company or site title" className="w-full rounded-xl border border-gray-200 pl-8 pr-3 py-2 text-sm" />
          </div>
          <button className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm font-semibold">Search</button>
        </form>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
        <div className="flex items-center justify-between px-4 py-2.5 text-[12px] text-gray-500 border-b border-gray-100">
          <span>{data ? `${data.count.toLocaleString('en-IN')} firms · sorted by priority` : 'Loading…'}</span>
          {busy && <Loader2 size={14} className="animate-spin" />}
        </div>
        <table className="w-full min-w-[980px] text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-gray-500">
              <th className="px-4 py-2 font-medium">#</th>
              <th className="py-2 pr-4 font-medium">Firm</th>
              <th className="py-2 pr-4 font-medium">Side</th>
              <th className="py-2 pr-4 font-medium">On ProfilePush</th>
              <th className="py-2 pr-4 font-medium">Current site</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((r, i) => (
              <tr key={r.domain} className="border-t border-gray-100 align-top">
                <td className="px-4 py-3 text-gray-400 tabular-nums">{(data!.page * data!.page_size + i + 1).toLocaleString('en-IN')}</td>
                <td className="py-3 pr-4">
                  <p className="font-semibold text-gray-900">{r.company || r.domain}</p>
                  <a href={`https://${r.domain}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-gray-500 hover:text-blue-600">{r.domain} <ExternalLink size={11} /></a>
                </td>
                <td className="py-3 pr-4"><span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${SIDE_TONE[r.side]}`}>{r.side === 'both' ? 'Both' : r.side === 'bench' ? 'Bench sales' : r.side === 'vendor' ? 'Vendor' : 'Other'}</span></td>
                <td className="py-3 pr-4 text-gray-600 tabular-nums">
                  {r.is_user && <p className="font-semibold text-emerald-700">User{r.user_persona ? ` · ${r.user_persona === 'bench_sales' ? 'bench sales' : r.user_persona}` : ''}</p>}
                  <p>{r.hotlist_posts} hotlist · {r.job_posts} job posts</p>
                </td>
                <td className="py-3 pr-4 max-w-[260px]">
                  <p className="text-gray-700 truncate" title={r.title ?? ''}>{r.title || '—'}</p>
                  <p className="text-[12px] text-gray-500">{r.site_status === 'ok' ? `${r.words.toLocaleString('en-IN')} words` : r.site_status === 'thin' ? 'Thin / script-only' : r.site_status === 'parked' ? 'Parked / placeholder' : 'Not loading'}{r.staffing_score ? ` · staffing ${r.staffing_score}` : ''}</p>
                </td>
                <td className="py-3 pr-4">
                  <select value={r.status} onChange={e => update(r.domain, { status: e.target.value as Row['status'] })} className="rounded-lg border border-gray-200 px-2 py-1 text-[12px]">
                    <option value="todo">To do</option><option value="building">Building</option><option value="built">Built</option><option value="skipped">Skipped</option>
                  </select>
                  {r.demo_slug && (
                    <a href={`${SITE_BASE_URL}/${r.demo_slug}/`} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 text-[12px] text-blue-600 hover:underline">{r.claimed ? 'Live site' : 'Demo'} <ExternalLink size={11} /></a>
                  )}
                </td>
                <td className="py-3 pr-4">
                  <input
                    defaultValue={r.notes ?? ''}
                    onBlur={e => { if ((e.target.value || '') !== (r.notes || '')) void update(r.domain, { notes: e.target.value }); }}
                    placeholder="Add a note"
                    className="w-48 rounded-lg border border-gray-200 px-2 py-1 text-[12px]"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.rows.length === 0 && <p className="text-center text-sm text-gray-500 py-10">No firms match these filters.</p>}
        {data && pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-[13px]">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">Previous</button>
            <span className="text-gray-500">Page {page + 1} of {pages}</span>
            <button disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-40">Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
