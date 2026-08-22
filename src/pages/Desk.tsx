import { useState, useEffect, useRef } from 'react';
import {
  Users, Briefcase, Search, Filter, ChevronDown, Calendar,
  Sparkles, X, RefreshCw, TrendingUp, Activity,
  Target, BarChart2, Layers, Zap,
} from 'lucide-react';
import AppNav from '../components/AppNav';
import { supabase } from '../lib/supabase';
import { throttledAll } from '../lib/query-throttle';
import LogoSpinner from '../components/LogoSpinner';

// ─── Types & Constants ────────────────────────────────────────────────────────

interface TeamMember { user_id: string | null; invited_email: string; role: string; }

type WidgetId = 'bench' | 'jobs' | 'team' | 'conversion';

const STAGE_HEX: Record<string, string> = {
  New: '#60A5FA', Assigned: '#FBBF24', Sourcing: '#A78BFA',
  Submitted: '#34D399', Placed: '#38BDF8', Lost: '#F87171',
};
const STAGES = ['New', 'Assigned', 'Sourcing', 'Submitted', 'Placed', 'Lost'] as const;

const BOARD_NAMES: Record<string, string> = {
  linkedin: 'LinkedIn', dice: 'Dice', indeed: 'Indeed',
  monster: 'Monster', careerbuilder: 'CareerBuilder',
};
const BOARD_HEX: Record<string, string> = {
  linkedin: '#0A66C2', dice: '#E84393', indeed: '#2164F3',
  monster: '#7C3AED', careerbuilder: '#059669',
};
const PALETTE = ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444', '#0EA5E9', '#EC4899', '#14B8A6'];

const WIDGET_OPTIONS: Record<WidgetId, { id: string; label: string }[]> = {
  bench: [
    { id: 'distribution', label: 'Stage Distribution' },
    { id: 'health',       label: 'Pipeline Health'    },
    { id: 'velocity',     label: 'Period Activity'     },
  ],
  jobs: [
    { id: 'boards',        label: 'Board Matrix'      },
    { id: 'efficiency',    label: 'Board Efficiency'  },
    { id: 'trend',         label: 'Daily Trend'       },
    { id: 'resume_impact', label: 'Resume Impact'     },
  ],
  team: [
    { id: 'workload',  label: 'Workload Split'     },
    { id: 'activity',  label: 'Activity by Member' },
  ],
  conversion: [
    { id: 'funnel',       label: 'Placement Funnel' },
    { id: 'submissions',  label: 'Submission Mix'   },
    { id: 'activity_mix', label: 'Activity Mix'     },
  ],
};

const WIDGET_STORAGE_KEY = 'pp_dash_v3';

// ─── Utility ──────────────────────────────────────────────────────────────────

type DatePreset = '15d' | 'today' | 'week' | 'month' | 'custom';

const DATE_PRESETS: { id: DatePreset; label: string }[] = [
  { id: '15d',    label: 'Last 15 days'  },
  { id: 'today',  label: 'Today'         },
  { id: 'week',   label: 'Last 7 days'   },
  { id: 'month',  label: 'This month'    },
  { id: 'custom', label: 'Custom range'  },
];

