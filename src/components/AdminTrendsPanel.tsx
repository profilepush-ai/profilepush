import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { DailyBarChart } from './charts/DashboardCharts';

type DailyRow = {
  date: string;
  signups: number;
  jobs_scraped: number;
  jobs_posted: number;
  hotlist_scraped: number;
  hotlist_posted: number;
  searches: number;
  ai_pitches: number;
  ai_requests: number;
  chats: number;
};

type TrendsResponse = {
  daily: DailyRow[];
  signups_total: number;
  jobs_scraped_total: number;
  jobs_posted_total: number;
  hotlist_scraped_total: number;
  hotlist_posted_total: number;
  searches_total: number;
  ai_pitches_total: number;
  ai_requests_total: number;
  chats_total: number;
};

const RANGE_OPTIONS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
];

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-[18px] font-bold text-gray-900">{value.toLocaleString()}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="mb-2 text-[12px] font-bold text-gray-900">{title}</p>
      {children}
    </div>
  );
}

export default function AdminTrendsPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError('');
      try {
        const { data: result, error: fnError } = await supabase.functions.invoke('admin-trends', {
          body: { password: sessionStorage.getItem('admin_authed') || '', days },
        });
        if (fnError || result?.error) throw new Error(fnError?.message || result.error);
        setData(result as TrendsResponse);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [days]);

  if (loading) {
    return <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-gray-400" /></div>;
  }

  if (error) {
    return <div className="m-4 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-600">{error}</div>;
  }

  if (!data) return null;

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[13px] font-bold text-gray-900">Platform trends</p>
        <div className="flex items-center gap-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              type="button"
              onClick={() => setDays(opt.days)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${days === opt.days ? 'bg-blue-600 text-white' : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
        <StatChip label="Signups" value={data.signups_total} />
        <StatChip label="Jobs Scraped" value={data.jobs_scraped_total} />
        <StatChip label="Jobs Posted" value={data.jobs_posted_total} />
        <StatChip label="Hotlist Scraped" value={data.hotlist_scraped_total} />
        <StatChip label="Hotlist Posted" value={data.hotlist_posted_total} />
        <StatChip label="Searches" value={data.searches_total} />
        <StatChip label="AI Pitches" value={data.ai_pitches_total} />
        <StatChip label="AI Requests" value={data.ai_requests_total} />
        <StatChip label="Chats" value={data.chats_total} />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard title="Signups">
          <DailyBarChart
            data={data.daily}
            series={[{ key: 'signups', label: 'Signups', color: '#2563eb' }]}
          />
        </ChartCard>

        <ChartCard title="Jobs (scraped vs. posted)">
          <DailyBarChart
            data={data.daily}
            series={[
              { key: 'jobs_scraped', label: 'Scraped', color: '#93c5fd' },
              { key: 'jobs_posted', label: 'Posted', color: '#2563eb' },
            ]}
          />
        </ChartCard>

        <ChartCard title="Hotlist (scraped vs. posted)">
          <DailyBarChart
            data={data.daily}
            series={[
              { key: 'hotlist_scraped', label: 'Scraped', color: '#fdba74' },
              { key: 'hotlist_posted', label: 'Posted', color: '#f97316' },
            ]}
          />
        </ChartCard>

        <ChartCard title="Searches">
          <DailyBarChart
            data={data.daily}
            series={[{ key: 'searches', label: 'Searches', color: '#0d9488' }]}
          />
        </ChartCard>

        <ChartCard title="AI outreach (pitches vs. requests)">
          <DailyBarChart
            data={data.daily}
            series={[
              { key: 'ai_pitches', label: 'AI Pitches (jobs)', color: '#a855f7' },
              { key: 'ai_requests', label: 'AI Requests (hotlist)', color: '#d946ef' },
            ]}
          />
        </ChartCard>

        <ChartCard title="Chats">
          <DailyBarChart
            data={data.daily}
            series={[{ key: 'chats', label: 'Chats', color: '#64748b' }]}
          />
        </ChartCard>
      </div>
    </div>
  );
}
