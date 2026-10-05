import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle, Copy, ExternalLink, Eye, Globe, Loader2, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import Logo from '../components/Logo';
import { supabase } from '../lib/supabase';
import { SITE_BASE_URL } from '../lib/website-checkout';

// Admin > Website Demos: generate demos from a firm's current website, see
// which firms opened theirs, and follow live sites. Same password gate as
// /admin (sessionStorage 'admin_authed').

type Site = {
  id: string; slug: string; name: string; source_url: string | null; status: string; live: boolean;
  account_id: string | null; account_name: string | null; created_at: string; claimed_at: string | null;
  demo_expires_at: string | null; custom_domain: string | null; domain_status: string | null; template: string | null;
  claim_token: string; claim_domain: string | null; claim_emails: string[]; plan_expires_at: string | null;
  demo_views: number; last_demo_view: string | null; visitors_30d: number; enquiries_total: number; enquiries_30d: number;
  showcase: boolean;
};

type Request = {
  id: string; created_at: string; name: string; email: string; phone: string | null; company: string; website_url: string;
  notes: string | null; status: string; source: string; generation_status: string | null; generation_error: string | null;
  generated_at: string | null; website_id: string | null; template: string | null;
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};

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

function siteState(s: Site): { label: string; tone: string } {
  if (s.live) return { label: 'Live', tone: 'bg-emerald-50 text-emerald-700' };
  if (s.account_id) return { label: 'Paused (plan ended)', tone: 'bg-amber-50 text-amber-700' };
  if (s.showcase) return { label: 'Showcase example', tone: 'bg-violet-50 text-violet-700' };
  if (s.demo_expires_at && new Date(s.demo_expires_at) < new Date()) return { label: 'Demo expired', tone: 'bg-gray-100 text-gray-600' };
  return { label: 'Demo', tone: 'bg-blue-50 text-blue-700' };
}

function CopyBtn({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="inline-flex items-center gap-1 text-[12px] text-gray-600 hover:text-blue-600"
      title={value}
    >
      {done ? <CheckCircle size={12} className="text-emerald-600" /> : <Copy size={12} />} {label}
    </button>
  );
}

