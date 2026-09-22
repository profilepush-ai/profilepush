import { useMemo } from 'react';
import { buildMetricSeries, type DailyRow } from '../lib/admin-signups-series';
import { buildSignupSeries } from '../lib/admin-signups-series';
import { SIGNUPS_BASE_TARGET } from '../lib/admin-targets';
import {
  DEPARTMENTS,
  departmentScore,
  evaluateGoal,
  type Department,
  type Goal,
  type GoalResult,
} from '../lib/admin-progress';

type Account = {
  created_at: string;
  active_persona: 'vendor' | 'bench_sales' | null;
  session_count: number;
  job_posts_count: number;
  hotlist_posts_count: number;
  job_previews_count: number;
  hotlist_previews_count: number;
  ai_pitches_count: number;
  ai_requests_count: number;
  ai_match_runs_count: number;
  gmail_connected: boolean;
  active_days: number;
  is_trial: boolean;
};

type Props = {
  accounts: Account[];
  daily: DailyRow[];
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

export default function AdminProgress({ accounts, daily, startDate, endDate, rangeLabel }: Props) {
  const results = useMemo<GoalResult[]>(() => {
    const inRange = accounts.filter((a) => {
      const created = Date.parse(a.created_at);
      if (Number.isNaN(created)) return false;
      if (startDate && created < Date.parse(startDate)) return false;
      if (endDate && created > Date.parse(endDate)) return false;
      return true;
    });
    const cohort = inRange.length;
    const flow = (key: string) => buildMetricSeries(daily, key, 'all', startDate, endDate);
    const share = (test: (a: Account) => boolean) => inRange.filter(test).length;

    const goals: Goal[] = [
      // ── Growth ──────────────────────────────────────────────────────────
      { key: 'signups', department: 'Growth', label: 'Signups', kind: 'flow', points: buildSignupSeries(inRange, startDate, endDate), base: SIGNUPS_BASE_TARGET },
      { key: 'persona-chosen', department: 'Growth', label: 'Chose a persona', kind: 'rate', numerator: share((a) => a.active_persona != null), denominator: cohort, target: 0.9 },
      { key: 'activated', department: 'Growth', label: 'Signed in at least once', kind: 'rate', numerator: share((a) => a.session_count > 0), denominator: cohort, target: 0.8 },
      { key: 'retained', department: 'Growth', label: 'Came back 2+ days', kind: 'rate', numerator: share((a) => a.active_days >= 2), denominator: cohort, target: 0.4 },

      // ── Product ─────────────────────────────────────────────────────────
      { key: 'previews', department: 'Product', label: 'Post previews', kind: 'flow', points: flow('previews') },
      { key: 'ai-submits', department: 'Product', label: 'AI submits sent', kind: 'flow', points: (() => { const a = flow('ai_pitches'); const b = flow('ai_requests'); return a.map((p, i) => ({ key: p.key, count: p.count + (b[i]?.count ?? 0) })); })() },
      { key: 'ai-matches', department: 'Product', label: 'AI matches delivered', kind: 'flow', points: flow('ai_matches') },
      { key: 'posts', department: 'Product', label: 'Posts published', kind: 'flow', points: (() => { const a = flow('job_posts'); const b = flow('hotlist_posts'); return a.map((p, i) => ({ key: p.key, count: p.count + (b[i]?.count ?? 0) })); })() },

      // ── Income ──────────────────────────────────────────────────────────
      { key: 'paid-conversion', department: 'Income', label: 'Upgraded to paid', kind: 'rate', numerator: share((a) => a.is_trial === false), denominator: cohort, target: 0.05 },
      { key: 'revenue', department: 'Income', label: 'Revenue', kind: 'missing', missing: 'Razorpay payments are not exposed to this dashboard. admin-stats would need to read the subscription and order tables.' },
      { key: 'arpu', department: 'Income', label: 'Revenue per account', kind: 'missing', missing: 'Needs revenue above before it can be computed.' },

      // ── Marketing ───────────────────────────────────────────────────────
      { key: 'visitors', department: 'Marketing', label: 'Website visitors', kind: 'missing', missing: 'Lives in Google Analytics (G-Y4Z8FJQMG0). Connecting the GA4 Data API would bring visitors and the visitor-to-signup rate in.' },
      { key: 'social-posts', department: 'Marketing', label: 'Social posts published', kind: 'missing', missing: 'admin_social_posts is not included in the admin-stats payload yet.' },
      { key: 'shares', department: 'Marketing', label: 'Jobs and hotlists shared', kind: 'missing', missing: 'The public /job/:id and /hotlist/:id permalinks carry no share tracking. Instrumenting them is a small change and would also measure the referral loop.' },

      // ── HR ──────────────────────────────────────────────────────────────
      { key: 'headcount', department: 'HR', label: 'Team headcount', kind: 'missing', missing: 'Nothing about the team is recorded in this database. HR goals need a source before they can appear here.' },
    ];

    return goals.map(evaluateGoal);
  }, [accounts, daily, startDate, endDate]);

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
                    <span className="text-gray-400">no source connected</span>
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
        Flow goals are measured against the 10-a-day plan compounding 5% daily, summed across {rangeLabel.toLowerCase()}.
        Rate goals are measured against a fixed share, because a conversion rate compounding 5% a day would pass 100%
        inside a month. Goals with no source are left blank rather than shown as zero.
      </p>
    </div>
  );
}
