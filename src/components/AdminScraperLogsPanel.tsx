import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Database, RefreshCcw } from 'lucide-react';
import LogoSpinner from './LogoSpinner';
import { supabase } from '../lib/supabase';

type LogsRange = '24h' | '2d' | '3d' | '7d' | 'custom';

type ScraperLogRow = {
  scraper_type: 'group' | 'keyword';
  hour_start: string;
  scraped_posts_count: number;
  social_jobs_count: number;
  radar_results_count: number;
};

const RANGE_HOURS: Record<Exclude<LogsRange, 'custom'>, number> = {
  '24h': 24,
  '2d': 48,
  '3d': 72,
  '7d': 168,
};

function getRange(range: LogsRange, customStart: string, customEnd: string) {
  if (range !== 'custom') {
    const end = new Date();
    return { start: new Date(end.getTime() - RANGE_HOURS[range] * 60 * 60 * 1000), end };
  }
  const start = customStart ? new Date(`${customStart}T00:00:00`) : null;
  const end = customEnd ? new Date(`${customEnd}T00:00:00`) : null;
  if (end) end.setDate(end.getDate() + 1);
  return { start, end };
}

function formatHour(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function AdminScraperLogsPanel() {
  const [range, setRange] = useState<LogsRange>('24h');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [rows, setRows] = useState<ScraperLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function fetchLogs(nextRange = range) {
    const selected = getRange(nextRange, customStart, customEnd);
    if (!selected.start || !selected.end) {
      setError('Choose both custom dates.');
      return;
    }
    if (selected.start >= selected.end) {
      setError('Start date must be before end date.');
      return;
    }

    setLoading(true);
    setError('');
    const { data, error: invokeError } = await supabase.functions.invoke('admin-scraper-logs', {
      body: {
        password: sessionStorage.getItem('admin_authed') || '',
        start: selected.start.toISOString(),
        end: selected.end.toISOString(),
      },
    });
    if (invokeError || data?.error) {
      setError(invokeError?.message || data.error);
    } else {
      setRows((data?.rows ?? []) as ScraperLogRow[]);
    }
    setLoading(false);
  }

  useEffect(() => {
    void fetchLogs('24h');
    // The initial range is fixed for this mounted admin session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const initial = {
      group: { scraped: 0, jobs: 0, radar: 0 },
      keyword: { scraped: 0, jobs: 0, radar: 0 },
    };
    return rows.reduce((result, row) => {
      result[row.scraper_type].scraped += row.scraped_posts_count;
      result[row.scraper_type].jobs += row.social_jobs_count;
      result[row.scraper_type].radar += row.radar_results_count;
      return result;
    }, initial);
  }, [rows]);

  return (
    <div className="mt-4 flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">Hourly scraper pipeline</p>
          <p className="mt-0.5 text-[11px] text-gray-500">Raw posts, accepted social jobs, and radar results by ingestion hour.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase text-gray-500">Date range</span>
            <select
              value={range}
              onChange={(event) => {
                const nextRange = event.target.value as LogsRange;
                setRange(nextRange);
                if (nextRange !== 'custom') void fetchLogs(nextRange);
              }}
              className="h-9 rounded-md border border-gray-300 bg-white px-2.5 text-xs font-semibold text-gray-700 outline-none focus:border-blue-500"
            >
              <option value="24h">Last 24 hours</option>
              <option value="2d">Last 2 days</option>
              <option value="3d">Last 3 days</option>
              <option value="7d">Last 7 days</option>
              <option value="custom">Custom dates</option>
            </select>
          </label>
          {range === 'custom' && (
            <>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-gray-500">From</span>
                <input type="date" value={customStart} max={customEnd || undefined} onChange={(event) => setCustomStart(event.target.value)} className="h-9 rounded-md border border-gray-300 px-2 text-xs outline-none focus:border-blue-500" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-gray-500">To</span>
                <input type="date" value={customEnd} min={customStart || undefined} onChange={(event) => setCustomEnd(event.target.value)} className="h-9 rounded-md border border-gray-300 px-2 text-xs outline-none focus:border-blue-500" />
              </label>
              <button onClick={() => void fetchLogs('custom')} disabled={loading || !customStart || !customEnd} className="h-9 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">Apply</button>
            </>
          )}
          <button onClick={() => void fetchLogs()} disabled={loading} title="Refresh logs" className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCcw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">{error}</div>}

      <div className="grid shrink-0 grid-cols-1 border-b border-gray-200 sm:grid-cols-2">
        {(['group', 'keyword'] as const).map((scraperType) => (
          <section key={scraperType} className="border-b border-gray-200 px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
            <div className="mb-2 flex items-center gap-2">
              {scraperType === 'group' ? <Database size={13} className="text-blue-600" /> : <CalendarRange size={13} className="text-amber-600" />}
              <h2 className="text-xs font-semibold capitalize text-gray-800">{scraperType} scraper</h2>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><p className="text-[10px] uppercase text-gray-400">Raw posts</p><p className="text-lg font-semibold tabular-nums text-gray-900">{totals[scraperType].scraped.toLocaleString()}</p></div>
              <div><p className="text-[10px] uppercase text-gray-400">Social jobs</p><p className="text-lg font-semibold tabular-nums text-blue-700">{totals[scraperType].jobs.toLocaleString()}</p></div>
              <div><p className="text-[10px] uppercase text-gray-400">Radar</p><p className="text-lg font-semibold tabular-nums text-emerald-700">{totals[scraperType].radar.toLocaleString()}</p></div>
            </div>
          </section>
        ))}
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center"><LogoSpinner size={18} /></div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[720px] table-fixed text-left text-xs">
            <thead className="sticky top-0 z-[2] bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
              <tr className="border-b border-gray-200">
                <th className="w-[210px] px-4 py-2.5">Hour</th>
                <th className="w-[130px] px-4 py-2.5">Scraper</th>
                <th className="px-4 py-2.5 text-right">First table · Raw posts</th>
                <th className="px-4 py-2.5 text-right">Second table · Social jobs</th>
                <th className="px-4 py-2.5 text-right">Third table · Radar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row) => (
                <tr key={`${row.hour_start}-${row.scraper_type}`} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-700">{formatHour(row.hour_start)}</td>
                  <td className="px-4 py-2.5"><span className={`rounded px-2 py-1 text-[10px] font-semibold capitalize ${row.scraper_type === 'group' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>{row.scraper_type}</span></td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-gray-900">{row.scraped_posts_count.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-blue-700">{row.social_jobs_count.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-emerald-700">{row.radar_results_count.toLocaleString()}</td>
                </tr>
              ))}
              {rows.length === 0 && !loading && <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-gray-500">No scraper activity in this range.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}