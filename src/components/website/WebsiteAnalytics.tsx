import { useEffect, useState } from 'react';
import LogoSpinner from '../LogoSpinner';
import { fetchAnalytics, KIND_LABEL, type SubmissionKind, type WebsiteAnalytics as Analytics } from '../../lib/website-checkout';

// Live traffic for one website: headline tiles, daily visitors, and where
// visitors came from. Demo-period traffic isn't counted.

const RANGES = [7, 30, 90];

function fmtDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function Tile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <p className="text-[12px] font-medium text-gray-500">{label}</p>
      <p className="text-2xl font-extrabold text-gray-900 tabular-nums mt-0.5">{typeof value === 'number' ? value.toLocaleString('en-IN') : value}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function BarList({ title, rows, empty }: { title: string; rows: { name: string; count: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <p className="text-[13px] font-semibold text-gray-900 mb-3">{title}</p>
      {rows.length === 0 ? <p className="text-xs text-gray-400">{empty}</p> : (
        <ul className="space-y-2">
          {rows.map(r => (
            <li key={r.name} className="grid grid-cols-[1fr_auto] items-center gap-3 text-[13px]">
              <div className="relative h-7 rounded-md bg-gray-50 overflow-hidden">
                <div className="absolute inset-y-0 left-0 rounded-md bg-blue-100" style={{ width: `${(r.count / max) * 100}%` }} />
                <span className="relative z-10 px-2 leading-7 text-gray-700 truncate block">{r.name}</span>
              </div>
              <span className="tabular-nums text-gray-900 font-medium">{r.count.toLocaleString('en-IN')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DailyChart({ series }: { series: Analytics['series'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.map(d => d.visitors));
  const W = 600, H = 160, gap = 2;
  const bw = W / series.length;
  const h = series[hover ?? -1];
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-[13px] font-semibold text-gray-900">Visitors per day</p>
        <p className="text-[12px] text-gray-500 tabular-nums h-4">
          {h ? `${fmtDay(h.day)} · ${h.visitors} visitors · ${h.enquiries} enquiries` : `Peak ${max.toLocaleString('en-IN')}`}
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full h-auto" role="img" aria-label="Visitors per day" onMouseLeave={() => setHover(null)}>
        <line x1="0" x2={W} y1={H} y2={H} stroke="#e5e7eb" strokeWidth="1" />
        {series.map((d, i) => {
          const bh = d.visitors === 0 ? 0 : Math.max(2, (d.visitors / max) * (H - 8));
          const x = i * bw + gap / 2;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)}>
              {/* Hit target is the full column, bigger than the bar. */}
              <rect x={i * bw} y={0} width={bw} height={H} fill="transparent" />
              {bh > 0 && (
                <rect
                  x={x}
                  y={H - bh}
                  width={Math.max(1, bw - gap)}
                  height={bh}
                  rx={Math.min(3, bh / 2, (bw - gap) / 2)}
                  fill={hover === i ? '#1d4ed8' : '#3b82f6'}
                />
              )}
              {d.enquiries > 0 && <circle cx={i * bw + bw / 2} cy={H + 9} r="3" fill="#0f172a" />}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[11px] text-gray-400 mt-1 tabular-nums">
        <span>{series[0] && fmtDay(series[0].day)}</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-slate-900 inline-block" /> day with an enquiry</span>
        <span>{series.length > 0 && fmtDay(series[series.length - 1].day)}</span>
      </div>
      <table className="sr-only">
        <caption>Visitors and enquiries per day</caption>
        <thead><tr><th>Day</th><th>Visitors</th><th>Page views</th><th>Enquiries</th></tr></thead>
        <tbody>{series.map(d => <tr key={d.day}><td>{d.day}</td><td>{d.visitors}</td><td>{d.pageviews}</td><td>{d.enquiries}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

const COUNTRY = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const countryName = (code: string) => {
  try { return code === '??' ? 'Unknown' : COUNTRY?.of(code) ?? code; } catch { return code; }
};

export default function WebsiteAnalytics({ websiteId }: { websiteId: string }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null);
    fetchAnalytics(websiteId, days)
      .then(d => { if (live) { setData(d); setError(null); } })
      .catch(() => { if (live) setError('Could not load analytics. Please refresh.'); });
    return () => { live = false; };
  }, [websiteId, days]);

  const t = data?.totals;
  const conversion = t && t.visitors ? `${((t.enquiries / t.visitors) * 100).toFixed(1)}%` : '—';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">Live traffic only. No cookies; visitors are counted per day.</p>
        <div className="flex rounded-xl border border-gray-200 p-0.5 text-[13px] bg-white">
          {RANGES.map(r => (
            <button key={r} onClick={() => setDays(r)} className={`px-3 py-1.5 rounded-lg font-medium ${days === r ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-900'}`}>
              {r} days
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && !error && <div className="py-12 flex justify-center"><LogoSpinner /></div>}

      {data && t && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Visitors" value={t.visitors} />
            <Tile label="Page views" value={t.pageviews} />
            <Tile label="Enquiries" value={t.enquiries} />
            <Tile label="Visitor → enquiry" value={conversion} hint={`${t.cta_clicks.toLocaleString('en-IN')} button clicks`} />
          </div>
          <DailyChart series={data.series} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <BarList
              title="Enquiries by type"
              rows={Object.entries(data.enquiries_by_kind).map(([k, n]) => ({ name: KIND_LABEL[k as SubmissionKind] ?? k, count: n ?? 0 })).sort((a, b) => b.count - a.count)}
              empty="No enquiries in this period."
            />
            <BarList title="Where visitors came from" rows={data.referrers} empty="No visits in this period." />
            <BarList title="Countries" rows={data.countries.map(c => ({ name: countryName(c.name), count: c.count }))} empty="No visits in this period." />
            <BarList
              title="Devices"
              rows={Object.entries(data.devices).map(([k, n]) => ({ name: k[0].toUpperCase() + k.slice(1), count: n ?? 0 })).sort((a, b) => b.count - a.count)}
              empty="No visits in this period."
            />
            <BarList title="Buttons clicked" rows={data.ctas} empty="No button clicks in this period." />
          </div>
        </>
      )}
    </div>
  );
}
