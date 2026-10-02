import { useEffect, useMemo, useState } from 'react';
import { RefreshCcw, Star } from 'lucide-react';
import { supabase } from '../lib/supabase';

// Admin > Feedback: ratings and comments from the card shown right after an
// AI Submit is sent. Low ratings are the ones to follow up on; comments
// marked "OK to show" are what the landing page can quote.

type FeedbackRow = {
  id: string;
  created_at: string;
  rating: number;
  comment: string | null;
  can_publish: boolean;
  context: string | null;
  platform: string | null;
  persona: string | null;
  email: string;
  name: string | null;
  company: string | null;
};

type Report = {
  count: number;
  average: number | null;
  distribution: Record<string, number>;
  shown: number;
  dismissed: number;
  rows: FeedbackRow[];
};

type Filter = 'all' | 'low' | 'public';

const CONTEXT_LABELS: Record<string, string> = {
  ai_submit: 'After AI Submit',
  ai_submit_bulk: 'After bulk AI Submit',
  in_app_submit: 'After in-app submit',
};

function Stars({ n, size = 13 }: { n: number; size?: number }) {
  return (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} className={i <= n ? 'fill-amber-400 text-amber-400' : 'text-gray-200'} />
      ))}
    </span>
  );
}

export default function AdminFeedbackPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  async function load() {
    setLoading(true);
    setError('');
    const { data, error: fnError } = await supabase.functions.invoke('admin-feedback', {
      body: { password: sessionStorage.getItem('admin_authed') || '' },
    });
    if (fnError || data?.error) setError(data?.error || 'Could not load feedback.');
    else setReport(data.report as Report);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const rows = useMemo(() => {
    const all = report?.rows ?? [];
    if (filter === 'low') return all.filter((r) => r.rating <= 3);
    if (filter === 'public') return all.filter((r) => r.can_publish && r.comment);
    return all;
  }, [report, filter]);

  const count = report?.count ?? 0;
  const pill = (active: boolean) => `rounded-full border px-3 py-1.5 text-[12px] font-semibold ${active ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`;
  const stat = (label: string, value: string, sub?: string) => (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-gray-200 bg-white px-4 py-3">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-[22px] font-bold tabular-nums text-gray-900">{value}</span>
      {sub && <span className="text-[11px] text-gray-500">{sub}</span>}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-gray-500">Asked right after an AI Submit is sent. Not again for 90 days after rating, or 14 after closing.</p>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60">
          <RefreshCcw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</p>}

      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {stat('Average', report.average ? `${report.average} ★` : '—', `${count} rating${count === 1 ? '' : 's'}`)}
            {stat('Asked', report.shown.toLocaleString('en-US'), 'people shown the card')}
            {stat('Answered', report.shown ? `${Math.round((count / report.shown) * 100)}%` : '—', `${report.dismissed} closed it`)}
            {stat('On the landing page', count >= 10 ? 'Showing' : `${Math.max(0, 10 - count)} to go`, count >= 10 ? 'Rating and schema are live' : 'Shows from 10 ratings')}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="mb-2 text-[13px] font-semibold text-gray-800">Ratings</p>
            <div className="flex flex-col gap-1.5">
              {[5, 4, 3, 2, 1].map((n) => {
                const k = report.distribution[String(n)] ?? 0;
                return (
                  <div key={n} className="flex items-center gap-2 text-[12px]">
                    <span className="w-8 tabular-nums text-gray-600">{n} ★</span>
                    <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: count ? `${(k / count) * 100}%` : '0%' }} />
                    </div>
                    <span className="w-8 text-right tabular-nums text-gray-600">{k}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className={pill(filter === 'all')} onClick={() => setFilter('all')}>All</button>
            <button type="button" className={pill(filter === 'low')} onClick={() => setFilter('low')}>1–3 stars (follow up)</button>
            <button type="button" className={pill(filter === 'public')} onClick={() => setFilter('public')}>OK to show publicly</button>
          </div>

          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <div key={r.id} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Stars n={r.rating} />
                  <span className="text-[13px] font-semibold text-gray-900">{r.name || r.email}</span>
                  {r.company && <span className="text-[12px] text-gray-500">{r.company}</span>}
                  <span className="ml-auto text-[11px] text-gray-500">{new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                </div>
                {r.comment ? <p className="mt-1.5 whitespace-pre-wrap text-[13px] text-gray-700">{r.comment}</p> : <p className="mt-1 text-[12px] italic text-gray-400">No comment</p>}
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-semibold">
                  {r.can_publish && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">OK to show</span>}
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{CONTEXT_LABELS[r.context ?? ''] ?? r.context ?? '—'}</span>
                  {r.persona && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{r.persona === 'bench_sales' ? 'Bench sales' : 'Vendor'}</span>}
                  {r.platform && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{r.platform}</span>}
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{r.email}</span>
                </div>
              </div>
            ))}
            {rows.length === 0 && <p className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-[12px] text-gray-500">No feedback yet. It appears here as people rate after sending an AI Submit.</p>}
          </div>
        </>
      )}
    </div>
  );
}