function buildRange(preset: DatePreset, customStart?: string, customEnd?: string): { start: string; end: string } {
  const now = new Date();
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  if (preset === 'today') {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  if (preset === '15d') {
    const start = new Date(now); start.setDate(now.getDate() - 14); start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  if (preset === 'week') {
    const start = new Date(now); start.setDate(now.getDate() - 6); start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  if (preset === 'month') {
    const start = new Date(now); start.setDate(1); start.setHours(0, 0, 0, 0);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  // custom
  return {
    start: customStart ? new Date(customStart).toISOString() : buildRange('15d').start,
    end:   customEnd   ? new Date(customEnd + 'T23:59:59').toISOString() : end.toISOString(),
  };
}

function inRange(iso: string, start: string, end: string) { return iso >= start && iso <= end; }

// ─── Chart: Donut ─────────────────────────────────────────────────────────────

interface DonutSeg { value: number; color: string; label: string; }

function DonutChart({ segs, total }: { segs: DonutSeg[]; total: number }) {
  const r = 46, cx = 56, cy = 56, sw = 16;
  const circ = 2 * Math.PI * r;

  if (total === 0) {
    return (
      <div className="flex-1 flex items-center justify-center w-full">
        <p className="text-xs text-gray-400 italic">No data for this period</p>
      </div>
    );
  }

  let cum = 0;
  const gap = total > 1 ? 1.5 : 0;

  return (
    <div className="flex-1 flex flex-col items-center gap-4 w-full min-h-0">
      <div className="shrink-0 relative">
        <svg width={112} height={112} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F3F4F6" strokeWidth={sw} />
          {segs.filter(s => s.value > 0).map((seg, i) => {
            const frac = seg.value / total;
            const arcLen = Math.max(0, frac * circ - gap);
            const startDeg = (cum / circ) * 360;
            cum += frac * circ;
            return (
              <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                stroke={seg.color} strokeWidth={sw}
                strokeDasharray={`${arcLen} ${circ - arcLen}`}
                transform={`rotate(${startDeg} ${cx} ${cy})`}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-black text-gray-900 leading-none tabular-nums">{total}</span>
          <span className="text-[9px] text-gray-400 font-medium mt-0.5">total</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 w-full">
        {segs.filter(s => s.value > 0).map((seg, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
            <span className="text-xs text-gray-600 flex-1 truncate">{seg.label}</span>
            <span className="text-xs font-bold text-gray-800 tabular-nums">{seg.value}</span>
            <span className="text-[11px] text-gray-400 w-8 text-right tabular-nums">
              {Math.round((seg.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Chart: Horizontal Bars ───────────────────────────────────────────────────

interface BarItem { label: string; value: number; color?: string; sublabel?: string; }

function HorizBars({ items, maxVal, unit = '' }: {
  items: BarItem[]; maxVal?: number; unit?: string;
}) {
  const max = maxVal ?? Math.max(...items.map(i => i.value), 1);

  if (items.length === 0 || items.every(i => i.value === 0)) {
    return (
      <div className="flex-1 flex items-center justify-center w-full">
        <p className="text-xs text-gray-400 italic">No data for this period</p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-4">
      {items.map((item, i) => {
        const pct = max > 0 ? (item.value / max) * 100 : 0;
        const color = item.color ?? PALETTE[i % PALETTE.length];
        return (
          <div key={i}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="text-xs text-gray-700 font-medium truncate">{item.label}</span>
                {item.sublabel && <span className="text-[11px] text-gray-400 shrink-0">{item.sublabel}</span>}
              </div>
              <span className="text-sm font-bold text-gray-800 tabular-nums ml-2 shrink-0">
                {item.value}{unit}
              </span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%`, backgroundColor: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Chart: Board Matrix (combined volume + rate) ────────────────────────────

function BoardMatrixChart({ items }: {
  items: { label: string; total: number; applied: number; rate: number; color: string }[];
}) {
  if (items.length === 0) {
    return <div className="flex-1 flex items-center justify-center w-full"><p className="text-xs text-gray-400 italic">No jobs sourced in this period</p></div>;
  }
  const maxTotal = Math.max(...items.map(i => i.total), 1);
  return (
    <div className="w-full flex flex-col gap-4">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2.5">
          <span className="text-xs font-medium text-gray-600 w-[76px] shrink-0 truncate">{item.label}</span>
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${(item.total / maxTotal) * 100}%`, backgroundColor: item.color + 'AA' }} />
              </div>
              <span className="text-[11px] text-gray-500 w-7 text-right tabular-nums shrink-0">{item.total}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${item.rate}%`, backgroundColor: item.color }} />
              </div>
              <span className="text-[11px] font-bold w-7 text-right tabular-nums shrink-0" style={{ color: item.color }}>{item.rate}%</span>
            </div>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-4 pt-1 border-t border-gray-50">
        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-gray-300" /><span className="text-[11px] text-gray-400">Saved</span></div>
        <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-blue-500" /><span className="text-[11px] text-gray-400">Apply rate</span></div>
      </div>
    </div>
  );
}

// ─── Chart: Board Efficiency Scatter ─────────────────────────────────────────

function BoardScatterChart({ items }: {
  items: { label: string; total: number; rate: number; color: string }[];
}) {
  if (items.length === 0) {
    return <div className="flex-1 flex items-center justify-center w-full"><p className="text-xs text-gray-400 italic">No data for this period</p></div>;
  }
  const W = 260, H = 180, PAD = { t: 14, r: 14, b: 30, l: 34 };
  const maxX = Math.max(...items.map(i => i.total), 1);
  const maxY = Math.max(...items.map(i => i.rate), 100);
  const medX = maxX / 2;
  const medY = 50;
  const toX = (v: number) => PAD.l + (v / maxX) * (W - PAD.l - PAD.r);
  const toY = (v: number) => PAD.t + (1 - v / maxY) * (H - PAD.t - PAD.b);

  return (
    <div className="flex-1 flex flex-col gap-3 w-full min-h-0">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxHeight: 200 }} preserveAspectRatio="xMidYMid meet">
        <rect x={toX(medX)} y={PAD.t} width={W - PAD.r - toX(medX)} height={toY(0) - PAD.t} fill="#10B98108" />
        <line x1={PAD.l} y1={toY(medY)} x2={W - PAD.r} y2={toY(medY)} stroke="#E5E7EB" strokeDasharray="3 3" />
        <line x1={toX(medX)} y1={PAD.t} x2={toX(medX)} y2={H - PAD.b} stroke="#E5E7EB" strokeDasharray="3 3" />
        <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="#E5E7EB" />
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="#E5E7EB" />
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 4} textAnchor="middle" fontSize={9} fill="#9CA3AF">Jobs volume</text>
        <text x={10} y={(PAD.t + H - PAD.b) / 2} textAnchor="middle" fontSize={9} fill="#9CA3AF" transform={`rotate(-90 10 ${(PAD.t + H - PAD.b) / 2})`}>Apply %</text>
        <text x={W - PAD.r - 2} y={PAD.t + 11} textAnchor="end" fontSize={8} fill="#10B981" opacity={0.7}>High ROI</text>
        {items.map((item, i) => {
          const x = toX(item.total);
          const y = toY(item.rate);
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={7} fill={item.color} opacity={0.85} />
              <text x={x} y={y - 10} textAnchor="middle" fontSize={9} fill={item.color} fontWeight="600">{item.label}</text>
              <text x={x} y={y + 15} textAnchor="middle" fontSize={8} fill="#6B7280">{item.rate}%</text>
            </g>
          );
        })}
        {[0, 25, 50, 75, 100].map(v => (
          <text key={v} x={PAD.l - 3} y={toY(v) + 3} textAnchor="end" fontSize={8} fill="#9CA3AF">{v}</text>
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
            <span className="text-[11px] text-gray-600">{item.label}</span>
            <span className="text-[11px] font-bold tabular-nums" style={{ color: item.color }}>{item.rate}%</span>
            <span className="text-[11px] text-gray-400 tabular-nums">{item.total}j</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Chart: Daily Trend ───────────────────────────────────────────────────────

function DailyTrendChart({ jobs, dateStart, dateEnd }: {
  jobs: { created_at: string; status: string }[];
  dateStart: string; dateEnd: string;
}) {
  const start = new Date(dateStart); start.setHours(0, 0, 0, 0);
  const end   = new Date(dateEnd);   end.setHours(23, 59, 59, 999);
  const days: { label: string; date: string }[] = [];
  const cur = new Date(start);
  while (cur <= end && days.length <= 31) {
    days.push({ label: cur.toLocaleDateString('en', { month: 'short', day: 'numeric' }), date: cur.toISOString().slice(0, 10) });
    cur.setDate(cur.getDate() + 1);
  }

  const saved   = days.map(d => jobs.filter(j => j.created_at.slice(0, 10) === d.date).length);
  const applied = days.map(d => jobs.filter(j => j.created_at.slice(0, 10) === d.date && j.status === 'Applied').length);

  const allVals = [...saved, ...applied];
  const maxV = Math.max(...allVals, 1);

  if (allVals.every(v => v === 0)) {
    return <div className="flex-1 flex items-center justify-center w-full"><p className="text-xs text-gray-400 italic">No jobs in this period</p></div>;
  }

  const W = 280, H = 160, PAD = { t: 12, r: 8, b: 32, l: 28 };
  const xStep = (W - PAD.l - PAD.r) / Math.max(days.length - 1, 1);
  const toY = (v: number) => PAD.t + (1 - v / maxV) * (H - PAD.t - PAD.b);
  const toX = (i: number) => PAD.l + i * xStep;

  const polyline = (vals: number[]) =>
    vals.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');

  const area = (vals: number[]) =>
    `${toX(0)},${H - PAD.b} ` + vals.map((v, i) => `${toX(i)},${toY(v)}`).join(' ') + ` ${toX(vals.length - 1)},${H - PAD.b}`;

  const step = days.length <= 7 ? 1 : days.length <= 15 ? 2 : Math.ceil(days.length / 7);

  return (
    <div className="flex-1 flex flex-col gap-2 w-full min-h-0">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ flex: 1, minHeight: 0 }}>
        {[0, Math.round(maxV / 2), maxV].map(v => (
          <g key={v}>
            <line x1={PAD.l} y1={toY(v)} x2={W - PAD.r} y2={toY(v)} stroke="#F3F4F6" />
            <text x={PAD.l - 4} y={toY(v) + 3} textAnchor="end" fontSize={7} fill="#9CA3AF">{v}</text>
          </g>
        ))}
        <polygon points={area(saved)}   fill="#3B82F6" opacity={0.08} />
        <polygon points={area(applied)} fill="#10B981" opacity={0.12} />
        <polyline points={polyline(saved)}   fill="none" stroke="#3B82F6" strokeWidth={1.5} strokeLinejoin="round" />
        <polyline points={polyline(applied)} fill="none" stroke="#10B981" strokeWidth={1.5} strokeLinejoin="round" />
        {saved.map((v, i) => v > 0 && <circle key={i} cx={toX(i)} cy={toY(v)} r={2.5} fill="#3B82F6" />)}
        {applied.map((v, i) => v > 0 && <circle key={i} cx={toX(i)} cy={toY(v)} r={2.5} fill="#10B981" />)}
        {days.map((d, i) => i % step === 0 && (
          <text key={i} x={toX(i)} y={H - 4} textAnchor="middle" fontSize={7} fill="#9CA3AF">{d.label}</text>
        ))}
      </svg>
      <div className="flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-1.5"><div className="w-4 h-1 rounded bg-blue-500" /><span className="text-[11px] text-gray-500">Saved</span></div>
        <div className="flex items-center gap-1.5"><div className="w-4 h-1 rounded bg-emerald-500" /><span className="text-[11px] text-gray-500">Applied</span></div>
      </div>
    </div>
  );
}

// ─── Chart: Pipeline Flow (bench health) ─────────────────────────────────────

function PipelineFlowChart({ stages }: { stages: { label: string; value: number; color: string }[] }) {
  const total = stages.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <div className="flex-1 flex items-center justify-center w-full"><p className="text-xs text-gray-400 italic">No bench data</p></div>;
  const maxVal = Math.max(...stages.map(s => s.value), 1);

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-stretch h-8 rounded-xl overflow-hidden gap-px">
        {stages.filter(s => s.value > 0).map((s, i) => (
          <div key={i} className="flex items-center justify-center transition-all duration-700 text-white text-[10px] font-black"
            style={{ flex: s.value, backgroundColor: s.color, minWidth: 8 }}
            title={`${s.label}: ${s.value}`}>
            {s.value >= 2 && s.value}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2.5">
        {stages.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-xs font-medium text-gray-700 flex-1">{s.label}</span>
            <div className="w-20 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(s.value / maxVal) * 100}%`, backgroundColor: s.color + '99' }} />
            </div>
            <span className="text-xs font-bold text-gray-800 tabular-nums w-6 text-right">{s.value}</span>
            <span className="text-[11px] text-gray-400 tabular-nums w-8 text-right">{total > 0 ? Math.round((s.value / total) * 100) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Chart: Activity Stats Grid (bench velocity) ──────────────────────────────

function ActivityStatsGrid({ items }: { items: { label: string; value: number; color: string; abbr: string }[] }) {
  const anyData = items.some(i => i.value > 0);
  if (!anyData) return <div className="flex-1 flex items-center justify-center w-full"><p className="text-xs text-gray-400 italic">No activity in this period</p></div>;
  return (
    <div className="grid grid-cols-2 gap-3 w-full">
      {items.map((item, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl p-3 border"
          style={{ backgroundColor: item.color + '0A', borderColor: item.color + '30' }}>
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: item.color }}>{item.abbr}</span>
          <span className="text-3xl font-black tabular-nums leading-none" style={{ color: item.value > 0 ? item.color : '#D1D5DB' }}>
            {item.value}
          </span>
          <span className="text-[11px] text-gray-500 leading-tight">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Chart: Resume Impact Compare (resume_impact) ─────────────────────────────

function ResumeImpactCompare({ withCount, withRate, withoutCount, withoutRate }: {
  withCount: number; withRate: number; withoutCount: number; withoutRate: number;
}) {
  const diff = withRate - withoutRate;
  const hasData = withCount > 0 || withoutCount > 0;
  if (!hasData) return <div className="flex-1 flex items-center justify-center w-full"><p className="text-xs text-gray-400 italic">No job data yet</p></div>;

  const diffColor = diff > 0 ? '#10B981' : diff < 0 ? '#EF4444' : '#9CA3AF';

  return (
    <div className="flex-1 flex flex-col gap-3 w-full min-h-0">
      <div className="flex gap-2 flex-1 min-h-0">
        <div className="flex-1 flex flex-col items-center justify-center rounded-2xl p-4 gap-2"
          style={{ backgroundColor: '#10B98110', border: '1.5px solid #10B98130' }}>
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">With AI Rewrite</span>
          <span className="text-5xl font-black tabular-nums text-emerald-600 leading-none">{withRate}<span className="text-2xl">%</span></span>
          <span className="text-xs text-gray-500">{withCount} job{withCount !== 1 ? 's' : ''}</span>
          <div className="w-full h-2 bg-emerald-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${withRate}%` }} />
          </div>
        </div>
        <div className="flex flex-col items-center justify-center gap-1.5 shrink-0">
          <div className="w-px flex-1 bg-gray-100" />
          {withCount > 0 && withoutCount > 0 && (
            <span className="text-xs font-black px-2 py-1 rounded-xl" style={{ color: diffColor, backgroundColor: diffColor + '18' }}>
              {diff > 0 ? '+' : ''}{diff}pp
            </span>
          )}
          <div className="w-px flex-1 bg-gray-100" />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center rounded-2xl p-4 gap-2"
          style={{ backgroundColor: '#F9FAFB', border: '1.5px solid #E5E7EB' }}>
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">No Rewrite</span>
          <span className="text-5xl font-black tabular-nums text-gray-400 leading-none">{withoutRate}<span className="text-2xl">%</span></span>
          <span className="text-xs text-gray-400">{withoutCount} job{withoutCount !== 1 ? 's' : ''}</span>
          <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-gray-400 transition-all duration-700" style={{ width: `${withoutRate}%` }} />
          </div>
        </div>
      </div>
      <p className="text-[11px] text-center text-gray-400 shrink-0">Apply rate · {withCount + withoutCount} total jobs</p>
    </div>
  );
}

// ─── Chart: Team Roster (team workload) ──────────────────────────────────────

function TeamRosterChart({ members, total, unassigned }: {
  members: { label: string; candidates: number; color: string }[];
  total: number; unassigned: number;
}) {
  if (members.length === 0 && unassigned === 0) return <div className="flex-1 flex items-center justify-center w-full"><p className="text-xs text-gray-400 italic">No team members</p></div>;
  const all = [...members, ...(unassigned > 0 ? [{ label: 'Unassigned', candidates: unassigned, color: '#D1D5DB' }] : [])];
  const R = 18, cx = 18, cy = 18, sw = 4, circ = 2 * Math.PI * R;

  return (
    <div className="grid grid-cols-2 gap-2.5 w-full">
      {all.map((m, i) => {
        const pct = total > 0 ? m.candidates / total : 0;
        const arc = pct * circ;
        return (
          <div key={i} className="flex items-center gap-3 rounded-xl p-3 border border-gray-100 bg-gray-50/50">
            <div className="shrink-0 relative w-9 h-9">
              <svg width={36} height={36} style={{ transform: 'rotate(-90deg)' }}>
                <circle cx={cx} cy={cy} r={R} fill="none" stroke="#F3F4F6" strokeWidth={sw} />
                <circle cx={cx} cy={cy} r={R} fill="none" stroke={m.color} strokeWidth={sw}
                  strokeDasharray={`${arc} ${circ - arc}`} />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[9px] font-black text-gray-700 tabular-nums">{Math.round(pct * 100)}%</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-gray-800 truncate">{m.label}</p>
              <p className="text-[11px] text-gray-400">{m.candidates} candidate{m.candidates !== 1 ? 's' : ''}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Chart: Activity Leaderboard (team activity) ──────────────────────────────

function ActivityLeaderboard({ members }: { members: { label: string; activity: number; color: string }[] }) {
  if (members.length === 0) return <div className="flex-1 flex items-center justify-center w-full"><p className="text-xs text-gray-400 italic">No team members</p></div>;
  const sorted = [...members].sort((a, b) => b.activity - a.activity);
  const maxAct = Math.max(...sorted.map(m => m.activity), 1);
  const medals = ['#F59E0B', '#94A3B8', '#CD7F32'];

  return (
    <div className="flex flex-col gap-2 w-full">
      {sorted.map((m, i) => (
        <div key={i} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
          style={{ backgroundColor: i === 0 ? m.color + '0D' : '#F9FAFB' }}>
          <span className="text-sm font-black tabular-nums w-5 text-center" style={{ color: medals[i] ?? '#D1D5DB' }}>
            {i + 1}
          </span>
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
            <span className="text-xs font-medium text-gray-700 truncate flex-1">{m.label}</span>
          </div>
          <div className="flex items-center gap-0.5">
            {Array.from({ length: 10 }).map((_, j) => (
              <div key={j} className="w-1.5 h-3 rounded-sm transition-all"
                style={{ backgroundColor: j < Math.round((m.activity / maxAct) * 10) ? m.color : '#E5E7EB' }} />
            ))}
          </div>
          <span className="text-sm font-black tabular-nums w-8 text-right" style={{ color: m.color }}>{m.activity}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Chart: Funnel ────────────────────────────────────────────────────────────

function FunnelViz({ stages }: { stages: { label: string; value: number; color: string }[] }) {
  const max = stages[0]?.value || 1;

  if (stages.every(s => s.value === 0)) {
    return (
      <div className="flex-1 flex items-center justify-center w-full">
        <p className="text-xs text-gray-400 italic">No bench data</p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-2.5">
      {stages.map((stage, i) => {
        const pct = (stage.value / max) * 100;
        const conv = i > 0 && stages[i - 1].value > 0
          ? Math.round((stage.value / stages[i - 1].value) * 100)
          : null;
        return (
          <div key={i}>
            {conv !== null && (
              <div className="flex items-center gap-1 mb-1 pl-1">
                <div className="w-3 h-px bg-gray-200" />
                <span className="text-[10px] text-gray-400 font-medium">{conv}% conversion</span>
              </div>
            )}
            <div className="flex items-center gap-2.5">
              <span className="text-xs text-gray-600 font-medium w-[72px] shrink-0 truncate">{stage.label}</span>
              <div className="flex-1 h-8 bg-gray-50 rounded-xl overflow-hidden border border-gray-100">
                <div
                  className="h-full rounded-xl transition-all duration-700 ease-out"
                  style={{
                    width: `${Math.max(pct, stage.value > 0 ? 3 : 0)}%`,
                    background: `linear-gradient(to right, ${stage.color}CC, ${stage.color}66)`,
                  }}
                />
              </div>
              <span className="text-sm font-bold text-gray-800 tabular-nums w-7 text-right shrink-0">{stage.value}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Widget Selector ──────────────────────────────────────────────────────────

function WidgetSelector({ options, selected, onChange }: {
  options: { id: string; label: string }[];
  selected: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const current = options.find(o => o.id === selected) ?? options[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[10px] font-semibold text-gray-500 hover:text-gray-800 bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap"
      >
        {current?.label}
        <ChevronDown size={9} className={`transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 min-w-[168px]">
          {options.map(opt => (
            <button key={opt.id}
              onClick={() => { onChange(opt.id); setOpen(false); }}
              className={`w-full text-left text-xs px-3 py-1.5 transition-colors ${
                selected === opt.id
                  ? 'text-blue-600 font-semibold bg-blue-50'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Widget Card ──────────────────────────────────────────────────────────────

function WidgetCard({ title, subtitle, icon, headerClass, widgetId, widgetViews, setWidgetView, insight, loading, children }: {
  title: string; subtitle: string; icon: React.ReactNode; headerClass: string;
  widgetId: WidgetId; widgetViews: Record<WidgetId, string>;
  setWidgetView: (id: WidgetId, v: string) => void;
  insight: string; loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 min-w-0 min-h-0 bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
      <div className={`px-4 pt-3 pb-2.5 flex items-center gap-2.5 shrink-0 border-b border-gray-100 ${headerClass}`}>
        <div className="shrink-0">{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-gray-900 leading-none">{title}</p>
          <p className="text-[10px] text-gray-400 mt-0.5">{subtitle}</p>
        </div>
        <WidgetSelector
          options={WIDGET_OPTIONS[widgetId]}
          selected={widgetViews[widgetId]}
          onChange={v => setWidgetView(widgetId, v)}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {loading
          ? <div className="flex items-center justify-center h-20"><LogoSpinner size={16} /></div>
          : children}
      </div>

      <div className="px-4 py-2.5 border-t border-gray-100 bg-gradient-to-r from-gray-50 to-white shrink-0">
        <p className="text-[11px] text-gray-500 leading-snug">{insight}</p>
      </div>
    </div>
  );
}

// ─── Desk AI Quick Prompts ───────────────────────────────────────────────────

const QUICK_PROMPTS: { icon: React.FC<{ size: number; className?: string }>; label: string; prompt: string }[] = [
  { icon: BarChart2,  label: 'Pipeline health',  prompt: 'Give me a health check on my bench pipeline — which stages are bottlenecked and what should I prioritise?' },
  { icon: Target,     label: 'Sourcing ROI',      prompt: 'Analyse my job sourcing effectiveness — which boards are performing and where should I focus more effort?' },
  { icon: TrendingUp, label: 'Conversion gaps',   prompt: 'Where are the biggest conversion drop-offs in my pipeline and what actions should I take to improve placement rates?' },
  { icon: Users,      label: 'Team performance',  prompt: 'Summarise team workload distribution and flag any imbalances or members who may be under or over-utilised.' },
  { icon: Layers,     label: 'Period summary',    prompt: 'Give me a concise executive summary of this period — highlights, concerns, and top 3 recommended actions.' },
  { icon: Zap,        label: 'Quick wins',        prompt: 'Based on current metrics, what are the fastest wins I can act on today to move more candidates forward?' },
];

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function Dashboard() {

  // ── State ─────────────────────────────────────────────────────
  const [loading, setLoading]         = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [profiles, setProfiles]       = useState<any[]>([]);
  const [allJobs, setAllJobs]         = useState<any[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [profileAssignments, setProfileAssignments] = useState<{profile_id: string; user_id: string}[]>([]);
  const [periodLogs, setPeriodLogs]   = useState<any[]>([]);

  // ── Filters ───────────────────────────────────────────────────
  const [search, setSearch]             = useState('');
  const [assignedFilter, setAssignedFilter] = useState('');
  const [datePreset, setDatePreset]     = useState<DatePreset>('15d');
  const [customStart, setCustomStart]   = useState('');
  const [customEnd, setCustomEnd]       = useState('');
  const [dateRange, setDateRange]       = useState(() => buildRange('15d'));
  const [filterOpen, setFilterOpen]     = useState(false);
  const [dateOpen, setDateOpen]         = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const dateRef   = useRef<HTMLDivElement>(null);

  // ── Widget views (persisted to localStorage) ──────────────────
  const [widgetViews, setWidgetViews] = useState<Record<WidgetId, string>>(() => {
    try {
      const s = JSON.parse(localStorage.getItem(WIDGET_STORAGE_KEY) ?? '{}');
      return {
        bench:      s.bench      ?? 'distribution',
        jobs:       s.jobs       ?? 'boards',
        team:       s.team       ?? 'workload',
        conversion: s.conversion ?? 'funnel',
      };
    } catch {
      return { bench: 'distribution', jobs: 'boards', team: 'workload', conversion: 'funnel' };
    }
  });

  function setWidgetView(id: WidgetId, view: string) {
    const updated = { ...widgetViews, [id]: view };
    setWidgetViews(updated);
    localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(updated));
  }

  // ── AI ────────────────────────────────────────────────────────
  const [aiPrompt, setAiPrompt]   = useState('');
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // ── Effects ───────────────────────────────────────────────────
  useEffect(() => { loadAllData(); }, []);
  useEffect(() => { if (!loading) loadPeriodLogs(); }, [dateRange, loading]);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
      if (dateRef.current   && !dateRef.current.contains(e.target as Node))   setDateOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // ── Data Loading ──────────────────────────────────────────────
  async function loadAllData() {
    setLoading(true);
    const [profRes, jobsRes, subRes, membersRes, assignRes] = await throttledAll([
      () => supabase.from('profiles').select('id, candidate_name, bench_stage, assigned_to, created_at').order('created_at', { ascending: false }),
      () => supabase.from('wishlisted_jobs').select('id, profile_id, status, board, rewrite_file_url, created_at').limit(10000),
      () => supabase.from('submissions').select('id, candidate_name, submission_type, created_at'),
      () => supabase.from('account_members').select('user_id, invited_email, role').eq('status', 'active'),
      () => supabase.from('profile_assignments').select('profile_id, user_id'),
    ]);
    setProfiles(profRes.data ?? []);
    setAllJobs(jobsRes.data ?? []);
    setAllSubmissions(subRes.data ?? []);
    setTeamMembers((membersRes.data ?? []) as TeamMember[]);
    setProfileAssignments((assignRes.data ?? []) as {profile_id: string; user_id: string}[]);
    setLoading(false);
  }

  async function loadPeriodLogs() {
    setLogsLoading(true);
    const { data } = await supabase
      .from('activity_logs')
      .select('profile_id, user_id, event_type, created_at')
      .gte('created_at', dateRange.start)
      .lte('created_at', dateRange.end)
      .limit(10000);
    setPeriodLogs(data ?? []);
    setLogsLoading(false);
  }

  function applyPreset(preset: DatePreset) {
    setDatePreset(preset);
    if (preset !== 'custom') {
      setDateRange(buildRange(preset));
      setDateOpen(false);
    }
  }

  function applyCustom() {
    if (customStart && customEnd) {
      setDateRange(buildRange('custom', customStart, customEnd));
      setDateOpen(false);
    }
  }

  // ── Derived data ──────────────────────────────────────────────
  const searchLower = search.toLowerCase();

  const filteredProfiles = profiles.filter(p => {
    if (assignedFilter) {
      const pAssignedUserIds = profileAssignments.filter(a => a.profile_id === p.id).map(a => a.user_id);
      if (!pAssignedUserIds.includes(assignedFilter)) return false;
    }
    if (search.trim()) {
      const pAssignedUserIds = profileAssignments.filter(a => a.profile_id === p.id).map(a => a.user_id);
      const memberEmail = teamMembers.find(m => pAssignedUserIds.includes(m.user_id!))?.invited_email ?? '';
      if (!p.candidate_name.toLowerCase().includes(searchLower) && !memberEmail.toLowerCase().includes(searchLower)) return false;
    }
    return true;
  });
  const filteredIds = new Set(filteredProfiles.map(p => p.id));
  const totalBench  = filteredProfiles.length;

  const stageCounts = STAGES.reduce((acc, s) => {
    acc[s] = filteredProfiles.filter(p => (p.bench_stage ?? 'New') === s).length;
    return acc;
  }, {} as Record<string, number>);

  const profilePeriodLogs  = periodLogs.filter(l => filteredIds.has(l.profile_id));
  const periodProfilesAdded = filteredProfiles.filter(p => inRange(p.created_at, dateRange.start, dateRange.end)).length;

  const periodJobs     = allJobs.filter(j => filteredIds.has(j.profile_id) && inRange(j.created_at, dateRange.start, dateRange.end));
  const periodApplied  = periodJobs.filter(j => j.status === 'Applied').length;
  const applyRate      = periodJobs.length > 0 ? Math.round((periodApplied / periodJobs.length) * 100) : 0;
  const periodWithWrite= periodJobs.filter(j => j.rewrite_file_url).length;

  const periodSubmissions = allSubmissions.filter(s =>
    inRange(s.created_at, dateRange.start, dateRange.end) &&
    (!search.trim() || (s.candidate_name ?? '').toLowerCase().includes(searchLower))
  );

  const periodLabel = DATE_PRESETS.find(p => p.id === datePreset)?.label ?? 'Custom Range';

  // Board stats
  const boardStats = Object.entries(
    periodJobs.reduce((acc, j) => {
      if (!acc[j.board]) acc[j.board] = { total: 0, applied: 0 };
      acc[j.board].total++;
      if (j.status === 'Applied') acc[j.board].applied++;
      return acc;
    }, {} as Record<string, { total: number; applied: number }>)
  ).sort((a, b) => b[1].total - a[1].total).map(([board, s]) => ({
    board, label: BOARD_NAMES[board] ?? board,
    color: BOARD_HEX[board] ?? '#6B7280',
    total: s.total, applied: s.applied,
    rate: s.total > 0 ? Math.round((s.applied / s.total) * 100) : 0,
  }));

  // Team stats
  const teamStats = teamMembers.filter(m => m.user_id).map((m, i) => ({
    label:      m.invited_email.split('@')[0],
    userId:     m.user_id!,
    candidates: filteredProfiles.filter(p => profileAssignments.some(a => a.profile_id === p.id && a.user_id === m.user_id)).length,
    activity:   periodLogs.filter(l => l.user_id === m.user_id).length,
    color:      PALETTE[i % PALETTE.length],
  }));
  const assignedProfileIds = new Set(profileAssignments.filter(a => filteredProfiles.some(p => p.id === a.profile_id)).map(a => a.profile_id));
  const unassigned = filteredProfiles.filter(p => !assignedProfileIds.has(p.id)).length;

  // Submission types
  const subTypeCounts = Object.entries(
    periodSubmissions.reduce((acc, s) => {
      const t = s.submission_type ?? 'General';
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).sort((a, b) => b[1] - a[1]);

  // Activity mix
  const EVENT_LABELS: Record<string, string> = {
    resume_uploaded: 'Resume Upload', resume_rewritten: 'Resume Rewrite',
    status_changed: 'Status Change', profile_updated: 'Profile Update',
    match_scored: 'Match Score', email_sent: 'Email Sent',
  };
  const activityMix = Object.entries(
    periodLogs.reduce((acc, l) => {
      const t = l.event_type ?? 'other';
      acc[t] = (acc[t] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([type, count], i) => ({
    label: EVENT_LABELS[type] ?? type, value: count, color: PALETTE[i % PALETTE.length],
  }));

  // Resume impact
  const withRewrite   = periodJobs.filter(j => j.rewrite_file_url);
  const noRewrite     = periodJobs.filter(j => !j.rewrite_file_url);
  const rwApplyRate   = withRewrite.length > 0 ? Math.round((withRewrite.filter(j => j.status === 'Applied').length / withRewrite.length) * 100) : 0;
  const noRwApplyRate = noRewrite.length   > 0 ? Math.round((noRewrite.filter(j => j.status === 'Applied').length   / noRewrite.length)   * 100) : 0;

  // ── Widget renders ────────────────────────────────────────────

  function renderBench() {
    const view = widgetViews.bench;
    if (view === 'distribution') {
      const segs = STAGES.map(s => ({ value: stageCounts[s] ?? 0, color: STAGE_HEX[s], label: s }));
      return <DonutChart segs={segs} total={totalBench} />;
    }
    if (view === 'health') {
      return <PipelineFlowChart stages={STAGES.map(s => ({
        label: s, value: stageCounts[s] ?? 0, color: STAGE_HEX[s],
      }))} />;
    }
    // velocity
    const uploaded  = profilePeriodLogs.filter(l => l.event_type === 'resume_uploaded').length;
    const rewritten = profilePeriodLogs.filter(l => l.event_type === 'resume_rewritten').length;
    const changed   = profilePeriodLogs.filter(l => l.event_type === 'status_changed').length;
    const updated   = profilePeriodLogs.filter(l => l.event_type === 'profile_updated').length;
    return <ActivityStatsGrid items={[
      { label: 'Profiles Added',    abbr: 'Added',    value: periodProfilesAdded, color: '#3B82F6' },
      { label: 'Resumes Uploaded',  abbr: 'Uploads',  value: uploaded,            color: '#10B981' },
      { label: 'AI Rewrites',       abbr: 'Rewrites', value: rewritten,            color: '#F59E0B' },
      { label: 'Status Changes',    abbr: 'Status',   value: changed,              color: '#A78BFA' },
      { label: 'Profile Updates',   abbr: 'Updates',  value: updated,              color: '#9CA3AF' },
    ]} />;
  }

  function renderJobs() {
    const view = widgetViews.jobs;
    if (view === 'boards') {
      return <BoardMatrixChart items={boardStats} />;
    }
    if (view === 'efficiency') {
      return <BoardScatterChart items={boardStats.map(b => ({ label: b.label, total: b.total, rate: b.rate, color: b.color }))} />;
    }
    if (view === 'trend') {
      return <DailyTrendChart jobs={periodJobs} dateStart={dateRange.start} dateEnd={dateRange.end} />;
    }
    // resume_impact
    return <ResumeImpactCompare
      withCount={withRewrite.length}   withRate={rwApplyRate}
      withoutCount={noRewrite.length}  withoutRate={noRwApplyRate}
    />;
  }

  function renderTeam() {
    const view = widgetViews.team;
    if (view === 'workload') {
      return <TeamRosterChart members={teamStats} total={totalBench} unassigned={unassigned} />;
    }
    // activity
    return <ActivityLeaderboard members={teamStats} />;
  }

  function renderConversion() {
    const view = widgetViews.conversion;
    const placed    = stageCounts.Placed ?? 0;
    const submitted = (stageCounts.Submitted ?? 0) + placed;
    const active    = (stageCounts.Sourcing ?? 0) + submitted;

    if (view === 'funnel') {
      return <FunnelViz stages={[
        { label: 'Total Bench', value: totalBench, color: '#3B82F6' },
        { label: 'Active',      value: active,     color: '#A78BFA' },
        { label: 'Submitted',   value: submitted,  color: '#10B981' },
        { label: 'Placed',      value: placed,     color: '#38BDF8' },
      ]} />;
    }
    if (view === 'submissions') {
      const segs = subTypeCounts.map(([t, v], i) => ({ label: t, value: v, color: PALETTE[i % PALETTE.length] }));
      return <DonutChart segs={segs} total={periodSubmissions.length} />;
    }
    // activity mix
    const total = activityMix.reduce((s, a) => s + a.value, 0);
    return <DonutChart segs={activityMix} total={total} />;
  }

  // ── Insight text ──────────────────────────────────────────────

  function benchInsight(): string {
    if (totalBench === 0) return 'No candidates on bench.';
    const view = widgetViews.bench;
    const active  = (stageCounts.Sourcing ?? 0) + (stageCounts.Submitted ?? 0) + (stageCounts.Placed ?? 0);
    const stalled = (stageCounts.New ?? 0) + (stageCounts.Assigned ?? 0);
    if (view === 'distribution') {
      const placed = stageCounts.Placed ?? 0;
      if (placed > 0) return `${placed} placement${placed > 1 ? 's' : ''} this period · push more stalled candidates to Sourcing`;
      if (stalled > active) return `${Math.round((stalled / totalBench) * 100)}% stalled — ${stalled} candidates haven't progressed past Assigned`;
      return `${Math.round((active / totalBench) * 100)}% actively worked · ${stageCounts.Sourcing ?? 0} sourcing, ${stageCounts.Submitted ?? 0} submitted`;
    }
    if (view === 'health') {
      const bottleneck = STAGES.filter(s => s !== 'Placed' && s !== 'Lost').sort((a, b) => (stageCounts[b] ?? 0) - (stageCounts[a] ?? 0))[0];
      const bottleneckPct = totalBench > 0 ? Math.round(((stageCounts[bottleneck] ?? 0) / totalBench) * 100) : 0;
      return bottleneckPct > 40
        ? `Bottleneck at ${bottleneck} (${bottleneckPct}%) — move candidates forward to improve pipeline flow`
        : `Pipeline reasonably spread · ${Math.round((active / totalBench) * 100)}% in active stages`;
    }
    const total = profilePeriodLogs.length;
    return total > 0
      ? `${total} events logged — avg ${(total / Math.max(periodProfilesAdded || totalBench, 1)).toFixed(1)} actions per candidate`
      : `No bench activity logged for ${periodLabel.toLowerCase()} — check team engagement`;
  }

  function jobsInsight(): string {
    if (periodJobs.length === 0) return `No jobs sourced in ${periodLabel.toLowerCase()}`;
    const view = widgetViews.jobs;
    if (view === 'boards') {
      const inactive = boardStats.filter(b => b.rate === 0);
      if (inactive.length > 0) return `${inactive.map(b => b.label).join(', ')} sourced jobs but had 0% apply rate — review quality`;
      const top = boardStats[0];
      const spread = boardStats.length > 1 ? `across ${boardStats.length} boards` : 'single board';
      return top ? `${periodJobs.length} jobs ${spread} · ${top.label} leads volume at ${Math.round((top.total / periodJobs.length) * 100)}% share` : '';
    }
    if (view === 'efficiency') {
      const highROI = boardStats.filter(b => b.total >= periodJobs.length / boardStats.length && b.rate >= 50);
      const lowROI  = boardStats.filter(b => b.total > 2 && b.rate < 20);
      if (highROI.length > 0 && lowROI.length > 0) return `${highROI.map(b => b.label).join(', ')} in high-ROI zone · ${lowROI.map(b => b.label).join(', ')} need attention`;
      if (highROI.length > 0) return `${highROI.map(b => b.label).join(', ')} deliver both volume and conversion — scale up`;
      return `Overall apply rate ${applyRate}% · look for boards in the top-right quadrant`;
    }
    if (view === 'trend') {
      const peakDay = periodJobs.reduce((acc: Record<string, number>, j) => {
        const d = j.created_at.slice(0, 10); acc[d] = (acc[d] ?? 0) + 1; return acc;
      }, {});
      const [busyDate, busyCount] = Object.entries(peakDay).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
      const label = busyDate ? new Date(busyDate).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : '';
      return busyCount > 0 ? `Peak sourcing: ${busyCount} jobs on ${label} · ${applyRate}% overall apply rate` : `${periodJobs.length} jobs over period`;
    }
    // resume_impact
    if (withRewrite.length === 0) return 'No rewritten resumes used yet — try AI Resume to boost apply rate';
    const diff = rwApplyRate - noRwApplyRate;
    return diff > 0
      ? `+${diff}pp lift from AI rewrites · worth using on every application`
      : `${periodWithWrite} rewritten resumes used · more data needed for a clear signal`;
  }

  function teamInsight(): string {
    const view = widgetViews.team;
    if (view === 'workload') {
      if (teamStats.length === 0) return unassigned > 0 ? `${unassigned} candidates unassigned` : 'No team members found';
      const top = [...teamStats].sort((a, b) => b.candidates - a.candidates)[0];
      return `${top.label} manages ${Math.round((top.candidates / totalBench || 1) * 100)}% of pipeline${unassigned > 0 ? ` · ${unassigned} unassigned` : ''}`;
    }
    const topAct = [...teamStats].sort((a, b) => b.activity - a.activity)[0];
    if (!topAct || topAct.activity === 0) return `No team activity logged for ${periodLabel.toLowerCase()}`;
    return `${topAct.label} most active with ${topAct.activity} events in ${periodLabel.toLowerCase()}`;
  }

  function conversionInsight(): string {
    const view = widgetViews.conversion;
    const placed    = stageCounts.Placed ?? 0;
    const submitted = (stageCounts.Submitted ?? 0) + placed;
    if (view === 'funnel') {
      const convPct = totalBench > 0 ? Math.round((submitted / totalBench) * 100) : 0;
      const lostPct = totalBench > 0 ? Math.round(((stageCounts.Lost ?? 0) / totalBench) * 100) : 0;
      if (lostPct > 20) return `${lostPct}% lost — investigate drop-off causes before pipeline shrinks further`;
      if (placed > 0) return `${placed} placement${placed > 1 ? 's' : ''} — ${convPct}% submission rate signals a healthy funnel`;
      return convPct > 30 ? `${convPct}% reached submission — focus on converting to placements` : `${convPct}% submission rate — sourcing more aggressively could help`;
    }
    if (view === 'submissions') {
      if (periodSubmissions.length === 0) return `No submissions in ${periodLabel.toLowerCase()} — prompt team to send candidates out`;
      const top = subTypeCounts[0];
      const diversity = subTypeCounts.length;
      return diversity === 1 ? `All submissions are ${top[0]} type — consider diversifying outreach` : `${diversity} submission types tracked · ${top[0]} leads at ${top[1]}`;
    }
    const total = activityMix.reduce((s, a) => s + a.value, 0);
    if (total === 0) return `No activity logged for ${periodLabel.toLowerCase()} — check if team is using the platform`;
    const top = activityMix[0];
    const bottomTwo = activityMix.slice(-2).map(a => a.label);
    return bottomTwo.length > 0 ? `${top.label} dominates activity · low ${bottomTwo.join(' & ')} may indicate workflow gaps` : '';
  }

  // ── AI Summary ────────────────────────────────────────────────
  async function generateAiSummary() {
    setAiLoading(true);
    setAiSummary('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dashboard-summary`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            bench: {
              total: totalBench, stages: stageCounts,
              period_profiles_added: periodProfilesAdded,
              resumes_uploaded:  profilePeriodLogs.filter(l => l.event_type === 'resume_uploaded').length,
              resumes_rewritten: profilePeriodLogs.filter(l => l.event_type === 'resume_rewritten').length,
              period_status_changes: profilePeriodLogs.filter(l => l.event_type === 'status_changed').length,
            },
            jobs: {
              total_saved: periodJobs.length, applied: periodApplied, apply_rate_pct: applyRate,
              match_scores: profilePeriodLogs.filter(l => l.event_type === 'match_scored').length,
              jobs_with_rewrite: periodWithWrite,
              board_breakdown: Object.fromEntries(boardStats.map(b => [b.board, b.total])),
            },
            comms: {
              emails_sent:       periodLogs.filter(l => l.event_type === 'email_sent').length,
              resumes_generated: periodLogs.filter(l => l.event_type === 'resume_generated').length,
              resumes_rewritten: periodLogs.filter(l => l.event_type === 'resume_rewritten').length,
              total_submissions: periodSubmissions.length,
            },
            date_label: periodLabel,
            custom_prompt: aiPrompt.trim() || undefined,
          }),
        }
      );
      const data = await res.json();
      setAiSummary(data.summary || data.error || 'No summary returned.');
    } catch {
      setAiSummary('Failed to reach AI service. Please try again.');
    }
    setAiLoading(false);
  }

  // ── Loading state ─────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-[100dvh] flex flex-col bg-gray-50 overscroll-none pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-0">
        <AppNav />
        <div className="flex-1 flex items-center justify-center"><LogoSpinner size={20} /></div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-[100dvh] flex flex-col bg-gray-50 font-sans overflow-hidden overscroll-none pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-0">
      <AppNav />

      <div className="flex-1 overflow-y-auto p-2 sm:p-4 flex flex-col gap-3 min-h-0">

        {/* Filter bar */}
        <div className="shrink-0 flex flex-wrap items-center gap-2">
          <div className="flex-1 relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input type="text" placeholder="Search candidates or team members..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-8 py-2 text-xs border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 transition-shadow" />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X size={12} />
              </button>
            )}
          </div>

          <div ref={filterRef} className="relative shrink-0">
            <button onClick={() => setFilterOpen(o => !o)}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border transition-colors ${
                assignedFilter ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
              }`}>
              <Filter size={11} />
              {assignedFilter
                ? (teamMembers.find(m => m.user_id === assignedFilter)?.invited_email.split('@')[0] ?? 'Filtered')
                : 'All Members'}
              <ChevronDown size={10} className={`transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
            </button>
            {filterOpen && (
              <div className="absolute right-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg z-50 w-52 py-1.5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-gray-400 px-3 py-1.5">Assigned To</p>
                <button onClick={() => { setAssignedFilter(''); setFilterOpen(false); }}
                  className={`w-full text-left text-xs px-3 py-1.5 transition-colors ${!assignedFilter ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}>
                  All Members
                </button>
                {teamMembers.filter(m => m.user_id).map(m => (
                  <button key={m.user_id} onClick={() => { setAssignedFilter(m.user_id!); setFilterOpen(false); }}
                    className={`w-full text-left text-xs px-3 py-1.5 transition-colors ${assignedFilter === m.user_id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'}`}>
                    {m.invited_email.split('@')[0]}
                    <span className="text-[10px] text-gray-400 ml-1 capitalize">· {m.role}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div ref={dateRef} className="relative shrink-0">
            <button onClick={() => setDateOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border bg-white text-gray-700 border-gray-200 hover:border-gray-300 transition-colors whitespace-nowrap">
              <Calendar size={11} className="text-gray-400" />
              {datePreset === 'custom' && customStart && customEnd
                ? `${customStart} – ${customEnd}`
                : periodLabel}
              <ChevronDown size={10} className={`transition-transform text-gray-400 ${dateOpen ? 'rotate-180' : ''}`} />
            </button>
            {dateOpen && (
              <div className="absolute right-0 top-full mt-1.5 bg-white border border-gray-200 rounded-xl shadow-lg z-50 w-64 py-1.5">
                {DATE_PRESETS.filter(p => p.id !== 'custom').map(p => (
                  <button key={p.id} onClick={() => applyPreset(p.id)}
                    className={`w-full text-left text-xs px-3 py-2 transition-colors flex items-center gap-2 ${
                      datePreset === p.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'
                    }`}>
                    {datePreset === p.id && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
                    {p.label}
                  </button>
                ))}
                <div className="border-t border-gray-100 mt-1 pt-1">
                  <button onClick={() => applyPreset('custom')}
                    className={`w-full text-left text-xs px-3 py-2 transition-colors flex items-center gap-2 ${
                      datePreset === 'custom' ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-gray-50'
                    }`}>
                    <Calendar size={10} /> Custom range
                  </button>
                  {datePreset === 'custom' && (
                    <div className="px-3 pb-2 space-y-2">
                      <div>
                        <p className="text-[10px] text-gray-400 mb-1">From</p>
                        <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                          className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400" />
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 mb-1">To</p>
                        <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                          className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400" />
                      </div>
                      <button onClick={applyCustom} disabled={!customStart || !customEnd}
                        className="w-full text-xs font-bold bg-blue-600 text-white rounded-lg py-1.5 disabled:opacity-40 hover:bg-blue-700 transition-colors">
                        Apply Range
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <button onClick={() => { loadAllData(); loadPeriodLogs(); }}
            className="shrink-0 p-2 text-gray-500 hover:text-gray-700 bg-white border border-gray-200 hover:border-gray-300 rounded-xl transition-colors">
            <RefreshCw size={13} />
          </button>
        </div>

        {/* ── Two-column layout: Widgets (left 60%) | Desk AI (right 40%) ── */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3">

          {/* ── Left: Widget Grid (2x2) ── */}
          <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 sm:grid-rows-2 gap-3 min-h-0">
            <WidgetCard
              title="Bench Pipeline" subtitle={`${totalBench} total · current state`}
              icon={<div className="w-7 h-7 bg-blue-100 rounded-xl flex items-center justify-center"><Users size={13} className="text-blue-600" /></div>}
              headerClass="bg-gradient-to-r from-blue-50 to-white"
              widgetId="bench" widgetViews={widgetViews} setWidgetView={setWidgetView}
              insight={benchInsight()}
            >
              {renderBench()}
            </WidgetCard>

            <WidgetCard
              title="Job Sourcing" subtitle={`${periodJobs.length} jobs · ${applyRate}% apply rate`}
              icon={<div className="w-7 h-7 bg-emerald-100 rounded-xl flex items-center justify-center"><Briefcase size={13} className="text-emerald-600" /></div>}
              headerClass="bg-gradient-to-r from-emerald-50 to-white"
              widgetId="jobs" widgetViews={widgetViews} setWidgetView={setWidgetView}
              insight={jobsInsight()}
            >
              {renderJobs()}
            </WidgetCard>

            <WidgetCard
              title="Team Performance" subtitle={`${teamStats.length} member${teamStats.length !== 1 ? 's' : ''}`}
              icon={<div className="w-7 h-7 bg-violet-100 rounded-xl flex items-center justify-center"><Activity size={13} className="text-violet-600" /></div>}
              headerClass="bg-gradient-to-r from-violet-50 to-white"
              widgetId="team" widgetViews={widgetViews} setWidgetView={setWidgetView}
              insight={teamInsight()} loading={logsLoading && widgetViews.team === 'activity'}
            >
              {renderTeam()}
            </WidgetCard>

            <WidgetCard
              title="Conversion & Activity" subtitle={`${periodSubmissions.length} submissions`}
              icon={<div className="w-7 h-7 bg-amber-100 rounded-xl flex items-center justify-center"><TrendingUp size={13} className="text-amber-600" /></div>}
              headerClass="bg-gradient-to-r from-amber-50 to-white"
              widgetId="conversion" widgetViews={widgetViews} setWidgetView={setWidgetView}
              insight={conversionInsight()} loading={logsLoading && widgetViews.conversion === 'activity_mix'}
            >
              {renderConversion()}
            </WidgetCard>
          </div>

          {/* ── Right: Desk AI Panel ── */}
          <div className="w-full lg:w-[40%] shrink-0 bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-gray-100 bg-gradient-to-r from-amber-50 to-white shrink-0">
              <div className="w-7 h-7 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                <Sparkles size={13} className="text-amber-500" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-bold text-gray-900">Desk AI</span>
                <p className="text-[10px] text-gray-400 mt-0.5">{periodLabel}</p>
              </div>
            </div>

            {/* Quick Prompts — 3x2 grid */}
            <div className="shrink-0 px-4 py-3 border-b border-gray-100">
              <div className="grid grid-cols-2 sm:grid-cols-3 grid-rows-2 gap-2">
                {QUICK_PROMPTS.map(({ icon: Icon, label, prompt }) => (
                  <button key={label} onClick={() => setAiPrompt(prompt)}
                    className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border text-center transition-all ${
                      aiPrompt === prompt
                        ? 'bg-amber-50 border-amber-300 text-amber-700 shadow-sm shadow-amber-100'
                        : 'border-gray-100 text-gray-500 hover:bg-gray-50 hover:border-gray-200 hover:text-gray-700'
                    }`}>
                    <Icon size={14} className="shrink-0" />
                    <span className="text-[10px] font-medium leading-tight">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* AI Output */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
              {!aiSummary && !aiLoading ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <Sparkles size={20} className="text-gray-200 mb-2" />
                  <p className="text-xs text-gray-300 leading-relaxed max-w-[200px]">
                    Select a prompt above or type your own, then hit Generate.
                  </p>
                </div>
              ) : aiLoading ? (
                <div className="flex flex-col items-center justify-center h-full gap-2">
                  <LogoSpinner size={16} />
                  <p className="text-xs text-gray-400">Analysing your metrics...</p>
                </div>
              ) : (
                <div className="relative">
                  <button onClick={() => setAiSummary('')} className="absolute top-0 right-0 p-1 text-gray-300 hover:text-gray-500 transition-colors">
                    <X size={12} />
                  </button>
                  <ol className="flex flex-col gap-2.5 pr-5">
                    {aiSummary.split('\n').map(l => l.replace(/^[•\-\*\d\.]+\s*/, '').trim()).filter(Boolean).slice(0, 7).map((point, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-[11px] font-black tabular-nums shrink-0 mt-0.5 w-4 text-right"
                          style={{ color: PALETTE[i % PALETTE.length] }}>{i + 1}.</span>
                        <p className="text-[11px] text-gray-700 leading-relaxed">{point}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>

            {/* Prompt input + Generate button at bottom */}
            <div className="shrink-0 px-4 py-3 border-t border-gray-100 bg-gray-50/50">
              <div className="rounded-xl border border-gray-200 bg-white focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-50 transition-all overflow-hidden">
                <textarea
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  placeholder="Ask anything about your metrics..."
                  rows={2}
                  className="w-full text-xs px-3 pt-2.5 pb-1 resize-none focus:outline-none placeholder:text-gray-300 text-gray-700 leading-relaxed bg-transparent block"
                />
                <div className="flex justify-end px-2 pb-2">
                  <button onClick={generateAiSummary} disabled={aiLoading}
                    className="flex items-center gap-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white px-4 py-2 rounded-lg transition-colors shadow-sm shadow-amber-200">
                    {aiLoading ? <LogoSpinner size={11} /> : <Sparkles size={11} />}
                    {aiLoading ? 'Generating...' : 'Generate'}
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
