import { useMemo } from 'react';
import { buildMetricSeries, type DailyRow } from '../lib/admin-signups-series';
import { SIGNUPS_BASE_TARGET } from '../lib/admin-targets';
import type { AccountRow, Totals } from '../lib/admin-account-stats';
import {
  DEPARTMENTS,
  departmentScore,
  evaluateGoal,
  type Department,
  type Goal,
  type GoalResult,
} from '../lib/admin-progress';

type Props = {
  accounts: Pick<AccountRow, 'created_at' | 'active_days'>[];
  daily: DailyRow[];
  /** The 'all' funnel: stage key -> accounts, for signups in the range. */
  funnel: Record<string, number> | undefined;
  totals: Partial<Totals>;
  startDate: string | null;
  endDate: string | null;
  rangeLabel: string;
};

const DOT: Record<GoalResult['direction'], string> = {
  up: 'bg-green-500',
  down: 'bg-red-500',
  flat: 'bg-gray-300',
  unknown: 'bg-gray-200',
};

function formatValue(value: number | null, unit: GoalResult['unit']): string {
  if (value === null) return '—';
  if (unit === 'percent') return `${Math.round(value * 100)}%`;
  return Math.round(value).toLocaleString();
}

function formatAttainment(value: number | null): string {
  if (value === null) return '—';
  const pct = Math.round(value * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

export default function AdminProgress({ accounts, daily, funnel, totals, startDate, endDate, rangeLabel }: Props) {
  const results = useMemo<GoalResult[]>(() => {
    const signups = funnel?.signed_up ?? 0;
    const stage = (key: string) => funnel?.[key] ?? 0;
    const flow = (metric: string | string[]) => buildMetricSeries(daily, metric, 'all', startDate, endDate);
    // Came back on 2+ days: of the accounts that signed up in the range.
    const returned = accounts.filter((a) => {
      const created = Date.parse(a.created_at);
      if (Number.isNaN(created)) return false;
      if (startDate && created < Date.parse(startDate)) return false;
      if (endDate && created > Date.parse(endDate)) return false;
      return (a.active_days ?? 0) >= 2;
    }).length;

    const goals: Goal[] = [
      // ── Growth ──────────────────────────────────────────────────────────
      { key: 'signups', department: 'Growth', label: 'Signups', kind: 'flow', points: flow('signups'), base: SIGNUPS_BASE_TARGET },
      { key: 'chose-role', department: 'Growth', label: 'Chose a role', kind: 'rate', numerator: stage('chose_role'), denominator: signups, target: 0.9 },
      { key: 'activated', department: 'Growth', label: 'Activated (applied at least once)', kind: 'rate', numerator: stage('applied'), denominator: signups, target: 0.3 },
      { key: 'retained', department: 'Growth', label: 'Came back 2+ days', kind: 'rate', numerator: returned, denominator: signups, target: 0.4 },

      // ── Product ─────────────────────────────────────────────────────────
      { key: 'matches', department: 'Product', label: 'Matches sent', kind: 'flow', points: flow('matches') },
      { key: 'watched', department: 'Product', label: 'Matches watched', kind: 'rate', numerator: totals.matches_watched ?? 0, denominator: totals.matches ?? 0, target: 0.3 },
      { key: 'applied', department: 'Product', label: 'Applied (email, site, Ask Resume)', kind: 'flow', points: flow(['applied_email', 'applied_site', 'ask_resume']) },
      { key: 'ai-apply', department: 'Product', label: 'AI Apply fills', kind: 'flow', points: flow('ai_apply_fills') },

      // ── Results ─────────────────────────────────────────────────────────
      { key: 'replies', department: 'Results', label: 'Replies', kind: 'flow', points: flow('replies') },
      { key: 'interviews', department: 'Results', label: 'Interviews', kind: 'flow', points: flow('interviews') },
      { key: 'placed', department: 'Results', label: 'Placed', kind: 'flow', points: flow('placed') },

      // ── Income ──────────────────────────────────────────────────────────
      { key: 'paid-conversion', department: 'Income', label: 'Paid (of signups)', kind: 'rate', numerator: stage('paid'), denominator: signups, target: 0.05 },
      { key: 'paid-orders', department: 'Income', label: 'Paid orders', kind: 'flow', points: flow('paid_orders') },
      { key: 'revenue-inr', department: 'Income', label: 'Revenue ₹', kind: 'flow', points: flow('revenue_inr') },
      { key: 'revenue-usd', department: 'Income', label: 'Revenue $', kind: 'flow', points: flow('revenue_usd') },

      // ── Marketing ───────────────────────────────────────────────────────
      { key: 'referrals', department: 'Marketing', label: 'Referrals', kind: 'flow', points: flow('referrals') },
      { key: 'shared', department: 'Marketing', label: 'Matches shared', kind: 'flow', points: flow('shared') },
      { key: 'social-posts', department: 'Marketing', label: 'Social posts published', kind: 'missing', missing: 'admin_social_posts is not in the admin-stats payload yet.' },

      // ── HR ──────────────────────────────────────────────────────────────
      { key: 'headcount', department: 'HR', label: 'Team headcount', kind: 'missing', missing: 'Nothing about the team is recorded in this database. HR goals need a source before they can appear here.' },
    ];

    return goals.map(evaluateGoal);
  }, [accounts, daily, funnel, totals, startDate, endDate]);

  const byDepartment = (department: Department) => results.filter((r) => r.department === department);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
        {DEPARTMENTS.map((department) => {
          const goals = byDepartment(department);
          const score = departmentScore(goals);
          return (
            <div key={department} className="rounded-lg border border-gray-200 bg-white">
              <div className="flex items-baseline justify-between gap-2 border-b border-gray-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-900">{department}</h2>
                <span className="text-[11px] text-gray-500">
                  {score.measured === 0 ? (
                    // Measured but nothing to plan against yet: a flow that
                    // started at zero has no opening level to grow from.
                    <span className="text-gray-400">{goals.every((g) => g.missing) ? 'no source connected' : 'no baseline yet'}</span>
                  ) : (
                    <>
                      <span className={`font-semibold ${score.met === score.measured ? 'text-green-600' : 'text-gray-900'}`}>
                        {score.met}/{score.measured}
                      </span> at plan
                    </>
                  )}
                </span>
              </div>

              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 text-[10px] uppercase text-gray-400">
                    <th className="px-4 py-1.5 font-semibold">Goal</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Target</th>
                    <th className="px-2 py-1.5 text-right font-semibold">Actual</th>
                    <th className="px-4 py-1.5 text-right font-semibold">vs plan</th>
                  </tr>
                </thead>
                <tbody>
                  {goals.map((goal) => (
                    <tr key={goal.key} className="border-b border-gray-50 last:border-b-0">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[goal.direction]}`} />
                          <span className={`truncate text-xs ${goal.missing ? 'text-gray-400' : 'text-gray-800'}`}>{goal.label}</span>
                        </div>
                        {goal.missing && (
                          <p className="mt-0.5 pl-3 text-[10px] leading-snug text-gray-400">{goal.missing}</p>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right text-xs tabular-nums text-gray-500">{formatValue(goal.target, goal.unit)}</td>
                      <td className="px-2 py-2 text-right text-xs font-semibold tabular-nums text-gray-900">{formatValue(goal.achieved, goal.unit)}</td>
                      <td className={`px-4 py-2 text-right text-xs tabular-nums ${
                        goal.attainment === null ? 'text-gray-300'
                          : goal.attainment >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {formatAttainment(goal.attainment)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <p className="px-1 text-[11px] text-gray-400">
        Flow goals are measured against the 5%-a-day plan (signups from 10 a day, the rest from their own opening level),
        summed across {rangeLabel.toLowerCase()}. Rate goals are a fixed share of the accounts that signed up in the range,
        because a rate compounding 5% a day would pass 100% inside a month. Goals with no source are left blank, not zero.
      </p>
    </div>
  );
}
