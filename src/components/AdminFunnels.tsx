import { useMemo } from 'react';
import { AlertCircle, ArrowDown } from 'lucide-react';
import {
  buildFunnel,
  formatRate,
  personaLess,
  signupsInRange,
  worstStep,
  type FunnelAccount,
  type FunnelStage,
  type Persona,
} from '../lib/admin-funnel';

type Props = {
  accounts: FunnelAccount[];
  startDate: string | null;
  endDate: string | null;
  rangeLabel: string;
};

const PERSONA_LABEL: Record<Persona, string> = {
  vendor: 'Vendors',
  bench_sales: 'Bench Sales',
};

const PERSONA_ACCENT: Record<Persona, string> = {
  vendor: 'bg-blue-500',
  bench_sales: 'bg-emerald-500',
};

function FunnelColumn({ persona, stages, rangeLabel }: { persona: Persona; stages: FunnelStage[]; rangeLabel: string }) {
  const top = stages[0]?.count ?? 0;
  const worst = worstStep(stages);

  return (
    <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white">
      <div className="flex items-baseline justify-between gap-2 border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${PERSONA_ACCENT[persona]}`} />
          <h2 className="text-sm font-semibold text-gray-900">{PERSONA_LABEL[persona]}</h2>
        </div>
        <span className="text-[10px] text-gray-400">{rangeLabel}</span>
      </div>

      {top === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-gray-400">No {PERSONA_LABEL[persona].toLowerCase()} signed up in this range.</p>
      ) : (
        <div className="p-3">
          {stages.map((stage, index) => {
            // Bar width is share of the top stage, so the shape of the funnel
            // is visible at a glance rather than having to read five numbers.
            const width = Math.max(4, Math.round(stage.overallRate * 100));
            const isWorst = worst?.key === stage.key;
            return (
              <div key={stage.key}>
                {index > 0 && (
                  <div className={`flex items-center gap-1 py-1 pl-1 text-[10px] ${isWorst ? 'text-red-600' : 'text-gray-400'}`}>
                    <ArrowDown size={10} />
                    <span>
                      {formatRate(stage.stepRate)} continue
                      {stage.dropped > 0 && ` · ${stage.dropped} lost`}
                      {isWorst && ' · biggest drop'}
                    </span>
                  </div>
                )}
                <div className="rounded-md bg-gray-50 p-2">
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-medium text-gray-700">{stage.label}</span>
                    <span className="shrink-0 text-xs tabular-nums text-gray-500">
                      <span className="font-semibold text-gray-900">{stage.count}</span>
                      {index > 0 && <span className="ml-1 text-[10px]">({formatRate(stage.overallRate)})</span>}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                    <div className={`h-full rounded-full ${PERSONA_ACCENT[persona]}`} style={{ width: `${width}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function AdminFunnels({ accounts, startDate, endDate, rangeLabel }: Props) {
  const vendor = useMemo(() => buildFunnel(accounts, 'vendor', startDate, endDate), [accounts, startDate, endDate]);
  const bench = useMemo(() => buildFunnel(accounts, 'bench_sales', startDate, endDate), [accounts, startDate, endDate]);
  const signups = useMemo(() => signupsInRange(accounts, startDate, endDate), [accounts, startDate, endDate]);
  const undecided = useMemo(() => personaLess(accounts, startDate, endDate), [accounts, startDate, endDate]);

  return (
    <div className="space-y-3">
      {/* The two stages above signup are not ours to measure. Saying so beats
          estimating them: a guessed rate at the top makes every rate below it
          wrong, and this dashboard is read by people acting on the numbers. */}
      <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
        <div className="flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-gray-400" />
          <div className="min-w-0 text-xs text-gray-600">
            <p className="font-semibold text-gray-700">Website and signup-page visits are not connected.</p>
            <p className="mt-0.5">
              Those live in Google Analytics (<code>G-Y4Z8FJQMG0</code>); this database only starts recording once an
              account exists. Connecting the GA4 Data API would add the two stages above and give a true
              visitor-to-signup rate — the number every traffic estimate in the growth plan rests on.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase text-gray-500">Signed up</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{signups.toLocaleString()}</p>
          <p className="mt-0.5 text-[10px] text-gray-400">{rangeLabel}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase text-gray-500">Chose a persona</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">
            {(vendor[0]?.count ?? 0) + (bench[0]?.count ?? 0)}
          </p>
          <p className="mt-0.5 text-[10px] text-gray-400">
            {signups > 0 ? formatRate(((vendor[0]?.count ?? 0) + (bench[0]?.count ?? 0)) / signups) : '—'} of signups
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-[10px] font-semibold uppercase text-gray-500">Never chose one</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${undecided > 0 ? 'text-red-600' : 'text-gray-900'}`}>
            {undecided.toLocaleString()}
          </p>
          <p className="mt-0.5 text-[10px] text-gray-400">in neither funnel below</p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <FunnelColumn persona="vendor" stages={vendor} rangeLabel={rangeLabel} />
        <FunnelColumn persona="bench_sales" stages={bench} rangeLabel={rangeLabel} />
      </div>
    </div>
  );
}
