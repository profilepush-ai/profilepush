// Goals by department for the admin Progress pane.
//
// Each goal declares where its number comes from. Some departments have no
// source in this database at all — revenue sits in Razorpay, visitor numbers
// in Google Analytics, and nothing about the team is recorded here. Those
// goals render as unconnected, naming what would feed them, rather than
// showing a zero that reads as failure or a guess that reads as fact.
//
// Flow goals (a count per day) are measured against the 5%-a-day plan summed
// over the range. Rate goals (a share of accounts) are measured against a
// fixed percentage, because a conversion rate compounding 5% a day would pass
// 100% inside a month.

import type { SignupPoint } from './admin-signups-series';
import { targetForDate } from './admin-targets';

export type Department = 'Growth' | 'Marketing' | 'Product' | 'Income' | 'HR';

export const DEPARTMENTS: Department[] = ['Growth', 'Marketing', 'Product', 'Income', 'HR'];

export type GoalResult = {
  key: string;
  department: Department;
  label: string;
  /** Null when no source is connected. */
  achieved: number | null;
  target: number | null;
  /** achieved / target - 1. Null when either side is missing. */
  attainment: number | null;
  direction: 'up' | 'down' | 'flat' | 'unknown';
  unit: 'count' | 'percent';
  /** Set only when there is no source; says what would connect it. */
  missing?: string;
};

export type FlowGoal = {
  key: string;
  department: Department;
  label: string;
  kind: 'flow';
  /** Daily points for the metric. */
  points: SignupPoint[];
  /** Base for the 5%-a-day curve. Omitted anchors on the metric's own opening. */
  base?: number;
};

export type RateGoal = {
  key: string;
  department: Department;
  label: string;
  kind: 'rate';
  numerator: number;
  denominator: number;
  /** Fixed share to hit, 0-1. */
  target: number;
  /** Direction of travel, if known from elsewhere. */
  direction?: 'up' | 'down' | 'flat';
};

export type MissingGoal = {
  key: string;
  department: Department;
  label: string;
  kind: 'missing';
  missing: string;
};

export type Goal = FlowGoal | RateGoal | MissingGoal;

function trendDirection(points: SignupPoint[]): 'up' | 'down' | 'flat' {
  if (points.length < 2) return 'flat';
  const half = Math.floor(points.length / 2);
  const mean = (rows: SignupPoint[]) => (rows.length ? rows.reduce((t, p) => t + p.count, 0) / rows.length : 0);
  const previous = mean(points.slice(0, half));
  const recent = mean(points.slice(points.length - half));
  if (previous === 0) return recent > 0 ? 'up' : 'flat';
  const change = (recent - previous) / previous;
  return Math.abs(change) < 0.01 ? 'flat' : change > 0 ? 'up' : 'down';
}

export function evaluateGoal(goal: Goal): GoalResult {
  if (goal.kind === 'missing') {
    return {
      key: goal.key,
      department: goal.department,
      label: goal.label,
      achieved: null,
      target: null,
      attainment: null,
      direction: 'unknown',
      unit: 'count',
      missing: goal.missing,
    };
  }

  if (goal.kind === 'rate') {
    const achieved = goal.denominator === 0 ? 0 : goal.numerator / goal.denominator;
    return {
      key: goal.key,
      department: goal.department,
      label: goal.label,
      achieved,
      target: goal.target,
      // Against a rate target, attainment is the shortfall in the rate itself,
      // not a ratio of ratios — 40% against a 50% goal is 10 points short.
      attainment: goal.target === 0 ? null : achieved / goal.target - 1,
      direction: goal.direction ?? (achieved >= goal.target ? 'up' : 'down'),
      unit: 'percent',
    };
  }

  const achieved = goal.points.reduce((total, p) => total + p.count, 0);
  const base = goal.base ?? openingLevel(goal.points);
  const target = base > 0
    ? goal.points.reduce((total, p) => total + targetForDate(p.key, base, goal.points[0]?.key), 0)
    : 0;

  return {
    key: goal.key,
    department: goal.department,
    label: goal.label,
    achieved,
    target: target > 0 ? target : null,
    attainment: target > 0 ? achieved / target - 1 : null,
    direction: trendDirection(goal.points),
    unit: 'count',
  };
}

function openingLevel(points: SignupPoint[]): number {
  const head = points.slice(0, 3);
  if (!head.length) return 0;
  return head.reduce((sum, p) => sum + p.count, 0) / head.length;
}

/** Department roll-up: how many goals are at or above plan. */
export function departmentScore(results: GoalResult[]): { met: number; measured: number; attainment: number | null } {
  const measured = results.filter((r) => r.attainment !== null);
  if (!measured.length) return { met: 0, measured: 0, attainment: null };
  const met = measured.filter((r) => (r.attainment ?? 0) >= 0).length;
  const attainment = measured.reduce((total, r) => total + (r.attainment ?? 0), 0) / measured.length;
  return { met, measured: measured.length, attainment };
}