function SiteRow({ s, templates, onChange }: { s: Site; templates: string[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [emails, setEmails] = useState(s.claim_emails.join(', '));
  const st = siteState(s);
  const demoUrl = `${SITE_BASE_URL}/${s.slug}/`;
  const claimUrl = `https://profilepush.ai/claim/${s.claim_token}`;

  async function act(body: Record<string, unknown>) {
    setBusy(true); setErr(null);
    try { await call({ ...body, website_id: s.id }); onChange(); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    setBusy(false);
  }

  return (
    <tr className="border-t border-gray-100 align-top text-[13px]">
      <td className="py-3 pr-4">
        <p className="font-semibold text-gray-900">{s.name}</p>
        <a href={demoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">{s.slug} <ExternalLink size={11} /></a>
        {s.source_url && <p className="text-gray-400 truncate max-w-[220px]">from {s.source_url.replace(/^https?:\/\//, '')}</p>}
        {s.custom_domain && <p className="text-gray-500 flex items-center gap-1"><Globe size={11} /> {s.custom_domain} · {s.domain_status}</p>}
      </td>
      <td className="py-3 pr-4">
        <span className={`inline-block text-[11px] font-bold rounded-full px-2 py-0.5 ${st.tone}`}>{st.label}</span>
        <p className="text-gray-500 mt-1">{s.account_id ? `${s.account_name ?? 'Account'} · plan to ${fmt(s.plan_expires_at)}` : `expires ${fmt(s.demo_expires_at)}`}</p>
      </td>
      <td className="py-3 pr-4 tabular-nums">
        {s.account_id ? (
          <><p className="text-gray-900 font-medium">{s.visitors_30d} visitors · {s.enquiries_30d} enquiries</p><p className="text-gray-500">last 30 days · {s.enquiries_total} enquiries total</p></>
        ) : (
          <><p className="text-gray-900 font-medium flex items-center gap-1"><Eye size={12} /> {s.demo_views} views</p><p className="text-gray-500">last opened {ago(s.last_demo_view)}</p></>
        )}
      </td>
      <td className="py-3 pr-4">
        <div className="flex flex-col gap-1">
          <CopyBtn value={demoUrl} label="Demo link" />
          {!s.account_id && <CopyBtn value={claimUrl} label="Claim link" />}
        </div>
      </td>
      <td className="py-3 pr-4 min-w-[220px]">
        {!s.account_id ? (
          <>
            <p className="text-gray-500 text-[12px]">Can claim: @{s.claim_domain ?? '—'} or</p>
            <div className="flex gap-1 mt-1">
              <input value={emails} onChange={e => setEmails(e.target.value)} placeholder="emails, comma separated" className="flex-1 min-w-0 rounded-lg border border-gray-200 px-2 py-1 text-[12px]" />
              <button disabled={busy} onClick={() => act({ action: 'update', claim_emails: emails.split(/[\s,;]+/).filter(Boolean) })} className="px-2 py-1 rounded-lg border border-gray-200 text-[12px] hover:border-gray-300">Save</button>
            </div>
          </>
        ) : <p className="text-gray-500 text-[12px]">Claimed {fmt(s.claimed_at)}</p>}
      </td>
      <td className="py-3">
        <div className="flex flex-wrap items-center gap-2">
          {s.template && (
            <select
              value={s.template}
              disabled={busy}
              onChange={e => act({ action: 'rerender', template: e.target.value })}
              className="rounded-lg border border-gray-200 px-2 py-1 text-[12px] capitalize"
              title="Re-render with another template"
            >
              {templates.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          {!s.account_id && (
            <>
              <button disabled={busy} onClick={() => act({ action: 'update', extend_days: 30 })} className="px-2 py-1 rounded-lg border border-gray-200 text-[12px] hover:border-gray-300">+30 days</button>
              <label className="inline-flex items-center gap-1 text-[12px] text-gray-600" title="Feature on profilepush.ai/websites as an example">
                <input type="checkbox" checked={s.showcase} disabled={busy} onChange={e => act({ action: 'update', showcase: e.target.checked })} className="accent-violet-600" /> Showcase
              </label>
              <button
                disabled={busy}
                onClick={() => { if (confirm(`Delete the ${s.name} demo? This can't be undone.`)) void act({ action: 'delete' }); }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                aria-label="Delete demo"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
          {busy && <Loader2 size={14} className="animate-spin text-gray-400" />}
        </div>
        {err && <p className="text-[12px] text-red-600 mt-1">{err}</p>}
      </td>
    </tr>
  );
}

export default function AdminWebsitesPage() {
  const [authed, setAuthed] = useState(!!sessionStorage.getItem('admin_authed'));
  const [pw, setPw] = useState('');
  const [data, setData] = useState<{ requests: Request[]; sites: Site[]; templates: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'demos' | 'live' | 'requests'>('demos');
  const [form, setForm] = useState({ url: '', company: '', email: '', template: '' });
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await call<{ requests: Request[]; sites: Site[]; templates: string[] }>({ action: 'list' }));
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load';
      if (msg === 'Invalid password') { sessionStorage.removeItem('admin_authed'); setAuthed(false); }
      setError(msg);
    }
  }, []);

  useEffect(() => { if (authed) void load(); }, [authed, load]);

  // Poll while a generation is in flight.
  const running = useMemo(() => (data?.requests ?? []).some(r => r.generation_status === 'queued' || r.generation_status === 'running'), [data]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
  }, [running, load]);

  async function generate(body: Record<string, unknown>) {
    setStarting(true); setError(null);
    try {
      await call({ action: 'generate', ...body, template: form.template || undefined });
      setForm(f => ({ ...f, url: '', company: '', email: '' }));
      setTab('requests');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not start'); }
    setStarting(false);
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <form
          onSubmit={e => { e.preventDefault(); sessionStorage.setItem('admin_authed', pw); setAuthed(true); }}
          className="bg-white rounded-2xl border border-gray-200 p-6 w-full max-w-sm space-y-3"
        >
          <Logo size="md" />
          <p className="font-semibold text-gray-900">Website Demos admin</p>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Admin password" className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" autoFocus />
          <button className="w-full bg-blue-600 text-white rounded-xl py-2 text-sm font-semibold">Sign in</button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      </div>
    );
  }

  const sites = data?.sites ?? [];
  const demos = sites.filter(s => !s.account_id);
  const live = sites.filter(s => s.account_id);
  const templates = data?.templates ?? [];
  const sitesById = new Map(sites.map(s => [s.id, s]));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3"><Link to="/admin"><Logo size="sm" /></Link><span className="text-sm font-semibold text-gray-900">Website Demos</span></div>
          <button onClick={() => void load()} className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"><RefreshCw size={14} /> Refresh</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ['Demos', demos.length],
            ['Demos opened', demos.filter(s => s.demo_views > 0).length],
            ['Live sites', live.filter(s => s.live).length],
            ['Open requests', (data?.requests ?? []).filter(r => r.status === 'new').length],
          ].map(([l, v]) => (
            <div key={l} className="bg-white rounded-xl border border-gray-100 p-4"><p className="text-[12px] text-gray-500">{l}</p><p className="text-2xl font-extrabold text-gray-900 tabular-nums">{v}</p></div>
          ))}
        </div>

        <form
          onSubmit={e => { e.preventDefault(); void generate({ url: form.url, company: form.company, email: form.email }); }}
          className="bg-white rounded-2xl border border-gray-200 p-5"
        >
          <p className="font-semibold text-gray-900 flex items-center gap-2"><Sparkles size={16} className="text-blue-600" /> Generate a demo</p>
          <p className="text-xs text-gray-500 mt-1 mb-3">Reads the firm's current website and rebuilds it with Claude, using only their own content. Takes about a minute or two. The demo goes to {SITE_BASE_URL.replace('https://', '')}/&lt;their-domain&gt;.</p>
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_1.4fr_1fr_auto] gap-2">
            <input required value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} placeholder="Their website, e.g. 3sbc.com" className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            <input value={form.company} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} placeholder="Company (optional)" className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} type="email" placeholder="Contact email (can claim)" className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
            <select value={form.template} onChange={e => setForm(f => ({ ...f, template: e.target.value }))} className="rounded-xl border border-gray-200 px-3 py-2 text-sm capitalize">
              <option value="">Any template</option>
              {templates.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button disabled={starting} className="inline-flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-60">
              {starting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate
            </button>
          </div>
        </form>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-1">
          {([['demos', `Demos (${demos.length})`], ['live', `Live (${live.length})`], ['requests', `Requests (${data?.requests.length ?? 0})`]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`px-3.5 py-2 rounded-xl text-[13px] font-semibold ${tab === id ? 'bg-white border border-gray-200 shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}>{label}</button>
          ))}
        </div>

        {!data && !error && <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-gray-400" /></div>}

        {data && tab !== 'requests' && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
            <table className="w-full min-w-[960px]">
              <thead><tr className="text-left text-[12px] text-gray-500"><th className="px-4 py-2.5 font-medium">Site</th><th className="py-2.5 pr-4 font-medium">Status</th><th className="py-2.5 pr-4 font-medium">{tab === 'demos' ? 'Demo views' : 'Traffic'}</th><th className="py-2.5 pr-4 font-medium">Links</th><th className="py-2.5 pr-4 font-medium">{tab === 'demos' ? 'Who can claim' : 'Claimed'}</th><th className="py-2.5 font-medium">Actions</th></tr></thead>
              <tbody className="[&>tr>td:first-child]:pl-4">
                {(tab === 'demos' ? demos : live).map(s => <SiteRow key={s.id} s={s} templates={templates} onChange={() => void load()} />)}
              </tbody>
            </table>
            {(tab === 'demos' ? demos : live).length === 0 && <p className="text-center text-sm text-gray-500 py-10">{tab === 'demos' ? 'No demos yet. Generate one above.' : 'No claimed sites yet.'}</p>}
          </div>
        )}

        {data && tab === 'requests' && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
            <table className="w-full min-w-[900px] text-[13px]">
              <thead><tr className="text-left text-[12px] text-gray-500"><th className="px-4 py-2.5 font-medium">Firm</th><th className="py-2.5 pr-4 font-medium">Contact</th><th className="py-2.5 pr-4 font-medium">Received</th><th className="py-2.5 pr-4 font-medium">Demo</th><th className="py-2.5 pr-4 font-medium">Status</th></tr></thead>
              <tbody>
                {data.requests.map(r => {
                  const site = r.website_id ? sitesById.get(r.website_id) : undefined;
                  const working = r.generation_status === 'queued' || r.generation_status === 'running';
                  return (
                    <tr key={r.id} className="border-t border-gray-100 align-top">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-900">{r.company}</p>
                        <a href={/^https?:/.test(r.website_url) ? r.website_url : `https://${r.website_url}`} target="_blank" rel="noreferrer noopener" className="text-gray-500 hover:text-blue-600">{r.website_url}</a>
                        {r.notes && <p className="text-gray-500 mt-1 max-w-xs">“{r.notes}”</p>}
                      </td>
                      <td className="py-3 pr-4"><p className="text-gray-900">{r.name}</p><p className="text-gray-500">{r.email}{r.phone ? ` · ${r.phone}` : ''}</p>{r.source === 'admin' && <p className="text-[11px] text-gray-400">added by admin</p>}</td>
                      <td className="py-3 pr-4 text-gray-600">{fmt(r.created_at)}</td>
                      <td className="py-3 pr-4">
                        {working && <span className="inline-flex items-center gap-1.5 text-blue-700"><Loader2 size={13} className="animate-spin" /> {r.generation_status === 'queued' ? 'Queued' : 'Generating…'}</span>}
                        {r.generation_status === 'failed' && <p className="text-red-600 max-w-xs">{r.generation_error ?? 'Failed'}</p>}
                        {site && <a href={`${SITE_BASE_URL}/${site.slug}/`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 hover:underline">{site.slug} <ExternalLink size={11} /></a>}
                        {!working && (
                          <button onClick={() => generate({ request_id: r.id })} disabled={starting} className="block mt-1 text-[12px] font-semibold text-blue-600 hover:underline">
                            {r.website_id || r.generation_status === 'failed' ? 'Generate again' : 'Generate demo'}
                          </button>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <select
                          value={r.status}
                          onChange={async e => { try { await call({ action: 'request_status', request_id: r.id, status: e.target.value }); void load(); } catch (err) { setError(err instanceof Error ? err.message : 'Failed'); } }}
                          className="rounded-lg border border-gray-200 px-2 py-1 text-[12px]"
                        >
                          {['new', 'in_progress', 'demo_sent', 'claimed', 'declined'].map(st => <option key={st} value={st}>{st.replace('_', ' ')}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.requests.length === 0 && <p className="text-center text-sm text-gray-500 py-10">No demo requests yet.</p>}
          </div>
        )}
      </main>
    </div>
  );
}
