import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, Plus, RefreshCcw, Save, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

type KeywordRow = {
  id: string;
  keyword: string;
  is_active: boolean;
  scraped_posts_count: number;
  social_jobs_count: number;
  radar_results_count: number;
  last_scraped_at: string | null;
};

type KeywordScraperConfig = {
  is_enabled: boolean;
  max_pages: number;
  max_posts_per_keyword: number;
  posted_limit: '24h' | 'week' | 'month';
  sort_by: 'date' | 'relevance';
  schedule_interval_hours: number;
  last_scheduled_at: string | null;
  updated_at: string;
};

type StatsRange = '24h' | '7d' | '30d' | 'all';

const defaultConfig: KeywordScraperConfig = {
  is_enabled: false,
  max_pages: 1,
  max_posts_per_keyword: 100,
  posted_limit: '24h',
  sort_by: 'relevance',
  schedule_interval_hours: 3,
  last_scheduled_at: null,
  updated_at: '',
};

function formatDate(value: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

export default function LinkedinKeywordScraperPanel() {
  const [keywords, setKeywords] = useState<KeywordRow[]>([]);
  const [config, setConfig] = useState<KeywordScraperConfig>(defaultConfig);
  const [newKeyword, setNewKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [range, setRange] = useState<StatsRange>('7d');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const password = sessionStorage.getItem('admin_authed') || '';

  async function fetchKeywords(selectedRange = range) {
    setLoading(true);
    setError('');
    const hours = selectedRange === '24h' ? 24 : selectedRange === '7d' ? 168 : selectedRange === '30d' ? 720 : null;
    const statsEnd = hours ? new Date().toISOString() : null;
    const statsStart = hours ? new Date(Date.now() - hours * 60 * 60 * 1000).toISOString() : null;
    const { data, error: invokeError } = await supabase.functions.invoke('admin-linkedin-keywords', {
      body: { action: 'list', password, stats_start: statsStart, stats_end: statsEnd },
    });
    if (invokeError || data?.error) {
      setError(invokeError?.message || data.error);
    } else {
      setKeywords((data?.keywords ?? []) as KeywordRow[]);
      setConfig(data.config as KeywordScraperConfig);
    }
    setLoading(false);
  }

  useEffect(() => {
    void fetchKeywords();
    // The admin password is fixed for the mounted authenticated session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function invokeAction(body: Record<string, unknown>) {
    setError('');
    setNotice('');
    const { data, error: invokeError } = await supabase.functions.invoke('admin-linkedin-keywords', {
      body: { ...body, password },
    });
    if (invokeError || data?.error) {
      setError(invokeError?.message || data.error);
      return null;
    }
    return data;
  }

  async function saveConfig() {
    setSaving(true);
    const data = await invokeAction({ action: 'update_config', ...config });
    if (data) {
      setConfig(data.config as KeywordScraperConfig);
      setNotice('Keyword scraper settings saved.');
    }
    setSaving(false);
  }

  async function toggleScheduler() {
    setSaving(true);
    const isEnabled = !config.is_enabled;
    const data = await invokeAction({ action: 'set_scheduler_enabled', is_enabled: isEnabled });
    if (data) {
      setConfig(data.config as KeywordScraperConfig);
      setNotice(isEnabled ? 'Keyword scheduler resumed.' : 'Keyword scheduler paused.');
    }
    setSaving(false);
  }

  async function triggerScrape() {
    setTriggering(true);
    const saved = await invokeAction({ action: 'update_config', ...config });
    if (saved) {
      setConfig(saved.config as KeywordScraperConfig);
      const data = await invokeAction({ action: 'trigger_scrape' });
      if (data) setNotice(`${Number(data.keywordsQueued ?? 0)} active keywords queued for scraping.`);
    }
    setTriggering(false);
  }

  async function addKeyword() {
    const keyword = newKeyword.trim();
    if (keyword.length < 2) {
      setError('Enter a keyword with at least 2 characters.');
      return;
    }
    const data = await invokeAction({ action: 'create', keyword });
    if (data) {
      setNewKeyword('');
      setNotice(`Keyword “${keyword}” added.`);
      await fetchKeywords();
    }
  }

  async function setKeywordActive(row: KeywordRow, isActive: boolean) {
    const data = await invokeAction({ action: 'set_active', keyword_id: row.id, is_active: isActive });
    if (data) setKeywords((current) => current.map((item) => item.id === row.id ? { ...item, is_active: isActive } : item));
  }

  async function deleteKeyword(row: KeywordRow) {
    if (!window.confirm(`Delete keyword “${row.keyword}” and its raw scrape history?`)) return;
    const data = await invokeAction({ action: 'delete', keyword_id: row.id });
    if (data) {
      setKeywords((current) => current.filter((item) => item.id !== row.id));
      setNotice(`Keyword “${row.keyword}” deleted.`);
    }
  }

  const filteredKeywords = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? keywords.filter((row) => row.keyword.toLowerCase().includes(query)) : keywords;
  }, [keywords, search]);

  return (
    <div className="mt-4 grid h-full min-h-0 w-full min-w-0 max-w-full gap-4 overflow-y-auto lg:grid-cols-[320px_minmax(0,1fr)] lg:overflow-hidden">
      <aside className="rounded-lg border border-gray-200 bg-white lg:overflow-y-auto">
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
          <SlidersHorizontal size={15} className="text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Keyword Scraper Settings</h2>
        </div>
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
            <div>
              <p className="text-xs font-semibold text-gray-700">Scheduler</p>
              <p className={`mt-0.5 text-[11px] font-medium ${config.is_enabled ? 'text-emerald-700' : 'text-amber-700'}`}>{config.is_enabled ? 'Active' : 'Paused'}</p>
            </div>
            <button type="button" onClick={() => void toggleScheduler()} disabled={saving || triggering} className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold disabled:opacity-50 ${config.is_enabled ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-emerald-300 bg-emerald-50 text-emerald-700'}`}>
              {config.is_enabled ? <Pause size={13} /> : <Play size={13} />}
              {config.is_enabled ? 'Pause Scheduler' : 'Resume Scheduler'}
            </button>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-700">Maximum pages per keyword</span>
            <input type="number" min={1} max={20} value={config.max_pages} onChange={(event) => setConfig((current) => ({ ...current, max_pages: Number(event.target.value) }))} className="h-9 w-full rounded-md border border-gray-300 px-2.5 text-xs outline-none focus:border-blue-500" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-700">Maximum posts per keyword</span>
            <input type="number" min={1} max={1000} value={config.max_posts_per_keyword} onChange={(event) => setConfig((current) => ({ ...current, max_posts_per_keyword: Number(event.target.value) }))} className="h-9 w-full rounded-md border border-gray-300 px-2.5 text-xs outline-none focus:border-blue-500" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-700">Posted time window</span>
            <select value={config.posted_limit} onChange={(event) => setConfig((current) => ({ ...current, posted_limit: event.target.value as KeywordScraperConfig['posted_limit'] }))} className="h-9 w-full rounded-md border border-gray-300 bg-white px-2.5 text-xs">
              <option value="24h">Last 24 hours</option><option value="week">Last week</option><option value="month">Last month</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-700">Sort results by</span>
            <select value={config.sort_by} onChange={(event) => setConfig((current) => ({ ...current, sort_by: event.target.value as KeywordScraperConfig['sort_by'] }))} className="h-9 w-full rounded-md border border-gray-300 bg-white px-2.5 text-xs">
              <option value="relevance">Relevance</option><option value="date">Newest first</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-gray-700">Run every</span>
            <select value={config.schedule_interval_hours} onChange={(event) => setConfig((current) => ({ ...current, schedule_interval_hours: Number(event.target.value) }))} className="h-9 w-full rounded-md border border-gray-300 bg-white px-2.5 text-xs">
              {[1, 2, 3, 4, 6, 8, 12, 24].map((hours) => <option key={hours} value={hours}>{hours} {hours === 1 ? 'hour' : 'hours'}</option>)}
            </select>
          </label>
          <div className="border-t border-gray-200 pt-3 text-[11px] leading-5 text-gray-500">
            <p>Last scheduled: {formatDate(config.last_scheduled_at)}</p><p>Updated: {formatDate(config.updated_at || null)}</p>
          </div>
          <button onClick={() => void saveConfig()} disabled={saving} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-50"><Save size={13} /> Save Settings</button>
          <button onClick={() => void triggerScrape()} disabled={triggering || saving} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 disabled:opacity-50">{triggering ? <RefreshCcw size={13} className="animate-spin" /> : <Play size={13} />} Run Now</button>
        </div>
      </aside>

      <div className="flex min-h-[520px] min-w-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white lg:min-h-0">
        <div className="border-b border-gray-200 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-sm font-semibold text-gray-900">LinkedIn Search Keywords</h2><p className="mt-0.5 text-[11px] text-gray-500">Only active keywords are included in scheduled and manual runs.</p></div>
            <div className="flex items-center gap-2">
              <div className="relative"><Search size={13} className="absolute left-2.5 top-2.5 text-gray-400" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search keywords" className="h-8 w-44 rounded-md border border-gray-300 pl-8 pr-2 text-xs" /></div>
              <select value={range} onChange={(event) => { const next = event.target.value as StatsRange; setRange(next); void fetchKeywords(next); }} className="h-8 rounded-md border border-gray-300 bg-white px-2 text-xs"><option value="24h">24 hours</option><option value="7d">7 days</option><option value="30d">30 days</option><option value="all">All time</option></select>
              <button onClick={() => void fetchKeywords()} disabled={loading} title="Refresh" className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 text-gray-600 disabled:opacity-50"><RefreshCcw size={13} className={loading ? 'animate-spin' : ''} /></button>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <input value={newKeyword} onChange={(event) => setNewKeyword(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void addKeyword(); }} placeholder="e.g. hiring Java developer C2C" className="h-9 min-w-0 flex-1 rounded-md border border-gray-300 px-3 text-xs" />
            <button onClick={() => void addKeyword()} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white"><Plus size={13} /> Add Keyword</button>
          </div>
        </div>
        {error && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}
        {notice && <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">{notice}</div>}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="sticky top-0 bg-gray-50 text-[11px] uppercase text-gray-500"><tr><th className="px-4 py-3">Keyword</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Scraped</th><th className="px-4 py-3 text-right">Jobs</th><th className="px-4 py-3 text-right">Radar</th><th className="px-4 py-3">Last scraped</th><th className="px-4 py-3 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {filteredKeywords.map((row) => <tr key={row.id} className="hover:bg-gray-50"><td className="max-w-[300px] px-4 py-3 font-medium text-gray-900">{row.keyword}</td><td className="px-4 py-3"><button onClick={() => void setKeywordActive(row, !row.is_active)} className={`rounded-full px-2 py-1 text-[10px] font-semibold ${row.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{row.is_active ? 'Active' : 'Paused'}</button></td><td className="px-4 py-3 text-right tabular-nums">{row.scraped_posts_count.toLocaleString()}</td><td className="px-4 py-3 text-right tabular-nums">{row.social_jobs_count.toLocaleString()}</td><td className="px-4 py-3 text-right tabular-nums">{row.radar_results_count.toLocaleString()}</td><td className="px-4 py-3 text-gray-500">{formatDate(row.last_scraped_at)}</td><td className="px-4 py-3 text-right"><button onClick={() => void deleteKeyword(row)} title="Delete keyword" className="inline-flex h-7 w-7 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button></td></tr>)}
              {!loading && filteredKeywords.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-xs text-gray-500">No LinkedIn search keywords found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}